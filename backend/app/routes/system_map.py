from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile
from openai import OpenAIError
from pydantic import BaseModel

from app.extraction import extract_text
from app.system_map_extraction_llm import extract_from_document, suggest_merge_candidates
from app.system_map_graph import (
    assemble_graph_from_drafts,
    compute_centrality,
    find_cycles,
    find_orphans,
    find_paths,
    trace_pii_flow,
)
from app.system_map_models import (
    BuildGraphRequest,
    CentralityResult,
    ConfirmGraphRequest,
    CreateProjectRequest,
    CycleReport,
    ExtractedEdgeDraft,
    ExtractedNodeDraft,
    ExtractionDraft,
    MergeCandidate,
    MergeDecisionRequest,
    OrphanReport,
    PathResult,
    PiiFlowResult,
    ProjectMeta,
    RenameProjectRequest,
    SourceCitation,
    SourceDocumentMeta,
    StructuredDocumentRequest,
    SystemMapGraph,
)
from app.system_map_persistence import (
    delete_document,
    delete_project,
    get_project,
    list_documents,
    list_extraction_drafts,
    list_graph_versions,
    list_projects as _list_projects,
    load_document_content,
    load_document_meta,
    load_extraction_draft,
    load_graph,
    load_graph_version,
    load_merge_candidates,
    rename_project,
    save_document,
    save_document_meta,
    save_extraction_draft,
    save_graph,
    save_merge_candidates,
)
from app.system_map_persistence import create_project as _create_project

router = APIRouter(prefix="/api/system-map")


def _openai_error(exc: OpenAIError) -> HTTPException:
    return HTTPException(status_code=502, detail=f"LLM provider error: {exc}")


def _require_project(project_id: str) -> ProjectMeta:
    try:
        return get_project(project_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Project not found.")


def _require_document(project_id: str, document_id: str) -> SourceDocumentMeta:
    try:
        return load_document_meta(project_id, document_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Document not found.")


# ---------- Projects ----------


class ProjectSummary(BaseModel):
    document_count: int = 0
    reviewed_document_count: int = 0
    pending_merge_decisions: int = 0
    confirmed_node_count: int = 0
    confirmed_edge_count: int = 0


class ProjectListItem(ProjectMeta):
    summary: ProjectSummary


def _summarize_project(project_id: str) -> ProjectSummary:
    drafts = list_extraction_drafts(project_id)
    graph = load_graph(project_id)
    return ProjectSummary(
        document_count=len(list_documents(project_id)),
        reviewed_document_count=sum(1 for d in drafts if d.reviewed),
        pending_merge_decisions=sum(1 for c in load_merge_candidates(project_id) if c.decision is None),
        confirmed_node_count=len(graph.nodes),
        confirmed_edge_count=len(graph.edges),
    )


@router.post("/projects", response_model=ProjectMeta)
def api_create_project(req: CreateProjectRequest) -> ProjectMeta:
    return _create_project(req.name)


@router.get("/projects", response_model=list[ProjectListItem])
def api_list_projects() -> list[ProjectListItem]:
    return [ProjectListItem(**meta.model_dump(), summary=_summarize_project(meta.id)) for meta in _list_projects()]


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


# ---------- Documents ----------


@router.post("/projects/{project_id}/documents/upload", response_model=SourceDocumentMeta)
async def api_upload_document(project_id: str, file: UploadFile = File(...)) -> SourceDocumentMeta:
    """Saves the raw upload, then immediately runs extraction on it -- the
    two used to be separate manual steps (upload, then a distinct Extract
    click). If the LLM call fails, the document is still saved and left
    `extraction_status="pending"` so the existing manual Extract button can
    retry it; upload itself never fails because of a downstream LLM error."""
    _require_project(project_id)
    content = await extract_text(file)
    doc_meta = save_document(project_id, file.filename or "untitled", content, kind="raw")

    try:
        draft = await extract_from_document(doc_meta.id, doc_meta.filename, content)
    except OpenAIError:
        return doc_meta

    save_extraction_draft(project_id, draft)
    doc_meta.extraction_status = "extracted"
    save_document_meta(project_id, doc_meta)
    return doc_meta


@router.post("/projects/{project_id}/documents/structured", response_model=SourceDocumentMeta)
def api_upload_structured_document(project_id: str, req: StructuredDocumentRequest) -> SourceDocumentMeta:
    """Ingests a document you've already turned into structured JSON
    yourself -- skips the LLM extraction call and saves the equivalent
    ExtractionDraft directly, still awaiting the same per-document review
    (Review point 1) as an LLM-extracted document."""
    _require_project(project_id)
    doc_meta = save_document(project_id, req.filename, req.model_dump_json(indent=2), kind="structured")

    draft = ExtractionDraft(
        document_id=doc_meta.id,
        nodes=[
            ExtractedNodeDraft(
                name=n.name,
                type=n.type,
                owning_team=n.owning_team,
                criticality=n.criticality,
                citation=SourceCitation(document_id=doc_meta.id, filename=doc_meta.filename, snippet=n.snippet),
            )
            for n in req.nodes
        ],
        edges=[
            ExtractedEdgeDraft(
                source_system_name=e.source_system_name,
                target_system_name=e.target_system_name,
                fields=e.fields,
                pii_fields=e.pii_fields,
                transport=e.transport,
                frequency=e.frequency,
                format=e.format,
                purpose=e.purpose,
                citation=SourceCitation(document_id=doc_meta.id, filename=doc_meta.filename, snippet=e.snippet),
            )
            for e in req.edges
        ],
    )
    save_extraction_draft(project_id, draft)
    doc_meta.extraction_status = "extracted"
    save_document_meta(project_id, doc_meta)
    return doc_meta


@router.get("/projects/{project_id}/documents", response_model=list[SourceDocumentMeta])
def api_list_documents(project_id: str) -> list[SourceDocumentMeta]:
    _require_project(project_id)
    return list_documents(project_id)


@router.get("/projects/{project_id}/documents/{document_id}")
def api_get_document(project_id: str, document_id: str) -> dict:
    meta = _require_document(project_id, document_id)
    return {"meta": meta, "content": load_document_content(project_id, document_id)}


@router.delete("/projects/{project_id}/documents/{document_id}")
def api_delete_document(project_id: str, document_id: str) -> dict:
    _require_document(project_id, document_id)
    delete_document(project_id, document_id)
    return {"ok": True}


# ---------- Extraction (Review point 1) ----------


@router.post("/projects/{project_id}/documents/{document_id}/extract", response_model=ExtractionDraft)
async def api_extract_document(project_id: str, document_id: str) -> ExtractionDraft:
    doc_meta = _require_document(project_id, document_id)
    if doc_meta.kind == "structured":
        raise HTTPException(status_code=400, detail="Structured documents are already extracted; nothing to run.")

    content = load_document_content(project_id, document_id)
    try:
        draft = await extract_from_document(document_id, doc_meta.filename, content)
    except OpenAIError as e:
        raise _openai_error(e)

    save_extraction_draft(project_id, draft)
    doc_meta.extraction_status = "extracted"
    save_document_meta(project_id, doc_meta)
    return draft


@router.get("/projects/{project_id}/documents/{document_id}/extraction", response_model=ExtractionDraft)
def api_get_extraction(project_id: str, document_id: str) -> ExtractionDraft:
    _require_document(project_id, document_id)
    draft = load_extraction_draft(project_id, document_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="This document hasn't been extracted yet.")
    return draft


@router.put("/projects/{project_id}/documents/{document_id}/extraction", response_model=ExtractionDraft)
def api_update_extraction(project_id: str, document_id: str, draft: ExtractionDraft) -> ExtractionDraft:
    """Persists a human's edits to the extracted nodes/edges (accept, fix,
    or remove individual items) before the draft is marked reviewed."""
    _require_document(project_id, document_id)
    draft.document_id = document_id
    save_extraction_draft(project_id, draft)
    return draft


@router.post("/projects/{project_id}/documents/{document_id}/extraction/confirm", response_model=ExtractionDraft)
def api_confirm_extraction(project_id: str, document_id: str) -> ExtractionDraft:
    """Marks Review point 1 complete for this document -- only reviewed
    drafts are eligible to feed merge suggestions or a graph build."""
    _require_document(project_id, document_id)
    draft = load_extraction_draft(project_id, document_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="This document hasn't been extracted yet.")
    draft.reviewed = True
    save_extraction_draft(project_id, draft)

    doc_meta = load_document_meta(project_id, document_id)
    doc_meta.extraction_status = "reviewed"
    save_document_meta(project_id, doc_meta)
    return draft


# ---------- Merge candidates (Review point 2) ----------


@router.post("/projects/{project_id}/merge-candidates/suggest", response_model=list[MergeCandidate])
async def api_suggest_merge_candidates(project_id: str) -> list[MergeCandidate]:
    _require_project(project_id)
    reviewed_names = [
        n.name for d in list_extraction_drafts(project_id) if d.reviewed for n in d.nodes
    ]
    try:
        candidates = await suggest_merge_candidates(reviewed_names)
    except OpenAIError as e:
        raise _openai_error(e)

    # Preserve prior human decisions for the same name pair across re-runs
    # (e.g. after reviewing one more document) -- never reset an answered
    # question back to pending.
    prior_decisions = {
        frozenset((c.node_a_name, c.node_b_name)): c.decision for c in load_merge_candidates(project_id)
    }
    for c in candidates:
        prior = prior_decisions.get(frozenset((c.node_a_name, c.node_b_name)))
        if prior is not None:
            c.decision = prior

    save_merge_candidates(project_id, candidates)
    return candidates


@router.get("/projects/{project_id}/merge-candidates", response_model=list[MergeCandidate])
def api_list_merge_candidates(project_id: str) -> list[MergeCandidate]:
    _require_project(project_id)
    return load_merge_candidates(project_id)


@router.put("/projects/{project_id}/merge-candidates/{candidate_id}", response_model=list[MergeCandidate])
def api_decide_merge_candidate(project_id: str, candidate_id: str, req: MergeDecisionRequest) -> list[MergeCandidate]:
    _require_project(project_id)
    candidates = load_merge_candidates(project_id)
    match = next((c for c in candidates if c.id == candidate_id), None)
    if match is None:
        raise HTTPException(status_code=404, detail="Merge candidate not found.")
    match.decision = req.decision
    save_merge_candidates(project_id, candidates)
    return candidates


# ---------- Graph build + confirm (Review points 3-5) ----------


@router.post("/projects/{project_id}/graph/build", response_model=SystemMapGraph)
def api_build_graph(project_id: str, req: BuildGraphRequest) -> SystemMapGraph:
    """Assembles a PROPOSED graph from every reviewed extraction draft
    (optionally scoped to specific documents) plus confirmed merge
    decisions -- returned for review, never saved as the confirmed graph
    by this endpoint. Call /graph/confirm with the (possibly PM-edited)
    result to actually version it."""
    _require_project(project_id)
    drafts = [d for d in list_extraction_drafts(project_id) if d.reviewed]
    if req.document_ids is not None:
        wanted = set(req.document_ids)
        drafts = [d for d in drafts if d.document_id in wanted]
    decisions = load_merge_candidates(project_id)
    return assemble_graph_from_drafts(drafts, decisions)


@router.post("/projects/{project_id}/graph/confirm", response_model=SystemMapGraph)
def api_confirm_graph(project_id: str, req: ConfirmGraphRequest) -> SystemMapGraph:
    _require_project(project_id)
    save_graph(project_id, req.graph, reason=req.reason)
    return load_graph(project_id)


@router.get("/projects/{project_id}/graph", response_model=SystemMapGraph)
def api_get_graph(project_id: str) -> SystemMapGraph:
    _require_project(project_id)
    return load_graph(project_id)


@router.put("/projects/{project_id}/graph", response_model=SystemMapGraph)
def api_update_graph(project_id: str, graph: SystemMapGraph) -> SystemMapGraph:
    """Direct manual fix to the already-confirmed graph (e.g. correcting a
    PII tag or renaming a system after the fact) -- always its own version,
    same as every other manual-edit save in this app."""
    _require_project(project_id)
    save_graph(project_id, graph, reason="manual edit")
    return graph


@router.get("/projects/{project_id}/graph/versions")
def api_list_graph_versions(project_id: str) -> dict:
    _require_project(project_id)
    return {"versions": list_graph_versions(project_id)}


@router.get("/projects/{project_id}/graph/versions/{version}", response_model=SystemMapGraph)
def api_get_graph_version(project_id: str, version: int) -> SystemMapGraph:
    _require_project(project_id)
    try:
        return load_graph_version(project_id, version)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"No version {version} for this project's graph.")


# ---------- Analysis (NetworkX, confirmed graph only) ----------


@router.get("/projects/{project_id}/graph/analysis/pii", response_model=PiiFlowResult)
def api_analysis_pii(project_id: str, field: str) -> PiiFlowResult:
    _require_project(project_id)
    return trace_pii_flow(load_graph(project_id), field)


@router.get("/projects/{project_id}/graph/analysis/cycles", response_model=CycleReport)
def api_analysis_cycles(project_id: str) -> CycleReport:
    _require_project(project_id)
    return find_cycles(load_graph(project_id))


@router.get("/projects/{project_id}/graph/analysis/orphans", response_model=OrphanReport)
def api_analysis_orphans(project_id: str) -> OrphanReport:
    _require_project(project_id)
    return find_orphans(load_graph(project_id))


@router.get("/projects/{project_id}/graph/analysis/paths", response_model=PathResult)
def api_analysis_paths(project_id: str, source: str, target: str, cutoff: int | None = None) -> PathResult:
    _require_project(project_id)
    return find_paths(load_graph(project_id), source, target, cutoff)


@router.get("/projects/{project_id}/graph/analysis/centrality", response_model=CentralityResult)
def api_analysis_centrality(project_id: str) -> CentralityResult:
    _require_project(project_id)
    return compute_centrality(load_graph(project_id))
