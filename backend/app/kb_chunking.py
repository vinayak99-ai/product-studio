"""Markdown-native, structure-aware chunking (see docs/knowledge-base/PLAN.md's
"Chunking" section for the design rationale). No tokenizer dependency --
targets are in characters (~4 chars/token is close enough for a chunk-size
knob, and staying dependency-free matches the markdown-only v1 scope).

Rules, in priority order:
1. Split on heading boundaries first, then paragraphs within a section.
2. Tables and fenced code blocks are atomic -- never split mid-block. A
   table that's still too large for one chunk on its own is the one
   exception: it splits into row-group chunks with the header/separator
   row repeated in each (see _split_large_table). Code blocks stay whole
   regardless of size.
3. Every chunk is prefixed with its heading path before being returned, so
   even an isolated chunk carries its structural context.
4. When a section's paragraphs must span multiple chunks, the last
   paragraph of a flushed chunk is repeated as the first paragraph of the
   next one (paragraph-granularity overlap) so an idea straddling the cut
   isn't stranded in only one chunk.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

CHUNK_TARGET_CHARS = 3200
TABLE_ROW_GROUP_SIZE = 25

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_FENCE_RE = re.compile(r"^(```|~~~)")
_TABLE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$")
_TABLE_SEPARATOR_RE = re.compile(r"^\s*\|?[\s:|-]+\|?\s*$")


@dataclass
class MarkdownChunk:
    text: str  # heading-path-prefixed, ready to embed
    heading_path: str
    chunk_index: int


@dataclass
class _Block:
    text: str
    kind: str  # "paragraph" | "table" | "code"


def chunk_markdown(content: str) -> list[MarkdownChunk]:
    sections = _split_into_sections(content)
    chunks: list[MarkdownChunk] = []
    for heading_path, blocks in sections:
        for chunk_text in _assemble_chunks(blocks):
            prefixed = f"{heading_path}\n\n{chunk_text}" if heading_path else chunk_text
            chunks.append(MarkdownChunk(text=prefixed, heading_path=heading_path, chunk_index=len(chunks)))
    return chunks


def _split_into_sections(content: str) -> list[tuple[str, list[_Block]]]:
    """Walks the document top to bottom, tracking a heading-path stack, and
    groups every block (paragraph/table/code) under the heading path active
    when it appeared. A document with no headings at all becomes one
    section with an empty heading path."""
    lines = content.splitlines()
    heading_stack: list[str] = []  # one entry per active level, e.g. ["Product Spec", "Rollout Plan"]
    sections: list[tuple[str, list[_Block]]] = [("", [])]
    paragraph_buf: list[str] = []

    def flush_paragraph() -> None:
        if paragraph_buf:
            text = "\n".join(paragraph_buf).strip()
            if text:
                sections[-1][1].append(_Block(text=text, kind="paragraph"))
            paragraph_buf.clear()

    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]

        heading_match = _HEADING_RE.match(line)
        if heading_match:
            flush_paragraph()
            level = len(heading_match.group(1))
            title = heading_match.group(2).strip()
            heading_stack = heading_stack[: level - 1]
            while len(heading_stack) < level - 1:
                heading_stack.append("")
            heading_stack.append(title)
            sections.append((" > ".join(h for h in heading_stack if h), []))
            i += 1
            continue

        if _FENCE_RE.match(line.strip()):
            flush_paragraph()
            fence_lines = [line]
            i += 1
            while i < n and not _FENCE_RE.match(lines[i].strip()):
                fence_lines.append(lines[i])
                i += 1
            if i < n:
                fence_lines.append(lines[i])
                i += 1
            sections[-1][1].append(_Block(text="\n".join(fence_lines), kind="code"))
            continue

        if _TABLE_ROW_RE.match(line) and i + 1 < n and _TABLE_SEPARATOR_RE.match(lines[i + 1]) and "|" in lines[i + 1]:
            flush_paragraph()
            table_lines = [line, lines[i + 1]]
            i += 2
            while i < n and _TABLE_ROW_RE.match(lines[i]):
                table_lines.append(lines[i])
                i += 1
            sections[-1][1].append(_Block(text="\n".join(table_lines), kind="table"))
            continue

        if line.strip() == "":
            flush_paragraph()
            i += 1
            continue

        paragraph_buf.append(line)
        i += 1

    flush_paragraph()
    return [(path, blocks) for path, blocks in sections if blocks]


def _assemble_chunks(blocks: list[_Block]) -> list[str]:
    chunks: list[str] = []
    buffer: list[_Block] = []
    buffer_chars = 0

    def flush() -> list[_Block]:
        nonlocal buffer, buffer_chars
        if buffer:
            chunks.append("\n\n".join(b.text for b in buffer))
        overlap = [buffer[-1]] if buffer and buffer[-1].kind == "paragraph" else []
        buffer = overlap
        buffer_chars = sum(len(b.text) for b in overlap)
        return overlap

    for block in blocks:
        if block.kind == "table" and len(block.text) > CHUNK_TARGET_CHARS:
            flush()
            for table_chunk in _split_large_table(block.text):
                chunks.append(table_chunk)
            continue

        block_len = len(block.text)
        if buffer and buffer_chars + block_len > CHUNK_TARGET_CHARS:
            flush()

        buffer.append(block)
        buffer_chars += block_len

    if buffer:
        chunks.append("\n\n".join(b.text for b in buffer))

    return chunks


def _split_large_table(table_text: str) -> list[str]:
    lines = table_text.splitlines()
    header, separator, rows = lines[0], lines[1], lines[2:]
    groups: list[str] = []
    for start in range(0, len(rows), TABLE_ROW_GROUP_SIZE):
        group_rows = rows[start : start + TABLE_ROW_GROUP_SIZE]
        groups.append("\n".join([header, separator, *group_rows]))
    return groups or [table_text]
