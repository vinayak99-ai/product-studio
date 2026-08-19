export type SystemType = 'transfer_agent' | 'accounting' | 'custodian' | 'payment_processor' | 'compliance' | 'other'
export type Criticality = 'high' | 'medium' | 'low'

export interface ProjectMeta {
  id: string
  name: string
  created_at: string
  updated_at: string
}

export interface ProjectSummary {
  document_count: number
  reviewed_document_count: number
  pending_merge_decisions: number
  confirmed_node_count: number
  confirmed_edge_count: number
}

export interface ProjectListItem extends ProjectMeta {
  summary: ProjectSummary
}

export interface SourceCitation {
  document_id: string
  filename: string
  snippet: string
}

export interface SystemNode {
  id: string
  name: string
  type: SystemType
  owning_team: string
  criticality: Criticality
  aliases: string[]
  citations: SourceCitation[]
}

export interface DataFlowEdge {
  id: string
  source_system_id: string
  target_system_id: string
  fields: string[]
  pii_fields: string[]
  transport: string
  frequency: string
  format: string
  purpose: string
  citations: SourceCitation[]
}

export interface SystemMapGraph {
  nodes: SystemNode[]
  edges: DataFlowEdge[]
}

export interface ArtifactVersionMeta {
  version: number
  saved_at: string
  reason: string
}

// "raw" -> goes through LLM extraction; "structured" -> user-supplied JSON,
// ingested directly.
export type DocumentKind = 'raw' | 'structured'
export type ExtractionStatus = 'pending' | 'extracted' | 'reviewed'

export interface SourceDocumentMeta {
  id: string
  filename: string
  uploaded_at: string
  kind: DocumentKind
  extraction_status: ExtractionStatus
}

export interface ExtractedNodeDraft {
  name: string
  type: SystemType
  owning_team: string
  criticality: Criticality
  citation: SourceCitation
}

export interface ExtractedEdgeDraft {
  source_system_name: string
  target_system_name: string
  fields: string[]
  pii_fields: string[]
  transport: string
  frequency: string
  format: string
  purpose: string
  citation: SourceCitation
}

export interface ExtractionDraft {
  document_id: string
  nodes: ExtractedNodeDraft[]
  edges: ExtractedEdgeDraft[]
  reviewed: boolean
}

export interface MergeCandidate {
  id: string
  node_a_name: string
  node_b_name: string
  confidence: 'high' | 'medium' | 'low'
  rationale: string
  // null while awaiting a human decision -- never auto-applied.
  decision: 'merge' | 'keep_separate' | null
}

export interface PiiFlowResult {
  field: string
  edges: DataFlowEdge[]
  reachable_system_ids: string[]
}

export interface CycleReport {
  cycles: string[][]
}

export interface OrphanReport {
  isolated_system_ids: string[]
  dangling_edge_ids: string[]
}

export interface PathResult {
  source_system_id: string
  target_system_id: string
  paths: string[][]
}

export interface CentralityResult {
  scores: Record<string, number>
}

// ---------- Structured document ingestion (skips LLM extraction) ----------

export interface StructuredExtractionNode {
  name: string
  type: SystemType
  owning_team: string
  criticality: Criticality
  snippet: string
}

export interface StructuredExtractionEdge {
  source_system_name: string
  target_system_name: string
  fields: string[]
  pii_fields: string[]
  transport: string
  frequency: string
  format: string
  purpose: string
  snippet: string
}

export interface StructuredDocumentRequest {
  filename: string
  nodes: StructuredExtractionNode[]
  edges: StructuredExtractionEdge[]
}
