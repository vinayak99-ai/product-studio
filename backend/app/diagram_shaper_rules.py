"""Placement conventions the LLM follows when emitting a typed shape list
directly (Shape/Connector/Group -- see diagram_shaper_models.py), instead of
drawing markup. Written fresh for this tool: conceptually similar to how
Diagram Slides classifies into 5 diagram types with per-type layout rules
(diagram_slide_rules.py), but Diagram Shaper has no shared code with that
tool at all -- the model here outputs coordinates and shape kinds directly,
and two renderers we own (diagram_shaper_svg.py for viewing,
diagram_shaper_pptx.py for export) turn that same JSON into pixels/shapes
deterministically. Color is NOT part of the schema on purpose -- both
renderers decide the actual palette from `accent: bool` alone, so branding
stays consistent regardless of what the model does.
"""

from app.diagram_shaper_models import CANVAS_HEIGHT, CANVAS_WIDTH

DIAGRAM_TYPE_CATALOG = """- linear_process: a sequence of steps that happen in order, one after another, with no \
branching or decisions (e.g. an onboarding flow, a request pipeline, a manufacturing process). \
Best when every step has exactly one predecessor and one successor.
- decision_flow: a process with at least one decision point that branches into different paths \
(e.g. an approval workflow, an eligibility check, an incident-response runbook). Best when the \
material genuinely forks based on a condition, not just a sequence.
- hierarchy: a tree of reporting lines, ownership, or containment (e.g. an org chart, a category \
tree, a component breakdown). Best when items have a parent and zero or more children, with no \
cross-links between branches.
- architecture: a system/ecosystem diagram of components and the data or calls that flow between \
them (e.g. services, databases, integrations, an infrastructure diagram). Best when the content \
describes things that exist at the same time and talk to each other, not a sequence of events.
- timeline: a set of dated or ordered milestones along a single axis (e.g. a project timeline, a \
company history, a release roadmap tied to dates). Best when the content's organizing principle \
is *when*, not *what depends on what*."""

SHARED_PLACEMENT_RULES = f"""## Shared placement rules (apply to every diagram type)

Canvas: place every shape's x/y/w/h inside a {CANVAS_WIDTH}x{CANVAS_HEIGHT} coordinate space, \
with at least 80px of margin on every side.

Shape kind carries meaning, not color -- you never choose a color, the renderer does that from \
`accent` alone:
- oval: start/end terminals only.
- rectangle: a process step, action, or generic component.
- diamond: a decision point with at most 3 outgoing connectors. A decision that needs a 4th or \
more exit should be refactored into nested diamonds instead of one diamond with many exits.
- dot: a small merge point where two branches rejoin -- not a shape with its own label.
- cylinder: a database or data store.
- hexagon: an external or third-party system, outside the boundary of what's being described.

`accent: true` on exactly one shape (or two at most): the happy path's current/critical step, or \
the single most consequential decision. Never mark more than that -- the accent only means \
something if it's rare.

Connectors: every connector needs a `from_id`/`to_id` matching real shape ids. Label any \
connector that could be ambiguous (a branch, a conditional path) -- never leave a decision's exit \
unlabeled. Set `accent: true` on a connector only if it's part of the same one happy-path/critical \
route as an accented shape.

Sizing: shapes are at least 200px wide and 90px tall so labels fit; diamonds need extra width \
(320px+) since their text sits inside the pointed shape. Space siblings at least 40px apart so \
connectors are easy to trace visually.

Self-check before finishing (silently, then output only the final result): does every connector's \
from_id/to_id match a real shape? Is accent used on at most one or two shapes? Is every decision's \
branch labeled? Would removing the least important shape still leave the diagram making its point \
-- if not, it's doing too much and should be simplified."""

DIAGRAM_TYPE_RULES: dict[str, str] = {
    "linear_process": """## linear_process placement

Lay the sequence out as a single row (or, past 6 steps, a single column) of rectangles -- never \
wrap into multiple rows, and never let the chain branch or reconverge. Connect consecutive steps \
with one connector each, left-to-right (or top-to-bottom), no bends.

Anti-pattern: do not add a diamond to a linear_process -- if the material branches, it should \
have been classified decision_flow instead.""",
    "decision_flow": """## decision_flow placement

Flow runs top-to-bottom. Start with an oval, end with an oval. From a decision diamond, the \
conventional exits are: primary/"Yes" path continuing down or to the right, alternate/"No" path \
below or to the side -- pick whichever keeps the diagram from crossing itself. Where two branches \
rejoin, use a dot, not another labeled shape.

Anti-pattern: a decision with 4+ exits (nest diamonds instead); any unlabeled branch.""",
    "hierarchy": """## hierarchy placement

Top-down (root at top) or left-to-right (root at left) -- pick whichever keeps the canvas from \
getting too narrow at deeper levels. Every shape has exactly one parent connector (except the \
root, which has none) -- no cross-links between branches; if the material has cross-links, it \
should have been classified architecture instead. Space siblings evenly at the same depth.

Anti-pattern: connecting shapes across branches (that's architecture territory).""",
    "architecture": """## architecture placement

Use `groups` for anything that shares a real boundary (a team, a system, a network zone) -- \
position the group's box so it fully contains its member shapes' x/y/w/h, and give every grouped \
shape a matching `group_id`. Use cylinder for data stores, hexagon for external/third-party \
systems, rectangle for everything else. Label every connector with what actually moves across it \
(a payload, an event name, a protocol) -- never a bare unlabeled line.

Anti-pattern: using accent to show grouping (the group box already does); leaving any connector \
unlabeled; putting two different component kinds in the same shape kind.""",
    "timeline": """## timeline placement

Place every milestone shape (small dots or rectangles) left-to-right along one horizontal row at \
a consistent y, in chronological order. Alternate labels above/below that row if milestones sit \
close together, so adjacent labels never overlap. No connectors needed between milestones unless \
the material genuinely implies a dependency, not just chronological order.

Anti-pattern: compressing spacing so labels overlap -- widen the canvas usage instead of shrinking \
text.""",
}
