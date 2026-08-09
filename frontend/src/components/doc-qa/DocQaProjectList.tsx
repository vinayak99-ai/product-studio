import { useEffect, useState } from 'react'
import { deleteProject, listProjects, renameProject } from '../../lib/docQaApi'
import type { DocQaProjectMeta } from '../../docQaTypes'
import { EditableText } from '../infographic/EditableText'

interface DocQaProjectListProps {
  onSelect: (project: DocQaProjectMeta) => void
  onNew: () => void
}

export function DocQaProjectList({ onSelect, onNew }: DocQaProjectListProps) {
  const [projects, setProjects] = useState<DocQaProjectMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load projects.'))
      .finally(() => setLoading(false))
  }, [])

  const handleRename = async (id: string, name: string) => {
    if (!name.trim()) return
    const updated = await renameProject(id, name.trim())
    setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)))
  }

  const handleDelete = async (id: string) => {
    await deleteProject(id)
    setProjects((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <div className="px-6 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-900">Documents</h1>
        <button
          type="button"
          onClick={onNew}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
        >
          New Project
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
          <p className="text-base font-medium text-neutral-900">Upload a document, get a summary and a Q&A chat.</p>
          <div className="mx-auto mt-4 flex max-w-md flex-col gap-2 text-left text-sm text-neutral-600">
            <p>
              <span className="mr-2 font-mono text-xs text-neutral-400">1.</span>
              Upload a doc — a PDF, Word file, or plain text/markdown notes.
            </p>
            <p>
              <span className="mr-2 font-mono text-xs text-neutral-400">2.</span>
              Get an instant summary of what it covers.
            </p>
            <p>
              <span className="mr-2 font-mono text-xs text-neutral-400">3.</span>
              Ask follow-up questions — every answer is grounded in the document, not outside knowledge.
            </p>
          </div>
          <button
            type="button"
            onClick={onNew}
            className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
          >
            New Project
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
                <EditableText
                  value={project.name}
                  onCommit={(name) => handleRename(project.id, name)}
                  as="h3"
                  className="text-sm font-bold text-neutral-900"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(project.id)
                  }}
                  aria-label="Delete project"
                  className="shrink-0 rounded p-1 text-neutral-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
              <p className="text-xs text-neutral-500">
                {project.filename ?? 'No document uploaded yet'}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {project.has_summary ? (
                  <span className="rounded-full bg-primary-light px-2 py-0.5 text-[11px] font-medium text-primary-dark">
                    Summarized
                  </span>
                ) : null}
                {project.message_count > 0 ? (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                    {project.message_count} message{project.message_count === 1 ? '' : 's'}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
