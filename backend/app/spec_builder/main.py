from __future__ import annotations

from pathlib import Path
from typing import Literal
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

from app.llm_client import generate_structured_sync
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
    run_extraction, GENERATION_SYSTEM_PROMPT, run_clarify, run_generation, run_diagram,
    run_architecture, run_epics, run_jira_import, run_brief, run_update_composer,
    ExtractedRequirements, ClarifyQuestion, AnsweredClarification, GeneratedPRD,
    ComposedUpdate,
    ROUND_SIZE, MAX_ROUNDS, MAX_TOTAL_QUESTIONS,
)
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

class GenerateRequest(BaseModel):
    raw_notes: str

class InputRequest(BaseModel):
    raw_notes: str

class ClarifyAnswersRequest(BaseModel):
    answers: dict[str, str]

class GenerateResponse(BaseModel):
    status: Literal["needs_clarification", "generated"]
    questions: list[ClarifyQuestion] = []
    artifact_id: str | None = None
    prd: GeneratedPRD | None = None

class RegenerateSectionRequest(BaseModel):
    section: str
    context: str

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

def generate_full_prd(
    extracted: ExtractedRequirements,
    history: list[AnsweredClarification] | None = None,
    on_stage=None,
    glossary: list[GlossaryTerm] | None = None,
) -> GeneratedPRD:
    """Drafts the spec, then automatically drafts architecture decisions and
    epics from it -- the three run together so a generated spec is always
    "comprehensive" without a separate manual step."""
    def stage(name: str):
        if on_stage:
            on_stage(name)

    stage("drafting")
    prd = run_generation(extracted, history)
    prd.technical_context = [h for h in (history or []) if h.question.category == "technical_context"]
    stage("architecture")
    prd.architecture_decisions = run_architecture(prd, prd.technical_context, glossary)
    stage("epics")
    prd.epics = run_epics(prd)
    return prd

@app.post("/projects", response_model=ProjectMeta)
def api_create_project(req: CreateProjectRequest):
    return create_project(req.name)

class ProjectSummary(BaseModel):
    stage: Literal["empty", "clarifying", "drafted"]
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
    return ProjectSummary(
        stage="drafted",
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

def _start_generation(
    project_id: str, raw_notes: str, target_artifact_id: str | None, reason: str
) -> GenerateResponse:
    """Runs extraction -> clarify -> (full generate once clarified). Shared
    by /generate (fresh raw_notes, no target artifact -- a brand-new one
    gets created) and /regenerate (raw_notes read from the project's
    persisted input, target_artifact_id set so the result becomes a new
    VERSION of the existing artifact rather than an unrelated second one)."""
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
                project_id, raw_notes, extracted, round_questions, [], 1, target_artifact_id, reason
            )
            return GenerateResponse(status="needs_clarification", questions=round_questions)

        try:
            prd = generate_full_prd(
                extracted, on_stage=lambda s: _set_stage(project_id, s),
                glossary=load_glossary(project_id),
            )
        except OpenAIError as e:
            raise HTTPException(status_code=502, detail=_agent_error_detail(e))

        artifact_id = save_artifact(project_id, prd, target_artifact_id, reason=reason)
        mark_generated(project_id)
        return GenerateResponse(status="generated", artifact_id=artifact_id, prd=prd)
    finally:
        _generation_progress.pop(project_id, None)

@app.post("/projects/{project_id}/generate", response_model=GenerateResponse)
def api_generate(project_id: str, req: GenerateRequest):
    save_raw_input(project_id, req.raw_notes)
    save_input_notes(project_id, req.raw_notes)
    return _start_generation(project_id, req.raw_notes, target_artifact_id=None, reason="generated")

@app.get("/projects/{project_id}/input", response_model=SpecInput)
def api_get_input(project_id: str):
    return load_input(project_id)

@app.put("/projects/{project_id}/input", response_model=SpecInput)
def api_save_input(project_id: str, req: InputRequest):
    return save_input_notes(project_id, req.raw_notes)

@app.post("/projects/{project_id}/regenerate", response_model=GenerateResponse)
def api_regenerate(project_id: str):
    """Reruns the full pipeline from the project's persisted, PM-editable
    input -- the counterpart to /generate's fresh raw_notes. Always targets
    the project's existing artifact (one artifact per project, matching how
    the UI already works) so the result lands as a new version, never a
    second unrelated spec."""
    spec_input = load_input(project_id)
    if not spec_input.raw_notes.strip():
        raise HTTPException(
            status_code=400,
            detail="No input notes saved for this project yet -- add some in Source Notes first.",
        )

    artifact_ids = list_artifacts(project_id)
    target_artifact_id = artifact_ids[0] if artifact_ids else None

    return _start_generation(
        project_id, spec_input.raw_notes, target_artifact_id, reason="regenerated from updated input"
    )

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
    return {"questions": pending.questions}

@app.post("/projects/{project_id}/clarify", response_model=GenerateResponse)
def api_clarify(project_id: str, req: ClarifyAnswersRequest):
    pending = load_pending_clarification(project_id)
    if pending is None:
        raise HTTPException(status_code=404, detail="No pending clarification for this project")

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
                pending.round + 1, pending.target_artifact_id, pending.reason,
            )
            return GenerateResponse(status="needs_clarification", questions=next_questions)

        try:
            prd = generate_full_prd(
                pending.extracted, new_history, on_stage=lambda s: _set_stage(project_id, s),
                glossary=load_glossary(project_id),
            )
        except OpenAIError as e:
            raise HTTPException(status_code=502, detail=_agent_error_detail(e))

        artifact_id = save_artifact(project_id, prd, pending.target_artifact_id, reason=pending.reason)
        mark_generated(project_id)
        clear_pending_clarification(project_id)
        return GenerateResponse(status="generated", artifact_id=artifact_id, prd=prd)
    finally:
        _generation_progress.pop(project_id, None)

@app.post("/projects/{project_id}/artifacts/{artifact_id}/regenerate-section")
def api_regenerate_section(project_id: str, artifact_id: str, req: RegenerateSectionRequest):
    prd = load_artifact(project_id, artifact_id)

    try:
        updated_prd = generate_structured_sync(
            GENERATION_SYSTEM_PROMPT,
            f"Regenerate ONLY the {req.section} section. "
            f"Current PRD context: {req.context}. "
            f"Return the full PRD structure but only change {req.section}.",
            GeneratedPRD,
        )
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=_agent_error_detail(e))

    save_artifact(project_id, updated_prd, artifact_id, reason="section regenerated")
    return {"prd": updated_prd}

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

@app.post("/projects/{project_id}/artifacts/{artifact_id}/architecture-decisions", response_model=GeneratedPRD)
def api_generate_architecture_decisions(project_id: str, artifact_id: str):
    prd = load_artifact(project_id, artifact_id)

    try:
        prd.architecture_decisions = run_architecture(prd, prd.technical_context, load_glossary(project_id))
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=_agent_error_detail(e))

    save_artifact(project_id, prd, artifact_id, reason="architecture decisions regenerated")
    return prd

@app.post("/projects/{project_id}/artifacts/{artifact_id}/epics", response_model=GeneratedPRD)
def api_generate_epics(project_id: str, artifact_id: str):
    prd = load_artifact(project_id, artifact_id)

    try:
        prd.epics = run_epics(prd)
    except OpenAIError as e:
        raise HTTPException(status_code=502, detail=_agent_error_detail(e))

    save_artifact(project_id, prd, artifact_id, reason="epics regenerated")
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
    existing_versions = list_artifact_versions(project_id, artifact_id)
    brief.source_version = (existing_versions[-1].version + 1) if existing_versions else 1
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
        with open(path, "w") as f:
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

    from datetime import datetime, timezone
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
        with open(path, "w") as f:
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
        with open(path, "w") as f:
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
