from fastapi import APIRouter, Response, WebSocket, WebSocketDisconnect
from openai import OpenAIError
from pydantic import ValidationError

from app.diagram_shaper_llm import generate_diagram_shaper
from app.diagram_shaper_models import (
    DiagramShaperResult,
    GenerateDiagramShaperRequest,
)
from app.diagram_shaper_pptx import build_diagram_shaper_pptx
from app.diagram_shaper_svg import render_shapes_to_svg

router = APIRouter(prefix="/api")


@router.post("/diagram-shaper/export")
async def export_diagram_shaper_pptx(data: DiagramShaperResult) -> Response:
    pptx_bytes = build_diagram_shaper_pptx(data)
    return Response(
        content=pptx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": 'attachment; filename="diagram-shaper.pptx"'},
    )


@router.websocket("/ws/generate-diagram-shaper")
async def generate_diagram_shaper_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            payload = await websocket.receive_json()
            try:
                request = GenerateDiagramShaperRequest.model_validate(payload)
            except ValidationError as exc:
                await websocket.send_json({"stage": "error", "message": str(exc)})
                continue

            await websocket.send_json({"stage": "calling_llm"})
            try:
                result = await generate_diagram_shaper(request.source_material, request.prompt)
            except OpenAIError as exc:
                await websocket.send_json(
                    {"stage": "error", "message": f"OpenAI request failed: {exc}"}
                )
                continue

            html = render_shapes_to_svg(result)
            await websocket.send_json(
                {"stage": "done", "result": {"result": result.model_dump(), "html": html}}
            )
    except WebSocketDisconnect:
        return
