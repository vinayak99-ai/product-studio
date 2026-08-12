"""Catalog-file handling per docs/knowledge-base/PLAN.md's "Catalog file
handling" section: a document flagged is_catalog=True carries a markdown
table mapping filenames in its collection to a one-line description of
what they contain. This module does the structured row-by-row parse used
for metadata enrichment -- deterministic, independent of kb_chunking's
embedding-oriented chunking, so table size never affects its correctness.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.kb_models import KbDocumentMeta, KbDriftWarning

_FILENAME_HEADER_WORDS = {"file", "filename", "document", "doc", "name"}
_DESCRIPTION_HEADER_WORDS = {"description", "contents", "content", "summary", "purpose", "notes", "about"}

_TABLE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$")
_TABLE_SEPARATOR_RE = re.compile(r"^\s*\|?[\s:|-]+\|?\s*$")
_MARKDOWN_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]*\)")


@dataclass
class CatalogEntry:
    filename: str
    description: str


def _split_row(line: str) -> list[str]:
    cells = line.strip()
    if cells.startswith("|"):
        cells = cells[1:]
    if cells.endswith("|"):
        cells = cells[:-1]
    return [c.strip() for c in cells.split("|")]


def _clean_filename_cell(cell: str) -> str:
    text = _MARKDOWN_LINK_RE.sub(r"\1", cell)
    return text.strip("` *_").strip()


def parse_catalog_tables(content: str) -> list[CatalogEntry]:
    """Finds every markdown table in the document, and for any table whose
    header row matches a filename column and a description column
    (fuzzy-matched against common header names), extracts one CatalogEntry
    per data row. Tables that don't look like a filename/description
    catalog are silently skipped -- a catalog document is allowed to have
    other tables in it too."""
    lines = content.splitlines()
    entries: list[CatalogEntry] = []
    i, n = 0, len(lines)

    while i < n:
        line = lines[i]
        if _TABLE_ROW_RE.match(line) and i + 1 < n and _TABLE_SEPARATOR_RE.match(lines[i + 1]) and "|" in lines[i + 1]:
            header_cells = [c.lower() for c in _split_row(line)]
            filename_idx = next((idx for idx, c in enumerate(header_cells) if c in _FILENAME_HEADER_WORDS), None)
            description_idx = next(
                (idx for idx, c in enumerate(header_cells) if c in _DESCRIPTION_HEADER_WORDS), None
            )

            i += 2
            row_lines = []
            while i < n and _TABLE_ROW_RE.match(lines[i]):
                row_lines.append(lines[i])
                i += 1

            if filename_idx is not None and description_idx is not None:
                for row_line in row_lines:
                    cells = _split_row(row_line)
                    if len(cells) <= max(filename_idx, description_idx):
                        continue
                    filename = _clean_filename_cell(cells[filename_idx])
                    description = cells[description_idx].strip()
                    if filename:
                        entries.append(CatalogEntry(filename=filename, description=description))
            continue

        i += 1

    return entries


def match_entries_to_documents(
    entries: list[CatalogEntry], documents: list[KbDocumentMeta]
) -> dict[str, str]:
    """Returns {document_id: description} for every catalog entry whose
    filename matches an actual document in the collection. Entries with no
    matching document are dropped here -- they surface separately via
    detect_drift so the caller can warn on them rather than silently
    losing them."""
    by_filename = {doc.filename: doc.id for doc in documents}
    matched: dict[str, str] = {}
    for entry in entries:
        document_id = by_filename.get(entry.filename)
        if document_id:
            matched[document_id] = entry.description
    return matched


def detect_drift(entries: list[CatalogEntry], documents: list[KbDocumentMeta]) -> list[KbDriftWarning]:
    """Soft warnings only, per the plan -- never blocks the collection from
    being used. Only meaningful when a catalog actually exists; callers
    should skip this entirely for collections with no catalog document."""
    warnings: list[KbDriftWarning] = []
    document_filenames = {doc.filename for doc in documents}
    entry_filenames = {e.filename for e in entries}

    for entry in entries:
        if entry.filename not in document_filenames:
            warnings.append(
                KbDriftWarning(
                    kind="catalog_row_missing_document",
                    detail=f"Catalog lists \"{entry.filename}\" but no document with that name is in this collection.",
                )
            )

    for doc in documents:
        if doc.is_catalog:
            continue
        if doc.filename not in entry_filenames:
            warnings.append(
                KbDriftWarning(
                    kind="document_not_in_catalog",
                    detail=f"\"{doc.filename}\" is in this collection but isn't listed in the catalog.",
                )
            )

    return warnings
