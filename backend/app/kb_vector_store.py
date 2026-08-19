"""Thin wrapper around ChromaDB -- one Chroma collection per Knowledge
Base collection (1:1, see docs/knowledge-base/PLAN.md), keyed by the
generated collection id rather than its human-facing name, so a rename
never touches the Chroma side at all.

Embeddings: ChromaDB's built-in local DefaultEmbeddingFunction (ONNX
MiniLM-L6-v2, 384 dims) -- runs fully offline after the model's first
download, no OpenAI API key or network round trip needed per chunk/query,
and zero new dependencies (chromadb already vendors onnxruntime for this).
Previously used OpenAI's text-embedding-3-small; switched to keep KB usable
without an OpenAI key and to cut ingest/query latency to local inference.
"""

from __future__ import annotations

import logging
import shutil
import time
from functools import lru_cache
from pathlib import Path

import chromadb
from chromadb.api.models.Collection import Collection
from chromadb.utils import embedding_functions

from app.kb_chunking import MarkdownChunk
from app.kb_models import KbChunkMetadata

logger = logging.getLogger(__name__)

DATA_ROOT = Path.home() / "kb-data" / "chroma"
# Tracks which ChromaDB version wrote the data directory; a version change
# means an incompatible on-disk format (e.g. 0.x hnswlib → 1.x Rust bindings)
# that would cause a native Rust panic on the first write if left in place.
_VERSION_FILE = DATA_ROOT.parent / "chroma_version"

# Tracks which embedding function wrote the data directory. Chroma ties an
# embedding function to a collection permanently at creation (vectors from
# two different models aren't comparable), so switching models -- like this
# one, OpenAI text-embedding-3-small -> local ONNX MiniLM -- needs the same
# wipe-and-rebuild treatment as a Chroma version mismatch, not just a code
# change. See reembed_all_needed() below, and
# routes/knowledge_base.py's reindex_all_collections() for the rebuild step.
_EMBEDDING_FUNCTION_MARKER_FILE = DATA_ROOT.parent / "embedding_function"
_EMBEDDING_FUNCTION_ID = "chroma-default-onnx-minilm-l6-v2"

# How many chunks to pull per collection before merging, when a search
# spans multiple collections -- wider than the final answer's context so
# re-ranking has real candidates to choose from rather than just whatever
# each collection's single best match happened to be.
PER_COLLECTION_CANDIDATES = 8
FINAL_TOP_N = 8


def _ensure_compatible_chroma_data() -> bool:
    """Wipe DATA_ROOT when the installed ChromaDB version, or the embedding
    function, doesn't match what wrote it -- a vector from one embedding
    model is meaningless compared against vectors from another, so a model
    change needs the same treatment as an incompatible on-disk format.
    Called once before the client is created so the directory is always in
    a state the current bindings can safely open. Returns True if it
    wiped, so the caller knows every existing document needs re-embedding
    (see reembed_all_needed())."""
    version_current = chromadb.__version__
    version_stored = _VERSION_FILE.read_text(encoding="utf-8").strip() if _VERSION_FILE.exists() else None
    ef_stored = (
        _EMBEDDING_FUNCTION_MARKER_FILE.read_text(encoding="utf-8").strip()
        if _EMBEDDING_FUNCTION_MARKER_FILE.exists()
        else None
    )
    if version_stored == version_current and ef_stored == _EMBEDDING_FUNCTION_ID:
        return False

    data_exists = DATA_ROOT.exists() and any(DATA_ROOT.iterdir())
    if version_stored is None and ef_stored is None and data_exists:
        logger.warning(
            "kb_vector_store: existing ChromaDB data at %s has no version/embedding marker "
            "-- wiping to avoid format mismatch with installed version %s",
            DATA_ROOT,
            version_current,
        )
    elif version_stored is not None and version_stored != version_current:
        logger.warning(
            "kb_vector_store: ChromaDB version changed %s -> %s "
            "-- wiping stale vector index at %s (document files are unaffected)",
            version_stored,
            version_current,
            DATA_ROOT,
        )
    elif ef_stored is not None and ef_stored != _EMBEDDING_FUNCTION_ID:
        logger.warning(
            "kb_vector_store: embedding function changed %s -> %s "
            "-- wiping stale vector index at %s (document files are unaffected, will be re-embedded)",
            ef_stored,
            _EMBEDDING_FUNCTION_ID,
            DATA_ROOT,
        )
    elif ef_stored is None and data_exists:
        # Upgrading from before embedding-function tracking existed --
        # the chroma-version marker alone was never proof the embeddings
        # underneath it were still OpenAI's, so this still needs a rebuild.
        logger.warning(
            "kb_vector_store: no embedding-function marker found (pre-dates embedding tracking) "
            "-- wiping stale vector index at %s to re-embed with %s (document files are unaffected)",
            DATA_ROOT,
            _EMBEDDING_FUNCTION_ID,
        )
    if DATA_ROOT.exists():
        shutil.rmtree(DATA_ROOT)
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    _VERSION_FILE.write_text(version_current, encoding="utf-8")
    _EMBEDDING_FUNCTION_MARKER_FILE.write_text(_EMBEDDING_FUNCTION_ID, encoding="utf-8")
    return True


def reembed_all_needed() -> bool:
    """True if the vector index was just wiped (version or embedding-function
    change) and every existing document needs re-embedding from its stored
    source text before search will find anything again. Safe to call more
    than once -- only the first call after a real change does the wipe and
    returns True; later calls are no-ops that return False."""
    return _ensure_compatible_chroma_data()


@lru_cache
def _client() -> chromadb.ClientAPI:
    _ensure_compatible_chroma_data()
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    return chromadb.PersistentClient(path=str(DATA_ROOT))


@lru_cache
def _embedding_function() -> embedding_functions.DefaultEmbeddingFunction:
    return embedding_functions.DefaultEmbeddingFunction()


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
        logger.info("add_document_chunks: %s has 0 chunks, nothing to embed", filename)
        return
    logger.info(
        "add_document_chunks: embedding %d chunk(s) for %r (collection=%s, document=%s) via the local "
        "ONNX MiniLM model -- runs offline, first call in a fresh environment may pause to download "
        "the model",
        len(chunks),
        filename,
        collection_id,
        document_id,
    )
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
    started = time.monotonic()
    try:
        col.add(ids=ids, documents=documents, metadatas=metadatas)
    except Exception:
        elapsed_ms = (time.monotonic() - started) * 1000
        logger.exception(
            "add_document_chunks: embedding FAILED for %r after %.0fms (%d chunks attempted)",
            filename,
            elapsed_ms,
            len(chunks),
        )
        raise
    elapsed_ms = (time.monotonic() - started) * 1000
    logger.info(
        "add_document_chunks: embedded and stored %d chunk(s) for %r in %.0fms", len(chunks), filename, elapsed_ms
    )


def delete_document_chunks(collection_id: str, document_id: str) -> None:
    logger.info("delete_document_chunks: collection=%s document=%s", collection_id, document_id)
    col = _chroma_collection(collection_id)
    col.delete(where={"document_id": document_id})
    logger.info("delete_document_chunks: done for document=%s", document_id)


def update_document_description(collection_id: str, document_id: str, description: str) -> None:
    """Used when a catalog is (re)parsed and a document's description
    changes without its content changing -- updates metadata on every
    existing chunk for that document without re-embedding them."""
    col = _chroma_collection(collection_id)
    existing = col.get(where={"document_id": document_id})
    if not existing["ids"]:
        logger.info("update_document_description: no chunks found for document=%s, nothing to update", document_id)
        return
    updated_metadatas = []
    for metadata in existing["metadatas"]:
        updated = dict(metadata)
        updated["description"] = description
        updated_metadatas.append(updated)
    col.update(ids=existing["ids"], metadatas=updated_metadatas)
    logger.info(
        "update_document_description: updated %d chunk(s) for document=%s", len(existing["ids"]), document_id
    )


def delete_collection_index(collection_id: str) -> None:
    logger.info("delete_collection_index: collection=%s", collection_id)
    try:
        _client().delete_collection(name=collection_id)
    except Exception:
        logger.info("delete_collection_index: no Chroma index existed for collection=%s (nothing to delete)", collection_id)


def query_collection(collection_id: str, question: str, n_results: int) -> list[dict]:
    col = _chroma_collection(collection_id)
    count = col.count()
    if count == 0:
        logger.info("query_collection: collection=%s is empty, skipping", collection_id)
        return []
    started = time.monotonic()
    try:
        # Embeds `question` via the same local ONNX call as ingestion.
        result = col.query(query_texts=[question], n_results=min(n_results, count))
    except Exception:
        elapsed_ms = (time.monotonic() - started) * 1000
        logger.exception("query_collection: query embedding FAILED for collection=%s after %.0fms", collection_id, elapsed_ms)
        raise
    elapsed_ms = (time.monotonic() - started) * 1000
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
    logger.info("query_collection: collection=%s returned %d hit(s) in %.0fms", collection_id, len(hits), elapsed_ms)
    return hits


def federated_query(collection_ids: list[str], question: str) -> list[dict]:
    """Queries each collection independently (Chroma has no native
    cross-collection query), then merges by distance -- lower is more
    similar, and scores are directly comparable across collections since
    they all share the same embedding function. Returns the top
    FINAL_TOP_N across the whole merged pool, not a naive per-collection
    concatenation."""
    logger.info("federated_query: searching %d collection(s) for %r", len(collection_ids), question)
    pooled: list[dict] = []
    for collection_id in collection_ids:
        pooled.extend(query_collection(collection_id, question, PER_COLLECTION_CANDIDATES))
    pooled.sort(key=lambda hit: hit["distance"])
    merged = pooled[:FINAL_TOP_N]
    logger.info("federated_query: %d pooled hit(s), returning top %d", len(pooled), len(merged))
    return merged


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
