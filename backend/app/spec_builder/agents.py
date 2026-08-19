from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, Field

from app.llm_client import generate_structured_sync
from .persistence import GlossaryTerm
from .pipeline_agents import (
    CompletenessIssue,
    CompletenessReview,
    PipelineState,
    ScopeCheckVerdict,
    StepId,
    new_pipeline_state,
)

if TYPE_CHECKING:
    from .diffing import DiffEntry

# ---------- Stage 1: Extraction ----------

class ExtractedRequirements(BaseModel):
    problem_statement: str
    goals: list[str]
    target_users: list[str]
    open_questions: list[str]

EXTRACT_SYSTEM_PROMPT = (
    "You extract structured product requirements from raw notes. "
    "Only include information present in the notes. "
    "Flag anything ambiguous as an open question rather than guessing."
)

def run_extraction(raw_notes: str) -> ExtractedRequirements:
    return generate_structured_sync(EXTRACT_SYSTEM_PROMPT, raw_notes, ExtractedRequirements)

# ---------- Stage 2: Clarify ----------
# Modeled on GitHub Spec Kit's /speckit.clarify (structured, prioritized gap
# scanning) plus the conversational cadence from Anthropic's product-management
# plugin's write-spec skill ("be conversational -- do not dump all questions at
# once. Ask the most important ones first and fill in gaps as you go"): rather
# than one flat batch, this runs in small rounds, feeding prior answers back in
# so follow-ups can be genuinely informed by what the PM just said.

ROUND_SIZE = 3           # questions surfaced per round
MAX_ROUNDS = 3           # clarification round-trips before forcing generation
MAX_TOTAL_QUESTIONS = 8  # total questions across all rounds combined

class ClarifyQuestion(BaseModel):
    id: str = Field(description="Short id, e.g. 'Q1', 'Q2'")
    category: str = Field(
        description=(
            "One of: functional_scope, data_model, ux_flow, non_functional, "
            "integrations, edge_cases, constraints, terminology, completion_signals, "
            "success_metrics, prior_art, technical_context"
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
            f"Up to {ROUND_SIZE} highest-impact clarifying questions for THIS round, "
            "prioritized by how much the answer would change the resulting PRD. Empty "
            "list means the requirements are already clear enough to draft from."
        ),
    )

CLARIFY_SYSTEM_PROMPT = (
        "You are conducting a short, conversational clarification round with a PM "
        "before a PRD gets drafted. Be conversational -- do not dump every possible "
        "question at once; ask the most important ones first and fill in gaps as you "
        "go. Evaluate coverage across these categories: functional scope & behavior, "
        "data model, interaction/UX flow, non-functional quality attributes, "
        "integrations & external dependencies, edge cases & failure handling, "
        "constraints & tradeoffs, terminology consistency, completion signals, "
        "success metrics (how we'll know this worked -- leading and lagging "
        "indicators, specific targets), prior art (has this been attempted before, "
        "are there existing solutions or related efforts worth knowing about), and "
        "technical context (is this a new/greenfield build or does it extend an "
        "existing system; if existing, what stack/infra does it already run on and "
        "what integration or migration constraints apply; if greenfield, what "
        "deployment target and constraints matter -- cloud vs. on-prem, compliance, "
        "the team's DevOps maturity). Technical context feeds the Architecture Agent "
        "downstream, so unless the raw notes already make greenfield/brownfield "
        "status unambiguous, always surface at least one technical_context question "
        "in the first round -- don't let it get crowded out by other categories.\n\n"
        f"Return at most {ROUND_SIZE} clarifying questions for THIS round, "
        "prioritized by how much the answer would actually change the resulting "
        "PRD -- skip anything that's merely nice-to-know. Prefer multiple-choice "
        "questions with 2-5 mutually exclusive options and a recommended default; "
        "use a short-answer question only when options don't make sense, and always "
        "suggest a likely answer.\n\n"
        "You may be called again after the PM answers this round's questions, with "
        "their answers included as prior context. Do not repeat anything already "
        "answered -- only ask a follow-up if an answer surfaced a genuinely new, "
        "high-impact gap, not just to fill the round.\n\n"
        "If the requirements are already clear enough to draft a solid PRD, return "
        "an empty list of questions -- do not ask questions just to have something "
        "to ask."
)

def _renumber_questions(result: ClarifyResult, history: list[AnsweredClarification]) -> ClarifyResult:
    """The LLM numbers each round's questions from scratch (its prompt has
    no reason to know how many questions came before), so trusting its `id`
    verbatim risks a later round reusing an id an earlier, already-answered
    question already used -- collapsing them under one React key in any UI
    that accumulates rounds into a single "previously answered" list.
    Renumber here instead, continuing from where prior rounds left off, so
    ids stay unique for the whole clarification conversation -- same
    "never trust the LLM's own id" convention as discovery_qa_llm.py."""
    for i, q in enumerate(result.questions):
        q.id = f"Q{len(history) + i + 1}"
    return result

def run_clarify(
    extracted: ExtractedRequirements,
    history: list[AnsweredClarification] | None = None,
) -> ClarifyResult:
    history = history or []
    if history:
        history_block = "\n".join(f"- {h.question.question} -> {h.answer}" for h in history)
    else:
        history_block = "(none yet -- this is the first round)"

    prompt = f"""
    Problem: {extracted.problem_statement}
    Goals: {extracted.goals}
    Target users: {extracted.target_users}
    Already-flagged open questions: {extracted.open_questions}

    Already answered in this clarification round:
    {history_block}
    """
    result = generate_structured_sync(CLARIFY_SYSTEM_PROMPT, prompt, ClarifyResult)
    return _renumber_questions(result, history)

# ---------- Stage 3: Generation ----------
# Schema modeled on GitHub Spec Kit's spec-template.md: prioritized,
# independently-testable user stories with Given/When/Then acceptance
# scenarios, sequential FR-/SC- numbered requirements and success criteria,
# and key entities only when the feature involves data.

class AcceptanceScenario(BaseModel):
    given: str
    when: str
    then: str

class UserStory(BaseModel):
    title: str = Field(description="Short story title, e.g. 'Guest checkout'")
    priority: str = Field(
        description="P1 (most critical), P2, P3, etc. -- lower number = higher priority"
    )
    description: str = Field(description="The user journey in plain language")
    why_this_priority: str
    independent_test: str = Field(
        description=(
            "How this story can be tested/shipped/demoed on its own, independent "
            "of other stories"
        )
    )
    acceptance_scenarios: list[AcceptanceScenario] = Field(default_factory=list)

class FunctionalRequirement(BaseModel):
    id: str = Field(description="e.g. 'FR-001', sequential")
    text: str = Field(
        description=(
            "'System MUST ...' or 'Users MUST be able to ...' -- one discrete "
            "capability"
        )
    )
    kind: Literal["functional", "non_functional"] = Field(
        default="functional",
        description=(
            "'functional' for a user-facing capability, 'non_functional' for a "
            "quality attribute (performance, security, scalability, reliability, "
            "availability, compliance, ...). Same FR-XXX sequence either way."
        ),
    )

class KeyEntity(BaseModel):
    name: str
    description: str = Field(
        description="What it represents and key attributes, no implementation detail"
    )

class AcceptanceTest(BaseModel):
    id: str = Field(description="e.g. 'AT-001', sequential")
    fr_id: str = Field(description="The FunctionalRequirement.id this test verifies, e.g. 'FR-001'")
    title: str
    given: str
    when: str
    then: str

class Persona(BaseModel):
    id: str = Field(description="e.g. 'PER-1', sequential")
    name: str = Field(description="Short role-based name, e.g. 'Returning Shopper'")
    description: str = Field(description="Who they are, their context and goals")
    pain_points: list[str] = Field(default_factory=list)

class UseCase(BaseModel):
    id: str = Field(description="e.g. 'UC-1', sequential")
    title: str
    actor: str = Field(description="Which persona (by name) performs this use case")
    goal: str
    trigger: str = Field(description="What starts this use case")

class Diagram(BaseModel):
    diagram_type: Literal["journey", "sequence"]
    title: str
    mermaid_source: str = Field(
        description="Valid Mermaid syntax, ready to render as-is -- no markdown code fences."
    )
    png_base64: str | None = Field(
        default=None,
        description=(
            "Base64-encoded PNG rendered client-side from mermaid_source, if any -- "
            "lets the .docx export embed an actual image instead of raw source text."
        ),
    )

class ArchitectureDecision(BaseModel):
    id: str = Field(description="e.g. 'ADR-001', sequential")
    title: str = Field(description="Short, specific decision title")
    context: str = Field(
        description="The forces/constraints driving this decision, drawn from the spec"
    )
    decision: str = Field(description="What is being decided")
    consequences: str = Field(
        description="Trade-offs -- what this enables and what it costs"
    )
    status: Literal["proposed", "accepted"] = "proposed"

class EpicStory(BaseModel):
    id: str = Field(description="e.g. 'STORY-001', sequential across the whole PRD")
    story_type: Literal["functional", "technical"]
    title: str
    description: str
    acceptance_criteria: list[str] = Field(default_factory=list)
    jira_key: str | None = None
    jira_status: str | None = Field(
        default=None,
        description="Raw Jira status name (e.g. 'To Do', 'In Progress', 'Done'), pulled on demand via status sync",
    )
    notes: str | None = Field(
        default=None,
        description="Gaps/inconsistencies flagged by the Enrichment Agent, if any",
    )

class Epic(BaseModel):
    id: str = Field(description="e.g. 'EPIC-1', sequential")
    title: str
    description: str
    stories: list[EpicStory] = Field(default_factory=list)
    jira_key: str | None = None
    jira_status: str | None = Field(
        default=None,
        description="Raw Jira status name (e.g. 'To Do', 'In Progress', 'Done'), pulled on demand via status sync",
    )
    business_impact: Literal["high", "medium", "low"] = Field(
        default="medium",
        description="Coarse business-value score, agent-proposed and PM-editable",
    )
    business_impact_rationale: str = Field(
        default="",
        description="1-2 sentences citing the spec evidence (story priorities, success criteria served) behind the score",
    )

class BriefSection(BaseModel):
    heading: str
    body: str = Field(
        description="Plain prose paragraphs; newline-separated '- ' bullets allowed"
    )

class StakeholderBrief(BaseModel):
    audience: Literal["executive", "engineering", "sales"]
    title: str
    sections: list[BriefSection]
    key_asks: list[str] = Field(
        default_factory=list,
        description="Decisions or support needed from this audience; empty if none",
    )
    # Set server-side after generation (not by the agent): the artifact version
    # this brief was generated at, so the UI can flag briefs the spec has
    # since moved past. None on briefs saved before this field existed.
    source_version: int | None = None

class ComposedUpdate(BaseModel):
    id: str  # "UPD-1" style, assigned in Python
    audience: Literal["all", "executive", "engineering", "sales"]
    from_version: int
    to_version: int
    created_at: str
    title: str
    summary: str
    sections: list[BriefSection]
    decisions_needed: list[str] = Field(default_factory=list)

class GeneratedPRD(BaseModel):
    # No default: the one field always known up front (from the project
    # name) when the artifact is first created, before Overview even runs.
    title: str
    # ---- Step 1: Overview ----
    problem_statement: str = ""
    goals: list[str] = Field(default_factory=list)
    target_users: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    personas: list[Persona] = Field(default_factory=list)
    use_cases: list[UseCase] = Field(default_factory=list)
    # ---- Step 2: User Stories + Edge Cases ----
    # Defaulted to empty (not required) -- the pipeline creates one
    # GeneratedPRD per project incrementally, step by step, so most of these
    # lists genuinely don't exist yet for a fresh project.
    user_stories: list[UserStory] = Field(default_factory=list)
    edge_cases: list[str] = Field(default_factory=list)
    # ---- Step 3: Functional Requirements ----
    functional_requirements: list[FunctionalRequirement] = Field(default_factory=list)
    key_entities: list[KeyEntity] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    # ---- Step 4: Test Cases (per-FR acceptance tests) ----
    test_cases: list[AcceptanceTest] = Field(default_factory=list)
    diagrams: list[Diagram] = Field(default_factory=list)
    # ---- Step 5: Architecture ----
    architecture_decisions: list[ArchitectureDecision] = Field(default_factory=list)
    technical_context: list[AnsweredClarification] = Field(
        default_factory=list,
        description=(
            "The technical_context-category clarification answers (greenfield vs. "
            "existing system, stack, deployment constraints) that informed the "
            "architecture decisions -- persisted so it survives past the initial "
            "generate flow and is available when architecture is regenerated."
        ),
    )
    architecture_clarify_history: list[AnsweredClarification] = Field(
        default_factory=list,
        description=(
            "Answered rounds from the interactive architecture clarify Q&A "
            "(run_architecture_clarify) -- persisted alongside technical_context "
            "so both are available whenever architecture is revisited."
        ),
    )
    # ---- Step 6: Epics ----
    epics: list[Epic] = Field(default_factory=list)
    briefs: list[StakeholderBrief] = Field(default_factory=list)
    updates: list[ComposedUpdate] = Field(default_factory=list)
    # ---- Pipeline metadata ----
    pipeline: PipelineState = Field(default_factory=new_pipeline_state)
    completeness_review: CompletenessReview | None = None

# ---------- Step 1: Overview ----------
# Refines the raw extraction + clarification answers into the spec's
# problem/goals/target_users/open_questions, and adds personas + use cases.
# This is the first pipeline step; every downstream step consumes its
# confirmed output rather than the raw notes directly.

class OverviewResult(BaseModel):
    problem_statement: str
    goals: list[str]
    target_users: list[str]
    open_questions: list[str] = Field(default_factory=list)
    personas: list[Persona] = Field(default_factory=list)
    use_cases: list[UseCase] = Field(default_factory=list)

OVERVIEW_SYSTEM_PROMPT = (
    "You are a senior PM writing the Overview section of a spec, following "
    "GitHub Spec Kit's spec.md structure. Given extracted requirements and "
    "any clarifying Q&A:\n\n"
    "- Restate the problem statement, goals, and target users clearly and "
    "specifically -- refine the extracted draft, don't just echo it "
    "verbatim, and fold in anything the clarification answers settled.\n"
    "- Carry forward any open questions not resolved by the clarification "
    "answers.\n"
    "- Draft personas: the distinct user roles/segments implied by the "
    "target users and clarification answers, each with a short role-based "
    "name, a description of who they are and what they need, and their "
    "pain points.\n"
    "- Draft use cases: the concrete goal-directed interactions each "
    "persona has with the feature -- title, which persona is the actor, "
    "their goal, and what triggers the use case.\n\n"
    "Treat the clarification answers as authoritative -- do not contradict "
    "them. Do not invent personas or use cases not implied by the input."
)

def run_overview(
    extracted: ExtractedRequirements,
    history: list[AnsweredClarification] | None = None,
) -> OverviewResult:
    history = history or []
    clarifications_block = (
        "\n".join(f"- {h.question.question} -> {h.answer}" for h in history)
        if history else "(none)"
    )

    prompt = f"""
    Problem: {extracted.problem_statement}
    Goals: {extracted.goals}
    Target users: {extracted.target_users}
    Open questions: {extracted.open_questions}
    Clarifications:
    {clarifications_block}
    """
    return generate_structured_sync(OVERVIEW_SYSTEM_PROMPT, prompt, OverviewResult)

# ---------- Step 2: User Stories + Edge Cases ----------

class StoriesResult(BaseModel):
    user_stories: list[UserStory]
    edge_cases: list[str] = Field(default_factory=list)

STORIES_SYSTEM_PROMPT = (
    "You write prioritized user stories from a confirmed spec Overview "
    "(problem, goals, target users, personas, use cases), following GitHub "
    "Spec Kit's spec.md structure.\n\n"
    "- Write prioritized user stories (P1 = most critical) that are each "
    "independently testable/shippable/demoable on their own. Give each a "
    "short title, a plain-language description, a 'why this priority' "
    "justification, an 'independent test' explaining how it can be verified "
    "standalone, and Given/When/Then acceptance scenarios. Ground each "
    "story in the given personas and use cases -- every use case should be "
    "reflected in at least one story.\n"
    "- List edge cases worth calling out -- unusual inputs, failure modes, "
    "boundary conditions implied by the use cases.\n\n"
    "Do not invent stories or edge cases not implied by the Overview."
)

def run_stories(overview: OverviewResult) -> StoriesResult:
    personas_block = "\n".join(f"- {p.name}: {p.description}" for p in overview.personas) or "(none)"
    use_cases_block = "\n".join(
        f"- {u.title} (actor: {u.actor}): {u.goal}" for u in overview.use_cases
    ) or "(none)"

    prompt = f"""
    Problem: {overview.problem_statement}
    Goals: {overview.goals}
    Target users: {overview.target_users}

    Personas:
    {personas_block}

    Use cases:
    {use_cases_block}
    """
    return generate_structured_sync(STORIES_SYSTEM_PROMPT, prompt, StoriesResult)

# ---------- Step 3: Functional Requirements ----------

class RequirementsResult(BaseModel):
    functional_requirements: list[FunctionalRequirement]
    key_entities: list[KeyEntity] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)

REQUIREMENTS_SYSTEM_PROMPT = (
    "You write functional requirements from a confirmed spec Overview and "
    "User Stories, following GitHub Spec Kit's spec.md structure.\n\n"
    "- Write functional requirements as discrete, testable 'System MUST "
    "...' statements with sequential ids FR-001, FR-002, ... covering both "
    "user-facing capabilities (kind='functional') and quality attributes -- "
    "performance, security, scalability, reliability, availability, "
    "compliance -- implied by the stories (kind='non_functional'). Classify "
    "each with `kind`; don't invent non-functional requirements the input "
    "doesn't actually imply. Every user story should be covered by at "
    "least one functional requirement.\n"
    "- List key entities (name + description, no implementation detail) "
    "only if the feature involves data; leave empty otherwise.\n"
    "- List assumptions made while drafting.\n\n"
    "Do not invent requirements not implied by the Overview or User Stories."
)

def run_requirements(overview: OverviewResult, stories: StoriesResult) -> RequirementsResult:
    stories_block = "\n".join(
        f"- [{s.priority}] {s.title}: {s.description}" for s in stories.user_stories
    ) or "(none)"

    prompt = f"""
    Problem: {overview.problem_statement}
    Goals: {overview.goals}

    User stories:
    {stories_block}

    Edge cases: {stories.edge_cases or '(none)'}
    """
    return generate_structured_sync(REQUIREMENTS_SYSTEM_PROMPT, prompt, RequirementsResult)

# ---------- Step 4: Test Cases (per-FR acceptance tests) ----------
# Test cases ARE the FR acceptance tests -- there is no separate
# freestanding "success criteria" concept. Every functional requirement
# gets at least one Given/When/Then acceptance test tied to it by fr_id.

class TestCasesResult(BaseModel):
    test_cases: list[AcceptanceTest]

TEST_CASES_SYSTEM_PROMPT = (
    "You write acceptance tests for a confirmed spec's functional "
    "requirements. For EVERY functional requirement given below, write at "
    "least one acceptance test (more if the requirement has distinct "
    "success and failure paths worth covering separately). Each test needs "
    "a sequential id ('AT-001', 'AT-002', ...), the `fr_id` of the exact "
    "functional requirement it verifies (copy the FR id verbatim), a short "
    "title, and a Given/When/Then scenario that is concrete and "
    "measurable -- not a restatement of the requirement text.\n\n"
    "Do not write a test for a requirement that isn't in the input, and do "
    "not skip any requirement."
)

def run_test_cases(requirements: RequirementsResult) -> TestCasesResult:
    fr_block = "\n".join(
        f"- {fr.id} [{fr.kind}]: {fr.text}" for fr in requirements.functional_requirements
    ) or "(none)"

    prompt = f"""
    Functional requirements (write at least one test per requirement):
    {fr_block}
    """
    return generate_structured_sync(TEST_CASES_SYSTEM_PROMPT, prompt, TestCasesResult)

# ---------- Stage 4: Diagram ----------
# Turns the drafted spec into a Mermaid diagram of the END USER'S experience of
# the feature being specified -- not a diagram of this app. Rendered client-side
# with the `mermaid` package and dropped straight into the Markdown export.

DIAGRAM_SYSTEM_PROMPT = (
    "You turn a product spec into a Mermaid diagram depicting the END USER'S "
    "experience of the feature being specified -- not the tool that generated "
    "this spec. Given the requested diagram_type:\n\n"
    "- 'journey': produce a Mermaid `journey` diagram. Start with `journey`, a "
    "`title` line, group steps into 2-4 `section`s that mirror the feature's "
    "real stages (derived from the user stories, ordered by priority), and "
    "give each step a satisfaction score 1-5 and an actor name drawn from the "
    "spec's user stories / key entities.\n"
    "- 'sequence': produce a Mermaid `sequenceDiagram`. Start with "
    "`sequenceDiagram`, declare a participant for each actor/system/key "
    "entity actually involved (from the user stories, functional "
    "requirements, and key entities), and lay out the key interactions as "
    "chronological messages drawn from the acceptance scenarios' "
    "Given/When/Then.\n\n"
    "Output ONLY valid Mermaid source for that diagram type in "
    "`mermaid_source` -- no markdown code fences, no commentary, nothing "
    "from the other diagram type mixed in. Keep it readable: 6-12 "
    "steps/messages, not an exhaustive enumeration of every requirement. "
    "Give it a short, specific `title` field (not the spec title verbatim)."
)

# ---------- Shared: PRD context formatting for on-demand agents ----------
# Diagram, Architecture, and Epic agents all need the same rendered view of
# an already-drafted spec as their prompt context.

def _prd_context_blocks(prd: GeneratedPRD) -> tuple[str, str, str]:
    stories_block = "\n".join(
        f"- [{s.priority}] {s.title}: {s.description}\n"
        + "\n".join(
            f"  - Given {sc.given}, When {sc.when}, Then {sc.then}"
            for sc in s.acceptance_scenarios
        )
        for s in prd.user_stories
    ) or "(none)"
    fr_block = "\n".join(f"- {fr.id} [{fr.kind}]: {fr.text}" for fr in prd.functional_requirements) or "(none)"
    entities_block = "\n".join(f"- {e.name}: {e.description}" for e in prd.key_entities) or "(none)"
    return stories_block, fr_block, entities_block

def _glossary_block(glossary: list[GlossaryTerm] | None) -> str:
    glossary = glossary or []
    return "\n".join(f"- {t.term}: {t.definition}" for t in glossary) or "(none)"

def run_diagram(prd: GeneratedPRD, diagram_type: Literal["journey", "sequence"]) -> Diagram:
    stories_block, fr_block, entities_block = _prd_context_blocks(prd)

    prompt = f"""
    Diagram type requested: {diagram_type}
    Spec title: {prd.title}

    User stories (with acceptance scenarios):
    {stories_block}

    Functional requirements:
    {fr_block}

    Key entities:
    {entities_block}
    """
    return generate_structured_sync(DIAGRAM_SYSTEM_PROMPT, prompt, Diagram)

# ---------- Stage 5: Architecture Decisions ----------
# Infers candidate architecture decisions (in ADR form) from the drafted spec
# alone -- no separate raw input. These are proposals, not ratified decisions,
# so status always starts "proposed" for the PM/eng team to review.

class ArchitectureDecisionSet(BaseModel):
    decisions: list[ArchitectureDecision] = Field(default_factory=list)

ARCHITECTURE_SYSTEM_PROMPT = (
        "You are a senior engineer proposing candidate architecture decisions for "
        "a drafted product spec, in Architecture Decision Record (ADR) form. Given "
        "the spec's user stories, functional requirements, and key entities, infer "
        "the significant technical decisions this feature will require -- e.g. data "
        "storage choices, integration points with existing systems, API/interface "
        "boundaries, synchronous vs asynchronous processing, and notable "
        "non-functional tradeoffs implied by the functional requirements.\n\n"
        "If technical context is provided (greenfield vs. existing system, current "
        "stack, deployment constraints), weigh it heavily: for an existing/brownfield "
        "system, decisions should address integration with and any migration away "
        "from what's already running rather than assuming a blank slate; for a "
        "greenfield build, decisions should cover the foundational choices too -- "
        "hosting/deployment target, CI/CD and environment provisioning strategy, and "
        "infrastructure-as-code approach -- not just feature-level technical "
        "choices. Propose dedicated infrastructure/DevOps decisions (environment "
        "setup, CI/CD pipeline, observability/monitoring, IaC tooling) whenever the "
        "technical context or the spec's non-functional requirements actually call "
        "for them. Requirements are tagged `[functional]`/`[non_functional]` below "
        "-- when the `[non_functional]` ones (performance, security, scalability, "
        "reliability, etc.) actually warrant it, propose a dedicated test strategy "
        "decision: how those quality attributes will be validated (e.g. "
        "load/performance testing approach, security testing, chaos/failure "
        "testing) -- within the same decision budget, not as an unlimited "
        "add-on.\n\n"
        "For each decision, write a sequential id ('ADR-001', 'ADR-002', ...), a "
        "short specific title, the context (forces/constraints from the spec -- and "
        "technical context, if provided -- that drive it), the decision itself, and "
        "its consequences (what it enables and what it costs). Always set status to "
        "'proposed' -- these are inferred, not yet ratified by an engineer, and the "
        "team should review and accept or edit them.\n\n"
        "If any decisions are listed below as already accepted by the team, treat "
        "them as settled: build on and stay consistent with them rather than "
        "silently re-deciding or contradicting them. If architecture "
        "clarification answers are provided, treat them as authoritative and "
        "build decisions consistent with them. If the project glossary "
        "defines terms, use them consistently instead of introducing new names "
        "for the same concepts.\n\n"
        "Propose 3-6 decisions covering the most consequential technical choices "
        "implied by the spec -- do not invent decisions unrelated to what the spec "
        "actually requires. If the spec is too thin to support any real decisions, "
        "return an empty list rather than inventing filler."
)

def run_architecture(
    prd: GeneratedPRD,
    technical_context: list[AnsweredClarification] | None = None,
    architecture_clarify_history: list[AnsweredClarification] | None = None,
    glossary: list[GlossaryTerm] | None = None,
) -> list[ArchitectureDecision]:
    stories_block, fr_block, entities_block = _prd_context_blocks(prd)
    technical_context = technical_context or []
    architecture_clarify_history = architecture_clarify_history or []
    tech_context_block = "\n".join(
        f"- {h.question.question} -> {h.answer}" for h in technical_context
    ) or "(none provided)"
    arch_clarify_block = "\n".join(
        f"- {h.question.question} -> {h.answer}" for h in architecture_clarify_history
    ) or "(none provided)"
    accepted_block = "\n".join(
        f"- {a.id} {a.title}: {a.decision}"
        for a in prd.architecture_decisions if a.status == "accepted"
    ) or "(none accepted yet)"

    prompt = f"""
    Spec title: {prd.title}

    User stories (with acceptance scenarios):
    {stories_block}

    Functional requirements:
    {fr_block}

    Key entities:
    {entities_block}

    Technical context:
    {tech_context_block}

    Architecture clarification answers:
    {arch_clarify_block}

    Already accepted by the team (do not silently contradict):
    {accepted_block}

    Project glossary:
    {_glossary_block(glossary)}
    """
    result = generate_structured_sync(ARCHITECTURE_SYSTEM_PROMPT, prompt, ArchitectureDecisionSet)
    return result.decisions

# ---------- Architecture Clarify Agent ----------
# Same round-based Q&A pattern as the Clarify Agent (Stage 2), scoped to
# architecture decisions specifically -- makes the Architecture step
# interactive (Q&A rounds with options) instead of the old single-shot
# proposal, mirroring the pipeline's existing Clarify UX.

ARCHITECTURE_CLARIFY_SYSTEM_PROMPT = (
        "You are conducting a short, conversational clarification round with a "
        "PM/engineer about ARCHITECTURE decisions for an already-drafted product "
        "spec, before those decisions get finalized. Be conversational -- ask "
        "the most consequential questions first, do not dump every possible "
        "question at once.\n\n"
        "Evaluate coverage across: data storage choices, integration points "
        "with existing systems, API/interface boundaries, synchronous vs "
        "asynchronous processing, hosting/deployment target, CI/CD and "
        "environment provisioning, and any notable non-functional tradeoffs "
        "implied by the functional requirements (performance, security, "
        "scalability, reliability, compliance). Ground every question in the "
        "spec's actual functional requirements and key entities -- do not ask "
        "generic architecture trivia unrelated to what this spec needs.\n\n"
        f"Return at most {ROUND_SIZE} clarifying questions for THIS round, "
        "prioritized by how much the answer would change the resulting "
        "architecture decisions. Prefer multiple-choice questions with 2-5 "
        "mutually exclusive options and a recommended default; use a "
        "short-answer question only when options don't make sense, and always "
        "suggest a likely answer.\n\n"
        "You may be called again after the PM answers this round's questions, "
        "with their answers included as prior context. Do not repeat anything "
        "already answered -- only ask a follow-up if an answer surfaced a "
        "genuinely new, high-impact gap.\n\n"
        "If the spec and any already-provided technical context are already "
        "clear enough to propose solid architecture decisions, return an empty "
        "list of questions."
)

def run_architecture_clarify(
    prd: GeneratedPRD,
    history: list[AnsweredClarification] | None = None,
) -> ClarifyResult:
    history = history or []
    _, fr_block, entities_block = _prd_context_blocks(prd)
    history_block = (
        "\n".join(f"- {h.question.question} -> {h.answer}" for h in history)
        if history else "(none yet -- this is the first round)"
    )
    tech_context_block = "\n".join(
        f"- {h.question.question} -> {h.answer}" for h in prd.technical_context
    ) or "(none)"

    prompt = f"""
    Spec title: {prd.title}

    Functional requirements:
    {fr_block}

    Key entities:
    {entities_block}

    Already-known technical context:
    {tech_context_block}

    Already answered in this clarification round:
    {history_block}
    """
    result = generate_structured_sync(ARCHITECTURE_CLARIFY_SYSTEM_PROMPT, prompt, ClarifyResult)
    return _renumber_questions(result, history)

# ---------- Stage 6: Epics ----------
# Groups the spec's EXISTING user stories into Jira-style epics ("functional"
# stories, reused verbatim -- never re-generated by the LLM) and adds the
# "technical" stories each epic will also need. The agent only decides
# grouping + drafts new technical stories; the merge into final Epic/EpicStory
# objects happens in Python so functional story text can never drift from the
# spec's `user_stories`, and epic/story ids are assigned in Python so they're
# guaranteed sequential and unique.

class TechnicalStoryDraft(BaseModel):
    title: str
    description: str
    acceptance_criteria: list[str] = Field(default_factory=list)

class EpicDraft(BaseModel):
    title: str
    description: str
    functional_story_titles: list[str] = Field(
        description=(
            "Exact titles of the input user stories that belong in this epic -- "
            "copied verbatim, never paraphrased"
        )
    )
    technical_stories: list[TechnicalStoryDraft] = Field(default_factory=list)
    business_impact: Literal["high", "medium", "low"] = Field(
        description="Coarse business-value score for this epic, based only on evidence in the spec"
    )
    business_impact_rationale: str = Field(
        description="1-2 sentences citing the specific story priorities/success criteria behind the score"
    )

class EpicDraftSet(BaseModel):
    epics: list[EpicDraft] = Field(default_factory=list)

EPIC_SYSTEM_PROMPT = (
        "You group a drafted product spec's user stories into Jira-style Epics, "
        "and add the technical/engineering stories each epic will also need.\n\n"
        "For each epic, write: a short title covering a cohesive slice of the "
        "spec; a description of what it delivers and why it's grouped together; "
        "functional_story_titles listing the EXACT titles of the input user "
        "stories that belong in this epic (copy them verbatim -- do not "
        "paraphrase, do not invent new functional stories); and "
        "technical_stories for engineering/infrastructure work this epic needs "
        "that ISN'T directly a user-facing story -- e.g. schema/migration work, "
        "API integration setup, observability, data pipeline changes -- drawn "
        "from the functional requirements, key entities, and architecture "
        "decisions. Each technical story needs a title, a description, and "
        "testable acceptance criteria.\n\n"
        "If the architecture decisions call for foundational infrastructure/DevOps "
        "work that doesn't belong to any single feature epic -- environment "
        "provisioning, CI/CD pipeline setup, infrastructure-as-code, baseline "
        "observability -- group it into its own dedicated epic (e.g. "
        "'Infrastructure & DevOps') with an empty functional_story_titles and only "
        "technical_stories, rather than force-fitting it into a feature epic. Only "
        "create this epic when the architecture decisions actually warrant it.\n\n"
        "Also score each epic's business_impact as 'high', 'medium', or 'low', "
        "weighing: the priority (P1/P2/P3) and why_this_priority of the "
        "functional stories it contains, and which functional requirements' "
        "acceptance tests its stories actually serve -- an epic built mostly of "
        "P1 stories addressing well-tested, high-priority requirements is high "
        "impact; one of P3 stories with no clear requirement link is low. Write "
        "business_impact_rationale citing that specific evidence (e.g. "
        "'Contains 2 P1 stories addressing the primary drop-off point; directly "
        "satisfies FR-001, verified by AT-001'). Score only from "
        "what's actually in the spec -- never invent market size, revenue, or "
        "competitive reasoning the input doesn't give you. An "
        "infrastructure/DevOps-only epic with no functional stories is usually "
        "'medium' unless the architecture decisions it enables are clearly "
        "blocking high-impact work.\n\n"
        "Group ALL of the input user stories into exactly one epic each -- every "
        "story must appear in some epic's functional_story_titles. Prefer fewer, "
        "more cohesive epics over one epic per story. Only add technical stories "
        "that are genuinely necessary engineering work, not busywork."
)

def run_epics(prd: GeneratedPRD) -> list[Epic]:
    stories_block, fr_block, entities_block = _prd_context_blocks(prd)
    adr_block = "\n".join(
        f"- {a.id} {a.title}: {a.decision}" for a in prd.architecture_decisions
    ) or "(none)"
    tc_block = "\n".join(
        f"- {tc.id} (verifies {tc.fr_id}): {tc.title}" for tc in prd.test_cases
    ) or "(none)"

    prompt = f"""
    Spec title: {prd.title}

    User stories (group these into epics by referencing their exact titles):
    {stories_block}

    Functional requirements:
    {fr_block}

    Key entities:
    {entities_block}

    Architecture decisions:
    {adr_block}

    Test cases (cite these in business_impact_rationale when relevant):
    {tc_block}
    """
    result = generate_structured_sync(EPIC_SYSTEM_PROMPT, prompt, EpicDraftSet)

    story_by_title = {s.title: s for s in prd.user_stories}
    epics: list[Epic] = []
    story_counter = 0
    for i, draft in enumerate(result.epics, start=1):
        stories: list[EpicStory] = []
        for title in draft.functional_story_titles:
            story = story_by_title.get(title)
            if story is None:
                continue  # LLM referenced a title that doesn't match -- skip, don't invent
            story_counter += 1
            stories.append(EpicStory(
                id=f"STORY-{story_counter:03d}",
                story_type="functional",
                title=story.title,
                description=story.description,
                acceptance_criteria=[
                    f"Given {sc.given}, When {sc.when}, Then {sc.then}"
                    for sc in story.acceptance_scenarios
                ],
            ))
        for tech in draft.technical_stories:
            story_counter += 1
            stories.append(EpicStory(
                id=f"STORY-{story_counter:03d}",
                story_type="technical",
                title=tech.title,
                description=tech.description,
                acceptance_criteria=tech.acceptance_criteria,
            ))
        epics.append(Epic(
            id=f"EPIC-{i}",
            title=draft.title,
            description=draft.description,
            stories=stories,
            business_impact=draft.business_impact,
            business_impact_rationale=draft.business_impact_rationale,
        ))
    return epics

# ---------- Stage 7: Jira Import & Enrichment ----------
# The reverse of the push flow: pulls an existing Jira project's Epics/
# Stories into the spec and reviews them -- classifies functional vs
# technical, fills gaps in thin descriptions/acceptance criteria, and
# cross-checks against the spec's functional requirements for coverage
# gaps. Merges into the SAME `epics` list the Epic Agent drafts; imported
# items carry their real Jira `jira_key` from the start, so a repeat import
# skips anything already pulled in (same idempotency principle as push).

class EnrichedStoryDraft(BaseModel):
    key: str = Field(description="The Jira key this maps back to, e.g. 'PROJ-105'")
    story_type: Literal["functional", "technical"]
    title: str
    description: str
    acceptance_criteria: list[str] = Field(default_factory=list)
    notes: str = Field(
        default="",
        description="Gaps/inconsistencies found relative to the spec; empty if none",
    )

class EnrichmentResult(BaseModel):
    stories: list[EnrichedStoryDraft] = Field(default_factory=list)
    unmapped_requirements: list[str] = Field(
        default_factory=list,
        description="Functional requirement ids/text with no corresponding imported story",
    )

ENRICHMENT_SYSTEM_PROMPT = (
        "You review stories imported from an existing Jira project against a "
        "drafted product spec, and enrich them.\n\n"
        "For each imported story (identified by its Jira key), produce:\n"
        "- story_type: classify as 'functional' (user-facing capability) or "
        "'technical' (engineering/infrastructure work) based on its content\n"
        "- title: keep the original title unless it's unclear, in which case "
        "tighten it\n"
        "- description: expand thin or vague descriptions into a clear, "
        "specific account of what the story delivers, grounded in what's "
        "already there -- do not invent scope the story doesn't already "
        "imply\n"
        "- acceptance_criteria: fill in specific, testable acceptance "
        "criteria if missing or too vague; if criteria already exist and "
        "are adequate, keep them\n"
        "- notes: flag anything inconsistent or unclear relative to the "
        "spec's functional requirements, architecture decisions, or key "
        "entities -- leave empty if nothing stands out\n\n"
        "Also identify unmapped_requirements: functional requirements from "
        "the spec that have NO corresponding imported story -- these are "
        "coverage gaps.\n\n"
        "Do not fabricate scope beyond what's reasonably implied by each "
        "story's existing title/description. When information is genuinely "
        "thin, say so in `notes` rather than inventing plausible-sounding "
        "detail."
)

def run_enrichment(prd: GeneratedPRD, imported_stories: list[dict]) -> EnrichmentResult:
    _, fr_block, entities_block = _prd_context_blocks(prd)
    adr_block = "\n".join(
        f"- {a.id} {a.title}: {a.decision}" for a in prd.architecture_decisions
    ) or "(none)"
    imported_block = "\n".join(
        f"- {s['key']}: {s['title']}\n  {s['description'] or '(no description)'}"
        for s in imported_stories
    ) or "(none)"

    prompt = f"""
    Spec title: {prd.title}

    Functional requirements:
    {fr_block}

    Key entities:
    {entities_block}

    Architecture decisions:
    {adr_block}

    Imported Jira stories to review and enrich:
    {imported_block}
    """
    return generate_structured_sync(ENRICHMENT_SYSTEM_PROMPT, prompt, EnrichmentResult)

def _next_epic_number(existing_epics: list[Epic]) -> int:
    max_n = 0
    for e in existing_epics:
        m = re.match(r"EPIC-(\d+)$", e.id)
        if m:
            max_n = max(max_n, int(m.group(1)))
    return max_n + 1

def _next_story_number(existing_epics: list[Epic]) -> int:
    max_n = 0
    for e in existing_epics:
        for s in e.stories:
            m = re.match(r"STORY-(\d+)$", s.id)
            if m:
                max_n = max(max_n, int(m.group(1)))
    return max_n

def _enriched_epic_story(raw_story: dict, enriched_by_key: dict[str, EnrichedStoryDraft], story_id: str) -> EpicStory:
    enriched = enriched_by_key.get(raw_story["key"])
    return EpicStory(
        id=story_id,
        story_type=enriched.story_type if enriched else "functional",
        title=enriched.title if enriched else raw_story["title"],
        description=enriched.description if enriched else raw_story["description"],
        acceptance_criteria=enriched.acceptance_criteria if enriched else [],
        notes=(enriched.notes or None) if enriched else None,
        jira_key=raw_story["key"],
    )

def run_jira_import(
    prd: GeneratedPRD, raw_epics: list[dict], unlinked: list[dict]
) -> tuple[list[Epic], list[str]]:
    """Merges already-fetched Jira epics/stories into `prd.epics`. Takes the
    fetched data rather than pulling it itself, so the same enrichment core
    can be driven either by Spec Builder's own single env-var-configured
    connection (spec_builder/jira_client.py, called by the /jira-import
    route) or by a snapshot already pulled through the standalone Jira tab
    (routes/jira.py's /attach route)."""
    existing_epic_keys = {e.jira_key for e in prd.epics if e.jira_key}
    existing_story_keys = {s.jira_key for e in prd.epics for s in e.stories if s.jira_key}

    new_raw_epics = [e for e in raw_epics if e["key"] not in existing_epic_keys]
    new_unlinked = [s for s in unlinked if s["key"] not in existing_story_keys]
    all_imported_stories = [
        s for e in new_raw_epics for s in e["stories"] if s["key"] not in existing_story_keys
    ] + new_unlinked

    if not new_raw_epics and not new_unlinked:
        return prd.epics, []

    enrichment = run_enrichment(prd, all_imported_stories) if all_imported_stories else EnrichmentResult()
    enriched_by_key = {s.key: s for s in enrichment.stories}

    next_epic_n = _next_epic_number(prd.epics)
    next_story_n = _next_story_number(prd.epics)
    merged_epics = list(prd.epics)

    for raw_epic in new_raw_epics:
        stories: list[EpicStory] = []
        for raw_story in raw_epic["stories"]:
            if raw_story["key"] in existing_story_keys:
                continue
            next_story_n += 1
            stories.append(_enriched_epic_story(raw_story, enriched_by_key, f"STORY-{next_story_n:03d}"))
        merged_epics.append(Epic(
            id=f"EPIC-{next_epic_n}",
            title=raw_epic["title"],
            description=raw_epic["description"],
            stories=stories,
            jira_key=raw_epic["key"],
        ))
        next_epic_n += 1

    if new_unlinked:
        stories = []
        for raw_story in new_unlinked:
            next_story_n += 1
            stories.append(_enriched_epic_story(raw_story, enriched_by_key, f"STORY-{next_story_n:03d}"))
        merged_epics.append(Epic(
            id=f"EPIC-{next_epic_n}",
            title="Imported (no epic in Jira)",
            description="Stories pulled from Jira with no parent epic set.",
            stories=stories,
            jira_key=None,
        ))

    return merged_epics, enrichment.unmapped_requirements

# ---------- Stage 8: Stakeholder Briefs ----------
# "One artifact, N projections -- never N sources of truth": renders the
# already-drafted spec into an audience-specific deliverable (executive
# one-pager, engineering brief, or sales/CS enablement doc). Strictly a
# projection of existing artifact content -- the agent must never invent
# facts the spec doesn't contain.

BRIEF_SYSTEM_PROMPT = (
        "You turn a drafted product spec into a brief for one specific audience. "
        "You will be told which audience; write ONLY for them.\n\n"
        "- 'executive': a one-pager. Sections for the outcome and why it matters "
        "now, progress at a glance (what's drafted vs already in the delivery "
        "tracker), and risks/tradeoffs drawn from architecture decision "
        "consequences and edge cases. Put decisions or support you need from "
        "leadership in key_asks. No implementation detail, no jargon.\n"
        "- 'engineering': the technical handoff. Sections covering the functional "
        "requirements, the architecture decisions with their consequences (note "
        "which are still 'proposed' vs 'accepted'), the technical stories with "
        "acceptance criteria, edge cases, and any open story notes as known "
        "ambiguities. key_asks lists open technical questions needing an owner.\n"
        "- 'sales': customer-facing enablement. Sections for what changes for "
        "the customer in plain language, benefits phrased per user story, "
        "availability status (stories already pushed to the delivery tracker vs "
        "still drafted), a short talk track, and a brief FAQ drawn from edge "
        "cases and assumptions. key_asks is usually empty here.\n\n"
        "Tailor tone and emphasis to the named stakeholders and what they care "
        "about, when provided. Use the project glossary's terms consistently "
        "rather than introducing new names for the same concepts.\n\n"
        "Hard rule: PROJECT, don't invent. Use only facts present in the spec "
        "content you are given. If something the audience would expect (dates, "
        "pricing, metrics results) isn't in the input, say 'not yet defined' "
        "rather than fabricating it. Keep section bodies as plain prose "
        "paragraphs; use newline-separated '- ' bullets only where a list "
        "genuinely reads better."
)

def _jira_status_suffix(jira_key: str | None, jira_status: str | None) -> str:
    if not jira_key:
        return ""
    return f" ({jira_status})" if jira_status else ""

def _epics_status_block(prd: GeneratedPRD) -> str:
    lines = []
    for epic in prd.epics:
        epic_status = (
            f"in Jira as {epic.jira_key}{_jira_status_suffix(epic.jira_key, epic.jira_status)}"
            if epic.jira_key else "drafted, not yet in Jira"
        )
        lines.append(f"- {epic.id} {epic.title} [{epic.business_impact} impact] ({epic_status}): {epic.description}")
        for s in epic.stories:
            story_status = (
                f"in Jira as {s.jira_key}{_jira_status_suffix(s.jira_key, s.jira_status)}"
                if s.jira_key else "drafted"
            )
            note = f" [note: {s.notes}]" if s.notes else ""
            lines.append(f"  - [{s.story_type}] {s.title} ({story_status}){note}")
    return "\n".join(lines) or "(none)"

def run_brief(
    prd: GeneratedPRD,
    audience: Literal["executive", "engineering", "sales"],
    stakeholders: list,
    glossary: list[GlossaryTerm] | None = None,
) -> StakeholderBrief:
    stories_block, fr_block, entities_block = _prd_context_blocks(prd)
    adr_block = "\n".join(
        f"- {a.id} [{a.status}] {a.title}: {a.decision} -- consequences: {a.consequences}"
        for a in prd.architecture_decisions
    ) or "(none)"
    audience_stakeholders = [s for s in stakeholders if s.audience == audience]
    stakeholder_block = "\n".join(
        f"- {s.name} ({s.role}), influence {s.influence}, interest {s.interest} -- cares about: {s.cares_about or '(unspecified)'}"
        for s in audience_stakeholders
    ) or "(no named stakeholders for this audience -- write for the audience generically)"

    prompt = f"""
    Audience: {audience}
    Spec title: {prd.title}

    Named stakeholders in this audience:
    {stakeholder_block}

    User stories (with acceptance scenarios):
    {stories_block}

    Edge cases: {prd.edge_cases or '(none)'}
    Assumptions: {prd.assumptions or '(none)'}

    Functional requirements:
    {fr_block}

    Key entities:
    {entities_block}

    Architecture decisions:
    {adr_block}

    Test cases: {[f"{tc.id} (verifies {tc.fr_id}): {tc.title}" for tc in prd.test_cases] or '(none)'}

    Epics and delivery status:
    {_epics_status_block(prd)}

    Project glossary (use these terms consistently):
    {_glossary_block(glossary)}
    """
    return generate_structured_sync(BRIEF_SYSTEM_PROMPT, prompt, StakeholderBrief)

# ---------- Stage 9: Update Composer ----------
# Drafts the recurring stakeholder update from what ACTUALLY changed between
# two artifact versions -- the structured diff is the only source of "news",
# so the update can never claim progress that didn't happen.

class StakeholderUpdateDraft(BaseModel):
    title: str
    summary: str = Field(description="2-4 sentence TL;DR of what changed and why it matters")
    sections: list[BriefSection]
    decisions_needed: list[str] = Field(
        default_factory=list,
        description="Open decisions stakeholders need to make; empty if none are visible in the input",
    )

UPDATE_COMPOSER_SYSTEM_PROMPT = (
        "You write a concise stakeholder status update for a product project, "
        "based STRICTLY on a structured change log between two versions of its "
        "spec.\n\n"
        "Structure: a short title including the project name; a 2-4 sentence "
        "summary a busy reader can stop after; then sections as the changes "
        "warrant -- typical ones: 'What changed' (spec/scope edits), "
        "'Decisions' (architecture decisions added or moved proposed -> "
        "accepted), 'Delivery progress' (epics/stories pushed to the delivery "
        "tracker). Only include a section if the change log actually has "
        "content for it. Put decisions stakeholders still need to make in "
        "decisions_needed (e.g. architecture decisions still 'proposed') -- "
        "leave it empty otherwise.\n\n"
        "Tailor tone and emphasis to the audience and named stakeholders when "
        "provided: executives get outcomes and risks, engineering gets "
        "specifics, sales gets customer impact, 'all' gets a balanced "
        "general update. Use the project glossary's terms consistently rather "
        "than introducing new names for the same concepts.\n\n"
        "Hard rule: the change log is your ONLY source of news. Do not invent "
        "progress, dates, or metrics that aren't in it. You may use the spec "
        "context to explain what a changed item is, never to claim it "
        "changed. If a change is ambiguous, describe it plainly rather than "
        "spinning it."
)

def run_update_composer(
    prd: GeneratedPRD,
    diff_lines: list[str],
    stakeholders: list,
    audience: Literal["all", "executive", "engineering", "sales"],
    period_desc: str,
    glossary: list[GlossaryTerm] | None = None,
) -> StakeholderUpdateDraft:
    if audience == "all":
        relevant = stakeholders
    else:
        relevant = [s for s in stakeholders if s.audience == audience]
    stakeholder_block = "\n".join(
        f"- {s.name} ({s.role}) -- cares about: {s.cares_about or '(unspecified)'}"
        for s in relevant
    ) or "(no named stakeholders -- write a general update)"

    changes_block = "\n".join(diff_lines) or "(none)"
    _, fr_block, _ = _prd_context_blocks(prd)

    prompt = f"""
    Audience: {audience}
    Spec title: {prd.title}
    Period covered: {period_desc}

    Named stakeholders:
    {stakeholder_block}

    CHANGE LOG (the only source of news):
    {changes_block}

    Spec context (for explaining items, NOT news):
    Functional requirements:
    {fr_block}
    Architecture decisions: {[f"{a.id} [{a.status}] {a.title}" for a in prd.architecture_decisions] or '(none)'}
    Test cases: {[f"{tc.id} (verifies {tc.fr_id}): {tc.title}" for tc in prd.test_cases] or '(none)'}

    Project glossary (use these terms consistently):
    {_glossary_block(glossary)}
    """
    return generate_structured_sync(UPDATE_COMPOSER_SYSTEM_PROMPT, prompt, StakeholderUpdateDraft)

# ---------- Scope Check Agent ----------
# Triggered only via an explicit "Edit this step" action on an already-
# confirmed pipeline step. Judges whether the edit is a genuine scope
# change (should cascade downstream steps to "stale" for revisit) or
# merely cosmetic (wording/typo-level, safe to leave downstream untouched).
# Fed both the structured diff AND a summary of current downstream content,
# since the diff alone can't say whether a changed item actually matters to
# what's already built on top of it.

SCOPE_CHECK_SYSTEM_PROMPT = (
        "You judge whether an edit to a confirmed pipeline step is a genuine "
        "scope change or a merely cosmetic edit (wording/typo/formatting, no "
        "change in meaning).\n\n"
        "You are given: which step was edited, a structured diff of what "
        "changed, and a summary of the downstream content already built on "
        "top of this step. Classify 'scope_change' only if the edit would "
        "actually invalidate or contradict something in that downstream "
        "content -- a new requirement, a removed capability, a changed actor, "
        "a changed data shape, a changed priority that reorders what's "
        "critical. Classify 'cosmetic' if the meaning is unchanged (rewording, "
        "typo fixes, formatting, reordering with no semantic change).\n\n"
        "If scope_change, list which of the given downstream step ids are "
        "actually affected -- do not list a step just because it comes after "
        "the edited one; only list it if the diff genuinely conflicts with or "
        "invalidates something specific in that step's summary. Write a short, "
        "concrete rationale citing the specific diff item and the downstream "
        "content it conflicts with."
)

def run_scope_check(
    step: StepId,
    diff_entries: list["DiffEntry"],
    downstream_summary: str,
) -> ScopeCheckVerdict:
    diff_block = "\n".join(
        f"- [{e.section}] {e.change}: {e.item}" + (f" -- {e.detail}" if e.detail else "")
        for e in diff_entries
    ) or "(no changes)"

    prompt = f"""
    Step edited: {step}

    Structured diff of the edit:
    {diff_block}

    Downstream content already built on top of this step:
    {downstream_summary}
    """
    return generate_structured_sync(SCOPE_CHECK_SYSTEM_PROMPT, prompt, ScopeCheckVerdict)

# ---------- Completeness Review Agent ----------
# Manually triggered (never blocks anything) -- flags gaps across the whole
# drafted spec once every step is confirmed. Modeled on the Enrichment
# Agent's "flag gaps, never invent" style.

class CompletenessDraft(BaseModel):
    issues: list[CompletenessIssue] = Field(default_factory=list)

COMPLETENESS_REVIEW_SYSTEM_PROMPT = (
        "You review a fully-drafted product spec for completeness and internal "
        "consistency, across its overview, user stories, functional "
        "requirements, test cases, architecture decisions, and epics.\n\n"
        "Flag genuine gaps: a functional requirement with no test case, a user "
        "story with no acceptance scenario, a persona or use case never "
        "reflected in any story, an edge case with no requirement addressing "
        "it, an architecture decision that contradicts a functional "
        "requirement, an epic/story that doesn't trace back to any "
        "requirement. For each issue, give a short id, a severity ('high' for "
        "a real gap that blocks confidence in the spec, 'medium' for a "
        "worth-fixing inconsistency, 'low' for a minor polish item), the area "
        "it's in, a concrete description, and the related item ids (e.g. "
        "FR-003, UC-2) it concerns.\n\n"
        "Only flag genuine issues -- do not invent nitpicks to fill a quota. "
        "If the spec is solid, return an empty list."
)

def run_completeness_review(prd: GeneratedPRD, version: int) -> CompletenessReview:
    stories_block, fr_block, entities_block = _prd_context_blocks(prd)
    personas_block = "\n".join(f"- {p.id} {p.name}: {p.description}" for p in prd.personas) or "(none)"
    use_cases_block = "\n".join(
        f"- {u.id} {u.title} (actor: {u.actor}): {u.goal}" for u in prd.use_cases
    ) or "(none)"
    test_cases_block = "\n".join(
        f"- {tc.id} (verifies {tc.fr_id}): Given {tc.given}, When {tc.when}, Then {tc.then}"
        for tc in prd.test_cases
    ) or "(none)"
    adr_block = "\n".join(
        f"- {a.id} [{a.status}] {a.title}: {a.decision}" for a in prd.architecture_decisions
    ) or "(none)"

    prompt = f"""
    Spec title: {prd.title}
    Problem: {prd.problem_statement}
    Goals: {prd.goals}
    Target users: {prd.target_users}

    Personas:
    {personas_block}

    Use cases:
    {use_cases_block}

    User stories (with acceptance scenarios):
    {stories_block}

    Edge cases: {prd.edge_cases or '(none)'}

    Functional requirements:
    {fr_block}

    Key entities:
    {entities_block}

    Test cases:
    {test_cases_block}

    Architecture decisions:
    {adr_block}

    Epics:
    {_epics_status_block(prd)}
    """
    draft = generate_structured_sync(COMPLETENESS_REVIEW_SYSTEM_PROMPT, prompt, CompletenessDraft)
    return CompletenessReview(
        issues=draft.issues,
        reviewed_at=datetime.now(timezone.utc).isoformat(),
        reviewed_version=version,
    )
