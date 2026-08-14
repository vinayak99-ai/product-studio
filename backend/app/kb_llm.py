from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from pydantic import BaseModel, Field

from app.kb_models import KbCitation, KbSearchResponse
from app.llm_client import generate_structured

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are answering a question using only the source material provided below \
-- numbered passages retrieved from a knowledge base. Answer strictly from this material; if it \
doesn't cover the question, say so plainly rather than filling the gap with outside knowledge.

Rules:
- Write `answer_markdown` as clear, well-structured markdown: use headings or bold to mark \
distinct points, bullet lists for anything enumerable, and short paragraphs otherwise -- never one \
undifferentiated wall of text. The point is a reader can scan it and get the answer immediately, \
not have to parse dense prose.
- Every claim must trace back to one of the numbered passages. Do not invent a fact, number, or \
detail that isn't in the material.
- Set `cited_passage_numbers` to the passage numbers (the "Passage N" labels below) you actually \
drew on to write the answer -- only the ones that genuinely contributed, not every passage you were \
given. Citation metadata (which file, which collection) is attached automatically from these \
numbers afterward, so you never need to type a filename or ID yourself -- just the numbers.
"""


class _AnswerDraft(BaseModel):
    """Internal LLM-call shape only -- kb_llm builds the real, citation-
    carrying KbSearchResponse from this deterministically (see
    answer_question), rather than trusting the model to echo back exact
    document/collection ids and filenames itself. IDs are exactly the kind
    of thing a model can typo or hallucinate; passage numbers referencing
    material already in its own context window are much safer."""

    answer_markdown: str
    cited_passage_numbers: list[int] = Field(default_factory=list)


@dataclass
class ContextPassage:
    document_id: str
    collection_id: str
    collection_name: str
    filename: str
    heading_path: str
    text: str


def _format_passage(i: int, passage: ContextPassage) -> str:
    return (
        f"--- Passage {i} ---\n"
        f"filename: {passage.filename}\n"
        f"collection_name: {passage.collection_name}\n"
        f"heading_path: {passage.heading_path}\n"
        f"{passage.text}"
    )


def _snippet(passage: ContextPassage, max_chars: int = 220) -> str:
    text = passage.text
    prefix = f"{passage.heading_path}\n\n"
    if passage.heading_path and text.startswith(prefix):
        text = text[len(prefix) :]
    text = " ".join(text.split())
    return text if len(text) <= max_chars else text[:max_chars].rstrip() + "…"


async def answer_question(question: str, passages: list[ContextPassage]) -> KbSearchResponse:
    if not passages:
        return KbSearchResponse(
            answer_markdown=(
                "No matching content was found in the selected collection(s) for this question."
            ),
            citations=[],
        )

    context_block = "\n\n".join(_format_passage(i + 1, p) for i, p in enumerate(passages))
    user_message = f"Question: {question}\n\nSource material:\n{context_block}"
    logger.info("answer_question: calling LLM with %d passage(s), %d char(s) of context", len(passages), len(context_block))
    started = time.monotonic()
    try:
        draft = await generate_structured(SYSTEM_PROMPT, user_message, _AnswerDraft)
    except Exception:
        elapsed_ms = (time.monotonic() - started) * 1000
        logger.exception("answer_question: LLM call FAILED after %.0fms", elapsed_ms)
        raise
    elapsed_ms = (time.monotonic() - started) * 1000
    logger.info("answer_question: LLM call completed in %.0fms, %d cited passage(s)", elapsed_ms, len(draft.cited_passage_numbers))

    citations: list[KbCitation] = []
    seen_documents: set[str] = set()
    for number in draft.cited_passage_numbers:
        index = number - 1
        if index < 0 or index >= len(passages):
            continue  # out-of-range reference -- drop rather than crash on a model slip
        passage = passages[index]
        if passage.document_id in seen_documents:
            continue
        seen_documents.add(passage.document_id)
        citations.append(
            KbCitation(
                document_id=passage.document_id,
                collection_id=passage.collection_id,
                filename=passage.filename,
                collection_name=passage.collection_name,
                heading_path=passage.heading_path,
                snippet=_snippet(passage),
            )
        )

    return KbSearchResponse(answer_markdown=draft.answer_markdown, citations=citations)
