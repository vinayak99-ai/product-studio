import type { ComponentType, SVGProps } from 'react'
import {
  DataIcon,
  DesignThinkingIcon,
  DocQaIcon,
  FlowchartIcon,
  InfographicIcon,
  ReportIcon,
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
  | 'reports'
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
    id: 'reports',
    label: 'Report Generator',
    status: 'soon',
    icon: ReportIcon,
    description:
      'Turn a Spec Builder project — its stories, requirements, epics, and stakeholder ' +
      'briefs — into a branded PDF or slide deck for leadership review, using the same ' +
      'export pipeline Flowchart Builder already runs on PNG/PDF/PPTX.',
    sharedWith: 'Reads Spec Builder projects, shares export engine with Flowchart Builder',
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
