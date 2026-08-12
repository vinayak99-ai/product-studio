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


@router.post("/diagram-slide/export")
async def export_diagram_slide_pptx(data: DiagramSlideResult) -> Response:
    png_bytes = await render_html_to_png(data.html)
    pptx_bytes = build_diagram_slide_pptx(png_bytes)
    return Response(
        content=pptx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": 'attachment; filename="diagram-slide.pptx"'},
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
        headers={"Content-Disposition": 'attachment; filename="diagram-slide.png"'},
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
