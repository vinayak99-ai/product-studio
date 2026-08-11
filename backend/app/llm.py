from pydantic import BaseModel

from app.archetypes import ARCHETYPES, ArchetypeId
from app.llm_client import generate_structured
from app.models import FlowchartDiagram

CLASSIFY_SYSTEM_PROMPT = """You are a flowchart architect. Given source material and a user \
prompt, decide which canonical diagram shape best fits the process described, before any \
diagram is drawn.

Shapes:
- linear: a single straight chain of steps with no branching.
- approval_gate: a linear lead-in that reaches one decision with approve/reject branches.
- validation_retry: a decision that can loop back to an earlier step until it passes.
- routing_decision: a decision that fans out into three or more distinct downstream paths.
- fork_join: parallel branches that split from one node and reconverge at another.
- custom: none of the above fits; the structure should follow the material directly.

Pick the single best-fitting shape. If the material is ambiguous or mixes shapes, prefer \
custom rather than forcing a poor fit.
"""

SYSTEM_PROMPT = """You are a flowchart architect. Given source material and a user prompt, \
derive a structured flowchart/journey model as JSON matching the provided schema.

Rules:
- Every node needs a short, unique `id` (slug-like, no spaces), a `type` \
(start, end, process, decision, io, or subprocess), and a concise human-readable `label`.
- Exactly one node should have type "start" and at least one node should have type "end", \
unless the material genuinely describes a cyclical process with no clear end.
- Every edge needs a unique `id`, and `source`/`target` that reference existing node ids.
- Use edge type "conditional" for edges leaving a decision node, and set a short `label` \
on those edges (e.g. "Yes" / "No") describing the branch condition.
- Group related nodes under a `DiagramGroup` (with its own `id` and `label`) when the \
material implies distinct phases, actors, or swimlanes; set `group_id` on member nodes. \
Omit groups entirely if there is no natural grouping.
- Do not invent steps that aren't implied by the source material or prompt.
- Keep labels concise (ideally under 8 words).
"""

# Architecture mode has no process-flow semantics (no approval gates, no
# retry loops), so it skips classify_archetype entirely and always resolves
# to ArchetypeId.custom -- validate_diagram() already no-ops the
# archetype-conformance checks for "custom" (see validation.py), which is
# exactly what a system diagram needs: keep the structural checks
# (orphan/dangling/cycle), drop the process-shape ones.
ARCHITECTURE_SYSTEM_PROMPT = """You are a systems architect. Given source material describing a \
system, product ecosystem, or data flow, derive a structured architecture diagram as JSON \
matching the provided schema -- components and how they connect, not a step-by-step process.

Rules:
- Every node needs a short, unique `id` (slug-like, no spaces), a `type`, and a concise \
human-readable `label` (ideally under 4 words -- these are system/component names, not \
sentences).
- Use node type "database" for a data store, cache, or persistence layer (rendered as a \
cylinder). Use "subprocess" for a component that is itself a well-known composite system \
worth visually nesting (rendered with a double border). Use "process" for everything else -- \
services, applications, gateways, connectors, UIs. Do not use "start", "end", or "decision" \
-- those describe process-flow steps, not architecture components.
- Set `is_external` to true on any node that is a third-party vendor, external bank, broker, \
or system outside the organization's own boundary (e.g. a custodian bank, a market data \
vendor) -- it renders as a small badge, not a different shape.
- Define 3-9 `categories` (each a short `id` and a human `label`, e.g. "fx" / "FX") \
representing the distinct domains, teams, or capabilities that own different components -- \
infer these from the material (e.g. by product line, team, or system boundary). Set \
`category_id` on every node to the category that owns it. Every node should have a category \
unless the material gives no basis to assign one.
- Every edge needs a unique `id`, and `source`/`target` that reference existing node ids. \
Edges represent data or control flow between components, not sequential process steps -- \
direction matters (who calls/sends to whom), but there is no notion of branching conditions, \
so leave edge `type` as "default" and do not set edge `label` unless the material names a \
specific data type or protocol flowing across that connection (e.g. "FX Trades").
- Group related components under a `DiagramGroup` (with its own `id` and `label`) only when \
the material describes a genuinely distinct bounded region (e.g. a third-party boundary, an \
accounting pass-through subsystem) -- not merely "these are all backend services". Omit \
groups entirely if nothing in the material implies a bounded region.
- Do not invent components or connections that aren't implied by the source material.
"""


class ArchetypeClassification(BaseModel):
    archetype: ArchetypeId
    reason: str


async def classify_archetype(material: str, prompt: str) -> ArchetypeClassification:
    user_message = f"Source material:\n{material}\n\nInstructions:\n{prompt}"
    return await generate_structured(CLASSIFY_SYSTEM_PROMPT, user_message, ArchetypeClassification)


async def generate_diagram(
    material: str, prompt: str, archetype: ArchetypeId = ArchetypeId.custom
) -> FlowchartDiagram:
    user_message = f"Source material:\n{material}\n\nInstructions:\n{prompt}"

    system_prompt = SYSTEM_PROMPT
    shape_guidance = ARCHETYPES[archetype].shape_guidance
    if shape_guidance:
        system_prompt = f"{SYSTEM_PROMPT}\nShape guidance:\n- {shape_guidance}\n"

    return await generate_structured(system_prompt, user_message, FlowchartDiagram)


async def generate_architecture_diagram(material: str, prompt: str) -> FlowchartDiagram:
    user_message = f"Source material:\n{material}\n\nInstructions:\n{prompt}"
    return await generate_structured(ARCHITECTURE_SYSTEM_PROMPT, user_message, FlowchartDiagram)
