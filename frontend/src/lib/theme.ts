import type { EdgeType, NodeType } from '../types'
import type { DiagramPalette } from './themes'

export interface NodeStyle {
  shape: 'pill' | 'rect' | 'diamond' | 'parallelogram' | 'subprocess' | 'cylinder'
  container: string
  label: string
}

export const nodeTheme: Record<NodeType, NodeStyle> = {
  start: {
    shape: 'pill',
    container: 'bg-primary border border-primary-dark text-white shadow-sm',
    label: 'font-semibold text-white',
  },
  end: {
    shape: 'pill',
    container: 'bg-neutral-900 border border-neutral-900 text-white shadow-sm',
    label: 'font-semibold text-white',
  },
  process: {
    shape: 'rect',
    container: 'bg-white border border-neutral-200 text-neutral-900 shadow-sm',
    label: 'font-medium',
  },
  decision: {
    shape: 'diamond',
    container: 'bg-accent-light border border-accent text-neutral-900 shadow-sm',
    label: 'font-medium',
  },
  io: {
    shape: 'parallelogram',
    container: 'bg-primary-light border border-primary text-neutral-900 shadow-sm',
    label: 'font-medium',
  },
  subprocess: {
    shape: 'subprocess',
    container: 'bg-white border-2 border-neutral-600 text-neutral-900 shadow-sm',
    label: 'font-medium',
  },
  database: {
    shape: 'cylinder',
    container: 'bg-white border border-neutral-300 text-neutral-900 shadow-sm',
    label: 'font-medium',
  },
}

// Architecture mode's category legend -- a fixed hue order (never cycled
// per-diagram, never hashed from the category id) so the same slot always
// reads the same across diagrams, the same principle as any categorical
// chart palette. Assigned by a category's position in `diagram.categories`
// (see getCategoryStyle), not by color-picking per node. Deliberately a
// separate ramp from the two-tone `DiagramPalette` in themes.ts -- that's
// built for a single primary/accent brand pairing, not 9 distinguishable
// category hues.
export interface CategoryStyle {
  fill: string
  border: string
  text: string
}

const CATEGORY_PALETTE: CategoryStyle[] = [
  { fill: '#e8f0f9', border: '#5b8fc7', text: '#1f5c99' }, // blue
  { fill: '#f8f1dd', border: '#c9a227', text: '#8a6d14' }, // gold
  { fill: '#eae6f6', border: '#8a6fc9', text: '#5c3fa0' }, // purple
  { fill: '#e3f3ee', border: '#3f9d7f', text: '#237557' }, // teal
  { fill: '#fbe9e7', border: '#d97757', text: '#a4502f' }, // terracotta
  { fill: '#fdf0dc', border: '#d97706', text: '#9a5a05' }, // amber
  { fill: '#fbe7ef', border: '#c9648f', text: '#9a3f66' }, // rose
  { fill: '#eaf1e1', border: '#7fa050', text: '#546f2f' }, // olive
  { fill: '#e6eef2', border: '#5a7f96', text: '#3c5b6d' }, // slate
]

export function getCategoryStyle(categoryIndex: number): CategoryStyle {
  return CATEGORY_PALETTE[categoryIndex % CATEGORY_PALETTE.length]
}

export type EdgeShape = 'bezier' | 'straight' | 'step' | 'smoothstep'

export const edgeShapeLabels: Record<EdgeShape, string> = {
  bezier: 'Curved',
  straight: 'Straight',
  step: 'Right-angle',
  smoothstep: 'Rounded right-angle',
}

export interface EdgeStyle {
  stroke: string
  strokeWidth: number
  strokeDasharray?: string
}

// Edge colors come from the active palette (not a static Tailwind class) because
// they're passed as raw SVG stroke props, not className. Default edges are
// drawn slightly heavier than conditional branches so the main path reads as
// the primary flow and branches read as secondary, instead of every line
// competing at the same visual weight.
export function getEdgeTheme(palette: DiagramPalette): Record<EdgeType, EdgeStyle> {
  return {
    default: { stroke: palette.neutral600, strokeWidth: 1.6 },
    conditional: { stroke: palette.accent, strokeWidth: 1.25, strokeDasharray: '5 3.5' },
  }
}

export const nodeTypeLabels: Record<NodeType, string> = {
  start: 'Start',
  end: 'End',
  process: 'Process',
  decision: 'Decision',
  io: 'Input / Output',
  subprocess: 'Subprocess',
  database: 'Database',
}
