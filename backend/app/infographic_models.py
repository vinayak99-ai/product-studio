from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field

from app.shared_models import ValidationIssue

WHEEL_ITEM_COUNT = 5
COMPARISON_MIN_COLUMNS = 2
COMPARISON_MAX_COLUMNS = 4
COMPARISON_POINT_COUNT = 4
ROADMAP_COLUMN_COUNT = 3
ROADMAP_ITEM_COUNT = 5
PYRAMID_MIN_PILLARS = 3
PYRAMID_MAX_PILLARS = 4
TIMELINE_MIN_MILESTONES = 4
TIMELINE_MAX_MILESTONES = 6
BULLET_MIN_COUNT = 3
BULLET_MAX_COUNT = 6
MATRIX_QUADRANT_COUNT = 4
MATRIX_ITEM_COUNT = 4
HUB_SPOKE_ITEM_COUNT = 6
TITLE_HIGHLIGHT_MIN = 3
TITLE_HIGHLIGHT_MAX = 5
VALUE_PROP_MAX_ITEMS = 3
RACI_MIN_ROWS = 3
RACI_MAX_ROWS = 6
NORTH_STAR_MIN_DRIVERS = 3
NORTH_STAR_MAX_DRIVERS = 5
DECK_MIN_SLIDES = 4
DECK_MAX_SLIDES = 10

InfographicTemplateId = Literal[
    "radial_wheel",
    "comparison_columns",
    "now_next_later",
    "vision_pyramid",
    "quarterly_timeline",
    "bullet_summary",
    "matrix_2x2",
    "feature_story",
    "hub_spoke",
    "title_intro",
    "agenda",
    "value_proposition",
    "positioning_statement",
    "raci_chart",
    "north_star_metric",
]


class WheelItem(BaseModel):
    label: str
    description: str


class InfographicWheel(BaseModel):
    template: Literal["radial_wheel"] = "radial_wheel"
    title: str
    items: list[WheelItem] = Field(default_factory=list)


class ComparisonColumn(BaseModel):
    heading: str
    points: list[str] = Field(default_factory=list)


class InfographicComparison(BaseModel):
    template: Literal["comparison_columns"] = "comparison_columns"
    title: str
    columns: list[ComparisonColumn] = Field(default_factory=list)


class RoadmapColumn(BaseModel):
    heading: str
    items: list[str] = Field(default_factory=list)


class InfographicRoadmap(BaseModel):
    """A Now/Next/Later roadmap: 3 fixed time-horizon columns, closer-term
    horizons rendered visually stronger than farther-out ones."""

    template: Literal["now_next_later"] = "now_next_later"
    title: str
    columns: list[RoadmapColumn] = Field(default_factory=list)


class PyramidPillar(BaseModel):
    label: str
    description: str


class InfographicPyramid(BaseModel):
    """A vision/strategy pyramid: one apex vision statement over 3-4
    supporting pillar bands, widening toward the base."""

    template: Literal["vision_pyramid"] = "vision_pyramid"
    vision: str
    pillars: list[PyramidPillar] = Field(default_factory=list)


class TimelineMilestone(BaseModel):
    period: str
    label: str
    description: str


class InfographicTimeline(BaseModel):
    template: Literal["quarterly_timeline"] = "quarterly_timeline"
    title: str
    milestones: list[TimelineMilestone] = Field(default_factory=list)


class BulletSummarySlide(BaseModel):
    """The fallback shape for content that doesn't fit any of the other
    fixed-layout templates: a plain title + bullet list."""

    template: Literal["bullet_summary"] = "bullet_summary"
    title: str
    bullets: list[str] = Field(default_factory=list)


class MatrixQuadrant(BaseModel):
    label: str
    items: list[str] = Field(default_factory=list)


class InfographicMatrix(BaseModel):
    """A 2x2 grid -- flexible enough for a prioritization matrix (continuous
    axes like Impact/Effort) or a SWOT-style analysis (categorical axes).
    Quadrants are always ordered top-left, top-right, bottom-left,
    bottom-right."""

    template: Literal["matrix_2x2"] = "matrix_2x2"
    title: str
    x_axis_label: str
    y_axis_label: str
    quadrants: list[MatrixQuadrant] = Field(default_factory=list)


class StoryAct(BaseModel):
    heading: str
    body: str
    detail: str


class FeatureStory(BaseModel):
    """A single feature/epic's narrative for a stakeholder update: the
    problem it solves, what was built, and the business impact -- a causal
    3-act arc, not a comparison or a sequence of unrelated items."""

    template: Literal["feature_story"] = "feature_story"
    headline: str
    problem: StoryAct
    solution: StoryAct
    impact: StoryAct


class HubSpokeItem(BaseModel):
    label: str
    description: str


class InfographicHubSpoke(BaseModel):
    """A 6-item hub-and-spoke: a central theme with 6 facets in two side
    columns (3 left, 3 right) connected to the hub by thin ring segments --
    like radial_wheel but for 6 items with cards on both sides instead of
    a single stacked list. `items` is ordered: first 3 = left column
    (top to bottom), last 3 = right column (top to bottom)."""

    template: Literal["hub_spoke"] = "hub_spoke"
    title: str
    description: str
    items: list[HubSpokeItem] = Field(default_factory=list)


class TitleSlide(BaseModel):
    """The deck's opening cover slide: a headline naming what the product
    or initiative actually is, a one-line elaboration, and a handful of
    short capability/pillar tags -- an introduction to everything that
    follows, not a content section itself."""

    template: Literal["title_intro"] = "title_intro"
    title: str
    subtitle: str
    highlights: list[str] = Field(default_factory=list)


class AgendaItem(BaseModel):
    label: str
    page: int


class AgendaSlide(BaseModel):
    """A table-of-contents slide listing every other slide in the deck with
    its page number. In full-deck generation this is always built directly
    from the deck plan (never an LLM call), so the page numbers are
    guaranteed correct; the standalone per-template generator exists for
    manual/single-slide use, where the page numbers are only a starting
    point the PM adjusts once they see the real deck."""

    template: Literal["agenda"] = "agenda"
    title: str = "Agenda"
    items: list[AgendaItem] = Field(default_factory=list)


class ValuePropositionSlide(BaseModel):
    """A Value Proposition Canvas (Osterwalder): the customer's jobs,
    pains, and gains on one side, mapped to the product's offerings, pain
    relievers, and gain creators on the other -- makes the business value
    argument by showing exactly which customer need each part of the
    product answers, rather than asserting value with a metric alone."""

    template: Literal["value_proposition"] = "value_proposition"
    title: str
    customer_jobs: list[str] = Field(default_factory=list)
    customer_pains: list[str] = Field(default_factory=list)
    customer_gains: list[str] = Field(default_factory=list)
    products_services: list[str] = Field(default_factory=list)
    pain_relievers: list[str] = Field(default_factory=list)
    gain_creators: list[str] = Field(default_factory=list)


class PositioningStatementSlide(BaseModel):
    """The Geoffrey Moore positioning statement -- the standard elevator
    pitch mad-lib: "For [target_customer] who [need], [product_name] is a
    [category] that [key_benefit]. Unlike [primary_alternative], we
    [differentiator]." Rendered as one assembled sentence with the filled
    slots visually emphasized, so it reads as a single narrative rather
    than a form."""

    template: Literal["positioning_statement"] = "positioning_statement"
    product_name: str
    target_customer: str
    need: str
    category: str
    key_benefit: str
    primary_alternative: str
    differentiator: str


class RaciRow(BaseModel):
    task: str
    responsible: str
    accountable: str
    consulted: str
    informed: str


class RaciChartSlide(BaseModel):
    """Who owns what for an initiative: one row per task/decision, with a
    name or role in each of the 4 RACI columns -- Responsible (does the
    work), Accountable (owns the outcome), Consulted (input sought),
    Informed (kept in the loop)."""

    template: Literal["raci_chart"] = "raci_chart"
    title: str
    rows: list[RaciRow] = Field(default_factory=list)


class MetricDriver(BaseModel):
    label: str
    metric: str
    description: str


class NorthStarMetricSlide(BaseModel):
    """The North Star Metric framework: one metric that best captures the
    product's core value delivered to customers, plus the 3-5 input/driver
    metrics a team actually pulls to move it -- makes "how we measure
    success" concrete rather than asserting the product is valuable."""

    template: Literal["north_star_metric"] = "north_star_metric"
    north_star: str
    definition: str
    drivers: list[MetricDriver] = Field(default_factory=list)


# Tagged on `template` so a single LLM call's output (and the export request
# body) can be any of these shapes without the caller needing to know which
# one up front -- the classify step is what picks it.
InfographicDiagram = Annotated[
    Union[
        InfographicWheel,
        InfographicComparison,
        InfographicRoadmap,
        InfographicPyramid,
        InfographicTimeline,
        BulletSummarySlide,
        InfographicMatrix,
        FeatureStory,
        InfographicHubSpoke,
        TitleSlide,
        AgendaSlide,
        ValuePropositionSlide,
        PositioningStatementSlide,
        RaciChartSlide,
        NorthStarMetricSlide,
    ],
    Field(discriminator="template"),
]


class GenerateInfographicResponse(BaseModel):
    diagram: InfographicDiagram
    issues: list[ValidationIssue] = Field(default_factory=list)


class DeckSlidePlan(BaseModel):
    template: InfographicTemplateId
    topic: str
    # A short 2-5 word line for this slide's row on the deck's agenda slide
    # (e.g. "Q1-Q3 Rollout Plan") -- kept separate from `topic`, which is a
    # longer, more specific brief for content generation.
    agenda_label: str


class DeckPlan(BaseModel):
    deck_title: str
    slides: list[DeckSlidePlan] = Field(default_factory=list)


class GenerateDeckResponse(BaseModel):
    title: str
    slides: list[InfographicDiagram] = Field(default_factory=list)
    issues: list[ValidationIssue] = Field(default_factory=list)
