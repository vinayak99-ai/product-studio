import { useState } from "react"
import { CheckCircle2, CircleDashed, FileEdit, HelpCircle, RotateCcw } from "lucide-react"
import { api } from "@/features/spec-builder/lib/api"
import { STEP_ORDER, type GeneratedPRD, type StepId } from "@/features/spec-builder/lib/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

interface PipelineStepperProps {
  projectId: string
  prd: GeneratedPRD
  onPrdChange: (prd: GeneratedPRD) => void
}

const STEP_LABELS: Record<StepId, string> = {
  overview: "Overview",
  stories: "Stories",
  requirements: "Requirements",
  test_cases: "Test Cases",
  architecture: "Architecture",
  epics: "Epics",
}

// Steps whose draft is produced by a click on this stepper. Overview needs
// raw notes (driven by Source Notes / New Project instead) and Architecture
// is its own interactive clarify+finalize flow (driven by
// ArchitectureDecisionsSection below) -- both just show status here.
const GENERATE_HERE: StepId[] = ["stories", "requirements", "test_cases", "epics"]

export function PipelineStepper({ projectId, prd, onPrdChange }: PipelineStepperProps) {
  const toast = useToast()
  const [busyStep, setBusyStep] = useState<StepId | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(step: StepId, action: () => Promise<GeneratedPRD>) {
    setBusyStep(step)
    setError(null)
    try {
      const updated = await action()
      onPrdChange(updated)
    } catch (err) {
      setError(`${err}`)
    } finally {
      setBusyStep(null)
    }
  }

  function generate(step: StepId) {
    return run(step, () => api.generateStep(projectId, step))
  }
  function revisit(step: StepId) {
    return run(step, () => api.revisitStep(projectId, step))
  }
  async function confirm(step: StepId) {
    setBusyStep(step)
    setError(null)
    try {
      const updated = await api.confirmStep(projectId, step)
      onPrdChange(updated)
      toast({ title: `${STEP_LABELS[step]} confirmed` })
    } catch (err) {
      setError(`${err}`)
    } finally {
      setBusyStep(null)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        {STEP_ORDER.map((step, i) => {
          const state = prd.pipeline.steps[step] ?? { status: "not_started", confirmed_at: null, confirmed_version: null }
          const busy = busyStep === step
          return (
            <div key={step} className="flex items-center gap-2">
              {i > 0 && <div className="h-px w-4 shrink-0 bg-border" />}
              <div
                data-testid={`pipeline-step-${step}`}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5",
                  state.status === "confirmed" && "border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950",
                  state.status === "stale" && "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950",
                  state.status === "needs_clarification" && "border-blue-300 bg-blue-50 dark:border-blue-900 dark:bg-blue-950"
                )}
              >
                {state.status === "confirmed" ? (
                  <CheckCircle2 className="size-3.5 text-green-600 dark:text-green-400" />
                ) : state.status === "stale" ? (
                  <RotateCcw className="size-3.5 text-amber-600 dark:text-amber-400" />
                ) : state.status === "needs_clarification" ? (
                  <HelpCircle className="size-3.5 text-blue-600 dark:text-blue-400" />
                ) : state.status === "drafted" ? (
                  <FileEdit className="size-3.5 text-muted-foreground" />
                ) : (
                  <CircleDashed className="size-3.5 text-muted-foreground" />
                )}
                <span className="text-xs font-medium">{STEP_LABELS[step]}</span>
                {state.status === "confirmed" && state.confirmed_version != null && (
                  <Badge variant="outline" className="ml-0.5 h-4 px-1 text-[10px]">
                    v{state.confirmed_version}
                  </Badge>
                )}

                {state.status === "drafted" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[11px]"
                    disabled={busy}
                    onClick={() => confirm(step)}
                  >
                    {busy ? "…" : "Confirm"}
                  </Button>
                )}
                {state.status === "not_started" && GENERATE_HERE.includes(step) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[11px]"
                    disabled={busy}
                    onClick={() => generate(step)}
                  >
                    {busy ? "…" : "Generate"}
                  </Button>
                )}
                {state.status === "stale" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[11px]"
                    disabled={busy}
                    onClick={() => revisit(step)}
                  >
                    {busy ? "…" : "Revisit"}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
