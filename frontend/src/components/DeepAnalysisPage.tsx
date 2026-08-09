import { useState } from 'react'
import { getDocument } from '../lib/deepAnalysisApi'
import { useDeepAnalysisClarify } from '../lib/useDeepAnalysisClarify'
import type { DeepAnalysisDocument, GenerateResponse, ProjectListItem } from '../deepAnalysisTypes'
import { DeepAnalysisProjectList } from './deep-analysis/DeepAnalysisProjectList'
import { DeepAnalysisNewProject } from './deep-analysis/DeepAnalysisNewProject'
import { DeepAnalysisClarifyPanel } from './deep-analysis/DeepAnalysisClarifyPanel'
import { DeepAnalysisDocumentView } from './deep-analysis/DeepAnalysisDocumentView'

type View =
  | { name: 'list' }
  | { name: 'new' }
  | { name: 'clarify'; projectId: string; projectName: string; initial: GenerateResponse }
  | { name: 'detail'; projectId: string; projectName: string; artifactId: string; document: DeepAnalysisDocument }

export function DeepAnalysisPage() {
  const [view, setView] = useState<View>({ name: 'list' })

  const openProject = async (project: ProjectListItem) => {
    const res = await getDocument(project.id)
    if (res.document && res.artifact_id) {
      setView({ name: 'detail', projectId: project.id, projectName: project.name, artifactId: res.artifact_id, document: res.document })
    } else {
      // Not generated yet -- either untouched (kick off /new) or mid-interview
      // (pending_clarification.json exists server-side). The list's own
      // summary already distinguishes these, but the simplest re-entry for
      // "clarifying" is to just resume via a fresh clarify round trigger --
      // so for now, mid-interview projects also land on New (raw notes are
      // preserved server-side and generate() with the same notes will hit
      // the still-pending round through /clarify's own state). Simpler: send
      // clarifying-stage projects to New too since raw notes aren't lost.
      setView({ name: 'new' })
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-50">
      {view.name === 'list' ? (
        <DeepAnalysisProjectList onSelect={openProject} onNew={() => setView({ name: 'new' })} />
      ) : null}

      {view.name === 'new' ? (
        <DeepAnalysisNewProject
          onNeedsClarification={(projectId, projectName, initial) =>
            setView({ name: 'clarify', projectId, projectName, initial })
          }
          onGenerated={(projectId, artifactId, document) =>
            setView({ name: 'detail', projectId, projectName: document.title, artifactId, document })
          }
          onCancel={() => setView({ name: 'list' })}
        />
      ) : null}

      {view.name === 'clarify' ? (
        <ClarifyLoop
          key={view.projectId}
          projectId={view.projectId}
          projectName={view.projectName}
          initial={view.initial}
          onGenerated={(artifactId, document) =>
            setView({ name: 'detail', projectId: view.projectId, projectName: document.title, artifactId, document })
          }
        />
      ) : null}

      {view.name === 'detail' ? (
        <DeepAnalysisDocumentView
          projectId={view.projectId}
          projectName={view.projectName}
          artifactId={view.artifactId}
          document={view.document}
          onDocumentChange={(artifactId, document) =>
            setView({ name: 'detail', projectId: view.projectId, projectName: document.title, artifactId, document })
          }
          onNeedsClarification={(response) =>
            setView({ name: 'clarify', projectId: view.projectId, projectName: view.projectName, initial: response })
          }
          onBack={() => setView({ name: 'list' })}
        />
      ) : null}
    </div>
  )
}

interface ClarifyLoopProps {
  projectId: string
  projectName: string
  initial: GenerateResponse
  onGenerated: (artifactId: string, document: DeepAnalysisDocument) => void
}

function ClarifyLoop({ projectId, projectName, initial, onGenerated }: ClarifyLoopProps) {
  const clarify = useDeepAnalysisClarify(projectId, initial, onGenerated)
  return (
    <DeepAnalysisClarifyPanel
      projectName={projectName}
      round={clarify.round}
      maxRounds={clarify.maxRounds}
      questionsUsed={clarify.questionsUsed}
      maxQuestions={clarify.maxQuestions}
      questions={clarify.questions}
      answeredHistory={clarify.answeredHistory}
      answers={clarify.answers}
      onAnswerChange={clarify.setAnswer}
      onSubmit={() => clarify.submit(false)}
      onSkip={() => clarify.submit(true)}
      busy={clarify.busy}
      error={clarify.error}
    />
  )
}
