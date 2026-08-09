from __future__ import annotations

from html import escape

from app.design_thinking_markdown import executive_summary
from app.design_thinking_models import DesignThinkingSession

# Plain semantic HTML (h1-h3, p, ul/li, blockquote, strong) -- no layout
# CSS beyond a light readability pass in <head>. The point isn't a pretty
# standalone page; it's that opening this in a browser, selecting the body,
# and pasting into Confluence (or any rich-text editor) hands it real
# headings/bullets/bold, not a wall of Markdown syntax to clean up by hand.

_STYLE = """
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
         color: #1a1a1a; line-height: 1.5; max-width: 760px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.25rem; margin-top: 2rem; border-bottom: 1px solid #ddd; padding-bottom: 0.25rem; }
  h3 { font-size: 1.05rem; margin-top: 1.25rem; margin-bottom: 0.25rem; }
  ul { margin-top: 0.25rem; }
  blockquote { margin: 0.5rem 0; padding-left: 0.75rem; border-left: 3px solid #ccc; color: #333; }
  p { margin: 0.4rem 0; }
"""


def _e(text: str) -> str:
    return escape(text, quote=False)


def _bullets(title: str, items: list[str]) -> list[str]:
    if not items:
        return []
    return [f"<p><strong>{_e(title)}</strong></p>", "<ul>"] + [f"<li>{_e(x)}</li>" for x in items] + ["</ul>"]


def build_design_thinking_html(session: DesignThinkingSession) -> str:
    """Pure, deterministic assembly -- mirrors build_design_thinking_markdown
    section-for-section (see that module) so the two exports never drift
    apart in what they cover, just how they're marked up."""
    body: list[str] = [
        f"<h1>Design Thinking: {_e(session.problem_area)}</h1>",
        "<h2>Executive Summary</h2>",
        f"<p>{_e(executive_summary(session))}</p>",
    ]

    if session.personas:
        body.append("<h2>Personas</h2>")
        for p in session.personas:
            body.append(f"<h3>{_e(p.name)}</h3>")
            body.append(f"<p><strong>Context:</strong> {_e(p.context)}</p>")
            body += _bullets("Goals", p.goals)
            body += _bullets("Pains", p.pains)
            body += _bullets("Behaviors", p.behaviors)
            if p.voices:
                body.append("<p><strong>Contributed by</strong></p>")
                body.append("<ul>")
                body += [f"<li>{_e(v.name)} ({_e(v.role)}): {_e(v.input)}</li>" for v in p.voices]
                body.append("</ul>")

    if session.problem_statements:
        body.append("<h2>Problem Statement(s)</h2>")
        for s in session.problem_statements:
            body.append(f"<blockquote><strong>{_e(s.persona_name)}:</strong> {_e(s.assembled)}</blockquote>")

    selected_hmw = [h for h in session.how_might_we if h.selected]
    if selected_hmw:
        body.append("<h2>How Might We</h2>")
        body.append("<ul>")
        body += [f"<li>{_e(h.question)}</li>" for h in selected_hmw]
        body.append("</ul>")

    if session.concept_briefs:
        body.append("<h2>Concept Directions</h2>")
        for b in session.concept_briefs:
            body.append(f"<h3>{_e(b.concept_name)}</h3>")
            body.append(f"<p>{_e(b.description)}</p>")
            body += _bullets("Key interactions", b.key_interactions)
            body += _bullets("Assumptions", b.assumptions)
            body.append(f"<p><strong>Biggest risk:</strong> {_e(b.biggest_risk)}</p>")

    if session.validation_plans:
        body.append("<h2>Validation Plan</h2>")
        for v in session.validation_plans:
            body.append(f"<h3>{_e(v.concept_name)}</h3>")
            body += _bullets("Hypotheses", v.hypotheses)
            body.append(f"<p><strong>Success signal:</strong> {_e(v.success_signal)}</p>")
            body.append(f"<p><strong>Risk if wrong:</strong> {_e(v.risk_if_wrong)}</p>")

    title = _e(session.problem_area) or "Design Thinking"
    return (
        "<!doctype html>\n<html><head><meta charset=\"utf-8\">"
        f"<title>{title}</title><style>{_STYLE}</style></head><body>\n"
        + "\n".join(body)
        + "\n</body></html>\n"
    )
