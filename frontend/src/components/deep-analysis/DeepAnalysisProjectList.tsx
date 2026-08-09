import { useEffect, useState } from 'react'
import { deleteProject, listProjects } from '../../lib/deepAnalysisApi'
import type { ProjectListItem } from '../../deepAnalysisTypes'

interface DeepAnalysisProjectListProps {
  onSelect: (project: ProjectListItem) => void
  onNew: () => void
}

function StageBadge({ item }: { item: ProjectListItem }) {
  if (item.summary.stage === 'clarifying') {
    return (
      <span className="rounded-full bg-accent-light px-2 py-0.5 text-[11px] font-medium text-accent">
        Round {item.summary.round} — {item.summary.questions_used} answered
      </span>
    )
  }
  if (item.summary.stage === 'generated') {
    return (
      <span className="rounded-full bg-primary-light px-2 py-0.5 text-[11px] font-medium text-primary-dark">
        Analysis ready
      </span>
    )
  }
  return (
    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
      Not started
    </span>
  )
}

export function DeepAnalysisProjectList({ onSelect, onNew }: DeepAnalysisProjectListProps) {
  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load analyses.'))
      .finally(() => setLoading(false))
  }, [])

  const handleDelete = async (id: string) => {
    await deleteProject(id)
    setProjects((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <div className="px-6 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-900">Deep Analysis</h1>
        <button
          type="button"
          onClick={onNew}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
        >
          New Analysis
        </button>
      </div>

      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="mx-auto max-w-xl rounded-xl border border-dashed border-neutral-300 p-8 text-center">
          <p className="text-base font-medium text-neutral-900">
            Understand a problem deeply before anyone acts on it.
          </p>
          <div className="mx-auto mt-4 flex max-w-md flex-col gap-2 text-left text-sm text-neutral-600">
            <p>
              <span className="mr-2 font-mono text-xs text-neutral-400">1.</span>
              Paste or upload a document describing the problem.
            </p>
            <p>
              <span className="mr-2 font-mono text-xs text-neutral-400">2.</span>
              Answer an extensive interview — up to 10 questions a round, up to 10 rounds — as the
              LLM digs into background, prior attempts, root causes, stakeholders, and risks.
            </p>
            <p>
              <span className="mr-2 font-mono text-xs text-neutral-400">3.</span>
              Get a deep, structured analysis document — not a spec, a comprehensive hold on the
              problem itself.
            </p>
          </div>
          <button
            type="button"
            onClick={onNew}
            className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
          >
            New Analysis
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <div
              key={project.id}
              className="group flex cursor-pointer flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition-colors hover:border-primary"
              onClick={() => onSelect(project)}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-bold text-neutral-900">{project.name}</h3>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(project.id)
                  }}
                  aria-label="Delete analysis"
                  className="shrink-0 rounded p-1 text-neutral-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
              <div>
                <StageBadge item={project} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
