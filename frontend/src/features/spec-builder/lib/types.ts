export type StepId = "overview" | "stories" | "requirements" | "test_cases" | "architecture" | "epics"

export const STEP_ORDER: StepId[] = [
  "overview", "stories", "requirements", "test_cases", "architecture", "epics",
]

export type StepStatus = "not_started" | "needs_clarification" | "drafted" | "confirmed" | "stale"

export interface StepState {
  status: StepStatus
  confirmed_at: string | null
  confirmed_version: number | null
}

export interface PipelineState {
  steps: Record<StepId, StepState>
  current_step: StepId
}

export interface ProjectSummary {
  stage: "empty" | "clarifying" | "in_progress" | "complete"
  current_step: StepId | null
  pending_questions: number
  epic_count: number
  high_impact_epics: number
  proposed_adrs: number
  in_jira: boolean
  last_version_reason: string | null
}

export interface ProjectMeta {
  id: string
  name: string
  created_at: string
  updated_at: string
  // Null until each has happened at least once. Compare the two to show
  // "input changed since this spec was generated" without full input
  // version history.
  input_updated_at: string | null
  last_generated_at: string | null
  // Present on list responses; absent on create/rename responses.
  summary?: ProjectSummary
}

export interface AcceptanceScenario {
  given: string
  when: string
  then: string
}

export interface UserStory {
  title: string
  priority: string
  description: string
  why_this_priority: string
  independent_test: string
  acceptance_scenarios: AcceptanceScenario[]
}

export interface FunctionalRequirement {
  id: string
  text: string
  kind: "functional" | "non_functional"
}

export interface KeyEntity {
  name: string
  description: string
}

export interface AcceptanceTest {
  id: string
  fr_id: string
  title: string
  given: string
  when: string
  then: string
}

export interface Persona {
  id: string
  name: string
  description: string
  pain_points: string[]
}

export interface UseCase {
  id: string
  title: string
  actor: string
  goal: string
  trigger: string
}

export type DiagramType = "journey" | "sequence"

export interface Diagram {
  diagram_type: DiagramType
  title: string
  mermaid_source: string
  png_base64: string | null
}

export type AdrStatus = "proposed" | "accepted"

export interface ArchitectureDecision {
  id: string
  title: string
  context: string
  decision: string
  consequences: string
  status: AdrStatus
}

export type StoryType = "functional" | "technical"

export interface EpicStory {
  id: string
  story_type: StoryType
  title: string
  description: string
  acceptance_criteria: string[]
  jira_key: string | null
  jira_status: string | null
  notes: string | null
}

export type BusinessImpact = "high" | "medium" | "low"

export interface Epic {
  id: string
  title: string
  description: string
  stories: EpicStory[]
  jira_key: string | null
  jira_status: string | null
  business_impact: BusinessImpact
  business_impact_rationale: string
}

export interface ScopeCheckVerdict {
  classification: "cosmetic" | "scope_change"
  rationale: string
  affected_downstream_steps: StepId[]
}

export type CompletenessSeverity = "high" | "medium" | "low"

export interface CompletenessIssue {
  id: string
  severity: CompletenessSeverity
  area: string
  description: string
  related_ids: string[]
}

export interface CompletenessReview {
  issues: CompletenessIssue[]
  reviewed_at: string
  reviewed_version: number
}

export interface GeneratedPRD {
  title: string
  // ---- Step 1: Overview ----
  problem_statement: string
  goals: string[]
  target_users: string[]
  open_questions: string[]
  personas: Persona[]
  use_cases: UseCase[]
  // ---- Step 2: User Stories + Edge Cases ----
  user_stories: UserStory[]
  edge_cases: string[]
  // ---- Step 3: Functional Requirements ----
  functional_requirements: FunctionalRequirement[]
  key_entities: KeyEntity[]
  assumptions: string[]
  // ---- Step 4: Test Cases (per-FR acceptance tests) ----
  test_cases: AcceptanceTest[]
  diagrams: Diagram[]
  // ---- Step 5: Architecture ----
  architecture_decisions: ArchitectureDecision[]
  technical_context: AnsweredClarification[]
  architecture_clarify_history: AnsweredClarification[]
  // ---- Step 6: Epics ----
  epics: Epic[]
  briefs: StakeholderBrief[]
  updates: ComposedUpdate[]
  // ---- Pipeline metadata ----
  pipeline: PipelineState
  completeness_review: CompletenessReview | null
}

export interface ClarifyQuestion {
  id: string
  category: string
  question: string
  options: string[]
  recommended: string | null
}

export interface AnsweredClarification {
  question: ClarifyQuestion
  answer: string
}

export interface SpecInput {
  raw_notes: string
  clarifications: AnsweredClarification[]
  updated_at: string
}

export interface StepGenerateResponse {
  status: "needs_clarification" | "drafted"
  questions: ClarifyQuestion[]
  artifact_id: string | null
  prd: GeneratedPRD | null
}

export interface StepEditResponse {
  prd: GeneratedPRD
  scope_check: ScopeCheckVerdict | null
  cascaded_to: StepId[]
}

export type ExportFormat = "md" | "docx" | "csv" | "epics-csv"

export interface JiraStatus {
  configured: boolean
  project_key: string | null
  base_url: string | null
}

export type JiraItemType = "epic" | "story"
export type JiraPushStatus = "created" | "skipped" | "error"

export interface JiraPushResult {
  id: string
  item_type: JiraItemType
  status: JiraPushStatus
  jira_key: string | null
  detail: string | null
}

export interface JiraExportResponse {
  prd: GeneratedPRD
  results: JiraPushResult[]
}

export interface JiraImportResponse {
  prd: GeneratedPRD
  unmapped_requirements: string[]
}

export interface JiraSyncResponse {
  prd: GeneratedPRD
  updated: number
  unchanged: number
}

export type BriefAudience = "executive" | "engineering" | "sales"
export type StakeholderLevel = "high" | "medium" | "low"

export interface Stakeholder {
  id: string
  name: string
  role: string
  audience: BriefAudience
  influence: StakeholderLevel
  interest: StakeholderLevel
  cares_about: string
}

export interface GlossaryTerm {
  id: string
  term: string
  definition: string
}

export interface BriefSection {
  heading: string
  body: string
}

export interface StakeholderBrief {
  audience: BriefAudience
  title: string
  sections: BriefSection[]
  key_asks: string[]
  // Artifact version this brief was generated at (null on old briefs).
  source_version: number | null
}

export type UpdateAudience = "all" | BriefAudience

export interface ComposedUpdate {
  id: string
  audience: UpdateAudience
  from_version: number
  to_version: number
  created_at: string
  title: string
  summary: string
  sections: BriefSection[]
  decisions_needed: string[]
}

export interface ArtifactVersionMeta {
  version: number
  saved_at: string
  reason: string
  cascaded_to: StepId[]
}

export interface DiffEntry {
  section: string
  change: "added" | "removed" | "modified"
  item: string
  detail: string
}
