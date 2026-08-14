from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from openai import OpenAIError

from app import kb_agent, kb_persistence, kb_vector_store
from app.kb_catalog import detect_drift, match_entries_to_documents, parse_catalog_tables
from app.kb_chunking import chunk_markdown
from app.kb_llm import ContextPassage, answer_question
from app.kb_models import (
    CreateCollectionRequest,
    KbCollectionDetail,
    KbCollectionMeta,
    KbDocumentMeta,
    KbGoalRequest,
    KbGoalResponse,
    KbSearchRequest,
    KbSearchResponse,
    RenameCollectionRequest,
    UploadDocumentRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/kb")


def _ingest_document(
    collection_id: str, collection_name: str, document: KbDocumentMeta, content: str
) -> None:
    logger.info("_ingest_document: chunking %r (%d chars)", document.filename, len(content))
    chunks = chunk_markdown(content)
    logger.info("_ingest_document: %r produced %d chunk(s)", document.filename, len(chunks))
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
    logger.info("_ingest_document: finished %r", document.filename)


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
    logger.info(
        "_refresh_catalog_enrichment: collection=%s catalog=%r, %d entries parsed, %d matched",
        collection_id,
        catalog_doc.filename,
        len(entries),
        len(matched),
    )

    updated_count = 0
    for doc in documents:
        description = matched.get(doc.id)
        if description and description != doc.description:
            kb_persistence.set_document_description(collection_id, doc.id, description)
            kb_vector_store.update_document_description(collection_id, doc.id, description)
            updated_count += 1
    if updated_count:
        logger.info("_refresh_catalog_enrichment: updated descriptions for %d document(s)", updated_count)

    warnings = detect_drift(entries, documents)
    if warnings:
        logger.info("_refresh_catalog_enrichment: %d drift warning(s)", len(warnings))
    return warnings


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
    collections = kb_persistence.list_collections()
    logger.info("list_collections: %d collection(s)", len(collections))
    return collections


@router.post("/collections", response_model=KbCollectionMeta)
def api_create_collection(request: CreateCollectionRequest):
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Collection name is required.")
    meta = kb_persistence.create_collection(name)
    logger.info("create_collection: created %r (id=%s)", name, meta.id)
    return meta


@router.get("/collections/{collection_id}", response_model=KbCollectionDetail)
def api_get_collection(collection_id: str):
    logger.info("get_collection: collection=%s", collection_id)
    _require_collection(collection_id)
    return _collection_detail(collection_id)


@router.patch("/collections/{collection_id}", response_model=KbCollectionMeta)
def api_rename_collection(collection_id: str, request: RenameCollectionRequest):
    _require_collection(collection_id)
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Collection name is required.")
    logger.info("rename_collection: collection=%s -> %r", collection_id, name)
    return kb_persistence.rename_collection(collection_id, name)


@router.delete("/collections/{collection_id}")
def api_delete_collection(collection_id: str):
    logger.info("delete_collection: collection=%s", collection_id)
    _require_collection(collection_id)
    kb_persistence.delete_collection(collection_id)
    kb_vector_store.delete_collection_index(collection_id)
    logger.info("delete_collection: done for collection=%s", collection_id)
    return {"status": "deleted"}


@router.post("/collections/{collection_id}/documents", response_model=KbCollectionDetail)
def api_upload_document(collection_id: str, request: UploadDocumentRequest):
    logger.info(
        "upload_document: collection=%s filename=%r is_catalog=%s (%d chars)",
        collection_id,
        request.filename,
        request.is_catalog,
        len(request.content),
    )
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
    logger.info("upload_document: metadata saved for %r (document=%s), starting ingestion", filename, document.id)
    try:
        _ingest_document(collection_id, meta.name, document, request.content)
    except OpenAIError as exc:
        # The document record is already saved (with chunk_count still 0,
        # its default) -- visible in the list, so a retry is just a
        # replace-with-the-same-content once embeddings are reachable
        # again, not a re-upload from scratch.
        logger.exception("upload_document: embedding provider error for %r", filename)
        raise HTTPException(status_code=502, detail=f"Embedding provider error: {exc}")
    except Exception:
        # Anything else -- e.g. a ChromaDB-internal error not wrapped as
        # OpenAIError -- still gets a proper logged traceback and a real
        # HTTP response instead of silently falling through as an
        # unhandled 500 with no KB-specific context.
        logger.exception("upload_document: unexpected error ingesting %r", filename)
        raise HTTPException(status_code=500, detail=f'Failed to process "{filename}" -- see backend logs for details.')
    logger.info("upload_document: complete for %r", filename)
    return _collection_detail(collection_id)


@router.put("/collections/{collection_id}/documents/{document_id}", response_model=KbCollectionDetail)
def api_replace_document(collection_id: str, document_id: str, request: UploadDocumentRequest):
    logger.info(
        "replace_document: collection=%s document=%s filename=%r (%d chars)",
        collection_id,
        document_id,
        request.filename,
        len(request.content),
    )
    _require_collection(collection_id)
    meta = kb_persistence.get_collection(collection_id)
    document = kb_persistence.replace_document_content(collection_id, document_id, request.content)
    kb_vector_store.delete_document_chunks(collection_id, document_id)
    try:
        _ingest_document(collection_id, meta.name, document, request.content)
    except OpenAIError as exc:
        logger.exception("replace_document: embedding provider error for %r", request.filename)
        raise HTTPException(status_code=502, detail=f"Embedding provider error: {exc}")
    except Exception:
        logger.exception("replace_document: unexpected error ingesting %r", request.filename)
        raise HTTPException(
            status_code=500, detail=f'Failed to process "{request.filename}" -- see backend logs for details.'
        )
    logger.info("replace_document: complete for %r", request.filename)
    return _collection_detail(collection_id)


@router.delete("/collections/{collection_id}/documents/{document_id}", response_model=KbCollectionDetail)
def api_delete_document(collection_id: str, document_id: str):
    logger.info("delete_document: collection=%s document=%s", collection_id, document_id)
    _require_collection(collection_id)
    kb_vector_store.delete_document_chunks(collection_id, document_id)
    kb_persistence.delete_document(collection_id, document_id)
    logger.info("delete_document: done for document=%s", document_id)
    return _collection_detail(collection_id)


@router.post("/search", response_model=KbSearchResponse)
async def api_search(request: KbSearchRequest):
    logger.info(
        "search: %d collection(s), question=%r", len(request.collection_ids), request.question
    )
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
    logger.info("search: %d passage(s) after dedup, calling LLM", len(passages))

    try:
        result = await answer_question(request.question, passages)
    except OpenAIError as exc:
        logger.exception("search: LLM provider error")
        raise HTTPException(status_code=502, detail=f"LLM provider error: {exc}")
    except Exception:
        logger.exception("search: unexpected error answering question")
        raise HTTPException(status_code=500, detail="Failed to answer the question -- see backend logs for details.")
    logger.info("search: complete, %d citation(s)", len(result.citations))
    return result


@router.post("/goal", response_model=KbGoalResponse)
async def api_goal(request: KbGoalRequest):
    goal = request.goal.strip()
    logger.info("goal: %r", goal)
    if not goal:
        raise HTTPException(status_code=400, detail="Enter a goal.")

    collection_ids = [c.id for c in kb_persistence.list_collections()]
    if not collection_ids:
        raise HTTPException(status_code=400, detail="No collections exist yet -- create one and add documents first.")

    try:
        result = await kb_agent.run_goal(goal, collection_ids)
    except OpenAIError as exc:
        logger.exception("goal: LLM provider error")
        raise HTTPException(status_code=502, detail=f"LLM provider error: {exc}")
    except Exception:
        logger.exception("goal: unexpected error")
        raise HTTPException(status_code=500, detail="Failed to work through the goal -- see backend logs for details.")
    logger.info("goal: complete, rounds=%d, gaps=%d", result.rounds_run, len(result.gaps))
    return result
