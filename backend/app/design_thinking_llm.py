from __future__ import annotations

from app.llm_client import generate_structured
from app.design_thinking_models import (
    CLARIFY_ROUND_SIZE,
    CONCEPT_BRIEF_MAX_COUNT,
    CONCEPT_SPARK_MAX_COUNT,
    CONCEPT_SPARK_MIN_COUNT,
    HMW_MAX_COUNT,
    HMW_MIN_COUNT,
    PERSONA_MAX_COUNT,
    PERSONA_MIN_COUNT,
    PROBLEM_STATEMENT_MAX_COUNT,
    AnsweredClarification,
    ClarifyResult,
    ConceptBrief,
    ConceptSpark,
    DefineResponse,
    EmpathizeResponse,
    HowMightWe,
    IdeateHmwResponse,
    IdeateSparksResponse,
    Persona,
    PrototypeResponse,
    ProblemStatement,
    TestResponse,
    ValidationPlan,
)

# ---------- Clarify Agent ----------
# One shared clarify round reused by every stage below -- the stage supplies
# its own label and a rendered block of its current input as context, mirroring
# Spec Builder's run_clarify (app/spec_builder/agents.py) but generalized
# since each stage's input shape differs (raw text, personas, problem
# statements, ...).

CLARIFY_SYSTEM_PROMPT = f"""You are conducting a short, conversational clarification round with a PM \
before a design thinking stage generates its output. Be conversational -- do not dump every possible \
question at once; ask the most important ones first and fill in gaps as you go.

Return at most {CLARIFY_ROUND_SIZE} clarifying questions for THIS round, prioritized by how much the \
answer would actually change the output -- skip anything that's merely nice-to-know. Prefer \
multiple-choice questions with 2-5 mutually exclusive options and a recommended default; use a \
short-answer question only when options don't make sense, and always suggest a likely answer.

You may be called again after the PM answers this round's questions, with their answers included as \
prior context. Do not repeat anything already answered -- only ask a follow-up if an answer surfaced a \
genuinely new, high-impact gap, not just to fill the round.

If the input is already clear enough to generate solid output, return an empty list of questions -- do \
not ask questions just to have something to ask.
"""


def _clarifications_lines(clarifications: list[AnsweredClarification]) -> str:
    return "\n".join(f"- {c.question.question} -> {c.answer}" for c in clarifications)


async def run_clarify_round(
    stage_label: str,
    context_block: str,
    clarifications: list[AnsweredClarification],
) -> ClarifyResult:
    history_block = _clarifications_lines(clarifications) or "(none yet -- this is the first round)"
    prompt = f"""
    Design thinking stage: {stage_label}

    {context_block}

    Already answered in this clarification round:
    {history_block}
    """
    return await generate_structured(CLARIFY_SYSTEM_PROMPT, prompt, ClarifyResult)

PERSONA_SYSTEM_PROMPT = f"""You are a UX researcher running the Empathize stage of design thinking. \
Given raw material (interview notes, support tickets, survey quotes, observations) and an optional \
prompt, derive 1-{PERSONA_MAX_COUNT} personas as JSON matching the provided schema.

Rules:
- `personas` must contain between {PERSONA_MIN_COUNT} and {PERSONA_MAX_COUNT} entries -- one per \
genuinely distinct user type the material actually supports. Never invent a persona the material \
doesn't back up; a single clear persona beats three thin, overlapping ones.
- `name` is a short archetype label (e.g. "Overworked Ops Manager"), not a fictional full name.
- `context` is one sentence on their role/situation.
- `goals` (up to 5): what they're trying to accomplish, in their own terms.
- `pains` (up to 5): what's broken or frustrating for them today.
- `behaviors` (up to 5): what they actually do or say -- direct quotes or observed behavior where \
the material provides them, not assumptions.
- Leave `voices` empty -- that's filled in separately by the PM, not generated.
- Base everything on what the material actually describes. Do not invent goals, pains, or behaviors \
that aren't implied by the material or prompt.
"""


async def generate_personas(
    material: str, prompt: str, clarifications: list[AnsweredClarification]
) -> EmpathizeResponse:
    user_message = (
        f"Source material:\n{material}\n\nInstructions:\n{prompt}\n\n"
        f"Clarifying Q&A with the PM:\n{_clarifications_lines(clarifications) or '(none)'}"
    )
    return await generate_structured(PERSONA_SYSTEM_PROMPT, user_message, EmpathizeResponse)


def personas_block(personas: list[Persona]) -> str:
    lines = []
    for p in personas:
        lines.append(f"- {p.name} ({p.context})")
        if p.goals:
            lines.append(f"  Goals: {'; '.join(p.goals)}")
        if p.pains:
            lines.append(f"  Pains: {'; '.join(p.pains)}")
        if p.voices:
            for v in p.voices:
                lines.append(f"  Voice — {v.name} ({v.role}): {v.input}")
    return "\n".join(lines)


PROBLEM_STATEMENT_SYSTEM_PROMPT = f"""You are running the Define stage of design thinking: turning \
empathy data into a sharp point-of-view (POV) problem statement. Given a list of personas (with \
their goals and pains) and an optional prompt, derive one POV statement per persona as JSON \
matching the provided schema.

Rules:
- `problem_statements` must contain at most {PROBLEM_STATEMENT_MAX_COUNT} entries, one per persona \
given (skip a persona only if the material genuinely gives no basis for a distinct problem).
- `persona_name` must exactly match the persona's `name` as given.
- `user` is a short noun phrase for who (e.g. "an overworked ops manager"), not a full sentence.
- `need` completes "...needs a way to ___" -- the need, as a short phrase, not a solution.
- `insight` completes "...because ___" -- the non-obvious WHY that makes this worth solving, drawn \
from the persona's pains, not a restatement of the need.
- `assembled` is the full sentence: "For {{user}}, {{need}}... because {{insight}}." written \
naturally (you may lightly rephrase user/need/insight to read as one flowing sentence, but keep \
the same meaning).
- This is critical synthesis, not a features list -- do not describe a solution here.
"""


async def generate_problem_statements(
    personas: list[Persona], prompt: str, clarifications: list[AnsweredClarification]
) -> DefineResponse:
    user_message = (
        f"Personas:\n{personas_block(personas)}\n\nInstructions:\n{prompt}\n\n"
        f"Clarifying Q&A with the PM:\n{_clarifications_lines(clarifications) or '(none)'}"
    )
    return await generate_structured(PROBLEM_STATEMENT_SYSTEM_PROMPT, user_message, DefineResponse)


def problem_statements_block(statements: list[ProblemStatement]) -> str:
    return "\n".join(f"- ({s.persona_name}) {s.assembled}" for s in statements)


HMW_SYSTEM_PROMPT = f"""You are running the Ideate stage of design thinking: reframing problem \
statements into "How Might We" (HMW) questions that open up solution space without presupposing an \
answer. Given a list of POV problem statements and an optional prompt, derive HMW questions as \
JSON matching the provided schema.

Rules:
- `how_might_we` must contain between {HMW_MIN_COUNT} and {HMW_MAX_COUNT} entries, covering the \
different problem statements given (don't cluster all of them on just one).
- `question` starts with "How might we" and stays solution-agnostic -- reframe the problem as an \
open question, never smuggle in a specific feature or implementation.
- `rationale` is one short line tying the question back to the specific insight it reframes.
- Leave `selected` as false -- the PM chooses which ones to pursue, not this step.
- Vary the scope across the set: include a few narrow/tactical reframes and at least one broader/ \
more ambitious one, rather than all HMWs sitting at the same altitude.
"""


async def generate_how_might_we(
    statements: list[ProblemStatement], prompt: str, clarifications: list[AnsweredClarification]
) -> IdeateHmwResponse:
    user_message = (
        f"Problem statements:\n{problem_statements_block(statements)}\n\nInstructions:\n{prompt}\n\n"
        f"Clarifying Q&A with the PM:\n{_clarifications_lines(clarifications) or '(none)'}"
    )
    return await generate_structured(HMW_SYSTEM_PROMPT, user_message, IdeateHmwResponse)


def hmw_block(items: list[HowMightWe]) -> str:
    return "\n".join(f"- {h.question} ({h.rationale})" for h in items)


CONCEPT_SPARK_SYSTEM_PROMPT = f"""You are generating concept sparks -- the divergent-thinking part \
of Ideate. Given a list of selected "How Might We" questions and an optional prompt, generate a \
deliberately WIDE set of quick, one-line concept ideas as JSON matching the provided schema. This \
step is about breadth, not depth -- do not narrow to one "best" idea.

Rules:
- `concept_sparks` must contain between {CONCEPT_SPARK_MIN_COUNT} and {CONCEPT_SPARK_MAX_COUNT} \
entries in total, spread across the given HMWs (roughly even coverage, not all on one HMW).
- `how_might_we` must exactly match one of the given HMW questions this spark responds to.
- `idea` is ONE short sentence (under 15 words) -- a quick spark, not a full concept description. \
Vary the kind of idea: some incremental, some more ambitious.
- Exactly ONE spark in the whole set should have `is_wildcard` set to true -- a deliberately \
unconventional or provocative idea included on purpose to break anchoring on the obvious answers. \
All others should have `is_wildcard` false.
- Leave `selected` as false -- the PM narrows the set down, not this step.
- Do not repeat the same idea in different words across sparks.
"""


async def generate_concept_sparks(selected: list[HowMightWe], prompt: str) -> IdeateSparksResponse:
    user_message = f"Selected How Might We questions:\n{hmw_block(selected)}\n\nInstructions:\n{prompt}"
    return await generate_structured(CONCEPT_SPARK_SYSTEM_PROMPT, user_message, IdeateSparksResponse)


def sparks_block(sparks: list[ConceptSpark]) -> str:
    return "\n".join(f"- [{s.how_might_we}] {s.idea}{' (wildcard)' if s.is_wildcard else ''}" for s in sparks)


CONCEPT_BRIEF_SYSTEM_PROMPT = f"""You are running the Prototype stage of design thinking -- not a \
visual prototype, but a concept brief: a concrete enough description of a direction that someone \
could react to it. Given a list of selected concept sparks and an optional prompt, expand each \
into a full concept brief as JSON matching the provided schema.

Rules:
- `concept_briefs` must contain at most {CONCEPT_BRIEF_MAX_COUNT} entries, one per spark given \
(if more sparks than that were selected, pick the strongest and merge close duplicates rather than \
producing a shallow brief for every single one).
- `concept_name` is a short 2-5 word name for the direction.
- `description` is 3-5 sentences: what it is and how it addresses the HMW it came from -- plain \
language a stakeholder would understand, not a technical spec.
- `key_interactions` (up to 5): short bullets on how someone would actually use it.
- `assumptions` (up to 4): what has to be true for this concept to work -- named explicitly, so \
they can be tested later. This is the critical-thinking step: surface what you're taking on faith.
- `biggest_risk` is one sentence on the single biggest way this concept could fail.
"""


async def generate_concept_briefs(
    sparks: list[ConceptSpark], prompt: str, clarifications: list[AnsweredClarification]
) -> PrototypeResponse:
    user_message = (
        f"Selected concept sparks:\n{sparks_block(sparks)}\n\nInstructions:\n{prompt}\n\n"
        f"Clarifying Q&A with the PM:\n{_clarifications_lines(clarifications) or '(none)'}"
    )
    return await generate_structured(CONCEPT_BRIEF_SYSTEM_PROMPT, user_message, PrototypeResponse)


def briefs_block(briefs: list[ConceptBrief]) -> str:
    lines = []
    for b in briefs:
        lines.append(f"- {b.concept_name}: {b.description}")
        if b.assumptions:
            lines.append(f"  Assumptions: {'; '.join(b.assumptions)}")
        lines.append(f"  Biggest risk: {b.biggest_risk}")
    return "\n".join(lines)


VALIDATION_PLAN_SYSTEM_PROMPT = """You are running the Test stage of design thinking -- not a live \
user test, but a validation plan: what you'd want to learn from real users before committing \
further, and how you'd know if a concept is wrong. Given a list of concept briefs (with their \
named assumptions and biggest risk) and an optional prompt, derive a validation plan per concept \
as JSON matching the provided schema.

Rules:
- Produce exactly one `validation_plans` entry per concept brief given, in the same order.
- `concept_name` must exactly match the concept's name as given.
- `hypotheses` (up to 4): turn the concept's named assumptions into testable "We believe ... will \
result in ..." statements -- one hypothesis per assumption where possible, not invented from \
scratch.
- `success_signal` is one sentence: the concrete signal that would tell you the hypothesis held.
- `risk_if_wrong` is one sentence, grounded in the concept's stated biggest risk: what you'd \
actually see happen if the hypothesis is false.
"""


async def generate_validation_plans(
    briefs: list[ConceptBrief], prompt: str, clarifications: list[AnsweredClarification]
) -> TestResponse:
    user_message = (
        f"Concept briefs:\n{briefs_block(briefs)}\n\nInstructions:\n{prompt}\n\n"
        f"Clarifying Q&A with the PM:\n{_clarifications_lines(clarifications) or '(none)'}"
    )
    return await generate_structured(VALIDATION_PLAN_SYSTEM_PROMPT, user_message, TestResponse)
