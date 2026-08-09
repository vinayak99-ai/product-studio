import { useState } from 'react'
import { getProject } from '../lib/docQaApi'
import type { DocQaProjectDetail as DocQaProjectDetailType, DocQaProjectMeta } from '../docQaTypes'
import { DocQaProjectList } from './doc-qa/DocQaProjectList'
import { DocQaNewProject } from './doc-qa/DocQaNewProject'
import { DocQaProjectDetail } from './doc-qa/DocQaProjectDetail'

type View =
  | { name: 'list' }
  | { name: 'new' }
  | { name: 'detail'; detail: DocQaProjectDetailType }

export function DocQaPage() {
  const [view, setView] = useState<View>({ name: 'list' })

  const openProject = async (project: DocQaProjectMeta) => {
    const detail = await getProject(project.id)
    setView({ name: 'detail', detail })
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-50">
      {view.name === 'list' ? (
        <DocQaProjectList onSelect={openProject} onNew={() => setView({ name: 'new' })} />
      ) : null}
      {view.name === 'new' ? (
        <DocQaNewProject
          onCreated={(detail) => setView({ name: 'detail', detail })}
          onCancel={() => setView({ name: 'list' })}
        />
      ) : null}
      {view.name === 'detail' ? (
        <DocQaProjectDetail
          detail={view.detail}
          onChange={(detail) => setView({ name: 'detail', detail })}
          onBack={() => setView({ name: 'list' })}
        />
      ) : null}
    </div>
  )
}
