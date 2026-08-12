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
label; if the material has no real payload to name, use swimlane or decision_flow instead.
- er: a data model of entities (tables/objects), their fields, and the relationships between them, with \
cardinality (e.g. a database schema, a domain model for a new feature). Best when the material's organizing \
principle is *what data exists and how records relate*, not a process or system-call diagram -- if there's \
no real field-level or cardinality detail, use architecture instead.
- state: a state machine -- the distinct states something can be in and the events/conditions that move it \
from one state to another, including loops back to an earlier or the same state (e.g. an order status \
lifecycle, an account/subscription lifecycle, a job's run states). Best when the material describes a \
single entity's *modes over time* with real transition conditions, not a one-way sequence -- if every step \
happens exactly once with no loops or re-entry, use linear_process or decision_flow instead.
- loop: a circular operating cycle where the last step feeds back into the first and every pass accumulates \
shared state (e.g. a growth flywheel, a PDCA/OODA cycle, a recurring release cadence). Best when the material \
genuinely has no start or end and each cycle deposits something into a common pool -- if the "cycle" actually \
terminates somewhere, use decision_flow or linear_process instead.
- layers: a stack of horizontal tiers where each layer sits strictly above or below the next (e.g. a tech \
stack, the OSI model, a CSS-cascade or abstraction-layer diagram). Best when the material's structure is \
purely vertical rank with no cross-talk between non-adjacent layers -- if layers actually call or depend on \
each other out of order, use architecture instead.
- venn: 2-3 overlapping sets where the point is what they share versus what's unique to each (e.g. a \
market/feature overlap, an ikigai-style desirable x feasible x viable frame). Best when the material is \
genuinely about intersection, not a ranked or sequential relationship -- if there's no real overlap to name, \
or there are 4+ sets, use a different type (a matrix or table handles many-set comparisons better)."""

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
    "er": """## er rules

Each entity is a rectangle with a title bar (the entity/table name, bold) and a short list of fields \
stacked below it, one per row -- name and type (e.g. `id : uuid`, `email : string`). Mark the primary \
key field with a small "PK" tag and any foreign key field with an "FK" tag; do not mark every field, \
only keys. Pick the 3-6 fields that matter to the point being made, not the entity's full real-world \
schema -- a field list exists to establish shape, not to be exhaustive.

Connect related entities with a single line (not an arrow -- relationships are bidirectional), and \
label each end of the line with its cardinality (`1`, `many`, `0..1`, etc.) right where the line meets \
the box. Route lines with a right-angle bend when entities aren't directly across from each other so \
lines don't cross through unrelated boxes.

Give the accent color to exactly one entity (the one the surrounding content is actually about) or to \
one relationship line if the diagram is really about that connection -- never to every entity.

Anti-patterns: do not list every column of a real table -- pick a representative subset; do not draw a \
relationship line without cardinality labels on both ends; do not use an arrowhead on a relationship \
line (that implies direction, which ER relationships don't have); do not cram more than 5-6 entities \
onto one diagram -- if the material has more, pick the ones relevant to the point.""",
    "state": """## state rules

Each state is a rounded rectangle or pill labeled with the state's name. Mark the initial state with a \
small filled circle connected by a short arrow into it (standard state-machine notation); if the \
material has a genuine terminal state, mark it with a circle-in-a-ring. Do not force every diagram to \
have both -- only draw the markers the material actually supports.

Every transition is an arrow labeled with the event or condition that triggers it (e.g. `payment \
received`, `timeout after 24h`) -- never a bare unlabeled arrow, since an unlabeled arrow between \
states is ambiguous. A state that can transition back to itself is a self-loop: a short arrow that \
leaves and re-enters the same box, curved out to the side so it doesn't overlap the box's own border. \
Let transitions curve back to an earlier state when the material genuinely loops -- do not restructure \
a cyclical state machine into a fake top-to-bottom sequence just to avoid backward arrows.

Give the accent color to exactly one state -- the current state or the one the surrounding content is \
about -- never to every state.

Anti-patterns: do not leave any transition arrow unlabeled; do not omit the initial-state marker; do \
not flatten loops/self-transitions into a one-way flow; do not draw two separate arrows for a \
transition that goes both ways between the same two states -- use one line with a label on each \
direction instead.""",
    "loop": """## loop rules

Place 5-8 stations (plain rectangles) at equal angular intervals around a circle, starting at the top \
and proceeding clockwise. Put one larger, filled hub at the center of that circle, representing the \
shared state the cycle accumulates.

Connect each station to the next with a solid curved arrow following the ring, all flowing clockwise. \
Then draw a dashed line from every station in to the hub -- this is the defining signal of a loop \
diagram (it shows each pass writing back to shared state); a loop with only the ring arrows and no \
spokes just reads as a circular process, not a flywheel. Keep spoke and ring lines from crossing each \
other or cutting through the hub.

Give the accent color to at most one station -- an editorial gate or the stage the surrounding content \
is actually about -- never to more than one, and never to the hub itself (the hub stays the plain dark \
fill every loop shares).

Anti-patterns: do not draw more than one hub (that means two separate systems -- split into two \
diagrams); do not make spokes solid (a solid spoke reads as another process step, not a write-back); \
do not space stations unevenly or mix curved ring segments with straight ones; do not exceed 8 \
stations -- if the material has more stages, group them or split into an overview + detail pair; do \
not use this type for a cycle that has a real end -- that is a decision_flow.""",
    "layers": """## layers rules

Stack 4-6 full-width horizontal bands, one per layer, in a single column with the topmost layer drawn \
first. Give every band the same height unless the material genuinely calls for one layer to read as \
bigger (and if so, say why in a caption -- an unexplained height difference reads as a mistake). \
Separate bands with a thin 1px muted hairline; fill every band with the same treatment (either all \
paper with hairlines only, or alternating paper / a very light muted tint) -- pick one and hold it for \
every layer.

Each band holds a left-aligned layer name and, optionally, a short index tag before it (`L1`, `01`) and \
a short right-aligned note after it. If the material has a clear direction (abstraction increasing \
upward, packets flowing downward), add one small arrow with a one-word label just outside the left \
margin -- do not add directional arrows between every pair of layers, one indicator for the whole stack \
is enough.

Give the accent color to exactly one layer -- the bottleneck, the layer under discussion, or the one \
the surrounding content is actually about -- never to every layer.

Anti-patterns: do not use this type for content where layers call back and forth out of strict top-to- \
bottom order (that is architecture, not layers); do not color-code every layer differently (it destroys \
the sense of one stack); do not vary band heights without a stated reason; do not skip a layer's number \
in the index tags without explaining the gap.""",
    "venn": """## venn rules

Draw 2-3 overlapping circles with a thin ink-colored stroke and a very faint fill tint, so the tint \
naturally compounds where circles overlap. Size circles equally only when the underlying sets are \
genuinely comparable; when the material implies one set is meaningfully bigger than another, scale the \
circles proportionally -- never fake equal sizes to make the layout tidy.

Place each set's name outside its circle, never crossing the circle's stroke. Label every overlap \
region directly inside that region, centered; if an overlap is too small to hold its label cleanly, \
draw a short leader line out to clear space instead of cramming text into the sliver.

Give the accent to exactly one intersection region -- the "sweet spot" the surrounding content is \
actually about -- as a light accent-tinted fill on that region only. Never accent more than one region, \
and never accent a whole circle.

Anti-patterns: do not leave any overlap region unlabeled; do not draw non-overlapping circles when the \
material's point is that the sets DO overlap; do not fake equal circle sizes when the sets differ \
meaningfully; do not accent more than one intersection; do not use more than 3 circles -- past that, \
overlaps become unreadable, so use a comparison matrix or table instead.""",
}
