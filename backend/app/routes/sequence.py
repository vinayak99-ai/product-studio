from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from openai import OpenAIError
from pydantic import ValidationError

from app.shared_models import GenerateRequest
from app.sequence_llm import generate_sequence_diagram
from app.sequence_models import GenerateSequenceResponse
from app.sequence_validation import validate_sequence_diagram

router = APIRouter(prefix="/api")


@router.post("/generate-sequence", response_model=GenerateSequenceResponse)
async def generate_sequence(request: GenerateRequest) -> GenerateSequenceResponse:
    try:
        diagram = await generate_sequence_diagram(request.material, request.prompt)
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI request failed: {exc}") from exc

    issues = validate_sequence_diagram(diagram)
    return GenerateSequenceResponse(diagram=diagram, issues=issues)


@router.websocket("/ws/generate-sequence")
async def generate_sequence_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            payload = await websocket.receive_json()
            try:
                request = GenerateRequest.model_validate(payload)
            except ValidationError as exc:
                await websocket.send_json({"stage": "error", "message": str(exc)})
                continue

            await websocket.send_json({"stage": "calling_llm"})
            try:
                diagram = await generate_sequence_diagram(request.material, request.prompt)
            except OpenAIError as exc:
                await websocket.send_json(
                    {"stage": "error", "message": f"OpenAI request failed: {exc}"}
                )
                continue

            await websocket.send_json({"stage": "validating"})
            issues = validate_sequence_diagram(diagram)

            response = GenerateSequenceResponse(diagram=diagram, issues=issues)
            await websocket.send_json({"stage": "done", "result": response.model_dump()})
    except WebSocketDisconnect:
        return
