from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from openai import OpenAIError
from pydantic import ValidationError

from app.diagram_slide_llm import generate_diagram_slide
from app.diagram_slide_models import (
    GenerateDiagramSlideRequest,
    GenerateDiagramSlideResponse,
)

router = APIRouter(prefix="/api")


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
