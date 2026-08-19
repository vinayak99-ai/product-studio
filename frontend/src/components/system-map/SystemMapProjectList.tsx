import { useEffect, useState } from 'react'
import { createProject, deleteProject, listProjects, renameProject } from '../../lib/systemMapApi'
import type { ProjectListItem } from '../../systemMapTypes'
import { EditableText } from '../infographic/EditableText'

interface SystemMapProjectListProps {
  onSelect: (projectId: string) => void
}

export function SystemMapProjectList({ onSelect }: SystemMapProjectListProps) {
  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = () =>
    listProjects()
      .then(setProjects)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load projects.'))
      .finally(() => setLoading(false))

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try {
      const created = await createProject(name)
      setNewName('')
      setCreating(false)
      await refresh()
      onSelect(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project.')
    } finally {
      setBusy(false)
    }
  }

  const handleRename = async (id: string, name: string) => {
    if (!name.trim()) return
    await renameProject(id, name.trim())
    await refresh()
  }

  const handleDelete = async (id: string) => {
    await deleteProject(id)
    setProjects((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <div className="px-6 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-900">System Map</h1>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
        >
          {creating ? 'Cancel' : 'New Project'}
        </button>
      </div>

      {creating ? (
        <div className="mb-6 flex max-w-md items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) handleCreate()
            }}
            placeholder="e.g. Fund Servicing Integration Map"
            className="flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-sm text-neutral-900 outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy || !newName.trim()}
            className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      ) : null}

      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="mx-auto max-w-xl rounded-xl border border-dashed border-neutral-300 p-8 text-center">
          <p className="text-base font-medium text-neutral-900">
            Map how your systems connect — who sends what data to whom, and where PII flows.
          </p>
          <div className="mx-auto mt-4 flex max-w-md flex-col gap-2 text-left text-sm text-neutral-600">
            <p>
              <span className="mr-2 font-mono text-xs text-neutral-400">1.</span>
              Upload documents about your systems (or paste structured JSON) and review the extracted
              systems and data flows.
            </p>
            <p>
              <span className="mr-2 font-mono text-xs text-neutral-400">2.</span>
              Resolve duplicate system names across documents, then build and confirm the graph.
            </p>
            <p>
              <span className="mr-2 font-mono text-xs text-neutral-400">3.</span>
              Trace PII flows, find cycles and orphans, and check paths between systems.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
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
              onClick={() => onSelect(project.id)}
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
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                  {project.summary.document_count} doc{project.summary.document_count === 1 ? '' : 's'}
                </span>
                {project.summary.pending_merge_decisions > 0 ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                    {project.summary.pending_merge_decisions} merge{' '}
                    {project.summary.pending_merge_decisions === 1 ? 'decision' : 'decisions'} pending
                  </span>
                ) : null}
                {project.summary.confirmed_node_count > 0 ? (
                  <span className="rounded-full bg-primary-light px-2 py-0.5 text-[11px] font-medium text-primary-dark">
                    {project.summary.confirmed_node_count} systems · {project.summary.confirmed_edge_count} flows
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
