import type {
  CandidateQuestionsResponse,
  DiscoveryQuestion,
  DiscoverySessionDetail,
  DiscoverySessionMeta,
  DiscoverySourceProject,
} from '../discoveryQaTypes'

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

// The browser's anchor `download` attribute wins over the response's
// Content-Disposition header for a blob: URL download -- same lesson
// learned (and independently re-applied per this backend's convention)
// in Diagram Slides' export, see lib/api.ts.
function slugify(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return slug || 'discovery-qa'
}

export function listSpecProjects(): Promise<DiscoverySourceProject[]> {
  return request('/api/discovery-qa/spec-projects')
}

export function generateCandidates(projectId: string, prompt: string): Promise<CandidateQuestionsResponse> {
  return request('/api/discovery-qa/generate-candidates', {
    method: 'POST',
    ...json({ project_id: projectId, prompt }),
  })
}

export function listSessions(): Promise<DiscoverySessionMeta[]> {
  return request('/api/discovery-qa/sessions')
}

export function createSession(
  name: string,
  sourceProjectId: string,
  questions: DiscoveryQuestion[],
): Promise<DiscoverySessionMeta> {
  return request('/api/discovery-qa/sessions', {
    method: 'POST',
    ...json({ name, source_project_id: sourceProjectId, questions }),
  })
}

export function getSession(id: string): Promise<DiscoverySessionDetail> {
  return request(`/api/discovery-qa/sessions/${id}`)
}

export function renameSession(id: string, name: string): Promise<DiscoverySessionMeta> {
  return request(`/api/discovery-qa/sessions/${id}`, { method: 'PATCH', ...json({ name }) })
}

export async function deleteSession(id: string): Promise<void> {
  await request(`/api/discovery-qa/sessions/${id}`, { method: 'DELETE' })
}

export function updateQuestions(id: string, questions: DiscoveryQuestion[]): Promise<DiscoverySessionDetail> {
  return request(`/api/discovery-qa/sessions/${id}/questions`, { method: 'PUT', ...json({ questions }) })
}

export function saveAnswer(id: string, questionId: string, answer: string): Promise<DiscoverySessionDetail> {
  return request(`/api/discovery-qa/sessions/${id}/questions/${questionId}/answer`, {
    method: 'PATCH',
    ...json({ answer }),
  })
}

export function saveNotes(id: string, notes: string): Promise<DiscoverySessionDetail> {
  return request(`/api/discovery-qa/sessions/${id}/notes`, { method: 'PUT', ...json({ notes }) })
}

export function enrichSession(id: string): Promise<DiscoverySessionDetail> {
  return request(`/api/discovery-qa/sessions/${id}/enrich`, { method: 'POST' })
}

export async function exportSession(id: string, sessionName: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/discovery-qa/sessions/${id}/export`, { method: 'POST' })
  if (!res.ok) {
    throw new Error(await res.text())
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${slugify(sessionName)}.md`
  link.click()
  URL.revokeObjectURL(url)
}
