from __future__ import annotations

from pydantic import BaseModel, Field

# Roughly 100k tokens of headroom under GPT-4o's 128k context window, leaving
# room for the system prompt, chat history, and the response itself -- a
# generous cap for "one document," not a general-purpose document store.
# Larger documents need real chunking/retrieval, which this tool deliberately
# doesn't do (see doc_qa_llm.py).
MAX_DOCUMENT_CHARS = 400_000


class DocQaProjectMeta(BaseModel):
    id: str
    name: str
    created_at: str
    updated_at: str
    filename: str | None = None
    has_summary: bool = False
    message_count: int = 0


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str
    at: str


class DocQaProjectDetail(BaseModel):
    meta: DocQaProjectMeta
    summary: str | None = None
    chat: list[ChatMessage] = Field(default_factory=list)


class CreateProjectRequest(BaseModel):
    name: str


class RenameProjectRequest(BaseModel):
    name: str


class SummarizeRequest(BaseModel):
    prompt: str = ""


class SummarizeResponse(BaseModel):
    summary: str


class AskRequest(BaseModel):
    question: str


class AskResponse(BaseModel):
    answer: str
    chat: list[ChatMessage] = Field(default_factory=list)
