from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from datetime import datetime, timezone

from app.kb_models import KbCollectionMeta, KbDocumentMeta

# Same file-based-persistence philosophy as every other tool in this
# backend (see doc_qa_persistence.py's DATA_ROOT) -- collection/document
# metadata and the raw uploaded markdown live here as plain JSON/text;
# chunk-level data and embeddings live in ChromaDB (kb_vector_store.py),
# not here. This directory is the source of truth for "what
# collections/documents exist," Chroma is the source of truth for "what's
# searchable."
DATA_ROOT = Path.home() / "kb-data" / "collections"


def _collection_dir(collection_id: str) -> Path:
    return DATA_ROOT / collection_id


def _collection_meta_path(collection_id: str) -> Path:
    return _collection_dir(collection_id) / "meta.json"


def _documents_dir(collection_id: str) -> Path:
    return _collection_dir(collection_id) / "documents"


def _document_meta_path(collection_id: str, document_id: str) -> Path:
    return _documents_dir(collection_id) / f"{document_id}.json"


def _document_content_path(collection_id: str, document_id: str) -> Path:
    return _documents_dir(collection_id) / f"{document_id}.md"


def create_collection(name: str, is_default_included: bool = False) -> KbCollectionMeta:
    collection_id = f"kbcol_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()
    meta = KbCollectionMeta(
        id=collection_id,
        name=name,
        created_at=now,
        updated_at=now,
        is_default_included=is_default_included,
    )
    _documents_dir(collection_id).mkdir(parents=True, exist_ok=True)
    _collection_meta_path(collection_id).write_text(meta.model_dump_json(indent=2))
    return meta


def list_collections() -> list[KbCollectionMeta]:
    if not DATA_ROOT.exists():
        return []
    collections = []
    for col_dir in DATA_ROOT.iterdir():
        meta_file = col_dir / "meta.json"
        if meta_file.exists():
            collections.append(KbCollectionMeta.model_validate_json(meta_file.read_text()))
    return sorted(collections, key=lambda c: c.name.lower())


def collection_exists(collection_id: str) -> bool:
    return _collection_meta_path(collection_id).exists()


def get_collection(collection_id: str) -> KbCollectionMeta:
    return KbCollectionMeta.model_validate_json(_collection_meta_path(collection_id).read_text())


def rename_collection(collection_id: str, name: str) -> KbCollectionMeta:
    meta = get_collection(collection_id)
    meta.name = name
    meta.updated_at = datetime.now(timezone.utc).isoformat()
    _collection_meta_path(collection_id).write_text(meta.model_dump_json(indent=2))
    return meta

def _touch_collection(meta: KbCollectionMeta) -> None:
    meta.updated_at = datetime.now(timezone.utc).isoformat()
    _collection_meta_path(meta.id).write_text(meta.model_dump_json(indent=2))


def delete_collection(collection_id: str) -> None:
    shutil.rmtree(_collection_dir(collection_id), ignore_errors=True)


def list_documents(collection_id: str) -> list[KbDocumentMeta]:
    docs_dir = _documents_dir(collection_id)
    if not docs_dir.exists():
        return []
    documents = [
        KbDocumentMeta.model_validate_json(f.read_text())
        for f in docs_dir.glob("*.json")
    ]
    return sorted(documents, key=lambda d: d.filename.lower())


def get_document(collection_id: str, document_id: str) -> KbDocumentMeta:
    return KbDocumentMeta.model_validate_json(_document_meta_path(collection_id, document_id).read_text())


def load_document_content(collection_id: str, document_id: str) -> str:
    return _document_content_path(collection_id, document_id).read_text()


def save_document(
    collection_id: str, filename: str, content: str, is_catalog: bool = False
) -> KbDocumentMeta:
    """Creates a new document. Use replace_document to update an existing
    one -- kept as two functions rather than an upsert so callers can't
    accidentally clobber a document's id/uploaded_at by mistyping a
    filename match."""
    document_id = f"kbdoc_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()
    meta = KbDocumentMeta(
        id=document_id,
        collection_id=collection_id,
        filename=filename,
        is_catalog=is_catalog,
        uploaded_at=now,
        updated_at=now,
    )
    _document_meta_path(collection_id, document_id).write_text(meta.model_dump_json(indent=2))
    _document_content_path(collection_id, document_id).write_text(content)

    col_meta = get_collection(collection_id)
    col_meta.document_count = len(list_documents(collection_id))
    _touch_collection(col_meta)
    return meta


def replace_document_content(collection_id: str, document_id: str, content: str) -> KbDocumentMeta:
    meta = get_document(collection_id, document_id)
    meta.updated_at = datetime.now(timezone.utc).isoformat()
    _document_meta_path(collection_id, document_id).write_text(meta.model_dump_json(indent=2))
    _document_content_path(collection_id, document_id).write_text(content)

    col_meta = get_collection(collection_id)
    _touch_collection(col_meta)
    return meta


def set_document_description(collection_id: str, document_id: str, description: str | None) -> None:
    meta = get_document(collection_id, document_id)
    meta.description = description
    _document_meta_path(collection_id, document_id).write_text(meta.model_dump_json(indent=2))


def set_document_chunk_count(collection_id: str, document_id: str, chunk_count: int) -> None:
    meta = get_document(collection_id, document_id)
    meta.chunk_count = chunk_count
    _document_meta_path(collection_id, document_id).write_text(meta.model_dump_json(indent=2))


def delete_document(collection_id: str, document_id: str) -> None:
    _document_meta_path(collection_id, document_id).unlink(missing_ok=True)
    _document_content_path(collection_id, document_id).unlink(missing_ok=True)

    col_meta = get_collection(collection_id)
    col_meta.document_count = len(list_documents(collection_id))
    _touch_collection(col_meta)


def find_document_by_filename(collection_id: str, filename: str) -> KbDocumentMeta | None:
    for doc in list_documents(collection_id):
        if doc.filename == filename:
            return doc
    return None


def seed_default_collections(names_and_defaults: dict[str, bool]) -> None:
    """Idempotent -- creates only the ones that don't already exist by
    name, called once from main.py's startup hook. Not exposed as a route;
    this is bootstrap, not something a user triggers."""
    existing_names = {c.name for c in list_collections()}
    for name, is_default in names_and_defaults.items():
        if name not in existing_names:
            create_collection(name, is_default_included=is_default)
