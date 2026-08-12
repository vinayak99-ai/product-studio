import type { InfographicDiagram } from './infographicTypes'

export interface StorySourceProject {
  id: string
  name: string
  has_prd: boolean
}

export interface StoryBeatPlan {
  label: string
  template: InfographicDiagram['template']
  topic: string
  start_minute: number
  end_minute: number
}

export interface StoryPlan {
  title: string
  framework: string
  beats: StoryBeatPlan[]
}

export interface StoryBeat {
  label: string
  start_minute: number
  end_minute: number
  narration: string
  slide: InfographicDiagram
}

export interface StoryScript {
  title: string
  total_minutes: number
  framework: string
  source_project_id: string | null
  source_project_name: string
  beats: StoryBeat[]
}

export const STORY_FRAMEWORK_LABEL: Record<string, string> = {
  minto_pyramid: 'Minto Pyramid',
  scqa: 'SCQA',
  pas: 'Problem–Agitate–Solution',
  before_after_bridge: 'Before → After → Bridge',
}

export function storyFrameworkLabel(framework: string): string {
  return STORY_FRAMEWORK_LABEL[framework] ?? framework
}

export type StoryWsProgressMessage =
  | { stage: 'planning' }
  | { stage: 'plan_ready'; plan: StoryPlan }
  | { stage: 'generating'; completed: number; total: number }
  | { stage: 'done'; result: StoryScript }
  | { stage: 'error'; message: string }
