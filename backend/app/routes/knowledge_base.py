from __future__ import annotations

from fastapi import APIRouter, HTTPException
from openai import OpenAIError

from app import kb_persistence, kb_vector_store
from app.kb_catalog import detect_drift, match_entries_to_documents, parse_catalog_tables
from app.kb_chunking import chunk_markdown
from app.kb_llm import ContextPassage, answer_question
from app.kb_models import (
    CreateCollectionRequest,
    KbCollectionDetail,
    KbCollectionMeta,
    KbDocumentMeta,
    KbSearchRequest,
    KbSearchResponse,
    RenameCollectionRequest,
    UploadDocumentRequest,
)

router = APIRouter(prefix="/api/kb")


def _ingest_document(
    collection_id: str, collection_name: str, document: KbDocumentMeta, content: str
) -> None:
    chunks = chunk_markdown(content)
    kb_vector_store.add_document_chunks(
        collection_id=collection_id,
        collection_name=collection_name,
        document_id=document.id,
        filename=document.filename,
        uploaded_at=document.uploaded_at,
        updated_at=document.updated_at,
        description=document.description or "",
        chunks=chunks,
    )
    kb_persistence.set_document_chunk_count(collection_id, document.id, len(chunks))


def _refresh_catalog_enrichment(collection_id: str) -> list:
    """Re-runs whenever any document in the collection changes. If there's
    no catalog document, this is just drift-free -- returns no warnings and
    touches nothing, matching "not every collection has one" from the plan.
    Catalog replace has the wider blast radius described in the plan
    because THIS function re-parses the catalog and re-applies its rows to
    every document it references, not just the catalog's own chunks."""
    documents = kb_persistence.list_documents(collection_id)
    catalog_doc = next((d for d in documents if d.is_catalog), None)
    if catalog_doc is None:
        return []

    catalog_content = kb_persistence.load_document_content(collection_id, catalog_doc.id)
    entries = parse_catalog_tables(catalog_content)
    matched = match_entries_to_documents(entries, documents)

    for doc in documents:
        description = matched.get(doc.id)
        if description and description != doc.description:
            kb_persistence.set_document_description(collection_id, doc.id, description)
            kb_vector_store.update_document_description(collection_id, doc.id, description)

    return detect_drift(entries, documents)


def _collection_detail(collection_id: str) -> KbCollectionDetail:
    meta = kb_persistence.get_collection(collection_id)
    documents = kb_persistence.list_documents(collection_id)
    warnings = _refresh_catalog_enrichment(collection_id)
    # Re-read documents -- _refresh_catalog_enrichment may have just updated descriptions.
    documents = kb_persistence.list_documents(collection_id)
    return KbCollectionDetail(meta=meta, documents=documents, drift_warnings=warnings)


def _require_collection(collection_id: str) -> None:
    if not kb_persistence.collection_exists(collection_id):
        raise HTTPException(status_code=404, detail="Collection not found.")


@router.get("/collections", response_model=list[KbCollectionMeta])
def api_list_collections():
    return kb_persistence.list_collections()


@router.post("/collections", response_model=KbCollectionMeta)
def api_create_collection(request: CreateCollectionRequest):
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Collection name is required.")
    return kb_persistence.create_collection(name)


@router.get("/collections/{collection_id}", response_model=KbCollectionDetail)
def api_get_collection(collection_id: str):
    _require_collection(collection_id)
    return _collection_detail(collection_id)


@router.patch("/collections/{collection_id}", response_model=KbCollectionMeta)
def api_rename_collection(collection_id: str, request: RenameCollectionRequest):
    _require_collection(collection_id)
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Collection name is required.")
    return kb_persistence.rename_collection(collection_id, name)


@router.delete("/collections/{collection_id}")
def api_delete_collection(collection_id: str):
    _require_collection(collection_id)
    kb_persistence.delete_collection(collection_id)
    kb_vector_store.delete_collection_index(collection_id)
    return {"status": "deleted"}


@router.post("/collections/{collection_id}/documents", response_model=KbCollectionDetail)
def api_upload_document(collection_id: str, request: UploadDocumentRequest):
    _require_collection(collection_id)
    filename = request.filename.strip()
    if not filename:
        raise HTTPException(status_code=400, detail="Filename is required.")
    if not filename.lower().endswith(".md"):
        raise HTTPException(
            status_code=400,
            detail="Only .md files are supported in this version of Knowledge Base.",
        )
    if kb_persistence.find_document_by_filename(collection_id, filename) is not None:
        raise HTTPException(
            status_code=409,
            detail=f'"{filename}" already exists in this collection -- use replace instead of uploading again.',
        )

    meta = kb_persistence.get_collection(collection_id)
    document = kb_persistence.save_document(collection_id, filename, request.content, request.is_catalog)
    try:
        _ingest_document(collection_id, meta.name, document, request.content)
    except OpenAIError as exc:
        # The document record is already saved (with chunk_count still 0,
        # its default) -- visible in the list, so a retry is just a
        # replace-with-the-same-content once embeddings are reachable
        # again, not a re-upload from scratch.
        raise HTTPException(status_code=502, detail=f"Embedding provider error: {exc}")
    return _collection_detail(collection_id)


@router.put("/collections/{collection_id}/documents/{document_id}", response_model=KbCollectionDetail)
def api_replace_document(collection_id: str, document_id: str, request: UploadDocumentRequest):
    _require_collection(collection_id)
    meta = kb_persistence.get_collection(collection_id)
    document = kb_persistence.replace_document_content(collection_id, document_id, request.content)
    kb_vector_store.delete_document_chunks(collection_id, document_id)
    try:
        _ingest_document(collection_id, meta.name, document, request.content)
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail=f"Embedding provider error: {exc}")
    return _collection_detail(collection_id)


@router.delete("/collections/{collection_id}/documents/{document_id}", response_model=KbCollectionDetail)
def api_delete_document(collection_id: str, document_id: str):
    _require_collection(collection_id)
    kb_vector_store.delete_document_chunks(collection_id, document_id)
    kb_persistence.delete_document(collection_id, document_id)
    return _collection_detail(collection_id)


@router.post("/search", response_model=KbSearchResponse)
async def api_search(request: KbSearchRequest):
    if not request.collection_ids:
        raise HTTPException(status_code=400, detail="Select at least one collection to search.")
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Enter a question.")

    hits = kb_vector_store.federated_query(request.collection_ids, request.question)

    passages: list[ContextPassage] = []
    seen_sections: set[tuple[str, str]] = set()
    for hit in hits:
        metadata = hit["metadata"]
        section_key = (metadata["document_id"], metadata["heading_path"])
        if section_key in seen_sections:
            continue
        seen_sections.add(section_key)
        expanded = kb_vector_store.expand_to_parent_section(
            metadata["collection_id"], metadata["document_id"], metadata["heading_path"]
        )
        passages.append(
            ContextPassage(
                document_id=metadata["document_id"],
                collection_id=metadata["collection_id"],
                collection_name=metadata["collection_name"],
                filename=metadata["filename"],
                heading_path=metadata["heading_path"],
                text=expanded or hit["text"],
            )
        )

    try:
        return await answer_question(request.question, passages)
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail=f"LLM provider error: {exc}")
