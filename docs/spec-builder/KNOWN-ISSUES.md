# Known Issues & Product Review

*A critical review of the AI PM Portal as of the post-UX-overhaul codebase.
Unlike `FUTURE-VISION.md` (what we could build) and `UX-PROPOSAL.md` (the
experience investment, now shipped), this file is the honest defect list:
things that are wrong, risky, or missing in what exists today. Every entry
was verified against the actual code; file references point at the cause.
Ordered by how much each one should worry you.*

**This is currently a local, single-user POC** — no external users, no
exposed port, no real Jira/production data at stake unless you point it at
some. Every issue below is tagged accordingly:

- 🔴 **POC-relevant** — still worth fixing now: causes real data loss, or
  meaningfully limits using/iterating on the POC itself, regardless of who's
  running it or where.
- ⚪ **Later** — a real issue, but only matters once this has real users, is
  network-exposed, or runs unattended for long stretches. Safe to defer.

### 🔴 POC-relevant, at a glance
[1.1](#11-file-writes-are-not-atomic-) atomic writes · [1.2](#12-concurrent-saves-are-last-writer-wins-silently-) concurrent-save clobbering · [2.2](#22-raw-notes-are-write-once-invisible-after-generation-) raw notes write-once · [3.1](#31-no-tests-are-committed--the-repos-biggest-gap-) no committed tests

Everything else on this page is real but deferrable — see the tag on each
item.

---

## 1. Data-safety risks

The product's core promise is "zero data loss" — these are the places the
implementation doesn't fully keep it.

### 1.1 File writes are not atomic 🔴
`persistence.py` writes artifacts, meta, and version snapshots with a plain
`open(path, "w")` (e.g. `save_artifact`, `create_project`). A crash or kill
mid-write leaves a truncated JSON file, and `load_artifact` will then fail
on every subsequent request for that project — there is no recovery path
other than hand-editing the file. **Fix:** write to a temp file in the same
directory and `os.replace()` into place; ~5 lines per call site.

### 1.2 Concurrent saves are last-writer-wins, silently 🔴
`PUT /projects/{id}/artifacts/{id}` (`main.py: api_update_artifact`) has no
optimistic-concurrency check — no `If-Match`, no expected-version field.
Two browser tabs on the same project (or autosave racing a slower manual
action) will silently clobber each other's edits; the loser's changes
survive only as a version snapshot the user doesn't know to look for.
Single-PM local use makes this rare, not impossible — two tabs is a normal
thing to do. **Fix:** send the client's base version with each PUT and
return 409 on mismatch; the UI already knows how to show diffs.

### 1.3 `project_id` from the URL is used as a filesystem path, unvalidated ⚪
`persistence._project_dir` joins the raw path parameter onto `DATA_ROOT`,
and `delete_project` calls `shutil.rmtree` on the result. IDs are only ever
*generated* as `proj_<hex>`, but nothing *enforces* that shape on incoming
requests — a crafted encoded id (`%2E%2E`-style) aims `rmtree` outside the
data root. Exposure is limited (localhost binding, CORS allowlist, no
auth), but a destructive filesystem call should not trust request input.
**Fix:** validate `project_id`/`artifact_id` against `^[a-z]+_[0-9a-f]+$`
in one dependency and reject everything else.

### 1.4 Diagram PNGs are duplicated into every version snapshot ⚪
`GeneratedPRD.diagrams[].png_base64` rides along in the artifact, so every
content-changing save copies every diagram's base64 PNG into the new
snapshot in `*_versions/`. A project with a couple of diagrams and an
active edit history accumulates megabytes of identical image bytes; the
same bytes also travel in **every autosave PUT** (a few hundred KB of
payload every 2 seconds while typing, all local but wasteful). Diffs
already exclude PNG bytes — persistence should too. **Fix:** store PNGs as
sibling files referenced by name, or strip `png_base64` from snapshots and
keep only the latest.

## 2. Product gaps a PM will actually hit

### 2.1 One artifact per project, silently ⚪
The backend models artifacts as a list, but `ProjectDetail.tsx` always
loads `artifact_ids[0]` and nothing in the UI can create a second spec for
a project. Fine as a simplifying assumption — except nothing states it, and
the API shape (`/artifacts/{artifact_id}`) implies otherwise. Pick one:
embrace single-artifact (collapse the API) or surface multiple artifacts.

### 2.2 Raw notes are write-once, invisible after generation 🔴
The notes that seeded the spec are saved (`raw_inputs/`) but never shown
again, and there is no "regenerate the whole spec" flow — only
per-section regeneration for Architecture/Epics. A PM who got a weak draft
can't refine their input and retry; their only lever is manual editing.
This also blocks the glossary/memory from ever influencing
extraction/clarification (noted as future work in FUTURE-VISION).

### 2.3 `regenerate-section` endpoint has no UI (RESOLVED — endpoint deleted)
`POST /.../regenerate-section` was confirmed-dead code (no UI caller, no
field whitelist, didn't use real artifact content) and was removed as part
of the strict step-pipeline rebuild. Its escape-hatch use case is now
covered properly: `POST /steps/{step}/edit` on a confirmed step, which runs
a scope check and cascades affected downstream steps to "stale" instead of
silently regenerating an arbitrary section.

### 2.4 Project name and spec title drift apart ⚪
Renaming a project doesn't touch the spec title; editing the spec title
doesn't rename the project. The Overview card shows both stacked, which
reads as a duplicate when they match and as a mistake when they don't.
Minor, but it's the first thing on the page.

### 2.5 Undo covers deletions only ⚪
Deleting a story/FR/ADR/epic is undoable via toast; mangling a paragraph is
not — recovery means spelunking version history, and there's no in-UI
viewer for a past version (the API supports it; the UI only shows diffs).

### 2.6 Stakeholders and glossary live outside version history ⚪
Both persist as standalone JSON (`stakeholders.json`, `glossary.json`)
with no snapshots and no diff participation. An edit war with yourself over
a definition has no history, and the Update Composer can't narrate "we
added three stakeholders" because it never sees them change.

### 2.7 The epic delivery bar mixes granularities ⚪
`DeliveryStatusBar` counts epics and stories as interchangeable "items", so
one epic (1 item) with ten stories (10 items) reads as 11 units of work.
Directionally useful, arithmetically odd. Counting stories only (epics are
containers) would be more honest.

### 2.8 Clarify budget constants are duplicated in the frontend ⚪
`MAX_ROUNDS`/`MAX_TOTAL_QUESTIONS` live in `agents.py` *and* (mirrored,
with a comment) in `ClarifyQuestions.tsx`. If the backend budget changes,
the progress line lies until someone remembers the mirror. **Fix:** return
`round`/`budget` in the clarify response.

### 2.9 Error copy is developer-grade ⚪
Most failure paths surface `String(err)` — e.g.
`Error: 502 Bad Gateway: {"detail":"..."}` — into toasts and inline
paragraphs. The API-key hint on generation failure is the one good
counter-example; everything else hands the user a stack-trace-flavored
string with no suggested action.

## 3. Engineering & process debt

### 3.1 No tests are committed — the repo's biggest gap 🔴
Every feature in this codebase was verified with `FunctionModel` stub tests
and Playwright scripts, but those scripts lived in the development
session's scratch space; `backend/` and `frontend/` contain **zero test
files** and there is no CI. The stub-testing pattern is proven and cheap —
it should be checked in as a `backend/tests/` suite (pytest + the existing
FunctionModel stubs) with a GitHub Actions workflow running tests, `tsc`,
and lint on push. Until then, every refactor re-risks the whole surface.

### 3.2 Dependencies are unpinned ⚪
`backend/requirements.txt` lists six packages with no versions;
`pydantic-ai` in particular is a fast-moving dependency whose breaking
changes land regularly. A fresh `pip install` on a new machine can produce
a backend that doesn't match the one that was tested. **Fix:** pin (or add
a lock file) and note the tested Python version.

### 3.3 Generation progress assumes one process ⚪
`_generation_progress` is a module-level dict keyed by project id. Correct
under `uvicorn` single-worker; silently wrong (progress appears frozen)
under `--workers N` or behind any multi-process server. Fine for the
local-first story — worth a comment at minimum, a file-based stage marker
if remote deployment ever happens.

### 3.4 Export filenames come from LLM-generated titles, unsanitized ⚪
`api_export_brief`/`api_export_update` build the temp-file path as
`os.path.join(tmp_dir, f"{brief.title}.md")`. A title containing `/`
(entirely possible from a model or a user edit) makes the write fail — or
land the file outside the temp dir. Same class of issue as 1.3: sanitize
anything that touches a path.

### 3.5 Section components re-render the whole spec per keystroke ⚪
Every edit flows through `ProjectDetail.update()` → new `prd` object → full
re-render of all sections. Fine at current spec sizes; will get typing
latency on very large specs. Cheap mitigations exist (memoized sections,
per-section state) — not urgent, just known.

## 4. Security posture (accepted trade-offs, stated plainly) ⚪ all items

These are design decisions of the local-first architecture, listed so
nobody mistakes them for oversights:

- **No authentication** — anyone who can reach the port owns every project.
  Acceptable on localhost; unacceptable the moment the port is exposed or
  forwarded. There is no warning against doing that anywhere in the UI.
- **API keys and Jira tokens in plaintext `config/.env`** — gitignored, but
  unencrypted on disk, and the Jira token grants real write access to your
  tracker.
- **CORS allowlist is hardcoded** to `localhost:3000`/`localhost:5173`.
- **LLM output is trusted** — generated text is rendered (safely, via React)
  but also flows into filenames (3.4), Jira issue payloads, and exports
  without any policy layer. Prompt-injection via imported Jira issue
  descriptions (which are fed to the Enrichment Agent) is a real, if
  low-stakes, vector: a hostile ticket could steer enrichment notes.

## 5. Suggested priority order

**For right now, as a POC** — just the 🔴 items, in order:

1. **1.1 atomic writes** — hours of work, removes the one way a crash
   permanently loses your only copy of a spec.
2. **1.2 optimistic concurrency** — cheap, and two-tabs-open is a real
   everyday way to self-inflict this one.
3. **3.1 commit the test suite + CI** — protects every change you make to
   this POC from here on; everything else gets safer to fix once it exists.
4. **2.2 raw-notes visibility + full regenerate** and **2.3 wire up
   regenerate-section** — the biggest product unlocks per unit of effort for
   actually using the POC day to day.

**Once this has real users, is network-exposed, or runs unattended** — the
⚪ items, roughly in this order: 1.3 id validation + 3.4 filename
sanitization (same class of fix), section 4's security posture as a block,
1.4 PNG snapshot bloat, then the smaller product/engineering polish
(2.1, 2.4–2.9, 3.2, 3.3, 3.5) as time allows.
