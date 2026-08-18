import { useState } from "react"
import { api } from "@/features/spec-builder/lib/api"
import type { ClarifyQuestion, GeneratedPRD } from "@/features/spec-builder/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { PipelineProgress } from "@/features/spec-builder/components/PipelineProgress"
import { cn } from "@/lib/utils"

interface ClarifyQuestionsProps {
  projectId: string
  projectName: string
  questions: ClarifyQuestion[]
  onGenerated: (projectId: string, artifactId: string, prd: GeneratedPRD) => void
  onCancel: () => void
}

function categoryLabel(category: string) {
  return category.replaceAll("_", " ")
}

// Mirrors the backend budget (agents.py MAX_ROUNDS / MAX_TOTAL_QUESTIONS),
// so the PM can see how close the conversation is to wrapping up.
const MAX_ROUNDS = 3
const MAX_TOTAL_QUESTIONS = 8

interface AnsweredItem {
  question: ClarifyQuestion
  answer: string
}

export function ClarifyQuestions({
  projectId,
  projectName,
  questions: initialQuestions,
  onGenerated,
  onCancel,
}: ClarifyQuestionsProps) {
  const [questions, setQuestions] = useState(initialQuestions)
  const [round, setRound] = useState(1)
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialQuestions.map((q) => [q.id, ""]))
  )
  const [answeredHistory, setAnsweredHistory] = useState<AnsweredItem[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setAnswer(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }))
  }

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    try {
      const answeredNow: AnsweredItem[] = questions.map((q) => ({
        question: q,
        answer: answers[q.id] || q.recommended || "(default)",
      }))
      const res = await api.submitOverviewClarifications(projectId, answers)
      if (res.status === "needs_clarification") {
        // The Clarify Agent is conversational -- it can ask a follow-up round
        // informed by what was just answered, rather than one flat batch.
        setAnsweredHistory((prev) => [...prev, ...answeredNow])
        setQuestions(res.questions)
        setAnswers(Object.fromEntries(res.questions.map((q) => [q.id, ""])))
        setRound((r) => r + 1)
      } else {
        onGenerated(projectId, res.artifact_id!, res.prd!)
      }
    } catch (err) {
      setError(`${err}`)
    } finally {
      setBusy(false)
    }
  }

  const questionsUsed = answeredHistory.length + questions.length

  return (
    <div className="px-6 py-6">
      <h1 className="mb-1 text-2xl font-semibold">
        {round === 1 ? "A few questions first" : "One more thing"}
      </h1>
      <p className="mb-2 text-sm text-muted-foreground">
        For "{projectName}" — the Clarify Agent found {questions.length} thing
        {questions.length === 1 ? "" : "s"} worth pinning down
        {round === 1 ? " before drafting the PRD" : ", based on what you just answered"}.
        Answering (or accepting the recommended defaults) will make the result
        more accurate.
      </p>
      <p className="mb-6 text-xs text-muted-foreground">
        Round {round} of up to {MAX_ROUNDS} · {questionsUsed} of {MAX_TOTAL_QUESTIONS} questions
      </p>

      {answeredHistory.length > 0 && (
        <details className="mb-4 rounded-md border">
          <summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground select-none">
            Previously answered ({answeredHistory.length})
          </summary>
          <div className="flex flex-col gap-2 border-t px-3 py-2">
            {answeredHistory.map((item) => (
              <div key={item.question.id} className="text-sm">
                <p className="text-muted-foreground">{item.question.question}</p>
                <p className="font-medium">{item.answer}</p>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="flex flex-col gap-4">
        {questions.map((q, i) => (
          <Card key={q.id}>
            <CardHeader>
              <div className="mb-1 flex items-center gap-2">
                <Badge variant="secondary">{i + 1}</Badge>
                <Badge variant="outline">{categoryLabel(q.category)}</Badge>
              </div>
              <CardTitle className="text-base font-medium">{q.question}</CardTitle>
              {q.recommended && (
                <CardDescription>Recommended: {q.recommended}</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {q.options.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((option) => {
                    const selected = answers[q.id] === option
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setAnswer(q.id, option)}
                        className={cn(
                          "rounded-md border px-3 py-1.5 text-sm transition-colors",
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "hover:bg-accent hover:text-accent-foreground"
                        )}
                      >
                        {option}
                        {option === q.recommended && (
                          <span className="ml-1.5 text-xs opacity-70">★</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Label htmlFor={q.id} className="sr-only">
                    {q.question}
                  </Label>
                  <Input
                    id={q.id}
                    value={answers[q.id]}
                    placeholder={q.recommended ?? undefined}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !busy) handleSubmit()
                    }}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {busy && (
        <div className="mt-4">
          <PipelineProgress projectId={projectId} active={busy} />
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={busy}>
          {busy ? "Generating…" : "Continue"}
        </Button>
      </div>
      <p className="mt-2 text-right text-xs text-muted-foreground">
        Leaving a question blank uses its recommended answer.
      </p>
    </div>
  )
}
