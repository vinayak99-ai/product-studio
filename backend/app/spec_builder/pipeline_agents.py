from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# Cross-cutting pipeline infrastructure only -- step identity, versioned
# state, scope-check and completeness-review result shapes. Deliberately has
# NO dependency on agents.py (which owns the PRD content models and every
# LLM-calling function, including run_overview/run_stories/run_requirements/
# run_test_cases/run_architecture_clarify/run_scope_check/
# run_completeness_review) so agents.py can import from here at module level
# without a cycle.

# ---------- Pipeline step identity ----------
# The six steps of the Spec Builder pipeline, in strict dependency order.
# Downstream steps consume upstream steps' confirmed output; editing a
# confirmed step re-runs the scope-check agent and, on a real scope change,
# marks every step after it (per STEP_ORDER) "stale" for revisit.

StepId = Literal["overview", "stories", "requirements", "test_cases", "architecture", "epics"]

STEP_ORDER: list[StepId] = [
    "overview",
    "stories",
    "requirements",
    "test_cases",
    "architecture",
    "epics",
]

# ---------- Pipeline state ----------

class StepState(BaseModel):
    status: Literal["not_started", "needs_clarification", "drafted", "confirmed", "stale"] = "not_started"
    confirmed_at: str | None = None
    confirmed_version: int | None = None

class PipelineState(BaseModel):
    steps: dict[str, StepState] = Field(default_factory=dict)
    current_step: StepId = "overview"

def new_pipeline_state() -> PipelineState:
    """Fresh state for a brand-new project -- every step not_started."""
    return PipelineState(steps={step: StepState() for step in STEP_ORDER})

# ---------- Scope check + completeness review ----------

class ScopeCheckVerdict(BaseModel):
    classification: Literal["cosmetic", "scope_change"]
    rationale: str
    affected_downstream_steps: list[StepId] = Field(default_factory=list)

class CompletenessIssue(BaseModel):
    id: str = Field(description="e.g. 'ISSUE-1', sequential")
    severity: Literal["high", "medium", "low"]
    area: str = Field(description="Which step/section the gap is in, e.g. 'requirements'")
    description: str
    related_ids: list[str] = Field(
        default_factory=list, description="IDs of related items, e.g. FR-001, UC-2"
    )

class CompletenessReview(BaseModel):
    issues: list[CompletenessIssue] = Field(default_factory=list)
    reviewed_at: str
    reviewed_version: int
