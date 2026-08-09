import { useState } from 'react'
import { generateValidationPlans } from '../../lib/designThinkingApi'
import { useClarifyingGenerate } from '../../lib/useClarifyingGenerate'
import type { ConceptBrief, ValidationPlan } from '../../designThinkingTypes'
import { ClarifyPanel } from './ClarifyPanel'
import { EditableText } from '../infographic/EditableText'
import { ExportMenu } from './ExportMenu'
import { GenerateBar } from './GenerateBar'
import { StageIntroCard } from './StageIntroCard'

interface TestStageProps {
  briefs: ConceptBrief[]
  plans: ValidationPlan[]
  onChange: (plans: ValidationPlan[]) => void
  onExportMarkdown: () => void
  onExportHtml: () => void
  exportBusy: boolean
}

export function TestStage({ briefs, plans, onChange, onExportMarkdown, onExportHtml, exportBusy }: TestStageProps) {
  const [prompt, setPrompt] = useState('')

  const clarify = useClarifyingGenerate<{ validation_plans: ValidationPlan[] }>(
    (clarifications, round, forceGenerate) =>
      generateValidationPlans(briefs, prompt, clarifications, round, forceGenerate),
    (result) => onChange(result.validation_plans),
  )

  const updatePlan = (i: number, patch: Partial<ValidationPlan>) => {
    const next = plans.slice()
    next[i] = { ...next[i], ...patch }
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-4">
      <GenerateBar
        prompt={prompt}
        onPromptChange={setPrompt}
        placeholder="Optional nudge, e.g. 'Focus hypotheses on the riskiest assumption.'"
        onGenerate={clarify.start}
        busy={clarify.busy}
        hasResult={plans.length > 0}
        disabled={briefs.length === 0}
        error={clarify.questions ? null : clarify.error}
      />
      {briefs.length === 0 ? (
        <p className="text-xs text-neutral-400">Generate concept briefs in Prototype first.</p>
      ) : null}

      {clarify.questions ? (
        <ClarifyPanel
          stageLabel="validation plans"
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

      {plans.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {plans.map((v, i) => (
              <div key={i} className="flex flex-col gap-2.5 rounded-xl border border-neutral-200 bg-white p-4">
                <h3 className="text-sm font-bold text-neutral-900">{v.concept_name}</h3>
                {v.hypotheses.length > 0 ? (
                  <div>
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                      Hypotheses
                    </h4>
                    <ul className="mt-1 space-y-0.5">
                      {v.hypotheses.map((h, j) => (
                        <li key={j} className="text-xs text-neutral-700">
                          • {h}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="rounded-lg bg-primary-light p-2.5">
                  <h4 className="text-[10px] font-semibold uppercase tracking-wide text-primary-dark">
                    Success signal
                  </h4>
                  <EditableText
                    value={v.success_signal}
                    onCommit={(success_signal) => updatePlan(i, { success_signal })}
                    as="p"
                    multiline
                    className="mt-0.5 text-xs text-neutral-800"
                  />
                </div>
                <div className="rounded-lg border border-red-100 bg-red-50 p-2.5">
                  <h4 className="text-[10px] font-semibold uppercase tracking-wide text-red-500">
                    Risk if wrong
                  </h4>
                  <EditableText
                    value={v.risk_if_wrong}
                    onCommit={(risk_if_wrong) => updatePlan(i, { risk_if_wrong })}
                    as="p"
                    multiline
                    className="mt-0.5 text-xs text-red-700"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col items-start gap-1.5 rounded-xl border border-primary/30 bg-primary-light p-4">
            <p className="text-xs font-medium text-primary-dark">
              Ready to hand this off — export as Markdown to upload into a Spec Builder project, or as
              HTML to paste into Confluence.
            </p>
            <ExportMenu
              onExportMarkdown={onExportMarkdown}
              onExportHtml={onExportHtml}
              busy={exportBusy}
              disabled={false}
              variant="primary"
            />
          </div>
        </>
      ) : !clarify.questions ? (
        <StageIntroCard
          title="What Test produces"
          steps={[
            'Hypotheses per concept, derived from its named assumptions',
            'A concrete success signal — what you’d actually see if you’re right',
            'What happens if you’re wrong, grounded in the concept’s biggest risk',
          ]}
        />
      ) : null}
    </div>
  )
}
