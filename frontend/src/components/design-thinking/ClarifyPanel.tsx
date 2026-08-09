import type { ClarifyQuestion } from '../../designThinkingTypes'
import { CLARIFY_MAX_ROUNDS } from '../../designThinkingTypes'

interface ClarifyPanelProps {
  stageLabel: string
  round: number
  questions: ClarifyQuestion[]
  answers: Record<string, string>
  onAnswerChange: (id: string, value: string) => void
  onSubmit: () => void
  onSkip: () => void
  busy: boolean
  error: string | null
}

// The Clarify Agent's back-and-forth loop, applied inline to whichever stage
// is currently generating -- same conversational-rounds idea as Spec
// Builder's ClarifyQuestions.tsx, condensed into a card that drops into a
// stage's own layout instead of taking over the page.
export function ClarifyPanel({
  stageLabel,
  round,
  questions,
  answers,
  onAnswerChange,
  onSubmit,
  onSkip,
  busy,
  error,
}: ClarifyPanelProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary-light/40 p-4">
      <div>
        <p className="text-xs font-semibold text-primary-dark">
          {round === 1 ? 'A few questions first' : 'One more thing'}
        </p>
        <p className="mt-0.5 text-xs text-neutral-600">
          Before generating {stageLabel}, quickly answer these — or skip and use the recommended
          defaults.
        </p>
        <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
          Round {round} of up to {CLARIFY_MAX_ROUNDS}
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        {questions.map((q) => (
          <div key={q.id} className="rounded-lg border border-neutral-200 bg-white p-3">
            <p className="text-xs font-semibold text-neutral-900">{q.question}</p>
            {q.recommended ? (
              <p className="mt-0.5 text-[11px] text-neutral-500">Recommended: {q.recommended}</p>
            ) : null}
            {q.options.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {q.options.map((option) => {
                  const selected = answers[q.id] === option
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onAnswerChange(q.id, option)}
                      className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        selected
                          ? 'border-primary bg-primary text-white'
                          : 'border-neutral-200 text-neutral-700 hover:border-primary hover:text-primary'
                      }`}
                    >
                      {option}
                      {option === q.recommended ? <span className="ml-1 opacity-70">★</span> : null}
                    </button>
                  )
                })}
              </div>
            ) : (
              <input
                value={answers[q.id] ?? ''}
                onChange={(e) => onAnswerChange(q.id, e.target.value)}
                placeholder={q.recommended ?? 'Your answer…'}
                className="mt-2 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary"
              />
            )}
          </div>
        ))}
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="text-[11px] font-medium text-neutral-500 underline-offset-2 hover:text-neutral-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          Skip — generate now with recommended answers
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Thinking…' : 'Continue'}
        </button>
      </div>
    </div>
  )
}
