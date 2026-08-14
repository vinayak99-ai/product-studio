"""Launcher for Product Studio -- starts the frontend (Vite dev server) and
the backend (FastAPI/uvicorn) together from one command, run from the repo
root. Does not create or activate a virtual environment: it runs the
backend with whichever Python interpreter you invoke this script with, so
activate your own venv first if you're using one -- this just starts the
process.

Usage: `python run.py` from the repo root (same place this file lives).

Backend launch mechanics are unchanged from what the backend used to run
directly (`uvicorn app.main:app --reload --port 8000`), except on Windows,
where this sets the asyncio event loop policy to Proactor *before* uvicorn
or app.main is even imported, then starts uvicorn programmatically instead
of via the CLI's app-string import path, with --reload off.

Why: Diagram Slides (backend/app/routes/diagram_slide.py) launches headless
Chromium via Playwright's async API to render a diagram to PNG, which needs
subprocess support from the running event loop. On Windows, plain `uvicorn
app.main:app --reload` runs its main loop on WindowsSelectorEventLoop,
which doesn't implement subprocess creation -- regardless of which thread
or which Playwright API triggers it, that raises NotImplementedError (see
backend/app/diagram_slide_render.py).

Setting the policy inside app/main.py at import time wasn't reliably early
enough with --reload (an earlier version of this fix tried that): uvicorn's
reloader can create its event loop before app.main gets (re-)imported.
Moving the policy-set into this script, ahead of importing uvicorn at all,
fixes that -- for the process this script itself runs in. But --reload
doesn't run the server in *this* process at all: it spawns the actual
server as a separate child process it manages, specifically so it can
restart that child on file changes, and there's no guarantee that child
re-runs the policy line below before uvicorn touches its event loop. So on
Windows, --reload is off here -- not a workaround for a specific observed
failure, just removing that whole class of ordering risk instead of trying
to reason about it. Every other platform keeps --reload, since the
Proactor/Selector split -- and therefore this entire problem -- is
Windows-only; there's no correctness reason to give it up elsewhere.

The frontend is started first as a background subprocess (its own output
still prints to this same terminal); the backend then runs in the
foreground in this process, same as it always did, so Ctrl+C stops both --
the frontend subprocess is torn down in a finally block either way. `npm
run dev` isn't the process actually listening on the Vite port -- npm
spawns a shell, which spawns the real `vite`/node process underneath it
-- so terminating just the npm process alone leaves that grandchild
running as an orphan (confirmed: it does, in practice). To actually kill
the whole tree, the frontend is started in its own process group (POSIX)
or process group flag (Windows) and torn down as a group, not as a
single process.

Everything below lives inside the `if __name__ == "__main__":` guard, not
just the uvicorn.run() call -- uvicorn's --reload always spawns its worker
via multiprocessing's "spawn" start method (even on Linux/Mac, deliberately,
regardless of the platform's own default), which re-imports this module in
that worker process. Anything at true module level would silently run
again there too -- for the frontend Popen line that meant a second, orphan
`npm run dev` process starting alongside the first one.
"""

import asyncio
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FRONTEND_DIR = ROOT / "frontend"
BACKEND_DIR = ROOT / "backend"

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import uvicorn


def _start_frontend() -> subprocess.Popen:
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    if sys.platform == "win32":
        return subprocess.Popen(
            [npm_cmd, "run", "dev"], cwd=FRONTEND_DIR, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
        )
    import os

    return subprocess.Popen([npm_cmd, "run", "dev"], cwd=FRONTEND_DIR, preexec_fn=os.setsid)


def _stop_frontend(frontend: subprocess.Popen) -> None:
    if frontend.poll() is not None:
        return
    if sys.platform == "win32":
        # Kills the whole tree (npm.cmd -> node), not just the top process --
        # plain .terminate() only reaches the immediate child, leaving vite
        # running as an orphan.
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(frontend.pid)], capture_output=True)
    else:
        import os
        import signal

        os.killpg(os.getpgid(frontend.pid), signal.SIGTERM)


if __name__ == "__main__":
    frontend = _start_frontend()
    try:
        uvicorn.run(
            "app.main:app",
            host="127.0.0.1",
            port=8000,
            reload=sys.platform != "win32",
            app_dir=str(BACKEND_DIR),
        )
    finally:
        _stop_frontend(frontend)
