"""Server-side HTML -> PNG rendering for the Diagram Slides tool.

The LLM returns a complete, self-contained HTML document (see
diagram_slide_llm.py); this module screenshots it with headless Chromium so
it can be embedded as a full-bleed image in a PPTX slide
(diagram_slide_template.py).

Uses Playwright's ASYNC API, awaited directly from the FastAPI route --
deliberately not the sync API run in a worker thread (an earlier version did
that). Playwright's sync API launches its own background thread with a new
asyncio event loop, and on Windows that thread inherits whatever event loop
*policy* is globally active; if anything in the process (uvicorn, an
installed package, a prior `asyncio.set_event_loop_policy` call) has left
that policy as SelectorEventLoop instead of ProactorEventLoop, subprocess
creation -- which launching the browser needs -- raises
`NotImplementedError` there. Playwright's own docs call this out: the sync
API isn't meant to run inside a process that already has its own asyncio
event loop, which a FastAPI app always does. The async API sidesteps the
whole problem by using the loop that's already running instead of spinning
up a second one.

Requires the `playwright` package (see requirements.txt) plus a matching
browser install (`playwright install chromium`) at deploy time.
"""

from playwright.async_api import async_playwright

RENDER_WIDTH_PX = 1920
RENDER_HEIGHT_PX = 1080


async def render_html_to_png(html: str, width_px: int = RENDER_WIDTH_PX, height_px: int = RENDER_HEIGHT_PX) -> bytes:
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch()
        try:
            page = await browser.new_page(viewport={"width": width_px, "height": height_px})
            await page.set_content(html, wait_until="networkidle")
            return await page.screenshot(type="png")
        finally:
            await browser.close()
