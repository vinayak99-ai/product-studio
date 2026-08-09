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

// Mirrors the backend's slugify in routes/design_thinking.py -- keep the two
// in sync if either changes. The download's actual filename comes from this
// (the `download` attribute on a blob URL always wins over whatever
// Content-Disposition the response carried), so the server-side version is
// only what a direct API caller (not this browser flow) would see.
function slugify(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return slug || 'design-thinking'
}

async function downloadExport(path: string, session: DesignThinkingSession, extension: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
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
  link.download = `${slugify(session.problem_area)}.${extension}`
  link.click()
  URL.revokeObjectURL(url)
}

export function exportDesignThinkingMarkdown(session: DesignThinkingSession): Promise<void> {
  return downloadExport('/api/design-thinking/export', session, 'md')
}

// Plain semantic HTML (headers, bullets, bold) -- meant to be opened in a
// browser and copy-pasted into a rich-text editor like Confluence, which
// picks up the tags directly rather than needing Markdown syntax cleaned up
// by hand.
export function exportDesignThinkingHtml(session: DesignThinkingSession): Promise<void> {
  return downloadExport('/api/design-thinking/export/html', session, 'html')
}
