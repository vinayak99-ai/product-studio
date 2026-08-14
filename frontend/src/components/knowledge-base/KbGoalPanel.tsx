import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { downloadAnswerAsMarkdown, runGoal } from '../../lib/knowledgeBaseApi'
import type { KbGoalResponse } from '../../knowledgeBaseTypes'

interface KbGoalPanelProps {
  onOpenDocument: (collectionId: string) => void
}

export function KbGoalPanel({ onOpenDocument }: KbGoalPanelProps) {
  const [goal, setGoal] = useState('')
  const [askedGoal, setAskedGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<KbGoalResponse | null>(null)

  const handleRun = async () => {
    if (!goal.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const askedText = goal.trim()
      const res = await runGoal(askedText)
      setResult(res)
      setAskedGoal(askedText)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to work through the goal.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 py-6">
      <h1 className="mb-1 text-xl font-semibold text-neutral-900">Work through a goal</h1>
      <p className="mb-4 text-xs text-neutral-500">
        Describe what you're trying to figure out, not just a single question. The agent
        searches every collection, running multiple rounds if the first pass isn't enough, and
        either answers or tells you specifically what documentation is missing.
      </p>

      <div className="mb-4 flex flex-col gap-2">
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. What's our process for onboarding a new enterprise customer, end to end?"
          rows={3}
          className="min-w-0 resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={handleRun}
          disabled={busy || !goal.trim()}
          className="self-start rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Working…' : 'Run'}
        </button>
      </div>

      {busy ? (
        <p className="mb-4 text-xs text-neutral-500">
          Searching across every collection, reasoning about what's found, and searching again if
          needed — this can take noticeably longer than a single search.
        </p>
      ) : null}
      {error ? <p className="mb-4 text-xs text-red-600">{error}</p> : null}

      {result ? (
        <div className="flex flex-col gap-4">
          <p className="text-[11px] text-neutral-400">
            {result.rounds_run} search round{result.rounds_run === 1 ? '' : 's'}
          </p>

          {result.answer_markdown ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Answer</span>
                <button
                  type="button"
                  onClick={() =>
                    downloadAnswerAsMarkdown(askedGoal, {
                      answer_markdown: result.answer_markdown ?? '',
                      citations: result.citations,
                    })
                  }
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
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Sources</h2>
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
            </>
          ) : (
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Documentation gaps
              </h2>
              <p className="mb-3 text-xs text-neutral-500">
                The knowledge base doesn't cover this goal well enough to answer it. Here's
                specifically what's missing:
              </p>
              <div className="flex flex-col gap-2">
                {result.gaps.map((g, i) => (
                  <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-sm font-semibold text-neutral-900">{g.topic}</p>
                    <p className="mt-1 text-xs text-neutral-700">{g.why_needed}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      <span className="font-medium">Would help:</span> {g.suggested_doc_type}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
