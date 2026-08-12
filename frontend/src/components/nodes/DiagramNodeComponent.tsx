import { useCallback, useState } from 'react'
import { Handle, NodeToolbar, Position, type Node, type NodeProps } from '@xyflow/react'
import { getCategoryStyle, nodeTheme, nodeTypeLabels } from '../../lib/theme'
import { NODE_WIDTH, NODE_HEIGHT, type DiagramNodeData } from '../../lib/elkLayout'
import type { NodeType } from '../../types'

export type DiagramNodeCallbacks = {
  onLabelChange?: (id: string, label: string) => void
  onTypeChange?: (id: string, type: NodeType) => void
  onCategoryChange?: (id: string, categoryId: string | null) => void
  onExternalToggle?: (id: string, isExternal: boolean) => void
  onDelete?: (id: string) => void
  onDuplicate?: (id: string) => void
}

export type DiagramFlowNode = Node<DiagramNodeData & DiagramNodeCallbacks, 'diagramNode'>

const ALL_NODE_TYPES = Object.keys(nodeTypeLabels) as NodeType[]

export function DiagramNodeComponent({ id, data, selected }: NodeProps<DiagramFlowNode>) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(data.label)
  const style = nodeTheme[data.type]
  // Architecture mode only -- process-mode nodes never carry a category_id,
  // so this is null there and every shape falls back to nodeTheme's static
  // type-based coloring exactly as before.
  const categoryStyle = data.categoryIndex !== undefined ? getCategoryStyle(data.categoryIndex) : null
  const categoryColorStyle = categoryStyle
    ? { backgroundColor: categoryStyle.fill, borderColor: categoryStyle.border, color: categoryStyle.text }
    : undefined

  const externalBadge = data.is_external ? (
    <div
      title="External vendor"
      className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 shadow-sm"
    />
  ) : null

  const commit = useCallback(() => {
    setIsEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== data.label) {
      data.onLabelChange?.(id, trimmed)
    } else {
      setDraft(data.label)
    }
  }, [draft, data, id])

  const selectedRing = selected ? 'ring-2 ring-offset-2 ring-primary' : ''

  const labelContent = isEditing ? (
    <input
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') {
          setDraft(data.label)
          setIsEditing(false)
        }
      }}
      className="w-full rounded border border-primary bg-white px-1 py-0.5 text-center text-xs text-neutral-900 outline-none"
      onClick={(event) => event.stopPropagation()}
    />
  ) : (
    <span
      className={`px-2 text-center text-xs leading-tight ${style.label}`}
      onDoubleClick={() => setIsEditing(true)}
    >
      {data.label}
    </span>
  )

  // Horizontal layouts (direction RIGHT) connect nodes left-to-right, so
  // handles need to sit on the left/right edges — fixed top/bottom handles
  // would force every edge into an S-curve to reach the next node sideways.
  const isHorizontal = data.handleDirection === 'RIGHT'
  const handles = (
    <>
      <Handle
        type="target"
        position={isHorizontal ? Position.Left : Position.Top}
        className="!bg-neutral-600"
      />
      <Handle
        type="source"
        position={isHorizontal ? Position.Right : Position.Bottom}
        className="!bg-neutral-600"
      />
    </>
  )

  // Manual authoring on top of whatever the LLM generated -- reassign type/
  // category, toggle the external badge, or delete, without a full
  // regenerate. Only category_id has options to pick from when the diagram
  // actually has a category legend (architecture mode); process-mode
  // diagrams just don't render that select.
  const categories = data.categories ?? []
  const toolbar = (
    <NodeToolbar isVisible={selected} position={Position.Top} offset={10}>
      <div
        className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1 shadow-md"
        onClick={(event) => event.stopPropagation()}
      >
        <select
          value={data.type}
          onChange={(event) => data.onTypeChange?.(id, event.target.value as NodeType)}
          className="rounded border border-neutral-200 bg-white px-1.5 py-1 text-[11px] text-neutral-700 outline-none"
        >
          {ALL_NODE_TYPES.map((type) => (
            <option key={type} value={type}>
              {nodeTypeLabels[type]}
            </option>
          ))}
        </select>
        {categories.length > 0 ? (
          <select
            value={data.category_id ?? ''}
            onChange={(event) => data.onCategoryChange?.(id, event.target.value || null)}
            className="rounded border border-neutral-200 bg-white px-1.5 py-1 text-[11px] text-neutral-700 outline-none"
          >
            <option value="">No category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          onClick={() => data.onExternalToggle?.(id, !data.is_external)}
          aria-pressed={!!data.is_external}
          title="Toggle external vendor"
          className={`rounded border px-1.5 py-1 text-[11px] font-medium ${
            data.is_external ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-neutral-200 text-neutral-500'
          }`}
        >
          Ext
        </button>
        <button
          type="button"
          onClick={() => data.onDuplicate?.(id)}
          title="Duplicate node"
          className="rounded border border-neutral-200 px-1.5 py-1 text-[11px] font-medium text-neutral-600 hover:bg-neutral-50"
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={() => data.onDelete?.(id)}
          title="Delete node"
          className="rounded border border-red-200 px-1.5 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50"
        >
          Delete
        </button>
      </div>
    </NodeToolbar>
  )

  // Sized per-label (see lib/nodeSizing.ts) instead of every node getting an
  // identical fixed box regardless of how much text it holds.
  const width = data.width ?? NODE_WIDTH
  const height = data.height ?? NODE_HEIGHT
  const boxStyle = { width, height }

  if (style.shape === 'diamond') {
    return (
      <div className={`relative flex items-center justify-center ${selectedRing}`} style={boxStyle}>
        {externalBadge}
        <div
          className={`absolute inset-0 ${style.container}`}
          style={{ clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)', ...categoryColorStyle }}
        />
        <div className="relative flex h-full w-full items-center justify-center px-7">{labelContent}</div>
        {handles}
        {toolbar}
      </div>
    )
  }

  if (style.shape === 'parallelogram') {
    return (
      <div className={`relative flex items-center justify-center ${selectedRing}`} style={boxStyle}>
        {externalBadge}
        <div className={`absolute inset-0 -skew-x-12 rounded-sm ${style.container}`} style={categoryColorStyle} />
        <div className="relative flex h-full w-full items-center justify-center">{labelContent}</div>
        {handles}
        {toolbar}
      </div>
    )
  }

  if (style.shape === 'subprocess') {
    return (
      <div
        className={`relative flex items-center justify-center rounded-lg ${style.container} ${selectedRing}`}
        style={{ ...boxStyle, ...categoryColorStyle }}
      >
        {externalBadge}
        <div className="pointer-events-none absolute inset-y-0 left-1.5 w-px bg-neutral-600" />
        <div className="pointer-events-none absolute inset-y-0 right-1.5 w-px bg-neutral-600" />
        {labelContent}
        {handles}
        {toolbar}
      </div>
    )
  }

  if (style.shape === 'cylinder') {
    // Simplified DB icon: a flat ellipse cap overlapping a body whose
    // bottom corners are rounded into the same ellipse radius -- reads
    // clearly as "database" without needing a hand-drawn SVG path.
    const capHeight = Math.max(12, Math.round(height * 0.22))
    return (
      <div className={`relative ${selectedRing}`} style={boxStyle}>
        {externalBadge}
        <div
          className="absolute inset-x-0 bottom-0 border-x border-b bg-white border-neutral-300 shadow-sm"
          style={{
            top: capHeight / 2,
            borderBottomLeftRadius: capHeight,
            borderBottomRightRadius: capHeight,
            ...categoryColorStyle,
          }}
        />
        <div
          className={`absolute inset-x-0 top-0 rounded-full ${style.container}`}
          style={{ height: capHeight, ...categoryColorStyle }}
        />
        <div
          className="relative flex h-full w-full items-center justify-center px-2 text-center"
          style={{ paddingTop: capHeight * 0.7 }}
        >
          {labelContent}
        </div>
        {handles}
        {toolbar}
      </div>
    )
  }

  const roundedClass = style.shape === 'pill' ? 'rounded-full' : 'rounded-xl'

  return (
    <div
      className={`relative flex items-center justify-center ${roundedClass} ${style.container} ${selectedRing}`}
      style={{ ...boxStyle, ...categoryColorStyle }}
    >
      {externalBadge}
      {labelContent}
      {handles}
      {toolbar}
    </div>
  )
}
