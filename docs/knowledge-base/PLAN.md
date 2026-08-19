# Knowledge Base — Design Plan

*A planning document, not shipped code. Written to consolidate a design
discussion into one reference before implementation starts. Once pieces of
this ship, the durable description of how they work belongs in the main
`README.md`'s tools table, the same as every other tool — this file stops
being updated at that point rather than becoming a second source of truth.*

## What this is

A new rail tab, **Knowledge Base**, sitting alongside Document Q&A rather
than replacing it. Document Q&A stays the fast path for "I have one document,
let me chat with it" (full-context, no chunking, by design). Knowledge Base
is for the case Document Q&A explicitly doesn't handle: many documents,
across teams, organized into named **collections**, searched with real
retrieval (ChromaDB) instead of context-stuffing, with answers that cite
exactly which document they came from.

The end-to-end loop this tool exists to support: multiple teams contribute
markdown (and eventually other formats) describing what they're doing → it's
ingested into a collection → you search/ask across one or more collections →
an LLM answers grounded in retrieved chunks, with citations → you turn that
analysis into a new markdown document → that document can itself become
something other teams read, understand the architecture from, or build on.

## Core concepts

- **Collection** — a named, independent group of documents with its own
  vector index. A user creates as many as they want (e.g. one per project,
  plus a generic/global one for cross-cutting reference material).
- **Document** — one uploaded file, living inside exactly one collection.
  Carries a filename, an `uploaded_at` and `updated_at` timestamp, and
  (optionally) a human-written description sourced from a catalog file.
- **Catalog document** — an optional, explicitly-flagged document inside a
  collection that itself is an index: a table mapping filenames in that
  collection to a one-line description of what they contain. Not every
  collection has one. Handled specially at ingest (see below), but is
  otherwise a normal document — it can be replaced/deleted like any other.
- **Chunk** — the actual unit stored in ChromaDB: a slice of a document's
  text, embedded, carrying metadata back to its source document.

## Data model

New Pydantic models (`kb_models.py`), following this backend's existing
convention of one models file per tool:

```python
class KbCollectionMeta(BaseModel):
    id: str
    name: str
    created_at: str
    updated_at: str
    document_count: int = 0
    is_default_included: bool = False  # pre-checked in the multi-collection search picker

class KbDocumentMeta(BaseModel):
    id: str
    collection_id: str
    filename: str
    is_catalog: bool = False
    uploaded_at: str
    updated_at: str
    description: str | None = None  # filled in from a catalog row, if any references it
    chunk_count: int = 0

class KbChunkMetadata(BaseModel):
    """What actually rides along on every chunk stored in Chroma."""
    document_id: str
    filename: str
    collection_id: str
    collection_name: str
    heading_path: str | None = None   # e.g. "Product Spec > Rollout Plan > Phase 2"
    description: str | None = None    # from the catalog, if this file has one
    chunk_index: int
    uploaded_at: str
    updated_at: str

class KbSearchRequest(BaseModel):
    collection_ids: list[str]   # multi-select — see "Cross-collection search" below
    question: str

class KbCitation(BaseModel):
    document_id: str
    filename: str
    collection_name: str
    heading_path: str | None = None
    snippet: str

class KbSearchResponse(BaseModel):
    answer_markdown: str
    citations: list[KbCitation] = Field(default_factory=list)
```

Project-level metadata (`KbCollectionMeta`, `KbDocumentMeta`) is plain JSON on
disk, same pattern as every other tool in this backend (`kb_persistence.py`,
mirroring `doc_qa_persistence.py`). Chunk-level data and embeddings live in
ChromaDB, not in that JSON — the JSON is the source of truth for "what
documents/collections exist," Chroma is the source of truth for "what's
searchable." `document_count` and `chunk_count` are denormalized counts kept
in sync on ingest/delete for cheap UI display, not queried from Chroma live.

## Ingestion pipeline

### File types

**v1 scope: `.md` only.** Deliberately narrow — no `.txt`, `.pdf`, `.docx`,
`.xlsx`, `.csv`, or `.pptx` in the initial ingestion pipeline, even though
`.txt`/`.pdf`/`.docx` are already handled by this backend's shared
`extraction.py` for other tools. Knowledge Base does not call into that
module at all for v1; it reads uploaded files as raw markdown text
directly. This includes the catalog file — for v1 it must be a markdown
table in a `.md` file, not an actual `.xlsx` upload (the "Excel table
format" catalog case from earlier design becomes a markdown table that
happens to describe files the way a spreadsheet would, not a real `.xlsx`
file). The bugs found in `.docx`/`.pdf` table extraction (silently dropped
tables, mangled table structure) and the missing `.xlsx`/`.csv`/`.pptx`
support are still worth fixing eventually, but are entirely out of scope
until markdown-only ingestion is built, tested, and proven. See "Deferred
file type work" below.

### Deferred file type work (not v1)

Kept here so the earlier analysis isn't lost, revisit once markdown-only
ingestion is working:

| Type | Status today | Action needed, when this is picked back up |
|---|---|---|
| `.pdf` | Supported elsewhere in this backend | Current extraction is plain-text-pull (`pypdf`), which mangles table structure. Needs a table-aware extractor before this tool trusts PDFs with tables. |
| `.docx` | Supported elsewhere in this backend | Current extraction only reads `document.paragraphs` — **silently drops every table in the file**. Needs `document.tables` added before this tool trusts docx files with tables. |
| `.xlsx` | Not supported anywhere | Add via `openpyxl`, if a real `.xlsx` catalog upload (rather than a markdown table) turns out to be needed. |
| `.csv` | Not supported anywhere | Same rationale as xlsx, simpler to add (stdlib `csv`). |
| `.pptx` | Not supported for ingestion (only export) | `python-pptx` is already a dependency — just needs a read path added. Extract slide text + speaker notes per slide. |
| `.yaml` / `.json` | Not supported, not planned | Only add if a team actually hands over an OpenAPI spec or similar — needs structured/key-aware chunking, a different code path from prose chunking. |

### Chunking

Markdown-native, structure-aware chunking (`kb_chunking.py`), not fixed-size
windows:

1. Split first on heading boundaries (`#`, `##`, `###`), then on paragraphs
   within a section.
2. Never split a table or fenced code block — both are atomic units. If a
   table must span multiple chunks because it's very large, repeat the
   header row at the top of every chunk it's split into.
3. Prepend each chunk with its heading path (`Product Spec > Rollout Plan >
   Phase 2`) before embedding — improves embedding accuracy and gives every
   chunk self-describing context even in isolation.
4. When a section is too long for one chunk even after (1)-(3), split with
   ~15-20% overlap so an idea straddling the cut still appears whole in at
   least one neighboring chunk.
5. At generation time (not ingest time), retrieval expands a matched chunk
   out to its full parent section before it's handed to the LLM — search
   stays fine-grained for match precision, but the model never reasons from
   an artificially truncated fragment. This is the main lever against
   "missing information," more than chunk size or overlap tuning.

### Catalog file handling

A document flagged `is_catalog=True` at upload gets two independent
treatments, not one:

1. **Structured parse → metadata enrichment.** A deterministic row-by-row
   parse (independent of chunking/embedding entirely) matches each row's
   filename against the collection's actual documents and writes that row's
   description onto every chunk belonging to that document
   (`KbChunkMetadata.description`). Table size doesn't affect correctness
   here — this pass reads every row exactly once regardless of scale.
2. **Chunked + embedded copy, for making the catalog itself searchable.**
   Goes through the normal table-chunking rules above (row-group chunks with
   repeated header row for large tables) so a query like "which file covers
   pricing?" can match directly against the description column.

Catalog replace has a wider blast radius than a normal file replace: step 1
must re-run across every document the catalog references, not just the
catalog's own chunks. Regular document replace only touches that one
document's chunks.

**Drift detection** (a catalog row pointing at a file that isn't in the
collection, or a document not listed in the catalog): surfaced in the UI as
a soft warning, never a blocker — the collection stays fully usable either
way.

## Vector store (ChromaDB)

- `chromadb.PersistentClient(path=...)` pointed at a local data directory —
  same file-based-persistence philosophy as the rest of this backend (see
  `DATA_ROOT` in `doc_qa_persistence.py`), no new server process.
- **One Chroma collection per Knowledge Base collection** (1:1 mapping) —
  simplest correct model; a metadata-filtered single collection was
  considered and rejected as unnecessary complexity for this scale.
- **Embedding function**: Chroma's built-in local `DefaultEmbeddingFunction`
  (ONNX MiniLM-L6-v2) — offline, no OpenAI key or network round trip per
  chunk/query, zero new dependencies (chromadb already vendors onnxruntime
  for it). Originally OpenAI `text-embedding-3-small` for consistency with
  `llm_client.py`; switched once local-only operation mattered more than
  that consistency. A model switch ties to `_EMBEDDING_FUNCTION_ID` in
  `kb_vector_store.py`, which wipes and triggers a full local re-embed of
  every document on the next startup when it changes (see
  `reembed_all_needed()` / `reindex_all_collections()`) — no OpenAI calls
  involved, since the original text lives on disk independently of Chroma.
- **Replace/delete**: `collection.delete(where={"document_id": "..."})` to
  drop every chunk for a document in one call, then re-chunk + re-embed on
  re-upload. Full replace, not an incremental diff — avoids any risk of
  stale chunks from an old version lingering alongside a new one.
- **Collection naming**: the Chroma-side collection is identified by a
  generated ID (`KbCollectionMeta.id`), not the human-facing name directly
  — decouples the display name from the Chroma identifier, so a rename
  never risks a collision or an invalid-character issue on the Chroma side.
  The human-facing `name` lives only in the JSON metadata.

### Initial collections

Three collections to create once collection CRUD exists:

- **Firm Context** — the always-on, cross-project reference collection
  (the "global" collection from the cross-collection search design; default
  included alongside whichever project collection is active).
- **Project Context** — project-specific collection.
- **Systems Info** — project-specific collection.

No special-casing needed in code for any of these three — they're created
through the same collection-creation flow as any future collection. The
only behavior that treats "Firm Context" differently is the UI default
described under Cross-collection search below (pre-checked, not hardcoded
by name — a `is_default_included` flag on the collection, settable by the
user on any collection, happens to be turned on for this one at creation).

## Retrieval + generation flow

1. User selects one or more collections in the UI (multi-select, not just
   single-select — see below) and asks a question.
2. **Federated query**: each selected collection is queried independently
   (Chroma has no native cross-collection query), returning top-k per
   collection.
3. **Merge + re-rank**: since every collection shares the same embedding
   model, scores are directly comparable — pool all results, re-rank by
   score, keep an overall top-N (not a naive concatenation, which would just
   grow the context linearly with collection count).
4. **Expand to parent section** (per the chunking section above) before
   handing chunks to the LLM.
5. **Generate**: `generate_structured()` (this backend's one LLM-calling
   pattern, used by every other tool) with a system prompt instructing the
   model to answer only from the provided context, in markdown, and to cite
   which source each claim came from. Returns `KbSearchResponse` — answer
   text as markdown, plus a structured `citations` list (not free-text
   citations parsed out of prose, which is fragile) so the UI can render
   real "view source" links deterministically.
6. Every citation carries `collection_name` alongside `filename`, so when an
   answer draws on both a project collection and the global collection, it's
   visible which context each claim came from.

### Cross-collection search

Multi-select rather than single-select in the collection picker. For the
project + global pattern specifically: default the global/generic collection
to always-included alongside whichever project collection is active, with
the option to turn it off — global reference material is usually relevant
regardless of which project you're focused on, so this avoids re-checking it
every time.

### Output format

`answer_markdown` is rendered directly in the UI (a markdown renderer, not
raw text) — headings, bullet lists, and bold used for clarity per the user's
"give out information in a very clear way" requirement, sourced from the
system prompt instructing structured markdown output, not from any
post-processing. Every generated answer can be saved as a new document via a
"Save as document" action; the open decision is whether that save re-ingests
into the collection (becomes part of the searchable corpus going forward) or
stays a standalone export. Recommend standalone-only for the first version —
re-ingestion of generated content is a reasonable v2 addition once the basic
loop is proven out, not a day-one requirement.

## Lifecycle management summary

| Action | Effect |
|---|---|
| Upload a new document | Extract → chunk → embed → add to Chroma; if flagged as catalog, also run structured parse + enrichment |
| Replace a document | Delete all chunks for that `document_id` → re-run full ingest on the new file → `updated_at` refreshed, `uploaded_at` untouched |
| Replace the catalog document | Same as above, plus re-run enrichment across every document it references |
| Delete a document | Delete all its chunks; if it was referenced by the catalog, that becomes a drift warning |
| Delete a collection | Drop the whole Chroma collection + its JSON metadata |

## New dependencies

- `chromadb` — the vector store itself. The only new dependency v1
  actually needs — markdown-only ingestion requires no new file-parsing
  library.
- Deferred, only needed once the file-type work above is picked back up:
  `openpyxl` (`.xlsx`), a table-aware PDF extractor such as `pdfplumber`,
  `python-docx`'s existing table API (`document.tables` — no new
  dependency, just a code change), `python-pptx` (already present, no
  install needed, only a new read path).

## Backend module plan

New files, following this backend's existing per-tool convention (models /
persistence / llm / vector-store / routes):

- `app/kb_models.py` — the Pydantic models above.
- `app/kb_persistence.py` — collection/document JSON metadata (mirrors
  `doc_qa_persistence.py`).
- `app/kb_chunking.py` — markdown structure-aware chunking + table handling.
- `app/kb_catalog.py` — catalog table structured parse + metadata
  enrichment + drift detection.
- `app/kb_vector_store.py` — thin wrapper around the Chroma client:
  add/replace/delete/query per collection, federated multi-collection query
  + merge/re-rank.
- `app/kb_llm.py` — the retrieval-augmented `generate_structured()` call,
  system prompt for markdown-formatted, citation-carrying answers.
- `app/extraction.py` — **not touched for v1.** Knowledge Base reads
  uploaded `.md` files directly rather than calling into this module. The
  xlsx/csv/table-aware docx/pdf work, when picked back up, extends this
  module in place rather than duplicating it, so every existing tool that
  uploads documents benefits from the same fixes — but that's deferred
  work, not part of building Knowledge Base itself.
- `app/routes/knowledge_base.py` — collection CRUD, document
  upload/replace/delete, search endpoint (WebSocket, matching this
  backend's existing progress-streaming pattern for LLM calls).

## Frontend module plan

Mirrors Document Q&A's existing two-pane shape (list + detail), extended for
multi-document collections and multi-collection search:

- `src/lib/tools.ts` — new `'knowledge-base'` entry in the rail.
- `src/knowledgeBaseTypes.ts` — mirrors the backend models above.
- `src/lib/knowledgeBaseApi.ts` — collection/document CRUD + search socket,
  same shape as `storyApi.ts`/`deepAnalysisApi.ts`.
- `src/components/KnowledgeBaseSidebar.tsx` — collection list (create /
  rename / delete), matching the existing project-list sidebars elsewhere in
  this app.
- `src/components/KnowledgeBaseCollectionDetail.tsx` — the document list for
  a selected collection: upload, per-document Replace/Delete actions, the
  "mark as catalog" toggle at upload time, and any drift warnings.
- `src/components/KnowledgeBaseSearch.tsx` — the multi-collection picker
  (checkboxes, global collection pre-checked) + question box + markdown-
  rendered answer + expandable citations list (click a citation to open the
  source document).

## Open decisions before implementation starts

Resolved since the first draft of this plan: file-type scope (markdown
only for v1, see above) and Chroma collection naming (generated ID,
decoupled from the display name — see "Initial collections" above). What's
still open:

1. **Chunk size targets** — not yet pinned to an exact token/char count.
   Needs a concrete default (e.g. ~800 tokens per chunk, ~150 token overlap)
   validated against a few real documents once building starts.
2. **Generated-document re-ingestion** — standalone export only for v1, per
   the recommendation above; revisit once the core loop is used in practice.

## Suggested phased build order

1. **Foundation**: `kb_models.py`, `kb_persistence.py`, `kb_vector_store.py`
   wired to a real Chroma instance, collection CRUD routes + UI (create/
   list/rename/delete collections, no documents yet). Create the three
   initial collections (Firm Context, Project Context, Systems Info) once this
   exists.
2. **Ingestion, single collection**: markdown-only document upload,
   structure-aware chunking, single-collection search + citations,
   markdown-rendered answers.
3. **Catalog handling**: `is_catalog` flag, structured parse + enrichment,
   drift warnings, replace/delete lifecycle including the catalog's wider
   blast radius.
4. **Cross-collection search**: multi-select picker, federated query +
   merge/re-rank, Firm Context default-included behavior.
5. **File type expansion (later, not v1)**: xlsx/csv extraction, docx table
   fix, pptx read path — in that priority order, each addable independently
   once the markdown-only core loop from steps 1-4 is proven.
