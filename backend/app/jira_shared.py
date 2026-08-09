"""Low-level Jira quirk-handling shared by every Jira client in this
backend -- app/spec_builder/jira_client.py (the single env-var-configured
connection Spec Builder pushes/pulls through) and app/jira_client.py (the
new tab's per-connection client). Neither the response shapes nor the
credentials are shared, only these two pieces of Jira-API awkwardness."""

from __future__ import annotations

from jira import JIRA


def adf_to_text(description) -> str:
    """Flattens a Jira Cloud REST v3 Atlassian Document Format `description`
    (or passes through a plain string, for Server/DC instances that may
    still return one) into readable text."""
    if not description:
        return ""
    if isinstance(description, str):
        return description

    lines: list[str] = []

    def walk(node):
        if node.get("type") == "text":
            lines.append(node.get("text", ""))
        for child in node.get("content", []) or []:
            walk(child)
        if node.get("type") in ("paragraph", "listItem"):
            lines.append("\n")

    for block in description.get("content", []) or []:
        walk(block)
    return "".join(lines).strip()


def discover_field_id(client: JIRA, field_name: str) -> str | None:
    """Jira's only way to locate a non-standard field (custom fields like
    'Epic Link' or 'Story Points', whose ids vary per instance) is to list
    every field and match on its display name. Callers should cache the
    result themselves if calling this repeatedly -- it's one full field
    list per call."""
    for field in client.fields():
        if field.get("name") == field_name:
            return field["id"]
    return None
