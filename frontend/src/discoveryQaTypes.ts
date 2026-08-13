export interface DiscoveryQuestion {
  id: string
  text: string
  answer: string
  enriched_answer: string
}

export interface CandidateQuestion {
  id: string
  text: string
  rationale: string
}

export interface CandidateQuestionsResponse {
  candidates: CandidateQuestion[]
}

export interface DiscoverySessionMeta {
  id: string
  name: string
  source_project_id: string
  source_project_name: string
  created_at: string
  updated_at: string
  question_count: number
  answered_count: number
  is_enriched: boolean
}

export interface DiscoverySessionDetail {
  meta: DiscoverySessionMeta
  questions: DiscoveryQuestion[]
  notes: string
  enriched_notes: string
}

export interface DiscoverySourceProject {
  id: string
  name: string
  has_prd: boolean
}
