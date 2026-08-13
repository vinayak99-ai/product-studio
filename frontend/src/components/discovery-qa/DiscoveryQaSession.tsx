import { useState } from 'react'
import {
  enrichSession,
  exportSession,
  renameSession,
  saveAnswer,
  saveNotes,
  updateQuestions,
} from '../../lib/discoveryQaApi'
import type { DiscoveryQuestion, DiscoverySessionDetail } from '../../discoveryQaTypes'
import { EditableText } from '../infographic/EditableText'

interface DiscoveryQaSessionProps {
  detail: DiscoverySessionDetail
  onChange: (detail: DiscoverySessionDetail) => void
  onBack: () => void
}

let newQuestionCounter = 0

export function DiscoveryQaSession({ detail, onChange, onBack }: DiscoveryQaSessionProps) {
  const { meta, questions, notes } = detail
  const [selected, setSelected] = useState(0)
  const [notesOpen, setNotesOpen] = useState(false)
  const [notesDraft, setNotesDraft] = useState(notes)
  const [answerDraft, setAnswerDraft] = useState<string | null>(null)

  const [enrichBusy, setEnrichBusy] = useState(false)
  const [enrichError, setEnrichError] = useState<string | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const index = Math.min(selected, Math.max(questions.length - 1, 0))
  const question = questions[index] ?? null
  const currentAnswer = answerDraft ?? question?.answer ?? ''

  const selectQuestion = (i: number) => {
    setAnswerDraft(null)
    setSelected(i)
  }

  const handleRename = async (name: string) => {
    if (!name.trim() || name === meta.name) return
    const updated = await renameSession(meta.id, name.trim())
    onChange({ ...detail, meta: updated })
  }

  const commitAnswer = async () => {
    if (!question || answerDraft === null || answerDraft === question.answer) return
    const updated = await saveAnswer(meta.id, question.id, answerDraft)
    onChange(updated)
    setAnswerDraft(null)
  }

  const commitNotes = async () => {
    if (notesDraft === notes) return
    const updated = await saveNotes(meta.id, notesDraft)
    onChange(updated)
  }

  const updateQuestionText = async (i: number, text: string) => {
    const next = questions.slice()
    next[i] = { ...next[i], text }
    const updated = await updateQuestions(meta.id, next)
    onChange(updated)
  }

  const addQuestion = async () => {
    newQuestionCounter += 1
    const next: DiscoveryQuestion[] = [
      ...questions,
      { id: `live_${Date.now()}_${newQuestionCounter}`, text: '', answer: '', enriched_answer: '', enriched_bullet: '' },
    ]
    const updated = await updateQuestions(meta.id, next)
    onChange(updated)
    setSelected(next.length - 1)
  }

  const deleteQuestion = async (i: number) => {
    const next = questions.filter((_, idx) => idx !== i)
    const updated = await updateQuestions(meta.id, next)
    onChange(updated)
    setSelected((prev) => Math.min(prev, Math.max(next.length - 1, 0)))
  }

  const handleEnrich = async () => {
    setEnrichError(null)
    setEnrichBusy(true)
    try {
      const updated = await enrichSession(meta.id)
      onChange(updated)
    } catch (err) {
      setEnrichError(err instanceof Error ? err.message : 'Enrichment failed.')
    } finally {
      setEnrichBusy(false)
    }
  }

  const handleExport = async () => {
    setExportError(null)
    setExportBusy(true)
    try {
      await exportSession(meta.id, meta.name)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed.')
    } finally {
      setExportBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="text-sm font-medium text-neutral-500 hover:text-neutral-900">
            ← Discovery Q&amp;A
          </button>
          <div>
            <EditableText
              value={meta.name}
              onCommit={handleRename}
              as="h2"
              className="text-lg font-semibold text-neutral-900"
            />
            <p className="text-xs text-neutral-500">{meta.source_project_name}</p>
          </div>
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
            {meta.answered_count}/{meta.question_count} answered
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleEnrich}
            disabled={enrichBusy || meta.answered_count === 0}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enrichBusy ? 'Enriching…' : 'Enrich'}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exportBusy || questions.length === 0}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exportBusy ? 'Exporting…' : 'Export meeting minutes'}
          </button>
        </div>
      </div>
      {enrichError ? <p className="bg-red-50 px-4 py-1 text-xs text-red-600">{enrichError}</p> : null}
      {exportError ? <p className="bg-red-50 px-4 py-1 text-xs text-red-600">{exportError}</p> : null}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-neutral-200 bg-white p-3">
          {questions.map((q, i) => (
            <button
              key={q.id}
              type="button"
              onClick={() => selectQuestion(i)}
              className={`flex items-start gap-1.5 rounded-lg px-3 py-2 text-left transition-colors ${
                i === index ? 'bg-primary/10 text-primary' : 'text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              <span className="mt-0.5 shrink-0 text-[10px] font-semibold text-neutral-400">
                {q.answer.trim() ? '●' : '○'}
              </span>
              <span className="line-clamp-2 text-xs font-medium">{q.text || `Question ${i + 1}`}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={addQuestion}
            className="mt-1 rounded-lg px-3 py-2 text-left text-xs font-medium text-primary hover:bg-primary/5"
          >
            + Add question
          </button>
        </aside>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-neutral-50 p-6">
          {question ? (
            <div className="mx-auto w-full max-w-2xl">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Question {index + 1} of {questions.length}
                </span>
                <button
                  type="button"
                  onClick={() => deleteQuestion(index)}
                  className="text-[11px] font-medium text-neutral-400 hover:text-red-600"
                >
                  Delete question
                </button>
              </div>
              <EditableText
                value={question.text || 'Click to write the question'}
                onCommit={(text) => updateQuestionText(index, text)}
                as="p"
                className="mt-1 text-lg font-semibold text-neutral-900"
              />

              <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-neutral-600">
                Answer
              </label>
              <textarea
                value={currentAnswer}
                onChange={(e) => setAnswerDraft(e.target.value)}
                onBlur={commitAnswer}
                placeholder="Type the interviewee's answer as they give it…"
                className="mt-2 h-32 w-full resize-y rounded-lg border border-neutral-200 bg-white p-3 text-sm leading-relaxed text-neutral-800 outline-none focus:border-primary"
              />

              {question.enriched_answer ? (
                <div className="mt-3 rounded-lg border border-primary/20 bg-primary-light p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-dark">Enriched</p>
                  <p className="mt-1 text-sm leading-relaxed text-neutral-800">{question.enriched_answer}</p>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mx-auto w-full max-w-2xl text-sm text-neutral-500">
              No questions yet — add one from the list on the left.
            </div>
          )}

          <div className="mx-auto mt-6 w-full max-w-2xl">
            <button
              type="button"
              onClick={() => setNotesOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-600"
            >
              <span>Additional Notes {notes.trim() ? '' : '(empty)'}</span>
              <span className="text-neutral-400">{notesOpen ? '▲' : '▼'}</span>
            </button>
            {notesOpen ? (
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                onBlur={commitNotes}
                placeholder="Anything that came up outside the structured questions — jot it here any time during the meeting…"
                className="mt-2 h-28 w-full resize-y rounded-lg border border-neutral-200 bg-white p-3 text-sm leading-relaxed text-neutral-800 outline-none focus:border-primary"
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
