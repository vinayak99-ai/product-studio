# Architecture: Diagram Shaper

## Overview

A tool that takes source material + a prompt, uses the OpenAI API (via a small Python
backend) to derive a diagram as a typed list of shapes and connectors — not markup, not a
picture — then renders that one JSON result twice, independently: once to SVG for the
in-app preview, and once straight to native PowerPoint shapes for export. Because neither
renderer parses the other's output, the two can never drift apart, and the exported PPTX
is genuinely editable — real, individually selectable shapes and text boxes, not a
flattened image.

## Architecture

```
OpenAI API
        │  generate_structured() -- schema-enforced, not prompt-following
        ▼
Python backend (FastAPI)
  ├─ diagram_shaper_llm.py     — classifies a diagram type, emits {shapes, connectors, groups}
  ├─ diagram_shaper_svg.py     — deterministic JSON -> SVG string, for the live preview
  └─ diagram_shaper_pptx.py    — deterministic JSON -> native python-pptx shapes, for export
        │
        │  WebSocket (generate) / REST (export)
        ▼
React frontend
  ├─ DiagramShaperSidebar — paste/upload material + prompt, triggers generation
  └─ DiagramShaperCanvas  — displays the backend-rendered SVG in an iframe, downloads PPTX
```

No layout engine, no client-side rendering step, no server-side browser rendering either
— the model places every shape's x/y/w/h directly, and both renderers just walk that list.

## Tech Stack

| Layer | Tool |
|---|---|
| Frontend framework | React |
| Diagram generation | OpenAI structured output (`generate_structured`) — a typed shape/connector list, schema-enforced by the API itself |
| Preview rendering | `diagram_shaper_svg.py` — plain Python string-building, no templating engine |
| Export rendering | `python-pptx` — real `add_shape`/`add_connector`/`add_textbox` calls |
| Backend | FastAPI (Python) — LLM calls + both renderers |
| Frontend ↔ backend | WebSocket (live generation progress), REST (PPTX export) |
| Schema validation | `pydantic` (backend) — enforced at the API boundary via OpenAI's structured outputs |

## Data Flow

1. User pastes/uploads material and enters a prompt in the browser UI.
2. Frontend opens a WebSocket to the backend (`/api/ws/generate-diagram-shaper`).
3. Backend calls OpenAI once, requesting a typed `{diagram_type, title, shapes,
   connectors, groups}` result — every shape has an exact x/y/w/h and a kind from a
   closed vocabulary (oval, rectangle, diamond, dot, cylinder, hexagon); every connector
   references two shape ids by id.
4. Backend renders that same JSON to an SVG-in-HTML string (`diagram_shaper_svg.py`) and
   streams both the JSON and the rendered HTML back over the WebSocket.
5. Frontend displays the HTML in an iframe — no client-side rendering logic at all.
6. On export, the frontend POSTs the same JSON to `/api/diagram-shaper/export`, which
   runs it through `diagram_shaper_pptx.py` and returns a `.pptx` file built from real
   PowerPoint shapes, positioned by scaling the same coordinates onto a 13.333×7.5in
   slide.
