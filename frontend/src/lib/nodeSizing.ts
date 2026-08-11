import type { NodeType } from '../types'

// Matches the label's actual rendered font (index.css --font-sans, text-xs).
const FONT = '500 12px Inter, ui-sans-serif, system-ui, sans-serif'

const MIN_WIDTH = 140
const MAX_WIDTH = 260
export const BASE_HEIGHT = 72
const LINE_HEIGHT = 16
// Horizontal padding inside the box (px-2 label padding plus breathing room
// so text never touches the border).
const H_PADDING = 40

// Decision (diamond) and IO (parallelogram) shapes have a smaller usable
// interior than their bounding box -- text has to clear the diagonal edges,
// not just the box edges -- so they need a bigger box than a rectangle would
// for the same label.
const SHAPE_SIZE_MULTIPLIER: Record<NodeType, { width: number; height: number }> = {
  start: { width: 1, height: 1 },
  end: { width: 1, height: 1 },
  process: { width: 1, height: 1 },
  subprocess: { width: 1, height: 1 },
  decision: { width: 1.5, height: 1.5 },
  io: { width: 1.25, height: 1 },
  // Cylinder's curved top/bottom eat into usable interior height the same
  // way decision/io's diagonal edges eat into theirs.
  database: { width: 1, height: 1.2 },
}

let measureCtx: CanvasRenderingContext2D | null = null

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  if (!measureCtx) {
    const canvas = document.createElement('canvas')
    measureCtx = canvas.getContext('2d')
    if (measureCtx) measureCtx.font = FONT
  }
  return measureCtx
}

export interface NodeSize {
  width: number
  height: number
}

/** Sizes a node's box to fit its label instead of forcing every node to the
 *  same fixed 200x72 regardless of content. */
export function measureNodeSize(label: string, type: NodeType): NodeSize {
  const ctx = getMeasureContext()
  const multiplier = SHAPE_SIZE_MULTIPLIER[type]

  // SSR/no-canvas fallback: estimate ~6.5px per character at this font size.
  const textWidth = ctx ? ctx.measureText(label).width : label.length * 6.5

  const idealWidth = textWidth + H_PADDING
  const singleLineWidth = Math.min(Math.max(idealWidth, MIN_WIDTH), MAX_WIDTH)

  const availableTextWidth = MAX_WIDTH - H_PADDING
  const lines = textWidth > availableTextWidth ? Math.ceil(textWidth / availableTextWidth) : 1
  const height = lines > 1 ? BASE_HEIGHT + (lines - 1) * LINE_HEIGHT : BASE_HEIGHT

  return {
    width: Math.round(singleLineWidth * multiplier.width),
    height: Math.round(height * multiplier.height),
  }
}
