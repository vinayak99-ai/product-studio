# Product Studio

A local, multi-tool web workspace for product management. One FastAPI backend, one React
frontend, one left icon rail for switching between tools — no separate apps, no separate
config.

## Tools

| Tool | Status | What it does |
|---|---|---|
| **Sequence Diagram** | Ready | Source material + a prompt → an interactive sequence diagram (participants, sync/return messages), exportable to PNG. |
| **Infographic Builder** | Ready | Source material + a prompt → a single on-brand infographic slide (14 templates) or a full multi-slide PRD-to-deck PPTX that always opens with a title/cover slide and a paginated agenda. |
| **Diagram Slides** | Ready | Source material + a prompt → a hand-composed diagram -- linear process, decision flow, hierarchy, architecture, timeline, swimlane, process, ER diagram, state diagram, or loop (shape encodes type, one reserved accent, no layout-engine routing) -- rendered server-side and exported full-bleed into a PPTX slide. |
| **Spec Builder** | Ready | Raw notes → a structured spec (user stories, requirements, architecture decisions, Jira-ready epics), plus diagrams, stakeholder briefs, and a two-way Jira sync. |
| **Story Builder** | Ready | An existing Spec Builder project's spec → a timed executive narrative: a beat-by-beat storyline covering relevance, business value, and differentiation, a spoken script per beat, and a matching slide deck. |
| Report Generator | Soon | Will turn a Spec Builder project into a branded PDF/deck, reusing Infographic Builder's export pipeline. |
| Data Explorer | Soon | Will search and track delivery status across every Spec Builder project at once. |

Registry lives in `frontend/src/lib/tools.ts`, rendered by `frontend/src/components/Rail.tsx`.

## Getting started

```bash
# Backend — one process serves every tool
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt   # includes Spec Builder's Jira integration dep
playwright install chromium       # for Diagram Slides' server-side rendering
cp .env.example .env              # fill in the keys below
uvicorn app.main:app --reload --port 8000
```

Supports Python 3.9 through 3.13. On 3.9, Pydantic models rely on `from __future__
import annotations` plus the `eval_type_backport` dependency to resolve modern
`X | None`-style type hints, which aren't natively supported until 3.10 — both are
already wired up, no extra setup needed.

**On Windows**, use `python run.py` (or `.\start.ps1`, which also activates the venv)
instead of the plain `uvicorn` command above:

```powershell
cd backend
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
playwright install chromium
copy .env.example .env
python run.py
```

Plain `uvicorn app.main:app --reload` on Windows runs on `WindowsSelectorEventLoop`,
which can't launch subprocesses — and Diagram Slides' PPTX export launches headless
Chromium via Playwright to render each diagram, which needs exactly that. `run.py`
forces the Proactor event loop policy before uvicorn is even imported, and runs
without `--reload` there — `--reload`'s file-watcher runs the actual server in a
*separate child process* it manages, and that child isn't guaranteed to inherit
the policy either, which reopens the same ordering problem. Every other tool works
identically either way — this only affects Diagram Slides' export button. No
auto-reload on Windows with this launcher: restart it after backend code changes.

```bash
# Frontend — one Vite dev server for every tool, in a second terminal
cd frontend
npm install
cp .env.example .env   # optional, defaults already point at localhost:8000
npm run dev
```

Open http://localhost:5173 — the backend must be running for any tool to actually
generate anything.

### Environment variables (all in `backend/.env`)

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI key used by every tool, including Spec Builder (required unless `LLM_PROVIDER=corporate`) |
| `OPENAI_MODEL` | Model used for structured generation (default `gpt-4o`) |
| `LLM_PROVIDER` | `openai` (default) or `corporate` — see [LLM provider](#llm-provider) below; every tool's LLM calls switch together |
| `CORPORATE_LLM_BASE_URL`, `CORPORATE_LLM_API_KEY`, `CORPORATE_LLM_MODEL` | Your internal LLM gateway's connection details, used only when `LLM_PROVIDER=corporate` |
| `CORS_ORIGINS` | Comma-separated allowed origins (default covers `localhost`/`127.0.0.1:5173`) |
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY` | Optional — enables Spec Builder's Jira push/import/sync; leave unset to skip |

### LLM provider

Every LLM call in the backend — Sequence, Diagram Slides, Infographic,
Story Builder, and Spec Builder alike — goes through a single switchable provider (`backend/app/llm_client.py`)
rather than each tool talking to a model API directly. `LLM_PROVIDER=openai` (the default)
uses `OPENAI_API_KEY`/`OPENAI_MODEL` above. `LLM_PROVIDER=corporate` routes every call to
your own internal LLM gateway instead — but `CorporateLLMProvider` in `llm_client.py` is a
documented stub, not a working integration, until you fill in your gateway's actual
request/response shape and auth scheme (its docstring walks through exactly what to
implement). Until then, leave `LLM_PROVIDER=openai`.

Spec Builder used to run on a separate framework (pydantic-ai, configured via `AIPM_MODEL`)
pointed at Anthropic by default. That's gone — Spec Builder's 9 agents now go through the
same `llm_client.py` as every other tool, so the whole backend switches providers together
with one env var instead of Spec Builder needing its own separate model config.

## Project layout

```
backend/      One FastAPI process: Sequence/Diagram Slides/Infographic/
              Story routes (/api/*) plus Spec Builder's app
              (backend/app/spec_builder/) mounted at /pm/*
frontend/     One React app: the rail-nav shell, plus each tool's canvas/panels —
              Spec Builder's own pages/components live under
              frontend/src/features/spec-builder/
docs/         Spec Builder's full feature/known-issues/roadmap docs under
              docs/spec-builder/
```

## Navigating Product Studio

The left rail is the only navigation — no separate menus per tool. Each icon is a tool
from the `TOOLS` registry; a small dot marks the ones still "Soon." The breadcrumb at the
top ("Product Studio / Diagram Slides") reflects whichever tool is active.

Switching tools doesn't unmount them — every ready tool stays mounted (just hidden) in
the background, so an in-progress diagram or an unsaved edit survives clicking to another
tool and back. This matters most for Spec Builder, which autosaves on a 2-second
debounce: switching away mid-edit doesn't lose anything.

## Using Sequence Diagram

1. Paste source material or upload a file, and enter a prompt describing the
   interaction you want mapped.
2. The frontend opens a WebSocket to the backend (`/api/ws/generate-sequence`), which
   calls OpenAI for structured participants + messages (each message typed `sync` or
   `return`), validates the result, and streams progress back.
3. React Flow renders each participant as a lifeline, with sync/return messages drawn
   as distinct edge styles between them.
4. Export the current diagram to PNG client-side via the toolbar.

## Using Infographic Builder

1. Paste source material (a plan, strategy doc, roadmap, PRD) and a prompt, then pick
   **Single slide** or **Full deck (PRD)**.
2. **Single slide**: the backend classifies which of 14 templates best fits the material
   — Radial wheel, Comparison columns, Now/Next/Later roadmap, Vision pyramid,
   Quarterly timeline, Bullet summary, 2×2 matrix, Feature story, Hub & spoke, Title/
   intro, Value proposition, Positioning statement, or RACI chart — then generates that
   template's content and streams progress over `/api/ws/generate-infographic`. Click
   any text on the rendered slide to edit it in place, then export to a native, editable
   PPTX matching what's on screen.
3. **Full deck**: the backend plans a 4-10 content-slide outline from the material
   (picking the best template per slide), always opening the deck with an auto-generated
   title/cover slide and an agenda slide — the agenda's page numbers are computed
   directly from the plan, not guessed by the model, so they're always correct — then
   generates every content slide concurrently and streams progress over
   `/api/ws/generate-deck`. A slide rail on the left lets you jump between slides, edit
   any of them in place, and export the whole deck as one PPTX file.

Every template draws from the same brand palette as the rest of Product Studio (the
`fidelity-green` theme's colors), chosen for colorblind-safe contrast rather than picked
by eye.

## Using Spec Builder

1. Click "New Project," name it, and paste raw notes — a brain-dump, a meeting recap,
   whatever you have.
2. If anything's ambiguous, answer a short round of clarifying questions (or leave one
   blank to accept its suggested default); otherwise it goes straight to drafting.
3. Read the generated spec: prioritized user stories with acceptance scenarios, edge
   cases, functional/non-functional requirements, key entities, and success criteria.
   Click any block to edit it in place — everything autosaves.
4. Review the Architecture Decisions and Epics sections the backend drafts alongside the
   spec (each independently regenerable), generate a user journey or sequence diagram
   from the spec on demand, and switch to the Comms tab to maintain stakeholders and
   generate an executive/engineering/sales brief.
5. If Jira is configured (`backend/.env`), push epics and stories to a real
   project, import an existing one, or sync delivery status back in.

This is the condensed version — the full feature set (versioning, diffs, recurring
updates, glossary, known gaps) is documented in
[`docs/spec-builder/README.md`](docs/spec-builder/README.md#features).

## Using Story Builder

1. Pick an existing Spec Builder project that has a generated spec — Story Builder reads
   its PRD directly (via Spec Builder's own markdown export) rather than taking pasted or
   uploaded material — set how long the talk should run, and optionally note the
   audience or what to emphasize.
2. The backend plans a narrative arc over `/api/ws/generate-story`: it picks whatever
   structure fits the product best (no fixed framework), but every arc is required to
   establish relevance, business value, and differentiation somewhere in it, however
   those beats end up labeled. Each beat gets a time slot, a supporting slide drawn from
   Infographic Builder's own templates (Positioning statement and Value proposition map
   naturally onto the differentiation and business-value beats), and narration written
   *after* the slide so it references what's actually on screen — paced to the beat's
   minutes, not just however long the model feels like writing.
3. A beat timeline on the left lets you jump between beats; each shows its slide (fully
   editable, same as Infographic Builder) above its narration in an editable textarea.
   Export the narration as a markdown script, the slides as a PPTX deck, or both.

## More documentation

- [`docs/spec-builder/`](docs/spec-builder) — Spec Builder's full feature docs, known
  issues, UX rationale, and roadmap.
