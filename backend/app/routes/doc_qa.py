from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, UploadFile
from openai import OpenAIError

from app.extraction import extract_text
from app.doc_qa_llm import generate_answer, generate_summary
from app.doc_qa_models import (
    MAX_DOCUMENT_CHARS,
    AskRequest,
    AskResponse,
    ChatMessage,
    CreateProjectRequest,
    DocQaProjectDetail,
    DocQaProjectMeta,
    RenameProjectRequest,
    SummarizeRequest,
    SummarizeResponse,
)
from app.doc_qa_persistence import (
    append_chat_messages,
    create_project,
    delete_project,
    get_project,
    list_projects,
    load_chat,
    load_document,
    load_summary,
    rename_project,
    save_document,
    save_summary,
)

router = APIRouter(prefix="/api/doc-qa")


def _openai_error(exc: OpenAIError) -> HTTPException:
    return HTTPException(status_code=502, detail=f"OpenAI request failed: {exc}")


def _require_project(project_id: str) -> DocQaProjectMeta:
    try:
        return get_project(project_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Project not found.")


def _detail(project_id: str) -> DocQaProjectDetail:
    return DocQaProjectDetail(
        meta=_require_project(project_id),
        summary=load_summary(project_id),
        chat=load_chat(project_id),
    )


@router.post("/projects", response_model=DocQaProjectMeta)
def api_create_project(request: CreateProjectRequest) -> DocQaProjectMeta:
    return create_project(request.name)


@router.get("/projects", response_model=list[DocQaProjectMeta])
def api_list_projects() -> list[DocQaProjectMeta]:
    return list_projects()


@router.get("/projects/{project_id}", response_model=DocQaProjectDetail)
def api_get_project(project_id: str) -> DocQaProjectDetail:
    return _detail(project_id)


@router.patch("/projects/{project_id}", response_model=DocQaProjectMeta)
def api_rename_project(project_id: str, request: RenameProjectRequest) -> DocQaProjectMeta:
    _require_project(project_id)
    return rename_project(project_id, request.name)


@router.delete("/projects/{project_id}")
def api_delete_project(project_id: str) -> dict:
    delete_project(project_id)
    return {"ok": True}


@router.post("/projects/{project_id}/document", response_model=DocQaProjectDetail)
async def api_upload_document(project_id: str, file: UploadFile) -> DocQaProjectDetail:
    _require_project(project_id)
    text = await extract_text(file)
    if len(text) > MAX_DOCUMENT_CHARS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"That document is too long ({len(text):,} characters; the limit is "
                f"{MAX_DOCUMENT_CHARS:,}). This tool summarizes/answers from the full text in one "
                "pass rather than chunking, so very large documents aren't supported yet."
            ),
        )
    save_document(project_id, file.filename or "document", text)
    return _detail(project_id)


@router.post("/projects/{project_id}/summarize", response_model=SummarizeResponse)
async def api_summarize(project_id: str, request: SummarizeRequest) -> SummarizeResponse:
    _require_project(project_id)
    text = load_document(project_id)
    if not text:
        raise HTTPException(status_code=400, detail="Upload a document first.")
    try:
        result = await generate_summary(text, request.prompt)
    except OpenAIError as exc:
        raise _openai_error(exc) from exc
    save_summary(project_id, result.summary)
    return result


@router.post("/projects/{project_id}/ask", response_model=AskResponse)
async def api_ask(project_id: str, request: AskRequest) -> AskResponse:
    _require_project(project_id)
    text = load_document(project_id)
    if not text:
        raise HTTPException(status_code=400, detail="Upload a document first.")
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Ask something first.")

    history = load_chat(project_id)
    try:
        answer = await generate_answer(text, history, request.question)
    except OpenAIError as exc:
        raise _openai_error(exc) from exc

    now = datetime.now(timezone.utc).isoformat()
    chat = append_chat_messages(
        project_id,
        [
            ChatMessage(role="user", content=request.question, at=now),
            ChatMessage(role="assistant", content=answer, at=now),
        ],
    )
    return AskResponse(answer=answer, chat=chat)
