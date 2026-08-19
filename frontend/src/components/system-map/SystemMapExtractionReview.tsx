import { useEffect, useState } from 'react'
import { confirmExtraction, getExtraction, updateExtraction } from '../../lib/systemMapApi'
import type { Criticality, ExtractedEdgeDraft, ExtractedNodeDraft, ExtractionDraft, SystemType } from '../../systemMapTypes'

interface SystemMapExtractionReviewProps {
  projectId: string
  documentId: string
  filename: string
  onBack: () => void
}

const SYSTEM_TYPES: SystemType[] = [
  'transfer_agent',
  'accounting',
  'custodian',
  'payment_processor',
  'compliance',
  'other',
]
const CRITICALITIES: Criticality[] = ['high', 'medium', 'low']

function emptyNode(): ExtractedNodeDraft {
  return { name: '', type: 'other', owning_team: '', criticality: 'medium', citation: { document_id: '', filename: '', snippet: '' } }
}

function emptyEdge(): ExtractedEdgeDraft {
  return {
    source_system_name: '',
    target_system_name: '',
    fields: [],
    pii_fields: [],
    transport: '',
    frequency: '',
    format: '',
    purpose: '',
    citation: { document_id: '', filename: '', snippet: '' },
  }
}

function splitList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function SystemMapExtractionReview({ projectId, documentId, filename, onBack }: SystemMapExtractionReviewProps) {
  const [draft, setDraft] = useState<ExtractionDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveBusy, setSaveBusy] = useState(false)
  const [confirmBusy, setConfirmBusy] = useState(false)

  useEffect(() => {
    getExtraction(projectId, documentId)
      .then(setDraft)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load extraction.'))
      .finally(() => setLoading(false))
  }, [projectId, documentId])

  const updateNode = (i: number, patch: Partial<ExtractedNodeDraft>) => {
    setDraft((prev) => {
      if (!prev) return prev
      const nodes = prev.nodes.slice()
      nodes[i] = { ...nodes[i], ...patch }
      return { ...prev, nodes }
    })
  }

  const removeNode = (i: number) => {
    setDraft((prev) => (prev ? { ...prev, nodes: prev.nodes.filter((_, idx) => idx !== i) } : prev))
  }

  const addNode = () => {
    setDraft((prev) => (prev ? { ...prev, nodes: [...prev.nodes, emptyNode()] } : prev))
  }

  const updateEdge = (i: number, patch: Partial<ExtractedEdgeDraft>) => {
    setDraft((prev) => {
      if (!prev) return prev
      const edges = prev.edges.slice()
      edges[i] = { ...edges[i], ...patch }
      return { ...prev, edges }
    })
  }

  const removeEdge = (i: number) => {
    setDraft((prev) => (prev ? { ...prev, edges: prev.edges.filter((_, idx) => idx !== i) } : prev))
  }

  const addEdge = () => {
    setDraft((prev) => (prev ? { ...prev, edges: [...prev.edges, emptyEdge()] } : prev))
  }

  const handleSave = async () => {
    if (!draft) return
    setSaveBusy(true)
    setError(null)
    try {
      const saved = await updateExtraction(projectId, documentId, draft)
      setDraft(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaveBusy(false)
    }
  }

  const handleConfirm = async () => {
    if (!draft) return
    setConfirmBusy(true)
    setError(null)
    try {
      await updateExtraction(projectId, documentId, draft)
      await confirmExtraction(projectId, documentId)
      onBack()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirm failed.')
    } finally {
      setConfirmBusy(false)
    }
  }

  if (loading) return <p className="p-6 text-sm text-neutral-500">Loading…</p>
  if (!draft) return <p className="p-6 text-sm text-red-600">{error ?? 'Not found.'}</p>

  return (
    <div className="px-6 py-6">
      <div className="mb-4 flex items-center gap-3">
        <button type="button" onClick={onBack} className="text-sm font-medium text-neutral-500 hover:text-neutral-900">
          ← Documents
        </button>
        <h1 className="text-xl font-semibold text-neutral-900">Review: {filename}</h1>
        {draft.reviewed ? (
          <span className="rounded-full bg-primary-light px-2 py-0.5 text-[11px] font-medium text-primary-dark">
            reviewed
          </span>
        ) : null}
      </div>
      <p className="mb-4 text-xs text-neutral-500">
        Fix or remove anything the extraction got wrong, especially PII field tags — nothing here feeds the
        graph until you confirm it below.
      </p>

      {error ? <p className="mb-3 text-xs text-red-600">{error}</p> : null}

      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
            Systems ({draft.nodes.length})
          </h2>
          <button type="button" onClick={addNode} className="text-xs font-medium text-primary hover:text-primary-dark">
            + Add system
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {draft.nodes.map((node, i) => (
            <div key={i} className="rounded-xl border border-neutral-200 bg-white p-3">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <input
                  value={node.name}
                  onChange={(e) => updateNode(i, { name: e.target.value })}
                  placeholder="System name"
                  className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary md:col-span-2"
                />
                <select
                  value={node.type}
                  onChange={(e) => updateNode(i, { type: e.target.value as SystemType })}
                  className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary"
                >
                  {SYSTEM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <select
                  value={node.criticality}
                  onChange={(e) => updateNode(i, { criticality: e.target.value as Criticality })}
                  className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary"
                >
                  {CRITICALITIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  value={node.owning_team}
                  onChange={(e) => updateNode(i, { owning_team: e.target.value })}
                  placeholder="Owning team"
                  className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary md:col-span-3"
                />
                <button
                  type="button"
                  onClick={() => removeNode(i)}
                  className="rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[11px] font-medium text-neutral-700 hover:border-red-300 hover:text-red-600"
                >
                  Remove
                </button>
              </div>
              {node.citation.snippet ? (
                <p className="mt-2 truncate text-[11px] italic text-neutral-400" title={node.citation.snippet}>
                  “{node.citation.snippet}”
                </p>
              ) : null}
            </div>
          ))}
          {draft.nodes.length === 0 ? <p className="text-xs text-neutral-400">No systems extracted.</p> : null}
        </div>
      </div>

      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
            Data flows ({draft.edges.length})
          </h2>
          <button type="button" onClick={addEdge} className="text-xs font-medium text-primary hover:text-primary-dark">
            + Add data flow
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {draft.edges.map((edge, i) => (
            <div key={i} className="rounded-xl border border-neutral-200 bg-white p-3">
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={edge.source_system_name}
                  onChange={(e) => updateEdge(i, { source_system_name: e.target.value })}
                  placeholder="Source system"
                  className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary"
                />
                <input
                  value={edge.target_system_name}
                  onChange={(e) => updateEdge(i, { target_system_name: e.target.value })}
                  placeholder="Target system"
                  className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary"
                />
                <input
                  value={edge.fields.join(', ')}
                  onChange={(e) => updateEdge(i, { fields: splitList(e.target.value) })}
                  placeholder="Fields (comma-separated)"
                  className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary md:col-span-2"
                />
                <input
                  value={edge.pii_fields.join(', ')}
                  onChange={(e) => updateEdge(i, { pii_fields: splitList(e.target.value) })}
                  placeholder="PII fields (comma-separated)"
                  className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-amber-500 md:col-span-2"
                />
                <input
                  value={edge.transport}
                  onChange={(e) => updateEdge(i, { transport: e.target.value })}
                  placeholder="Transport (e.g. SFTP)"
                  className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary"
                />
                <input
                  value={edge.frequency}
                  onChange={(e) => updateEdge(i, { frequency: e.target.value })}
                  placeholder="Frequency (e.g. daily batch)"
                  className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary"
                />
                <input
                  value={edge.format}
                  onChange={(e) => updateEdge(i, { format: e.target.value })}
                  placeholder="Format (e.g. CSV)"
                  className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary"
                />
                <input
                  value={edge.purpose}
                  onChange={(e) => updateEdge(i, { purpose: e.target.value })}
                  placeholder="Purpose"
                  className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => removeEdge(i)}
                  className="rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[11px] font-medium text-neutral-700 hover:border-red-300 hover:text-red-600"
                >
                  Remove
                </button>
              </div>
              {edge.citation.snippet ? (
                <p className="mt-2 truncate text-[11px] italic text-neutral-400" title={edge.citation.snippet}>
                  “{edge.citation.snippet}”
                </p>
              ) : null}
            </div>
          ))}
          {draft.edges.length === 0 ? <p className="text-xs text-neutral-400">No data flows extracted.</p> : null}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saveBusy}
          className="rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-900 hover:border-primary hover:text-primary disabled:opacity-60"
        >
          {saveBusy ? 'Saving…' : 'Save draft'}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={confirmBusy}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {confirmBusy ? 'Confirming…' : 'Confirm review'}
        </button>
      </div>
    </div>
  )
}
