import { useEffect, useState } from 'react'
import { getGenerationStatus } from '../../lib/deepAnalysisApi'

const STAGES = [
  { key: 'extracting', label: 'Extracting' },
  { key: 'clarifying', label: 'Clarifying' },
  { key: 'synthesizing', label: 'Synthesizing' },
] as const

interface DeepAnalysisProgressProps {
  projectId: string | null
  active: boolean
}

// Same polling pattern as Spec Builder's PipelineProgress.tsx -- 400ms
// interval against the in-memory generation-status endpoint -- with this
// tool's own 3-stage pipeline instead of Spec Builder's 5.
export function DeepAnalysisProgress({ projectId, active }: DeepAnalysisProgressProps) {
  const [stage, setStage] = useState<string | null>(null)

  useEffect(() => {
    if (!active || !projectId) {
      setStage(null)
      return
    }
    let cancelled = false
    async function tick() {
      try {
        const res = await getGenerationStatus(projectId!)
        if (!cancelled && res.stage) setStage(res.stage)
      } catch {
        // Polling is best-effort; the main request carries the real errors.
      }
    }
    tick()
    const id = setInterval(tick, 400)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [active, projectId])

  if (!active) return null

  const currentIndex = STAGES.findIndex((s) => s.key === stage)

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Generation progress">
      {STAGES.map((s, i) => {
        const state = currentIndex === -1 ? 'pending' : i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'pending'
        return (
          <span key={s.key} className="flex items-center gap-1.5">
            {i > 0 ? <span className="text-neutral-300">→</span> : null}
            <span
              className={`rounded-md border px-2 py-1 text-[11px] font-medium ${
                state === 'done'
                  ? 'border-transparent bg-primary-light text-primary-dark'
                  : state === 'active'
                    ? 'animate-pulse border-primary text-primary'
                    : 'border-neutral-200 text-neutral-400'
              }`}
            >
              {state === 'done' ? '✓ ' : ''}
              {s.label}
            </span>
          </span>
        )
      })}
    </div>
  )
}
