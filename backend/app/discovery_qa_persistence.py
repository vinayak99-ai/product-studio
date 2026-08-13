from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from datetime import datetime, timezone

from app.discovery_qa_models import DiscoveryQuestion, DiscoverySessionDetail, DiscoverySessionMeta

# Same file-based-persistence philosophy as every other tool in this
# backend (doc_qa_persistence.py's DATA_ROOT). Unlike Knowledge Base,
# there's no vector store involved here -- questions/answers/notes are
# small structured data, not something needing chunking or retrieval, so
# the whole session's content lives in one JSON file alongside its meta.
DATA_ROOT = Path.home() / "discovery-qa-data" / "sessions"


def _session_dir(session_id: str) -> Path:
    return DATA_ROOT / session_id


def _meta_path(session_id: str) -> Path:
    return _session_dir(session_id) / "meta.json"


def _content_path(session_id: str) -> Path:
    return _session_dir(session_id) / "content.json"


def _load_content(session_id: str) -> dict:
    path = _content_path(session_id)
    if not path.exists():
        return {"questions": [], "notes": "", "enriched_notes": ""}
    return json.loads(path.read_text())


def _save_content(session_id: str, questions: list[DiscoveryQuestion], notes: str, enriched_notes: str) -> None:
    _content_path(session_id).write_text(
        json.dumps(
            {"questions": [q.model_dump() for q in questions], "notes": notes, "enriched_notes": enriched_notes},
            indent=2,
        )
    )


def _recompute_counts(meta: DiscoverySessionMeta, questions: list[DiscoveryQuestion]) -> None:
    meta.question_count = len(questions)
    meta.answered_count = sum(1 for q in questions if q.answer.strip())


def create_session(
    name: str, source_project_id: str, source_project_name: str, questions: list[DiscoveryQuestion]
) -> DiscoverySessionMeta:
    session_id = f"disc_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()
    meta = DiscoverySessionMeta(
        id=session_id,
        name=name,
        source_project_id=source_project_id,
        source_project_name=source_project_name,
        created_at=now,
        updated_at=now,
    )
    _recompute_counts(meta, questions)

    _session_dir(session_id).mkdir(parents=True, exist_ok=True)
    _meta_path(session_id).write_text(meta.model_dump_json(indent=2))
    _save_content(session_id, questions, notes="", enriched_notes="")
    return meta


def list_sessions() -> list[DiscoverySessionMeta]:
    if not DATA_ROOT.exists():
        return []
    sessions = []
    for session_dir in DATA_ROOT.iterdir():
        meta_file = session_dir / "meta.json"
        if meta_file.exists():
            sessions.append(DiscoverySessionMeta.model_validate_json(meta_file.read_text()))
    return sorted(sessions, key=lambda s: s.updated_at, reverse=True)


def session_exists(session_id: str) -> bool:
    return _meta_path(session_id).exists()


def get_session_meta(session_id: str) -> DiscoverySessionMeta:
    return DiscoverySessionMeta.model_validate_json(_meta_path(session_id).read_text())


def get_session_detail(session_id: str) -> DiscoverySessionDetail:
    meta = get_session_meta(session_id)
    content = _load_content(session_id)
    return DiscoverySessionDetail(
        meta=meta,
        questions=[DiscoveryQuestion.model_validate(q) for q in content["questions"]],
        notes=content["notes"],
        enriched_notes=content["enriched_notes"],
    )


def rename_session(session_id: str, name: str) -> DiscoverySessionMeta:
    meta = get_session_meta(session_id)
    meta.name = name
    meta.updated_at = datetime.now(timezone.utc).isoformat()
    _meta_path(session_id).write_text(meta.model_dump_json(indent=2))
    return meta


def delete_session(session_id: str) -> None:
    shutil.rmtree(_session_dir(session_id), ignore_errors=True)


def _touch(meta: DiscoverySessionMeta) -> None:
    meta.updated_at = datetime.now(timezone.utc).isoformat()
    _meta_path(meta.id).write_text(meta.model_dump_json(indent=2))


def update_questions(session_id: str, questions: list[DiscoveryQuestion]) -> DiscoverySessionDetail:
    """Full replace -- covers add/edit/delete/reorder in one call. Resets
    is_enriched to False whenever the question set itself changes (an
    enriched_answer that no longer has a matching question, or a brand new
    question with none yet, both mean the enrichment is stale) -- but a
    question kept from before keeps whatever enriched_answer it already
    had, since editing the raw answer text doesn't happen through this
    endpoint (that's save_answer, below)."""
    content = _load_content(session_id)
    detail = get_session_detail(session_id)
    _save_content(session_id, questions, notes=detail.notes, enriched_notes=detail.enriched_notes)

    meta = get_session_meta(session_id)
    _recompute_counts(meta, questions)
    meta.is_enriched = bool(detail.enriched_notes) and all(
        q.enriched_answer and q.enriched_bullet for q in questions if q.answer
    )
    _touch(meta)
    return DiscoverySessionDetail(meta=meta, questions=questions, notes=content["notes"], enriched_notes=content["enriched_notes"])


def save_answer(session_id: str, question_id: str, answer: str) -> DiscoverySessionDetail:
    detail = get_session_detail(session_id)
    for q in detail.questions:
        if q.id == question_id:
            q.answer = answer
            q.enriched_answer = ""  # stale once the raw answer it was built from changes
            q.enriched_bullet = ""
    _save_content(session_id, detail.questions, detail.notes, detail.enriched_notes)

    meta = detail.meta
    _recompute_counts(meta, detail.questions)
    meta.is_enriched = False
    _touch(meta)
    detail.meta = meta
    return detail


def save_notes(session_id: str, notes: str) -> DiscoverySessionDetail:
    detail = get_session_detail(session_id)
    _save_content(session_id, detail.questions, notes, enriched_notes="")

    meta = detail.meta
    meta.is_enriched = False
    _touch(meta)
    detail.meta = meta
    detail.notes = notes
    detail.enriched_notes = ""
    return detail


def save_enrichment(session_id: str, questions: list[DiscoveryQuestion], enriched_notes: str) -> DiscoverySessionDetail:
    detail = get_session_detail(session_id)
    _save_content(session_id, questions, detail.notes, enriched_notes)

    meta = detail.meta
    _recompute_counts(meta, questions)
    meta.is_enriched = True
    _touch(meta)
    return DiscoverySessionDetail(meta=meta, questions=questions, notes=detail.notes, enriched_notes=enriched_notes)
