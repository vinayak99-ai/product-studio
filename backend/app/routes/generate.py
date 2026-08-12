from fastapi import APIRouter, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from openai import OpenAIError
from pydantic import ValidationError

from app.archetypes import ArchetypeId
from app.extraction import extract_text
from app.llm import classify_archetype, edit_diagram, generate_architecture_diagram, generate_diagram
from app.models import (
    DiagramStyle,
    EditDiagramRequest,
    ExtractResponse,
    FlowchartDiagram,
    GenerateRequest,
    GenerateResponse,
)
from app.validation import validate_diagram

router = APIRouter(prefix="/api")


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/extract", response_model=ExtractResponse)
async def extract(file: UploadFile) -> ExtractResponse:
    text = await extract_text(file)
    return ExtractResponse(text=text, filename=file.filename or "")


async def _generate_for_style(material: str, prompt: str, diagram_style: DiagramStyle) -> tuple[FlowchartDiagram, ArchetypeId]:
    """Architecture-mode diagrams have no process-flow shape to classify --
    they always resolve to ArchetypeId.custom, which validate_diagram()
    already treats as "skip the process-archetype conformance checks" (see
    validation.py), leaving just the structural checks that still apply to
    a system diagram."""
    if diagram_style == DiagramStyle.architecture:
        diagram = await generate_architecture_diagram(material, prompt)
        return diagram, ArchetypeId.custom

    classification = await classify_archetype(material, prompt)
    diagram = await generate_diagram(material, prompt, archetype=classification.archetype)
    return diagram, classification.archetype


@router.post("/generate", response_model=GenerateResponse)
async def generate(request: GenerateRequest) -> GenerateResponse:
    try:
        diagram, archetype = await _generate_for_style(request.material, request.prompt, request.diagram_style)
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI request failed: {exc}") from exc

    issues = validate_diagram(diagram, archetype=archetype)
    return GenerateResponse(diagram=diagram, issues=issues, archetype=archetype)


@router.post("/edit-diagram", response_model=GenerateResponse)
async def edit_diagram_route(request: EditDiagramRequest) -> GenerateResponse:
    try:
        diagram = await edit_diagram(request.current_diagram, request.instruction, request.diagram_style)
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI request failed: {exc}") from exc

    # No archetype re-classification for an edit -- the diagram already has
    # whatever shape it has, and re-imposing archetype shape guidance mid-edit
    # would fight the user's existing structure. ArchetypeId.custom skips the
    # process-shape conformance checks the same way architecture mode already
    # does, leaving just the structural checks (orphan/dangling/cycle/etc).
    issues = validate_diagram(diagram, archetype=ArchetypeId.custom)
    return GenerateResponse(diagram=diagram, issues=issues, archetype=ArchetypeId.custom)


@router.websocket("/ws/generate")
async def generate_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            payload = await websocket.receive_json()
            try:
                request = GenerateRequest.model_validate(payload)
            except ValidationError as exc:
                await websocket.send_json({"stage": "error", "message": str(exc)})
                continue

            if request.diagram_style == DiagramStyle.architecture:
                # No process shape to classify -- skip straight to calling_llm.
                await websocket.send_json({"stage": "calling_llm"})
                try:
                    diagram = await generate_architecture_diagram(request.material, request.prompt)
                    archetype = ArchetypeId.custom
                except OpenAIError as exc:
                    await websocket.send_json(
                        {"stage": "error", "message": f"OpenAI request failed: {exc}"}
                    )
                    continue
            else:
                await websocket.send_json({"stage": "classifying"})
                try:
                    classification = await classify_archetype(request.material, request.prompt)
                except OpenAIError as exc:
                    await websocket.send_json(
                        {"stage": "error", "message": f"OpenAI request failed: {exc}"}
                    )
                    continue

                await websocket.send_json({"stage": "calling_llm"})
                try:
                    diagram = await generate_diagram(
                        request.material, request.prompt, archetype=classification.archetype
                    )
                    archetype = classification.archetype
                except OpenAIError as exc:
                    await websocket.send_json(
                        {"stage": "error", "message": f"OpenAI request failed: {exc}"}
                    )
                    continue

            await websocket.send_json({"stage": "validating"})
            issues = validate_diagram(diagram, archetype=archetype)

            response = GenerateResponse(diagram=diagram, issues=issues, archetype=archetype)
            await websocket.send_json({"stage": "done", "result": response.model_dump()})
    except WebSocketDisconnect:
        return


@router.websocket("/ws/edit-diagram")
async def edit_diagram_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            payload = await websocket.receive_json()
            try:
                request = EditDiagramRequest.model_validate(payload)
            except ValidationError as exc:
                await websocket.send_json({"stage": "error", "message": str(exc)})
                continue

            await websocket.send_json({"stage": "calling_llm"})
            try:
                diagram = await edit_diagram(request.current_diagram, request.instruction, request.diagram_style)
            except OpenAIError as exc:
                await websocket.send_json({"stage": "error", "message": f"OpenAI request failed: {exc}"})
                continue

            await websocket.send_json({"stage": "validating"})
            issues = validate_diagram(diagram, archetype=ArchetypeId.custom)

            response = GenerateResponse(diagram=diagram, issues=issues, archetype=ArchetypeId.custom)
            await websocket.send_json({"stage": "done", "result": response.model_dump()})
    except WebSocketDisconnect:
        return
