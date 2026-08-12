export type ValidationSeverity = 'error' | 'warning'

export interface ValidationIssue {
  severity: ValidationSeverity
  code: string
  message: string
  node_id?: string | null
  edge_id?: string | null
}

export interface ExtractResponse {
  text: string
  filename: string
}
