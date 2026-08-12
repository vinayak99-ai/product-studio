from typing import Literal

from pydantic import BaseModel, Field

DiagramShaperType = Literal[
    "linear_process",
    "decision_flow",
    "hierarchy",
    "architecture",
    "timeline",
]

ShapeKind = Literal["oval", "rectangle", "diamond", "dot", "cylinder", "hexagon"]

# Canvas space every x/y/w/h below is expressed in -- matches the 16:9 slide
# ratio (13.333in x 7.5in) so diagram_shaper_pptx.py can scale coordinates
# straight onto the slide with one multiplier, no separate layout pass.
CANVAS_WIDTH = 1920
CANVAS_HEIGHT = 1080


class Shape(BaseModel):
    id: str
    kind: ShapeKind
    x: float
    y: float
    w: float
    h: float
    label: str = ""
    accent: bool = Field(
        default=False,
        description="True for the ONE shape that matters most (current step, happy-path node) -- never more than one or two per diagram.",
    )
    group_id: str | None = None


class Connector(BaseModel):
    id: str
    from_id: str
    to_id: str
    label: str | None = None
    accent: bool = False


class Group(BaseModel):
    id: str
    label: str
    x: float
    y: float
    w: float
    h: float


class DiagramShaperResult(BaseModel):
    diagram_type: DiagramShaperType
    title: str
    shapes: list[Shape] = Field(default_factory=list)
    connectors: list[Connector] = Field(default_factory=list)
    groups: list[Group] = Field(default_factory=list)


class GenerateDiagramShaperRequest(BaseModel):
    source_material: str
    prompt: str


class GenerateDiagramShaperResponse(BaseModel):
    result: DiagramShaperResult
