export interface Voice {
  name: string
  role: string
  input: string
}

export interface Persona {
  name: string
  context: string
  goals: string[]
  pains: string[]
  behaviors: string[]
  voices: Voice[]
}

export interface ProblemStatement {
  persona_name: string
  user: string
  need: string
  insight: string
  assembled: string
}

export interface HowMightWe {
  question: string
  rationale: string
  selected: boolean
}

export interface ConceptSpark {
  how_might_we: string
  idea: string
  is_wildcard: boolean
  selected: boolean
}

export interface ConceptBrief {
  concept_name: string
  description: string
  key_interactions: string[]
  assumptions: string[]
  biggest_risk: string
}

export interface ValidationPlan {
  concept_name: string
  hypotheses: string[]
  success_signal: string
  risk_if_wrong: string
}

// ---------- Clarify Agent: shared across every stage's primary generation ----------
// Mirrors backend/app/design_thinking_models.py's clarify shapes and budget
// constants. Design Thinking has no server-side persistence, so this state
// lives entirely in each stage component (via useClarifyingGenerate) rather
// than being tracked by the backend.

export const CLARIFY_ROUND_SIZE = 3
export const CLARIFY_MAX_ROUNDS = 2

export interface ClarifyQuestion {
  id: string
  question: string
  options: string[]
  recommended: string | null
}

export interface AnsweredClarification {
  question: ClarifyQuestion
  answer: string
}

// Each stage's primary generation resolves to one of these -- a
// status-discriminated union so a caller can `if (result.status ===
// 'needs_clarification')` and get the right payload narrowed for free.
export type ClarifyOutcome<TGenerated> =
  | { status: 'needs_clarification'; questions: ClarifyQuestion[] }
  | ({ status: 'generated'; questions: ClarifyQuestion[] } & TGenerated)

export type EmpathizeResult = ClarifyOutcome<{ personas: Persona[] }>
export type DefineResult = ClarifyOutcome<{ problem_statements: ProblemStatement[] }>
export type IdeateHmwResult = ClarifyOutcome<{ how_might_we: HowMightWe[] }>
export type PrototypeResult = ClarifyOutcome<{ concept_briefs: ConceptBrief[] }>
export type TestResult = ClarifyOutcome<{ validation_plans: ValidationPlan[] }>

export interface DesignThinkingSession {
  problem_area: string
  personas: Persona[]
  problem_statements: ProblemStatement[]
  how_might_we: HowMightWe[]
  concept_sparks: ConceptSpark[]
  concept_briefs: ConceptBrief[]
  validation_plans: ValidationPlan[]
}

export const EMPTY_SESSION: DesignThinkingSession = {
  problem_area: '',
  personas: [],
  problem_statements: [],
  how_might_we: [],
  concept_sparks: [],
  concept_briefs: [],
  validation_plans: [],
}

export type DesignThinkingStage = 'empathize' | 'define' | 'ideate' | 'prototype' | 'test'

export const STAGES: { id: DesignThinkingStage; label: string }[] = [
  { id: 'empathize', label: 'Empathize' },
  { id: 'define', label: 'Define' },
  { id: 'ideate', label: 'Ideate' },
  { id: 'prototype', label: 'Prototype' },
  { id: 'test', label: 'Test' },
]
