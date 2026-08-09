from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

PERSONA_MIN_COUNT = 1
PERSONA_MAX_COUNT = 3
PROBLEM_STATEMENT_MAX_COUNT = 3
HMW_MIN_COUNT = 5
HMW_MAX_COUNT = 8
CONCEPT_SPARK_MIN_COUNT = 6
CONCEPT_SPARK_MAX_COUNT = 10
CONCEPT_BRIEF_MAX_COUNT = 3

# Every stage's primary generation runs behind a short Clarify Agent round --
# same conversational-rounds pattern as Spec Builder's clarify agent, sized
# down since each stage here is a smaller, lighter-weight generation than a
# whole PRD.
CLARIFY_ROUND_SIZE = 3
CLARIFY_MAX_ROUNDS = 2
CLARIFY_MAX_TOTAL_QUESTIONS = 5


class Voice(BaseModel):
    """A real quote or input from a named colleague/role the PM actually
    talked to -- the honest version of "collaboration" for a tool with no
    live multiplayer: makes it visible a persona isn't one person's guess."""

    name: str
    role: str
    input: str


class Persona(BaseModel):
    name: str
    context: str
    goals: list[str] = Field(default_factory=list)
    pains: list[str] = Field(default_factory=list)
    behaviors: list[str] = Field(default_factory=list)
    voices: list[Voice] = Field(default_factory=list)


class ProblemStatement(BaseModel):
    """A Point-of-View statement, assembled as one sentence the way
    positioning_statement does -- reads as a claim, not a filled-in form."""

    persona_name: str
    user: str
    need: str
    insight: str
    assembled: str


class HowMightWe(BaseModel):
    question: str
    rationale: str
    selected: bool = False


class ConceptSpark(BaseModel):
    """One quick, deliberately wide idea -- divergent thinking made visible
    as a step, not skipped straight to a single fleshed-out concept."""

    how_might_we: str
    idea: str
    is_wildcard: bool = False
    selected: bool = False


class ConceptBrief(BaseModel):
    """A narrowed concept, expanded from a selected spark, with the
    assumptions/risks that have to hold for it to work -- critical thinking
    captured at the point of choosing, not as an afterthought."""

    concept_name: str
    description: str
    key_interactions: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    biggest_risk: str


class ValidationPlan(BaseModel):
    concept_name: str
    hypotheses: list[str] = Field(default_factory=list)
    success_signal: str
    risk_if_wrong: str


class DesignThinkingSession(BaseModel):
    problem_area: str
    personas: list[Persona] = Field(default_factory=list)
    problem_statements: list[ProblemStatement] = Field(default_factory=list)
    how_might_we: list[HowMightWe] = Field(default_factory=list)
    concept_sparks: list[ConceptSpark] = Field(default_factory=list)
    concept_briefs: list[ConceptBrief] = Field(default_factory=list)
    validation_plans: list[ValidationPlan] = Field(default_factory=list)


# ---------- Clarify Agent: shared across every stage's primary generation ----------
# Modeled on Spec Builder's clarify agent (app/spec_builder/agents.py): rather
# than generating straight from whatever the PM typed, each stage's primary
# generation call first gets a chance to ask a small, prioritized round of
# questions, feeding prior answers back in so a follow-up round is genuinely
# informed -- not a flat batch. Stateless by design (unlike Spec Builder's
# file-backed pending_clarification): Design Thinking has no server-side
# persistence, so the frontend carries the accumulated answers and round
# number on every request instead.


class ClarifyQuestion(BaseModel):
    id: str = Field(description="Short id, e.g. 'Q1', 'Q2'")
    question: str
    options: list[str] = Field(
        default_factory=list,
        description=(
            "2-5 mutually exclusive options if this is best asked as multiple-choice; "
            "leave empty for a short-answer question."
        ),
    )
    recommended: str | None = Field(
        default=None,
        description=(
            "The recommended choice (must match one of `options` verbatim), or a "
            "suggested short answer if `options` is empty."
        ),
    )


class AnsweredClarification(BaseModel):
    question: ClarifyQuestion
    answer: str


class ClarifyResult(BaseModel):
    questions: list[ClarifyQuestion] = Field(
        default_factory=list,
        description=(
            f"Up to {CLARIFY_ROUND_SIZE} highest-impact clarifying questions for THIS round. "
            "Empty list means the input is already clear enough to generate from."
        ),
    )


# ---------- Stage request/response shapes ----------
# Each stage's primary generation Request carries the clarify state
# (`clarifications` answered so far, which `round` this call is, and an
# escape hatch `force_generate` to skip straight to generation) and its
# Response is a status-discriminated wrapper (needs_clarification | generated)
# around the plain generation output. `concept-sparks` (Ideate's second
# generation step, derived from already-clarified HMWs) is left unwrapped --
# it stays a single-shot batch generation, same as before.


class EmpathizeRequest(BaseModel):
    material: str
    prompt: str = ""
    clarifications: list[AnsweredClarification] = Field(default_factory=list)
    round: int = 1
    force_generate: bool = False


class EmpathizeResponse(BaseModel):
    personas: list[Persona] = Field(default_factory=list)


class EmpathizeResult(BaseModel):
    status: Literal["needs_clarification", "generated"]
    questions: list[ClarifyQuestion] = Field(default_factory=list)
    personas: list[Persona] = Field(default_factory=list)


class DefineRequest(BaseModel):
    personas: list[Persona]
    prompt: str = ""
    clarifications: list[AnsweredClarification] = Field(default_factory=list)
    round: int = 1
    force_generate: bool = False


class DefineResponse(BaseModel):
    problem_statements: list[ProblemStatement] = Field(default_factory=list)


class DefineResult(BaseModel):
    status: Literal["needs_clarification", "generated"]
    questions: list[ClarifyQuestion] = Field(default_factory=list)
    problem_statements: list[ProblemStatement] = Field(default_factory=list)


class IdeateHmwRequest(BaseModel):
    problem_statements: list[ProblemStatement]
    prompt: str = ""
    clarifications: list[AnsweredClarification] = Field(default_factory=list)
    round: int = 1
    force_generate: bool = False


class IdeateHmwResponse(BaseModel):
    how_might_we: list[HowMightWe] = Field(default_factory=list)


class IdeateHmwResult(BaseModel):
    status: Literal["needs_clarification", "generated"]
    questions: list[ClarifyQuestion] = Field(default_factory=list)
    how_might_we: list[HowMightWe] = Field(default_factory=list)


class IdeateSparksRequest(BaseModel):
    how_might_we: list[HowMightWe]
    prompt: str = ""


class IdeateSparksResponse(BaseModel):
    concept_sparks: list[ConceptSpark] = Field(default_factory=list)


class PrototypeRequest(BaseModel):
    concept_sparks: list[ConceptSpark]
    prompt: str = ""
    clarifications: list[AnsweredClarification] = Field(default_factory=list)
    round: int = 1
    force_generate: bool = False


class PrototypeResponse(BaseModel):
    concept_briefs: list[ConceptBrief] = Field(default_factory=list)


class PrototypeResult(BaseModel):
    status: Literal["needs_clarification", "generated"]
    questions: list[ClarifyQuestion] = Field(default_factory=list)
    concept_briefs: list[ConceptBrief] = Field(default_factory=list)


class TestRequest(BaseModel):
    concept_briefs: list[ConceptBrief]
    prompt: str = ""
    clarifications: list[AnsweredClarification] = Field(default_factory=list)
    round: int = 1
    force_generate: bool = False


class TestResponse(BaseModel):
    validation_plans: list[ValidationPlan] = Field(default_factory=list)


class TestResult(BaseModel):
    status: Literal["needs_clarification", "generated"]
    questions: list[ClarifyQuestion] = Field(default_factory=list)
    validation_plans: list[ValidationPlan] = Field(default_factory=list)
