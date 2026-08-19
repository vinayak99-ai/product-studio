from __future__ import annotations

from pydantic import BaseModel, Field

from app.llm_client import generate_structured
from app.system_map_models import (
    Criticality,
    ExtractedEdgeDraft,
    ExtractedNodeDraft,
    ExtractionDraft,
    MergeCandidate,
    SourceCitation,
    SystemType,
)

# ---------- Per-document extraction ----------
# Positional/ordinal like every other extraction agent in this app: the LLM
# names systems freely (it has no idea what ids exist elsewhere in the
# project), and Python is the only thing that ever assigns a SYS-/FLOW- id
# -- see system_map_graph.py's merge/confirm step for where names get
# resolved into real node ids.

EXTRACTION_SYSTEM_PROMPT = """You extract systems and data flows between them from a document \
describing a technology integration -- e.g. a transfer agent's system landscape, an interface \
spec, a data dictionary, an architecture note.

For each DISTINCT system/application/platform the document actually names, extract one node:
- name: the system's name, exactly as the document calls it (don't paraphrase or normalize --
  matching near-duplicate names across documents is handled by a separate review step, not here).
- type: classify as transfer_agent, accounting, custodian, payment_processor, compliance, or
  other -- pick the closest fit, "other" if genuinely unclear.
- owning_team: the team/department that owns it, ONLY if the document actually says so -- leave
  blank rather than guessing.
- source_quote: the exact sentence or phrase (copied verbatim from the document) that establishes
  this system exists. Never paraphrase this -- it's shown to a human reviewer as the citation, so
  it must be findable in the source text as written.

For each data flow the document describes between two systems, extract one edge:
- source_system_name / target_system_name: must exactly match the `name` of a node you extracted
  above (or a system clearly named in this document) -- never invent a system name here that
  isn't also extracted as a node.
- fields: the specific data fields/elements exchanged (e.g. "account_number", "nav_value",
  "trade_date") -- only fields the document actually names, never a generic placeholder like
  "data".
- pii_fields: the SUBSET of `fields` that are personally identifiable information -- SSN/TIN,
  date of birth, name, address, account number, tax id, phone, email, and similar. Be precise and
  conservative: only flag a field as PII if it genuinely identifies a person, not every field
  that merely relates to their account.
- transport: how it moves (SFTP, REST API, file drop, message queue, ...) if stated.
- frequency: how often (real-time, daily batch, on-demand, ...) if stated.
- format: file/message format (fixed-width, CSV, XML, JSON, ...) if stated.
- purpose: the business reason (NAV calculation, payment settlement, reconciliation, compliance
  reporting, ...) if stated.
- source_quote: the exact sentence or phrase (verbatim) that establishes this data flow.

Hard rules: extract ONLY what the document explicitly states -- never infer a system or data flow
that isn't actually described. If the document names a system but describes no data flow to/from
it, still extract the node (a system with no flows yet is meaningful -- it'll show up as an
orphan in analysis, which is useful information, not an error). If the document contains no
systems or flows at all, return empty lists rather than inventing content."""


class _ExtractedNodeItem(BaseModel):
    name: str
    type: SystemType = "other"
    owning_team: str = ""
    criticality: Criticality = "medium"
    source_quote: str


class _ExtractedEdgeItem(BaseModel):
    source_system_name: str
    target_system_name: str
    fields: list[str] = Field(default_factory=list)
    pii_fields: list[str] = Field(default_factory=list)
    transport: str = ""
    frequency: str = ""
    format: str = ""
    purpose: str = ""
    source_quote: str


class _ExtractionResult(BaseModel):
    nodes: list[_ExtractedNodeItem] = Field(default_factory=list)
    edges: list[_ExtractedEdgeItem] = Field(default_factory=list)


async def extract_from_document(document_id: str, filename: str, content: str) -> ExtractionDraft:
    result = await generate_structured(EXTRACTION_SYSTEM_PROMPT, content, _ExtractionResult)

    nodes = [
        ExtractedNodeDraft(
            name=n.name,
            type=n.type,
            owning_team=n.owning_team,
            criticality=n.criticality,
            citation=SourceCitation(document_id=document_id, filename=filename, snippet=n.source_quote),
        )
        for n in result.nodes
    ]
    edges = [
        ExtractedEdgeDraft(
            source_system_name=e.source_system_name,
            target_system_name=e.target_system_name,
            fields=e.fields,
            pii_fields=e.pii_fields,
            transport=e.transport,
            frequency=e.frequency,
            format=e.format,
            purpose=e.purpose,
            citation=SourceCitation(document_id=document_id, filename=filename, snippet=e.source_quote),
        )
        for e in result.edges
    ]
    return ExtractionDraft(document_id=document_id, nodes=nodes, edges=edges)


# ---------- Merge-candidate suggestion (entity resolution) ----------
# Fed the deduplicated set of system NAMES across every reviewed extraction
# draft in the project -- deliberately not the full node objects, since the
# only question here is "are these two names probably the same real-world
# system," not a content judgment.

MERGE_SYSTEM_PROMPT = """You review a list of system/application names extracted from multiple \
documents describing the same technology landscape. The same real-world system is often named \
differently across documents (abbreviations, informal names, department nicknames) -- e.g. \
"NAV Accounting System" / "AccSys" / "the accounting platform" may all be the same system.

Identify pairs of names that likely refer to the SAME real-world system. For each pair, give:
- node_a_name / node_b_name: copied verbatim from the input list.
- confidence: "high" if the names are near-certainly the same system (e.g. an obvious
  abbreviation or clear naming variant), "medium" if plausible but genuinely ambiguous, "low" if
  it's a stretch worth flagging but likely wrong.
- rationale: one sentence explaining why you think they're the same system.

Only propose a pair when there's real textual/semantic evidence they're the same system --
never pair two names just because they're both present. If two systems are clearly different
(a transfer agent and an accounting system, say) even if their names are superficially similar,
do not pair them. If nothing looks like a duplicate, return an empty list."""


class _MergeCandidateItem(BaseModel):
    node_a_name: str
    node_b_name: str
    confidence: str
    rationale: str


class _MergeCandidatesResult(BaseModel):
    candidates: list[_MergeCandidateItem] = Field(default_factory=list)


async def suggest_merge_candidates(system_names: list[str]) -> list[MergeCandidate]:
    unique_names = sorted(set(system_names))
    if len(unique_names) < 2:
        return []

    user_message = "\n".join(f"- {name}" for name in unique_names)
    result = await generate_structured(MERGE_SYSTEM_PROMPT, user_message, _MergeCandidatesResult)

    candidates = []
    for i, c in enumerate(result.candidates, start=1):
        # The model's `confidence` isn't constrained to the Literal at the
        # schema level here (kept as a plain str above so a slightly-off
        # value doesn't blow up structured parsing) -- normalize defensively
        # rather than trust it verbatim.
        confidence = c.confidence if c.confidence in ("high", "medium", "low") else "low"
        candidates.append(
            MergeCandidate(
                id=f"MERGE-{i}",
                node_a_name=c.node_a_name,
                node_b_name=c.node_b_name,
                confidence=confidence,  # type: ignore[arg-type]
                rationale=c.rationale,
            )
        )
    return candidates
