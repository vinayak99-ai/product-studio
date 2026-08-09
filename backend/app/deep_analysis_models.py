from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# Deliberately much bigger than every other clarify loop in this app (Spec
# Builder: 3/3/8, Design Thinking: 3/2/5) -- Deep Analysis exists to build
# exhaustive context before a problem gets acted on, not to fill in a few
# gaps before drafting. 10 questions/round x 10 rounds = 100 total.
CLARIFY_ROUND_SIZE = 10
CLARIFY_MAX_ROUNDS = 10
CLARIFY_MAX_TOTAL_QUESTIONS = 100


class ClarifyQuestion(BaseModel):
    id: str = Field(description="Short id, e.g. 'Q1', 'Q2'")
    category: str = Field(
        description=(
            "One of: background, prior_attempts, root_cause, stakeholders, "
            "constraints, success_definition, risks, current_state, "
            "scope_boundaries, terminology"
        )
    )
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
            f"Up to {CLARIFY_ROUND_SIZE} highest-impact clarifying questions for THIS "
            "round. Empty list means the problem is already understood deeply enough "
            "to write the analysis."
        ),
    )


class ExtractedProblem(BaseModel):
    problem_statement: str
    known_background: list[str] = Field(default_factory=list)
    known_attempts: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


# ---------- The deliverable -- deliberately NOT PRD-shaped ----------
# A PRD says what to build. This says what to understand first: how the
# problem came to be, what's already been tried, the real root causes, who's
# affected, what's non-negotiable, what "solved" looks like, and what's
# still unknown.


class BackgroundEvent(BaseModel):
    heading: str
    narrative: str


class PriorAttempt(BaseModel):
    name: str
    description: str
    outcome: str
    lesson: str


class RootCause(BaseModel):
    cause: str
    evidence: str


class Consideration(BaseModel):
    heading: str
    detail: str


class OpenRisk(BaseModel):
    risk: str
    why_it_matters: str


class DeepAnalysisDocument(BaseModel):
    title: str
    problem_statement: str
    executive_summary: str
    background: list[BackgroundEvent] = Field(default_factory=list)
    prior_attempts: list[PriorAttempt] = Field(default_factory=list)
    root_causes: list[RootCause] = Field(default_factory=list)
    stakeholder_considerations: list[Consideration] = Field(default_factory=list)
    constraints: list[Consideration] = Field(default_factory=list)
    success_definition: str
    open_risks: list[OpenRisk] = Field(default_factory=list)
    recommended_focus_areas: list[str] = Field(default_factory=list)
    # Set server-side after generation (not by the agent) -- the verbatim
    # answered-question transcript, not something the model should
    # paraphrase or invent. See run_synthesis() in deep_analysis_llm.py.
    clarifications: list[AnsweredClarification] = Field(default_factory=list)


# ---------- Project / persistence shapes ----------


class ProjectMeta(BaseModel):
    id: str
    name: str
    created_at: str
    updated_at: str
    input_updated_at: str | None = None
    last_generated_at: str | None = None


class DeepAnalysisInput(BaseModel):
    # `clarifications` stays untyped dicts (not list[AnsweredClarification])
    # to avoid a circular import between this module and deep_analysis_llm.py
    # -- same reasoning as Spec Builder's SpecInput.
    raw_notes: str = ""
    clarifications: list[dict] = Field(default_factory=list)
    updated_at: str = ""


# ---------- Request/response shapes ----------


class CreateProjectRequest(BaseModel):
    name: str


class RenameProjectRequest(BaseModel):
    name: str


class InputRequest(BaseModel):
    raw_notes: str


class GenerateRequest(BaseModel):
    raw_notes: str


class ClarifyAnswersRequest(BaseModel):
    answers: dict[str, str]
    # Lets the reader end the interview early and get a document from
    # whatever's been gathered so far, instead of being forced through
    # every remaining round -- this tool runs deep by default, but the PM
    # still decides when enough is enough.
    force_generate: bool = False


class GenerateResponse(BaseModel):
    status: Literal["needs_clarification", "generated"]
    questions: list[ClarifyQuestion] = Field(default_factory=list)
    # Returned by the server on every response so the frontend never has to
    # hardcode a duplicate of CLARIFY_MAX_ROUNDS/CLARIFY_MAX_TOTAL_QUESTIONS
    # the way Spec Builder's ClarifyQuestions.tsx currently does.
    round: int = 1
    max_rounds: int = CLARIFY_MAX_ROUNDS
    questions_used: int = 0
    max_questions: int = CLARIFY_MAX_TOTAL_QUESTIONS
    artifact_id: str | None = None
    document: DeepAnalysisDocument | None = None


class ArtifactVersionMeta(BaseModel):
    version: int
    saved_at: str
    reason: str
