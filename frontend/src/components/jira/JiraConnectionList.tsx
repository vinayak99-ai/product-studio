import { useEffect, useState } from 'react'
import { deleteConnection, listConnections } from '../../lib/jiraApi'
import type { JiraConnectionMeta } from '../../jiraTypes'

interface JiraConnectionListProps {
  onSelect: (connection: JiraConnectionMeta) => void
  onNew: () => void
}

export function JiraConnectionList({ onSelect, onNew }: JiraConnectionListProps) {
  const [connections, setConnections] = useState<JiraConnectionMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listConnections()
      .then(setConnections)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load connections.'))
      .finally(() => setLoading(false))
  }, [])

  const handleDelete = async (id: string) => {
    await deleteConnection(id)
    setConnections((prev) => prev.filter((c) => c.id !== id))
  }

  return (
    <div className="px-6 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-900">Jira</h1>
        <button
          type="button"
          onClick={onNew}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
        >
          Connect a project
        </button>
      </div>

      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
          ))}
        </div>
      ) : connections.length === 0 ? (
        <div className="mx-auto max-w-xl rounded-xl border border-dashed border-neutral-300 p-8 text-center">
          <p className="text-base font-medium text-neutral-900">Connect a Jira project and pull it in.</p>
          <div className="mx-auto mt-4 flex max-w-md flex-col gap-2 text-left text-sm text-neutral-600">
            <p>
              <span className="mr-2 font-mono text-xs text-neutral-400">1.</span>
              Connect with your Jira site URL, email, and an API token.
            </p>
            <p>
              <span className="mr-2 font-mono text-xs text-neutral-400">2.</span>
              Pull a project — every epic, story, task, and bug, with status, assignee, and more.
            </p>
            <p>
              <span className="mr-2 font-mono text-xs text-neutral-400">3.</span>
              Attach it to a Spec Builder project to enrich its epics and stories.
            </p>
          </div>
          <button
            type="button"
            onClick={onNew}
            className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
          >
            Connect a project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {connections.map((connection) => (
            <div
              key={connection.id}
              className="group flex cursor-pointer flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition-colors hover:border-primary"
              onClick={() => onSelect(connection)}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-bold text-neutral-900">{connection.name}</h3>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(connection.id)
                  }}
                  aria-label="Delete connection"
                  className="shrink-0 rounded p-1 text-neutral-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
              <p className="text-xs text-neutral-500">
                {connection.project_key} — {connection.base_url.replace(/^https?:\/\//, '')}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {connection.last_synced_at ? (
                  <span className="rounded-full bg-primary-light px-2 py-0.5 text-[11px] font-medium text-primary-dark">
                    {connection.issue_count} issue{connection.issue_count === 1 ? '' : 's'} pulled
                  </span>
                ) : (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                    Not pulled yet
                  </span>
                )}
                {connection.truncated ? (
                  <span className="rounded-full border border-accent/40 bg-accent-light px-2 py-0.5 text-[11px] font-medium text-accent">
                    Truncated
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
