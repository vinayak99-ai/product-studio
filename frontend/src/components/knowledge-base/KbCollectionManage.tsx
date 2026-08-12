import { useRef, useState } from 'react'
import { deleteDocument, replaceDocument, uploadDocument } from '../../lib/knowledgeBaseApi'
import type { KbCollectionDetail, KbDocumentMeta } from '../../knowledgeBaseTypes'

interface KbCollectionManageProps {
  detail: KbCollectionDetail
  onChange: (detail: KbCollectionDetail) => void
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

export function KbCollectionManage({ detail, onChange }: KbCollectionManageProps) {
  const { meta, documents, drift_warnings } = detail

  const [filename, setFilename] = useState('')
  const [content, setContent] = useState('')
  const [isCatalog, setIsCatalog] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [replacingId, setReplacingId] = useState<string | null>(null)
  const [replaceContent, setReplaceContent] = useState('')

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.md')) {
      setError('Only .md files are supported in this version of Knowledge Base.')
      return
    }
    const text = await file.text()
    setFilename(file.name)
    setContent(text)
    setError(null)
  }

  const handleUpload = async () => {
    if (!filename.trim() || !content.trim()) return
    setBusy(true)
    setError(null)
    try {
      const updated = await uploadDocument(meta.id, filename.trim(), content, isCatalog)
      onChange(updated)
      setFilename('')
      setContent('')
      setIsCatalog(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  const startReplace = (doc: KbDocumentMeta) => {
    setReplacingId(doc.id)
    setReplaceContent('')
  }

  const handleReplace = async (doc: KbDocumentMeta) => {
    if (!replaceContent.trim()) return
    setBusy(true)
    setError(null)
    try {
      const updated = await replaceDocument(meta.id, doc.id, doc.filename, replaceContent, doc.is_catalog)
      onChange(updated)
      setReplacingId(null)
      setReplaceContent('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Replace failed.')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (doc: KbDocumentMeta) => {
    setBusy(true)
    try {
      const updated = await deleteDocument(meta.id, doc.id)
      onChange(updated)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 py-6">
      <h1 className="mb-1 text-xl font-semibold text-neutral-900">{meta.name}</h1>
      <p className="mb-4 text-xs text-neutral-500">
        {documents.length} document{documents.length === 1 ? '' : 's'} · created {formatDate(meta.created_at)}
      </p>

      {drift_warnings.length > 0 ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="mb-1 font-semibold">Catalog drift</p>
          <ul className="list-inside list-disc space-y-0.5">
            {drift_warnings.map((w, i) => (
              <li key={i}>{w.detail}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-bold text-neutral-900">Add a document</h2>
        <p className="mt-1 text-xs text-neutral-500">
          .md only in this version — paste markdown directly or upload a .md file.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="filename.md"
              className="flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs font-medium text-neutral-700 hover:border-primary hover:text-primary"
            >
              Upload .md
            </button>
            <input ref={fileInputRef} type="file" accept=".md" className="hidden" onChange={handleFilePick} />
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="# Paste markdown content here…"
            className="h-32 resize-y rounded-md border border-neutral-200 bg-neutral-50 p-2 font-mono text-xs text-neutral-900 outline-none focus:border-primary"
          />
          <label className="flex items-center gap-1.5 text-xs text-neutral-600">
            <input type="checkbox" checked={isCatalog} onChange={(e) => setIsCatalog(e.target.checked)} />
            This is a catalog file — a table mapping filenames in this collection to what they contain
          </label>
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
          <button
            type="button"
            onClick={handleUpload}
            disabled={busy || !filename.trim() || !content.trim()}
            className="self-start rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Working…' : 'Add document'}
          </button>
        </div>
      </div>

      {documents.length === 0 ? (
        <p className="text-sm text-neutral-500">No documents in this collection yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {documents.map((doc) => (
            <div key={doc.id} className="rounded-xl border border-neutral-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-neutral-900">{doc.filename}</p>
                    {doc.is_catalog ? (
                      <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        catalog
                      </span>
                    ) : null}
                  </div>
                  {doc.description ? (
                    <p className="mt-0.5 text-xs text-neutral-600">{doc.description}</p>
                  ) : null}
                  <p className="mt-0.5 text-[11px] text-neutral-400">
                    {doc.chunk_count} chunk{doc.chunk_count === 1 ? '' : 's'} · uploaded{' '}
                    {formatDate(doc.uploaded_at)}
                    {doc.updated_at !== doc.uploaded_at ? ` · updated ${formatDate(doc.updated_at)}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => startReplace(doc)}
                    className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium text-neutral-700 hover:border-primary hover:text-primary"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(doc)}
                    disabled={busy}
                    className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium text-neutral-700 hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {replacingId === doc.id ? (
                <div className="mt-2 flex flex-col gap-2 border-t border-neutral-100 pt-2">
                  <textarea
                    value={replaceContent}
                    onChange={(e) => setReplaceContent(e.target.value)}
                    placeholder="Paste the updated markdown content…"
                    className="h-28 resize-y rounded-md border border-neutral-200 bg-neutral-50 p-2 font-mono text-xs text-neutral-900 outline-none focus:border-primary"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleReplace(doc)}
                      disabled={busy || !replaceContent.trim()}
                      className="rounded-md bg-primary px-3 py-1 text-[11px] font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy ? 'Replacing…' : 'Save replacement'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setReplacingId(null)}
                      className="rounded-md border border-neutral-200 bg-white px-3 py-1 text-[11px] font-medium text-neutral-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
