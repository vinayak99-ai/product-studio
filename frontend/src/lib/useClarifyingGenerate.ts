import { useState } from 'react'
import type { AnsweredClarification, ClarifyOutcome, ClarifyQuestion } from '../designThinkingTypes'

// Drives one stage's clarify-then-generate loop: call `start()` to kick off
// a generation, which may come back needing a round of clarifying questions
// instead of a result. The PM answers (or leaves blank to accept the
// recommended default) and calls `submit()`, which sends the accumulated
// answers back -- the backend may ask another round, informed by what was
// just answered, or return the final generated result. `submit(true)` skips
// straight to generation using whatever's currently filled in.
//
// Design Thinking has no server-side persistence, so all of this round/
// answer/history state lives here, client-side, for the lifetime of one
// generation attempt -- nothing survives a page refresh, same as the rest
// of this tool.
export function useClarifyingGenerate<TGenerated extends object>(
  generateFn: (
    clarifications: AnsweredClarification[],
    round: number,
    forceGenerate: boolean,
  ) => Promise<ClarifyOutcome<TGenerated>>,
  onGenerated: (result: ClarifyOutcome<TGenerated> & { status: 'generated' }) => void,
) {
  const [questions, setQuestions] = useState<ClarifyQuestion[] | null>(null)
  const [round, setRound] = useState(1)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [history, setHistory] = useState<AnsweredClarification[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setAnswer(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }))
  }

  function applyOutcome(result: ClarifyOutcome<TGenerated>) {
    if (result.status === 'needs_clarification') {
      setQuestions(result.questions)
      setAnswers(Object.fromEntries(result.questions.map((q) => [q.id, ''])))
    } else {
      setQuestions(null)
      setHistory([])
      setRound(1)
      onGenerated(result)
    }
  }

  async function start() {
    setError(null)
    setBusy(true)
    try {
      applyOutcome(await generateFn([], 1, false))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function submit(forceGenerate = false) {
    if (!questions) return
    setBusy(true)
    setError(null)
    const answeredNow: AnsweredClarification[] = questions.map((q) => ({
      question: q,
      answer: answers[q.id]?.trim() || q.recommended || '(no answer given)',
    }))
    const nextHistory = [...history, ...answeredNow]
    try {
      const result = await generateFn(nextHistory, round + 1, forceGenerate)
      setHistory(nextHistory)
      if (result.status === 'needs_clarification') {
        setRound((r) => r + 1)
      }
      applyOutcome(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return { questions, round, answers, busy, error, setError, start, setAnswer, submit }
}
