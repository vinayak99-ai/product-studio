from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SystemType = Literal[
    "transfer_agent", "accounting", "custodian", "payment_processor", "compliance", "other"
]
Criticality = Literal["high", "medium", "low"]


class ProjectMeta(BaseModel):
    id: str
    name: str
    created_at: str
    updated_at: str


class SourceCitation(BaseModel):
    """Where a node/edge claim came from -- mirrors kb_models.py's
    KbCitation so every extracted fact stays traceable to the exact
    passage that justified it, never just "some document somewhere"."""

    document_id: str
    filename: str
    snippet: str


class SystemNode(BaseModel):
    id: str = Field(description="e.g. 'SYS-1', sequential, assigned in Python")
    name: str
    type: SystemType = "other"
    owning_team: str = ""
    criticality: Criticality = "medium"
    aliases: list[str] = Field(
        default_factory=list,
        description="Other names this system is referred to by across documents -- populated during merge review.",
    )
    citations: list[SourceCitation] = Field(default_factory=list)


class DataFlowEdge(BaseModel):
    id: str = Field(description="e.g. 'FLOW-1', sequential, assigned in Python")
    source_system_id: str
    target_system_id: str
    fields: list[str] = Field(
        default_factory=list, description="Data fields exchanged, e.g. 'account_number', 'ssn', 'nav_value'"
    )
    pii_fields: list[str] = Field(
        default_factory=list,
        description=(
            "Subset of `fields` that are PII -- always an explicit, human-reviewed list, "
            "never inferred implicitly at analysis time."
        ),
    )
    transport: str = Field(default="", description="e.g. SFTP, REST API, file drop, message queue")
    frequency: str = Field(default="", description="e.g. real-time, daily batch, on-demand")
    format: str = Field(default="", description="e.g. fixed-width, CSV, XML, JSON")
    purpose: str = Field(
        default="", description="Business purpose, e.g. NAV calculation, payment settlement, reconciliation"
    )
    citations: list[SourceCitation] = Field(default_factory=list)


class SystemMapGraph(BaseModel):
    """The confirmed, versioned graph -- the only state analysis (NetworkX)
    ever operates on. Extraction drafts and merge candidates are separate,
    unconfirmed state that never gets analyzed until a human folds it in
    here via the review flow."""

    nodes: list[SystemNode] = Field(default_factory=list)
    edges: list[DataFlowEdge] = Field(default_factory=list)


class ArtifactVersionMeta(BaseModel):
    version: int
    saved_at: str
    reason: str


# ---------- Source documents ----------


class SourceDocumentMeta(BaseModel):
    id: str
    filename: str
    uploaded_at: str
    # "raw" -> goes through LLM extraction; "structured" -> user-supplied
    # JSON, ingested directly (still goes through merge + PII review, just
    # skips the extraction LLM call).
    kind: Literal["raw", "structured"] = "raw"
    extraction_status: Literal["pending", "extracted", "reviewed"] = "pending"


# ---------- Extraction drafts (per-document, pre-merge, pre-graph) ----------
# Positional/ordinal like every other extraction agent in this app: names
# are matched against existing graph nodes by the merge step, never trusted
# as stable ids the way an LLM might echo them back.


class ExtractedNodeDraft(BaseModel):
    name: str
    type: SystemType = "other"
    owning_team: str = ""
    criticality: Criticality = "medium"
    citation: SourceCitation


class ExtractedEdgeDraft(BaseModel):
    source_system_name: str
    target_system_name: str
    fields: list[str] = Field(default_factory=list)
    pii_fields: list[str] = Field(default_factory=list)
    transport: str = ""
    frequency: str = ""
    format: str = ""
    purpose: str = ""
    citation: SourceCitation


class ExtractionDraft(BaseModel):
    """One document's raw extraction output, awaiting per-document review
    (Review point 1) before anything in it can be merged or PII-tagged."""

    document_id: str
    nodes: list[ExtractedNodeDraft] = Field(default_factory=list)
    edges: list[ExtractedEdgeDraft] = Field(default_factory=list)
    reviewed: bool = False


# ---------- Merge candidates (entity resolution -- Review point 2) ----------


class MergeCandidate(BaseModel):
    id: str = Field(description="e.g. 'MERGE-1', sequential, assigned in Python")
    node_a_name: str
    node_b_name: str
    confidence: Literal["high", "medium", "low"]
    rationale: str
    # None while awaiting a human decision; never auto-applied.
    decision: Literal["merge", "keep_separate"] | None = None


# ---------- Graph analysis results (system_map_graph.py) ----------
# All operate on the CONFIRMED graph only -- never on extraction drafts or
# merge candidates, which aren't trustworthy enough to analyze yet.


class PiiFlowResult(BaseModel):
    field: str
    # Every edge that carries this field as PII.
    edges: list[DataFlowEdge] = Field(default_factory=list)
    # Every system reachable downstream from one of those edges -- i.e.
    # everywhere this field could end up once it enters the graph.
    reachable_system_ids: list[str] = Field(default_factory=list)


class CycleReport(BaseModel):
    # Each cycle is an ordered list of system ids that feed back into
    # themselves -- worth a human's attention even if not inherently wrong
    # (e.g. a reconciliation feed looping back is often intentional).
    cycles: list[list[str]] = Field(default_factory=list)


class OrphanReport(BaseModel):
    # Systems with no edges at all -- likely a system mentioned in a
    # document but never actually connected to anything.
    isolated_system_ids: list[str] = Field(default_factory=list)
    # Edges referencing a system id no longer present in the graph -- should
    # not happen through normal use, but worth surfacing if a node was
    # deleted without cleaning up its edges.
    dangling_edge_ids: list[str] = Field(default_factory=list)


class PathResult(BaseModel):
    source_system_id: str
    target_system_id: str
    # Each path is an ordered list of system ids from source to target.
    paths: list[list[str]] = Field(default_factory=list)


class CentralityResult(BaseModel):
    # system_id -> degree centrality score (0-1). Highest scores are the
    # systems most connected to the rest of the mesh -- candidate hubs /
    # single points of failure.
    scores: dict[str, float] = Field(default_factory=dict)


# ---------- Request/response models (routes/system_map.py) ----------


class CreateProjectRequest(BaseModel):
    name: str


class RenameProjectRequest(BaseModel):
    name: str


class MergeDecisionRequest(BaseModel):
    decision: Literal["merge", "keep_separate"]


class StructuredExtractionNode(BaseModel):
    """One system in a caller-supplied (not LLM-extracted) structured JSON
    document -- see StructuredDocumentRequest. `snippet` is optional since a
    caller assembling this by hand may not have a verbatim source quote;
    left blank rather than fabricated."""

    name: str
    type: SystemType = "other"
    owning_team: str = ""
    criticality: Criticality = "medium"
    snippet: str = ""


class StructuredExtractionEdge(BaseModel):
    source_system_name: str
    target_system_name: str
    fields: list[str] = Field(default_factory=list)
    pii_fields: list[str] = Field(default_factory=list)
    transport: str = ""
    frequency: str = ""
    format: str = ""
    purpose: str = ""
    snippet: str = ""


class StructuredDocumentRequest(BaseModel):
    """Ingests a document you've already turned into structured JSON
    yourself, skipping the LLM extraction call (Phase 2's
    extract_from_document) entirely -- still goes through the same
    per-document review (Review point 1), merge review (Review point 2),
    and PII review (Review point 3) as an LLM-extracted document, since
    correctness of PII tagging matters regardless of where the data came
    from."""

    filename: str
    nodes: list[StructuredExtractionNode] = Field(default_factory=list)
    edges: list[StructuredExtractionEdge] = Field(default_factory=list)


class BuildGraphRequest(BaseModel):
    # Which reviewed documents to fold into the proposed graph -- defaults
    # to every reviewed document in the project when omitted, but callers
    # can scope it to just-added documents if they want a narrower rebuild.
    document_ids: list[str] | None = None


class ConfirmGraphRequest(BaseModel):
    graph: SystemMapGraph
    reason: str = "confirmed"
