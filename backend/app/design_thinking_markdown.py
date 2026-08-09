from __future__ import annotations

from app.design_thinking_models import DesignThinkingSession


def executive_summary(session: DesignThinkingSession) -> str:
    """Assembled deterministically from the session's own data, not a
    separate LLM call -- same reasoning as the infographic deck's agenda
    slide: the facts already exist in the session, so summarizing them is
    a formatting problem, not a generation problem. Placed first in the
    export so a skimming reader (human or Spec Builder's own extraction
    step) gets the point before any of the supporting detail.

    Plain prose, no markup -- shared verbatim by both the Markdown and HTML
    exports (see design_thinking_html.py), so it can't carry format-specific
    syntax either one would need to strip or reinterpret.
    """
    persona_names = ", ".join(p.name for p in session.personas) or "the target users"
    parts = [f"This exploration focused on {session.problem_area}, centered on {persona_names}."]

    povs = [s.assembled for s in session.problem_statements]
    if povs:
        parts.append(" ".join(povs))

    if session.concept_briefs:
        n = len(session.concept_briefs)
        plural = "direction" if n == 1 else "directions"
        names = ", ".join(b.concept_name for b in session.concept_briefs)
        parts.append(f"It's pursuing {n} concept {plural}: {names}.")

    return " ".join(parts)


def build_design_thinking_markdown(session: DesignThinkingSession) -> str:
    """Pure, deterministic assembly -- every field here already exists in
    the session; this only formats it. The Spec Builder-facing contract:
    clean headers over prose, exactly the shape `run_extraction()` is
    already built to digest into problem_statement/target_users/goals.
    """
    lines: list[str] = [f"# Design Thinking: {session.problem_area}", "", "## Executive Summary", ""]
    lines.append(executive_summary(session))
    lines.append("")

    if session.personas:
        lines.append("## Personas")
        lines.append("")
        for p in session.personas:
            lines.append(f"### {p.name}")
            lines.append(f"**Context:** {p.context}")
            lines.append("")
            if p.goals:
                lines.append("**Goals**")
                lines += [f"- {g}" for g in p.goals]
                lines.append("")
            if p.pains:
                lines.append("**Pains**")
                lines += [f"- {x}" for x in p.pains]
                lines.append("")
            if p.behaviors:
                lines.append("**Behaviors**")
                lines += [f"- {x}" for x in p.behaviors]
                lines.append("")
            if p.voices:
                lines.append("**Contributed by**")
                lines += [f"- {v.name} ({v.role}): {v.input}" for v in p.voices]
                lines.append("")

    if session.problem_statements:
        lines.append("## Problem Statement(s)")
        lines.append("")
        for s in session.problem_statements:
            lines.append(f"> **{s.persona_name}:** {s.assembled}")
            lines.append("")

    selected_hmw = [h for h in session.how_might_we if h.selected]
    if selected_hmw:
        lines.append("## How Might We")
        lines.append("")
        lines += [f"- {h.question}" for h in selected_hmw]
        lines.append("")

    if session.concept_briefs:
        lines.append("## Concept Directions")
        lines.append("")
        for b in session.concept_briefs:
            lines.append(f"### {b.concept_name}")
            lines.append(b.description)
            lines.append("")
            if b.key_interactions:
                lines.append("**Key interactions**")
                lines += [f"- {x}" for x in b.key_interactions]
                lines.append("")
            if b.assumptions:
                lines.append("**Assumptions**")
                lines += [f"- {x}" for x in b.assumptions]
                lines.append("")
            lines.append(f"**Biggest risk:** {b.biggest_risk}")
            lines.append("")

    if session.validation_plans:
        lines.append("## Validation Plan")
        lines.append("")
        for v in session.validation_plans:
            lines.append(f"### {v.concept_name}")
            if v.hypotheses:
                lines.append("**Hypotheses**")
                lines += [f"- {h}" for h in v.hypotheses]
                lines.append("")
            lines.append(f"**Success signal:** {v.success_signal}")
            lines.append("")
            lines.append(f"**Risk if wrong:** {v.risk_if_wrong}")
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"
