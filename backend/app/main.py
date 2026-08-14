# Windows note: Diagram Slides (routes/diagram_slide.py) launches headless
# Chromium via Playwright's async API, which needs subprocess support from
# the running event loop -- plain uvicorn on Windows defaults to
# WindowsSelectorEventLoop, which doesn't have that. That fix (forcing the
# Proactor event loop policy) does NOT live here: it has to run before
# uvicorn creates its event loop, and with --reload uvicorn can create that
# loop before this module gets (re-)imported, so a module-level line here
# isn't reliably early enough. See run_backend.py (repo root), which sets
# the policy in a standalone script before uvicorn is even imported, then
# starts uvicorn programmatically -- run that (or start-backend.ps1/
# start.ps1) instead of the bare `uvicorn app.main:app` command on Windows.

import logging
import time

from fastapi import FastAPI, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.logging_config import configure_logging
from app.extraction import extract_text
from app.routes.sequence import router as sequence_router
from app.routes.infographic import router as infographic_router
from app.routes.story import router as story_router
from app.routes.design_thinking import router as design_thinking_router
from app.routes.doc_qa import router as doc_qa_router
from app.routes.jira import router as jira_router
from app.routes.deep_analysis import router as deep_analysis_router
from app.routes.diagram_slide import router as diagram_slide_router
from app.routes.knowledge_base import router as knowledge_base_router
from app.routes.discovery_qa import router as discovery_qa_router
from app.spec_builder.main import app as spec_builder_app
from app.kb_models import SEED_COLLECTIONS, SEED_DEFAULT_INCLUDED
from app import kb_persistence

settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger(__name__)

app = FastAPI(title="Product Studio API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _log_requests(request: Request, call_next):
    """Logs every request's outcome and, critically, logs the full
    traceback for ANY unhandled exception before FastAPI turns it into a
    generic 500 -- otherwise an exception type nobody explicitly catches
    (e.g. in a route that only catches OpenAIError) would show up in the
    frontend as an opaque error with nothing in the backend log to explain
    it. Re-raises after logging so normal error handling is unaffected."""
    start = time.monotonic()
    try:
        response = await call_next(request)
    except Exception:
        elapsed_ms = (time.monotonic() - start) * 1000
        logger.exception(
            "UNHANDLED EXCEPTION: %s %s (after %.0fms)", request.method, request.url.path, elapsed_ms
        )
        raise
    elapsed_ms = (time.monotonic() - start) * 1000
    logger.info("%s %s -> %d (%.0fms)", request.method, request.url.path, response.status_code, elapsed_ms)
    return response


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# Shared across every tool's sidebar (paste-or-upload panel) -- previously
# lived in Flowchart Builder's own routes/generate.py, which owned the route
# even though the extraction logic itself (app/extraction.py) was already
# shared. Re-homed here directly rather than in a new file, matching the
# /api/health endpoint above.
@app.post("/api/extract")
async def extract(file: UploadFile) -> dict[str, str]:
    text = await extract_text(file)
    return {"text": text, "filename": file.filename or ""}


app.include_router(sequence_router)
app.include_router(infographic_router)
app.include_router(story_router)
app.include_router(design_thinking_router)
app.include_router(doc_qa_router)
app.include_router(jira_router)
app.include_router(deep_analysis_router)
app.include_router(diagram_slide_router)
app.include_router(knowledge_base_router)
app.include_router(discovery_qa_router)

# Spec Builder's own FastAPI app, routed at /pm/* -- e.g. /pm/projects. It
# keeps its own CORS middleware (app/spec_builder/main.py), which already
# covers Product Studio's frontend origin.
app.mount("/pm", spec_builder_app)


@app.on_event("startup")
async def _seed_knowledge_base_collections() -> None:
    """Idempotent (see kb_persistence.seed_default_collections) -- creates
    Firm Context / Project Context / Systems Info only if a collection with
    that name doesn't already exist yet, so this is safe to run on every
    restart, not just the first one."""
    kb_persistence.seed_default_collections(
        {name: name in SEED_DEFAULT_INCLUDED for name in SEED_COLLECTIONS}
    )
