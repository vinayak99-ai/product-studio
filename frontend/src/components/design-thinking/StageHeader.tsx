import { STAGES, type DesignThinkingStage } from '../../designThinkingTypes'

interface StageHeaderProps {
  problemArea: string
  onProblemAreaChange: (value: string) => void
  activeStage: DesignThinkingStage
  furthestIndex: number
  onSelectStage: (stage: DesignThinkingStage) => void
  onExport: () => void
  exportBusy: boolean
  canExport: boolean
}

export function StageHeader({
  problemArea,
  onProblemAreaChange,
  activeStage,
  furthestIndex,
  onSelectStage,
  onExport,
  exportBusy,
  canExport,
}: StageHeaderProps) {
  return (
    <div className="border-b border-neutral-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <input
            value={problemArea}
            onChange={(e) => onProblemAreaChange(e.target.value)}
            placeholder="What problem are you exploring? (required)"
            className="min-w-0 flex-1 border-none bg-transparent text-sm font-semibold text-neutral-900 outline-none placeholder:text-neutral-400"
          />
          {!problemArea.trim() ? (
            <span className="shrink-0 text-sm font-semibold text-red-500" title="A title is required before you can generate personas">
              *
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onExport}
          disabled={!canExport || exportBusy}
          className="shrink-0 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exportBusy ? 'Exporting…' : 'Export Markdown'}
        </button>
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        {STAGES.map((stage, i) => {
          const reachable = i <= furthestIndex
          const isActive = stage.id === activeStage
          return (
            <button
              key={stage.id}
              type="button"
              disabled={!reachable}
              onClick={() => onSelectStage(stage.id)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                isActive
                  ? 'bg-primary text-white'
                  : reachable
                    ? 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                    : 'cursor-not-allowed bg-neutral-50 text-neutral-300'
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                  isActive ? 'bg-white/25' : 'bg-white'
                }`}
              >
                {i + 1}
              </span>
              {stage.label}
              {i < STAGES.length - 1 ? <span className="ml-1 text-neutral-300">→</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
