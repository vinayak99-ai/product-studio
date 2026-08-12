"""Launcher for the backend -- equivalent to `uvicorn app.main:app --reload
--port 8000`, except on Windows, where this sets the asyncio event loop
policy to Proactor *before* uvicorn or app.main is even imported, then
starts uvicorn programmatically instead of via the CLI's app-string import
path.

Why: Diagram Slides (app/routes/diagram_slide.py) launches headless
Chromium via Playwright's async API to render a diagram to PNG, which needs
subprocess support from the running event loop. On Windows, plain `uvicorn
app.main:app --reload` runs its main loop on WindowsSelectorEventLoop,
which doesn't implement subprocess creation -- regardless of which thread
or which Playwright API triggers it, that raises NotImplementedError (see
app/diagram_slide_render.py). Setting the policy inside app/main.py at
import time isn't reliably early enough with --reload: uvicorn's reloader
can end up creating its event loop before app.main gets (re-)imported in
the reloaded process, so a module-level line there wasn't guaranteed to run
first. Setting the policy here, in a standalone script that hasn't
imported uvicorn or app.main yet, removes that ordering risk entirely.

On non-Windows platforms this is a plain, unmodified `uvicorn.run(...)`
call -- functionally identical to the documented `uvicorn app.main:app
--reload --port 8000` command, so there's no behavior change there.

Usage: `python run.py` from the backend/ directory (same place you'd run
`uvicorn app.main:app --reload --port 8000` from). On Windows, start.ps1
wraps this with venv activation.
"""

import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
