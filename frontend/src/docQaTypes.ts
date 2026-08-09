export interface DocQaProjectMeta {
  id: string
  name: string
  created_at: string
  updated_at: string
  filename: string | null
  has_summary: boolean
  message_count: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  at: string
}

export interface DocQaProjectDetail {
  meta: DocQaProjectMeta
  summary: string | null
  chat: ChatMessage[]
}

export interface AskResponse {
  answer: string
  chat: ChatMessage[]
}
