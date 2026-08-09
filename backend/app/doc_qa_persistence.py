from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from datetime import datetime, timezone

from app.doc_qa_models import ChatMessage, DocQaProjectMeta

DATA_ROOT = Path.home() / "doc-qa-data" / "projects"


def _project_dir(project_id: str) -> Path:
    return DATA_ROOT / project_id


def _meta_path(project_id: str) -> Path:
    return _project_dir(project_id) / "meta.json"


def create_project(name: str) -> DocQaProjectMeta:
    project_id = f"docqa_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()
    meta = DocQaProjectMeta(id=project_id, name=name, created_at=now, updated_at=now)

    _project_dir(project_id).mkdir(parents=True, exist_ok=True)
    _meta_path(project_id).write_text(meta.model_dump_json(indent=2))
    return meta


def list_projects() -> list[DocQaProjectMeta]:
    if not DATA_ROOT.exists():
        return []
    projects = []
    for proj_dir in DATA_ROOT.iterdir():
        meta_file = proj_dir / "meta.json"
        if meta_file.exists():
            projects.append(DocQaProjectMeta.model_validate_json(meta_file.read_text()))
    return sorted(projects, key=lambda p: p.updated_at, reverse=True)


def get_project(project_id: str) -> DocQaProjectMeta:
    return DocQaProjectMeta.model_validate_json(_meta_path(project_id).read_text())


def rename_project(project_id: str, name: str) -> DocQaProjectMeta:
    meta = get_project(project_id)
    meta.name = name
    meta.updated_at = datetime.now(timezone.utc).isoformat()
    _meta_path(project_id).write_text(meta.model_dump_json(indent=2))
    return meta


def delete_project(project_id: str) -> None:
    shutil.rmtree(_project_dir(project_id), ignore_errors=True)


def _touch(meta: DocQaProjectMeta) -> None:
    meta.updated_at = datetime.now(timezone.utc).isoformat()
    _meta_path(meta.id).write_text(meta.model_dump_json(indent=2))


def save_document(project_id: str, filename: str, text: str) -> DocQaProjectMeta:
    """Replacing the document invalidates the summary and chat -- both were
    grounded in the old text, so keeping them around would silently answer
    from a document that's no longer there."""
    (_project_dir(project_id) / "document.txt").write_text(text)
    _summary_path(project_id).unlink(missing_ok=True)
    _chat_path(project_id).unlink(missing_ok=True)

    meta = get_project(project_id)
    meta.filename = filename
    meta.has_summary = False
    meta.message_count = 0
    _touch(meta)
    return meta


def load_document(project_id: str) -> str | None:
    path = _project_dir(project_id) / "document.txt"
    return path.read_text() if path.exists() else None


def _summary_path(project_id: str) -> Path:
    return _project_dir(project_id) / "summary.txt"


def save_summary(project_id: str, summary: str) -> DocQaProjectMeta:
    _summary_path(project_id).write_text(summary)
    meta = get_project(project_id)
    meta.has_summary = True
    _touch(meta)
    return meta


def load_summary(project_id: str) -> str | None:
    path = _summary_path(project_id)
    return path.read_text() if path.exists() else None


def _chat_path(project_id: str) -> Path:
    return _project_dir(project_id) / "chat.json"


def load_chat(project_id: str) -> list[ChatMessage]:
    path = _chat_path(project_id)
    if not path.exists():
        return []
    data = json.loads(path.read_text())
    return [ChatMessage.model_validate(m) for m in data]


def append_chat_messages(project_id: str, messages: list[ChatMessage]) -> list[ChatMessage]:
    chat = load_chat(project_id) + messages
    _chat_path(project_id).write_text(json.dumps([m.model_dump() for m in chat], indent=2))

    meta = get_project(project_id)
    meta.message_count = len(chat)
    _touch(meta)
    return chat
