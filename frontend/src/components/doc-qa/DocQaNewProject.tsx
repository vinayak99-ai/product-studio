import { useRef, useState } from 'react'
import { createProject, uploadDocument } from '../../lib/docQaApi'
import type { DocQaProjectDetail } from '../../docQaTypes'
import { StageIntroCard } from '../design-thinking/StageIntroCard'

interface DocQaNewProjectProps {
  onCreated: (detail: DocQaProjectDetail) => void
  onCancel: () => void
}

export function DocQaNewProject({ onCreated, onCancel }: DocQaNewProjectProps) {
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canSubmit = name.trim().length > 0 && file !== null && !busy

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || !file) return
    setBusy(true)
    setError(null)
    try {
      const project = await createProject(name.trim())
      const detail = await uploadDocument(project.id, file)
      onCreated(detail)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-6 py-6">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900">New Project</h1>

      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-bold text-neutral-900">Document → Summary + Q&A</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Upload a document and get an instant summary, then ask follow-up questions — every answer
          grounded in the document itself.
        </p>

        <form className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="doc-qa-name" className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
              Project name
            </label>
            <input
              id="doc-qa-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Q3 Strategy Doc"
              className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-600">Document</span>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500 transition-colors hover:border-primary hover:text-primary"
            >
              {file ? (
                <span className="font-medium text-neutral-900">{file.name}</span>
              ) : (
                <>Click to choose a file — .txt, .md, .pdf, or .docx</>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.pdf,.docx"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

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
              {busy ? 'Uploading…' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>

      <div className="mt-4">
        <StageIntroCard
          title="What happens next"
          steps={[
            'Your document is extracted to plain text (nothing leaves this session except to the LLM provider)',
            'Click "Summarize" to get the gist in a few paragraphs',
            'Ask anything — every answer is grounded in the document, not outside knowledge',
          ]}
        />
      </div>
    </div>
  )
}
