"""Thin wrapper around ChromaDB -- one Chroma collection per Knowledge
Base collection (1:1, see docs/knowledge-base/PLAN.md), keyed by the
generated collection id rather than its human-facing name, so a rename
never touches the Chroma side at all.

Embeddings: OpenAI's text-embedding-3-small, for consistency with
llm_client.py (already OpenAI-based) rather than Chroma's default local
model -- see the plan's "Vector store (ChromaDB)" section for why.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import chromadb
from chromadb.api.models.Collection import Collection
from chromadb.utils import embedding_functions

from app.config import get_settings
from app.kb_chunking import MarkdownChunk
from app.kb_models import KbChunkMetadata

DATA_ROOT = Path.home() / "kb-data" / "chroma"

# How many chunks to pull per collection before merging, when a search
# spans multiple collections -- wider than the final answer's context so
# re-ranking has real candidates to choose from rather than just whatever
# each collection's single best match happened to be.
PER_COLLECTION_CANDIDATES = 8
FINAL_TOP_N = 8


@lru_cache
def _client() -> chromadb.ClientAPI:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    return chromadb.PersistentClient(path=str(DATA_ROOT))


@lru_cache
def _embedding_function() -> embedding_functions.OpenAIEmbeddingFunction:
    settings = get_settings()
    return embedding_functions.OpenAIEmbeddingFunction(
        api_key=settings.openai_api_key, model_name="text-embedding-3-small"
    )


def _chroma_collection(collection_id: str) -> Collection:
    return _client().get_or_create_collection(
        name=collection_id, embedding_function=_embedding_function()
    )


def _chunk_id(document_id: str, chunk_index: int) -> str:
    return f"{document_id}::{chunk_index}"


def add_document_chunks(
    collection_id: str,
    collection_name: str,
    document_id: str,
    filename: str,
    uploaded_at: str,
    updated_at: str,
    description: str,
    chunks: list[MarkdownChunk],
) -> None:
    if not chunks:
        return
    col = _chroma_collection(collection_id)
    ids = [_chunk_id(document_id, c.chunk_index) for c in chunks]
    documents = [c.text for c in chunks]
    metadatas = [
        KbChunkMetadata(
            document_id=document_id,
            filename=filename,
            collection_id=collection_id,
            collection_name=collection_name,
            heading_path=c.heading_path,
            description=description,
            chunk_index=c.chunk_index,
            uploaded_at=uploaded_at,
            updated_at=updated_at,
        ).model_dump()
        for c in chunks
    ]
    col.add(ids=ids, documents=documents, metadatas=metadatas)


def delete_document_chunks(collection_id: str, document_id: str) -> None:
    col = _chroma_collection(collection_id)
    col.delete(where={"document_id": document_id})


def update_document_description(collection_id: str, document_id: str, description: str) -> None:
    """Used when a catalog is (re)parsed and a document's description
    changes without its content changing -- updates metadata on every
    existing chunk for that document without re-embedding them."""
    col = _chroma_collection(collection_id)
    existing = col.get(where={"document_id": document_id})
    if not existing["ids"]:
        return
    updated_metadatas = []
    for metadata in existing["metadatas"]:
        updated = dict(metadata)
        updated["description"] = description
        updated_metadatas.append(updated)
    col.update(ids=existing["ids"], metadatas=updated_metadatas)


def delete_collection_index(collection_id: str) -> None:
    try:
        _client().delete_collection(name=collection_id)
    except Exception:
        pass  # nothing to delete -- fine, matches JSON-side delete's ignore_errors


def query_collection(collection_id: str, question: str, n_results: int) -> list[dict]:
    col = _chroma_collection(collection_id)
    count = col.count()
    if count == 0:
        return []
    result = col.query(query_texts=[question], n_results=min(n_results, count))
    hits = []
    for i in range(len(result["ids"][0])):
        hits.append(
            {
                "id": result["ids"][0][i],
                "text": result["documents"][0][i],
                "metadata": result["metadatas"][0][i],
                "distance": result["distances"][0][i],
            }
        )
    return hits


def federated_query(collection_ids: list[str], question: str) -> list[dict]:
    """Queries each collection independently (Chroma has no native
    cross-collection query), then merges by distance -- lower is more
    similar, and scores are directly comparable across collections since
    they all share the same embedding function. Returns the top
    FINAL_TOP_N across the whole merged pool, not a naive per-collection
    concatenation."""
    pooled: list[dict] = []
    for collection_id in collection_ids:
        pooled.extend(query_collection(collection_id, question, PER_COLLECTION_CANDIDATES))
    pooled.sort(key=lambda hit: hit["distance"])
    return pooled[:FINAL_TOP_N]


def expand_to_parent_section(collection_id: str, document_id: str, heading_path: str) -> str:
    """Small-to-big retrieval: search matches at chunk granularity for
    precision, but generation reads the whole parent section so the LLM
    never reasons from an artificially truncated fragment. Chunks are
    reassembled in chunk_index order; the heading-path prefix each chunk
    carries is stripped from all but the first to avoid repeating it."""
    col = _chroma_collection(collection_id)
    section = col.get(where={"$and": [{"document_id": document_id}, {"heading_path": heading_path}]})
    if not section["ids"]:
        return ""
    ordered = sorted(
        zip(section["metadatas"], section["documents"]), key=lambda pair: pair[0]["chunk_index"]
    )
    parts = [ordered[0][1]]
    prefix = f"{heading_path}\n\n"
    for _, text in ordered[1:]:
        parts.append(text[len(prefix) :] if text.startswith(prefix) else text)
    return "\n\n".join(parts)
