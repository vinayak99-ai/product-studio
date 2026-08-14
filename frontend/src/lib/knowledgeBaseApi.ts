import type { KbCollectionDetail, KbCollectionMeta, KbGoalResponse, KbSearchResponse } from '../knowledgeBaseTypes'

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

export function listCollections(): Promise<KbCollectionMeta[]> {
  return request('/api/kb/collections')
}

export function createCollection(name: string): Promise<KbCollectionMeta> {
  return request('/api/kb/collections', { method: 'POST', ...json({ name }) })
}

export function getCollection(id: string): Promise<KbCollectionDetail> {
  return request(`/api/kb/collections/${id}`)
}

export function renameCollection(id: string, name: string): Promise<KbCollectionMeta> {
  return request(`/api/kb/collections/${id}`, { method: 'PATCH', ...json({ name }) })
}

export async function deleteCollection(id: string): Promise<void> {
  await request(`/api/kb/collections/${id}`, { method: 'DELETE' })
}

export function uploadDocument(
  collectionId: string,
  filename: string,
  content: string,
  isCatalog: boolean,
): Promise<KbCollectionDetail> {
  return request(`/api/kb/collections/${collectionId}/documents`, {
    method: 'POST',
    ...json({ filename, content, is_catalog: isCatalog }),
  })
}

export function replaceDocument(
  collectionId: string,
  documentId: string,
  filename: string,
  content: string,
  isCatalog: boolean,
): Promise<KbCollectionDetail> {
  return request(`/api/kb/collections/${collectionId}/documents/${documentId}`, {
    method: 'PUT',
    ...json({ filename, content, is_catalog: isCatalog }),
  })
}

export function deleteDocument(collectionId: string, documentId: string): Promise<KbCollectionDetail> {
  return request(`/api/kb/collections/${collectionId}/documents/${documentId}`, { method: 'DELETE' })
}

export function search(collectionIds: string[], question: string): Promise<KbSearchResponse> {
  return request('/api/kb/search', {
    method: 'POST',
    ...json({ collection_ids: collectionIds, question }),
  })
}

export function runGoal(goal: string): Promise<KbGoalResponse> {
  return request('/api/kb/goal', { method: 'POST', ...json({ goal }) })
}

// Independent-copy slugify -- same pattern as lib/api.ts's export functions,
// kept in sync by convention rather than a shared import.
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

// Client-only, no backend round trip -- the answer and citations are already
// in hand after a search, same approach as lib/api.ts's exportDiagramSlideSvg.
export function downloadAnswerAsMarkdown(question: string, result: KbSearchResponse): void {
  const lines = [`# ${question}`, '', result.answer_markdown]
  if (result.citations.length > 0) {
    lines.push('', '## Sources', '')
    for (const c of result.citations) {
      const where = c.heading_path ? `${c.collection_name} — ${c.heading_path}` : c.collection_name
      lines.push(`- **${c.filename}** (${where})`, `  ${c.snippet}`)
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${slugify(question)}.md`
  link.click()
  URL.revokeObjectURL(url)
}
