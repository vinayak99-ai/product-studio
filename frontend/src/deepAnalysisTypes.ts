export const CLARIFY_ROUND_SIZE = 10
export const CLARIFY_MAX_ROUNDS = 10
export const CLARIFY_MAX_TOTAL_QUESTIONS = 100

export interface ClarifyQuestion {
  id: string
  category: string
  question: string
  options: string[]
  recommended: string | null
}

export interface AnsweredClarification {
  question: ClarifyQuestion
  answer: string
}

export interface BackgroundEvent {
  heading: string
  narrative: string
}

export interface PriorAttempt {
  name: string
  description: string
  outcome: string
  lesson: string
}

export interface RootCause {
  cause: string
  evidence: string
}

export interface Consideration {
  heading: string
  detail: string
}

export interface OpenRisk {
  risk: string
  why_it_matters: string
}

export interface DeepAnalysisDocument {
  title: string
  problem_statement: string
  executive_summary: string
  background: BackgroundEvent[]
  prior_attempts: PriorAttempt[]
  root_causes: RootCause[]
  stakeholder_considerations: Consideration[]
  constraints: Consideration[]
  success_definition: string
  open_risks: OpenRisk[]
  recommended_focus_areas: string[]
  clarifications: AnsweredClarification[]
}

export interface ProjectMeta {
  id: string
  name: string
  created_at: string
  updated_at: string
  input_updated_at: string | null
  last_generated_at: string | null
}

export interface ProjectSummary {
  stage: 'empty' | 'clarifying' | 'generated'
  pending_questions: number
  round: number
  questions_used: number
}

export interface ProjectListItem extends ProjectMeta {
  summary: ProjectSummary
}

export interface DeepAnalysisInput {
  raw_notes: string
  clarifications: AnsweredClarification[]
  updated_at: string
}

export interface GenerateResponse {
  status: 'needs_clarification' | 'generated'
  questions: ClarifyQuestion[]
  round: number
  max_rounds: number
  questions_used: number
  max_questions: number
  artifact_id: string | null
  document: DeepAnalysisDocument | null
}

export interface ArtifactVersionMeta {
  version: number
  saved_at: string
  reason: string
}
