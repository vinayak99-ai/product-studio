export type DiagramSlideType =
  | 'linear_process'
  | 'decision_flow'
  | 'hierarchy'
  | 'architecture'
  | 'timeline'
  | 'swimlane'
  | 'process'
  | 'er'
  | 'state'
  | 'loop'

export interface DiagramSlideResult {
  diagram_type: DiagramSlideType
  title: string
  html: string
}

export interface GenerateDiagramSlideResponse {
  result: DiagramSlideResult
}

export type DiagramSlideWsProgressMessage =
  | { stage: 'calling_llm' }
  | { stage: 'done'; result: GenerateDiagramSlideResponse }
  | { stage: 'error'; message: string }
