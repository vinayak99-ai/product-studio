import { useEffect, useRef, useState } from 'react'
import {
  deleteDocument,
  extractDocument,
  listDocuments,
  uploadDocument,
  uploadStructuredDocument,
} from '../../lib/systemMapApi'
import type { SourceDocumentMeta, StructuredDocumentRequest } from '../../systemMapTypes'
import { SystemMapExtractionReview } from './SystemMapExtractionReview'

interface SystemMapDocumentsProps {
  projectId: string
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const STATUS_BADGE: Record<SourceDocumentMeta['extraction_status'], string> = {
  pending: 'bg-neutral-100 text-neutral-600',
  extracted: 'bg-amber-100 text-amber-800',
  reviewed: 'bg-primary-light text-primary-dark',
}

const STRUCTURED_PLACEHOLDER = `{
  "nodes": [
    { "name": "Accounting System", "type": "accounting", "owning_team": "Fund Ops" }
  ],
  "edges": [
    {
      "source_system_name": "Transfer Agent",
      "target_system_name": "Accounting System",
      "fields": ["account_number", "nav_value"],
      "pii_fields": ["account_number"],
      "transport": "SFTP",
      "frequency": "daily batch",
      "purpose": "NAV calculation"
    }
  ]
}`

export function SystemMapDocuments({ projectId }: SystemMapDocumentsProps) {
  const [documents, setDocuments] = useState<SourceDocumentMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [uploadBusy, setUploadBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [structuredFilename, setStructuredFilename] = useState('')
  const [structuredJson, setStructuredJson] = useState('')
  const [structuredBusy, setStructuredBusy] = useState(false)
  const [structuredError, setStructuredError] = useState<string | null>(null)
  const [showStructured, setShowStructured] = useState(false)

  const [reviewingId, setReviewingId] = useState<string | null>(null)

  const refresh = () =>
    listDocuments(projectId)
      .then(setDocuments)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load documents.'))
      .finally(() => setLoading(false))

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setError(null)
    setUploadBusy(true)
    try {
      // Upload runs extraction immediately server-side -- if it succeeded,
      // skip straight to review instead of leaving the user to find and
      // click a separate Extract button.
      const doc = await uploadDocument(projectId, file)
      await refresh()
      if (doc.extraction_status === 'extracted') setReviewingId(doc.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploadBusy(false)
    }
  }

  const handleStructuredSubmit = async () => {
    if (!structuredFilename.trim() || !structuredJson.trim()) return
    setStructuredError(null)
    let parsed: { nodes?: unknown[]; edges?: unknown[] }
    try {
      parsed = JSON.parse(structuredJson)
    } catch {
      setStructuredError('Not valid JSON.')
      return
    }
    const req: StructuredDocumentRequest = {
      filename: structuredFilename.trim(),
      nodes: (parsed.nodes ?? []) as StructuredDocumentRequest['nodes'],
      edges: (parsed.edges ?? []) as StructuredDocumentRequest['edges'],
    }
    setStructuredBusy(true)
    try {
      await uploadStructuredDocument(projectId, req)
      setStructuredFilename('')
      setStructuredJson('')
      setShowStructured(false)
      await refresh()
    } catch (err) {
      setStructuredError(err instanceof Error ? err.message : 'Failed to ingest structured document.')
    } finally {
      setStructuredBusy(false)
    }
  }

  const handleExtract = async (doc: SourceDocumentMeta) => {
    setBusyId(doc.id)
    setError(null)
    try {
      await extractDocument(projectId, doc.id)
      await refresh()
      setReviewingId(doc.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed.')
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (doc: SourceDocumentMeta) => {
    setBusyId(doc.id)
    try {
      await deleteDocument(projectId, doc.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
    } finally {
      setBusyId(null)
    }
  }

  if (reviewingId) {
    const doc = documents.find((d) => d.id === reviewingId)
    return (
      <SystemMapExtractionReview
        projectId={projectId}
        documentId={reviewingId}
        filename={doc?.filename ?? ''}
        onBack={() => {
          setReviewingId(null)
          refresh()
        }}
      />
    )
  }

  return (
    <div className="px-6 py-6">
      <h1 className="mb-4 text-xl font-semibold text-neutral-900">Documents</h1>

      <div className="mb-4 rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-bold text-neutral-900">Upload a document</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Uploads run through LLM extraction to find systems and data flows — review the result before it
          feeds the graph.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadBusy}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {uploadBusy ? 'Uploading & extracting…' : 'Upload file'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            data-testid="system-map-file-input"
            className="hidden"
            onChange={handleFilePick}
          />
          <button
            type="button"
            onClick={() => setShowStructured((v) => !v)}
            disabled={uploadBusy}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {showStructured ? 'Cancel structured JSON' : 'Paste structured JSON instead'}
          </button>
        </div>

        {showStructured ? (
          <div className="mt-3 flex flex-col gap-2 border-t border-neutral-100 pt-3">
            <p className="text-xs text-neutral-500">
              Skips LLM extraction — use this if you've already turned a document into structured JSON
              yourself. Still goes through the same review, merge, and PII review steps afterward.
            </p>
            <input
              value={structuredFilename}
              onChange={(e) => setStructuredFilename(e.target.value)}
              placeholder="filename (e.g. transfer-agent-spec.json)"
              className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary"
            />
            <textarea
              value={structuredJson}
              onChange={(e) => setStructuredJson(e.target.value)}
              placeholder={STRUCTURED_PLACEHOLDER}
              data-testid="system-map-structured-json"
              className="h-40 resize-y rounded-md border border-neutral-200 bg-neutral-50 p-2 font-mono text-xs text-neutral-900 outline-none focus:border-primary"
            />
            {structuredError ? <p className="text-xs text-red-600">{structuredError}</p> : null}
            <button
              type="button"
              onClick={handleStructuredSubmit}
              disabled={structuredBusy || !structuredFilename.trim() || !structuredJson.trim()}
              className="self-start rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {structuredBusy ? 'Ingesting…' : 'Ingest structured document'}
            </button>
          </div>
        ) : null}
      </div>

      {error ? <p className="mb-3 text-xs text-red-600">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-neutral-500">No documents yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {documents.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-semibold text-neutral-900">{doc.filename}</p>
                  <span className="shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                    {doc.kind}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[doc.extraction_status]}`}
                  >
                    {doc.extraction_status}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-neutral-400">uploaded {formatDate(doc.uploaded_at)}</p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                {doc.kind === 'raw' && doc.extraction_status === 'pending' ? (
                  <button
                    type="button"
                    onClick={() => handleExtract(doc)}
                    disabled={busyId === doc.id}
                    className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium text-neutral-700 hover:border-primary hover:text-primary disabled:opacity-50"
                  >
                    {busyId === doc.id ? 'Extracting…' : 'Extract'}
                  </button>
                ) : null}
                {doc.extraction_status !== 'pending' ? (
                  <button
                    type="button"
                    onClick={() => setReviewingId(doc.id)}
                    className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium text-neutral-700 hover:border-primary hover:text-primary"
                  >
                    Review
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => handleDelete(doc)}
                  disabled={busyId === doc.id}
                  className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium text-neutral-700 hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
