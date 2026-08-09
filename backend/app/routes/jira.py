from __future__ import annotations

from fastapi import APIRouter, HTTPException
from openai import OpenAIError

from app.jira_client import JiraConnectionError, fetch_project_snapshot, test_connection
from app.jira_models import (
    AttachToSpecBuilderResponse,
    CreateJiraConnectionRequest,
    JiraConnectionDetail,
    JiraConnectionMeta,
    JiraEpicSnapshot,
    JiraProjectSnapshot,
    RenameJiraConnectionRequest,
    SpecBuilderProjectOption,
)
from app.jira_persistence import (
    create_connection,
    delete_connection,
    get_connection,
    get_secret,
    list_connections,
    load_snapshot,
    rename_connection,
    save_snapshot,
)
from app.spec_builder.agents import run_jira_import
from app.spec_builder.persistence import list_artifacts, list_projects, load_artifact, save_artifact

router = APIRouter(prefix="/api/jira")


def _require_connection(connection_id: str) -> JiraConnectionMeta:
    try:
        return get_connection(connection_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Connection not found.")


def _detail(connection_id: str) -> JiraConnectionDetail:
    return JiraConnectionDetail(meta=_require_connection(connection_id), snapshot=load_snapshot(connection_id))


def _epic_to_dict(epic: JiraEpicSnapshot) -> dict:
    return {
        "key": epic.key,
        "title": epic.title,
        "description": epic.description,
        "stories": [{"key": s.key, "title": s.title, "description": s.description} for s in epic.stories],
    }


def _unlinked_stories(snapshot: JiraProjectSnapshot) -> list[dict]:
    # Attaching to Spec Builder deliberately only carries Epic/Story issues
    # through -- other_issues also holds Task/Bug/Sub-task types (visible in
    # the Jira tab's own browse view), which the enrichment agent's prompt
    # isn't written to classify.
    return [
        {"key": i.key, "title": i.title, "description": i.description}
        for i in snapshot.other_issues
        if i.issue_type == "Story"
    ]


@router.post("/connections/test")
def api_test_connection(request: CreateJiraConnectionRequest) -> dict:
    try:
        test_connection(request.base_url, request.email, request.api_token, request.project_key)
    except JiraConnectionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@router.post("/connections", response_model=JiraConnectionMeta)
def api_create_connection(request: CreateJiraConnectionRequest) -> JiraConnectionMeta:
    try:
        test_connection(request.base_url, request.email, request.api_token, request.project_key)
    except JiraConnectionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return create_connection(
        request.name, request.base_url, request.email, request.api_token, request.project_key
    )


@router.get("/connections", response_model=list[JiraConnectionMeta])
def api_list_connections() -> list[JiraConnectionMeta]:
    return list_connections()


@router.get("/connections/{connection_id}", response_model=JiraConnectionDetail)
def api_get_connection(connection_id: str) -> JiraConnectionDetail:
    return _detail(connection_id)


@router.patch("/connections/{connection_id}", response_model=JiraConnectionMeta)
def api_rename_connection(connection_id: str, request: RenameJiraConnectionRequest) -> JiraConnectionMeta:
    _require_connection(connection_id)
    return rename_connection(connection_id, request.name)


@router.delete("/connections/{connection_id}")
def api_delete_connection(connection_id: str) -> dict:
    delete_connection(connection_id)
    return {"ok": True}


@router.post("/connections/{connection_id}/pull", response_model=JiraConnectionDetail)
def api_pull(connection_id: str) -> JiraConnectionDetail:
    meta = _require_connection(connection_id)
    api_token = get_secret(connection_id)
    try:
        snapshot, truncated = fetch_project_snapshot(meta.base_url, meta.email, api_token, meta.project_key)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Jira pull failed: {exc}") from exc
    save_snapshot(connection_id, snapshot, truncated)
    return _detail(connection_id)


@router.get("/connections/{connection_id}/spec-builder-projects", response_model=list[SpecBuilderProjectOption])
def api_spec_builder_projects(connection_id: str) -> list[SpecBuilderProjectOption]:
    _require_connection(connection_id)
    return [
        SpecBuilderProjectOption(id=p.id, name=p.name) for p in list_projects() if list_artifacts(p.id)
    ]


@router.post("/connections/{connection_id}/attach/{spec_project_id}", response_model=AttachToSpecBuilderResponse)
def api_attach_to_spec_builder(connection_id: str, spec_project_id: str) -> AttachToSpecBuilderResponse:
    _require_connection(connection_id)
    snapshot = load_snapshot(connection_id)
    if snapshot is None:
        raise HTTPException(status_code=400, detail="Pull this connection's Jira project first.")

    artifact_ids = list_artifacts(spec_project_id)
    if not artifact_ids:
        raise HTTPException(
            status_code=404,
            detail="That Spec Builder project has no generated spec yet -- generate one first.",
        )
    artifact_id = artifact_ids[0]
    prd = load_artifact(spec_project_id, artifact_id)

    raw_epics = [_epic_to_dict(e) for e in snapshot.epics]
    unlinked = _unlinked_stories(snapshot)

    existing_epic_count = len(prd.epics)
    existing_story_count = sum(len(e.stories) for e in prd.epics)

    try:
        prd.epics, unmapped_requirements = run_jira_import(prd, raw_epics, unlinked)
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI request failed: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Attach failed: {exc}") from exc

    new_epics = len(prd.epics) - existing_epic_count
    new_stories = sum(len(e.stories) for e in prd.epics) - existing_story_count

    save_artifact(spec_project_id, prd, artifact_id, reason="attached from Jira tab")
    return AttachToSpecBuilderResponse(
        new_epics=new_epics, new_stories=new_stories, unmapped_requirements=unmapped_requirements
    )
