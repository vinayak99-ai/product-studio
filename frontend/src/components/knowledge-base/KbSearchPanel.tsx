import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { downloadAnswerAsMarkdown, search } from '../../lib/knowledgeBaseApi'
import type { KbCollectionMeta, KbSearchResponse } from '../../knowledgeBaseTypes'

interface KbSearchPanelProps {
  collections: KbCollectionMeta[]
  onOpenDocument: (collectionId: string) => void
}

export function KbSearchPanel({ collections, onOpenDocument }: KbSearchPanelProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(collections.filter((c) => c.is_default_included).map((c) => c.id)),
  )
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<KbSearchResponse | null>(null)
  const [answeredQuestion, setAnsweredQuestion] = useState('')

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSearch = async () => {
    if (!question.trim() || selected.size === 0) return
    setBusy(true)
    setError(null)
    try {
      const askedQuestion = question.trim()
      const res = await search(Array.from(selected), askedQuestion)
      setResult(res)
      setAnsweredQuestion(askedQuestion)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 py-6">
      <h1 className="mb-1 text-xl font-semibold text-neutral-900">Search across collections</h1>
      <p className="mb-4 text-xs text-neutral-500">
        Pick which collections to search, ask a question, and get a markdown-formatted answer
        grounded in the retrieved passages — every claim traceable back to the document it came
        from.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        {collections.map((c) => (
          <label
            key={c.id}
            className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              selected.has(c.id)
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'
            }`}
          >
            <input
              type="checkbox"
              checked={selected.has(c.id)}
              onChange={() => toggle(c.id)}
              className="hidden"
            />
            {c.name}
            {c.is_default_included ? <span className="text-[10px] text-neutral-400">always</span> : null}
          </label>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) handleSearch()
          }}
          placeholder="Ask a question across the selected collections…"
          className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={busy || !question.trim() || selected.size === 0}
          className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>
      {selected.size === 0 ? (
        <p className="mb-4 text-xs text-amber-600">Select at least one collection to search.</p>
      ) : null}
      {error ? <p className="mb-4 text-xs text-red-600">{error}</p> : null}

      {result ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Answer</span>
            <button
              type="button"
              onClick={() => downloadAnswerAsMarkdown(answeredQuestion, result)}
              className="rounded-md border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:border-primary hover:text-primary"
            >
              Download
            </button>
          </div>
          <div className="prose prose-sm max-w-none rounded-xl border border-neutral-200 bg-white p-4 text-neutral-800 prose-headings:text-neutral-900 prose-strong:text-neutral-900">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.answer_markdown}</ReactMarkdown>
          </div>

          {result.citations.length > 0 ? (
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Sources
              </h2>
              <div className="flex flex-col gap-2">
                {result.citations.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onOpenDocument(c.collection_id)}
                    className="flex flex-col items-start gap-0.5 rounded-lg border border-neutral-200 bg-white p-3 text-left transition-colors hover:border-primary"
                  >
                    <span className="text-xs font-semibold text-neutral-900">
                      {c.filename} <span className="font-normal text-neutral-400">— {c.collection_name}</span>
                    </span>
                    {c.heading_path ? <span className="text-[11px] text-neutral-400">{c.heading_path}</span> : null}
                    <span className="text-xs text-neutral-600">{c.snippet}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
