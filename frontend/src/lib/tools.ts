import type { ComponentType, SVGProps } from 'react'
import {
  DataIcon,
  DesignThinkingIcon,
  DocQaIcon,
  FlowchartIcon,
  InfographicIcon,
  JiraIcon,
  SequenceIcon,
  SpecIcon,
  StoryIcon,
} from '../components/icons/ToolIcons'

export type ToolId =
  | 'design_thinking'
  | 'spec'
  | 'sequence'
  | 'flowchart'
  | 'infographic'
  | 'story'
  | 'doc_qa'
  | 'jira'
  | 'data'

export interface ToolDef {
  id: ToolId
  label: string
  status: 'ready' | 'soon'
  icon: ComponentType<SVGProps<SVGSVGElement>>
  description?: string
  sharedWith?: string
}

export const TOOLS: ToolDef[] = [
  {
    id: 'design_thinking',
    label: 'Design Thinking',
    status: 'ready',
    icon: DesignThinkingIcon,
    description:
      'Empathize, Define, Ideate, Prototype, and Test a problem before you spec it -- exports a ' +
      'markdown file you can upload straight into a new Spec Builder project.',
  },
  {
    id: 'spec',
    label: 'Spec Builder',
    status: 'ready',
    icon: SpecIcon,
  },
  {
    id: 'sequence',
    label: 'Sequence Diagram',
    status: 'ready',
    icon: SequenceIcon,
  },
  {
    id: 'flowchart',
    label: 'Flowchart Builder',
    status: 'ready',
    icon: FlowchartIcon,
  },
  {
    id: 'infographic',
    label: 'Infographic Builder',
    status: 'ready',
    icon: InfographicIcon,
  },
  {
    id: 'story',
    label: 'Story Builder',
    status: 'ready',
    icon: StoryIcon,
  },
  {
    id: 'doc_qa',
    label: 'Document Q&A',
    status: 'ready',
    icon: DocQaIcon,
    description:
      'Upload a document and get an instant summary, then ask follow-up questions — every ' +
      'answer grounded in the document itself, not outside knowledge.',
  },
  {
    id: 'jira',
    label: 'Jira',
    status: 'soon',
    icon: JiraIcon,
    description:
      'Connect a Jira project and pull its epics, stories, statuses, sprints, and comments ' +
      'straight into Product Studio — so a Spec Builder project can be enriched, cross-checked, ' +
      'and kept in sync against what is actually being delivered.',
    sharedWith: 'Feeds Spec Builder project enrichment; extends the existing Jira push/import already used there',
  },
  {
    id: 'data',
    label: 'Data Explorer',
    status: 'soon',
    icon: DataIcon,
    description:
      'Browse and query across every Spec Builder project at once — search stories and ' +
      'requirements by keyword, track epic impact and Jira delivery status portfolio-wide, ' +
      'without opening each project individually.',
    sharedWith: 'Reads across all Spec Builder projects',
  },
]
