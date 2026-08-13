import { useEffect, useState } from 'react'
import { createSession, generateCandidates, listSpecProjects } from '../../lib/discoveryQaApi'
import type { DiscoverySessionDetail, DiscoverySourceProject } from '../../discoveryQaTypes'
import { GenerateBar } from '../design-thinking/GenerateBar'
import { StageIntroCard } from '../design-thinking/StageIntroCard'
import { EditableText } from '../infographic/EditableText'

interface DiscoveryQaPrepProps {
  onCreated: (detail: DiscoverySessionDetail) => void
  onCancel: () => void
}

interface WorkingQuestion {
  id: string
  text: string
  rationale: string
  selected: boolean
}

let customIdCounter = 0

export function DiscoveryQaPrep({ onCreated, onCancel }: DiscoveryQaPrepProps) {
  const [projects, setProjects] = useState<DiscoverySourceProject[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [projectId, setProjectId] = useState('')
  const [sessionName, setSessionName] = useState('')

  const [prompt, setPrompt] = useState('')
  const [questions, setQuestions] = useState<WorkingQuestion[]>([])
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    listSpecProjects()
      .then((list) => {
        setProjects(list)
        const firstUsable = list.find((p) => p.has_prd)
        if (firstUsable) setProjectId(firstUsable.id)
      })
      .catch((err) => setGenError(err instanceof Error ? err.message : 'Failed to load Spec Builder projects.'))
      .finally(() => setLoadingProjects(false))
  }, [])

  useEffect(() => {
    const project = projects.find((p) => p.id === projectId)
    if (project && !sessionName) setSessionName(`${project.name} — Discovery`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const usableProjects = projects.filter((p) => p.has_prd)
  const hiddenCount = projects.length - usableProjects.length
  const selectedCount = questions.filter((q) => q.selected).length

  const handleGenerate = async () => {
    if (!projectId) return
    setGenError(null)
    setGenBusy(true)
    try {
      const result = await generateCandidates(projectId, prompt)
      const fresh: WorkingQuestion[] = result.candidates.map((c) => ({
        id: c.id,
        text: c.text,
        rationale: c.rationale,
        selected: false, // PM chooses which to keep, same convention as Design Thinking's HMW candidates
      }))
      setQuestions((prev) => [...prev, ...fresh])
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Failed to generate candidate questions.')
    } finally {
      setGenBusy(false)
    }
  }

  const toggle = (i: number) => {
    setQuestions((prev) => {
      const next = prev.slice()
      next[i] = { ...next[i], selected: !next[i].selected }
      return next
    })
  }

  const editText = (i: number, text: string) => {
    setQuestions((prev) => {
      const next = prev.slice()
      next[i] = { ...next[i], text }
      return next
    })
  }

  const remove = (i: number) => {
    setQuestions((prev) => prev.filter((_, idx) => idx !== i))
  }

  const addCustom = () => {
    customIdCounter += 1
    setQuestions((prev) => [
      ...prev,
      { id: `custom_${Date.now()}_${customIdCounter}`, text: '', rationale: '', selected: true },
    ])
  }

  const handleSave = async () => {
    if (!projectId || !sessionName.trim() || selectedCount === 0) return
    setSaveError(null)
    setSaveBusy(true)
    try {
      const picked = questions
        .filter((q) => q.selected && q.text.trim())
        .map((q) => ({ id: q.id, text: q.text.trim(), answer: '', enriched_answer: '', enriched_bullet: '' }))
      const meta = await createSession(sessionName.trim(), projectId, picked)
      const detail = { meta, questions: picked, notes: '', enriched_notes: '' }
      onCreated(detail)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save session.')
    } finally {
      setSaveBusy(false)
    }
  }

  return (
    <div className="px-6 py-6">
      <div className="mb-6 flex items-center gap-3">
        <button type="button" onClick={onCancel} className="text-sm font-medium text-neutral-500 hover:text-neutral-900">
          ← Discovery Q&amp;A
        </button>
        <h1 className="text-2xl font-semibold text-neutral-900">Prep a Session</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">Source spec</h2>
            {loadingProjects ? (
              <p className="mt-2 text-xs text-neutral-500">Loading Spec Builder projects…</p>
            ) : usableProjects.length === 0 ? (
              <p className="mt-2 text-xs text-neutral-500">
                No Spec Builder projects with a generated spec yet — build one in Spec Builder first.
              </p>
            ) : (
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="mt-2 w-full rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs text-neutral-900 outline-none focus:border-primary"
              >
                {usableProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            {hiddenCount > 0 ? (
              <p className="mt-1.5 text-[11px] text-neutral-400">
                {hiddenCount} other project{hiddenCount === 1 ? '' : 's'} hidden — no generated spec yet.
              </p>
            ) : null}

            <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-neutral-600">
              Session name
            </label>
            <input
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="e.g. Onboarding UX Interview — Round 1"
              className="mt-2 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-900 outline-none focus:border-primary"
            />
          </div>

          <GenerateBar
            prompt={prompt}
            onPromptChange={setPrompt}
            placeholder="Optional focus, e.g. 'lean toward mobile edge cases.'"
            onGenerate={handleGenerate}
            busy={genBusy}
            hasResult={questions.length > 0}
            disabled={!projectId}
            error={genError}
          />

          {questions.length === 0 ? (
            <StageIntroCard
              title="What this generates"
              steps={[
                "Questions are drawn primarily from the spec's Edge Cases section",
                'Pick which candidates to keep — none are pre-selected, you choose',
                'Edit any question inline, or add your own below',
              ]}
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
              Questions ({selectedCount} selected)
            </h2>
            <button type="button" onClick={addCustom} className="text-xs font-medium text-primary hover:text-primary-dark">
              + Add question
            </button>
          </div>

          {questions.length === 0 ? (
            <p className="text-xs text-neutral-400">Generate candidates, or add a question by hand.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {questions.map((q, i) => (
                <label
                  key={q.id}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-xs transition-colors ${
                    q.selected ? 'border-primary bg-primary-light' : 'border-neutral-200 bg-neutral-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={q.selected}
                    onChange={() => toggle(i)}
                    className="mt-0.5 shrink-0 accent-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <EditableText
                      value={q.text || 'Untitled question — click to edit'}
                      onCommit={(text) => editText(i, text)}
                      as="p"
                      className="font-medium text-neutral-900"
                    />
                    {q.rationale ? <p className="mt-0.5 text-[11px] text-neutral-500">{q.rationale}</p> : null}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      remove(i)
                    }}
                    aria-label="Remove question"
                    className="shrink-0 rounded p-0.5 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                  >
                    ✕
                  </button>
                </label>
              ))}
            </div>
          )}

          {saveError ? <p className="text-xs text-red-600">{saveError}</p> : null}
          <button
            type="button"
            onClick={handleSave}
            disabled={saveBusy || !sessionName.trim() || selectedCount === 0}
            className="self-start rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saveBusy ? 'Saving…' : 'Save session'}
          </button>
        </div>
      </div>
    </div>
  )
}
