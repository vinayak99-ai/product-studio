from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, Response
from openai import OpenAIError

from app.design_thinking_llm import (
    briefs_block,
    generate_concept_briefs,
    generate_concept_sparks,
    generate_how_might_we,
    generate_personas,
    generate_problem_statements,
    generate_validation_plans,
    hmw_block,
    personas_block,
    problem_statements_block,
    run_clarify_round,
    sparks_block,
)
from app.design_thinking_html import build_design_thinking_html
from app.design_thinking_markdown import build_design_thinking_markdown
from app.design_thinking_models import (
    CLARIFY_MAX_ROUNDS,
    CLARIFY_MAX_TOTAL_QUESTIONS,
    CLARIFY_ROUND_SIZE,
    AnsweredClarification,
    ClarifyResult,
    DefineRequest,
    DefineResult,
    DesignThinkingSession,
    EmpathizeRequest,
    EmpathizeResult,
    IdeateHmwRequest,
    IdeateHmwResult,
    IdeateSparksRequest,
    IdeateSparksResponse,
    PrototypeRequest,
    PrototypeResult,
    TestRequest,
    TestResult,
)

router = APIRouter(prefix="/api/design-thinking")


def _openai_error(exc: OpenAIError) -> HTTPException:
    return HTTPException(status_code=502, detail=f"OpenAI request failed: {exc}")


async def _maybe_clarify(
    request_round: int,
    force_generate: bool,
    clarifications: list[AnsweredClarification],
    stage_label: str,
    context_block: str,
) -> ClarifyResult | None:
    """Runs one clarify round if the stage's question/round budget allows it.
    Returns None (meaning: go ahead and generate) once the budget is spent,
    the PM asked to skip, or the agent itself has nothing left to ask."""
    if force_generate or request_round > CLARIFY_MAX_ROUNDS:
        return None
    budget = CLARIFY_MAX_TOTAL_QUESTIONS - len(clarifications)
    if budget <= 0:
        return None
    clarify = await run_clarify_round(stage_label, context_block, clarifications)
    questions = clarify.questions[: min(CLARIFY_ROUND_SIZE, budget)]
    return ClarifyResult(questions=questions) if questions else None


@router.post("/empathize", response_model=EmpathizeResult)
async def api_empathize(request: EmpathizeRequest) -> EmpathizeResult:
    try:
        clarify = await _maybe_clarify(
            request.round,
            request.force_generate,
            request.clarifications,
            stage_label="Empathize -- deriving personas from research material",
            context_block=(
                f"Research material:\n{request.material}\n\n"
                f"Focus:\n{request.prompt or '(none given)'}"
            ),
        )
        if clarify:
            return EmpathizeResult(status="needs_clarification", questions=clarify.questions)
        result = await generate_personas(request.material, request.prompt, request.clarifications)
        return EmpathizeResult(status="generated", personas=result.personas)
    except OpenAIError as exc:
        raise _openai_error(exc) from exc


@router.post("/define", response_model=DefineResult)
async def api_define(request: DefineRequest) -> DefineResult:
    try:
        clarify = await _maybe_clarify(
            request.round,
            request.force_generate,
            request.clarifications,
            stage_label="Define -- synthesizing personas into POV problem statements",
            context_block=(
                f"Personas:\n{personas_block(request.personas)}\n\n"
                f"Focus:\n{request.prompt or '(none given)'}"
            ),
        )
        if clarify:
            return DefineResult(status="needs_clarification", questions=clarify.questions)
        result = await generate_problem_statements(request.personas, request.prompt, request.clarifications)
        return DefineResult(status="generated", problem_statements=result.problem_statements)
    except OpenAIError as exc:
        raise _openai_error(exc) from exc


@router.post("/ideate/how-might-we", response_model=IdeateHmwResult)
async def api_ideate_hmw(request: IdeateHmwRequest) -> IdeateHmwResult:
    try:
        clarify = await _maybe_clarify(
            request.round,
            request.force_generate,
            request.clarifications,
            stage_label="Ideate -- reframing problem statements into How Might We questions",
            context_block=(
                f"Problem statements:\n{problem_statements_block(request.problem_statements)}\n\n"
                f"Focus:\n{request.prompt or '(none given)'}"
            ),
        )
        if clarify:
            return IdeateHmwResult(status="needs_clarification", questions=clarify.questions)
        result = await generate_how_might_we(
            request.problem_statements, request.prompt, request.clarifications
        )
        return IdeateHmwResult(status="generated", how_might_we=result.how_might_we)
    except OpenAIError as exc:
        raise _openai_error(exc) from exc


@router.post("/ideate/concept-sparks", response_model=IdeateSparksResponse)
async def api_ideate_sparks(request: IdeateSparksRequest) -> IdeateSparksResponse:
    selected = [h for h in request.how_might_we if h.selected]
    if not selected:
        raise HTTPException(status_code=400, detail="Select at least one How Might We question first.")
    try:
        return await generate_concept_sparks(selected, request.prompt)
    except OpenAIError as exc:
        raise _openai_error(exc) from exc


@router.post("/prototype", response_model=PrototypeResult)
async def api_prototype(request: PrototypeRequest) -> PrototypeResult:
    selected = [s for s in request.concept_sparks if s.selected]
    if not selected:
        raise HTTPException(status_code=400, detail="Select at least one concept spark first.")
    try:
        clarify = await _maybe_clarify(
            request.round,
            request.force_generate,
            request.clarifications,
            stage_label="Prototype -- expanding selected concept sparks into concept briefs",
            context_block=(
                f"Selected concept sparks:\n{sparks_block(selected)}\n\n"
                f"Focus:\n{request.prompt or '(none given)'}"
            ),
        )
        if clarify:
            return PrototypeResult(status="needs_clarification", questions=clarify.questions)
        result = await generate_concept_briefs(selected, request.prompt, request.clarifications)
        return PrototypeResult(status="generated", concept_briefs=result.concept_briefs)
    except OpenAIError as exc:
        raise _openai_error(exc) from exc


@router.post("/test", response_model=TestResult)
async def api_test(request: TestRequest) -> TestResult:
    if not request.concept_briefs:
        raise HTTPException(status_code=400, detail="No concept briefs to validate yet.")
    try:
        clarify = await _maybe_clarify(
            request.round,
            request.force_generate,
            request.clarifications,
            stage_label="Test -- deriving a validation plan per concept brief",
            context_block=(
                f"Concept briefs:\n{briefs_block(request.concept_briefs)}\n\n"
                f"Focus:\n{request.prompt or '(none given)'}"
            ),
        )
        if clarify:
            return TestResult(status="needs_clarification", questions=clarify.questions)
        result = await generate_validation_plans(request.concept_briefs, request.prompt, request.clarifications)
        return TestResult(status="generated", validation_plans=result.validation_plans)
    except OpenAIError as exc:
        raise _openai_error(exc) from exc


def _export_filename(problem_area: str, extension: str) -> str:
    """Slugified exploration title, so each export is named after what it
    actually is instead of every download landing as 'design-thinking.md'.
    The regex only ever emits [a-z0-9-], which also makes it safe to drop
    straight into a Content-Disposition header with no further escaping.
    Mirrors the frontend's slugify() in lib/designThinkingApi.ts -- keep the
    two in sync if either changes."""
    slug = re.sub(r"[^a-z0-9]+", "-", problem_area.strip().lower()).strip("-")[:60].rstrip("-")
    return f"{slug or 'design-thinking'}.{extension}"


@router.post("/export")
def api_export(session: DesignThinkingSession) -> Response:
    markdown = build_design_thinking_markdown(session)
    return Response(
        content=markdown,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{_export_filename(session.problem_area, "md")}"'},
    )


@router.post("/export/html")
def api_export_html(session: DesignThinkingSession) -> Response:
    html = build_design_thinking_html(session)
    return Response(
        content=html,
        media_type="text/html",
        headers={
            "Content-Disposition": f'attachment; filename="{_export_filename(session.problem_area, "html")}"'
        },
    )
