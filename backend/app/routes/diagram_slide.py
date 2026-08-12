import re

from fastapi import APIRouter, Response, WebSocket, WebSocketDisconnect
from openai import OpenAIError
from pydantic import ValidationError

from app.diagram_slide_llm import generate_diagram_slide
from app.diagram_slide_models import (
    DiagramSlideResult,
    GenerateDiagramSlideRequest,
    GenerateDiagramSlideResponse,
)
from app.diagram_slide_render import render_html_to_png
from app.diagram_slide_template import build_diagram_slide_pptx

router = APIRouter(prefix="/api")


def _slug(title: str) -> str:
    """Same regex-based slugify as routes/deep_analysis.py's _slug -- kept
    as an independent copy rather than a shared import, matching how that
    file's frontend/backend counterparts are also deliberately kept in
    sync rather than shared. The browser download flow in lib/api.ts
    already names the file client-side via the anchor's `download`
    attribute, which wins over this header in every browser -- this only
    matters to a direct API caller (curl, Postman) that respects
    Content-Disposition."""
    slug = re.sub(r"[^a-z0-9]+", "-", title.strip().lower()).strip("-")[:60].rstrip("-")
    return slug or "diagram-slide"


@router.post("/diagram-slide/export")
async def export_diagram_slide_pptx(data: DiagramSlideResult) -> Response:
    png_bytes = await render_html_to_png(data.html)
    pptx_bytes = build_diagram_slide_pptx(png_bytes)
    return Response(
        content=pptx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{_slug(data.title)}.pptx"'},
    )


@router.post("/diagram-slide/export-png")
async def export_diagram_slide_png(data: DiagramSlideResult) -> Response:
    # Same render used inside the PPTX export -- returned as a standalone
    # file so it can be dropped into PowerPoint (or anywhere else) by hand,
    # e.g. to try PowerPoint's own picture-editing tools directly.
    png_bytes = await render_html_to_png(data.html)
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="{_slug(data.title)}.png"'},
    )


@router.websocket("/ws/generate-diagram-slide")
async def generate_diagram_slide_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            payload = await websocket.receive_json()
            try:
                request = GenerateDiagramSlideRequest.model_validate(payload)
            except ValidationError as exc:
                await websocket.send_json({"stage": "error", "message": str(exc)})
                continue

            await websocket.send_json({"stage": "calling_llm"})
            try:
                result = await generate_diagram_slide(request.source_material, request.prompt)
            except OpenAIError as exc:
                await websocket.send_json(
                    {"stage": "error", "message": f"OpenAI request failed: {exc}"}
                )
                continue

            response = GenerateDiagramSlideResponse(result=result)
            await websocket.send_json({"stage": "done", "result": response.model_dump()})
    except WebSocketDisconnect:
        return
