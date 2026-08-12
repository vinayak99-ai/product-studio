# Windows launcher for the backend. Activates the local venv, then runs
# run.py instead of `uvicorn app.main:app --reload` directly -- run.py sets
# the asyncio event loop policy to Proactor before uvicorn (or app.main) is
# imported, which the plain `uvicorn` CLI command can't guarantee with
# --reload on Windows. See run.py's docstring and
# app/diagram_slide_render.py for why Diagram Slides' PPTX export needs this.
#
# Usage: from backend/, run `.\start.ps1`

& "$PSScriptRoot\.venv\Scripts\Activate.ps1"
python "$PSScriptRoot\run.py"
