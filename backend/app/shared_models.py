"""Model types shared by multiple tools -- everything else that used to live
alongside these in app/models.py was Flowchart Builder's own, and left with
it when that tool was removed. `DiagramStyle` stays even though nothing
reads its values anymore: it's a field type on `GenerateRequest`, which
Sequence Diagram and Infographic Builder's routes still construct directly,
so it has to ship wherever `GenerateRequest` does.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel


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
