"""Goal-driven Knowledge Base agent -- given a broader goal (not a single
question), searches across every collection through multiple rounds,
reformulating its query when a round doesn't turn up enough, then either
synthesizes an answer or reports exactly what documentation is missing
rather than guessing. See the "goal-driven agent" plan (Part B) for the
full design.

This is an orchestration layer only: retrieval (kb_vector_store) and answer
synthesis (kb_llm.answer_question) are reused exactly as they are for
regular search -- nothing about single-question search changes.

llm_client.py has no native tool-calling (every call in the app is one
system+user message -> one parsed Pydantic model), so "what should the
agent do next" has to ride as a field on a structured response instead of
an actual tool call -- see _AgentStep below.
"""

from __future__ import annotations

import logging
from typing import Literal

from pydantic import BaseModel, Field

from app.kb_llm import ContextPassage, answer_question
from app.kb_models import KbGoalGap, KbGoalResponse
from app.kb_vector_store import expand_to_parent_section, federated_query
from app.llm_client import generate_structured

logger = logging.getLogger(__name__)

# Bounds latency/cost -- each round is a vector search plus at least one LLM
# call. Kept small since this already runs several rounds per goal, unlike
# regular search's single round. The stall check below (a reformulated query
# that adds nothing new) is what actually keeps most runs short in practice
# -- this is just the hard ceiling for goals that genuinely keep turning up
# new material round after round.
MAX_ROUNDS = 3

STEP_SYSTEM_PROMPT = """You are working through a broader goal against a knowledge base, one \
search round at a time. You're given the goal and everything retrieved so far (numbered \
passages, possibly none yet on the first round). Decide what to do next:

- "answer" -- the retrieved material is enough to fully address the goal. Choose this as soon \
as it's true; don't burn extra rounds gathering more than you need.
- "search_again" -- there's a genuine, specific gap in what's been retrieved that another \
search could plausibly close. Set `refined_query` to a distinct, more targeted query -- not a \
rephrasing of the same words, an actually different angle (a related term, a narrower \
sub-topic, a synonym the source material might use instead).
- "report_gap" -- you've looked and the knowledge base plainly does not cover what the goal \
needs, and another search is unlikely to find it. Don't keep searching just because rounds \
remain; recognize when the material isn't there.

You have {rounds_remaining} round(s) left after this one. If that's zero, you must choose \
"answer" or "report_gap" -- there's no more searching after this."""

GAP_SYSTEM_PROMPT = """The goal below could not be fully answered from the knowledge base -- \
either nothing relevant turned up, or what did isn't enough. You're given the goal and whatever \
WAS retrieved (possibly nothing). Identify the specific documentation gaps that explain why -- \
not a generic "not found," concrete topics.

For each gap:
- `topic`: the specific subject that's missing, named plainly (e.g. "vendor SLA terms for \
incident response," not "more details").
- `why_needed`: how this specific gap connects to the stated goal -- why closing it would \
actually move the goal forward.
- `suggested_doc_type`: what kind of document would close it, concrete enough that someone \
could go write or find it (e.g. "an internal runbook covering on-call escalation paths," not \
"a document about processes").

List only real, distinct gaps -- if the retrieved material is already close and only missing \
one specific thing, report one gap, not three restatements of it. If truly nothing was \
retrieved and the goal is broad, it's fine to report one gap describing the whole missing area."""


class _AgentStep(BaseModel):
    """Internal LLM-call shape only -- run_goal() drives control flow
    deterministically off `next_action` rather than trusting the model to
    manage iteration itself, same reasoning as kb_llm._AnswerDraft."""

    next_action: Literal["search_again", "answer", "report_gap"]
    refined_query: str | None = None


class _GapAnalysisDraft(BaseModel):
    gaps: list[KbGoalGap] = Field(default_factory=list)


def _format_passages(passages: list[ContextPassage]) -> str:
    if not passages:
        return "(nothing retrieved yet)"
    blocks = [
        f"--- Passage {i} ---\n"
        f"filename: {p.filename}\n"
        f"collection_name: {p.collection_name}\n"
        f"heading_path: {p.heading_path}\n"
        f"{p.text}"
        for i, p in enumerate(passages, start=1)
    ]
    return "\n\n".join(blocks)


async def _decide_next_step(goal: str, passages: list[ContextPassage], rounds_remaining: int) -> _AgentStep:
    system_prompt = STEP_SYSTEM_PROMPT.format(rounds_remaining=rounds_remaining)
    user_message = f"Goal: {goal}\n\nRetrieved so far:\n{_format_passages(passages)}"
    return await generate_structured(system_prompt, user_message, _AgentStep)


async def _analyze_gaps(goal: str, passages: list[ContextPassage]) -> list[KbGoalGap]:
    user_message = f"Goal: {goal}\n\nRetrieved so far:\n{_format_passages(passages)}"
    draft = await generate_structured(GAP_SYSTEM_PROMPT, user_message, _GapAnalysisDraft)
    return draft.gaps


async def run_goal(goal: str, collection_ids: list[str]) -> KbGoalResponse:
    logger.info("run_goal: goal=%r across %d collection(s)", goal, len(collection_ids))
    accumulated: dict[tuple[str, str], ContextPassage] = {}
    query = goal

    for round_num in range(1, MAX_ROUNDS + 1):
        logger.info("run_goal: round %d query=%r", round_num, query)
        hits = federated_query(collection_ids, query)
        new_count = 0
        for hit in hits:
            metadata = hit["metadata"]
            key = (metadata["document_id"], metadata["heading_path"])
            if key in accumulated:
                continue
            expanded = expand_to_parent_section(
                metadata["collection_id"], metadata["document_id"], metadata["heading_path"]
            )
            accumulated[key] = ContextPassage(
                document_id=metadata["document_id"],
                collection_id=metadata["collection_id"],
                collection_name=metadata["collection_name"],
                filename=metadata["filename"],
                heading_path=metadata["heading_path"],
                text=expanded or hit["text"],
            )
            new_count += 1

        passages = list(accumulated.values())
        rounds_remaining = MAX_ROUNDS - round_num
        # A reformulated query (round 2+) that turns up nothing new is a
        # strong signal another reformulation won't either -- round 1 gets a
        # pass since a single phrasing coming up empty doesn't mean the
        # material isn't there, just that this particular wording missed it.
        # Telling the model it has 0 rounds left (even though technically
        # some remain) reuses the same "commit to answer or report_gap"
        # instruction the real round cap relies on, without another search.
        stalled = round_num >= 2 and new_count == 0
        effective_rounds_remaining = 0 if stalled else rounds_remaining

        step = await _decide_next_step(goal, passages, effective_rounds_remaining)
        logger.info(
            "run_goal: round %d -> %s (%d new, %d accumulated, stalled=%s)",
            round_num,
            step.next_action,
            new_count,
            len(passages),
            stalled,
        )

        if step.next_action == "answer":
            result = await answer_question(goal, passages)
            logger.info("run_goal: answered after %d round(s), %d citation(s)", round_num, len(result.citations))
            return KbGoalResponse(
                answer_markdown=result.answer_markdown,
                citations=result.citations,
                gaps=[],
                rounds_run=round_num,
            )

        if step.next_action == "report_gap" or effective_rounds_remaining == 0:
            gaps = await _analyze_gaps(goal, passages)
            logger.info("run_goal: reporting %d gap(s) after %d round(s)", len(gaps), round_num)
            return KbGoalResponse(answer_markdown=None, citations=[], gaps=gaps, rounds_run=round_num)

        query = step.refined_query or goal

    raise AssertionError("run_goal: loop exited without returning")  # effective_rounds_remaining == 0 always returns above
