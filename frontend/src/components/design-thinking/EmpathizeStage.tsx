import { useState } from 'react'
import { generatePersonas } from '../../lib/designThinkingApi'
import { useClarifyingGenerate } from '../../lib/useClarifyingGenerate'
import type { Persona } from '../../designThinkingTypes'
import { ClarifyPanel } from './ClarifyPanel'
import { PersonaCard } from './PersonaCard'
import { StageIntroCard } from './StageIntroCard'

interface EmpathizeStageProps {
  personas: Persona[]
  onChange: (personas: Persona[]) => void
  onContinue: () => void
}

export function EmpathizeStage({ personas, onChange, onContinue }: EmpathizeStageProps) {
  const [material, setMaterial] = useState('')
  const [prompt, setPrompt] = useState('')
  const [preflightError, setPreflightError] = useState<string | null>(null)

  const clarify = useClarifyingGenerate<{ personas: Persona[] }>(
    (clarifications, round, forceGenerate) =>
      generatePersonas(material, prompt, clarifications, round, forceGenerate),
    (result) => onChange(result.personas),
  )

  const handleGenerate = () => {
    if (!material.trim()) {
      setPreflightError('Paste some research material first — interview notes, tickets, survey quotes.')
      return
    }
    setPreflightError(null)
    clarify.start()
  }

  const busy = clarify.busy

  const updatePersona = (i: number, persona: Persona) => {
    const next = personas.slice()
    next[i] = persona
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
          Research material
        </h3>
        <p className="mt-1 text-xs text-neutral-500">
          Interview notes, support tickets, survey quotes, observations — whatever real signal you
          have about the people affected by this problem.
        </p>
        <textarea
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
          placeholder="Paste your research material here…"
          className="mt-2 h-32 w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 text-xs text-neutral-900 outline-none focus:border-primary"
        />
        <div className="mt-2 flex items-center gap-2">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Optional focus, e.g. 'Focus on warehouse ops, not customer support.'"
            className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={handleGenerate}
            disabled={busy}
            className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Generating…' : personas.length > 0 ? 'Regenerate personas' : 'Generate personas'}
          </button>
        </div>
        {preflightError ? <p className="mt-2 text-xs text-red-600">{preflightError}</p> : null}
      </div>

      {clarify.questions ? (
        <ClarifyPanel
          stageLabel="personas"
          round={clarify.round}
          questions={clarify.questions}
          answers={clarify.answers}
          onAnswerChange={clarify.setAnswer}
          onSubmit={() => clarify.submit(false)}
          onSkip={() => clarify.submit(true)}
          busy={clarify.busy}
          error={clarify.error}
        />
      ) : null}

      {personas.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {personas.map((persona, i) => (
              <PersonaCard key={i} persona={persona} onChange={(p) => updatePersona(i, p)} />
            ))}
          </div>
          <button
            type="button"
            onClick={onContinue}
            className="self-start rounded-md border border-primary px-4 py-2 text-xs font-semibold text-primary hover:bg-primary-light"
          >
            Continue to Define →
          </button>
        </>
      ) : !clarify.questions ? (
        <StageIntroCard
          title="What Empathize produces"
          steps={[
            '1-3 personas — the real, distinct user types your material actually supports',
            'Each with goals, pains, and behaviors, not assumptions',
            "Optionally, a colleague's real input attached to a persona (the honest version of collaboration)",
          ]}
        />
      ) : null}
    </div>
  )
}
