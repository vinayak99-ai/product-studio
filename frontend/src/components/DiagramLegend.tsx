import { getCategoryStyle, nodeTheme, nodeTypeLabels } from '../lib/theme'
import type { FlowchartDiagram, NodeType } from '../types'

interface DiagramLegendProps {
  diagram: FlowchartDiagram
}

// Architecture mode's category/kind key, mirroring the legend row at the
// bottom of the reference Miro diagram. Self-guards on categories being
// empty (process-mode diagrams never populate them) instead of taking a
// separate "are we in architecture mode" flag, so callers can render it
// unconditionally.
export function DiagramLegend({ diagram }: DiagramLegendProps) {
  if (diagram.categories.length === 0) return null

  const categoryIndexById = new Map(diagram.categories.map((category, index) => [category.id, index]))
  const kindsPresent = Array.from(new Set(diagram.nodes.map((node) => node.type)))
  const hasExternal = diagram.nodes.some((node) => node.is_external)

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-neutral-200 bg-white px-4 py-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Owner</span>
        {diagram.categories.map((category) => {
          const style = getCategoryStyle(categoryIndexById.get(category.id)!)
          return (
            <span key={category.id} className="flex items-center gap-1.5 text-neutral-700">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: style.border }} />
              {category.label}
            </span>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-l border-neutral-200 pl-5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Kind</span>
        {kindsPresent.map((type) => (
          <span key={type} className="flex items-center gap-1.5 text-neutral-700">
            <KindSwatch type={type} />
            {nodeTypeLabels[type]}
          </span>
        ))}
        {hasExternal ? (
          <span className="flex items-center gap-1.5 text-neutral-700">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-white bg-emerald-500 shadow-sm" />
            External Vendor
          </span>
        ) : null}
      </div>
    </div>
  )
}

function KindSwatch({ type }: { type: NodeType }) {
  const shape = nodeTheme[type].shape
  const base = 'h-2.5 w-2.5 shrink-0 border border-neutral-400 bg-neutral-100'
  if (shape === 'diamond') return <span className={`${base} rotate-45`} />
  if (shape === 'pill' || shape === 'cylinder') return <span className={`${base} rounded-full`} />
  if (shape === 'parallelogram') return <span className={`${base} -skew-x-12`} />
  if (shape === 'subprocess') return <span className={`${base} border-2`} />
  return <span className={`${base} rounded-sm`} />
}
