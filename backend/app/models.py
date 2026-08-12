from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field

from app.archetypes import ArchetypeId


class NodeType(str, Enum):
    start = "start"
    end = "end"
    process = "process"
    decision = "decision"
    io = "io"
    subprocess = "subprocess"
    database = "database"


class EdgeType(str, Enum):
    default = "default"
    conditional = "conditional"


class DiagramCategory(BaseModel):
    """A user/LLM-defined legend entry (e.g. an owning domain like "FX" or
    "Equity") that architecture-mode nodes can be tagged with -- orthogonal
    to `NodeType`, which encodes shape/kind, not ownership."""

    id: str
    label: str


class DiagramNode(BaseModel):
    id: str
    type: NodeType
    label: str
    group_id: str | None = None
    category_id: str | None = None
    # Architecture mode only: renders a small badge (see reference image's
    # green-dot "External Vendor" marker) -- a flag rather than its own
    # NodeType, since externality is orthogonal to shape.
    is_external: bool = False


class DiagramEdge(BaseModel):
    id: str
    source: str
    target: str
    type: EdgeType = EdgeType.default
    label: str | None = None


class DiagramGroup(BaseModel):
    id: str
    label: str


class FlowchartDiagram(BaseModel):
    nodes: list[DiagramNode] = Field(default_factory=list)
    edges: list[DiagramEdge] = Field(default_factory=list)
    groups: list[DiagramGroup] = Field(default_factory=list)
    categories: list[DiagramCategory] = Field(default_factory=list)


class ValidationSeverity(str, Enum):
    error = "error"
    warning = "warning"


class ValidationIssue(BaseModel):
    severity: ValidationSeverity
    code: str
    message: str
    node_id: str | None = None
    edge_id: str | None = None


class DiagramStyle(str, Enum):
    process = "process"
    architecture = "architecture"


class GenerateRequest(BaseModel):
    material: str
    prompt: str
    diagram_style: DiagramStyle = DiagramStyle.process


class EditDiagramRequest(BaseModel):
    """Incremental edit on top of a diagram that may already carry manual
    changes (dragged positions, added/deleted nodes, hand-drawn edges) --
    `current_diagram` is the live canvas state, not the original generation
    result, so the LLM edits what's actually on screen."""

    current_diagram: FlowchartDiagram
    instruction: str
    diagram_style: DiagramStyle = DiagramStyle.process


class GenerateResponse(BaseModel):
    diagram: FlowchartDiagram
    issues: list[ValidationIssue] = Field(default_factory=list)
    archetype: ArchetypeId | None = None


class ExtractResponse(BaseModel):
    text: str
    filename: str
