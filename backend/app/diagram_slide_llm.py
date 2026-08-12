from __future__ import annotations

from app.diagram_slide_models import DiagramSlideResult
from app.diagram_slide_rules import (
    DIAGRAM_TYPE_CATALOG,
    DIAGRAM_TYPE_RULES,
    SHARED_STYLE_RULES,
)
from app.llm_client import generate_structured

_TYPE_RULES_BLOCK = "\n\n".join(DIAGRAM_TYPE_RULES[t] for t in DIAGRAM_TYPE_RULES)

SYSTEM_PROMPT = f"""You are a diagram designer who hand-composes clean, presentation-ready \
diagrams as inline SVG inside a single self-contained HTML document -- not a graph-layout \
algorithm. Given source material and a user prompt, you:

1. Pick the single best-fitting diagram type from this list:
{DIAGRAM_TYPE_CATALOG}

2. Follow that type's specific layout rules below, plus the shared style rules that apply to \
every type.

3. Compose the diagram as inline SVG coordinates by hand -- do not describe a generic graph and \
let a renderer lay it out. Think about where each element should sit before you place it.

{SHARED_STYLE_RULES}

{_TYPE_RULES_BLOCK}

Output: return `diagram_type` (which type you picked), `title` (a short slide title for the \
diagram), and `html` -- a COMPLETE, self-contained HTML document: <!DOCTYPE html>, <html>, a \
<head> with an inline <style> block (no external stylesheets, fonts, or scripts), and a <body> \
containing one inline <svg viewBox="0 0 1920 1080" width="100%" height="100%"> with the diagram \
drawn inside it. Give <html>, <body>, and the <svg> all `margin: 0; padding: 0` and set body/html \
to `width: 100%; height: 100%` -- the SVG must use width="100%" height="100%" (NOT fixed pixel \
width/height attributes) so it scales to fill whatever box it's placed in while `viewBox` keeps \
every coordinate you drew at the 1920x1080 scale. This document is rendered twice: once \
screenshotted server-side at exactly 1920x1080 for the exported slide, and once shown live in a \
smaller preview box in the app -- it must render identically (just scaled) in both, with nothing \
visible outside the SVG."""


async def generate_diagram_slide(source_material: str, prompt: str) -> DiagramSlideResult:
    user_message = f"Source material:\n{source_material}\n\nInstructions:\n{prompt}"
    return await generate_structured(SYSTEM_PROMPT, user_message, DiagramSlideResult)
