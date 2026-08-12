"""Style and layout rules the LLM follows when hand-composing a diagram as
inline SVG inside a self-contained HTML document.

Adapted from the MIT-licensed cathrynlavery/diagram-design Claude Agent
Skill (github.com/cathrynlavery/diagram-design) -- specifically its
style-guide.md (grid, color-role, typography rules) and its per-type
references/type-*.md files (shape/layout conventions, anti-patterns). That
skill runs as an interactive multi-step agent session (pick a diagram type
from a table, load that type's reference doc, gather content, compose SVG
by hand, run a self-check). Here the same rules are folded into one system
prompt for a single generate_structured call: DIAGRAM_TYPE_CATALOG plays
the role of the type-selection table, and DIAGRAM_TYPE_RULES plays the role
of each references/type-*.md file, loaded inline instead of as a separate
step. Colors are re-anchored to Product Studio's own validated brand
palette (see infographic_template.py's BRAND_COLORS) instead of the source
repo's defaults, so output from this tool matches the rest of a deck.
"""

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
is *when*, not *what depends on what*.
- swimlane: a cross-functional process where the point is *who* does each step and where work hands off \
between teams (e.g. a vendor onboarding process, a multi-team release process, a RACI-style workflow). \
Best when the material's organizing structure is ownership, not just order -- if there's no meaningful \
split by actor/team, use linear_process or decision_flow instead.
- process: a multi-actor process where the point is *what* moves between steps -- a document, dataset, or \
payload handed from one actor or system to the next (e.g. a data pipeline with named handoffs, an approval \
chain with attached documents). Best when every step-to-step connector needs its own "what's exchanged" \
label; if the material has no real payload to name, use swimlane or decision_flow instead."""

# Shared rules, ported from style-guide.md, re-anchored to Product Studio's
# validated brand palette (infographic_template.py's BRAND_COLORS: primary
# green #00754A, gold accent #C9A227).
SHARED_STYLE_RULES = """## Shared style rules (apply to every diagram type)

Canvas: design for a 1920x1080px canvas (16:9), with at least 64px of margin \
on every side so nothing touches the edge.

Grid: place and size every element on a 4px grid. No off-grid coordinates.

Color roles -- exactly four, used semantically, never decoratively:
- paper: #FFFFFF (or #F7F5F0 for a warm ground) -- the canvas background.
- ink: #14251F -- primary text and default shape strokes/fills.
- muted: #6B7A73 -- secondary text, de-emphasized elements, connector lines.
- accent: #00754A (Product Studio green) -- reserved for the ONE thing that \
matters most in this diagram: the happy path, the current step, the single \
most consequential decision, or the headline milestone. Never apply accent \
to more than one element class at a time. A second accent, #C9A227 (gold), \
may be used ONLY for a distinct secondary signal (e.g. a warning branch) if \
the diagram genuinely needs a second semantic color -- never as decoration.

Typography: a clean sans-serif (system-ui, -apple-system, "Segoe UI", \
sans-serif) for all labels. Titles 28-36px bold, node/step labels 16-20px, \
secondary/caption text 12-14px. Never use a monospace font unless a label is \
literally technical content (a field name, an endpoint path, a status code).

Shape encodes meaning, not color: use different shapes/strokes to distinguish \
element kinds (see per-type rules below). Do not rely on the accent color, or \
any color, to communicate what kind of element something is -- color marks \
importance, shape marks type.

Lines: connectors are 2px, using the muted color, with a small arrowhead \
marker at the destination end. When two connectors must cross and there is no \
way to avoid it, add a small arc "jump" on one of them at the crossing point \
so the crossing reads as unambiguous.

Labels: every connector that could be ambiguous (a branch, a conditional \
path) must carry a text label explaining what it represents. Never leave a \
branch unlabeled.

Self-check before finishing (do this silently, then output only the final \
result): does every shape's form (not its color) tell you what kind of thing \
it is? Is the accent color used on exactly one element or element class? Is \
every branch labeled? If you removed the least important element, would the \
diagram still make its point -- if not, the diagram is doing too much and \
should be simplified."""

DIAGRAM_TYPE_RULES: dict[str, str] = {
    "linear_process": """## linear_process rules

Lay the sequence out as a single row (or, if there are more than 6 steps, a \
single column) of steps -- never wrap into multiple rows/columns, and never \
let the chain branch or reconverge.

Each step is a rounded rectangle (8px corner radius) containing a step number \
and a short label. Connect consecutive steps with a single straight connector \
carrying an arrowhead -- no bends unless the canvas genuinely requires one.

Give exactly one step the accent color and a slightly heavier stroke: the \
step the diagram is actually about (the current step, the critical step, or \
the step the surrounding slide content is describing). Every other step uses \
the ink/muted palette.

Anti-patterns: do not color every step a different hue (color is not an index \
here -- shape and number already do that job); do not add a decision diamond \
to a linear_process -- if the material branches, it should have been \
classified decision_flow instead.""",
    "decision_flow": """## decision_flow rules

Flow runs top-to-bottom. Shape encodes type, not color:
- Start/end points: ovals/stadiums (rx=20).
- Process/action steps: rounded rectangles (rx=6).
- Decisions: diamonds, with at most 3 outgoing edges. If a decision needs a \
4th or more exit, refactor it into nested diamonds instead of one diamond \
with many exits.
- Merge points where two branches rejoin: a small filled dot (r=4), not a \
shape that implies new content.

From a decision diamond, the conventional exits are: "Yes"/primary path to \
the right, "No"/alternate path downward. Label every outgoing edge from a \
decision -- never leave a branch unlabeled.

Give the accent color to exactly one path through the diagram: either the \
"happy path" (the sequence of steps taken when everything goes right) or the \
single most consequential decision -- never every branch, never every box.

Anti-patterns: do not use fill color to distinguish start/process/decision \
(shape does that); do not create a decision with 4+ exits (nest diamonds \
instead); do not leave any branch unlabeled.""",
    "hierarchy": """## hierarchy rules

Lay out top-down (root at top) or left-to-right (root at left) -- pick \
whichever fits the content's depth without the canvas becoming too narrow. \
Every node has exactly one parent (except the root, which has none); there \
are no cross-links between branches -- if the material has cross-links, it \
should have been classified architecture instead.

Nodes are rounded rectangles, sized consistently within the same depth level. \
Space siblings evenly; connectors are simple elbow/orthogonal lines from a \
parent's bottom (or right) edge to each child's top (or left) edge -- never a \
node touching another node directly with no connector.

Depth is communicated by vertical (or horizontal) position, not by color or \
size. Give the accent color to at most one node -- the one the surrounding \
slide content is actually about (e.g. "this is the team we're discussing") -- \
leave it off entirely if no single node is more important than its siblings.

Anti-patterns: do not shrink lower-level nodes to show hierarchy (position \
already shows it, and shrinking hurts legibility); do not connect nodes across \
branches (that is architecture territory, not hierarchy).""",
    "architecture": """## architecture rules

Group related components inside a labeled bounding box when they share a \
boundary (a team, a system, a network zone) -- draw the group box first, \
behind its members, with a muted-color dashed or thin stroke and a small \
label in its top-left corner.

Use a consistent shape per component kind across the whole diagram: e.g. \
rounded rectangles for services/processes, a cylinder shape for \
databases/data stores, a rectangle with a folded corner for documents/files, \
a hexagon for external/third-party systems. Keep the mapping consistent -- \
never use the same shape for two different kinds of component in one diagram.

Arrows show data flow or calls between components and must be directional \
(arrowhead at the receiving end). Label every arrow with what actually moves \
across it (a payload, an event name, a protocol) -- never a bare unlabeled \
line, and never a generic label like "calls" when the material specifies \
what's exchanged.

Give the accent color to at most one flow (the primary/critical path through \
the system) or one component (the one under discussion) -- never color-code \
every component by group (the group boxes already show grouping).

Anti-patterns: do not use color to show grouping (the labeled box does that); \
do not leave any arrow unlabeled; do not mix shape conventions for the same \
kind of component.""",
    "timeline": """## timeline rules

Draw a single horizontal axis line (muted color, 2px) across the canvas. \
Place each milestone as a small filled circle or tick directly on the axis, \
positioned left-to-right in chronological order with even or date-proportional \
spacing -- pick even spacing unless the material's actual date gaps are part \
of the point.

Alternate milestone labels above and below the axis (date/label above, short \
description below, or vice versa) if milestones are close together, so \
adjacent labels never overlap.

Give the accent color to exactly one milestone: the "you are here" point, the \
headline/most important milestone, or the most recent one -- every other \
milestone uses the ink/muted palette with a plain (not accent) tick.

Anti-patterns: do not color-code milestones by category (that dilutes the one \
accent's meaning -- use a shape variant instead if category truly must be \
shown); do not compress the axis so labels overlap -- wrap to a second row of \
labels below the axis instead of shrinking text.""",
    "swimlane": """## swimlane rules

Divide the canvas into horizontal lanes, one per actor/team, each spanning the full width and \
labeled at the left edge. Separate lanes with a thin 1px muted hairline. Size lanes evenly unless \
one team genuinely has more steps than the others -- then give it proportionally more height, never \
so little that its steps overlap.

Each step is a rounded rectangle placed entirely within its owning lane -- never straddling two \
lanes; a step belongs to exactly one team. Flow left-to-right within a lane. Arrows that cross from \
one lane into another represent a handoff between teams and are the most important lines in the \
diagram -- label every handoff with what's being handed off.

Give the accent color to the single most consequential handoff (the one the surrounding slide \
content is about) or to one team's lane if the diagram is really about that team's part -- never to \
every lane, never to every step.

Anti-patterns: do not let a step span two lanes (pick the one team actually responsible); do not \
leave any lane unlabeled; do not let the flow backtrack repeatedly between lanes -- reorder the \
steps so the diagram reads mostly left-to-right.""",
    "process": """## process rules

Lay out as a grid: columns are ordered steps (numbered, left to right), rows are the actors or \
systems involved. Place a node only in the cells where that actor is actually involved in that step \
-- leave every other cell empty, never a placeholder box. Each node is a rounded rectangle carrying \
a short actor/role tag plus the step's action.

Connectors always name what actually moves between two nodes (a document, a dataset, a payload, a \
signal) -- never a bare unlabeled line. Route a connector with a single right-angle bend rather than \
a diagonal when it crosses rows.

Give the accent color to exactly one node -- the step the surrounding content is actually about -- \
and, if useful, match that accent on the connectors directly touching it -- never color-code every \
actor or every step.

Anti-patterns: do not draw a placeholder box in a cell where an actor has no involvement in that step \
-- leave it blank; do not leave any connector unlabeled with what it carries; do not use diagonal \
connectors; do not color-code every row by actor (the row label already shows ownership).""",
}
