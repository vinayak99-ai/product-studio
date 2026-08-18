"""Structured, human-readable diff between two artifact versions.

Deliberately compares *substance*: briefs and composed updates are excluded
(they're projections/communications of the content, not the content), and
diagram PNG bytes are ignored (only real diagram changes count). The output
feeds both the version-diff UI and the Update Composer's prompt.
"""

from typing import Literal

from pydantic import BaseModel

from .agents import GeneratedPRD


class DiffEntry(BaseModel):
    section: str
    change: Literal["added", "removed", "modified"]
    item: str
    detail: str = ""


def _diff_str_list(section: str, old: list[str], new: list[str], entries: list[DiffEntry]):
    old_set, new_set = set(old), set(new)
    for item in new:
        if item not in old_set:
            entries.append(DiffEntry(section=section, change="added", item=item))
    for item in old:
        if item not in new_set:
            entries.append(DiffEntry(section=section, change="removed", item=item))


def _diff_keyed(section, old_items, new_items, key, label, describe, entries):
    old_by_key = {key(x): x for x in old_items}
    new_by_key = {key(x): x for x in new_items}
    for k, item in new_by_key.items():
        if k not in old_by_key:
            entries.append(DiffEntry(section=section, change="added", item=label(item), detail=describe(item)))
    for k, item in old_by_key.items():
        if k not in new_by_key:
            entries.append(DiffEntry(section=section, change="removed", item=label(item)))
    for k, new_item in new_by_key.items():
        old_item = old_by_key.get(k)
        if old_item is not None and old_item != new_item:
            entries.append(DiffEntry(
                section=section, change="modified", item=label(new_item),
                detail=describe(new_item),
            ))


def diff_prds(old: GeneratedPRD, new: GeneratedPRD) -> list[DiffEntry]:
    entries: list[DiffEntry] = []

    if old.title != new.title:
        entries.append(DiffEntry(
            section="Title", change="modified", item=new.title,
            detail=f'was "{old.title}"',
        ))

    _diff_str_list("Edge cases", old.edge_cases, new.edge_cases, entries)
    _diff_str_list("Assumptions", old.assumptions, new.assumptions, entries)

    _diff_keyed(
        "Functional requirements", old.functional_requirements, new.functional_requirements,
        key=lambda x: x.id, label=lambda x: x.id,
        describe=lambda x: f"[{x.kind}] {x.text}", entries=entries,
    )
    _diff_keyed(
        "Test cases", old.test_cases, new.test_cases,
        key=lambda x: x.id, label=lambda x: x.id,
        describe=lambda x: f"(verifies {x.fr_id}) {x.title}", entries=entries,
    )
    _diff_keyed(
        "Key entities", old.key_entities, new.key_entities,
        key=lambda x: x.name, label=lambda x: x.name, describe=lambda x: x.description, entries=entries,
    )
    _diff_keyed(
        "User stories", old.user_stories, new.user_stories,
        key=lambda x: x.title, label=lambda x: x.title,
        describe=lambda x: f"[{x.priority}] {x.description}", entries=entries,
    )

    # Architecture decisions: a status flip (proposed -> accepted) is the most
    # important signal for stakeholders, so call it out explicitly.
    old_adrs = {a.id: a for a in old.architecture_decisions}
    for adr in new.architecture_decisions:
        old_adr = old_adrs.get(adr.id)
        if old_adr is None:
            entries.append(DiffEntry(
                section="Architecture decisions", change="added",
                item=f"{adr.id} {adr.title}", detail=f"status: {adr.status}",
            ))
        elif old_adr.status != adr.status:
            entries.append(DiffEntry(
                section="Architecture decisions", change="modified",
                item=f"{adr.id} {adr.title}",
                detail=f"status: {old_adr.status} -> {adr.status}",
            ))
        elif old_adr != adr:
            entries.append(DiffEntry(
                section="Architecture decisions", change="modified",
                item=f"{adr.id} {adr.title}", detail="content edited",
            ))
    new_adr_ids = {a.id for a in new.architecture_decisions}
    for adr in old.architecture_decisions:
        if adr.id not in new_adr_ids:
            entries.append(DiffEntry(
                section="Architecture decisions", change="removed",
                item=f"{adr.id} {adr.title}",
            ))

    # Epics (title/description/Jira status), then stories flattened across
    # epics -- a story gaining a jira_key means it shipped to the tracker,
    # which is delivery progress worth reporting.
    old_epics = {e.id: e for e in old.epics}
    for epic in new.epics:
        if epic.id not in old_epics:
            entries.append(DiffEntry(
                section="Epics", change="added", item=f"{epic.id} {epic.title}",
                detail=f"{len(epic.stories)} stories",
            ))
        else:
            old_epic = old_epics[epic.id]
            if old_epic.jira_key is None and epic.jira_key:
                entries.append(DiffEntry(
                    section="Epics", change="modified", item=f"{epic.id} {epic.title}",
                    detail=f"pushed to Jira as {epic.jira_key}",
                ))
            elif old_epic.jira_key and old_epic.jira_status != epic.jira_status:
                entries.append(DiffEntry(
                    section="Epics", change="modified", item=f"{epic.id} {epic.title}",
                    detail=f"status: {old_epic.jira_status} -> {epic.jira_status}",
                ))
            elif old_epic.business_impact != epic.business_impact:
                entries.append(DiffEntry(
                    section="Epics", change="modified", item=f"{epic.id} {epic.title}",
                    detail=f"business impact: {old_epic.business_impact} -> {epic.business_impact}",
                ))
            elif (old_epic.title, old_epic.description) != (epic.title, epic.description):
                entries.append(DiffEntry(
                    section="Epics", change="modified", item=f"{epic.id} {epic.title}",
                    detail="title/description edited",
                ))
    new_epic_ids = {e.id for e in new.epics}
    for epic in old.epics:
        if epic.id not in new_epic_ids:
            entries.append(DiffEntry(section="Epics", change="removed", item=f"{epic.id} {epic.title}"))

    old_stories = {s.id: s for e in old.epics for s in e.stories}
    new_stories = {s.id: s for e in new.epics for s in e.stories}
    for sid, story in new_stories.items():
        old_story = old_stories.get(sid)
        if old_story is None:
            entries.append(DiffEntry(
                section="Stories", change="added",
                item=f"{sid} {story.title}", detail=f"[{story.story_type}]",
            ))
        elif old_story.jira_key is None and story.jira_key:
            entries.append(DiffEntry(
                section="Stories", change="modified",
                item=f"{sid} {story.title}", detail=f"pushed to Jira as {story.jira_key}",
            ))
        elif old_story.jira_key and old_story.jira_status != story.jira_status:
            entries.append(DiffEntry(
                section="Stories", change="modified",
                item=f"{sid} {story.title}", detail=f"status: {old_story.jira_status} -> {story.jira_status}",
            ))
        elif old_story != story:
            entries.append(DiffEntry(
                section="Stories", change="modified",
                item=f"{sid} {story.title}", detail="edited",
            ))
    for sid, story in old_stories.items():
        if sid not in new_stories:
            entries.append(DiffEntry(section="Stories", change="removed", item=f"{sid} {story.title}"))

    # Diagrams: only real content changes; PNG re-rasterization is not news.
    old_diagrams = {d.diagram_type: d for d in old.diagrams}
    new_diagrams = {d.diagram_type: d for d in new.diagrams}
    for dtype, diagram in new_diagrams.items():
        old_d = old_diagrams.get(dtype)
        if old_d is None:
            entries.append(DiffEntry(section="Diagrams", change="added", item=diagram.title, detail=dtype))
        elif old_d.mermaid_source != diagram.mermaid_source:
            entries.append(DiffEntry(section="Diagrams", change="modified", item=diagram.title, detail=f"{dtype} regenerated"))
    for dtype, diagram in old_diagrams.items():
        if dtype not in new_diagrams:
            entries.append(DiffEntry(section="Diagrams", change="removed", item=diagram.title, detail=dtype))

    return entries
