export type NodeType = 'start' | 'end' | 'process' | 'decision' | 'io' | 'subprocess' | 'database'
export type EdgeType = 'default' | 'conditional'

export interface DiagramCategory {
  id: string
  label: string
}

export interface DiagramNode {
  id: string
  type: NodeType
  label: string
  group_id?: string | null
  category_id?: string | null
  is_external?: boolean
}

export interface DiagramEdge {
  id: string
  source: string
  target: string
  type: EdgeType
  label?: string | null
}

export interface DiagramGroup {
  id: string
  label: string
}

export interface FlowchartDiagram {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  groups: DiagramGroup[]
  categories: DiagramCategory[]
}

export type DiagramStyle = 'process' | 'architecture'

export type ValidationSeverity = 'error' | 'warning'

export interface ValidationIssue {
  severity: ValidationSeverity
  code: string
  message: string
  node_id?: string | null
  edge_id?: string | null
}

export type ArchetypeId =
  | 'linear'
  | 'approval_gate'
  | 'validation_retry'
  | 'routing_decision'
  | 'fork_join'
  | 'custom'

export interface GenerateResponse {
  diagram: FlowchartDiagram
  issues: ValidationIssue[]
  archetype?: ArchetypeId | null
}

export interface ExtractResponse {
  text: string
  filename: string
}

export type WsProgressMessage =
  | { stage: 'classifying' }
  | { stage: 'calling_llm' }
  | { stage: 'validating' }
  | { stage: 'done'; result: GenerateResponse }
  | { stage: 'error'; message: string }
