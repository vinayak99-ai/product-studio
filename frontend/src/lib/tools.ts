import type { ComponentType, SVGProps } from 'react'
import {
  DataIcon,
  DeepAnalysisIcon,
  DesignThinkingIcon,
  DiagramSlideIcon,
  DiscoveryQaIcon,
  DocQaIcon,
  InfographicIcon,
  JiraIcon,
  KnowledgeBaseIcon,
  SequenceIcon,
  SpecIcon,
  StoryIcon,
  SystemMapIcon,
} from '../components/icons/ToolIcons'

export type ToolId =
  | 'design_thinking'
  | 'spec'
  | 'deep_analysis'
  | 'sequence'
  | 'diagram_slide'
  | 'infographic'
  | 'story'
  | 'doc_qa'
  | 'knowledge_base'
  | 'discovery_qa'
  | 'jira'
  | 'system_map'
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
    id: 'deep_analysis',
    label: 'Deep Analysis',
    status: 'ready',
    icon: DeepAnalysisIcon,
    description:
      'Paste or upload a document describing a problem and work through an extensive ' +
      'clarifying interview -- up to 10 questions a round, up to 10 rounds -- to build a ' +
      'deep, structured analysis: background, prior attempts, root causes, stakeholders, ' +
      'constraints, and open risks. Not a spec -- a comprehensive hold on the problem itself.',
  },
  {
    id: 'sequence',
    label: 'Sequence Diagram',
    status: 'ready',
    icon: SequenceIcon,
  },
  {
    id: 'diagram_slide',
    label: 'Diagram Slides',
    status: 'ready',
    icon: DiagramSlideIcon,
    description:
      'Describe a process, decision flow, hierarchy, architecture, or timeline and get a ' +
      'hand-composed diagram -- shape encodes meaning, one accent color, no crisscrossing ' +
      'layout-engine routing -- exported as a full-bleed slide image.',
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
    id: 'knowledge_base',
    label: 'Knowledge Base',
    status: 'ready',
    icon: KnowledgeBaseIcon,
    description:
      'Organize markdown docs from multiple teams into named collections (backed by ' +
      'ChromaDB), search across one or several at once, and get a cited, markdown-formatted ' +
      'answer grounded in exactly which document it came from.',
  },
  {
    id: 'discovery_qa',
    label: 'Discovery Q&A',
    status: 'ready',
    icon: DiscoveryQaIcon,
    description:
      'Turn a spec\'s edge cases into interview questions, ask them live and capture answers ' +
      'one at a time, enrich with LLM polish, and export the whole thing as meeting minutes.',
    sharedWith: 'Draws candidate questions from a Spec Builder project\'s generated spec',
  },
  {
    id: 'jira',
    label: 'Jira',
    status: 'ready',
    icon: JiraIcon,
    description:
      'Connect a Jira project and pull every epic, story, task, and bug — status, assignee, ' +
      'priority, sprint, story points — straight into Product Studio, then attach it to a Spec ' +
      'Builder project to enrich its epics and stories.',
    sharedWith: 'Feeds Spec Builder project enrichment via the existing Jira import agent',
  },
  {
    id: 'system_map',
    label: 'System Map',
    status: 'ready',
    icon: SystemMapIcon,
    description:
      'Turn documents about your systems into a reviewed, versioned integration graph -- systems, ' +
      'data flows, and PII fields -- then trace PII flows, find cycles and orphans, and check paths ' +
      'between systems with NetworkX.',
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
