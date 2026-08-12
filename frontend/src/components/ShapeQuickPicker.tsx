import { useEffect, useLayoutEffect, useRef } from 'react'
import { nodeTheme, nodeTypeLabels } from '../lib/theme'
import type { NodeType } from '../types'

interface ShapeQuickPickerProps {
  screenPosition: { x: number; y: number }
  onPick: (type: NodeType) => void
  onDismiss: () => void
}

const SHAPE_ORDER: NodeType[] = ['process', 'decision', 'io', 'subprocess', 'database', 'start', 'end']

// Tiny static previews of the same shapes DiagramNodeComponent renders at
// full size, built from the same nodeTheme container classes so a shape
// picked here always matches what actually lands on the canvas.
function ShapePreview({ type }: { type: NodeType }) {
  const style = nodeTheme[type]
  if (style.shape === 'diamond') {
    return (
      <div className={`h-5 w-7 ${style.container}`} style={{ clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' }} />
    )
  }
  if (style.shape === 'parallelogram') {
    return <div className={`h-5 w-7 -skew-x-12 rounded-sm ${style.container}`} />
  }
  if (style.shape === 'subprocess') {
    return (
      <div className={`relative h-5 w-7 rounded ${style.container}`}>
        <div className="pointer-events-none absolute inset-y-0 left-1 w-px bg-neutral-600" />
        <div className="pointer-events-none absolute inset-y-0 right-1 w-px bg-neutral-600" />
      </div>
    )
  }
  if (style.shape === 'cylinder') {
    return (
      <div className="relative h-5 w-7">
        <div className="absolute inset-x-0 bottom-0 top-1.5 rounded-b-full border-x border-b border-neutral-300 bg-white" />
        <div className={`absolute inset-x-0 top-0 h-2 rounded-full ${style.container}`} />
      </div>
    )
  }
  const roundedClass = style.shape === 'pill' ? 'rounded-full' : 'rounded'
  return <div className={`h-5 w-7 ${roundedClass} ${style.container}`} />
}

export function ShapeQuickPicker({ screenPosition, onPick, onDismiss }: ShapeQuickPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onDismiss()
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onDismiss])

  // Keeps the popup fully on-screen when the triggering point is near a
  // viewport edge (bottom-right double-click, "+ Add node" button hugging
  // the top-left corner, etc.) instead of letting it hang off and clip.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const overflowX = rect.right - window.innerWidth
    const overflowY = rect.bottom - window.innerHeight
    if (overflowX > 0) el.style.left = `${Math.max(8, screenPosition.x - overflowX - 8)}px`
    if (overflowY > 0) el.style.top = `${Math.max(8, screenPosition.y - overflowY - 8)}px`
  }, [screenPosition])

  return (
    <div
      ref={containerRef}
      className="fixed z-50 grid grid-cols-2 gap-1 rounded-lg border border-neutral-200 bg-white p-1.5 shadow-lg"
      style={{ left: screenPosition.x, top: screenPosition.y }}
    >
      {SHAPE_ORDER.map((type) => (
        <button
          key={type}
          type="button"
          onClick={() => onPick(type)}
          className="flex flex-col items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
        >
          <ShapePreview type={type} />
          {nodeTypeLabels[type]}
        </button>
      ))}
    </div>
  )
}
