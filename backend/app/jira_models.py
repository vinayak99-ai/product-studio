from __future__ import annotations

from pydantic import BaseModel, Field

# Safety cap on how many issues one pull will page through -- large enough
# for essentially any real project, small enough to bound one request's
# latency. Hitting it sets JiraConnectionMeta.truncated=True rather than
# silently dropping the rest.
MAX_ISSUES_PER_PULL = 1000


class JiraConnectionMeta(BaseModel):
    id: str
    name: str
    base_url: str
    email: str
    project_key: str
    created_at: str
    updated_at: str
    last_synced_at: str | None = None
    issue_count: int = 0
    truncated: bool = False


class CreateJiraConnectionRequest(BaseModel):
    name: str
    base_url: str
    email: str
    api_token: str
    project_key: str


class RenameJiraConnectionRequest(BaseModel):
    name: str


class JiraIssueRef(BaseModel):
    key: str
    title: str
    description: str
    issue_type: str
    status: str | None = None
    assignee: str | None = None
    priority: str | None = None
    labels: list[str] = Field(default_factory=list)
    story_points: float | None = None
    sprint: str | None = None
    updated: str | None = None


class JiraEpicSnapshot(BaseModel):
    key: str
    title: str
    description: str
    status: str | None = None
    stories: list[JiraIssueRef] = Field(default_factory=list)


class JiraProjectSnapshot(BaseModel):
    fetched_at: str
    epics: list[JiraEpicSnapshot] = Field(default_factory=list)
    # Everything that isn't an Epic or a Story nested under one -- unlinked
    # Stories, Tasks, Bugs, Sub-tasks, whatever issue types the project
    # actually uses. Visible in the Jira tab's browse view; deliberately
    # excluded from the "attach to Spec Builder" flow (see routes/jira.py),
    # since the enrichment agent's prompt is written for story-shaped input.
    other_issues: list[JiraIssueRef] = Field(default_factory=list)


class JiraConnectionDetail(BaseModel):
    meta: JiraConnectionMeta
    snapshot: JiraProjectSnapshot | None = None


class SpecBuilderProjectOption(BaseModel):
    id: str
    name: str


class AttachToSpecBuilderResponse(BaseModel):
    new_epics: int
    new_stories: int
    unmapped_requirements: list[str] = Field(default_factory=list)
