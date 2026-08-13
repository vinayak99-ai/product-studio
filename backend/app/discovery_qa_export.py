from __future__ import annotations

from app.discovery_qa_models import DiscoverySessionDetail


def build_meeting_minutes_markdown(detail: DiscoverySessionDetail) -> str:
    meta = detail.meta
    lines = [
        f"# {meta.name}",
        "",
        f"**Source spec:** {meta.source_project_name}  ",
        f"**Date:** {meta.updated_at}",
        "",
    ]

    for i, q in enumerate(detail.questions, start=1):
        lines.append(f"## {i}. {q.text}")
        lines.append("")
        answer = q.enriched_answer or q.answer
        lines.append(answer if answer.strip() else "*(not answered)*")
        lines.append("")

    notes = detail.enriched_notes or detail.notes
    if notes.strip():
        lines.append("## Additional Notes")
        lines.append("")
        lines.append(notes)
        lines.append("")

    return "\n".join(lines)
