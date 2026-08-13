from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, Response
from openai import OpenAIError

from app import discovery_qa_persistence as persistence
from app.discovery_qa_export import build_meeting_minutes_markdown
from app.discovery_qa_llm import enrich_session, generate_candidate_questions
from app.discovery_qa_models import (
    CandidateQuestionsResponse,
    CreateSessionRequest,
    DiscoverySessionDetail,
    DiscoverySessionMeta,
    DiscoverySourceProject,
    GenerateCandidatesRequest,
    RenameSessionRequest,
    SaveAnswerRequest,
    SaveNotesRequest,
    UpdateQuestionsRequest,
)
from app.spec_builder.export import export_to_markdown
from app.spec_builder.persistence import list_artifacts, list_projects, load_artifact

router = APIRouter(prefix="/api/discovery-qa")


def _slug(title: str) -> str:
    """Same regex-based slugify as routes/diagram_slide.py's _slug --
    independent copy by this backend's established convention rather than
    a shared import."""
    slug = re.sub(r"[^a-z0-9]+", "-", title.strip().lower()).strip("-")[:60].rstrip("-")
    return slug or "discovery-qa"


def _load_source_prd_markdown(project_id: str) -> tuple[str, str]:
    """Same pattern as routes/story.py's helper of the same name --
    resolves a Spec Builder project to its primary artifact's markdown."""
    artifact_ids = list_artifacts(project_id)
    if not artifact_ids:
        raise HTTPException(
            status_code=404,
            detail="This project has no generated spec yet -- generate one in Spec Builder first.",
        )
    prd = load_artifact(project_id, artifact_ids[0])
    return export_to_markdown(prd), prd.title


def _require_session(session_id: str) -> None:
    if not persistence.session_exists(session_id):
        raise HTTPException(status_code=404, detail="Discovery session not found.")


@router.get("/spec-projects", response_model=list[DiscoverySourceProject])
def api_list_spec_projects():
    return [
        DiscoverySourceProject(id=p.id, name=p.name, has_prd=bool(list_artifacts(p.id)))
        for p in list_projects()
    ]


@router.post("/generate-candidates", response_model=CandidateQuestionsResponse)
async def api_generate_candidates(request: GenerateCandidatesRequest):
    prd_text, _ = _load_source_prd_markdown(request.project_id)
    try:
        return await generate_candidate_questions(prd_text, request.prompt)
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail=f"LLM provider error: {exc}")


@router.get("/sessions", response_model=list[DiscoverySessionMeta])
def api_list_sessions():
    return persistence.list_sessions()


@router.post("/sessions", response_model=DiscoverySessionMeta)
def api_create_session(request: CreateSessionRequest):
    source_project = next((p for p in list_projects() if p.id == request.source_project_id), None)
    if source_project is None:
        raise HTTPException(status_code=404, detail="Source spec project not found.")
    name = request.name.strip() or source_project.name
    return persistence.create_session(name, request.source_project_id, source_project.name, request.questions)


@router.get("/sessions/{session_id}", response_model=DiscoverySessionDetail)
def api_get_session(session_id: str):
    _require_session(session_id)
    return persistence.get_session_detail(session_id)


@router.patch("/sessions/{session_id}", response_model=DiscoverySessionMeta)
def api_rename_session(session_id: str, request: RenameSessionRequest):
    _require_session(session_id)
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Session name is required.")
    return persistence.rename_session(session_id, name)


@router.delete("/sessions/{session_id}")
def api_delete_session(session_id: str):
    _require_session(session_id)
    persistence.delete_session(session_id)
    return {"status": "deleted"}


@router.put("/sessions/{session_id}/questions", response_model=DiscoverySessionDetail)
def api_update_questions(session_id: str, request: UpdateQuestionsRequest):
    _require_session(session_id)
    return persistence.update_questions(session_id, request.questions)


@router.patch("/sessions/{session_id}/questions/{question_id}/answer", response_model=DiscoverySessionDetail)
def api_save_answer(session_id: str, question_id: str, request: SaveAnswerRequest):
    _require_session(session_id)
    detail = persistence.save_answer(session_id, question_id, request.answer)
    if not any(q.id == question_id for q in detail.questions):
        raise HTTPException(status_code=404, detail="Question not found in this session.")
    return detail


@router.put("/sessions/{session_id}/notes", response_model=DiscoverySessionDetail)
def api_save_notes(session_id: str, request: SaveNotesRequest):
    _require_session(session_id)
    return persistence.save_notes(session_id, request.notes)


@router.post("/sessions/{session_id}/enrich", response_model=DiscoverySessionDetail)
async def api_enrich_session(session_id: str):
    _require_session(session_id)
    detail = persistence.get_session_detail(session_id)
    if not any(q.answer.strip() for q in detail.questions):
        raise HTTPException(status_code=400, detail="Answer at least one question before enriching.")
    try:
        result = await enrich_session(detail.questions, detail.notes)
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail=f"LLM provider error: {exc}")
    return persistence.save_enrichment(session_id, result.questions, result.enriched_notes)


@router.post("/sessions/{session_id}/export")
def api_export_session(session_id: str):
    _require_session(session_id)
    detail = persistence.get_session_detail(session_id)
    markdown = build_meeting_minutes_markdown(detail)
    return Response(
        content=markdown,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{_slug(detail.meta.name)}.md"'},
    )
