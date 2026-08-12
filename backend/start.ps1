# Windows launcher for the backend. Activates the local venv, then runs
# run.py instead of `uvicorn app.main:app --reload` directly -- run.py sets
# the asyncio event loop policy to Proactor before uvicorn (or app.main) is
# imported, and runs without --reload on Windows, since --reload's child
# process isn't guaranteed to inherit that policy either. See run.py's
# docstring and app/diagram_slide_render.py for why Diagram Slides' PPTX
# export needs this. No auto-reload on this path -- restart start.ps1
# after backend code changes.
#
# Usage: from backend/, run `.\start.ps1`

& "$PSScriptRoot\.venv\Scripts\Activate.ps1"
python "$PSScriptRoot\run.py"
