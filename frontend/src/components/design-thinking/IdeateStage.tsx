import { useState } from 'react'
import { generateConceptSparks, generateHowMightWe } from '../../lib/designThinkingApi'
import { useClarifyingGenerate } from '../../lib/useClarifyingGenerate'
import type { ConceptSpark, HowMightWe, ProblemStatement } from '../../designThinkingTypes'
import { ClarifyPanel } from './ClarifyPanel'
import { StageIntroCard } from './StageIntroCard'

interface IdeateStageProps {
  statements: ProblemStatement[]
  hmws: HowMightWe[]
  onHmwChange: (hmws: HowMightWe[]) => void
  sparks: ConceptSpark[]
  onSparksChange: (sparks: ConceptSpark[]) => void
  onContinue: () => void
}

export function IdeateStage({
  statements,
  hmws,
  onHmwChange,
  sparks,
  onSparksChange,
  onContinue,
}: IdeateStageProps) {
  const [hmwPrompt, setHmwPrompt] = useState('')
  const [sparkPrompt, setSparkPrompt] = useState('')
  const [busySparks, setBusySparks] = useState(false)
  const [sparkError, setSparkError] = useState<string | null>(null)

  // Only How Might We -- the first, judgment-heavy reframing step -- runs
  // behind the Clarify Agent. Concept sparks stay a single-shot batch
  // generation off the (now clarified) selected HMWs, same as before.
  const hmwClarify = useClarifyingGenerate<{ how_might_we: HowMightWe[] }>(
    (clarifications, round, forceGenerate) =>
      generateHowMightWe(statements, hmwPrompt, clarifications, round, forceGenerate),
    (result) => {
      onHmwChange(result.how_might_we)
      onSparksChange([])
    },
  )

  const selectedHmws = hmws.filter((h) => h.selected)
  const selectedSparks = sparks.filter((s) => s.selected)

  const handleGenerateSparks = async () => {
    setSparkError(null)
    setBusySparks(true)
    try {
      const { concept_sparks } = await generateConceptSparks(hmws, sparkPrompt)
      onSparksChange(concept_sparks)
    } catch (err) {
      setSparkError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusySparks(false)
    }
  }

  const toggleHmw = (i: number) => {
    const next = hmws.slice()
    next[i] = { ...next[i], selected: !next[i].selected }
    onHmwChange(next)
  }

  const toggleSpark = (i: number) => {
    const next = sparks.slice()
    next[i] = { ...next[i], selected: !next[i].selected }
    onSparksChange(next)
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
              1. How Might We
            </h3>
            <p className="mt-0.5 text-xs text-neutral-500">
              Reframe the problem into open questions. Pick the ones worth exploring.
            </p>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={hmwPrompt}
            onChange={(e) => setHmwPrompt(e.target.value)}
            placeholder="Optional nudge, e.g. 'Lean toward ambitious reframes.'"
            className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={hmwClarify.start}
            disabled={hmwClarify.busy || statements.length === 0}
            className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {hmwClarify.busy ? 'Generating…' : hmws.length > 0 ? 'Regenerate' : 'Generate'}
          </button>
        </div>
        {!hmwClarify.questions && hmwClarify.error ? (
          <p className="mt-2 text-xs text-red-600">{hmwClarify.error}</p>
        ) : null}

        {hmwClarify.questions ? (
          <div className="mt-3">
            <ClarifyPanel
              stageLabel="How Might We questions"
              round={hmwClarify.round}
              questions={hmwClarify.questions}
              answers={hmwClarify.answers}
              onAnswerChange={hmwClarify.setAnswer}
              onSubmit={() => hmwClarify.submit(false)}
              onSkip={() => hmwClarify.submit(true)}
              busy={hmwClarify.busy}
              error={hmwClarify.error}
            />
          </div>
        ) : null}

        {hmws.length > 0 ? (
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            {hmws.map((h, i) => (
              <label
                key={i}
                className={`flex cursor-pointer gap-2 rounded-lg border p-2.5 text-xs transition-colors ${
                  h.selected ? 'border-primary bg-primary-light' : 'border-neutral-200 bg-neutral-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={h.selected}
                  onChange={() => toggleHmw(i)}
                  className="mt-0.5 shrink-0 accent-primary"
                />
                <span>
                  <span className="font-semibold text-neutral-900">{h.question}</span>
                  <span className="block text-[11px] text-neutral-500">{h.rationale}</span>
                </span>
              </label>
            ))}
          </div>
        ) : !hmwClarify.questions ? (
          <div className="mt-3">
            <StageIntroCard
              title="What How Might We produces"
              steps={[
                '5-8 open reframes of the problem, spanning tactical to ambitious',
                'Solution-agnostic on purpose — no feature ideas smuggled in yet',
                'Pick the ones worth exploring, then generate concept sparks below',
              ]}
            />
          </div>
        ) : null}
      </div>

      {hmws.length > 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
            2. Concept sparks
          </h3>
          <p className="mt-0.5 text-xs text-neutral-500">
            Quick, wide ideas for the selected questions — including one deliberate wildcard. Narrow
            down to 1-3 to carry forward.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={sparkPrompt}
              onChange={(e) => setSparkPrompt(e.target.value)}
              placeholder="Optional nudge, e.g. 'Bias toward low-effort ideas.'"
              className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={handleGenerateSparks}
              disabled={busySparks || selectedHmws.length === 0}
              className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busySparks ? 'Generating…' : sparks.length > 0 ? 'Regenerate' : 'Generate sparks'}
            </button>
          </div>
          {selectedHmws.length === 0 ? (
            <p className="mt-2 text-xs text-neutral-400">Select at least one How Might We above first.</p>
          ) : null}
          {sparkError ? <p className="mt-2 text-xs text-red-600">{sparkError}</p> : null}

          {sparks.length > 0 ? (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sparks.map((s, i) => (
                <label
                  key={i}
                  className={`flex cursor-pointer gap-2 rounded-lg border p-2.5 text-xs transition-colors ${
                    s.selected ? 'border-primary bg-primary-light' : 'border-neutral-200 bg-neutral-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={s.selected}
                    onChange={() => toggleSpark(i)}
                    className="mt-0.5 shrink-0 accent-primary"
                  />
                  <span>
                    {s.is_wildcard ? (
                      <span className="mr-1 rounded-full border border-accent/40 bg-accent-light px-1.5 py-0.5 text-[9px] font-bold uppercase text-accent">
                        Wildcard
                      </span>
                    ) : null}
                    <span className="text-neutral-800">{s.idea}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {selectedSparks.length > 0 ? (
        <button
          type="button"
          onClick={onContinue}
          className="self-start rounded-md border border-primary px-4 py-2 text-xs font-semibold text-primary hover:bg-primary-light"
        >
          Continue to Prototype →
        </button>
      ) : null}
    </div>
  )
}
