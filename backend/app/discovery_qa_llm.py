from __future__ import annotations

import uuid

from pydantic import BaseModel, Field

from app.discovery_qa_models import CandidateQuestion, CandidateQuestionsResponse, DiscoveryQuestion, EnrichResponse
from app.llm_client import generate_structured

CANDIDATE_MIN_COUNT = 8
CANDIDATE_MAX_COUNT = 12

CANDIDATE_SYSTEM_PROMPT = f"""You are helping a product manager prepare for a live user interview. Given \
a product spec (source material below) and an optional focus prompt, propose interview questions to ask \
a real user in that meeting.

Rules:
- Draw primarily from the spec's "Edge Cases" section -- each edge case is a scenario worth asking a \
real user about (do they actually hit it, how do they expect it to behave, would they even notice). Use \
the rest of the spec only as context to make questions concrete and specific to this product, not to \
generate unrelated questions.
- Return between {CANDIDATE_MIN_COUNT} and {CANDIDATE_MAX_COUNT} candidates, covering a spread of the \
edge cases given, not clustered on just one or two.
- `text` is the actual question you'd ask out loud in the meeting -- plain, conversational, specific \
enough that a user immediately knows what you're asking about. Never a restated edge case ("what about \
X happening?") -- ask what it means for THEM ("if X happened while you were mid-task, what would you \
expect to see?").
- `rationale` is one short line explaining which edge case (or gap) this question is meant to surface, \
shown to the PM during selection, never to the interviewee.
- Do not invent edge cases or requirements that aren't in the spec.
"""


class _CandidateDraft(BaseModel):
    text: str
    rationale: str


class _CandidateDraftResponse(BaseModel):
    candidates: list[_CandidateDraft] = Field(default_factory=list)


async def generate_candidate_questions(prd_markdown: str, prompt: str) -> CandidateQuestionsResponse:
    user_message = f"Spec:\n{prd_markdown}"
    if prompt:
        user_message += f"\n\nFocus:\n{prompt}"
    # The LLM never assigns ids -- generated here, not trusted from the
    # model, same reasoning as kb_llm.py's citation numbers: an opaque id
    # is exactly the kind of thing a model can duplicate or malform, while
    # a fresh uuid per candidate is always correct.
    draft = await generate_structured(CANDIDATE_SYSTEM_PROMPT, user_message, _CandidateDraftResponse)
    candidates = [
        CandidateQuestion(id=f"cand_{uuid.uuid4().hex[:8]}", text=c.text, rationale=c.rationale)
        for c in draft.candidates
    ]
    return CandidateQuestionsResponse(candidates=candidates)


ENRICH_SYSTEM_PROMPT = """You are cleaning up a product manager's raw, live-typed notes from a user \
interview into fuller prose suitable for meeting minutes -- expanding shorthand and fragments into \
complete sentences, fixing obvious typos, and organizing a rambling answer into clear points, while \
staying strictly grounded in what was actually said.

You produce two different things per answered question, not one:
- `enriched_answers` is the cleaned-up answer alone, in the interviewee's voice -- for reading in full \
underneath the question.
- `enriched_bullets` is a single, self-contained sentence that synthesizes the question and the answer \
together into one meeting-minutes bullet point someone can read without also seeing the question -- \
state what was asked and what the interviewee said as one natural statement (e.g. "Asked about a 20-\
minute idle checkout timeout, the interviewee expects a warning banner rather than a silent cart clear."), \
never a mechanical "Question -- Answer" concatenation, and never more than one sentence.

Rules:
- Never invent a detail, opinion, or fact the raw answer doesn't contain -- you are clarifying and \
organizing, not adding new content or speculating about what the user "probably" meant.
- `enriched_answers` and `enriched_bullets` must each be the same length as the numbered list of answers \
given below, in the exact same order -- position N in your response corresponds to answer N in the \
input, not any id or label.
- If a raw answer is already clear and well-formed, light-touch cleanup is fine -- don't pad it just to \
make it longer.
- `enriched_notes` does the same cleanup for the freeform notes block given separately -- organize it \
(e.g. group related points, turn fragments into sentences) without inventing content. If the notes are \
empty, return an empty string.
"""


class _EnrichDraft(BaseModel):
    enriched_answers: list[str] = Field(default_factory=list)
    enriched_bullets: list[str] = Field(default_factory=list)
    enriched_notes: str = ""


def _format_answers(answered: list[DiscoveryQuestion]) -> str:
    lines = []
    for i, q in enumerate(answered, start=1):
        lines.append(f"{i}. Q: {q.text}\n   A: {q.answer}")
    return "\n".join(lines)


async def enrich_session(questions: list[DiscoveryQuestion], notes: str) -> EnrichResponse:
    answered = [q for q in questions if q.answer.strip()]
    user_message = (
        f"Answered questions:\n{_format_answers(answered) or '(none answered yet)'}\n\n"
        f"Freeform notes:\n{notes or '(none)'}"
    )
    draft = await generate_structured(ENRICH_SYSTEM_PROMPT, user_message, _EnrichDraft)

    # Positional mapping back onto the answered subset, then merged back
    # into the full question list -- unanswered questions simply keep an
    # empty enriched_answer/enriched_bullet, they were never sent to the model.
    answers_by_id: dict[str, str] = {}
    bullets_by_id: dict[str, str] = {}
    for i, q in enumerate(answered):
        if i < len(draft.enriched_answers):
            answers_by_id[q.id] = draft.enriched_answers[i]
        if i < len(draft.enriched_bullets):
            bullets_by_id[q.id] = draft.enriched_bullets[i]

    updated_questions = [
        q.model_copy(
            update={
                "enriched_answer": answers_by_id.get(q.id, q.enriched_answer),
                "enriched_bullet": bullets_by_id.get(q.id, q.enriched_bullet),
            }
        )
        for q in questions
    ]
    return EnrichResponse(questions=updated_questions, enriched_notes=draft.enriched_notes)
