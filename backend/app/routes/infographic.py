from fastapi import APIRouter, Response, WebSocket, WebSocketDisconnect
from openai import OpenAIError
from pydantic import ValidationError

from app.infographic_llm import (
    classify_infographic_template,
    generate_deck,
    generate_infographic,
    plan_deck,
)
from app.infographic_models import (
    BULLET_MAX_COUNT,
    BULLET_MIN_COUNT,
    COMPARISON_MAX_COLUMNS,
    HUB_SPOKE_ITEM_COUNT,
    MATRIX_QUADRANT_COUNT,
    NORTH_STAR_MAX_DRIVERS,
    NORTH_STAR_MIN_DRIVERS,
    PYRAMID_MAX_PILLARS,
    PYRAMID_MIN_PILLARS,
    RACI_MAX_ROWS,
    RACI_MIN_ROWS,
    TIMELINE_MAX_MILESTONES,
    TIMELINE_MIN_MILESTONES,
    TITLE_HIGHLIGHT_MAX,
    TITLE_HIGHLIGHT_MIN,
    AgendaSlide,
    BulletSummarySlide,
    GenerateDeckResponse,
    GenerateInfographicResponse,
    InfographicComparison,
    InfographicDiagram,
    InfographicHubSpoke,
    InfographicMatrix,
    InfographicPyramid,
    InfographicRoadmap,
    InfographicTimeline,
    InfographicWheel,
    NorthStarMetricSlide,
    RaciChartSlide,
    TitleSlide,
    WHEEL_ITEM_COUNT,
)
from app.infographic_template import (
    build_agenda_pptx,
    build_bullets_pptx,
    build_comparison_pptx,
    build_deck_pptx,
    build_hub_spoke_pptx,
    build_matrix_pptx,
    build_north_star_metric_pptx,
    build_positioning_statement_pptx,
    build_pyramid_pptx,
    build_raci_chart_pptx,
    build_roadmap_pptx,
    build_story_pptx,
    build_timeline_pptx,
    build_title_pptx,
    build_value_proposition_pptx,
    build_wheel_pptx,
)
from app.shared_models import GenerateRequest, ValidationIssue, ValidationSeverity

router = APIRouter(prefix="/api")

_EXPORT_BUILDERS = {
    "radial_wheel": (build_wheel_pptx, "infographic-wheel.pptx"),
    "comparison_columns": (build_comparison_pptx, "infographic-comparison.pptx"),
    "now_next_later": (build_roadmap_pptx, "infographic-roadmap.pptx"),
    "vision_pyramid": (build_pyramid_pptx, "infographic-vision-pyramid.pptx"),
    "quarterly_timeline": (build_timeline_pptx, "infographic-timeline.pptx"),
    "bullet_summary": (build_bullets_pptx, "infographic-bullets.pptx"),
    "matrix_2x2": (build_matrix_pptx, "infographic-matrix.pptx"),
    "feature_story": (build_story_pptx, "infographic-feature-story.pptx"),
    "hub_spoke": (build_hub_spoke_pptx, "infographic-hub-spoke.pptx"),
    "title_intro": (build_title_pptx, "infographic-title.pptx"),
    "agenda": (build_agenda_pptx, "infographic-agenda.pptx"),
    "value_proposition": (build_value_proposition_pptx, "infographic-value-proposition.pptx"),
    "positioning_statement": (build_positioning_statement_pptx, "infographic-positioning.pptx"),
    "raci_chart": (build_raci_chart_pptx, "infographic-raci.pptx"),
    "north_star_metric": (build_north_star_metric_pptx, "infographic-north-star-metric.pptx"),
}


def _validate_infographic(data: InfographicDiagram) -> list[ValidationIssue]:
    if isinstance(data, InfographicWheel):
        if len(data.items) != WHEEL_ITEM_COUNT:
            return [
                ValidationIssue(
                    severity=ValidationSeverity.warning,
                    code="wrong_item_count",
                    message=f"Wheel has {len(data.items)} items; the template has exactly {WHEEL_ITEM_COUNT} slots.",
                )
            ]
        return []

    if isinstance(data, InfographicComparison):
        if not data.columns or len(data.columns) > COMPARISON_MAX_COLUMNS:
            return [
                ValidationIssue(
                    severity=ValidationSeverity.warning,
                    code="wrong_column_count",
                    message=f"Comparison has {len(data.columns)} columns; the template supports up to {COMPARISON_MAX_COLUMNS}.",
                )
            ]
        return []

    if isinstance(data, InfographicRoadmap):
        if len(data.columns) != 3:
            return [
                ValidationIssue(
                    severity=ValidationSeverity.warning,
                    code="wrong_column_count",
                    message=f"Roadmap has {len(data.columns)} columns; the template has exactly 3 (Now/Next/Later).",
                )
            ]
        return []

    if isinstance(data, InfographicPyramid):
        if not (PYRAMID_MIN_PILLARS <= len(data.pillars) <= PYRAMID_MAX_PILLARS):
            return [
                ValidationIssue(
                    severity=ValidationSeverity.warning,
                    code="wrong_pillar_count",
                    message=f"Pyramid has {len(data.pillars)} pillars; the template supports {PYRAMID_MIN_PILLARS}-{PYRAMID_MAX_PILLARS}.",
                )
            ]
        return []

    if isinstance(data, InfographicTimeline):
        if not (TIMELINE_MIN_MILESTONES <= len(data.milestones) <= TIMELINE_MAX_MILESTONES):
            return [
                ValidationIssue(
                    severity=ValidationSeverity.warning,
                    code="wrong_milestone_count",
                    message=f"Timeline has {len(data.milestones)} milestones; the template supports {TIMELINE_MIN_MILESTONES}-{TIMELINE_MAX_MILESTONES}.",
                )
            ]
        return []

    if isinstance(data, BulletSummarySlide):
        if not (BULLET_MIN_COUNT <= len(data.bullets) <= BULLET_MAX_COUNT):
            return [
                ValidationIssue(
                    severity=ValidationSeverity.warning,
                    code="wrong_bullet_count",
                    message=f"Summary has {len(data.bullets)} bullets; the template supports {BULLET_MIN_COUNT}-{BULLET_MAX_COUNT}.",
                )
            ]
        return []

    if isinstance(data, InfographicMatrix):
        if len(data.quadrants) != MATRIX_QUADRANT_COUNT:
            return [
                ValidationIssue(
                    severity=ValidationSeverity.warning,
                    code="wrong_quadrant_count",
                    message=f"Matrix has {len(data.quadrants)} quadrants; the template has exactly {MATRIX_QUADRANT_COUNT}.",
                )
            ]
        return []

    if isinstance(data, InfographicHubSpoke):
        if len(data.items) != HUB_SPOKE_ITEM_COUNT:
            return [
                ValidationIssue(
                    severity=ValidationSeverity.warning,
                    code="wrong_item_count",
                    message=f"Hub & spoke has {len(data.items)} items; the template has exactly {HUB_SPOKE_ITEM_COUNT} slots.",
                )
            ]
        return []

    if isinstance(data, TitleSlide):
        if not (TITLE_HIGHLIGHT_MIN <= len(data.highlights) <= TITLE_HIGHLIGHT_MAX):
            return [
                ValidationIssue(
                    severity=ValidationSeverity.warning,
                    code="wrong_highlight_count",
                    message=f"Title slide has {len(data.highlights)} highlights; the template supports {TITLE_HIGHLIGHT_MIN}-{TITLE_HIGHLIGHT_MAX}.",
                )
            ]
        return []

    if isinstance(data, AgendaSlide):
        if not data.items:
            return [
                ValidationIssue(
                    severity=ValidationSeverity.warning,
                    code="empty_agenda",
                    message="Agenda has no items.",
                )
            ]
        return []

    if isinstance(data, RaciChartSlide):
        if not (RACI_MIN_ROWS <= len(data.rows) <= RACI_MAX_ROWS):
            return [
                ValidationIssue(
                    severity=ValidationSeverity.warning,
                    code="wrong_row_count",
                    message=f"RACI chart has {len(data.rows)} rows; the template supports {RACI_MIN_ROWS}-{RACI_MAX_ROWS}.",
                )
            ]
        return []

    if isinstance(data, NorthStarMetricSlide):
        if not (NORTH_STAR_MIN_DRIVERS <= len(data.drivers) <= NORTH_STAR_MAX_DRIVERS):
            return [
                ValidationIssue(
                    severity=ValidationSeverity.warning,
                    code="wrong_driver_count",
                    message=f"North Star Metric has {len(data.drivers)} drivers; the template supports {NORTH_STAR_MIN_DRIVERS}-{NORTH_STAR_MAX_DRIVERS}.",
                )
            ]
        return []

    return []


@router.post("/infographic/export")
async def export_infographic_pptx(data: InfographicDiagram) -> Response:
    builder, filename = _EXPORT_BUILDERS[data.template]
    pptx_bytes = builder(data)
    return Response(
        content=pptx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/infographic/deck/export")
async def export_deck_pptx(slides: list[InfographicDiagram]) -> Response:
    pptx_bytes = build_deck_pptx(slides)
    return Response(
        content=pptx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": 'attachment; filename="infographic-deck.pptx"'},
    )


@router.websocket("/ws/generate-infographic")
async def generate_infographic_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            payload = await websocket.receive_json()
            try:
                request = GenerateRequest.model_validate(payload)
            except ValidationError as exc:
                await websocket.send_json({"stage": "error", "message": str(exc)})
                continue

            await websocket.send_json({"stage": "classifying"})
            try:
                classification = await classify_infographic_template(request.material, request.prompt)
            except OpenAIError as exc:
                await websocket.send_json(
                    {"stage": "error", "message": f"OpenAI request failed: {exc}"}
                )
                continue

            await websocket.send_json({"stage": "calling_llm"})
            try:
                diagram = await generate_infographic(
                    classification.template, request.material, request.prompt
                )
            except OpenAIError as exc:
                await websocket.send_json(
                    {"stage": "error", "message": f"OpenAI request failed: {exc}"}
                )
                continue

            await websocket.send_json({"stage": "validating"})
            issues = _validate_infographic(diagram)

            response = GenerateInfographicResponse(diagram=diagram, issues=issues)
            await websocket.send_json({"stage": "done", "result": response.model_dump()})
    except WebSocketDisconnect:
        return


@router.websocket("/ws/generate-deck")
async def generate_deck_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            payload = await websocket.receive_json()
            try:
                request = GenerateRequest.model_validate(payload)
            except ValidationError as exc:
                await websocket.send_json({"stage": "error", "message": str(exc)})
                continue

            await websocket.send_json({"stage": "planning"})
            try:
                plan = await plan_deck(request.material, request.prompt)
            except OpenAIError as exc:
                await websocket.send_json(
                    {"stage": "error", "message": f"OpenAI request failed: {exc}"}
                )
                continue

            if not plan.slides:
                await websocket.send_json(
                    {"stage": "error", "message": "The plan produced no slides."}
                )
                continue

            await websocket.send_json({"stage": "plan_ready", "plan": plan.model_dump()})

            async def on_slide_done(completed: int, total: int) -> None:
                await websocket.send_json(
                    {"stage": "generating", "completed": completed, "total": total}
                )

            try:
                slides = await generate_deck(request.material, request.prompt, plan, on_slide_done)
            except OpenAIError as exc:
                await websocket.send_json(
                    {"stage": "error", "message": f"OpenAI request failed: {exc}"}
                )
                continue

            issues: list[ValidationIssue] = []
            for slide in slides:
                issues.extend(_validate_infographic(slide))

            response = GenerateDeckResponse(title=plan.deck_title, slides=slides, issues=issues)
            await websocket.send_json({"stage": "done", "result": response.model_dump()})
    except WebSocketDisconnect:
        return
