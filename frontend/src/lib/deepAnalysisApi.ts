import type {
  ArtifactVersionMeta,
  DeepAnalysisDocument,
  DeepAnalysisInput,
  GenerateResponse,
  ProjectListItem,
  ProjectMeta,
} from '../deepAnalysisTypes'

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

export function createProject(name: string): Promise<ProjectMeta> {
  return request('/api/deep-analysis/projects', { method: 'POST', ...json({ name }) })
}

export function listProjects(): Promise<ProjectListItem[]> {
  return request('/api/deep-analysis/projects')
}

export function getProject(id: string): Promise<ProjectMeta> {
  return request(`/api/deep-analysis/projects/${id}`)
}

export function renameProject(id: string, name: string): Promise<ProjectMeta> {
  return request(`/api/deep-analysis/projects/${id}`, { method: 'PATCH', ...json({ name }) })
}

export async function deleteProject(id: string): Promise<void> {
  await request(`/api/deep-analysis/projects/${id}`, { method: 'DELETE' })
}

export function getInput(id: string): Promise<DeepAnalysisInput> {
  return request(`/api/deep-analysis/projects/${id}/input`)
}

export function saveInput(id: string, rawNotes: string): Promise<DeepAnalysisInput> {
  return request(`/api/deep-analysis/projects/${id}/input`, { method: 'PUT', ...json({ raw_notes: rawNotes }) })
}

export function getGenerationStatus(id: string): Promise<{ stage: string | null }> {
  return request(`/api/deep-analysis/projects/${id}/generation-status`)
}

export interface DocumentResponse {
  artifact_id: string | null
  document: DeepAnalysisDocument | null
}

export function getDocument(id: string): Promise<DocumentResponse> {
  return request(`/api/deep-analysis/projects/${id}/document`)
}

export function listVersions(id: string, artifactId: string): Promise<ArtifactVersionMeta[]> {
  return request(`/api/deep-analysis/projects/${id}/artifacts/${artifactId}/versions`)
}

export function getVersion(id: string, artifactId: string, version: number): Promise<DeepAnalysisDocument> {
  return request(`/api/deep-analysis/projects/${id}/artifacts/${artifactId}/versions/${version}`)
}

export async function updateArtifact(id: string, artifactId: string, document: DeepAnalysisDocument): Promise<void> {
  await request(`/api/deep-analysis/projects/${id}/artifacts/${artifactId}`, { method: 'PUT', ...json(document) })
}

export function generate(id: string, rawNotes: string): Promise<GenerateResponse> {
  return request(`/api/deep-analysis/projects/${id}/generate`, { method: 'POST', ...json({ raw_notes: rawNotes }) })
}

export function regenerate(id: string): Promise<GenerateResponse> {
  return request(`/api/deep-analysis/projects/${id}/regenerate`, { method: 'POST' })
}

export function submitClarifications(
  id: string,
  answers: Record<string, string>,
  forceGenerate = false,
): Promise<GenerateResponse> {
  return request(`/api/deep-analysis/projects/${id}/clarify`, {
    method: 'POST',
    ...json({ answers, force_generate: forceGenerate }),
  })
}

// Mirrors the backend's _slug() in routes/deep_analysis.py -- keep the two
// in sync if either changes. The download's actual filename comes from
// this (the `download` attribute on a blob URL always wins over whatever
// Content-Disposition the response carried), so the server-side version is
// only what a direct API caller, not this browser flow, would see.
function slugify(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return slug || 'deep-analysis'
}

async function downloadExport(path: string, filename: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST' })
  if (!res.ok) {
    throw new Error(await res.text())
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function exportMarkdown(id: string, artifactId: string, title: string): Promise<void> {
  return downloadExport(`/api/deep-analysis/projects/${id}/artifacts/${artifactId}/export`, `${slugify(title)}.md`)
}

export function exportHtml(id: string, artifactId: string, title: string): Promise<void> {
  return downloadExport(
    `/api/deep-analysis/projects/${id}/artifacts/${artifactId}/export/html`,
    `${slugify(title)}.html`,
  )
}
