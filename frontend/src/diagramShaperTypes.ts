export type DiagramShaperType = 'linear_process' | 'decision_flow' | 'hierarchy' | 'architecture' | 'timeline'

export type ShapeKind = 'oval' | 'rectangle' | 'diamond' | 'dot' | 'cylinder' | 'hexagon'

export interface DiagramShaperShape {
  id: string
  kind: ShapeKind
  x: number
  y: number
  w: number
  h: number
  label: string
  accent: boolean
  group_id?: string | null
}

export interface DiagramShaperConnector {
  id: string
  from_id: string
  to_id: string
  label?: string | null
  accent: boolean
}

export interface DiagramShaperGroup {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
}

export interface DiagramShaperResult {
  diagram_type: DiagramShaperType
  title: string
  shapes: DiagramShaperShape[]
  connectors: DiagramShaperConnector[]
  groups: DiagramShaperGroup[]
}

// The backend renders `result` (shapes/connectors/groups) to `html` once,
// server-side, at generate time -- the frontend never parses or re-derives
// SVG from the JSON itself, it just displays whatever the backend rendered.
export interface GenerateDiagramShaperResponse {
  result: DiagramShaperResult
  html: string
}

export type DiagramShaperWsProgressMessage =
  | { stage: 'calling_llm' }
  | { stage: 'done'; result: GenerateDiagramShaperResponse }
  | { stage: 'error'; message: string }
