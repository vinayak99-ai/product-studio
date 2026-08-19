"""Backend-only launcher -- equivalent to `uvicorn app.main:app --reload
--port 8000` run from backend/.

Does not create or activate a virtual environment itself: runs with
whichever Python interpreter you invoke this script with. start.ps1
invokes it with backend\\.venv's interpreter specifically, and wraps it in
its own detached console window so it survives closing whatever shell
launched it.

Usage: `python run_backend.py` from the repo root (same place this file
lives).
"""

from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parent
BACKEND_DIR = ROOT / "backend"

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        app_dir=str(BACKEND_DIR),
    )
