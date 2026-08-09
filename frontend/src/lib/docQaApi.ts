import type { AskResponse, DocQaProjectDetail, DocQaProjectMeta } from '../docQaTypes'

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

export function listProjects(): Promise<DocQaProjectMeta[]> {
  return request('/api/doc-qa/projects')
}

export function createProject(name: string): Promise<DocQaProjectMeta> {
  return request('/api/doc-qa/projects', { method: 'POST', ...json({ name }) })
}

export function getProject(id: string): Promise<DocQaProjectDetail> {
  return request(`/api/doc-qa/projects/${id}`)
}

export function renameProject(id: string, name: string): Promise<DocQaProjectMeta> {
  return request(`/api/doc-qa/projects/${id}`, { method: 'PATCH', ...json({ name }) })
}

export async function deleteProject(id: string): Promise<void> {
  await request(`/api/doc-qa/projects/${id}`, { method: 'DELETE' })
}

export async function uploadDocument(id: string, file: File): Promise<DocQaProjectDetail> {
  const formData = new FormData()
  formData.append('file', file)
  return request(`/api/doc-qa/projects/${id}/document`, { method: 'POST', body: formData })
}

export function summarize(id: string, prompt: string): Promise<{ summary: string }> {
  return request(`/api/doc-qa/projects/${id}/summarize`, { method: 'POST', ...json({ prompt }) })
}

export function ask(id: string, question: string): Promise<AskResponse> {
  return request(`/api/doc-qa/projects/${id}/ask`, { method: 'POST', ...json({ question }) })
}
