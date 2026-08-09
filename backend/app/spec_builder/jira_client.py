from __future__ import annotations

import os

from jira import JIRA
from jira.exceptions import JIRAError

from app.jira_shared import adf_to_text, discover_field_id

JIRA_BASE_URL = os.environ.get("JIRA_BASE_URL")
JIRA_EMAIL = os.environ.get("JIRA_EMAIL")
JIRA_API_TOKEN = os.environ.get("JIRA_API_TOKEN")
JIRA_PROJECT_KEY = os.environ.get("JIRA_PROJECT_KEY")

_epic_link_field_id: str | None = None  # discovered lazily, cached per process


class JiraNotConfigured(Exception):
    pass


def is_configured() -> bool:
    return bool(JIRA_BASE_URL and JIRA_EMAIL and JIRA_API_TOKEN and JIRA_PROJECT_KEY)


def _client() -> JIRA:
    if not is_configured():
        raise JiraNotConfigured(
            "Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, "
            "and JIRA_PROJECT_KEY in backend/.env."
        )
    return JIRA(server=JIRA_BASE_URL, basic_auth=(JIRA_EMAIL, JIRA_API_TOKEN))


def _text_to_adf(description: str, bullets: list[str] | None = None) -> dict:
    """Jira Cloud REST v3 requires Atlassian Document Format for `description`,
    not plain text -- a paragraph node for the description, plus an optional
    bulletList node for acceptance criteria."""
    content = []
    if description:
        content.append({
            "type": "paragraph",
            "content": [{"type": "text", "text": description}],
        })
    if bullets:
        content.append({
            "type": "bulletList",
            "content": [
                {
                    "type": "listItem",
                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": b}]}],
                }
                for b in bullets
            ],
        })
    if not content:
        content.append({"type": "paragraph", "content": []})
    return {"type": "doc", "version": 1, "content": content}


def create_epic(title: str, description: str) -> str:
    client = _client()
    issue = client.create_issue(fields={
        "project": {"key": JIRA_PROJECT_KEY},
        "issuetype": {"name": "Epic"},
        "summary": title,
        "description": _text_to_adf(description),
    })
    return issue.key


def _discover_epic_link_field_id(client: JIRA) -> str | None:
    global _epic_link_field_id
    if _epic_link_field_id is not None:
        return _epic_link_field_id
    _epic_link_field_id = discover_field_id(client, "Epic Link")
    return _epic_link_field_id


def create_story(title: str, description: str, acceptance_criteria: list[str], epic_key: str) -> str:
    client = _client()

    base_fields = {
        "project": {"key": JIRA_PROJECT_KEY},
        "issuetype": {"name": "Story"},
        "summary": title,
        "description": _text_to_adf(description, acceptance_criteria),
    }

    try:
        issue = client.create_issue(fields={**base_fields, "parent": {"key": epic_key}})
        return issue.key
    except JIRAError as e:
        if "parent" not in (e.text or "").lower():
            raise

    # Team-managed `parent` field was rejected -- this is likely a
    # company-managed (classic) project; fall back to the discovered
    # "Epic Link" custom field. If that can't be found either, surface the
    # original Jira error rather than guessing further.
    epic_link_field_id = _discover_epic_link_field_id(client)
    if epic_link_field_id is None:
        raise JIRAError(
            text=(
                "Could not link story to epic: the 'parent' field was rejected "
                "and no 'Epic Link' custom field was found on this Jira instance."
            )
        )
    issue = client.create_issue(fields={**base_fields, epic_link_field_id: epic_key})
    return issue.key


def fetch_statuses(jira_keys: list[str]) -> dict[str, str]:
    """Batched status lookup: one JQL search for all given keys, rather than
    one API call per issue."""
    if not jira_keys:
        return {}
    client = _client()
    keys_clause = ", ".join(jira_keys)
    jql = f"key in ({keys_clause})"
    issues = client.search_issues(jql, maxResults=len(jira_keys))
    return {issue.key: issue.fields.status.name for issue in issues}


def fetch_project_epics_and_stories() -> tuple[list[dict], list[dict]]:
    """Pulls existing Epics and Stories from JIRA_PROJECT_KEY. Returns
    (epics, unlinked_stories): each epic dict is {"key", "title",
    "description", "stories": [{"key", "title", "description"}, ...]};
    unlinked_stories holds stories with no resolvable parent epic, in the
    same {"key", "title", "description"} shape. Capped at 200 issues -- a v1
    limit for very large projects, not full pagination."""
    client = _client()
    jql = f'project = "{JIRA_PROJECT_KEY}" AND issuetype in (Epic, Story) ORDER BY issuetype ASC'
    issues = client.search_issues(jql, maxResults=200)

    epics: dict[str, dict] = {}
    pending_stories: list[tuple[str | None, dict]] = []
    epic_link_field_id: str | None = None

    for issue in issues:
        issuetype = issue.fields.issuetype.name
        description = adf_to_text(getattr(issue.fields, "description", None))

        if issuetype == "Epic":
            epics[issue.key] = {
                "key": issue.key,
                "title": issue.fields.summary,
                "description": description,
                "stories": [],
            }
        elif issuetype == "Story":
            parent = getattr(issue.fields, "parent", None)
            epic_key = parent.key if parent else None
            if epic_key is None:
                if epic_link_field_id is None:
                    epic_link_field_id = _discover_epic_link_field_id(client)
                if epic_link_field_id:
                    epic_key = getattr(issue.fields, epic_link_field_id, None)

            story = {"key": issue.key, "title": issue.fields.summary, "description": description}
            pending_stories.append((epic_key, story))

    unlinked_stories: list[dict] = []
    for epic_key, story in pending_stories:
        epic = epics.get(epic_key) if epic_key else None
        if epic is not None:
            epic["stories"].append(story)
        else:
            unlinked_stories.append(story)

    return list(epics.values()), unlinked_stories
