import { useState } from 'react'
import { generateConceptBriefs } from '../../lib/designThinkingApi'
import { useClarifyingGenerate } from '../../lib/useClarifyingGenerate'
import type { ConceptBrief, ConceptSpark } from '../../designThinkingTypes'
import { ClarifyPanel } from './ClarifyPanel'
import { EditableText } from '../infographic/EditableText'
import { GenerateBar } from './GenerateBar'
import { StageIntroCard } from './StageIntroCard'

interface PrototypeStageProps {
  sparks: ConceptSpark[]
  briefs: ConceptBrief[]
  onChange: (briefs: ConceptBrief[]) => void
  onContinue: () => void
}

export function PrototypeStage({ sparks, briefs, onChange, onContinue }: PrototypeStageProps) {
  const [prompt, setPrompt] = useState('')

  const selectedSparks = sparks.filter((s) => s.selected)

  const clarify = useClarifyingGenerate<{ concept_briefs: ConceptBrief[] }>(
    (clarifications, round, forceGenerate) =>
      generateConceptBriefs(sparks, prompt, clarifications, round, forceGenerate),
    (result) => onChange(result.concept_briefs),
  )

  const updateBrief = (i: number, patch: Partial<ConceptBrief>) => {
    const next = briefs.slice()
    next[i] = { ...next[i], ...patch }
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-4">
      <GenerateBar
        prompt={prompt}
        onPromptChange={setPrompt}
        placeholder="Optional nudge, e.g. 'Keep the brief implementation-agnostic.'"
        onGenerate={clarify.start}
        busy={clarify.busy}
        hasResult={briefs.length > 0}
        disabled={selectedSparks.length === 0}
        error={clarify.questions ? null : clarify.error}
      />
      {selectedSparks.length === 0 ? (
        <p className="text-xs text-neutral-400">Select at least one concept spark in Ideate first.</p>
      ) : null}

      {clarify.questions ? (
        <ClarifyPanel
          stageLabel="concept briefs"
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

      {briefs.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {briefs.map((b, i) => (
              <div key={i} className="flex flex-col gap-2.5 rounded-xl border border-neutral-200 bg-white p-4">
                <EditableText
                  value={b.concept_name}
                  onCommit={(concept_name) => updateBrief(i, { concept_name })}
                  as="h3"
                  className="text-sm font-bold text-neutral-900"
                />
                <EditableText
                  value={b.description}
                  onCommit={(description) => updateBrief(i, { description })}
                  as="p"
                  multiline
                  className="text-xs text-neutral-700"
                />
                {b.key_interactions.length > 0 ? (
                  <div>
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                      Key interactions
                    </h4>
                    <ul className="mt-1 space-y-0.5">
                      {b.key_interactions.map((x, j) => (
                        <li key={j} className="text-xs text-neutral-700">
                          • {x}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {b.assumptions.length > 0 ? (
                  <div className="rounded-lg bg-neutral-50 p-2.5">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                      Assumptions
                    </h4>
                    <ul className="mt-1 space-y-0.5">
                      {b.assumptions.map((x, j) => (
                        <li key={j} className="text-xs text-neutral-700">
                          • {x}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="rounded-lg border border-red-100 bg-red-50 p-2.5">
                  <h4 className="text-[10px] font-semibold uppercase tracking-wide text-red-500">
                    Biggest risk
                  </h4>
                  <EditableText
                    value={b.biggest_risk}
                    onCommit={(biggest_risk) => updateBrief(i, { biggest_risk })}
                    as="p"
                    multiline
                    className="mt-0.5 text-xs text-red-700"
                  />
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={onContinue}
            className="self-start rounded-md border border-primary px-4 py-2 text-xs font-semibold text-primary hover:bg-primary-light"
          >
            Continue to Test →
          </button>
        </>
      ) : !clarify.questions ? (
        <StageIntroCard
          title="What Prototype produces"
          steps={[
            'A concept brief per selected spark — not a wireframe, a description someone can react to',
            'Named assumptions: what has to be true for it to work',
            'The single biggest risk, stated plainly',
          ]}
        />
      ) : null}
    </div>
  )
}
