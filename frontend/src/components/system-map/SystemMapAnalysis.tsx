import { useEffect, useState } from 'react'
import {
  analyzeCentrality,
  analyzeCycles,
  analyzeOrphans,
  analyzePaths,
  analyzePii,
  getGraph,
} from '../../lib/systemMapApi'
import type {
  CentralityResult,
  CycleReport,
  OrphanReport,
  PathResult,
  PiiFlowResult,
  SystemMapGraph,
} from '../../systemMapTypes'

interface SystemMapAnalysisProps {
  projectId: string
}

type AnalysisTab = 'pii' | 'cycles' | 'orphans' | 'paths' | 'centrality'

const TABS: { id: AnalysisTab; label: string }[] = [
  { id: 'pii', label: 'PII flow' },
  { id: 'cycles', label: 'Cycles' },
  { id: 'orphans', label: 'Orphans' },
  { id: 'paths', label: 'Paths' },
  { id: 'centrality', label: 'Centrality' },
]

export function SystemMapAnalysis({ projectId }: SystemMapAnalysisProps) {
  const [graph, setGraph] = useState<SystemMapGraph | null>(null)
  const [tab, setTab] = useState<AnalysisTab>('pii')

  useEffect(() => {
    getGraph(projectId).then(setGraph)
  }, [projectId])

  const nameById = new Map((graph?.nodes ?? []).map((n) => [n.id, n.name]))
  const resolveNames = (ids: string[]) => ids.map((id) => nameById.get(id) ?? id).join(' → ')

  if (graph && graph.nodes.length === 0) {
    return (
      <div className="px-6 py-6">
        <h1 className="mb-1 text-xl font-semibold text-neutral-900">Analysis</h1>
        <p className="text-sm text-neutral-500">Confirm a graph first — analysis runs over the confirmed graph only.</p>
      </div>
    )
  }

  return (
    <div className="px-6 py-6">
      <h1 className="mb-4 text-xl font-semibold text-neutral-900">Analysis</h1>

      <div className="mb-4 flex gap-1 border-b border-neutral-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-t-md px-3 py-2 text-xs font-semibold transition-colors ${
              tab === t.id ? 'border-b-2 border-primary text-primary' : 'text-neutral-500 hover:text-neutral-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'pii' ? <PiiPanel projectId={projectId} nameById={nameById} /> : null}
      {tab === 'cycles' ? <CyclesPanel projectId={projectId} resolveNames={resolveNames} /> : null}
      {tab === 'orphans' ? <OrphansPanel projectId={projectId} nameById={nameById} /> : null}
      {tab === 'paths' ? <PathsPanel projectId={projectId} graph={graph} resolveNames={resolveNames} /> : null}
      {tab === 'centrality' ? <CentralityPanel projectId={projectId} nameById={nameById} /> : null}
    </div>
  )
}

function PiiPanel({ projectId, nameById }: { projectId: string; nameById: Map<string, string> }) {
  const [field, setField] = useState('')
  const [result, setResult] = useState<PiiFlowResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (!field.trim()) return
    setBusy(true)
    setError(null)
    try {
      setResult(await analyzePii(projectId, field.trim()))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trace failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="mb-2 text-xs text-neutral-500">
        Trace where a PII field goes — every edge that carries it, and every system reachable downstream
        once it enters the graph.
      </p>
      <div className="flex gap-2">
        <input
          value={field}
          onChange={(e) => setField(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          placeholder="e.g. ssn, account_number"
          className="w-64 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={run}
          disabled={busy || !field.trim()}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Tracing…' : 'Trace'}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      {result ? (
        <div className="mt-3 rounded-xl border border-neutral-200 bg-white p-3">
          <p className="text-xs font-semibold text-neutral-900">
            {result.edges.length} flow{result.edges.length === 1 ? '' : 's'} carry “{result.field}”
          </p>
          <ul className="mt-1.5 flex flex-col gap-1 text-xs text-neutral-600">
            {result.edges.map((e) => (
              <li key={e.id}>
                {nameById.get(e.source_system_id) ?? e.source_system_id} →{' '}
                {nameById.get(e.target_system_id) ?? e.target_system_id}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs font-semibold text-neutral-900">
            Reachable downstream ({result.reachable_system_ids.length})
          </p>
          <p className="mt-1 text-xs text-amber-800">
            {result.reachable_system_ids.map((id) => nameById.get(id) ?? id).join(', ') || 'None'}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function CyclesPanel({ projectId, resolveNames }: { projectId: string; resolveNames: (ids: string[]) => string }) {
  const [result, setResult] = useState<CycleReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      setResult(await analyzeCycles(projectId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="mb-2 text-xs text-neutral-500">
        Feedback loops — systems that feed back into themselves. Not inherently wrong, but worth a look.
      </p>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Checking…' : 'Check cycles'}
      </button>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      {result ? (
        result.cycles.length === 0 ? (
          <p className="mt-3 text-xs text-neutral-500">No cycles found.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5">
            {result.cycles.map((cycle, i) => (
              <li key={i} className="rounded-lg border border-neutral-200 bg-white p-2 text-xs text-neutral-700">
                {resolveNames(cycle)} → {resolveNames([cycle[0]])}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  )
}

function OrphansPanel({ projectId, nameById }: { projectId: string; nameById: Map<string, string> }) {
  const [result, setResult] = useState<OrphanReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      setResult(await analyzeOrphans(projectId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="mb-2 text-xs text-neutral-500">
        Systems with no data flows at all, and edges referencing a system id no longer in the graph.
      </p>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Checking…' : 'Check orphans'}
      </button>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      {result ? (
        <div className="mt-3 rounded-xl border border-neutral-200 bg-white p-3">
          <p className="text-xs font-semibold text-neutral-900">
            Isolated systems ({result.isolated_system_ids.length})
          </p>
          <p className="mt-1 text-xs text-neutral-600">
            {result.isolated_system_ids.map((id) => nameById.get(id) ?? id).join(', ') || 'None'}
          </p>
          <p className="mt-3 text-xs font-semibold text-neutral-900">
            Dangling edges ({result.dangling_edge_ids.length})
          </p>
          <p className="mt-1 text-xs text-neutral-600">{result.dangling_edge_ids.join(', ') || 'None'}</p>
        </div>
      ) : null}
    </div>
  )
}

function PathsPanel({
  projectId,
  graph,
  resolveNames,
}: {
  projectId: string
  graph: SystemMapGraph | null
  resolveNames: (ids: string[]) => string
}) {
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const [cutoff, setCutoff] = useState('')
  const [result, setResult] = useState<PathResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (!source || !target) return
    setBusy(true)
    setError(null)
    try {
      setResult(await analyzePaths(projectId, source, target, cutoff ? Number(cutoff) : undefined))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="mb-2 text-xs text-neutral-500">Find every route data could take from one system to another.</p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary"
        >
          <option value="">Source system…</option>
          {(graph?.nodes ?? []).map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary"
        >
          <option value="">Target system…</option>
          {(graph?.nodes ?? []).map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
        <input
          value={cutoff}
          onChange={(e) => setCutoff(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="max hops (optional)"
          className="w-32 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={run}
          disabled={busy || !source || !target}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Searching…' : 'Find paths'}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      {result ? (
        result.paths.length === 0 ? (
          <p className="mt-3 text-xs text-neutral-500">No path found.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5">
            {result.paths.map((path, i) => (
              <li key={i} className="rounded-lg border border-neutral-200 bg-white p-2 text-xs text-neutral-700">
                {resolveNames(path)}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  )
}

function CentralityPanel({ projectId, nameById }: { projectId: string; nameById: Map<string, string> }) {
  const [result, setResult] = useState<CentralityResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      setResult(await analyzeCentrality(projectId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compute failed.')
    } finally {
      setBusy(false)
    }
  }

  const sorted = result ? Object.entries(result.scores).sort((a, b) => b[1] - a[1]) : []
  const max = sorted.length > 0 ? sorted[0][1] : 1

  return (
    <div>
      <p className="mb-2 text-xs text-neutral-500">
        Which systems are most connected to the rest of the mesh — candidate hubs or single points of failure.
      </p>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Computing…' : 'Compute centrality'}
      </button>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      {sorted.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1.5">
          {sorted.map(([id, score]) => (
            <div key={id} className="flex items-center gap-2 text-xs">
              <span className="w-40 shrink-0 truncate font-medium text-neutral-900">{nameById.get(id) ?? id}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(score / max) * 100}%` }} />
              </div>
              <span className="w-12 shrink-0 text-right text-neutral-500">{score.toFixed(2)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
