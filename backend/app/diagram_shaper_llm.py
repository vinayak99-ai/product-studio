from __future__ import annotations

from app.diagram_shaper_models import DiagramShaperResult
from app.diagram_shaper_rules import (
    DIAGRAM_TYPE_CATALOG,
    DIAGRAM_TYPE_RULES,
    SHARED_PLACEMENT_RULES,
)
from app.llm_client import generate_structured

_TYPE_RULES_BLOCK = "\n\n".join(DIAGRAM_TYPE_RULES[t] for t in DIAGRAM_TYPE_RULES)

SYSTEM_PROMPT = f"""You are a diagram designer who places shapes and connectors directly, by \
coordinate -- not by drawing markup. Given source material and a user prompt, you:

1. Pick the single best-fitting diagram type from this list:
{DIAGRAM_TYPE_CATALOG}

2. Follow that type's specific placement rules below, plus the shared rules that apply to every \
type.

3. Emit `shapes` (each with an id, a kind, x/y/w/h, and a label), `connectors` (from_id/to_id \
matching real shape ids, plus a label where the branch could be ambiguous), and `groups` (only \
for architecture, if the material has real component boundaries) -- exact numeric positions you \
choose, not a description of a layout. Think about where each shape should sit relative to the \
others before assigning coordinates, the way you'd actually sketch it out.

{SHARED_PLACEMENT_RULES}

{_TYPE_RULES_BLOCK}

Output: `diagram_type` (which type you picked), `title` (a short name for the diagram), and the \
`shapes`/`connectors`/`groups` lists above. Base every shape and connector on what the source \
material actually describes -- do not invent steps, systems, or branches it doesn't imply."""


async def generate_diagram_shaper(source_material: str, prompt: str) -> DiagramShaperResult:
    user_message = f"Source material:\n{source_material}\n\nInstructions:\n{prompt}"
    return await generate_structured(SYSTEM_PROMPT, user_message, DiagramShaperResult)
