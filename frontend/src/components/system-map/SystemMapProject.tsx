import { useEffect, useState } from 'react'
import { getProject } from '../../lib/systemMapApi'
import type { ProjectMeta } from '../../systemMapTypes'
import { SystemMapDocuments } from './SystemMapDocuments'
import { SystemMapMergeReview } from './SystemMapMergeReview'
import { SystemMapGraph } from './SystemMapGraph'
import { SystemMapAnalysis } from './SystemMapAnalysis'

type Tab = 'documents' | 'merge' | 'graph' | 'analysis'

const TABS: { id: Tab; label: string }[] = [
  { id: 'documents', label: 'Documents' },
  { id: 'merge', label: 'Merge Review' },
  { id: 'graph', label: 'Graph' },
  { id: 'analysis', label: 'Analysis' },
]

interface SystemMapProjectProps {
  projectId: string
  onBack: () => void
}

export function SystemMapProject({ projectId, onBack }: SystemMapProjectProps) {
  const [meta, setMeta] = useState<ProjectMeta | null>(null)
  const [tab, setTab] = useState<Tab>('documents')

  useEffect(() => {
    getProject(projectId).then(setMeta)
  }, [projectId])

  return (
    <>
      <aside className="flex h-full w-56 shrink-0 flex-col overflow-y-auto border-r border-neutral-200 bg-white p-3">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 text-left text-sm font-medium text-neutral-500 hover:text-neutral-900"
        >
          ← System Map
        </button>
        <p className="mb-3 truncate px-1 text-sm font-bold text-neutral-900" title={meta?.name}>
          {meta?.name ?? 'Loading…'}
        </p>
        <div className="flex flex-col gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors ${
                tab === t.id ? 'bg-primary/10 text-primary' : 'text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </aside>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'documents' ? <SystemMapDocuments projectId={projectId} /> : null}
        {tab === 'merge' ? <SystemMapMergeReview projectId={projectId} /> : null}
        {tab === 'graph' ? <SystemMapGraph projectId={projectId} projectName={meta?.name ?? 'system-map'} /> : null}
        {tab === 'analysis' ? <SystemMapAnalysis projectId={projectId} /> : null}
      </div>
    </>
  )
}
