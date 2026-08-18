from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from datetime import datetime, timezone
from typing import NamedTuple

from app.deep_analysis_models import (
    AnsweredClarification,
    ArtifactVersionMeta,
    ClarifyQuestion,
    DeepAnalysisDocument,
    DeepAnalysisInput,
    ExtractedProblem,
    ProjectMeta,
)

DATA_ROOT = Path.home() / "deep-analysis-data" / "projects"


class PendingClarification(NamedTuple):
    raw_notes: str
    extracted: ExtractedProblem
    questions: list[ClarifyQuestion]  # current round, unanswered
    history: list[AnsweredClarification]  # prior rounds, answered
    round: int
    # Which artifact a completed clarification round should save into --
    # None/"generated" for a brand-new project's first-ever artifact, or an
    # existing artifact_id/"regenerated from updated input" so a
    # regenerate-triggered round lands as a new VERSION of the existing
    # document rather than an unrelated second one.
    target_artifact_id: str | None
    reason: str


def _project_dir(project_id: str) -> Path:
    return DATA_ROOT / project_id


def create_project(name: str) -> ProjectMeta:
    project_id = f"deepan_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()
    meta = ProjectMeta(id=project_id, name=name, created_at=now, updated_at=now)

    (_project_dir(project_id) / "artifacts").mkdir(parents=True, exist_ok=True)
    (_project_dir(project_id) / "meta.json").write_text(meta.model_dump_json(indent=2), encoding="utf-8")
    return meta


def list_projects() -> list[ProjectMeta]:
    if not DATA_ROOT.exists():
        return []
    projects = []
    for proj_dir in DATA_ROOT.iterdir():
        meta_file = proj_dir / "meta.json"
        if meta_file.exists():
            projects.append(ProjectMeta.model_validate_json(meta_file.read_text(encoding="utf-8")))
    return sorted(projects, key=lambda p: p.updated_at, reverse=True)


def get_project(project_id: str) -> ProjectMeta:
    return ProjectMeta.model_validate_json((_project_dir(project_id) / "meta.json").read_text(encoding="utf-8"))


def rename_project(project_id: str, name: str) -> ProjectMeta:
    meta = get_project(project_id)
    meta.name = name
    meta.updated_at = datetime.now(timezone.utc).isoformat()
    (_project_dir(project_id) / "meta.json").write_text(meta.model_dump_json(indent=2), encoding="utf-8")
    return meta


def delete_project(project_id: str) -> None:
    shutil.rmtree(_project_dir(project_id), ignore_errors=True)


def _touch_project(project_id: str) -> None:
    meta = get_project(project_id)
    meta.updated_at = datetime.now(timezone.utc).isoformat()
    (_project_dir(project_id) / "meta.json").write_text(meta.model_dump_json(indent=2), encoding="utf-8")


def mark_generated(project_id: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    meta = get_project(project_id)
    meta.last_generated_at = now
    meta.updated_at = now
    (_project_dir(project_id) / "meta.json").write_text(meta.model_dump_json(indent=2), encoding="utf-8")


# ---------- Input (raw notes + accumulated clarification transcript) ----------


def _input_path(project_id: str) -> Path:
    return _project_dir(project_id) / "input.json"


def load_input(project_id: str) -> DeepAnalysisInput:
    path = _input_path(project_id)
    if not path.exists():
        return DeepAnalysisInput()
    return DeepAnalysisInput.model_validate_json(path.read_text(encoding="utf-8"))


def save_input_notes(project_id: str, raw_notes: str) -> DeepAnalysisInput:
    current = load_input(project_id)
    current.raw_notes = raw_notes
    now = datetime.now(timezone.utc).isoformat()
    current.updated_at = now
    _input_path(project_id).write_text(current.model_dump_json(indent=2), encoding="utf-8")

    meta = get_project(project_id)
    meta.input_updated_at = now
    meta.updated_at = now
    (_project_dir(project_id) / "meta.json").write_text(meta.model_dump_json(indent=2), encoding="utf-8")
    return current


def append_input_clarifications(project_id: str, answered: list[AnsweredClarification]) -> None:
    """Called once per completed clarification round, whether or not that
    round is the last one -- so the full Q&A transcript survives even
    though pending_clarification.json gets cleared once synthesis succeeds."""
    current = load_input(project_id)
    current.clarifications += [a.model_dump() for a in answered]
    _input_path(project_id).write_text(current.model_dump_json(indent=2), encoding="utf-8")


# ---------- Pending clarification round (single file, overwritten per round) ----------


def save_pending_clarification(
    project_id: str,
    raw_notes: str,
    extracted: ExtractedProblem,
    questions: list[ClarifyQuestion],
    history: list[AnsweredClarification],
    round_num: int,
    target_artifact_id: str | None = None,
    reason: str = "generated",
) -> None:
    data = {
        "raw_notes": raw_notes,
        "extracted": extracted.model_dump(),
        "questions": [q.model_dump() for q in questions],
        "history": [h.model_dump() for h in history],
        "round": round_num,
        "target_artifact_id": target_artifact_id,
        "reason": reason,
    }
    (_project_dir(project_id) / "pending_clarification.json").write_text(json.dumps(data, indent=2), encoding="utf-8")


def load_pending_clarification(project_id: str) -> PendingClarification | None:
    path = _project_dir(project_id) / "pending_clarification.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    return PendingClarification(
        raw_notes=data["raw_notes"],
        extracted=ExtractedProblem.model_validate(data["extracted"]),
        questions=[ClarifyQuestion.model_validate(q) for q in data["questions"]],
        history=[AnsweredClarification.model_validate(h) for h in data.get("history", [])],
        round=data.get("round", 1),
        target_artifact_id=data.get("target_artifact_id"),
        reason=data.get("reason", "generated"),
    )


def clear_pending_clarification(project_id: str) -> None:
    (_project_dir(project_id) / "pending_clarification.json").unlink(missing_ok=True)


# ---------- Versioned artifacts (the generated DeepAnalysisDocument) ----------


def _versions_dir(project_id: str, artifact_id: str) -> Path:
    return _project_dir(project_id) / "artifacts" / f"{artifact_id}_versions"


def save_artifact(
    project_id: str, document: DeepAnalysisDocument, artifact_id: str | None = None, reason: str = "update"
) -> str:
    artifact_id = artifact_id or f"doc_{uuid.uuid4().hex[:8]}"
    artifacts_dir = _project_dir(project_id) / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    (artifacts_dir / f"{artifact_id}.json").write_text(document.model_dump_json(indent=2), encoding="utf-8")

    versions_dir = _versions_dir(project_id, artifact_id)
    versions_dir.mkdir(parents=True, exist_ok=True)
    new_content = document.model_dump()
    existing = sorted(versions_dir.glob("v*.json"))
    if existing:
        latest = json.loads(existing[-1].read_text(encoding="utf-8"))
        if latest["document"] == new_content:
            _touch_project(project_id)
            return artifact_id
        next_version = latest["version"] + 1
    else:
        next_version = 1
    snapshot = {
        "version": next_version,
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "reason": reason,
        "document": new_content,
    }
    (versions_dir / f"v{next_version:04d}.json").write_text(json.dumps(snapshot, indent=2), encoding="utf-8")

    _touch_project(project_id)
    return artifact_id


def load_artifact(project_id: str, artifact_id: str) -> DeepAnalysisDocument:
    path = _project_dir(project_id) / "artifacts" / f"{artifact_id}.json"
    return DeepAnalysisDocument.model_validate_json(path.read_text(encoding="utf-8"))


def list_artifacts(project_id: str) -> list[str]:
    artifacts_dir = _project_dir(project_id) / "artifacts"
    if not artifacts_dir.exists():
        return []
    return [f.stem for f in artifacts_dir.glob("*.json")]


def delete_artifact(project_id: str, artifact_id: str) -> None:
    (_project_dir(project_id) / "artifacts" / f"{artifact_id}.json").unlink(missing_ok=True)
    shutil.rmtree(_versions_dir(project_id, artifact_id), ignore_errors=True)


def list_artifact_versions(project_id: str, artifact_id: str) -> list[ArtifactVersionMeta]:
    versions_dir = _versions_dir(project_id, artifact_id)
    if not versions_dir.exists():
        return []
    metas = []
    for f in sorted(versions_dir.glob("v*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        metas.append(ArtifactVersionMeta(version=data["version"], saved_at=data["saved_at"], reason=data["reason"]))
    return metas


def load_artifact_version(project_id: str, artifact_id: str, version: int) -> DeepAnalysisDocument:
    path = _versions_dir(project_id, artifact_id) / f"v{version:04d}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return DeepAnalysisDocument.model_validate(data["document"])
