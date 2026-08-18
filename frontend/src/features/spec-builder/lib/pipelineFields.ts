import type { GeneratedPRD, StepId } from "./types"

// Mirrors backend/app/spec_builder/main.py's STEP_FIELDS -- the single
// source of truth (there, in Python) for exactly which GeneratedPRD fields
// each pipeline step owns. Kept in sync by hand since the two languages
// can't share one definition; if a field is added to a step server-side,
// add it here too.
export const STEP_FIELDS: Record<StepId, (keyof GeneratedPRD)[]> = {
  overview: ["problem_statement", "goals", "target_users", "open_questions", "personas", "use_cases"],
  stories: ["user_stories", "edge_cases"],
  requirements: ["functional_requirements", "key_entities", "assumptions"],
  test_cases: ["test_cases"],
  architecture: ["architecture_decisions"],
  epics: ["epics"],
}

const ALL_STEP_FIELDS = new Set<keyof GeneratedPRD>(Object.values(STEP_FIELDS).flat())

// Everything NOT owned by any pipeline step (title, diagrams, briefs,
// updates, technical_context, ...) -- always safe to save via the plain
// updateArtifact PUT, regardless of any step's confirmed status.
export function nonStepFields(prd: GeneratedPRD): Partial<GeneratedPRD> {
  const out: Partial<GeneratedPRD> = {}
  for (const key of Object.keys(prd) as (keyof GeneratedPRD)[]) {
    if (!ALL_STEP_FIELDS.has(key)) (out as Record<string, unknown>)[key] = prd[key]
  }
  return out
}

function fieldsDiffer(a: GeneratedPRD, b: GeneratedPRD, fields: (keyof GeneratedPRD)[]): boolean {
  return fields.some((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f]))
}

// Which confirmed steps have field-level changes between two PRD snapshots
// -- these must be saved through POST /steps/{step}/edit (scope check +
// possible cascade), not the plain PUT, which the backend rejects for a
// confirmed step's fields.
export function confirmedStepsChanged(baseline: GeneratedPRD, current: GeneratedPRD): StepId[] {
  return (Object.keys(STEP_FIELDS) as StepId[]).filter((step) => {
    const state = current.pipeline.steps[step]
    if (!state || state.status !== "confirmed") return false
    return fieldsDiffer(baseline, current, STEP_FIELDS[step])
  })
}
