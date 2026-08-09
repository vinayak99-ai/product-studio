import { useRef, useState } from 'react'
import { extractFile } from '../../lib/api'
import { createProject, generate } from '../../lib/deepAnalysisApi'
import type { DeepAnalysisDocument, GenerateResponse } from '../../deepAnalysisTypes'
import { DeepAnalysisProgress } from './DeepAnalysisProgress'
import { StageIntroCard } from '../design-thinking/StageIntroCard'

interface DeepAnalysisNewProjectProps {
  onNeedsClarification: (projectId: string, projectName: string, response: GenerateResponse) => void
  onGenerated: (projectId: string, artifactId: string, document: DeepAnalysisDocument) => void
  onCancel: () => void
}

export function DeepAnalysisNewProject({ onNeedsClarification, onGenerated, onCancel }: DeepAnalysisNewProjectProps) {
  const [name, setName] = useState('')
  const [rawNotes, setRawNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canSubmit = name.trim().length > 0 && rawNotes.trim().length > 0 && !busy

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setExtracting(true)
    setError(null)
    try {
      const result = await extractFile(file)
      setRawNotes(result.text)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file.')
    } finally {
      setExtracting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const project = await createProject(name.trim())
      setBusyProjectId(project.id)
      const res = await generate(project.id, rawNotes.trim())
      if (res.status === 'needs_clarification') {
        onNeedsClarification(project.id, project.name, res)
      } else {
        onGenerated(project.id, res.artifact_id!, res.document!)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
      setBusyProjectId(null)
    }
  }

  return (
    <div className="px-6 py-6">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900">New Deep Analysis</h1>

      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-bold text-neutral-900">Problem → Deep Analysis</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Paste or upload a document describing the problem — background, symptoms, anything
          already known. An extensive interview (up to 10 questions a round, up to 10 rounds)
          builds the rest of the context.
        </p>

        <form className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="da-name" className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
              Analysis name
            </label>
            <input
              id="da-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Checkout Drop-off"
              className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-neutral-600">Problem notes</span>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={extracting}
                className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {extracting ? 'Reading file…' : 'Upload .txt/.md'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
            <textarea
              value={rawNotes}
              onChange={(e) => setRawNotes(e.target.value)}
              placeholder="We're seeing checkout drop-off climb since the Q1 redesign. Support tickets mention..."
              className="h-48 w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 text-sm text-neutral-900 outline-none focus:border-primary"
            />
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          {busy ? <DeepAnalysisProgress projectId={busyProjectId} active={busy} /> : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Starting…' : 'Start Deep Analysis'}
            </button>
          </div>
        </form>
      </div>

      <div className="mt-4">
        <StageIntroCard
          title="What happens next"
          steps={[
            'The Extraction Agent pulls out the core problem and anything already known',
            'A deep clarification interview -- up to 10 questions a round, up to 10 rounds -- digs into background, prior attempts, root causes, stakeholders, and risks',
            'A comprehensive, structured analysis document -- not a spec, a full hold on the problem',
          ]}
        />
      </div>
    </div>
  )
}
