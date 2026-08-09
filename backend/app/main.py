from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routes.generate import router as generate_router
from app.routes.sequence import router as sequence_router
from app.routes.infographic import router as infographic_router
from app.routes.story import router as story_router
from app.routes.design_thinking import router as design_thinking_router
from app.routes.doc_qa import router as doc_qa_router
from app.routes.jira import router as jira_router
from app.spec_builder.main import app as spec_builder_app

settings = get_settings()

app = FastAPI(title="Product Studio API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(generate_router)
app.include_router(sequence_router)
app.include_router(infographic_router)
app.include_router(story_router)
app.include_router(design_thinking_router)
app.include_router(doc_qa_router)
app.include_router(jira_router)

# Spec Builder's own FastAPI app, routed at /pm/* -- e.g. /pm/projects. It
# keeps its own CORS middleware (app/spec_builder/main.py), which already
# covers Product Studio's frontend origin.
app.mount("/pm", spec_builder_app)
