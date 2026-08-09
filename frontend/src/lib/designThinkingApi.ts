import type {
  AnsweredClarification,
  ConceptBrief,
  ConceptSpark,
  DefineResult,
  DesignThinkingSession,
  EmpathizeResult,
  HowMightWe,
  IdeateHmwResult,
  Persona,
  PrototypeResult,
  ProblemStatement,
  TestResult,
  ValidationPlan,
} from '../designThinkingTypes'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(await res.text())
  }
  return res.json()
}

// The five clarify-enabled generation calls all take the same trailing
// (clarifications, round, forceGenerate) triple -- the state the
// useClarifyingGenerate hook (see lib/useClarifyingGenerate.ts) accumulates
// across rounds -- and resolve to a ClarifyOutcome the hook can branch on.

export function generatePersonas(
  material: string,
  prompt: string,
  clarifications: AnsweredClarification[],
  round: number,
  forceGenerate: boolean,
): Promise<EmpathizeResult> {
  return post('/api/design-thinking/empathize', {
    material,
    prompt,
    clarifications,
    round,
    force_generate: forceGenerate,
  })
}

export function generateProblemStatements(
  personas: Persona[],
  prompt: string,
  clarifications: AnsweredClarification[],
  round: number,
  forceGenerate: boolean,
): Promise<DefineResult> {
  return post('/api/design-thinking/define', {
    personas,
    prompt,
    clarifications,
    round,
    force_generate: forceGenerate,
  })
}

export function generateHowMightWe(
  problem_statements: ProblemStatement[],
  prompt: string,
  clarifications: AnsweredClarification[],
  round: number,
  forceGenerate: boolean,
): Promise<IdeateHmwResult> {
  return post('/api/design-thinking/ideate/how-might-we', {
    problem_statements,
    prompt,
    clarifications,
    round,
    force_generate: forceGenerate,
  })
}

export function generateConceptSparks(
  how_might_we: HowMightWe[],
  prompt: string,
): Promise<{ concept_sparks: ConceptSpark[] }> {
  return post('/api/design-thinking/ideate/concept-sparks', { how_might_we, prompt })
}

export function generateConceptBriefs(
  concept_sparks: ConceptSpark[],
  prompt: string,
  clarifications: AnsweredClarification[],
  round: number,
  forceGenerate: boolean,
): Promise<PrototypeResult> {
  return post('/api/design-thinking/prototype', {
    concept_sparks,
    prompt,
    clarifications,
    round,
    force_generate: forceGenerate,
  })
}

export function generateValidationPlans(
  concept_briefs: ConceptBrief[],
  prompt: string,
  clarifications: AnsweredClarification[],
  round: number,
  forceGenerate: boolean,
): Promise<TestResult> {
  return post('/api/design-thinking/test', {
    concept_briefs,
    prompt,
    clarifications,
    round,
    force_generate: forceGenerate,
  })
}

export async function exportDesignThinkingMarkdown(session: DesignThinkingSession): Promise<void> {
  const res = await fetch(`${API_BASE}/api/design-thinking/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  })
  if (!res.ok) {
    throw new Error(await res.text())
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'design-thinking.md'
  link.click()
  URL.revokeObjectURL(url)
}
