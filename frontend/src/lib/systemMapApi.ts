import type {
  ArtifactVersionMeta,
  CentralityResult,
  CycleReport,
  ExtractionDraft,
  MergeCandidate,
  OrphanReport,
  PathResult,
  PiiFlowResult,
  ProjectListItem,
  ProjectMeta,
  SourceDocumentMeta,
  StructuredDocumentRequest,
  SystemMapGraph,
} from '../systemMapTypes'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init)
  if (!res.ok) {
    throw new Error(await res.text())
  }
  return res.json()
}

function json(body: unknown): RequestInit {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

// ---------- Projects ----------

export function listProjects(): Promise<ProjectListItem[]> {
  return request('/api/system-map/projects')
}

export function createProject(name: string): Promise<ProjectMeta> {
  return request('/api/system-map/projects', { method: 'POST', ...json({ name }) })
}

export function getProject(id: string): Promise<ProjectMeta> {
  return request(`/api/system-map/projects/${id}`)
}

export function renameProject(id: string, name: string): Promise<ProjectMeta> {
  return request(`/api/system-map/projects/${id}`, { method: 'PATCH', ...json({ name }) })
}

export async function deleteProject(id: string): Promise<void> {
  await request(`/api/system-map/projects/${id}`, { method: 'DELETE' })
}

// ---------- Documents ----------

export async function uploadDocument(projectId: string, file: File): Promise<SourceDocumentMeta> {
  const formData = new FormData()
  formData.append('file', file)
  return request(`/api/system-map/projects/${projectId}/documents/upload`, { method: 'POST', body: formData })
}

export function uploadStructuredDocument(
  projectId: string,
  doc: StructuredDocumentRequest,
): Promise<SourceDocumentMeta> {
  return request(`/api/system-map/projects/${projectId}/documents/structured`, { method: 'POST', ...json(doc) })
}

export function listDocuments(projectId: string): Promise<SourceDocumentMeta[]> {
  return request(`/api/system-map/projects/${projectId}/documents`)
}

export function getDocument(
  projectId: string,
  documentId: string,
): Promise<{ meta: SourceDocumentMeta; content: string }> {
  return request(`/api/system-map/projects/${projectId}/documents/${documentId}`)
}

export async function deleteDocument(projectId: string, documentId: string): Promise<void> {
  await request(`/api/system-map/projects/${projectId}/documents/${documentId}`, { method: 'DELETE' })
}

// ---------- Extraction (Review point 1) ----------

export function extractDocument(projectId: string, documentId: string): Promise<ExtractionDraft> {
  return request(`/api/system-map/projects/${projectId}/documents/${documentId}/extract`, { method: 'POST' })
}

export function getExtraction(projectId: string, documentId: string): Promise<ExtractionDraft> {
  return request(`/api/system-map/projects/${projectId}/documents/${documentId}/extraction`)
}

export function updateExtraction(
  projectId: string,
  documentId: string,
  draft: ExtractionDraft,
): Promise<ExtractionDraft> {
  return request(`/api/system-map/projects/${projectId}/documents/${documentId}/extraction`, {
    method: 'PUT',
    ...json(draft),
  })
}

export function confirmExtraction(projectId: string, documentId: string): Promise<ExtractionDraft> {
  return request(`/api/system-map/projects/${projectId}/documents/${documentId}/extraction/confirm`, {
    method: 'POST',
  })
}

// ---------- Merge candidates (Review point 2) ----------

export function suggestMergeCandidates(projectId: string): Promise<MergeCandidate[]> {
  return request(`/api/system-map/projects/${projectId}/merge-candidates/suggest`, { method: 'POST' })
}

export function listMergeCandidates(projectId: string): Promise<MergeCandidate[]> {
  return request(`/api/system-map/projects/${projectId}/merge-candidates`)
}

export function decideMergeCandidate(
  projectId: string,
  candidateId: string,
  decision: 'merge' | 'keep_separate',
): Promise<MergeCandidate[]> {
  return request(`/api/system-map/projects/${projectId}/merge-candidates/${candidateId}`, {
    method: 'PUT',
    ...json({ decision }),
  })
}

// ---------- Graph build + confirm (Review points 3-5) ----------

export function buildGraph(projectId: string, documentIds?: string[]): Promise<SystemMapGraph> {
  return request(`/api/system-map/projects/${projectId}/graph/build`, {
    method: 'POST',
    ...json({ document_ids: documentIds ?? null }),
  })
}

export function confirmGraph(projectId: string, graph: SystemMapGraph, reason = 'confirmed'): Promise<SystemMapGraph> {
  return request(`/api/system-map/projects/${projectId}/graph/confirm`, { method: 'POST', ...json({ graph, reason }) })
}

export function getGraph(projectId: string): Promise<SystemMapGraph> {
  return request(`/api/system-map/projects/${projectId}/graph`)
}

export function updateGraph(projectId: string, graph: SystemMapGraph): Promise<SystemMapGraph> {
  return request(`/api/system-map/projects/${projectId}/graph`, { method: 'PUT', ...json(graph) })
}

export function listGraphVersions(projectId: string): Promise<{ versions: ArtifactVersionMeta[] }> {
  return request(`/api/system-map/projects/${projectId}/graph/versions`)
}

export function getGraphVersion(projectId: string, version: number): Promise<SystemMapGraph> {
  return request(`/api/system-map/projects/${projectId}/graph/versions/${version}`)
}

// ---------- Analysis (NetworkX, confirmed graph only) ----------

export function analyzePii(projectId: string, field: string): Promise<PiiFlowResult> {
  const params = new URLSearchParams({ field })
  return request(`/api/system-map/projects/${projectId}/graph/analysis/pii?${params}`)
}

export function analyzeCycles(projectId: string): Promise<CycleReport> {
  return request(`/api/system-map/projects/${projectId}/graph/analysis/cycles`)
}

export function analyzeOrphans(projectId: string): Promise<OrphanReport> {
  return request(`/api/system-map/projects/${projectId}/graph/analysis/orphans`)
}

export function analyzePaths(
  projectId: string,
  source: string,
  target: string,
  cutoff?: number,
): Promise<PathResult> {
  const params = new URLSearchParams({ source, target })
  if (cutoff !== undefined) params.set('cutoff', String(cutoff))
  return request(`/api/system-map/projects/${projectId}/graph/analysis/paths?${params}`)
}

export function analyzeCentrality(projectId: string): Promise<CentralityResult> {
  return request(`/api/system-map/projects/${projectId}/graph/analysis/centrality`)
}

// ---------- Export (client-only, no backend round trip -- the graph is
// already in hand after a fetch, same approach as knowledgeBaseApi.ts's
// downloadAnswerAsMarkdown) ----------

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function downloadBlob(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

// RFC 4180: quote a field only when it contains a comma, quote, or newline;
// double up any embedded quotes.
function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(',')
}

export function downloadGraphJson(projectName: string, graph: SystemMapGraph): void {
  downloadBlob(`${slugify(projectName)}-system-map.json`, JSON.stringify(graph, null, 2), 'application/json')
}

export function downloadGraphNodesCsv(projectName: string, graph: SystemMapGraph): void {
  const lines = [csvRow(['id', 'name', 'type', 'owning_team', 'criticality', 'aliases'])]
  for (const n of graph.nodes) {
    lines.push(csvRow([n.id, n.name, n.type, n.owning_team, n.criticality, n.aliases.join('; ')]))
  }
  downloadBlob(`${slugify(projectName)}-system-map-nodes.csv`, lines.join('\r\n'), 'text/csv')
}

export function downloadGraphEdgesCsv(projectName: string, graph: SystemMapGraph): void {
  const nameById = new Map(graph.nodes.map((n) => [n.id, n.name]))
  const lines = [
    csvRow(['id', 'source', 'target', 'fields', 'pii_fields', 'transport', 'frequency', 'format', 'purpose']),
  ]
  for (const e of graph.edges) {
    lines.push(
      csvRow([
        e.id,
        nameById.get(e.source_system_id) ?? e.source_system_id,
        nameById.get(e.target_system_id) ?? e.target_system_id,
        e.fields.join('; '),
        e.pii_fields.join('; '),
        e.transport,
        e.frequency,
        e.format,
        e.purpose,
      ]),
    )
  }
  downloadBlob(`${slugify(projectName)}-system-map-edges.csv`, lines.join('\r\n'), 'text/csv')
}
