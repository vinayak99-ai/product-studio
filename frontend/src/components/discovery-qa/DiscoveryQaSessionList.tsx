import { useEffect, useState } from 'react'
import { deleteSession, listSessions, renameSession } from '../../lib/discoveryQaApi'
import type { DiscoverySessionMeta } from '../../discoveryQaTypes'
import { EditableText } from '../infographic/EditableText'

interface DiscoveryQaSessionListProps {
  onSelect: (session: DiscoverySessionMeta) => void
  onNew: () => void
}

export function DiscoveryQaSessionList({ onSelect, onNew }: DiscoveryQaSessionListProps) {
  const [sessions, setSessions] = useState<DiscoverySessionMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load sessions.'))
      .finally(() => setLoading(false))
  }, [])

  const handleRename = async (id: string, name: string) => {
    if (!name.trim()) return
    const updated = await renameSession(id, name.trim())
    setSessions((prev) => prev.map((s) => (s.id === id ? updated : s)))
  }

  const handleDelete = async (id: string) => {
    await deleteSession(id)
    setSessions((prev) => prev.filter((s) => s.id !== id))
  }

  return (
    <div className="px-6 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-900">Discovery Q&amp;A</h1>
        <button
          type="button"
          onClick={onNew}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
        >
          New Session
        </button>
      </div>

      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="mx-auto max-w-xl rounded-xl border border-dashed border-neutral-300 p-8 text-center">
          <p className="text-base font-medium text-neutral-900">
            Prep interview questions from a spec, ask them live, and export meeting minutes.
          </p>
          <div className="mx-auto mt-4 flex max-w-md flex-col gap-2 text-left text-sm text-neutral-600">
            <p>
              <span className="mr-2 font-mono text-xs text-neutral-400">1.</span>
              Pick a Spec Builder project — questions are generated from its Edge Cases.
            </p>
            <p>
              <span className="mr-2 font-mono text-xs text-neutral-400">2.</span>
              Pick which candidates to keep, edit or add your own, and save the session.
            </p>
            <p>
              <span className="mr-2 font-mono text-xs text-neutral-400">3.</span>
              Answer questions one at a time during the meeting, enrich the notes, export.
            </p>
          </div>
          <button
            type="button"
            onClick={onNew}
            className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
          >
            New Session
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="group flex cursor-pointer flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition-colors hover:border-primary"
              onClick={() => onSelect(session)}
            >
              <div className="flex items-start justify-between gap-2">
                <EditableText
                  value={session.name}
                  onCommit={(name) => handleRename(session.id, name)}
                  as="h3"
                  className="text-sm font-bold text-neutral-900"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(session.id)
                  }}
                  aria-label="Delete session"
                  className="shrink-0 rounded p-1 text-neutral-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
              <p className="text-xs text-neutral-500">{session.source_project_name}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                  {session.answered_count}/{session.question_count} answered
                </span>
                {session.is_enriched ? (
                  <span className="rounded-full bg-primary-light px-2 py-0.5 text-[11px] font-medium text-primary-dark">
                    Enriched
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
