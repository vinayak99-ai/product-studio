from __future__ import annotations

from app.llm_client import generate_structured_sync
from app.deep_analysis_models import (
    CLARIFY_MAX_ROUNDS,
    CLARIFY_MAX_TOTAL_QUESTIONS,
    CLARIFY_ROUND_SIZE,
    AnsweredClarification,
    ClarifyResult,
    DeepAnalysisDocument,
    ExtractedProblem,
)

# ---------- Stage 1: Extraction ----------

EXTRACT_SYSTEM_PROMPT = (
    "You extract the core problem from raw notes/a document, ahead of a deep clarification "
    "interview. Only include information present in the notes. `known_background` is any history "
    "or context the notes already give for how this problem came to be; `known_attempts` is any "
    "prior solutions or efforts the notes already mention, even in passing. Flag anything "
    "ambiguous as an open question rather than guessing."
)


def run_extraction(raw_notes: str) -> ExtractedProblem:
    return generate_structured_sync(EXTRACT_SYSTEM_PROMPT, raw_notes, ExtractedProblem)


# ---------- Stage 2: Deep Clarify ----------
# Deliberately much larger budget than every other clarify agent in this app
# (Spec Builder: 3/3/8, Design Thinking: 3/2/5) -- Deep Analysis exists to
# build exhaustive context before a problem gets acted on, so it's given
# real room: up to CLARIFY_ROUND_SIZE questions/round across up to
# CLARIFY_MAX_ROUNDS rounds, CLARIFY_MAX_TOTAL_QUESTIONS total.

CLARIFY_SYSTEM_PROMPT = (
    "You are conducting an EXTENSIVE, thorough clarification interview to build deep context "
    "around a problem before it gets documented for someone else to understand and act on. This "
    f"is not a quick pass -- you have room for up to {CLARIFY_MAX_ROUNDS} rounds and "
    f"{CLARIFY_MAX_TOTAL_QUESTIONS} questions total, and should use that room whenever the "
    "problem genuinely warrants it. Systematically probe, across rounds:\n\n"
    "- background & history: what led to this problem, when it started, how it's evolved\n"
    "- current state: who is affected and how, how the problem shows up day to day\n"
    "- prior attempts: what's already been tried, and specifically why it did or didn't work\n"
    "- root causes: the underlying 'why', not just the visible symptoms\n"
    "- stakeholders: who cares about this and what they each need from a resolution\n"
    "- constraints: non-negotiables -- technical, organizational, timing, budget\n"
    "- success definition: what 'solved' actually looks like, concretely\n"
    "- risks: what could go wrong or what's still unknown\n"
    "- scope & terminology: ambiguous boundaries or terms worth pinning down\n\n"
    f"Return at most {CLARIFY_ROUND_SIZE} clarifying questions for THIS round, prioritized by how "
    "much the answer would deepen or correct the understanding of the problem -- skip anything "
    "merely nice-to-know. Prefer multiple-choice questions with 2-5 mutually exclusive options and "
    "a recommended default; use a short-answer question only when options don't make sense, and "
    "always suggest a likely answer.\n\n"
    "You may be called again after the reader answers this round's questions, with their answers "
    "included as prior context. Do not repeat anything already answered -- only ask a follow-up if "
    "an answer surfaced a genuinely new, high-impact gap, not just to fill the round.\n\n"
    "If the problem is already understood deeply enough to write a comprehensive analysis, return "
    "an empty list of questions -- do not ask questions just to have something to ask, even if the "
    "budget isn't exhausted."
)


def _clarifications_lines(clarifications: list[AnsweredClarification]) -> str:
    return "\n".join(f"- {c.question.question} -> {c.answer}" for c in clarifications)


def run_clarify(extracted: ExtractedProblem, history: list[AnsweredClarification] | None = None) -> ClarifyResult:
    history = history or []
    history_block = _clarifications_lines(history) if history else "(none yet -- this is the first round)"

    prompt = f"""
    Problem: {extracted.problem_statement}
    Known background: {extracted.known_background}
    Known prior attempts: {extracted.known_attempts}
    Already-flagged open questions: {extracted.open_questions}

    Already answered in this interview:
    {history_block}
    """
    return generate_structured_sync(CLARIFY_SYSTEM_PROMPT, prompt, ClarifyResult)


# ---------- Stage 3: Synthesis ----------
# Produces the deliverable -- deliberately NOT PRD-shaped. Grounded strictly
# in the notes and the interview so the reader can trust every claim in it.

SYNTHESIS_SYSTEM_PROMPT = (
    "You are writing a deep, structured analysis document from a problem description and an "
    "extensive clarification interview. The reader needs a comprehensive hold on this problem "
    "before acting on it -- not an implementation plan, a thorough grounding in it. Cover:\n\n"
    "- executive_summary: 3-5 sentences a busy reader can stop after and still understand the "
    "shape of the problem\n"
    "- background: the history/timeline of how this problem came to be, as a sequence of "
    "headed narrative entries\n"
    "- prior_attempts: everything already tried, each with what happened and the lesson it "
    "teaches -- do not invent attempts the notes/interview didn't mention\n"
    "- root_causes: the underlying causes, each with the evidence (from the notes or interview) "
    "that supports it -- not just restated symptoms\n"
    "- stakeholder_considerations: who is affected and what they specifically need\n"
    "- constraints: the non-negotiables that shape any resolution\n"
    "- success_definition: what 'solved' concretely looks like\n"
    "- open_risks: what could still go wrong or remains unknown, and why each matters\n"
    "- recommended_focus_areas: the specific things the reader should look at first -- the "
    "payoff of the whole interview, written so someone skimming only this section still knows "
    "where to start\n\n"
    "Hard rule: ground every claim in the source notes or the interview answers. If something "
    "was never established, leave it out rather than inventing plausible-sounding detail. Give "
    "the document a short, specific `title` (not the raw problem statement verbatim)."
)


def run_synthesis(extracted: ExtractedProblem, history: list[AnsweredClarification]) -> DeepAnalysisDocument:
    prompt = f"""
    Problem: {extracted.problem_statement}
    Known background: {extracted.known_background}
    Known prior attempts: {extracted.known_attempts}

    Full clarification interview:
    {_clarifications_lines(history) or "(none)"}
    """
    document = generate_structured_sync(SYNTHESIS_SYSTEM_PROMPT, prompt, DeepAnalysisDocument)
    document.clarifications = history
    return document
