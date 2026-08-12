from __future__ import annotations

from pydantic import BaseModel, Field

# Names/roles come from docs/knowledge-base/PLAN.md. Firm Context is the
# always-on, cross-project reference collection (is_default_included=True);
# the other two are project-specific and start with no special behavior.
SEED_COLLECTIONS = ["Firm Context", "Project Context", "Systems Info"]
SEED_DEFAULT_INCLUDED = {"Firm Context"}


class KbCollectionMeta(BaseModel):
    id: str
    name: str
    created_at: str
    updated_at: str
    document_count: int = 0
    # Pre-checked in the multi-collection search picker -- data-driven so any
    # future collection can opt into "always search this too," not a
    # hardcoded name check anywhere in the code that uses it.
    is_default_included: bool = False


class KbDocumentMeta(BaseModel):
    id: str
    collection_id: str
    filename: str
    is_catalog: bool = False
    uploaded_at: str
    updated_at: str
    # Filled in from a catalog row that references this document, if any.
    description: str | None = None
    chunk_count: int = 0


class KbChunkMetadata(BaseModel):
    """What actually rides along on every chunk stored in Chroma. Chroma
    metadata values must be str/int/float/bool (no None, no nested
    structures) -- see kb_vector_store.py's to_chroma_dict/from_chroma_dict
    for how this gets serialized around that constraint."""

    document_id: str
    filename: str
    collection_id: str
    collection_name: str
    heading_path: str = ""
    description: str = ""
    chunk_index: int
    uploaded_at: str
    updated_at: str


class CreateCollectionRequest(BaseModel):
    name: str


class RenameCollectionRequest(BaseModel):
    name: str


class UploadDocumentRequest(BaseModel):
    filename: str
    content: str
    is_catalog: bool = False


class KbSearchRequest(BaseModel):
    collection_ids: list[str]
    question: str


class KbCitation(BaseModel):
    document_id: str
    collection_id: str
    filename: str
    collection_name: str
    heading_path: str = ""
    snippet: str


class KbSearchResponse(BaseModel):
    answer_markdown: str
    citations: list[KbCitation] = Field(default_factory=list)


class KbDriftWarning(BaseModel):
    kind: str  # "catalog_row_missing_document" | "document_not_in_catalog"
    detail: str


class KbCollectionDetail(BaseModel):
    meta: KbCollectionMeta
    documents: list[KbDocumentMeta] = Field(default_factory=list)
    drift_warnings: list[KbDriftWarning] = Field(default_factory=list)
