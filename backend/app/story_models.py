from __future__ import annotations

from pydantic import BaseModel, Field

from app.infographic_models import InfographicDiagram, InfographicTemplateId

STORY_MIN_BEATS = 6
STORY_MAX_BEATS = 12
STORY_MIN_MINUTES = 5
STORY_MAX_MINUTES = 90
STORY_DEFAULT_MINUTES = 30


class StoryBeatPlan(BaseModel):
    """One beat's shape and time budget, decided before any content is
    written -- the label is the AI's own choice of narrative framework
    (Situation/Complication/Resolution, hero's-journey, before/after,
    whatever fits this product), not a fixed template."""

    label: str
    template: InfographicTemplateId
    topic: str
    start_minute: float
    end_minute: float


class StoryPlan(BaseModel):
    title: str
    beats: list[StoryBeatPlan] = Field(default_factory=list)


class StoryBeat(BaseModel):
    """A planned beat with its content filled in: the slide that displays
    during this beat, and the narration -- what the presenter actually
    says out loud, timed to this beat's minute range."""

    label: str
    start_minute: float
    end_minute: float
    narration: str
    slide: InfographicDiagram


class StoryScript(BaseModel):
    title: str
    total_minutes: int
    # None when the source was an uploaded document rather than an existing
    # Spec Builder project -- source_project_name still holds a human-
    # readable label (the project name, or the document's filename) either way.
    source_project_id: str | None = None
    source_project_name: str
    beats: list[StoryBeat] = Field(default_factory=list)


class NarrationOnly(BaseModel):
    narration: str


class StorySourceProject(BaseModel):
    """A Spec Builder project as it appears in Story Builder's source
    picker -- only ones with a generated PRD are usable as source
    material, so `has_prd` lets the UI grey out the rest rather than let
    a PM pick an empty project and hit a confusing error."""

    id: str
    name: str
    has_prd: bool
