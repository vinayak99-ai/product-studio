"""The Jira tab's own client -- unlike app/spec_builder/jira_client.py
(one env-var-configured connection for the whole process), every call here
takes its connection's base_url/email/api_token explicitly, since the Jira
tab supports any number of saved connections. Read-only: this module never
creates or edits Jira issues, only pulls them."""

from __future__ import annotations

from datetime import datetime, timezone

from jira import JIRA
from jira.exceptions import JIRAError

from app.jira_models import MAX_ISSUES_PER_PULL, JiraEpicSnapshot, JiraIssueRef, JiraProjectSnapshot
from app.jira_shared import adf_to_text, discover_field_id

PAGE_SIZE = 100


class JiraConnectionError(Exception):
    """Raised when credentials/URL/project key don't actually work,
    surfaced to the PM before a connection gets saved."""


def _client(base_url: str, email: str, api_token: str) -> JIRA:
    return JIRA(server=base_url, basic_auth=(email, api_token))


def test_connection(base_url: str, email: str, api_token: str, project_key: str) -> None:
    """Cheap call that exercises auth and the project key together, so a
    typo in either surfaces immediately instead of after the connection is
    saved and the first pull fails."""
    client = _client(base_url, email, api_token)
    try:
        client.project(project_key)
    except JIRAError as e:
        raise JiraConnectionError(
            f"Could not reach project '{project_key}' at {base_url}: {e.text or e}"
        ) from e


def _story_points(issue, story_points_field_id: str | None) -> float | None:
    if not story_points_field_id:
        return None
    value = getattr(issue.fields, story_points_field_id, None)
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _sprint_name(issue, sprint_field_id: str | None) -> str | None:
    """Sprint is a custom field whose value shape varies by Jira instance
    (a list of Sprint objects with .name on newer Cloud APIs, a list of
    stringified Java objects like 'com.atlassian...[...,name=Sprint 1,...]'
    on older/Server instances). Best-effort only -- any unrecognized shape
    falls back to None rather than failing the whole pull."""
    if not sprint_field_id:
        return None
    value = getattr(issue.fields, sprint_field_id, None)
    if not value:
        return None
    try:
        latest = value[-1]
        if hasattr(latest, "name"):
            return latest.name
        if isinstance(latest, dict):
            return latest.get("name")
        if isinstance(latest, str) and "name=" in latest:
            after = latest.split("name=", 1)[1]
            return after.split(",")[0].rstrip("]")
    except Exception:
        return None
    return None


def _issue_ref(issue, story_points_field_id: str | None, sprint_field_id: str | None) -> JiraIssueRef:
    assignee = getattr(issue.fields, "assignee", None)
    priority = getattr(issue.fields, "priority", None)
    status = getattr(issue.fields, "status", None)
    return JiraIssueRef(
        key=issue.key,
        title=issue.fields.summary,
        description=adf_to_text(getattr(issue.fields, "description", None)),
        issue_type=issue.fields.issuetype.name,
        status=status.name if status else None,
        assignee=assignee.displayName if assignee else None,
        priority=priority.name if priority else None,
        labels=list(getattr(issue.fields, "labels", None) or []),
        story_points=_story_points(issue, story_points_field_id),
        sprint=_sprint_name(issue, sprint_field_id),
        updated=getattr(issue.fields, "updated", None),
    )


def fetch_project_snapshot(base_url: str, email: str, api_token: str, project_key: str) -> tuple[JiraProjectSnapshot, bool]:
    """Pulls every issue in `project_key` -- all issue types, not just
    Epic/Story, since the point of this tab is to bring back everything.
    Returns (snapshot, truncated) where truncated is True if
    MAX_ISSUES_PER_PULL was hit before the project was exhausted."""
    client = _client(base_url, email, api_token)
    story_points_field_id = discover_field_id(client, "Story Points")
    sprint_field_id = discover_field_id(client, "Sprint")
    epic_link_field_id = discover_field_id(client, "Epic Link")

    jql = f'project = "{project_key}" ORDER BY issuetype ASC'
    issues = []
    start_at = 0
    truncated = False
    while True:
        page = client.search_issues(jql, startAt=start_at, maxResults=PAGE_SIZE)
        issues.extend(page)
        if len(issues) >= MAX_ISSUES_PER_PULL:
            issues = issues[:MAX_ISSUES_PER_PULL]
            truncated = True
            break
        if len(page) < PAGE_SIZE:
            break
        start_at += PAGE_SIZE

    epics: dict[str, JiraEpicSnapshot] = {}
    other_issues: list[JiraIssueRef] = []
    pending_stories: list[tuple[str | None, JiraIssueRef]] = []

    for issue in issues:
        issuetype = issue.fields.issuetype.name
        ref = _issue_ref(issue, story_points_field_id, sprint_field_id)

        if issuetype == "Epic":
            epics[issue.key] = JiraEpicSnapshot(
                key=issue.key, title=ref.title, description=ref.description, status=ref.status
            )
        elif issuetype == "Story":
            parent = getattr(issue.fields, "parent", None)
            epic_key = parent.key if parent else None
            if epic_key is None and epic_link_field_id:
                epic_key = getattr(issue.fields, epic_link_field_id, None)
            pending_stories.append((epic_key, ref))
        else:
            other_issues.append(ref)

    for epic_key, ref in pending_stories:
        epic = epics.get(epic_key) if epic_key else None
        if epic is not None:
            epic.stories.append(ref)
        else:
            other_issues.append(ref)

    snapshot = JiraProjectSnapshot(
        fetched_at=datetime.now(timezone.utc).isoformat(),
        epics=list(epics.values()),
        other_issues=other_issues,
    )
    return snapshot, truncated
