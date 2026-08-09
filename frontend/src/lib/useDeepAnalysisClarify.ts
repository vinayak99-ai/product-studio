import { useState } from 'react'
import { submitClarifications } from './deepAnalysisApi'
import type { AnsweredClarification, ClarifyQuestion, DeepAnalysisDocument, GenerateResponse } from '../deepAnalysisTypes'

// Drives one project's deep-clarify loop after the initial generate() call
// already returned a first round. Unlike Design Thinking's stateless
// useClarifyingGenerate, the server holds round/history state
// (pending_clarification.json) -- this hook only needs to track the
// CURRENT round's questions/answers plus the response's own round/budget
// numbers, never a duplicated client-side budget constant.
export function useDeepAnalysisClarify(
  projectId: string,
  initial: GenerateResponse,
  onGenerated: (artifactId: string, document: DeepAnalysisDocument) => void,
) {
  const [questions, setQuestions] = useState<ClarifyQuestion[]>(initial.questions)
  const [round, setRound] = useState(initial.round)
  const [maxRounds, setMaxRounds] = useState(initial.max_rounds)
  const [questionsUsed, setQuestionsUsed] = useState(initial.questions_used)
  const [maxQuestions, setMaxQuestions] = useState(initial.max_questions)
  const [answers, setAnswers] = useState<Record<string, string>>(
    Object.fromEntries(initial.questions.map((q) => [q.id, ''])),
  )
  const [answeredHistory, setAnsweredHistory] = useState<AnsweredClarification[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setAnswer(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }))
  }

  async function submit(forceGenerate = false) {
    setBusy(true)
    setError(null)
    try {
      const answeredNow: AnsweredClarification[] = questions.map((q) => ({
        question: q,
        answer: answers[q.id]?.trim() || q.recommended || '(no answer given)',
      }))
      const res = await submitClarifications(projectId, answers, forceGenerate)
      if (res.status === 'needs_clarification') {
        setAnsweredHistory((prev) => [...prev, ...answeredNow])
        setQuestions(res.questions)
        setAnswers(Object.fromEntries(res.questions.map((q) => [q.id, ''])))
        setRound(res.round)
        setMaxRounds(res.max_rounds)
        setQuestionsUsed(res.questions_used)
        setMaxQuestions(res.max_questions)
      } else {
        onGenerated(res.artifact_id!, res.document!)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return {
    questions,
    round,
    maxRounds,
    questionsUsed,
    maxQuestions,
    answers,
    answeredHistory,
    busy,
    error,
    setAnswer,
    submit,
  }
}
