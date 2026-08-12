import { useState } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeToolbar,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react'
import { getEdgeTheme, type EdgeShape } from '../../lib/theme'
import { themePalettes, type ThemeName } from '../../lib/themes'
import type { EdgeType } from '../../types'
import type { Box, Waypoint } from '../../lib/elkLayout'
import { buildRoutedPath, clampLabelToBoxes } from '../../lib/edgeRouting'

const EDGE_TYPE_LABELS: Record<EdgeType, string> = {
  default: 'Default',
  conditional: 'Conditional',
}

export type DiagramFlowEdge = Edge<
  {
    type: EdgeType
    edgeShape?: EdgeShape
    themeName?: ThemeName
    waypoints?: Waypoint[]
    nodeBoxes?: Box[]
    onTypeChange?: (id: string, type: EdgeType) => void
    onLabelChange?: (id: string, label: string) => void
    onDelete?: (id: string) => void
  },
  'diagramEdge'
>

export function DiagramEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  label,
  markerEnd,
  selected,
}: EdgeProps<DiagramFlowEdge>) {
  const [labelDraft, setLabelDraft] = useState(typeof label === 'string' ? label : '')
  const [isHovered, setIsHovered] = useState(false)
  const pathParams = { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }
  const shape = data?.edgeShape ?? 'bezier'

  // "Straight" means a literal direct line by definition — same as a
  // straight connector in any diagramming tool, it can't bend around a node
  // and stay straight. Every other shape routes through ELK's obstacle-
  // avoiding waypoints (when there are more than just the two endpoints)
  // instead of a naive point-to-point curve that can cut through other nodes.
  const routed =
    shape !== 'straight' && data?.waypoints && data.waypoints.length > 2
      ? buildRoutedPath({
          waypoints: data.waypoints,
          sourceX,
          sourceY,
          targetX,
          targetY,
          rounded: shape === 'bezier' || shape === 'smoothstep',
          nodeBoxes: data?.nodeBoxes,
        })
      : null

  const [edgePath, routedLabelX, routedLabelY] =
    routed ??
    (shape === 'straight'
      ? getStraightPath(pathParams)
      : shape === 'step'
        ? getSmoothStepPath({ ...pathParams, borderRadius: 0 })
        : shape === 'smoothstep'
          ? getSmoothStepPath(pathParams)
          : getBezierPath(pathParams))

  // buildRoutedPath already searched for a box-clear point when `routed` is
  // set. React Flow's own path helpers (used for a direct, bend-free edge)
  // have no such awareness, so their raw midpoint still needs the same
  // clamp against the real node boxes.
  const [labelX, labelY] = routed
    ? [routedLabelX, routedLabelY]
    : clampLabelToBoxes(routedLabelX, routedLabelY, sourceX, sourceY, targetX, targetY, data?.nodeBoxes)

  const palette = themePalettes[data?.themeName ?? 'fidelity-green']
  const style = getEdgeTheme(palette)[data?.type ?? 'default']

  return (
    // Wrapping group carries the hover state -- a thin line is an easy
    // miss to click, so hovering (over a hit-path much wider than the
    // visible stroke, via interactionWidth below) both confirms "this is
    // clickable" and makes the target itself easier to land on.
    <g onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)} style={{ cursor: 'pointer' }}>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        interactionWidth={28}
        style={{
          stroke: style.stroke,
          strokeWidth: isHovered ? style.strokeWidth + 1 : style.strokeWidth,
          strokeDasharray: style.strokeDasharray,
        }}
      />
      {label ? (
        <EdgeLabelRenderer>
          <div
            // No border/shadow chip -- with many conditional branches, a bordered
            // box per label reads as clutter competing with the actual node boxes.
            // Color-matching the text to the edge's own stroke ties a label to its
            // line without needing a container to do that job.
            className="absolute rounded bg-white/85 px-1 py-0.5 text-[10px] font-semibold"
            style={{
              color: style.stroke,
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}

      {/* Manual editing on top of whatever the LLM generated or a
          hand-drawn connection started as -- retype, relabel, or delete,
          same toolbar-on-selection pattern as DiagramNodeComponent. */}
      <EdgeToolbar edgeId={id} x={labelX} y={labelY} isVisible={!!selected}>
        <div
          className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1 shadow-md"
          onClick={(event) => event.stopPropagation()}
        >
          <select
            value={data?.type ?? 'default'}
            onChange={(event) => data?.onTypeChange?.(id, event.target.value as EdgeType)}
            className="rounded border border-neutral-200 bg-white px-1.5 py-1 text-[11px] text-neutral-700 outline-none"
          >
            {(Object.keys(EDGE_TYPE_LABELS) as EdgeType[]).map((type) => (
              <option key={type} value={type}>
                {EDGE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <input
            value={labelDraft}
            onChange={(event) => setLabelDraft(event.target.value)}
            onBlur={() => data?.onLabelChange?.(id, labelDraft.trim())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
            }}
            placeholder="Label"
            className="w-24 rounded border border-neutral-200 bg-white px-1.5 py-1 text-[11px] text-neutral-700 outline-none"
          />
          <button
            type="button"
            onClick={() => data?.onDelete?.(id)}
            title="Delete edge"
            className="rounded border border-red-200 px-1.5 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </EdgeToolbar>
    </g>
  )
}
