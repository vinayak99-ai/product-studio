import type {
  AttachToSpecBuilderResponse,
  CreateJiraConnectionInput,
  JiraConnectionDetail,
  JiraConnectionMeta,
  SpecBuilderProjectOption,
} from '../jiraTypes'

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

export function testConnection(input: CreateJiraConnectionInput): Promise<{ ok: boolean }> {
  return request('/api/jira/connections/test', { method: 'POST', ...json(input) })
}

export function createConnection(input: CreateJiraConnectionInput): Promise<JiraConnectionMeta> {
  return request('/api/jira/connections', { method: 'POST', ...json(input) })
}

export function listConnections(): Promise<JiraConnectionMeta[]> {
  return request('/api/jira/connections')
}

export function getConnection(id: string): Promise<JiraConnectionDetail> {
  return request(`/api/jira/connections/${id}`)
}

export function renameConnection(id: string, name: string): Promise<JiraConnectionMeta> {
  return request(`/api/jira/connections/${id}`, { method: 'PATCH', ...json({ name }) })
}

export async function deleteConnection(id: string): Promise<void> {
  await request(`/api/jira/connections/${id}`, { method: 'DELETE' })
}

export function pullConnection(id: string): Promise<JiraConnectionDetail> {
  return request(`/api/jira/connections/${id}/pull`, { method: 'POST' })
}

export function listSpecBuilderProjects(connectionId: string): Promise<SpecBuilderProjectOption[]> {
  return request(`/api/jira/connections/${connectionId}/spec-builder-projects`)
}

export function attachToSpecBuilder(
  connectionId: string,
  specProjectId: string,
): Promise<AttachToSpecBuilderResponse> {
  return request(`/api/jira/connections/${connectionId}/attach/${specProjectId}`, { method: 'POST' })
}
