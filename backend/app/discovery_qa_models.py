from __future__ import annotations

from pydantic import BaseModel, Field


class DiscoveryQuestion(BaseModel):
    id: str
    text: str
    answer: str = ""
    enriched_answer: str = ""


class CandidateQuestion(BaseModel):
    """Ephemeral -- exists only in the Prep view's response until Save,
    never persisted on its own. No `selected` flag on the model (unlike
    Design Thinking's HowMightWe/ConceptSpark) because nothing round-trips
    this object through a further LLM call -- selection is a plain
    client-side checkbox list."""

    id: str
    text: str
    rationale: str


class GenerateCandidatesRequest(BaseModel):
    project_id: str
    prompt: str = ""


class CandidateQuestionsResponse(BaseModel):
    candidates: list[CandidateQuestion] = Field(default_factory=list)


class CreateSessionRequest(BaseModel):
    name: str
    source_project_id: str
    questions: list[DiscoveryQuestion] = Field(default_factory=list)


class RenameSessionRequest(BaseModel):
    name: str


class UpdateQuestionsRequest(BaseModel):
    """Full replace -- covers add/edit/delete/reorder in one shape, same
    trade this app already made for Knowledge Base document replace."""

    questions: list[DiscoveryQuestion]


class SaveAnswerRequest(BaseModel):
    answer: str


class SaveNotesRequest(BaseModel):
    notes: str


class DiscoverySessionMeta(BaseModel):
    id: str
    name: str
    source_project_id: str
    source_project_name: str
    created_at: str
    updated_at: str
    question_count: int = 0
    answered_count: int = 0
    is_enriched: bool = False


class DiscoverySessionDetail(BaseModel):
    meta: DiscoverySessionMeta
    questions: list[DiscoveryQuestion] = Field(default_factory=list)
    notes: str = ""
    enriched_notes: str = ""


class EnrichResponse(BaseModel):
    questions: list[DiscoveryQuestion]
    enriched_notes: str


class DiscoverySourceProject(BaseModel):
    """A Spec Builder project as it appears in Discovery Q&A's source
    picker -- same has_prd-gating pattern as Story Builder's
    StorySourceProject, so the UI can grey out projects with no generated
    spec rather than let a PM pick one and hit a confusing error."""

    id: str
    name: str
    has_prd: bool
