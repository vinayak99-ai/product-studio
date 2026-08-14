"""One-time logging setup, called from main.py before anything else in the
app runs. Every module in this backend logs via the standard `logging`
module (`logging.getLogger(__name__)`) rather than print() -- this just
configures where those records go and how they're formatted.

Two destinations, both always on:
- Console (stdout) -- what you see in whichever terminal/PowerShell window
  is running the backend.
- A rotating log file under `~/product-studio-logs/backend.log` -- so a
  crash that takes the terminal's scrollback with it (or a window closed
  before you noticed the error) doesn't lose the trail. Rotates at 5MB,
  keeps 3 backups, so it never grows unbounded.

Level is controlled by `LOG_LEVEL` in backend/.env (default INFO) --
Knowledge Base's step-by-step tracing (upload/replace/delete, chunking,
embedding, search) all logs at INFO specifically so it's visible without
changing anything. Set LOG_LEVEL=DEBUG for finer detail from third-party
libraries (openai, httpx, chromadb) too.
"""

from __future__ import annotations

import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_DIR = Path.home() / "product-studio-logs"
LOG_FILE = LOG_DIR / "backend.log"

_FORMAT = "%(asctime)s %(levelname)-8s %(name)s: %(message)s"

_configured = False


def configure_logging(level: str = "INFO") -> None:
    global _configured
    if _configured:
        return
    _configured = True

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    resolved_level = getattr(logging, level.upper(), logging.INFO)

    formatter = logging.Formatter(_FORMAT)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)

    file_handler = RotatingFileHandler(LOG_FILE, maxBytes=5_000_000, backupCount=3, encoding="utf-8")
    file_handler.setFormatter(formatter)

    root = logging.getLogger()
    root.setLevel(resolved_level)
    root.addHandler(console_handler)
    root.addHandler(file_handler)

    # Third-party libraries stay at WARNING unless LOG_LEVEL is explicitly
    # turned down to DEBUG -- otherwise httpx alone logs a line per HTTP
    # request/response, which buries the app's own KB trace in noise.
    noisy_level = logging.DEBUG if resolved_level <= logging.DEBUG else logging.WARNING
    for name in ("httpx", "httpcore", "openai", "chromadb", "urllib3"):
        logging.getLogger(name).setLevel(noisy_level)

    logging.getLogger(__name__).info("Logging configured: level=%s, file=%s", level.upper(), LOG_FILE)
