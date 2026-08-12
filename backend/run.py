"""Launcher for the backend -- equivalent to `uvicorn app.main:app --reload
--port 8000`, except on Windows, where this sets the asyncio event loop
policy to Proactor *before* uvicorn or app.main is even imported, then
starts uvicorn programmatically instead of via the CLI's app-string import
path, with --reload off.

Why: Diagram Slides (app/routes/diagram_slide.py) launches headless
Chromium via Playwright's async API to render a diagram to PNG, which needs
subprocess support from the running event loop. On Windows, plain `uvicorn
app.main:app --reload` runs its main loop on WindowsSelectorEventLoop,
which doesn't implement subprocess creation -- regardless of which thread
or which Playwright API triggers it, that raises NotImplementedError (see
app/diagram_slide_render.py).

Setting the policy inside app/main.py at import time wasn't reliably early
enough with --reload (an earlier version of this fix tried that): uvicorn's
reloader can create its event loop before app.main gets (re-)imported.
Moving the policy-set into this standalone script, ahead of importing
uvicorn at all, fixes that -- for the process this script itself runs in.
But --reload doesn't run the server in *this* process at all: it spawns the
actual server as a separate child process it manages, specifically so it
can restart that child on file changes, and there's no guarantee that
child re-runs the policy line below before uvicorn touches its event loop.
So on Windows, --reload is off here -- not a workaround for a specific
observed failure, just removing that whole class of ordering risk instead
of trying to reason about it. Every other platform keeps --reload, since
the Proactor/Selector split -- and therefore this entire problem -- is
Windows-only; there's no correctness reason to give it up elsewhere.

Usage: `python run.py` from the backend/ directory (same place you'd run
`uvicorn app.main:app --reload --port 8000` from). On Windows, start.ps1
wraps this with venv activation. Restart manually after code changes when
running this way on Windows -- there's no auto-reload on that path.
"""

import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=sys.platform != "win32")
