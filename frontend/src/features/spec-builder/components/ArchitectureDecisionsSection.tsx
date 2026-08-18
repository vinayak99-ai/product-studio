import { useRef, useState } from "react"
import type { AnsweredClarification, ArchitectureDecision, ClarifyQuestion, GeneratedPRD } from "@/features/spec-builder/lib/types"
import { api } from "@/features/spec-builder/lib/api"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Section } from "@/features/spec-builder/components/Section"
import { EditableBlock } from "@/features/spec-builder/components/EditableBlock"
import { Blocks, Trash2 } from "lucide-react"

interface ArchitectureDecisionsSectionProps {
  projectId: string
  artifactId: string
  decisions: ArchitectureDecision[]
  technicalContext: AnsweredClarification[]
  // Manual inline edits (title/context/decision/consequences fields,
  // remove) only ever touch the decisions array itself.
  onChange: (decisions: ArchitectureDecision[]) => void
  // The clarify/finalize flow returns the FULL prd, including the updated
  // `pipeline` step status (drafted) -- syncing only `decisions` would
  // leave the PipelineStepper showing "not_started" forever, since it's
  // the one step with no PipelineStepper-driven generate button of its
  // own (this section's clarify Q&A is the only path to drafting it).
  onGenerated: (prd: GeneratedPRD) => void
}

export function ArchitectureDecisionsSection({
  projectId,
  artifactId: _artifactId,
  decisions,
  technicalContext,
  onChange,
  onGenerated,
}: ArchitectureDecisionsSectionProps) {
  const toast = useToast()
  const latest = useRef({ decisions, onChange })
  latest.current = { decisions, onChange }
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Architecture is the one interactive pipeline step -- clarify/start may
  // come back with a round of questions (options + a recommended default,
  // same UX as the up-front Clarify step) before decisions are finalized.
  const [clarifyQuestions, setClarifyQuestions] = useState<ClarifyQuestion[] | null>(null)
  const [clarifyAnswers, setClarifyAnswers] = useState<Record<string, string>>({})

  function setAnswer(id: string, value: string) {
    setClarifyAnswers((prev) => ({ ...prev, [id]: value }))
  }

  async function handleStart() {
    setGenerating(true)
    setError(null)
    try {
      const res = await api.architectureClarifyStart(projectId)
      if (res.status === "needs_clarification") {
        setClarifyQuestions(res.questions)
        setClarifyAnswers(Object.fromEntries(res.questions.map((q) => [q.id, ""])))
      } else {
        setClarifyQuestions(null)
        onGenerated(res.prd!)
      }
    } catch (err) {
      setError(`${err}`)
    } finally {
      setGenerating(false)
    }
  }

  async function handleAnswerRound() {
    setGenerating(true)
    setError(null)
    try {
      const res = await api.architectureClarifyAnswer(projectId, clarifyAnswers)
      if (res.status === "needs_clarification") {
        setClarifyQuestions(res.questions)
        setClarifyAnswers(Object.fromEntries(res.questions.map((q) => [q.id, ""])))
      } else {
        setClarifyQuestions(null)
        onGenerated(res.prd!)
      }
    } catch (err) {
      setError(`${err}`)
    } finally {
      setGenerating(false)
    }
  }

  async function handleSkipToFinalize() {
    setGenerating(true)
    setError(null)
    try {
      const res = await api.architectureFinalize(projectId)
      setClarifyQuestions(null)
      onGenerated(res.prd!)
    } catch (err) {
      setError(`${err}`)
    } finally {
      setGenerating(false)
    }
  }

  function updateDecision(index: number, patch: Partial<ArchitectureDecision>) {
    const next = [...decisions]
    next[index] = { ...next[index], ...patch }
    onChange(next)
  }

  function removeDecision(index: number) {
    const removed = decisions[index]
    onChange(decisions.filter((_, i) => i !== index))
    toast({
      title: `${removed.id} removed`,
      description: removed.title || undefined,
      action: {
        label: "Undo",
        onClick: () => {
          const { decisions: current, onChange: change } = latest.current
          const next = [...current]
          next.splice(Math.min(index, next.length), 0, removed)
          change(next)
        },
      },
    })
  }

  function toggleStatus(index: number) {
    const current = decisions[index].status
    updateDecision(index, { status: current === "proposed" ? "accepted" : "proposed" })
  }

  function statusBadge(index: number) {
    const adr = decisions[index]
    return (
      <Badge
        role="button"
        tabIndex={0}
        variant={adr.status === "accepted" ? "default" : "secondary"}
        className="cursor-pointer"
        onClick={(e) => {
          e.stopPropagation()
          toggleStatus(index)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation()
            toggleStatus(index)
          }
        }}
      >
        {adr.status}
      </Badge>
    )
  }

  return (
    <Section
      id="architecture"
      title="Architecture Decisions"
      icon={Blocks}
      count={decisions.length}
      actions={
        <Button type="button" variant="outline" size="sm" disabled={generating || !!clarifyQuestions} onClick={handleStart}>
          {generating ? "Working…" : decisions.length > 0 ? "Regenerate" : "Ask questions & generate"}
        </Button>
      }
    >
      {error && <p className="text-sm text-destructive">{error}</p>}

      {clarifyQuestions && clarifyQuestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">A few architecture questions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {clarifyQuestions.map((q, i) => (
              <div key={q.id} className="flex flex-col gap-2">
                <p className="text-sm font-medium">
                  {i + 1}. {q.question}
                </p>
                {q.options.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {q.options.map((option) => {
                      const selected = clarifyAnswers[q.id] === option
                      return (
                        <button
                          key={option}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setAnswer(q.id, option)}
                          className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "hover:bg-accent hover:text-accent-foreground"
                          }`}
                        >
                          {option}
                          {option === q.recommended && <span className="ml-1.5 text-xs opacity-70">★</span>}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <Input
                    value={clarifyAnswers[q.id] ?? ""}
                    placeholder={q.recommended ?? undefined}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                  />
                )}
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" disabled={generating} onClick={handleSkipToFinalize}>
                Skip remaining questions & finalize
              </Button>
              <Button type="button" size="sm" disabled={generating} onClick={handleAnswerRound}>
                {generating ? "Working…" : "Continue"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {technicalContext.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-md border p-3">
          <p className="text-xs font-medium text-muted-foreground">Technical context considered</p>
          {technicalContext.map((h) => (
            <p key={h.question.id} className="text-sm">
              <span className="text-muted-foreground">{h.question.question}</span> {h.answer}
            </p>
          ))}
        </div>
      )}

      {decisions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No architecture decisions yet. These are drafted automatically when a spec is generated.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {decisions.map((adr, i) => (
          <Card key={adr.id}>
            <EditableBlock
              label={adr.title || adr.id}
              read={
                <div className="flex flex-col gap-2 px-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{adr.id}</span>
                    {statusBadge(i)}
                    <h3 className="text-base font-semibold">{adr.title}</h3>
                  </div>
                  {adr.context && (
                    <p className="text-sm leading-relaxed">
                      <span className="font-medium text-muted-foreground">Context:</span> {adr.context}
                    </p>
                  )}
                  {adr.decision && (
                    <p className="text-sm leading-relaxed">
                      <span className="font-medium text-muted-foreground">Decision:</span> {adr.decision}
                    </p>
                  )}
                  {adr.consequences && (
                    <p className="text-sm leading-relaxed">
                      <span className="font-medium text-muted-foreground">Consequences:</span> {adr.consequences}
                    </p>
                  )}
                </div>
              }
            >
              <CardHeader className="flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">{adr.id}</CardTitle>
                  {statusBadge(i)}
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeDecision(i)} aria-label="Remove decision">
                  <Trash2 className="size-4" />
                </Button>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <Label>Title</Label>
                  <Input value={adr.title} onChange={(e) => updateDecision(i, { title: e.target.value })} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Context</Label>
                  <Textarea
                    className="min-h-16"
                    value={adr.context}
                    onChange={(e) => updateDecision(i, { context: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Decision</Label>
                  <Textarea
                    className="min-h-16"
                    value={adr.decision}
                    onChange={(e) => updateDecision(i, { decision: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Consequences</Label>
                  <Textarea
                    className="min-h-16"
                    value={adr.consequences}
                    onChange={(e) => updateDecision(i, { consequences: e.target.value })}
                  />
                </div>
              </CardContent>
            </EditableBlock>
          </Card>
        ))}
      </div>
    </Section>
  )
}
