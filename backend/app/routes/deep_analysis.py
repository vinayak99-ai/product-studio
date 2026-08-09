from __future__ import annotations

import re
from typing import Literal

from fastapi import APIRouter, HTTPException, Response
from openai import OpenAIError
from pydantic import BaseModel

from app.deep_analysis_html import build_deep_analysis_html
from app.deep_analysis_llm import run_clarify, run_extraction, run_synthesis
from app.deep_analysis_markdown import build_deep_analysis_markdown
from app.deep_analysis_models import (
    CLARIFY_MAX_ROUNDS,
    CLARIFY_MAX_TOTAL_QUESTIONS,
    CLARIFY_ROUND_SIZE,
    AnsweredClarification,
    ArtifactVersionMeta,
    ClarifyAnswersRequest,
    ClarifyQuestion,
    CreateProjectRequest,
    DeepAnalysisDocument,
    GenerateRequest,
    GenerateResponse,
    InputRequest,
    ProjectMeta,
    RenameProjectRequest,
)
from app.deep_analysis_persistence import (
    append_input_clarifications,
    clear_pending_clarification,
    create_project,
    delete_project,
    get_project,
    list_artifact_versions,
    list_artifacts,
    load_artifact,
    load_artifact_version,
    load_input,
    load_pending_clarification,
    mark_generated,
    rename_project,
    save_artifact,
    save_input_notes,
    save_pending_clarification,
)
from app.deep_analysis_persistence import list_projects as _list_projects

router = APIRouter(prefix="/api/deep-analysis")


def _slug(title: str) -> str:
    """Same regex-based slugify as routes/design_thinking.py's
    _export_filename -- kept as an independent copy rather than a shared
    import, matching how that file's frontend/backend counterparts are also
    deliberately kept in sync rather than shared."""
    slug = re.sub(r"[^a-z0-9]+", "-", title.strip().lower()).strip("-")[:60].rstrip("-")
    return slug or "deep-analysis"


def _openai_error(exc: OpenAIError) -> HTTPException:
    return HTTPException(status_code=502, detail=f"LLM provider error: {exc}")


# Current pipeline stage per project, polled by the UI while its generate/
# clarify request is in flight -- same in-memory, single-user-app pattern as
# Spec Builder's _generation_progress.
_generation_progress: dict[str, str] = {}


def _set_stage(project_id: str, stage: str) -> None:
    _generation_progress[project_id] = stage


class ProjectSummary(BaseModel):
    stage: Literal["empty", "clarifying", "generated"]
    pending_questions: int = 0
    round: int = 0
    questions_used: int = 0


class ProjectListItem(ProjectMeta):
    summary: ProjectSummary


def _summarize_project(project_id: str) -> ProjectSummary:
    pending = load_pending_clarification(project_id)
    if pending is not None:
        return ProjectSummary(
            stage="clarifying",
            pending_questions=len(pending.questions),
            round=pending.round,
            questions_used=len(pending.history),
        )
    if list_artifacts(project_id):
        return ProjectSummary(stage="generated")
    return ProjectSummary(stage="empty")


@router.post("/projects", response_model=ProjectMeta)
def api_create_project(req: CreateProjectRequest) -> ProjectMeta:
    return create_project(req.name)


@router.get("/projects", response_model=list[ProjectListItem])
def api_list_projects() -> list[ProjectListItem]:
    return [ProjectListItem(**meta.model_dump(), summary=_summarize_project(meta.id)) for meta in _list_projects()]


def _require_project(project_id: str) -> ProjectMeta:
    try:
        return get_project(project_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Project not found.")


@router.get("/projects/{project_id}", response_model=ProjectMeta)
def api_get_project(project_id: str) -> ProjectMeta:
    return _require_project(project_id)


@router.patch("/projects/{project_id}", response_model=ProjectMeta)
def api_rename_project(project_id: str, req: RenameProjectRequest) -> ProjectMeta:
    _require_project(project_id)
    return rename_project(project_id, req.name)


@router.delete("/projects/{project_id}")
def api_delete_project(project_id: str) -> dict:
    delete_project(project_id)
    return {"ok": True}


@router.get("/projects/{project_id}/input")
def api_get_input(project_id: str):
    return load_input(project_id)


@router.put("/projects/{project_id}/input")
def api_save_input(project_id: str, req: InputRequest):
    return save_input_notes(project_id, req.raw_notes)


@router.get("/projects/{project_id}/generation-status")
def api_generation_status(project_id: str) -> dict:
    return {"stage": _generation_progress.get(project_id)}


@router.get("/projects/{project_id}/document")
def api_get_document(project_id: str):
    """Latest generated document, if any -- None if this project hasn't
    finished a full interview yet."""
    _require_project(project_id)
    artifact_ids = list_artifacts(project_id)
    if not artifact_ids:
        return {"artifact_id": None, "document": None}
    artifact_id = artifact_ids[0]
    return {"artifact_id": artifact_id, "document": load_artifact(project_id, artifact_id)}


@router.get("/projects/{project_id}/artifacts/{artifact_id}/versions", response_model=list[ArtifactVersionMeta])
def api_list_versions(project_id: str, artifact_id: str) -> list[ArtifactVersionMeta]:
    return list_artifact_versions(project_id, artifact_id)


@router.get("/projects/{project_id}/artifacts/{artifact_id}/versions/{version}", response_model=DeepAnalysisDocument)
def api_get_version(project_id: str, artifact_id: str, version: int) -> DeepAnalysisDocument:
    return load_artifact_version(project_id, artifact_id, version)


@router.put("/projects/{project_id}/artifacts/{artifact_id}")
def api_update_artifact(project_id: str, artifact_id: str, document: DeepAnalysisDocument) -> dict:
    """Persists manual edits made via EditableText in the document view --
    same shape as Spec Builder's PUT .../artifacts/{artifact_id}."""
    _require_project(project_id)
    save_artifact(project_id, document, artifact_id, reason="manual edit")
    return {"status": "saved"}


def _start_generation(project_id: str, raw_notes: str, target_artifact_id: str | None, reason: str) -> GenerateResponse:
    """Runs extraction -> deep clarify -> (synthesis once clarified enough).
    Shared by /generate (fresh raw_notes, no target artifact) and
    /regenerate (raw_notes read from persisted input, target_artifact_id
    set so the result lands as a new version of the existing document)."""
    try:
        _set_stage(project_id, "extracting")
        try:
            extracted = run_extraction(raw_notes)
            _set_stage(project_id, "clarifying")
            clarify_result = run_clarify(extracted, [])
        except OpenAIError as e:
            raise _openai_error(e)

        round_questions = clarify_result.questions[:CLARIFY_ROUND_SIZE]
        if round_questions:
            save_pending_clarification(project_id, raw_notes, extracted, round_questions, [], 1, target_artifact_id, reason)
            return GenerateResponse(
                status="needs_clarification",
                questions=round_questions,
                round=1,
                max_rounds=CLARIFY_MAX_ROUNDS,
                questions_used=0,
                max_questions=CLARIFY_MAX_TOTAL_QUESTIONS,
            )

        try:
            document = run_synthesis(extracted, [])
        except OpenAIError as e:
            raise _openai_error(e)

        artifact_id = save_artifact(project_id, document, target_artifact_id, reason=reason)
        mark_generated(project_id)
        return GenerateResponse(
            status="generated",
            round=1,
            max_rounds=CLARIFY_MAX_ROUNDS,
            questions_used=0,
            max_questions=CLARIFY_MAX_TOTAL_QUESTIONS,
            artifact_id=artifact_id,
            document=document,
        )
    finally:
        _generation_progress.pop(project_id, None)


@router.post("/projects/{project_id}/generate", response_model=GenerateResponse)
def api_generate(project_id: str, req: GenerateRequest) -> GenerateResponse:
    _require_project(project_id)
    save_input_notes(project_id, req.raw_notes)
    return _start_generation(project_id, req.raw_notes, target_artifact_id=None, reason="generated")


@router.post("/projects/{project_id}/regenerate", response_model=GenerateResponse)
def api_regenerate(project_id: str) -> GenerateResponse:
    _require_project(project_id)
    deep_input = load_input(project_id)
    if not deep_input.raw_notes.strip():
        raise HTTPException(status_code=400, detail="No input notes saved for this project yet.")

    artifact_ids = list_artifacts(project_id)
    target_artifact_id = artifact_ids[0] if artifact_ids else None
    return _start_generation(project_id, deep_input.raw_notes, target_artifact_id, reason="regenerated from updated input")


@router.post("/projects/{project_id}/clarify", response_model=GenerateResponse)
def api_clarify(project_id: str, req: ClarifyAnswersRequest) -> GenerateResponse:
    _require_project(project_id)
    pending = load_pending_clarification(project_id)
    if pending is None:
        raise HTTPException(status_code=404, detail="No pending clarification for this project.")

    answered_now = [
        AnsweredClarification(question=q, answer=req.answers.get(q.id) or q.recommended or "(no answer given)")
        for q in pending.questions
    ]
    # Persisted immediately, independent of whether this round turns out to
    # be the last one -- unlike pending_clarification.json (cleared once
    # synthesis succeeds), the input's transcript is never cleared.
    append_input_clarifications(project_id, answered_now)
    new_history = pending.history + answered_now

    try:
        next_questions: list[ClarifyQuestion] = []
        if not req.force_generate and pending.round < CLARIFY_MAX_ROUNDS and len(new_history) < CLARIFY_MAX_TOTAL_QUESTIONS:
            _set_stage(project_id, "clarifying")
            try:
                clarify_result = run_clarify(pending.extracted, new_history)
            except OpenAIError as e:
                raise _openai_error(e)
            remaining_budget = CLARIFY_MAX_TOTAL_QUESTIONS - len(new_history)
            next_questions = clarify_result.questions[: min(CLARIFY_ROUND_SIZE, remaining_budget)]

        if next_questions:
            save_pending_clarification(
                project_id, pending.raw_notes, pending.extracted, next_questions, new_history,
                pending.round + 1, pending.target_artifact_id, pending.reason,
            )
            return GenerateResponse(
                status="needs_clarification",
                questions=next_questions,
                round=pending.round + 1,
                max_rounds=CLARIFY_MAX_ROUNDS,
                questions_used=len(new_history),
                max_questions=CLARIFY_MAX_TOTAL_QUESTIONS,
            )

        try:
            _set_stage(project_id, "synthesizing")
            document = run_synthesis(pending.extracted, new_history)
        except OpenAIError as e:
            raise _openai_error(e)

        artifact_id = save_artifact(project_id, document, pending.target_artifact_id, reason=pending.reason)
        mark_generated(project_id)
        clear_pending_clarification(project_id)
        return GenerateResponse(
            status="generated",
            round=pending.round,
            max_rounds=CLARIFY_MAX_ROUNDS,
            questions_used=len(new_history),
            max_questions=CLARIFY_MAX_TOTAL_QUESTIONS,
            artifact_id=artifact_id,
            document=document,
        )
    finally:
        _generation_progress.pop(project_id, None)


@router.post("/projects/{project_id}/artifacts/{artifact_id}/export")
def api_export(project_id: str, artifact_id: str) -> Response:
    document = load_artifact(project_id, artifact_id)
    markdown = build_deep_analysis_markdown(document)
    return Response(
        content=markdown,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{_slug(document.title)}.md"'},
    )


@router.post("/projects/{project_id}/artifacts/{artifact_id}/export/html")
def api_export_html(project_id: str, artifact_id: str) -> Response:
    document = load_artifact(project_id, artifact_id)
    html = build_deep_analysis_html(document)
    return Response(
        content=html,
        media_type="text/html",
        headers={"Content-Disposition": f'attachment; filename="{_slug(document.title)}.html"'},
    )
