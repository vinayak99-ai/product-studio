import type { AnsweredClarification, ClarifyQuestion } from '../../deepAnalysisTypes'

interface DeepAnalysisClarifyPanelProps {
  projectName: string
  round: number
  maxRounds: number
  questionsUsed: number
  maxQuestions: number
  questions: ClarifyQuestion[]
  answeredHistory: AnsweredClarification[]
  answers: Record<string, string>
  onAnswerChange: (id: string, value: string) => void
  onSubmit: () => void
  onSkip: () => void
  busy: boolean
  error: string | null
}

function categoryLabel(category: string) {
  return category.replaceAll('_', ' ')
}

// The deep clarify loop's Q&A UI -- structurally like Design Thinking's
// ClarifyPanel/Spec Builder's ClarifyQuestions, but sized for up to 10
// questions a round across up to 10 rounds, and every number on screen
// (round, budget, questions used) comes from the server response, never a
// hardcoded constant.
export function DeepAnalysisClarifyPanel({
  projectName,
  round,
  maxRounds,
  questionsUsed,
  maxQuestions,
  questions,
  answeredHistory,
  answers,
  onAnswerChange,
  onSubmit,
  onSkip,
  busy,
  error,
}: DeepAnalysisClarifyPanelProps) {
  return (
    <div className="px-6 py-6">
      <h1 className="mb-1 text-2xl font-semibold text-neutral-900">
        {round === 1 ? 'A deep interview first' : 'Digging deeper'}
      </h1>
      <p className="mb-2 text-sm text-neutral-600">
        For "{projectName}" — answer these (or accept the recommended defaults) to build real
        context before the analysis gets written.
      </p>
      <p className="mb-6 text-xs text-neutral-500">
        Round {round} of up to {maxRounds} · {questionsUsed} of {maxQuestions} questions
      </p>

      {answeredHistory.length > 0 ? (
        <details className="mb-4 rounded-lg border border-neutral-200">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm text-neutral-500">
            Previously answered ({answeredHistory.length})
          </summary>
          <div className="flex flex-col gap-2 border-t border-neutral-200 px-3 py-2">
            {answeredHistory.map((item, i) => (
              <div key={i} className="text-sm">
                <p className="text-neutral-500">{item.question.question}</p>
                <p className="font-medium text-neutral-900">{item.answer}</p>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <div className="flex flex-col gap-3">
        {questions.map((q, i) => (
          <div key={q.id} className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-500">
                {i + 1}
              </span>
              <span className="rounded-full border border-neutral-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                {categoryLabel(q.category)}
              </span>
            </div>
            <p className="text-sm font-medium text-neutral-900">{q.question}</p>
            {q.recommended ? <p className="mt-1 text-xs text-neutral-500">Recommended: {q.recommended}</p> : null}

            {q.options.length > 0 ? (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {q.options.map((option) => {
                  const selected = answers[q.id] === option
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onAnswerChange(q.id, option)}
                      className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                        selected
                          ? 'border-primary bg-primary text-white'
                          : 'border-neutral-200 text-neutral-700 hover:border-primary hover:text-primary'
                      }`}
                    >
                      {option}
                      {option === q.recommended ? <span className="ml-1.5 text-xs opacity-70">★</span> : null}
                    </button>
                  )
                })}
              </div>
            ) : (
              <input
                value={answers[q.id] ?? ''}
                onChange={(e) => onAnswerChange(q.id, e.target.value)}
                placeholder={q.recommended ?? undefined}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !busy) onSubmit()
                }}
                className="mt-2.5 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-sm text-neutral-900 outline-none focus:border-primary"
              />
            )}
          </div>
        ))}
      </div>

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      <div className="mt-6 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="text-xs font-medium text-neutral-500 underline-offset-2 hover:text-neutral-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          Stop here — write the analysis from what's been gathered so far
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Thinking…' : 'Continue'}
        </button>
      </div>
      <p className="mt-2 text-right text-xs text-neutral-400">Leaving a question blank uses its recommended answer.</p>
    </div>
  )
}
