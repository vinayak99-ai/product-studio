from __future__ import annotations

from html import escape

from app.deep_analysis_models import DeepAnalysisDocument

# Plain semantic HTML (h1-h3, p, ul/li, strong) -- meant to be opened in a
# browser, selected, and pasted into a rich-text editor like Confluence,
# same pattern as Design Thinking's HTML export.

_STYLE = """
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
         color: #1a1a1a; line-height: 1.5; max-width: 760px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.25rem; margin-top: 2rem; border-bottom: 1px solid #ddd; padding-bottom: 0.25rem; }
  h3 { font-size: 1.05rem; margin-top: 1.25rem; margin-bottom: 0.25rem; }
  ul { margin-top: 0.25rem; }
  p { margin: 0.4rem 0; }
"""


def _e(text: str) -> str:
    return escape(text, quote=False)


def build_deep_analysis_html(document: DeepAnalysisDocument) -> str:
    """Pure, deterministic assembly -- mirrors build_deep_analysis_markdown
    section-for-section (see that module) so the two exports never drift
    apart in what they cover, just how they're marked up."""
    body: list[str] = [
        f"<h1>{_e(document.title)}</h1>",
        "<h2>Executive Summary</h2>",
        f"<p>{_e(document.executive_summary)}</p>",
        "<h2>Problem Statement</h2>",
        f"<p>{_e(document.problem_statement)}</p>",
    ]

    if document.background:
        body.append("<h2>Background</h2>")
        for b in document.background:
            body.append(f"<h3>{_e(b.heading)}</h3>")
            body.append(f"<p>{_e(b.narrative)}</p>")

    if document.prior_attempts:
        body.append("<h2>Prior Attempts</h2>")
        for a in document.prior_attempts:
            body.append(f"<h3>{_e(a.name)}</h3>")
            body.append(f"<p>{_e(a.description)}</p>")
            body.append(f"<p><strong>Outcome:</strong> {_e(a.outcome)}</p>")
            body.append(f"<p><strong>Lesson:</strong> {_e(a.lesson)}</p>")

    if document.root_causes:
        body.append("<h2>Root Causes</h2>")
        body.append("<ul>")
        body += [f"<li><strong>{_e(c.cause)}</strong> — {_e(c.evidence)}</li>" for c in document.root_causes]
        body.append("</ul>")

    if document.stakeholder_considerations:
        body.append("<h2>Stakeholder Considerations</h2>")
        for c in document.stakeholder_considerations:
            body.append(f"<h3>{_e(c.heading)}</h3>")
            body.append(f"<p>{_e(c.detail)}</p>")

    if document.constraints:
        body.append("<h2>Constraints</h2>")
        for c in document.constraints:
            body.append(f"<h3>{_e(c.heading)}</h3>")
            body.append(f"<p>{_e(c.detail)}</p>")

    body.append("<h2>Success Definition</h2>")
    body.append(f"<p>{_e(document.success_definition)}</p>")

    if document.open_risks:
        body.append("<h2>Open Risks</h2>")
        body.append("<ul>")
        body += [f"<li><strong>{_e(r.risk)}</strong> — {_e(r.why_it_matters)}</li>" for r in document.open_risks]
        body.append("</ul>")

    if document.recommended_focus_areas:
        body.append("<h2>Recommended Focus Areas</h2>")
        body.append("<ul>")
        body += [f"<li>{_e(a)}</li>" for a in document.recommended_focus_areas]
        body.append("</ul>")

    if document.clarifications:
        body.append("<h2>Clarification Interview</h2>")
        for c in document.clarifications:
            body.append(f"<p><strong>Q:</strong> {_e(c.question.question)}<br><strong>A:</strong> {_e(c.answer)}</p>")

    title = _e(document.title) or "Deep Analysis"
    return (
        "<!doctype html>\n<html><head><meta charset=\"utf-8\">"
        f"<title>{title}</title><style>{_STYLE}</style></head><body>\n"
        + "\n".join(body)
        + "\n</body></html>\n"
    )
