import type { KbCollectionDetail, KbCollectionMeta, KbSearchResponse } from '../knowledgeBaseTypes'

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
