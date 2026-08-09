from __future__ import annotations

from pydantic import BaseModel

from app.llm_client import generate_structured
from app.doc_qa_models import ChatMessage, SummarizeResponse


class _AnswerOnly(BaseModel):
    """Internal-only shape for the LLM call -- AskResponse (in
    doc_qa_models.py) additionally carries the persisted chat history, which
    the model must not be asked to generate itself."""

    answer: str

SUMMARIZE_SYSTEM_PROMPT = """You are summarizing an uploaded document for a product manager who needs \
the gist fast. Given the full document text and an optional focus prompt, write a summary as JSON \
matching the provided schema.

Rules:
- `summary` is 3-6 short paragraphs (or a short paragraph plus a bullet list, using "- " for \
bullets within the text) covering: what the document is, its main points, and anything a reader \
would need to know before diving into the full text.
- Stay grounded in what the document actually says. Do not add outside knowledge, opinions, or \
claims the document doesn't make.
- If a focus prompt is given, weight the summary toward that angle, but still ground everything in \
the document.
"""


async def generate_summary(document_text: str, prompt: str) -> SummarizeResponse:
    user_message = f"Document:\n{document_text}\n\nFocus (optional):\n{prompt}"
    return await generate_structured(SUMMARIZE_SYSTEM_PROMPT, user_message, SummarizeResponse)


ANSWER_SYSTEM_PROMPT = """You are answering questions about an uploaded document. Given the full \
document text, the conversation so far, and a new question, write an answer as JSON matching the \
provided schema.

Rules:
- `answer` is grounded strictly in the document -- do not use outside knowledge. If the document \
doesn't contain the answer, say so plainly rather than guessing.
- Keep the answer as short as fully answering the question allows -- a couple of sentences for a \
simple question, more only if the question genuinely needs it.
- Use the conversation so far for context (e.g. "what about the second one?"), but the document is \
the source of truth, not prior answers.
"""


def _chat_block(history: list[ChatMessage]) -> str:
    if not history:
        return "(none yet)"
    return "\n".join(f"{m.role}: {m.content}" for m in history)


async def generate_answer(document_text: str, history: list[ChatMessage], question: str) -> str:
    user_message = (
        f"Document:\n{document_text}\n\n"
        f"Conversation so far:\n{_chat_block(history)}\n\n"
        f"New question:\n{question}"
    )
    result = await generate_structured(ANSWER_SYSTEM_PROMPT, user_message, _AnswerOnly)
    return result.answer
