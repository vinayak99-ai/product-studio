# Discovery Q&A — Design Plan

*A planning document, not shipped code — the reference before implementation
starts, same role as `docs/knowledge-base/PLAN.md` played for that tool. Once
built, the durable description belongs in the main `README.md`'s tools table
and a "Using Discovery Q&A" section, the same as every other tool; this file
stops being updated at that point.*

## What this is

A new rail tab, **Discovery Q&A**, for a workflow none of this app's existing
tools cover: prepare a set of interview questions grounded in a Spec Builder
project's Edge Cases, run through them one at a time in a live meeting while
typing in the interviewee's answers, optionally let the LLM expand those raw
notes into fuller prose, and export the whole thing as meeting minutes.

It's a **session-based** tool (one saved artifact per meeting/round of
questions), not a persistent chat and not a single-shot generator — closest
in shape to Document Q&A's list→detail structure, but with a distinct
three-phase lifecycle: **Prep → Live session → Enrich/Export**.

## Core concepts

- **Source spec** — an existing Spec Builder project with a generated PRD.
  Its `edge_cases` field (a flat `list[str]` on `GeneratedPRD`, rendered as a
  `### Edge Cases` bullet list by `export_to_markdown`) is the seed material
  candidate questions are generated from; the full spec is passed as context
  so questions are grounded, not generic.
- **Candidate question** — an LLM-proposed question, ephemeral until picked.
  Not persisted on its own; exists only in the Prep view's in-memory state
  until Save.
- **Discovery session** — the persisted artifact: a name, a link back to its
  source spec, a curated list of questions (each with an id, text, answer,
  and optional enriched answer), and one running notes field for the whole
  session. This is the "particular discovery question JSON" from the
  original ask.

## Workflow

### 1. Prep

1. Pick a Spec Builder project — reusing the exact pattern Story Builder
   already uses for this (`routes/story.py`'s `api_list_source_projects`
   filters to projects where `list_artifacts(project_id)` is non-empty, so
   only projects with a generated spec are selectable). Discovery Q&A calls
   the same `list_projects`/`list_artifacts`/`load_artifact`/
   `export_to_markdown` chain from `app.spec_builder.*` to load the spec's
   markdown.
2. Optionally add a focus prompt ("lean toward UI/UX edge cases" etc.), then
   **Generate candidates** — one `generate_structured()` call, system prompt
   instructs the model to draw primarily from the `### Edge Cases` section
   but use the full spec for grounding. Returns a batch of
   `{id, text, rationale}` candidates — no `selected` field needed here
   (unlike Design Thinking's `HowMightWe`/`ConceptSpark`, where `selected`
   lives on the model because the same object round-trips through more LLM
   calls); this is a plain client-side checkbox list instead, closer to how
   `IdeateStage.tsx` renders and toggles the HMW list, minus the model-side
   flag.
3. Check which candidates to keep, edit any inline, add fully custom
   questions, delete ones you don't want. **Regenerate** re-runs step 2 with
   the same project/prompt for a fresh batch if the first one isn't useful —
   doesn't touch anything already checked.
4. **Save** — persists a new Discovery session with exactly the curated
   (checked + hand-added) questions. Unchecked candidates are simply
   dropped, not carried forward in any form.

### 2. Live session

1. Open a saved session. Main view shows **one question at a time** — a
   focused question + answer textarea — with a numbered side list of every
   question in the session to jump to any of them, mirroring
   `StoryCanvas.tsx`'s beat-timeline pattern exactly: a single
   `selected: number` index (clamped against array length), a scrollable
   `<aside>` of buttons, the main panel deriving "the current item" from
   that index. Not a strict linear stepper — you can jump anywhere, since a
   live interview rarely goes in question order.
2. Typing an answer autosaves (debounced, same 2-second-debounce philosophy
   already used for Spec Builder's autosave) via a per-question PATCH.
3. A **persistent, collapsible Notes panel** is visible the whole time you're
   in this view, not gated to appear only after the last question — a single
   running textarea for the whole session, auto-saved the same way. This is
   the one thing explicitly called out as needing to work mid-meeting, not
   just as a wrap-up step.
4. Questions, answers, and the question list itself (add/edit/delete/
   reorder) stay editable at any point — during prep, mid-meeting, or after.
   Editing the question list is a single "send the full new list" PATCH
   (full replace, not an incremental diff) — the same simplicity trade this
   app already made for Knowledge Base document replace: no risk of a
   partial edit leaving stale state behind, at the cost of always sending
   the whole array.

### 3. Enrich

One action, one `generate_structured()` call: sends every question with its
raw answer, plus the running notes, and gets back an `enriched_answer` per
question (expanded, cleaned-up prose) and a separately cleaned
`enriched_notes`. Raw `answer`/`notes` are never overwritten — enrichment
adds alongside, never replaces, so re-running Enrich after editing an answer
just recomputes the enriched fields from current state. One call for the
whole session, not one per question, both for coherence across answers and
because that's the existing precedent for "generate over a whole list at
once" in this codebase (`generate_concept_briefs` takes and returns Design
Thinking's whole spark list in one call, not N calls).

### 4. Export

**Convert to meeting minutes** — same download pattern as Story Builder's
script export: a route that builds the plain markdown text server-side and
returns it as a `Response` with `Content-Disposition: attachment`, the
frontend fetching it as a blob and triggering the download via an anchor
element. Content: session name/date/source spec as a header, then each
question as a heading with its answer (enriched version if present,
otherwise raw), then an **Additional Notes** section at the end (enriched if
present, otherwise raw) if notes are non-empty. Filename is slugified from
the session name — not hardcoded — learned directly from the bug already
found and fixed in Diagram Slides' export earlier (`diagram-slide.pptx` for
every diagram regardless of content).

## Data model

New Pydantic models (`discovery_qa_models.py`):

```python
class DiscoveryQuestion(BaseModel):
    id: str
    text: str
    answer: str = ""
    enriched_answer: str = ""

class CandidateQuestion(BaseModel):
    """Ephemeral -- exists only in the Prep view's response until Save,
    never persisted on its own."""
    id: str
    text: str
    rationale: str

class GenerateCandidatesRequest(BaseModel):
    project_id: str
    prompt: str = ""

class CandidateQuestionsResponse(BaseModel):
    candidates: list[CandidateQuestion] = Field(default_factory=list)

class CreateSessionRequest(BaseModel):
    name: str
    source_project_id: str
    questions: list[DiscoveryQuestion]   # the curated list at Save time

class UpdateQuestionsRequest(BaseModel):
    questions: list[DiscoveryQuestion]   # full replace -- covers add/edit/delete/reorder

class SaveAnswerRequest(BaseModel):
    answer: str

class SaveNotesRequest(BaseModel):
    notes: str

class DiscoverySessionMeta(BaseModel):
    id: str
    name: str
    source_project_id: str
    source_project_name: str
    created_at: str
    updated_at: str
    question_count: int
    answered_count: int
    is_enriched: bool

class DiscoverySessionDetail(BaseModel):
    meta: DiscoverySessionMeta
    questions: list[DiscoveryQuestion] = Field(default_factory=list)
    notes: str = ""
    enriched_notes: str = ""

class EnrichResponse(BaseModel):
    questions: list[DiscoveryQuestion]
    enriched_notes: str
```

Every mutating route returns the fresh `DiscoverySessionDetail`, same
convention as Document Q&A and Knowledge Base already use — the frontend
just replaces its state with the response rather than reasoning about a
partial update.

## Persistence

`discovery_qa_persistence.py` mirrors `doc_qa_persistence.py` exactly — the
established pattern for a JSON-file-per-artifact tool in this backend:
`DATA_ROOT = Path.home() / "discovery-qa-data" / "sessions"`,
`create_session`/`list_sessions`/`get_session`/`rename_session`/
`delete_session`, plus a private `_touch()` bumping `updated_at`. Questions
and notes live inside the same session's JSON — there's no separate
per-question storage or a vector index this time (no ChromaDB involved
here — this tool doesn't need retrieval, just structured storage).

## Backend module plan

- `app/discovery_qa_models.py` — the models above.
- `app/discovery_qa_persistence.py` — session JSON persistence.
- `app/discovery_qa_llm.py` — `generate_candidate_questions(prd_markdown,
  prompt) -> CandidateQuestionsResponse` and `enrich_session(questions,
  notes) -> EnrichResponse`, both plain `async def` + `generate_structured()`
  calls, matching `design_thinking_llm.py`'s batch-generate/enrich pair
  convention.
- `app/discovery_qa_export.py` — builds the meeting-minutes markdown string
  from a `DiscoverySessionDetail`, mirroring `story.py`'s inline
  `api_export_script` builder (small enough to not need Deep Analysis's
  separate markdown-builder-module treatment).
- `app/routes/discovery_qa.py`:
  - `GET /api/discovery-qa/spec-projects` — reuses Story Builder's
    has-a-generated-spec filtering pattern.
  - `POST /api/discovery-qa/generate-candidates` — stateless, not persisted.
  - `POST /api/discovery-qa/sessions` — Save (create).
  - `GET /api/discovery-qa/sessions`, `GET .../sessions/{id}` — list/detail.
  - `PATCH /api/discovery-qa/sessions/{id}` — rename.
  - `DELETE /api/discovery-qa/sessions/{id}`.
  - `PUT /api/discovery-qa/sessions/{id}/questions` — full-replace
    add/edit/delete/reorder, callable from Prep and from the live session
    view alike (same endpoint, not duplicated).
  - `PATCH /api/discovery-qa/sessions/{id}/questions/{question_id}/answer`
    — per-question autosave.
  - `PUT /api/discovery-qa/sessions/{id}/notes` — notes autosave.
  - `POST /api/discovery-qa/sessions/{id}/enrich`.
  - `POST /api/discovery-qa/sessions/{id}/export` — returns the
    `Content-Disposition` markdown `Response`.

## Frontend module plan

**List → Prep → Session**, a three-view union exactly like `DocQaPage.tsx`'s
`{name:'list'}|{name:'new'}|{name:'detail'}` pattern — not Knowledge Base's
persistent-sidebar-with-canvas layout. That layout was justified specifically
by cross-collection search needing simultaneous access to every collection;
Discovery Q&A has no equivalent cross-session requirement — you work one
session at a time, so the simpler page-switch fits better.

- `discoveryQaTypes.ts` — mirrors the backend models.
- `lib/discoveryQaApi.ts` — REST client, including the blob-download export
  function (same shape as `storyApi.ts`'s `exportStoryScript`).
- `components/DiscoveryQaPage.tsx` — the view-switch, mirrors `DocQaPage.tsx`.
- `components/discovery-qa/DiscoveryQaSessionList.tsx` — mirrors
  `DocQaProjectList.tsx`: saved sessions with name, source spec, "6/10
  answered" progress, enriched badge; rename/delete; "New session" button.
- `components/discovery-qa/DiscoveryQaPrep.tsx` — spec project picker
  (only ones with a generated spec, per the has-a-spec filter above), focus
  prompt, "Generate candidates," a checkbox list styled the same way
  `IdeateStage.tsx` renders its HMW list (`<label>` wrapping a hidden
  checkbox, active state via `border-primary bg-primary-light`), inline
  edit/delete/add-custom, "Regenerate," "Save session."
- `components/discovery-qa/DiscoveryQaSession.tsx` — the live/enrich/export
  view: a `StoryCanvas`-style side list + single-question main panel,
  autosaving answer textarea, the persistent collapsible Notes panel,
  "Enrich" and "Export meeting minutes" buttons, plus the same
  add/edit/delete/reorder question-list actions available from Prep,
  reachable here too (not a Prep-only ritual).
- `components/icons/ToolIcons.tsx` — new `DiscoveryQaIcon`.
- `lib/tools.ts` — new `'discovery_qa'` entry.
- `App.tsx` — wire the new tab in, matching every other tool's registration.

## Open decisions before implementation starts

1. **Answer autosave trigger** — on blur (moving to the next question) vs. a
   short debounce while typing. Recommend blur-triggered, since that's
   simpler and matches the natural rhythm of "answer this one, move to the
   next" rather than firing a save on every keystroke.
2. **Export before Enrich** — should the Export button be available before
   you've ever run Enrich (falling back to raw answers/notes), or gated
   until at least one Enrich pass? Recommend available anytime — a PM who
   just wants the raw Q&A dump without LLM polish shouldn't be blocked.
3. **Candidate batch size** — not yet pinned to an exact number. Recommend a
   default of 8-12 candidates per generation, adjustable only via
   Regenerate, not a user-facing slider (keeps Prep simple).

## Suggested phased build order

1. **Foundation**: `discovery_qa_models.py`, `discovery_qa_persistence.py`,
   session CRUD routes + `DiscoveryQaSessionList.tsx`/`DiscoveryQaPage.tsx`
   (no question generation yet — sessions start empty, questions addable by
   hand only, to prove the persistence/list/detail loop first).
2. **Prep**: candidate generation + the checkbox-select UI + Save, wired to
   real Spec Builder projects.
3. **Live session**: the side-list + single-question view, per-question
   answer autosave, the persistent Notes panel.
4. **Enrich + Export**: the enrichment call, the markdown builder, the
   download route + frontend trigger.
