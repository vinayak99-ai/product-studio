"""Server-side HTML -> PNG rendering for the Diagram Slides tool.

The LLM returns a complete, self-contained HTML document (see
diagram_slide_llm.py); this module screenshots it with headless Chromium so
it can be embedded as a full-bleed image in a PPTX slide
(diagram_slide_template.py). This is a synchronous, blocking call (Playwright's
sync API) run in a worker thread by the caller -- there is no async Playwright
dependency elsewhere in this codebase, and routes/diagram_slide.py offloads it
via asyncio.to_thread so it doesn't block the event loop.

Requires the `playwright` package (see requirements.txt) plus a matching
browser install (`playwright install chromium`) at deploy time.
"""

from playwright.sync_api import sync_playwright

RENDER_WIDTH_PX = 1920
RENDER_HEIGHT_PX = 1080


def render_html_to_png(html: str, width_px: int = RENDER_WIDTH_PX, height_px: int = RENDER_HEIGHT_PX) -> bytes:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": width_px, "height": height_px})
            page.set_content(html, wait_until="networkidle")
            return page.screenshot(type="png")
        finally:
            browser.close()
