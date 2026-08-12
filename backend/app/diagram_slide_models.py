from typing import Literal

from pydantic import BaseModel, Field

DiagramSlideType = Literal[
    "linear_process",
    "decision_flow",
    "hierarchy",
    "architecture",
    "timeline",
    "swimlane",
    "process",
    "er",
    "state",
]


class GenerateDiagramSlideRequest(BaseModel):
    source_material: str
    prompt: str


class DiagramSlideResult(BaseModel):
    diagram_type: DiagramSlideType
    title: str
    html: str = Field(
        description=(
            "A complete, self-contained HTML document (DOCTYPE, <html>, <head> with "
            "inline <style>, <body> containing inline SVG) that renders the diagram. "
            "No external resources -- no linked stylesheets, fonts, scripts, or images."
        )
    )


class GenerateDiagramSlideResponse(BaseModel):
    result: DiagramSlideResult
