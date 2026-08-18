from __future__ import annotations

from pathlib import Path
from datetime import datetime, timezone
from typing import Callable, Literal
import tempfile
import os

from dotenv import load_dotenv

# Load OPENAI_API_KEY / LLM_PROVIDER / CORPORATE_LLM_* (and any other vars)
# from backend/.env -- the same file Product Studio's own app/config.py reads --
# before app.llm_client constructs its provider, which reads these at
# call time via app.config.get_settings(). override=True so .env is
# authoritative -- otherwise python-dotenv's default (override=False) means
# a stale OS/user-level env var of the same name silently wins over
# whatever is actually written there.
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env", override=True)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAIError
from pydantic import BaseModel

from . import jira_client
from .persistence import (
    create_project, list_projects, get_project, rename_project, delete_project,
    save_artifact, load_artifact, list_artifacts, delete_artifact,
    list_artifact_versions, load_artifact_version,
    save_raw_input, save_pending_clarification, load_pending_clarification,
    clear_pending_clarification, load_stakeholders, save_stakeholders,
    load_glossary, save_glossary,
    load_input, save_input_notes, append_input_clarifications, mark_generated,
    ProjectMeta, Stakeholder, GlossaryTerm, SpecInput
)
from .agents import (
    run_extraction, run_clarify, run_diagram,
    run_overview, run_stories, run_requirements, run_test_cases,
    run_architecture, run_architecture_clarify,
    run_epics, run_jira_import, run_brief, run_update_composer,
    run_scope_check, run_completeness_review,
    ExtractedRequirements, ClarifyQuestion, AnsweredClarification, GeneratedPRD,
    OverviewResult, StoriesResult, RequirementsResult, ComposedUpdate,
    ROUND_SIZE, MAX_ROUNDS, MAX_TOTAL_QUESTIONS,
)
from .pipeline_agents import STEP_ORDER, StepId, StepState, ScopeCheckVerdict
from .diffing import diff_prds
from .export import (
    export_to_markdown, export_to_docx, export_stories_to_csv, export_epics_to_csv,
    export_brief_to_markdown, export_brief_to_docx,
    export_update_to_markdown, export_update_to_docx,
)

app = FastAPI(title="PM Portal API")

app.add_middleware(
    CORSMiddleware,
    # This app is mounted at /pm on Product Studio's own backend (see
    # backend/app/main.py's app.mount("/pm", spec_builder_app)) and its
    # routes are called directly by Product Studio's frontend (port 5173) -- both
    # localhost and 127.0.0.1 variants,
    # since browsers treat those as different origins for CORS. 3000/5174
    # kept so this still works if ever run standalone again.
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

class CreateProjectRequest(BaseModel):
    name: str

class RenameProjectRequest(BaseModel):
    name: str

class OverviewGenerateRequest(BaseModel):
    raw_notes: str

class InputRequest(BaseModel):
    raw_notes: str

class StepClarifyAnswersRequest(BaseModel):
    answers: dict[str, str]

class StepGenerateResponse(BaseModel):
    status: Literal["needs_clarification", "drafted"]
    questions: list[ClarifyQuestion] = []
    artifact_id: str | None = None
    prd: GeneratedPRD | None = None

class StepEditRequest(BaseModel):
    """Only the fields STEP_FIELDS[step] declares are read from `prd` --
    anything else the client sends is ignored, so editing one step can never
    smuggle in a change to another step's section."""
    prd: GeneratedPRD

class StepEditResponse(BaseModel):
    prd: GeneratedPRD
    scope_check: ScopeCheckVerdict | None = None
    cascaded_to: list[str] = []

class DiagramRequest(BaseModel):
    diagram_type: Literal["journey", "sequence"]

class DiagramPngRequest(BaseModel):
    png_base64: str

class JiraPushResult(BaseModel):
    id: str
    item_type: Literal["epic", "story"]
    status: Literal["created", "skipped", "error"]
    jira_key: str | None = None
    detail: str | None = None

class JiraExportResponse(BaseModel):
    prd: GeneratedPRD
    results: list[JiraPushResult]

class JiraImportResponse(BaseModel):
    prd: GeneratedPRD
    unmapped_requirements: list[str]

class JiraSyncResponse(BaseModel):
    prd: GeneratedPRD
    updated: int
    unchanged: int

class StakeholdersRequest(BaseModel):
    stakeholders: list[Stakeholder]

class GlossaryRequest(BaseModel):
    terms: list[GlossaryTerm]

class BriefRequest(BaseModel):
    audience: Literal["executive", "engineering", "sales"]

class ComposeUpdateRequest(BaseModel):
    from_version: int
    audience: Literal["all", "executive", "engineering", "sales"] = "all"

def _agent_error_detail(exc: Exception) -> str:
    status_code = getattr(exc, "status_code", None)
    if status_code is not None:
        return f"LLM provider error ({status_code}): {exc}"
    return f"LLM provider error: {exc}"

# Current pipeline stage per project, so the UI can show live progress while
# its (synchronous) generate/clarify request is in flight. In-memory is fine
# here: single-user local app, and a stale entry can't outlive a request
# because every writer clears it in a finally block.
_generation_progress: dict[str, str] = {}

def _set_stage(project_id: str, stage: str) -> None:
    _generation_progress[project_id] = stage

# ---------- Pipeline step plumbing ----------
# STEP_FIELDS names exactly which GeneratedPRD fields each step owns --
# the single source of truth for both the /edit endpoint's field-level
# isolation and the generic PUT artifacts endpoint's confirmed-step guard.

STEP_FIELDS: dict[StepId, list[str]] = {
    "overview": ["problem_statement", "goals", "target_users", "open_questions", "personas", "use_cases"],
    "stories": ["user_stories", "edge_cases"],
    "requirements": ["functional_requirements", "key_entities", "assumptions"],
    "test_cases": ["test_cases"],
    "architecture": ["architecture_decisions"],
    "epics": ["epics"],
}

# The diff_prds() section labels that belong to each step, used to scope a
# structured diff down to only the sections a given step's edit could have
# touched (diff_prds diffs the whole PRD; STEP_FIELDS already guarantees
# only this step's fields could differ, but this keeps the scope-check
# prompt's diff block free of unrelated noise).
STEP_SECTIONS: dict[StepId, set[str]] = {
    "overview": {"Title"},
    "stories": {"User stories", "Edge cases"},
    "requirements": {"Functional requirements", "Key entities", "Assumptions"},
    "test_cases": {"Test cases"},
    "architecture": {"Architecture decisions"},
    "epics": {"Epics", "Stories"},
}

def _load_or_new_prd(project_id: str, artifact_id: str | None) -> GeneratedPRD:
    if artifact_id:
        try:
            return load_artifact(project_id, artifact_id)
        except FileNotFoundError:
            pass
    meta = get_project(project_id)
    return GeneratedPRD(title=meta.name)

def _apply_overview(prd: GeneratedPRD, overview: OverviewResult) -> None:
    prd.problem_statement = overview.problem_statement
    prd.goals = overview.goals
    prd.target_users = overview.target_users
    prd.open_questions = overview.open_questions
    prd.personas = overview.personas
    prd.use_cases = overview.use_cases

def _run_step_stories(prd: GeneratedPRD) -> None:
    overview = OverviewResult(
        problem_statement=prd.problem_statement, goals=prd.goals,
        target_users=prd.target_users, open_questions=prd.open_questions,
        personas=prd.personas, use_cases=prd.use_cases,
    )
    result = run_stories(overview)
    prd.user_stories = result.user_stories
    prd.edge_cases = result.edge_cases

def _run_step_requirements(prd: GeneratedPRD) -> None:
    overview = OverviewResult(
        problem_statement=prd.problem_statement, goals=prd.goals,
        target_users=prd.target_users, open_questions=prd.open_questions,
        personas=prd.personas, use_cases=prd.use_cases,
    )
    stories = StoriesResult(user_stories=prd.user_stories, edge_cases=prd.edge_cases)
    result = run_requirements(overview, stories)
    prd.functional_requirements = result.functional_requirements
    prd.key_entities = result.key_entities
    prd.assumptions = result.assumptions

def _run_step_test_cases(prd: GeneratedPRD) -> None:
    requirements = RequirementsResult(
        functional_requirements=prd.functional_requirements,
        key_entities=prd.key_entities, assumptions=prd.assumptions,
    )
    result = run_test_cases(requirements)
    prd.test_cases = result.test_cases

def _run_step_epics(prd: GeneratedPRD) -> None:
    prd.epics = run_epics(prd)

# Runners for the four steps that are plain "confirm upstream, generate
# downstream" -- overview (needs raw notes + its own clarify flow) and
# architecture (needs its own interactive clarify + finalize flow) each get
# dedicated routes below instead.
_STEP_RUNNERS: dict[str, Callable[[GeneratedPRD], None]] = {
    "stories": _run_step_stories,
    "requirements": _run_step_requirements,
    "test_cases": _run_step_test_cases,
    "epics": _run_step_epics,
}

def _require_step_generatable(prd: GeneratedPRD, step: StepId) -> None:
    idx = STEP_ORDER.index(step)
    for prior in STEP_ORDER[:idx]:
        if prd.pipeline.steps.get(prior, StepState()).status != "confirmed":
            raise HTTPException(
                status_code=400,
                detail=f"Step '{prior}' must be confirmed before '{step}' can be generated.",
            )
    current_status = prd.pipeline.steps.get(step, StepState()).status
    if current_status not in ("not_started", "needs_clarification"):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Step '{step}' is '{current_status}' -- use /revisit to regenerate a "
                "stale step, or /edit to change a confirmed one."
            ),
        )

def _next_version_number(project_id: str, artifact_id: str) -> int:
    versions = list_artifact_versions(project_id, artifact_id)
    return (versions[-1].version + 1) if versions else 1

@app.post("/projects", response_model=ProjectMeta)
def api_create_project(req: CreateProjectRequest):
    return create_project(req.name)

class ProjectSummary(BaseModel):
    stage: Literal["empty", "clarifying", "in_progress", "complete"]
    current_step: StepId | None = None
    pending_questions: int = 0
    epic_count: int = 0
    high_impact_epics: int = 0
    proposed_adrs: int = 0
    in_jira: bool = False
    last_version_reason: str | None = None


class ProjectListItem(ProjectMeta):
    summary: ProjectSummary


def _summarize_project(project_id: str) -> ProjectSummary:
    """Cheap per-project status for the project-list cards, so a PM can see
    what needs them without opening each project."""
    pending = load_pending_clarification(project_id)
    if pending is not None:
        return ProjectSummary(stage="clarifying", pending_questions=len(pending.questions))
    artifact_ids = list_artifacts(project_id)
    if not artifact_ids:
        return ProjectSummary(stage="empty")
    try:
        prd = load_artifact(project_id, artifact_ids[0])
    except Exception:
        return ProjectSummary(stage="empty")
    versions = list_artifact_versions(project_id, artifact_ids[0])
    all_confirmed = all(
        prd.pipeline.steps.get(s, StepState()).status == "confirmed" for s in STEP_ORDER
    )
    return ProjectSummary(
        stage="complete" if all_confirmed else "in_progress",
        current_step=prd.pipeline.current_step,
        epic_count=len(prd.epics),
        high_impact_epics=sum(1 for e in prd.epics if e.business_impact == "high"),
        proposed_adrs=sum(1 for d in prd.architecture_decisions if d.status == "proposed"),
        in_jira=any(e.jira_key or any(s.jira_key for s in e.stories) for e in prd.epics),
        last_version_reason=versions[-1].reason if versions else None,
    )


@app.get("/projects", response_model=list[ProjectListItem])
def api_list_projects():
    return [
        ProjectListItem(**meta.model_dump(), summary=_summarize_project(meta.id))
        for meta in list_projects()
    ]

@app.get("/projects/{project_id}", response_model=ProjectMeta)
def api_get_project(project_id: str):
    try:
        return get_project(project_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Project not found")

@app.put("/projects/{project_id}", response_model=ProjectMeta)
def api_rename_project(project_id: str, req: RenameProjectRequest):
    try:
        return rename_project(project_id, req.name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Project not found")

@app.delete("/projects/{project_id}")
def api_delete_project(project_id: str):
    delete_project(project_id)
    return {"status": "deleted"}

@app.get("/projects/{project_id}/stakeholders")
def api_get_stakeholders(project_id: str):
    return {"stakeholders": load_stakeholders(project_id)}

@app.put("/projects/{project_id}/stakeholders")
def api_save_stakeholders(project_id: str, req: StakeholdersRequest):
    save_stakeholders(project_id, req.stakeholders)
    return {"stakeholders": req.stakeholders}

@app.get("/projects/{project_id}/glossary")
def api_get_glossary(project_id: str):
    return {"terms": load_glossary(project_id)}

@app.put("/projects/{project_id}/glossary")
def api_save_glossary(project_id: str, req: GlossaryRequest):
    save_glossary(project_id, req.terms)
    return {"terms": req.terms}

# ---------- Step 1: Overview (raw notes -> extraction -> clarify -> draft) ----------

def _start_overview_generation(
    project_id: str, raw_notes: str, target_artifact_id: str | None, reason: str
) -> StepGenerateResponse:
    """Runs extraction -> clarify -> Overview draft. Shared by
    /steps/overview/generate (fresh raw_notes, no target artifact -- a
    brand-new one gets created) and /regenerate (raw_notes read from the
    project's persisted input, target_artifact_id set so the result lands
    as a new VERSION of the existing artifact)."""
    try:
        _set_stage(project_id, "extracting")
        try:
            extracted = run_extraction(raw_notes)
            _set_stage(project_id, "clarifying")
            clarify_result = run_clarify(extracted)
        except OpenAIError as e:
            raise HTTPException(status_code=502, detail=_agent_error_detail(e))

        round_questions = clarify_result.questions[:ROUND_SIZE]
        if round_questions:
            save_pending_clarification(
                project_id, raw_notes, extracted, round_questions, [], 1,
                target_artifact_id, reason, step="overview",
            )
            return StepGenerateResponse(status="needs_clarification", questions=round_questions)

        try:
            _set_stage(project_id, "drafting")
            overview = run_overview(extracted)
        except OpenAIError as e:
            raise HTTPException(status_code=502, detail=_agent_error_detail(e))

        prd = _load_or_new_prd(project_id, target_artifact_id)
        _apply_overview(prd, overview)
        prd.pipeline.steps["overview"] = StepState(status="drafted")
        artifact_id = save_artifact(project_id, prd, target_artifact_id, reason=reason)
        mark_generated(project_id)
        return StepGenerateResponse(status="drafted", artifact_id=artifact_id, prd=prd)
    finally:
        _generation_progress.pop(project_id, None)

@app.post("/projects/{project_id}/steps/overview/generate", response_model=StepGenerateResponse)
def api_overview_generate(project_id: str, req: OverviewGenerateRequest):
    save_raw_input(project_id, req.raw_notes)
    save_input_notes(project_id, req.raw_notes)
    return _start_overview_generation(project_id, req.raw_notes, target_artifact_id=None, reason="overview drafted")

@app.get("/projects/{project_id}/input", response_model=SpecInput)
def api_get_input(project_id: str):
    return load_input(project_id)

@app.put("/projects/{project_id}/input", response_model=SpecInput)
def api_save_input(project_id: str, req: InputRequest):
    return save_input_notes(project_id, req.raw_notes)

@app.post("/projects/{project_id}/regenerate", response_model=ProjectMeta)
def api_regenerate(project_id: str):
    """Resets the ENTIRE pipeline back to a fresh, not-yet-drafted state --
    every step returns to not_started and all step content is cleared --
    from the project's persisted input. Does NOT auto-run the pipeline;
    call /steps/overview/generate to start it again. The reset itself is
    saved as a new artifact version, so prior drafts remain in history."""
    spec_input = load_input(project_id)
    if not spec_input.raw_notes.strip():
        raise HTTPException(
            status_code=400,
            detail="No input notes saved for this project yet -- add some in Source Notes first.",
        )

    artifact_ids = list_artifacts(project_id)
    if not artifact_ids:
        raise HTTPException(status_code=400, detail="No artifact yet to reset.")
    artifact_id = artifact_ids[0]

    meta = get_project(project_id)
    fresh = GeneratedPRD(title=meta.name)
    save_artifact(project_id, fresh, artifact_id, reason="pipeline reset")
    clear_pending_clarification(project_id)
    return meta

@app.get("/projects/{project_id}/generation-status")
def api_generation_status(project_id: str):
    """Polled by the UI while its generate/clarify request is in flight, to
    show which pipeline stage is currently running."""
    return {"stage": _generation_progress.get(project_id)}

@app.get("/projects/{project_id}/pending-clarification")
def api_get_pending_clarification(project_id: str):
    pending = load_pending_clarification(project_id)
    if pending is None:
        raise HTTPException(status_code=404, detail="No pending clarification for this project")
    return {"questions": pending.questions, "step": pending.step}

@app.post("/projects/{project_id}/steps/overview/clarify", response_model=StepGenerateResponse)
def api_overview_clarify(project_id: str, req: StepClarifyAnswersRequest):
    pending = load_pending_clarification(project_id)
    if pending is None or pending.step != "overview":
        raise HTTPException(status_code=404, detail="No pending overview clarification for this project")

    answered_now = [
        AnsweredClarification(
            question=q,
            answer=req.answers.get(q.id) or q.recommended or "(no answer given)",
        )
        for q in pending.questions
    ]
    # Persisted immediately, independent of whether this round turns out to
    # be the last one -- unlike pending_clarification.json (cleared once
    # generation succeeds), the input's clarification history is never
    # cleared, so it survives as reference context for future regenerations.
    append_input_clarifications(project_id, answered_now)
    new_history = pending.history + answered_now

    try:
        next_questions: list[ClarifyQuestion] = []
        if pending.round < MAX_ROUNDS and len(new_history) < MAX_TOTAL_QUESTIONS:
            _set_stage(project_id, "clarifying")
            try:
                clarify_result = run_clarify(pending.extracted, new_history)
            except OpenAIError as e:
                raise HTTPException(status_code=502, detail=_agent_error_detail(e))
            remaining_budget = MAX_TOTAL_QUESTIONS - len(new_history)
            next_questions = clarify_result.questions[: min(ROUND_SIZE, remaining_budget)]

        if next_questions:
            save_pending_clarification(
                project_id, pending.raw_notes, pending.extracted, next_questions, new_history,
                pending.round + 1, pending.target_artifact_id, pending.reason, step="overview",
            )
            return StepGenerateResponse(status="needs_clarification", questions=next_questions)

        try:
            _set_stage(project_id, "drafting")
            overview = run_overview(pending.extracted, new_history)
        except OpenAIError as e:
            raise HTTPException(status_code=502, detail=_agent_error_detail(e))

        prd = _load_or_new_prd(project_id, pending.target_artifact_id)
        _apply_overview(prd, overview)
        prd.pipeline.steps["overview"] = StepState(status="drafted")
        artifact_id = save_artifact(project_id, prd, pending.target_artifact_id, reason=pending.reason)
        mark_generated(project_id)
        clear_pending_clarification(project_id)
        return StepGenerateResponse(status="drafted", artifact_id=artifact_id, prd=prd)
    finally:
        _generation_progress.pop(project_id, None)

# ---------- Steps 2-4 & 6: Stories, Requirements, Test Cases, Epics ----------
# All four are "confirm upstream, generate this step" -- no clarify round of
# their own (Architecture is the one interactive step; see below).

@app.post("/projects/{project_id}/steps/{step}/generate", response_model=GeneratedPRD)
def api_generate_step(project_id: str, step: str):
    if step not in _STEP_RUNNERS:
        raise HTTPException(status_code=404, detail=f"Unknown or unsupported step '{step}' for this endpoint.")
    artifact_ids = list_artifacts(project_id)
    if not artifact_ids:
        raise HTTPException(status_code=400, detail="Complete the Overview step first.")
    artifact_id = artifact_ids[0]
    prd = load_artifact(project_id, artifact_id)
    _require_step_generatable(prd, step)  # type: ignore[arg-type]

    try:
        _STEP_RUNNERS[step](prd)
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=_agent_error_detail(e))

    prd.pipeline.steps[step] = StepState(status="drafted")
    save_artifact(project_id, prd, artifact_id, reason=f"{step} drafted")
    return prd

@app.post("/projects/{project_id}/steps/{step}/revisit", response_model=GeneratedPRD)
def api_revisit_step(project_id: str, step: str):
    """Regenerates a step marked 'stale' by an upstream edit's scope check,
    from the CURRENT (post-edit) upstream content. Returns the redraft for
    review -- does not auto-confirm; call /confirm once the PM is happy
    with it, same as any other freshly-drafted step."""
    if step not in _STEP_RUNNERS and step != "architecture":
        raise HTTPException(status_code=404, detail=f"Unknown or unsupported step '{step}' for revisit.")
    artifact_ids = list_artifacts(project_id)
    if not artifact_ids:
        raise HTTPException(status_code=404, detail="No artifact yet")
    artifact_id = artifact_ids[0]
    prd = load_artifact(project_id, artifact_id)
    state = prd.pipeline.steps.get(step, StepState())
    if state.status != "stale":
        raise HTTPException(
            status_code=400,
            detail=f"Step '{step}' is '{state.status}' -- only a stale step can be revisited.",
        )

    try:
        if step == "architecture":
            prd.architecture_decisions = run_architecture(
                prd, prd.technical_context, prd.architecture_clarify_history, load_glossary(project_id),
            )
        else:
            _STEP_RUNNERS[step](prd)
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=_agent_error_detail(e))

    prd.pipeline.steps[step] = StepState(status="drafted")
    save_artifact(project_id, prd, artifact_id, reason=f"{step} revisited")
    return prd

@app.post("/projects/{project_id}/steps/{step}/confirm", response_model=GeneratedPRD)
def api_confirm_step(project_id: str, step: StepId):
    artifact_ids = list_artifacts(project_id)
    if not artifact_ids:
        raise HTTPException(status_code=404, detail="No artifact yet")
    artifact_id = artifact_ids[0]
    prd = load_artifact(project_id, artifact_id)
    state = prd.pipeline.steps.get(step, StepState())
    if state.status != "drafted":
        raise HTTPException(
            status_code=400,
            detail=f"Step '{step}' is '{state.status}' -- only a drafted step can be confirmed.",
        )

    next_version = _next_version_number(project_id, artifact_id)
    prd.pipeline.steps[step] = StepState(
        status="confirmed",
        confirmed_at=datetime.now(timezone.utc).isoformat(),
        confirmed_version=next_version,
    )
    idx = STEP_ORDER.index(step)
    if idx + 1 < len(STEP_ORDER):
        prd.pipeline.current_step = STEP_ORDER[idx + 1]
    save_artifact(project_id, prd, artifact_id, reason=f"{step} confirmed")
    return prd

# ---------- Editing a confirmed step (scope check + cascade) ----------

def _downstream_summary(prd: GeneratedPRD, downstream: list[StepId]) -> str:
    lines = []
    for step in downstream:
        state = prd.pipeline.steps.get(step, StepState())
        lines.append(f"[{step}] (status: {state.status})")
        if step == "stories":
            for s in prd.user_stories:
                lines.append(f"  - [{s.priority}] {s.title}: {s.description}")
        elif step == "requirements":
            for fr in prd.functional_requirements:
                lines.append(f"  - {fr.id} [{fr.kind}]: {fr.text}")
        elif step == "test_cases":
            for tc in prd.test_cases:
                lines.append(f"  - {tc.id} (verifies {tc.fr_id}): {tc.title}")
        elif step == "architecture":
            for a in prd.architecture_decisions:
                lines.append(f"  - {a.id} {a.title}: {a.decision}")
        elif step == "epics":
            for e in prd.epics:
                lines.append(f"  - {e.id} {e.title} ({len(e.stories)} stories)")
    return "\n".join(lines) or "(nothing downstream yet)"

@app.post("/projects/{project_id}/steps/{step}/edit", response_model=StepEditResponse)
def api_edit_step(project_id: str, step: StepId, req: StepEditRequest):
    artifact_ids = list_artifacts(project_id)
    if not artifact_ids:
        raise HTTPException(status_code=404, detail="No artifact yet")
    artifact_id = artifact_ids[0]
    prd = load_artifact(project_id, artifact_id)
    state = prd.pipeline.steps.get(step, StepState())
    if state.status != "confirmed":
        raise HTTPException(
            status_code=400,
            detail=f"Step '{step}' is '{state.status}' -- only a confirmed step can be edited this way.",
        )

    old_prd = prd.model_copy(deep=True)
    for field in STEP_FIELDS[step]:
        setattr(prd, field, getattr(req.prd, field))

    entries = [e for e in diff_prds(old_prd, prd) if e.section in STEP_SECTIONS[step]]
    if not entries:
        return StepEditResponse(prd=prd, scope_check=None, cascaded_to=[])

    downstream = [
        s for s in STEP_ORDER[STEP_ORDER.index(step) + 1:]
        if prd.pipeline.steps.get(s, StepState()).status in ("confirmed", "drafted", "stale")
    ]

    verdict: ScopeCheckVerdict | None = None
    cascaded: list[str] = []
    if downstream:
        try:
            verdict = run_scope_check(step, entries, _downstream_summary(prd, downstream))
        except OpenAIError as e:
            raise HTTPException(status_code=502, detail=_agent_error_detail(e))
        if verdict.classification == "scope_change":
            for s in verdict.affected_downstream_steps:
                if s in downstream:
                    prd.pipeline.steps[s] = StepState(status="stale")
                    cascaded.append(s)

    next_version = _next_version_number(project_id, artifact_id)
    prd.pipeline.steps[step] = StepState(
        status="confirmed",
        confirmed_at=datetime.now(timezone.utc).isoformat(),
        confirmed_version=next_version,
    )
    save_artifact(project_id, prd, artifact_id, reason=f"{step} edited", cascaded_to=cascaded)
    return StepEditResponse(prd=prd, scope_check=verdict, cascaded_to=cascaded)

# ---------- Step 5: Architecture (interactive clarify + finalize) ----------

def _finalize_architecture(project_id: str, prd: GeneratedPRD, artifact_id: str) -> StepGenerateResponse:
    try:
        _set_stage(project_id, "architecture")
        prd.architecture_decisions = run_architecture(
            prd, prd.technical_context, prd.architecture_clarify_history, load_glossary(project_id),
        )
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=_agent_error_detail(e))
    finally:
        _generation_progress.pop(project_id, None)
    prd.pipeline.steps["architecture"] = StepState(status="drafted")
    save_artifact(project_id, prd, artifact_id, reason="architecture drafted")
    return StepGenerateResponse(status="drafted", artifact_id=artifact_id, prd=prd)

@app.post("/projects/{project_id}/steps/architecture/clarify/start", response_model=StepGenerateResponse)
def api_architecture_clarify_start(project_id: str):
    artifact_ids = list_artifacts(project_id)
    if not artifact_ids:
        raise HTTPException(status_code=400, detail="Complete the earlier steps first.")
    artifact_id = artifact_ids[0]
    prd = load_artifact(project_id, artifact_id)
    _require_step_generatable(prd, "architecture")

    try:
        clarify_result = run_architecture_clarify(prd)
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=_agent_error_detail(e))

    round_questions = clarify_result.questions[:ROUND_SIZE]
    if not round_questions:
        return _finalize_architecture(project_id, prd, artifact_id)

    extracted_stub = ExtractedRequirements(
        problem_statement=prd.problem_statement, goals=prd.goals,
        target_users=prd.target_users, open_questions=prd.open_questions,
    )
    save_pending_clarification(
        project_id, "", extracted_stub, round_questions, [], 1,
        artifact_id, "architecture drafted", step="architecture",
    )
    prd.pipeline.steps["architecture"] = StepState(status="needs_clarification")
    save_artifact(project_id, prd, artifact_id, reason="architecture clarification started")
    return StepGenerateResponse(status="needs_clarification", questions=round_questions, artifact_id=artifact_id)

@app.post("/projects/{project_id}/steps/architecture/clarify/answer", response_model=StepGenerateResponse)
def api_architecture_clarify_answer(project_id: str, req: StepClarifyAnswersRequest):
    pending = load_pending_clarification(project_id)
    if pending is None or pending.step != "architecture":
        raise HTTPException(status_code=404, detail="No pending architecture clarification for this project")

    artifact_id = pending.target_artifact_id
    prd = load_artifact(project_id, artifact_id)

    answered_now = [
        AnsweredClarification(
            question=q, answer=req.answers.get(q.id) or q.recommended or "(no answer given)",
        )
        for q in pending.questions
    ]
    new_history = pending.history + answered_now

    try:
        next_questions: list[ClarifyQuestion] = []
        if pending.round < MAX_ROUNDS and len(new_history) < MAX_TOTAL_QUESTIONS:
            clarify_result = run_architecture_clarify(prd, new_history)
            remaining_budget = MAX_TOTAL_QUESTIONS - len(new_history)
            next_questions = clarify_result.questions[: min(ROUND_SIZE, remaining_budget)]
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=_agent_error_detail(e))

    if next_questions:
        save_pending_clarification(
            project_id, pending.raw_notes, pending.extracted, next_questions, new_history,
            pending.round + 1, artifact_id, pending.reason, step="architecture",
        )
        return StepGenerateResponse(status="needs_clarification", questions=next_questions, artifact_id=artifact_id)

    prd.architecture_clarify_history = new_history
    clear_pending_clarification(project_id)
    return _finalize_architecture(project_id, prd, artifact_id)

@app.post("/projects/{project_id}/steps/architecture/finalize", response_model=StepGenerateResponse)
def api_architecture_finalize(project_id: str):
    """Lets the PM skip any remaining clarify rounds and finalize
    architecture decisions from whatever Q&A has already happened."""
    artifact_ids = list_artifacts(project_id)
    if not artifact_ids:
        raise HTTPException(status_code=400, detail="Complete the earlier steps first.")
    artifact_id = artifact_ids[0]
    prd = load_artifact(project_id, artifact_id)
    clear_pending_clarification(project_id)
    return _finalize_architecture(project_id, prd, artifact_id)

# ---------- Diagrams (unchanged -- not part of the strict step gate) ----------

@app.post("/projects/{project_id}/artifacts/{artifact_id}/diagrams", response_model=GeneratedPRD)
def api_generate_diagram(project_id: str, artifact_id: str, req: DiagramRequest):
    prd = load_artifact(project_id, artifact_id)

    try:
        diagram = run_diagram(prd, req.diagram_type)
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=_agent_error_detail(e))

    prd.diagrams = [d for d in prd.diagrams if d.diagram_type != req.diagram_type] + [diagram]
    save_artifact(project_id, prd, artifact_id, reason="diagram generated")
    return prd

@app.put("/projects/{project_id}/artifacts/{artifact_id}/diagrams/{diagram_type}/png", response_model=GeneratedPRD)
def api_set_diagram_png(project_id: str, artifact_id: str, diagram_type: Literal["journey", "sequence"], req: DiagramPngRequest):
    """Attaches a client-side-rendered PNG to an existing diagram, loaded fresh
    from disk (not from client-supplied PRD state) so this can never clobber
    unsaved edits to other fields -- it only ever touches this one diagram."""
    prd = load_artifact(project_id, artifact_id)

    for d in prd.diagrams:
        if d.diagram_type == diagram_type:
            d.png_base64 = req.png_base64
            break
    else:
        raise HTTPException(status_code=404, detail=f"No {diagram_type} diagram to attach a PNG to")

    save_artifact(project_id, prd, artifact_id, reason="diagram image attached")
    return prd

# ---------- Completeness review (manual, non-blocking) ----------

@app.post("/projects/{project_id}/artifacts/{artifact_id}/completeness-review", response_model=GeneratedPRD)
def api_completeness_review(project_id: str, artifact_id: str):
    prd = load_artifact(project_id, artifact_id)
    next_version = _next_version_number(project_id, artifact_id)

    try:
        review = run_completeness_review(prd, next_version)
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=_agent_error_detail(e))

    prd.completeness_review = review
    save_artifact(project_id, prd, artifact_id, reason="completeness review")
    return prd

@app.get("/jira/status")
def api_jira_status():
    return {
        "configured": jira_client.is_configured(),
        "project_key": jira_client.JIRA_PROJECT_KEY,
        "base_url": jira_client.JIRA_BASE_URL,
    }

@app.post("/projects/{project_id}/artifacts/{artifact_id}/jira-export", response_model=JiraExportResponse)
def api_jira_export(project_id: str, artifact_id: str):
    prd = load_artifact(project_id, artifact_id)

    if not jira_client.is_configured():
        raise HTTPException(
            status_code=400,
            detail=(
                "Jira is not configured. Set JIRA_BASE_URL/JIRA_EMAIL/JIRA_API_TOKEN/"
                "JIRA_PROJECT_KEY in backend/.env."
            ),
        )

    results: list[JiraPushResult] = []
    for epic in prd.epics:
        if epic.jira_key:
            results.append(JiraPushResult(id=epic.id, item_type="epic", status="skipped", jira_key=epic.jira_key))
        else:
            try:
                epic.jira_key = jira_client.create_epic(epic.title, epic.description)
                results.append(
                    JiraPushResult(id=epic.id, item_type="epic", status="created", jira_key=epic.jira_key)
                )
            except Exception as e:
                results.append(JiraPushResult(id=epic.id, item_type="epic", status="error", detail=str(e)))

        for story in epic.stories:
            if story.jira_key:
                results.append(
                    JiraPushResult(id=story.id, item_type="story", status="skipped", jira_key=story.jira_key)
                )
            elif not epic.jira_key:
                results.append(
                    JiraPushResult(id=story.id, item_type="story", status="error", detail="Epic was not created")
                )
            else:
                try:
                    story.jira_key = jira_client.create_story(
                        story.title, story.description, story.acceptance_criteria, epic.jira_key
                    )
                    results.append(
                        JiraPushResult(id=story.id, item_type="story", status="created", jira_key=story.jira_key)
                    )
                except Exception as e:
                    results.append(JiraPushResult(id=story.id, item_type="story", status="error", detail=str(e)))

    save_artifact(project_id, prd, artifact_id, reason="pushed to Jira")
    return JiraExportResponse(prd=prd, results=results)

@app.post("/projects/{project_id}/artifacts/{artifact_id}/jira-import", response_model=JiraImportResponse)
def api_jira_import(project_id: str, artifact_id: str):
    prd = load_artifact(project_id, artifact_id)

    if not jira_client.is_configured():
        raise HTTPException(
            status_code=400,
            detail=(
                "Jira is not configured. Set JIRA_BASE_URL/JIRA_EMAIL/JIRA_API_TOKEN/"
                "JIRA_PROJECT_KEY in backend/.env."
            ),
        )

    try:
        raw_epics, unlinked = jira_client.fetch_project_epics_and_stories()
        prd.epics, unmapped_requirements = run_jira_import(prd, raw_epics, unlinked)
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=_agent_error_detail(e))
    except Exception as e:
        # jira_client can raise JIRAError / network errors -- surface a
        # clean 502 instead of an unhandled 500, same reasoning as agent
        # failures above.
        raise HTTPException(status_code=502, detail=f"Jira import failed: {e}")

    save_artifact(project_id, prd, artifact_id, reason="imported from Jira")
    return JiraImportResponse(prd=prd, unmapped_requirements=unmapped_requirements)

@app.post("/projects/{project_id}/artifacts/{artifact_id}/jira-sync", response_model=JiraSyncResponse)
def api_jira_sync(project_id: str, artifact_id: str):
    prd = load_artifact(project_id, artifact_id)

    if not jira_client.is_configured():
        raise HTTPException(
            status_code=400,
            detail=(
                "Jira is not configured. Set JIRA_BASE_URL/JIRA_EMAIL/JIRA_API_TOKEN/"
                "JIRA_PROJECT_KEY in backend/.env."
            ),
        )

    keys = [e.jira_key for e in prd.epics if e.jira_key]
    keys += [s.jira_key for e in prd.epics for s in e.stories if s.jira_key]

    try:
        statuses = jira_client.fetch_statuses(keys)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Jira status sync failed: {e}")

    updated = 0
    unchanged = 0
    for epic in prd.epics:
        if epic.jira_key and epic.jira_key in statuses:
            new_status = statuses[epic.jira_key]
            if new_status != epic.jira_status:
                updated += 1
            else:
                unchanged += 1
            epic.jira_status = new_status
        for story in epic.stories:
            if story.jira_key and story.jira_key in statuses:
                new_status = statuses[story.jira_key]
                if new_status != story.jira_status:
                    updated += 1
                else:
                    unchanged += 1
                story.jira_status = new_status

    save_artifact(project_id, prd, artifact_id, reason="jira status synced")
    return JiraSyncResponse(prd=prd, updated=updated, unchanged=unchanged)

@app.post("/projects/{project_id}/artifacts/{artifact_id}/briefs", response_model=GeneratedPRD)
def api_generate_brief(project_id: str, artifact_id: str, req: BriefRequest):
    prd = load_artifact(project_id, artifact_id)
    stakeholders = load_stakeholders(project_id)

    try:
        brief = run_brief(prd, req.audience, stakeholders, load_glossary(project_id))
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=_agent_error_detail(e))

    brief.audience = req.audience  # requested audience is authoritative, not the model's echo
    # Stamp the version this brief will be saved at, so the UI can flag it as
    # stale once the spec moves past it. The save below creates that version.
    brief.source_version = _next_version_number(project_id, artifact_id)
    prd.briefs = [b for b in prd.briefs if b.audience != req.audience] + [brief]
    save_artifact(project_id, prd, artifact_id, reason="brief generated")
    return prd

@app.get("/projects/{project_id}/artifacts/{artifact_id}/briefs/{audience}/export/{format}")
def api_export_brief(project_id: str, artifact_id: str, audience: Literal["executive", "engineering", "sales"], format: str):
    from fastapi.responses import FileResponse

    prd = load_artifact(project_id, artifact_id)
    brief = next((b for b in prd.briefs if b.audience == audience), None)
    if brief is None:
        raise HTTPException(status_code=404, detail=f"No {audience} brief generated yet")

    tmp_dir = tempfile.mkdtemp()
    if format == "md":
        path = os.path.join(tmp_dir, f"{brief.title}.md")
        with open(path, "w", encoding="utf-8") as f:
            f.write(export_brief_to_markdown(brief))
        media_type = "text/markdown"
    elif format == "docx":
        path = os.path.join(tmp_dir, f"{brief.title}.docx")
        export_brief_to_docx(brief, path)
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        raise HTTPException(status_code=400, detail="Unsupported format. Use md or docx.")

    return FileResponse(path, media_type=media_type, filename=os.path.basename(path))

@app.get("/projects/{project_id}/artifacts/{artifact_id}/versions")
def api_list_versions(project_id: str, artifact_id: str):
    return {"versions": list_artifact_versions(project_id, artifact_id)}

@app.get("/projects/{project_id}/artifacts/{artifact_id}/versions/{version}", response_model=GeneratedPRD)
def api_get_version(project_id: str, artifact_id: str, version: int):
    try:
        return load_artifact_version(project_id, artifact_id, version)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"No version {version} for this artifact")

@app.get("/projects/{project_id}/artifacts/{artifact_id}/diff")
def api_diff(project_id: str, artifact_id: str, from_version: int, to_version: int | None = None):
    try:
        old = load_artifact_version(project_id, artifact_id, from_version)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"No version {from_version} for this artifact")
    if to_version is not None:
        try:
            new = load_artifact_version(project_id, artifact_id, to_version)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail=f"No version {to_version} for this artifact")
    else:
        new = load_artifact(project_id, artifact_id)
    return {"from_version": from_version, "to_version": to_version, "entries": diff_prds(old, new)}

@app.post("/projects/{project_id}/artifacts/{artifact_id}/updates", response_model=GeneratedPRD)
def api_compose_update(project_id: str, artifact_id: str, req: ComposeUpdateRequest):
    prd = load_artifact(project_id, artifact_id)
    versions = list_artifact_versions(project_id, artifact_id)
    version_meta = next((v for v in versions if v.version == req.from_version), None)
    if version_meta is None:
        raise HTTPException(status_code=404, detail=f"No version {req.from_version} for this artifact")

    old = load_artifact_version(project_id, artifact_id, req.from_version)
    entries = diff_prds(old, prd)
    if not entries:
        raise HTTPException(
            status_code=400,
            detail=f"No substantive changes since version {req.from_version} -- nothing to report.",
        )

    diff_lines = [f"[{e.section}] {e.change}: {e.item}" + (f" -- {e.detail}" if e.detail else "") for e in entries]
    to_version = versions[-1].version if versions else req.from_version
    period_desc = f"version {req.from_version} (saved {version_meta.saved_at}) to version {to_version} (now)"
    stakeholders = load_stakeholders(project_id)

    try:
        draft = run_update_composer(
            prd, diff_lines, stakeholders, req.audience, period_desc, load_glossary(project_id)
        )
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=_agent_error_detail(e))

    prd.updates.append(ComposedUpdate(
        id=f"UPD-{len(prd.updates) + 1}",
        audience=req.audience,
        from_version=req.from_version,
        to_version=to_version,
        created_at=datetime.now(timezone.utc).isoformat(),
        title=draft.title,
        summary=draft.summary,
        sections=draft.sections,
        decisions_needed=draft.decisions_needed,
    ))
    save_artifact(project_id, prd, artifact_id, reason="update composed")
    return prd

@app.get("/projects/{project_id}/artifacts/{artifact_id}/updates/{update_id}/export/{format}")
def api_export_update(project_id: str, artifact_id: str, update_id: str, format: str):
    from fastapi.responses import FileResponse

    prd = load_artifact(project_id, artifact_id)
    update = next((u for u in prd.updates if u.id == update_id), None)
    if update is None:
        raise HTTPException(status_code=404, detail=f"No update {update_id} on this artifact")

    tmp_dir = tempfile.mkdtemp()
    if format == "md":
        path = os.path.join(tmp_dir, f"{update.title}.md")
        with open(path, "w", encoding="utf-8") as f:
            f.write(export_update_to_markdown(update))
        media_type = "text/markdown"
    elif format == "docx":
        path = os.path.join(tmp_dir, f"{update.title}.docx")
        export_update_to_docx(update, path)
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        raise HTTPException(status_code=400, detail="Unsupported format. Use md or docx.")

    return FileResponse(path, media_type=media_type, filename=os.path.basename(path))

@app.get("/projects/{project_id}/artifacts")
def api_list_artifacts(project_id: str):
    return {"artifact_ids": list_artifacts(project_id)}

@app.get("/projects/{project_id}/artifacts/{artifact_id}", response_model=GeneratedPRD)
def api_get_artifact(project_id: str, artifact_id: str):
    try:
        return load_artifact(project_id, artifact_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Artifact not found")

@app.put("/projects/{project_id}/artifacts/{artifact_id}")
def api_update_artifact(
    project_id: str,
    artifact_id: str,
    prd: GeneratedPRD,
    reason: Literal["manual save", "autosave"] = "manual save",
):
    current = load_artifact(project_id, artifact_id)
    for step, fields in STEP_FIELDS.items():
        state = current.pipeline.steps.get(step)
        if state and state.status == "confirmed":
            for field in fields:
                if getattr(prd, field) != getattr(current, field):
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"'{step}' is confirmed -- use POST /steps/{step}/edit to change it "
                            "(this runs a scope check and cascades stale downstream steps as needed)."
                        ),
                    )
    save_artifact(project_id, prd, artifact_id, reason=reason)
    return {"status": "saved"}

@app.delete("/projects/{project_id}/artifacts/{artifact_id}")
def api_delete_artifact(project_id: str, artifact_id: str):
    delete_artifact(project_id, artifact_id)
    return {"status": "deleted"}

@app.get("/projects/{project_id}/artifacts/{artifact_id}/export/{format}")
def api_export(project_id: str, artifact_id: str, format: str):
    from fastapi.responses import FileResponse

    prd = load_artifact(project_id, artifact_id)

    tmp_dir = tempfile.mkdtemp()
    if format == "md":
        path = os.path.join(tmp_dir, f"{prd.title}.md")
        with open(path, "w", encoding="utf-8") as f:
            f.write(export_to_markdown(prd))
        media_type = "text/markdown"
    elif format == "docx":
        path = os.path.join(tmp_dir, f"{prd.title}.docx")
        export_to_docx(prd, path)
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    elif format == "csv":
        path = os.path.join(tmp_dir, f"{prd.title}_stories.csv")
        export_stories_to_csv(prd, path)
        media_type = "text/csv"
    elif format == "epics-csv":
        path = os.path.join(tmp_dir, f"{prd.title}_epics.csv")
        export_epics_to_csv(prd, path)
        media_type = "text/csv"
    else:
        raise HTTPException(status_code=400, detail="Unsupported format. Use md, docx, csv, or epics-csv.")

    return FileResponse(path, media_type=media_type, filename=os.path.basename(path))
