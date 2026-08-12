"""Deterministic renderer: DiagramShaperResult (shapes/connectors/groups) ->
an SVG string, for the live preview. Nothing here reads from the LLM's
freeform output -- every coordinate/shape kind came straight from the typed
JSON, so this is a plain, predictable walk over the list, not a parser.

diagram_shaper_pptx.py renders the exact same JSON to native PPTX shapes
separately -- the two never call into each other, they're independent
consumers of one shared JSON source of truth.
"""

import html

from app.diagram_shaper_models import (
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    Connector,
    DiagramShaperResult,
    Shape,
)

PAPER = "#FFFFFF"
INK = "#14251F"
MUTED = "#6B7A73"
ACCENT = "#00754A"

DOT_RADIUS = 6


def shape_by_id(result: DiagramShaperResult) -> dict[str, Shape]:
    return {shape.id: shape for shape in result.shapes}


def _fill_for(accent: bool) -> str:
    return ACCENT if accent else INK


def _esc(text: str) -> str:
    return html.escape(text, quote=True)


def _render_shape(shape: Shape) -> str:
    cx, cy = shape.x + shape.w / 2, shape.y + shape.h / 2
    fill = _fill_for(shape.accent)
    text_color = "#FFFFFF"
    font_size = max(12, min(20, shape.h * 0.28))

    if shape.kind == "oval":
        body = f'<ellipse cx="{cx}" cy="{cy}" rx="{shape.w / 2}" ry="{shape.h / 2}" fill="{fill}"/>'
    elif shape.kind == "rectangle":
        body = f'<rect x="{shape.x}" y="{shape.y}" width="{shape.w}" height="{shape.h}" rx="8" fill="{fill}"/>'
    elif shape.kind == "diamond":
        points = f"{cx},{shape.y} {shape.x + shape.w},{cy} {cx},{shape.y + shape.h} {shape.x},{cy}"
        body = f'<polygon points="{points}" fill="{fill}"/>'
    elif shape.kind == "dot":
        return f'<circle cx="{cx}" cy="{cy}" r="{DOT_RADIUS}" fill="{fill}"/>'
    elif shape.kind == "cylinder":
        ry = min(shape.h * 0.18, 24)
        top = shape.y
        bottom = shape.y + shape.h
        body = (
            f'<path d="M {shape.x} {top + ry} '
            f"A {shape.w / 2} {ry} 0 0 1 {shape.x + shape.w} {top + ry} "
            f"L {shape.x + shape.w} {bottom - ry} "
            f"A {shape.w / 2} {ry} 0 0 1 {shape.x} {bottom - ry} Z\" fill=\"{fill}\"/>"
            f'<ellipse cx="{cx}" cy="{top + ry}" rx="{shape.w / 2}" ry="{ry}" fill="{fill}" stroke="{PAPER}" stroke-width="1.5"/>'
        )
    elif shape.kind == "hexagon":
        cut = min(shape.w * 0.2, 40)
        points = (
            f"{shape.x + cut},{shape.y} {shape.x + shape.w - cut},{shape.y} "
            f"{shape.x + shape.w},{cy} {shape.x + shape.w - cut},{shape.y + shape.h} "
            f"{shape.x + cut},{shape.y + shape.h} {shape.x},{cy}"
        )
        body = f'<polygon points="{points}" fill="{fill}"/>'
    else:
        body = f'<rect x="{shape.x}" y="{shape.y}" width="{shape.w}" height="{shape.h}" fill="{fill}"/>'

    label = (
        f'<text x="{cx}" y="{cy}" text-anchor="middle" dominant-baseline="middle" '
        f'fill="{text_color}" font-size="{font_size}" font-family="system-ui,-apple-system,sans-serif">'
        f"{_esc(shape.label)}</text>"
        if shape.label
        else ""
    )
    return body + label


def _clip_to_rect(cx: float, cy: float, half_w: float, half_h: float, dx: float, dy: float) -> tuple[float, float]:
    """Point where a ray from (cx, cy) toward direction (dx, dy) exits the
    axis-aligned rect centered at (cx, cy) with the given half-extents --
    used to stop a connector at a shape's boundary instead of its center."""
    if dx == 0 and dy == 0:
        return cx, cy
    candidates = []
    if dx != 0:
        candidates.append(half_w / abs(dx))
    if dy != 0:
        candidates.append(half_h / abs(dy))
    t = min(candidates)
    return cx + dx * t, cy + dy * t


def connector_endpoints(source: Shape, target: Shape) -> tuple[tuple[float, float], tuple[float, float]]:
    s_cx, s_cy = source.x + source.w / 2, source.y + source.h / 2
    t_cx, t_cy = target.x + target.w / 2, target.y + target.h / 2
    dx, dy = t_cx - s_cx, t_cy - s_cy
    start = _clip_to_rect(s_cx, s_cy, source.w / 2, source.h / 2, dx, dy)
    end = _clip_to_rect(t_cx, t_cy, target.w / 2, target.h / 2, -dx, -dy)
    return start, end


def _render_connector(connector: Connector, shapes_by_id: dict[str, Shape]) -> str:
    source = shapes_by_id.get(connector.from_id)
    target = shapes_by_id.get(connector.to_id)
    if source is None or target is None:
        return ""

    (sx, sy), (ex, ey) = connector_endpoints(source, target)
    color = ACCENT if connector.accent else MUTED

    # A single elbow bend when the shapes are far from aligned on either
    # axis, so lines don't cut diagonally across unrelated shapes -- no
    # crossing-avoidance/pathfinding beyond that, kept intentionally simple.
    if abs(sx - ex) > 24 and abs(sy - ey) > 24:
        mid_y = (sy + ey) / 2
        path = f"M {sx} {sy} L {sx} {mid_y} L {ex} {mid_y} L {ex} {ey}"
        line = f'<path d="{path}" fill="none" stroke="{color}" stroke-width="2" marker-end="url(#arrow)"/>'
        label_x, label_y = (sx + ex) / 2, mid_y - 8
    else:
        line = f'<line x1="{sx}" y1="{sy}" x2="{ex}" y2="{ey}" stroke="{color}" stroke-width="2" marker-end="url(#arrow)"/>'
        label_x, label_y = (sx + ex) / 2, (sy + ey) / 2 - 8

    label = ""
    if connector.label:
        label = (
            f'<text x="{label_x}" y="{label_y}" text-anchor="middle" fill="{INK}" '
            f'font-size="15" font-family="system-ui,-apple-system,sans-serif">{_esc(connector.label)}</text>'
        )
    return line + label


def render_shapes_to_svg(result: DiagramShaperResult) -> str:
    shapes_by_id = shape_by_id(result)

    groups_svg = "".join(
        f'<rect x="{g.x}" y="{g.y}" width="{g.w}" height="{g.h}" fill="none" '
        f'stroke="{MUTED}" stroke-width="1.5" stroke-dasharray="6 4" rx="4"/>'
        f'<text x="{g.x + 12}" y="{g.y + 20}" fill="{MUTED}" font-size="13" '
        f'font-family="system-ui,-apple-system,sans-serif" letter-spacing="0.5">{_esc(g.label.upper())}</text>'
        for g in result.groups
    )
    connectors_svg = "".join(_render_connector(c, shapes_by_id) for c in result.connectors)
    shapes_svg = "".join(_render_shape(s) for s in result.shapes)

    defs = (
        f'<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">'
        f'<path d="M0,0 L8,3 L0,6 Z" fill="{MUTED}"/></marker></defs>'
    )

    return f"""<!DOCTYPE html>
<html><head><style>
  html,body{{margin:0;padding:0;width:100%;height:100%;background:{PAPER};}}
  svg{{display:block;}}
</style></head>
<body>
<svg viewBox="0 0 {CANVAS_WIDTH} {CANVAS_HEIGHT}" width="100%" height="100%">
{defs}
<rect width="{CANVAS_WIDTH}" height="{CANVAS_HEIGHT}" fill="{PAPER}"/>
{groups_svg}
{connectors_svg}
{shapes_svg}
</svg>
</body></html>"""
