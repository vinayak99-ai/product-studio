from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from datetime import datetime, timezone
from typing import Literal, NamedTuple
from pydantic import BaseModel, Field

DATA_ROOT = Path.home() / "pm-portal-data" / "projects"

class ProjectMeta(BaseModel):
    id: str
    name: str
    created_at: str
    updated_at: str
    # When the project's input (raw notes) and its most recently generated
    # spec last changed -- None until each has happened at least once. The UI
    # compares these to show "input changed since this spec was generated"
    # without needing full version history on the input side.
    input_updated_at: str | None = None
    last_generated_at: str | None = None

class Stakeholder(BaseModel):
    id: str = Field(description="e.g. 'SH-1', assigned in Python")
    name: str
    role: str
    audience: Literal["executive", "engineering", "sales"]
    influence: Literal["high", "medium", "low"] = "medium"
    interest: Literal["high", "medium", "low"] = "medium"
    cares_about: str = ""

class GlossaryTerm(BaseModel):
    id: str = Field(description="e.g. 'GT-1', assigned in Python")
    term: str
    definition: str

class SpecInput(BaseModel):
    """The editable source that drives generation, kept separate from the
    generated spec (GeneratedPRD) so a PM can revise the input and ask the
    agents to redraft, instead of the input being a write-once artifact.
    `clarifications` is untyped dicts (not AnsweredClarification) to avoid a
    circular import with agents.py, which itself imports from this module --
    callers that need typed access go through the AnsweredClarification
    model themselves, same as PendingClarification.extracted/history below.
    It's append-only across regenerations: kept as reference context (shown
    to the PM, passed to the Clarify Agent, which already skips repeating
    answered questions) rather than assumed still valid."""
    raw_notes: str = ""
    clarifications: list[dict] = Field(default_factory=list)
    updated_at: str = ""

class PendingClarification(NamedTuple):
    raw_notes: str
    extracted: object  # ExtractedRequirements
    questions: list    # list[ClarifyQuestion] -- current round, unanswered
    history: list       # list[AnsweredClarification] -- prior rounds, answered
    round: int
    # Which artifact a completed clarification round should save into, and
    # why -- None/"generated" for a brand-new project (first-ever artifact),
    # or an existing artifact_id/"regenerated from updated input" so a
    # regenerate-triggered clarification round lands as a new VERSION of the
    # existing spec rather than an unrelated second one.
    target_artifact_id: str | None
    reason: str
    # Which pipeline step this clarification round belongs to (StepId, e.g.
    # "overview" or "architecture") -- kept as plain str here, not the
    # StepId type itself, to avoid importing pipeline_agents.py at module
    # level (pipeline_agents imports agents, which imports this module --
    # see load_pending_clarification for the typed deferred import).
    step: str

def _project_dir(project_id: str) -> Path:
    return DATA_ROOT / project_id

def create_project(name: str) -> ProjectMeta:
    project_id = f"proj_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()
    meta = ProjectMeta(id=project_id, name=name, created_at=now, updated_at=now)

    proj_dir = _project_dir(project_id)
    (proj_dir / "artifacts").mkdir(parents=True, exist_ok=True)
    (proj_dir / "raw_inputs").mkdir(exist_ok=True)

    with open(proj_dir / "meta.json", "w", encoding="utf-8") as f:
        f.write(meta.model_dump_json(indent=2))

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
    meta_file = _project_dir(project_id) / "meta.json"
    return ProjectMeta.model_validate_json(meta_file.read_text(encoding="utf-8"))

def rename_project(project_id: str, name: str) -> ProjectMeta:
    meta = get_project(project_id)
    meta.name = name
    meta.updated_at = datetime.now(timezone.utc).isoformat()
    (_project_dir(project_id) / "meta.json").write_text(meta.model_dump_json(indent=2), encoding="utf-8")
    return meta

def delete_project(project_id: str) -> None:
    shutil.rmtree(_project_dir(project_id), ignore_errors=True)

def load_stakeholders(project_id: str) -> list[Stakeholder]:
    path = _project_dir(project_id) / "stakeholders.json"
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return [Stakeholder.model_validate(s) for s in data]

def save_stakeholders(project_id: str, stakeholders: list[Stakeholder]) -> None:
    path = _project_dir(project_id) / "stakeholders.json"
    path.write_text(json.dumps([s.model_dump() for s in stakeholders], indent=2), encoding="utf-8")

def load_glossary(project_id: str) -> list[GlossaryTerm]:
    path = _project_dir(project_id) / "glossary.json"
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return [GlossaryTerm.model_validate(t) for t in data]

def save_glossary(project_id: str, terms: list[GlossaryTerm]) -> None:
    path = _project_dir(project_id) / "glossary.json"
    path.write_text(json.dumps([t.model_dump() for t in terms], indent=2), encoding="utf-8")

class ArtifactVersionMeta(BaseModel):
    version: int
    saved_at: str
    reason: str
    # Step ids (StepId, kept as plain str -- see PendingClarification.step)
    # marked "stale" as a downstream consequence of THIS version's change,
    # per the scope-check agent's verdict. Empty for versions that didn't
    # cascade anything (including every version saved before this field
    # existed).
    cascaded_to: list[str] = Field(default_factory=list)

def _versions_dir(project_id: str, artifact_id: str) -> Path:
    return _project_dir(project_id) / "artifacts" / f"{artifact_id}_versions"

def save_artifact(
    project_id: str,
    prd,
    artifact_id: str = None,
    reason: str = "update",
    cascaded_to: list[str] | None = None,
) -> str:
    artifact_id = artifact_id or f"prd_{uuid.uuid4().hex[:8]}"
    artifacts_dir = _project_dir(project_id) / "artifacts"

    with open(artifacts_dir / f"{artifact_id}.json", "w", encoding="utf-8") as f:
        f.write(prd.model_dump_json(indent=2))

    # Version snapshot: every save that actually changed content appends an
    # immutable copy, so "what changed since the exec review" always has an
    # answer. Identical re-saves are deduped to keep the timeline meaningful.
    versions_dir = _versions_dir(project_id, artifact_id)
    versions_dir.mkdir(parents=True, exist_ok=True)
    new_content = prd.model_dump()
    existing = sorted(versions_dir.glob("v*.json"))
    if existing:
        latest = json.loads(existing[-1].read_text(encoding="utf-8"))
        if latest["prd"] == new_content:
            _touch_project(project_id)
            return artifact_id
        next_version = latest["version"] + 1
    else:
        next_version = 1
    snapshot = {
        "version": next_version,
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "reason": reason,
        "cascaded_to": cascaded_to or [],
        "prd": new_content,
    }
    (versions_dir / f"v{next_version:04d}.json").write_text(json.dumps(snapshot, indent=2), encoding="utf-8")

    _touch_project(project_id)
    return artifact_id

def load_artifact(project_id: str, artifact_id: str):
    from .agents import GeneratedPRD
    path = _project_dir(project_id) / "artifacts" / f"{artifact_id}.json"
    return GeneratedPRD.model_validate_json(path.read_text(encoding="utf-8"))

def list_artifact_versions(project_id: str, artifact_id: str) -> list[ArtifactVersionMeta]:
    versions_dir = _versions_dir(project_id, artifact_id)
    if not versions_dir.exists():
        return []
    metas = []
    for f in sorted(versions_dir.glob("v*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        metas.append(ArtifactVersionMeta(
            version=data["version"],
            saved_at=data["saved_at"],
            reason=data["reason"],
            cascaded_to=data.get("cascaded_to", []),
        ))
    return metas

def load_artifact_version(project_id: str, artifact_id: str, version: int):
    from .agents import GeneratedPRD
    path = _versions_dir(project_id, artifact_id) / f"v{version:04d}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return GeneratedPRD.model_validate(data["prd"])

def list_artifacts(project_id: str) -> list[str]:
    artifacts_dir = _project_dir(project_id) / "artifacts"
    if not artifacts_dir.exists():
        return []
    return [f.stem for f in artifacts_dir.glob("*.json")]

def delete_artifact(project_id: str, artifact_id: str):
    path = _project_dir(project_id) / "artifacts" / f"{artifact_id}.json"
    path.unlink(missing_ok=True)
    shutil.rmtree(_versions_dir(project_id, artifact_id), ignore_errors=True)

def save_raw_input(project_id: str, text: str) -> str:
    input_id = f"input_{uuid.uuid4().hex[:8]}"
    path = _project_dir(project_id) / "raw_inputs" / f"{input_id}.txt"
    path.write_text(text, encoding="utf-8")
    return input_id

def _input_path(project_id: str) -> Path:
    return _project_dir(project_id) / "input.json"

def load_input(project_id: str) -> SpecInput:
    path = _input_path(project_id)
    if not path.exists():
        return SpecInput()
    return SpecInput.model_validate_json(path.read_text(encoding="utf-8"))

def save_input_notes(project_id: str, raw_notes: str) -> SpecInput:
    """Updates just raw_notes -- the only field a PM edits directly;
    clarifications accumulate only through append_input_clarifications."""
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

def append_input_clarifications(project_id: str, answered) -> None:
    """answered: list[AnsweredClarification]. Called once per completed
    clarification round (from /clarify), whether or not that round is the
    last one -- so the Q&A history is never lost, unlike
    pending_clarification.json which gets cleared once generation
    succeeds."""
    current = load_input(project_id)
    current.clarifications += [a.model_dump() for a in answered]
    _input_path(project_id).write_text(current.model_dump_json(indent=2), encoding="utf-8")

def mark_generated(project_id: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    meta = get_project(project_id)
    meta.last_generated_at = now
    meta.updated_at = now
    (_project_dir(project_id) / "meta.json").write_text(meta.model_dump_json(indent=2), encoding="utf-8")

def save_pending_clarification(
    project_id: str, raw_notes: str, extracted, questions, history, round_num: int,
    target_artifact_id: str | None = None, reason: str = "generated",
    step: str = "overview",
) -> None:
    data = {
        "raw_notes": raw_notes,
        "extracted": extracted.model_dump(),
        "questions": [q.model_dump() for q in questions],
        "history": [h.model_dump() for h in history],
        "round": round_num,
        "target_artifact_id": target_artifact_id,
        "reason": reason,
        "step": step,
    }
    path = _project_dir(project_id) / "pending_clarification.json"
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")

def load_pending_clarification(project_id: str) -> PendingClarification | None:
    from .agents import ExtractedRequirements, ClarifyQuestion, AnsweredClarification

    path = _project_dir(project_id) / "pending_clarification.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    extracted = ExtractedRequirements.model_validate(data["extracted"])
    questions = [ClarifyQuestion.model_validate(q) for q in data["questions"]]
    history = [AnsweredClarification.model_validate(h) for h in data.get("history", [])]
    return PendingClarification(
        raw_notes=data["raw_notes"],
        extracted=extracted,
        questions=questions,
        history=history,
        round=data.get("round", 1),
        target_artifact_id=data.get("target_artifact_id"),
        reason=data.get("reason", "generated"),
        step=data.get("step", "overview"),
    )

def clear_pending_clarification(project_id: str) -> None:
    path = _project_dir(project_id) / "pending_clarification.json"
    path.unlink(missing_ok=True)

def _touch_project(project_id: str):
    meta = get_project(project_id)
    meta.updated_at = datetime.now(timezone.utc).isoformat()
    meta_file = _project_dir(project_id) / "meta.json"
    meta_file.write_text(meta.model_dump_json(indent=2), encoding="utf-8")
