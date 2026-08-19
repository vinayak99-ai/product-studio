import { useEffect, useState } from 'react'
import {
  buildGraph,
  confirmGraph,
  downloadGraphEdgesCsv,
  downloadGraphJson,
  downloadGraphNodesCsv,
  getGraph,
  listGraphVersions,
} from '../../lib/systemMapApi'
import type { ArtifactVersionMeta, SystemMapGraph as SystemMapGraphType } from '../../systemMapTypes'

interface SystemMapGraphProps {
  projectId: string
  projectName: string
}

const CRITICALITY_BADGE: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-neutral-100 text-neutral-600',
}

export function SystemMapGraph({ projectId, projectName }: SystemMapGraphProps) {
  const [confirmed, setConfirmed] = useState<SystemMapGraphType | null>(null)
  const [versions, setVersions] = useState<ArtifactVersionMeta[]>([])
  const [proposed, setProposed] = useState<SystemMapGraphType | null>(null)
  const [loading, setLoading] = useState(true)
  const [buildBusy, setBuildBusy] = useState(false)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = () =>
    Promise.all([getGraph(projectId), listGraphVersions(projectId)])
      .then(([graph, { versions: v }]) => {
        setConfirmed(graph)
        setVersions(v)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load graph.'))
      .finally(() => setLoading(false))

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const handleBuild = async () => {
    setBuildBusy(true)
    setError(null)
    try {
      const result = await buildGraph(projectId)
      setProposed(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to build proposed graph.')
    } finally {
      setBuildBusy(false)
    }
  }

  const handleConfirm = async () => {
    if (!proposed) return
    setConfirmBusy(true)
    setError(null)
    try {
      await confirmGraph(projectId, proposed)
      setProposed(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm graph.')
    } finally {
      setConfirmBusy(false)
    }
  }

  const display = proposed ?? confirmed
  const nodeNameById = new Map((display?.nodes ?? []).map((n) => [n.id, n.name]))

  return (
    <div className="px-6 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Graph</h1>
          <p className="mt-1 text-xs text-neutral-500">
            Build a proposal from every reviewed document plus your merge decisions, then confirm it to
            version it. Confirming is the only thing that persists a change.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {confirmed && confirmed.nodes.length > 0 ? (
            <div className="flex items-center gap-1.5 border-r border-neutral-200 pr-2">
              <button
                type="button"
                onClick={() => downloadGraphJson(projectName, confirmed)}
                className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:border-primary hover:text-primary"
              >
                Export JSON
              </button>
              <button
                type="button"
                onClick={() => downloadGraphNodesCsv(projectName, confirmed)}
                className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:border-primary hover:text-primary"
              >
                Nodes CSV
              </button>
              <button
                type="button"
                onClick={() => downloadGraphEdgesCsv(projectName, confirmed)}
                className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:border-primary hover:text-primary"
              >
                Edges CSV
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={handleBuild}
            disabled={buildBusy}
            className="rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-900 hover:border-primary hover:text-primary disabled:opacity-60"
          >
            {buildBusy ? 'Building…' : 'Build proposal'}
          </button>
        </div>
      </div>

      {error ? <p className="mb-3 text-xs text-red-600">{error}</p> : null}

      {proposed ? (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs text-amber-800">
            This is a proposed graph — not yet saved. Confirm it to replace the confirmed graph and create a
            new version.
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setProposed(null)}
              className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirmBusy}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {confirmBusy ? 'Confirming…' : 'Confirm this graph'}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : !display || (display.nodes.length === 0 && display.edges.length === 0) ? (
        <p className="text-sm text-neutral-500">
          No confirmed graph yet — build a proposal above once you've reviewed at least one document.
        </p>
      ) : (
        <>
          <div className="mb-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">
              Systems ({display.nodes.length})
            </h2>
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Team</th>
                    <th className="px-3 py-2 font-medium">Criticality</th>
                    <th className="px-3 py-2 font-medium">Aliases</th>
                  </tr>
                </thead>
                <tbody>
                  {display.nodes.map((n) => (
                    <tr key={n.id} className="border-b border-neutral-100 last:border-0">
                      <td className="px-3 py-2 font-semibold text-neutral-900">{n.name}</td>
                      <td className="px-3 py-2 text-neutral-600">{n.type}</td>
                      <td className="px-3 py-2 text-neutral-600">{n.owning_team || '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${CRITICALITY_BADGE[n.criticality]}`}>
                          {n.criticality}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-neutral-400">{n.aliases.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">
              Data flows ({display.edges.length})
            </h2>
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Source</th>
                    <th className="px-3 py-2 font-medium">Target</th>
                    <th className="px-3 py-2 font-medium">Fields</th>
                    <th className="px-3 py-2 font-medium">PII</th>
                    <th className="px-3 py-2 font-medium">Transport</th>
                    <th className="px-3 py-2 font-medium">Frequency</th>
                    <th className="px-3 py-2 font-medium">Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {display.edges.map((e) => (
                    <tr key={e.id} className="border-b border-neutral-100 last:border-0">
                      <td className="px-3 py-2 font-semibold text-neutral-900">
                        {nodeNameById.get(e.source_system_id) ?? e.source_system_id}
                      </td>
                      <td className="px-3 py-2 font-semibold text-neutral-900">
                        {nodeNameById.get(e.target_system_id) ?? e.target_system_id}
                      </td>
                      <td className="px-3 py-2 text-neutral-600">{e.fields.join(', ') || '—'}</td>
                      <td className="px-3 py-2">
                        {e.pii_fields.length > 0 ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                            {e.pii_fields.join(', ')}
                          </span>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-neutral-600">{e.transport || '—'}</td>
                      <td className="px-3 py-2 text-neutral-600">{e.frequency || '—'}</td>
                      <td className="px-3 py-2 text-neutral-600">{e.purpose || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {versions.length > 0 ? (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">Version history</h2>
          <div className="flex flex-col gap-1">
            {versions
              .slice()
              .reverse()
              .map((v) => (
                <div key={v.version} className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs">
                  <span className="font-mono text-neutral-400">v{v.version}</span>
                  <span className="text-neutral-600">{v.reason}</span>
                  <span className="ml-auto text-neutral-400">{new Date(v.saved_at).toLocaleString()}</span>
                </div>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
