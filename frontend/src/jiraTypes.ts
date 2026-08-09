export interface JiraConnectionMeta {
  id: string
  name: string
  base_url: string
  email: string
  project_key: string
  created_at: string
  updated_at: string
  last_synced_at: string | null
  issue_count: number
  truncated: boolean
}

export interface JiraIssueRef {
  key: string
  title: string
  description: string
  issue_type: string
  status: string | null
  assignee: string | null
  priority: string | null
  labels: string[]
  story_points: number | null
  sprint: string | null
  updated: string | null
}

export interface JiraEpicSnapshot {
  key: string
  title: string
  description: string
  status: string | null
  stories: JiraIssueRef[]
}

export interface JiraProjectSnapshot {
  fetched_at: string
  epics: JiraEpicSnapshot[]
  other_issues: JiraIssueRef[]
}

export interface JiraConnectionDetail {
  meta: JiraConnectionMeta
  snapshot: JiraProjectSnapshot | null
}

export interface SpecBuilderProjectOption {
  id: string
  name: string
}

export interface AttachToSpecBuilderResponse {
  new_epics: number
  new_stories: number
  unmapped_requirements: string[]
}

export interface CreateJiraConnectionInput {
  name: string
  base_url: string
  email: string
  api_token: string
  project_key: string
}
