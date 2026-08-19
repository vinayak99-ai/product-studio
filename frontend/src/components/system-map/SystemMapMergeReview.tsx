import { useEffect, useState } from 'react'
import { decideMergeCandidate, listMergeCandidates, suggestMergeCandidates } from '../../lib/systemMapApi'
import type { MergeCandidate } from '../../systemMapTypes'

interface SystemMapMergeReviewProps {
  projectId: string
}

const CONFIDENCE_BADGE: Record<MergeCandidate['confidence'], string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-neutral-100 text-neutral-600',
}

export function SystemMapMergeReview({ projectId }: SystemMapMergeReviewProps) {
  const [candidates, setCandidates] = useState<MergeCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [suggesting, setSuggesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [decidingId, setDecidingId] = useState<string | null>(null)

  const refresh = () =>
    listMergeCandidates(projectId)
      .then(setCandidates)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load merge candidates.'))
      .finally(() => setLoading(false))

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const handleSuggest = async () => {
    setSuggesting(true)
    setError(null)
    try {
      const fresh = await suggestMergeCandidates(projectId)
      setCandidates(fresh)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to suggest merge candidates.')
    } finally {
      setSuggesting(false)
    }
  }

  const handleDecide = async (id: string, decision: 'merge' | 'keep_separate') => {
    setDecidingId(id)
    setError(null)
    try {
      const updated = await decideMergeCandidate(projectId, id, decision)
      setCandidates(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record decision.')
    } finally {
      setDecidingId(null)
    }
  }

  const pending = candidates.filter((c) => c.decision === null)
  const decided = candidates.filter((c) => c.decision !== null)

  return (
    <div className="px-6 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Merge Review</h1>
          <p className="mt-1 text-xs text-neutral-500">
            Same real-world system, named differently across documents? Decide whether to fold them into
            one node before building the graph.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSuggest}
          disabled={suggesting}
          className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {suggesting ? 'Suggesting…' : 'Suggest merges'}
        </button>
      </div>

      {error ? <p className="mb-3 text-xs text-red-600">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No candidates yet — confirm at least two documents' extraction review, then suggest merges.
        </p>
      ) : (
        <>
          {pending.length > 0 ? (
            <div className="mb-6">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">
                Pending ({pending.length})
              </h2>
              <div className="flex flex-col gap-2">
                {pending.map((c) => (
                  <MergeCandidateRow key={c.id} candidate={c} busy={decidingId === c.id} onDecide={handleDecide} />
                ))}
              </div>
            </div>
          ) : null}

          {decided.length > 0 ? (
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">
                Decided ({decided.length})
              </h2>
              <div className="flex flex-col gap-2">
                {decided.map((c) => (
                  <MergeCandidateRow key={c.id} candidate={c} busy={decidingId === c.id} onDecide={handleDecide} />
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function MergeCandidateRow({
  candidate,
  busy,
  onDecide,
}: {
  candidate: MergeCandidate
  busy: boolean
  onDecide: (id: string, decision: 'merge' | 'keep_separate') => void
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-900">
            {candidate.node_a_name} <span className="font-normal text-neutral-400">↔</span> {candidate.node_b_name}
          </p>
          <p className="mt-1 text-xs text-neutral-500">{candidate.rationale}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${CONFIDENCE_BADGE[candidate.confidence]}`}
        >
          {candidate.confidence} confidence
        </span>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => onDecide(candidate.id, 'merge')}
          disabled={busy}
          className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
            candidate.decision === 'merge'
              ? 'border-primary bg-primary-light text-primary-dark'
              : 'border-neutral-200 bg-white text-neutral-700 hover:border-primary hover:text-primary'
          }`}
        >
          Merge
        </button>
        <button
          type="button"
          onClick={() => onDecide(candidate.id, 'keep_separate')}
          disabled={busy}
          className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
            candidate.decision === 'keep_separate'
              ? 'border-neutral-400 bg-neutral-100 text-neutral-900'
              : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400'
          }`}
        >
          Keep separate
        </button>
      </div>
    </div>
  )
}
