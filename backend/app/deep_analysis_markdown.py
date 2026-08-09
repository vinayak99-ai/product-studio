from __future__ import annotations

from app.deep_analysis_models import DeepAnalysisDocument


def build_deep_analysis_markdown(document: DeepAnalysisDocument) -> str:
    """Pure, deterministic assembly -- every field here is already plain
    prose from the synthesis agent; this only lays it out. Same
    Spec-Builder-facing shape as every other export in this app: clean
    headers over prose."""
    lines: list[str] = [f"# {document.title}", "", "## Executive Summary", "", document.executive_summary, ""]

    lines += ["## Problem Statement", "", document.problem_statement, ""]

    if document.background:
        lines.append("## Background")
        lines.append("")
        for b in document.background:
            lines += [f"### {b.heading}", b.narrative, ""]

    if document.prior_attempts:
        lines.append("## Prior Attempts")
        lines.append("")
        for a in document.prior_attempts:
            lines += [
                f"### {a.name}",
                a.description,
                f"**Outcome:** {a.outcome}",
                f"**Lesson:** {a.lesson}",
                "",
            ]

    if document.root_causes:
        lines.append("## Root Causes")
        lines.append("")
        lines += [f"- **{c.cause}** — {c.evidence}" for c in document.root_causes]
        lines.append("")

    if document.stakeholder_considerations:
        lines.append("## Stakeholder Considerations")
        lines.append("")
        for c in document.stakeholder_considerations:
            lines += [f"### {c.heading}", c.detail, ""]

    if document.constraints:
        lines.append("## Constraints")
        lines.append("")
        for c in document.constraints:
            lines += [f"### {c.heading}", c.detail, ""]

    lines += ["## Success Definition", "", document.success_definition, ""]

    if document.open_risks:
        lines.append("## Open Risks")
        lines.append("")
        lines += [f"- **{r.risk}** — {r.why_it_matters}" for r in document.open_risks]
        lines.append("")

    if document.recommended_focus_areas:
        lines.append("## Recommended Focus Areas")
        lines.append("")
        lines += [f"- {a}" for a in document.recommended_focus_areas]
        lines.append("")

    if document.clarifications:
        lines.append("## Clarification Interview")
        lines.append("")
        for c in document.clarifications:
            lines += [f"**Q:** {c.question.question}", f"**A:** {c.answer}", ""]

    return "\n".join(lines).rstrip() + "\n"
