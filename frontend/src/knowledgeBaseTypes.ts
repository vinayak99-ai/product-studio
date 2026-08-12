export interface KbCollectionMeta {
  id: string
  name: string
  created_at: string
  updated_at: string
  document_count: number
  is_default_included: boolean
}

export interface KbDocumentMeta {
  id: string
  collection_id: string
  filename: string
  is_catalog: boolean
  uploaded_at: string
  updated_at: string
  description: string | null
  chunk_count: number
}

export interface KbDriftWarning {
  kind: 'catalog_row_missing_document' | 'document_not_in_catalog'
  detail: string
}

export interface KbCollectionDetail {
  meta: KbCollectionMeta
  documents: KbDocumentMeta[]
  drift_warnings: KbDriftWarning[]
}

export interface KbCitation {
  document_id: string
  collection_id: string
  filename: string
  collection_name: string
  heading_path: string
  snippet: string
}

export interface KbSearchResponse {
  answer_markdown: string
  citations: KbCitation[]
}
