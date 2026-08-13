from __future__ import annotations

from app.discovery_qa_models import DiscoverySessionDetail


def _one_line(text: str) -> str:
    # A bullet has to stay on one line to paste cleanly into meeting-minutes
    # notes -- collapse any newlines a PM typed into the answer textarea.
    return " ".join(text.split())


def build_meeting_minutes_markdown(detail: DiscoverySessionDetail) -> str:
    meta = detail.meta
    lines = [
        f"# {meta.name}",
        "",
        f"**Source spec:** {meta.source_project_name}  ",
        f"**Date:** {meta.updated_at}",
        "",
    ]

    for q in detail.questions:
        if q.enriched_bullet:
            # The LLM already synthesized question + answer into one
            # natural bullet -- use it verbatim rather than re-joining.
            lines.append(f"- {_one_line(q.enriched_bullet)}")
            continue
        question = _one_line(q.text)
        answer = _one_line(q.enriched_answer or q.answer)
        answer = answer if answer else "*(not answered)*"
        lines.append(f"- {question} — {answer}")

    lines.append("")

    notes = detail.enriched_notes or detail.notes
    if notes.strip():
        lines.append("## Additional Notes")
        lines.append("")
        lines.append(notes)
        lines.append("")

    return "\n".join(lines)
