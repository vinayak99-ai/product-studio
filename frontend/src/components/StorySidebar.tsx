import { useCallback, useEffect, useRef, useState } from 'react'
import { extractFile } from '../lib/api'
import { listStoryProjects, openStoryGenerateSocket, type StorySource } from '../lib/storyApi'
import type { StorySourceProject, StoryScript, StoryWsProgressMessage } from '../storyTypes'

type Status = 'loading_projects' | 'idle' | 'planning' | 'generating' | 'done' | 'error'
type SourceMode = 'project' | 'document'

const MIN_MINUTES = 5
const MAX_MINUTES = 90
const DEFAULT_MINUTES = 30

interface StorySidebarProps {
  onResult: (story: StoryScript) => void
}

export function StorySidebar({ onResult }: StorySidebarProps) {
  const [sourceMode, setSourceMode] = useState<SourceMode>('project')

  const [projects, setProjects] = useState<StorySourceProject[]>([])
  const [projectId, setProjectId] = useState('')

  const [docTab, setDocTab] = useState<'paste' | 'upload'>('paste')
  const [material, setMaterial] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)

  const [totalMinutes, setTotalMinutes] = useState(DEFAULT_MINUTES)
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState<Status>('loading_projects')
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const closeSocketRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    listStoryProjects()
      .then((list) => {
        if (cancelled) return
        setProjects(list)
        setStatus('idle')
        const firstUsable = list.find((p) => p.has_prd)
        if (firstUsable) setProjectId(firstUsable.id)
      })
      .catch((err) => {
        if (cancelled) return
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load Spec Builder projects.')
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => closeSocketRef.current?.()
  }, [])

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setExtracting(true)
    setErrorMessage(null)
    try {
      const result = await extractFile(file)
      setMaterial(result.text)
      setFileName(result.filename)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to read file.')
    } finally {
      setExtracting(false)
    }
  }, [])

  const handleGenerate = useCallback(() => {
    let source: StorySource
    if (sourceMode === 'project') {
      if (!projectId) {
        setErrorMessage('Pick a Spec Builder project with a generated spec first.')
        return
      }
      source = { mode: 'project', projectId }
    } else {
      if (!material.trim()) {
        setErrorMessage('Paste or upload a document first.')
        return
      }
      source = { mode: 'document', material, materialName: fileName ?? 'Pasted document' }
    }

    setErrorMessage(null)
    setProgress(null)
    setStatus('planning')
    closeSocketRef.current?.()

    const onMessage = (message: StoryWsProgressMessage) => {
      if (message.stage === 'planning') {
        setStatus('planning')
      } else if (message.stage === 'plan_ready') {
        setStatus('generating')
        setProgress({ completed: 0, total: message.plan.beats.length })
      } else if (message.stage === 'generating') {
        setStatus('generating')
        setProgress({ completed: message.completed, total: message.total })
      } else if (message.stage === 'done') {
        setStatus('done')
        onResult(message.result)
      } else if (message.stage === 'error') {
        setStatus('error')
        setErrorMessage(message.message)
      }
    }

    const onError = () => {
      setStatus('error')
      setErrorMessage('Connection to backend failed. Is the API running?')
    }

    closeSocketRef.current = openStoryGenerateSocket(source, totalMinutes, prompt, onMessage, onError)
  }, [sourceMode, projectId, material, fileName, totalMinutes, prompt, onResult])

  const isGenerating = status === 'planning' || status === 'generating'
  const usableProjects = projects.filter((p) => p.has_prd)
  const hiddenCount = projects.length - usableProjects.length

  const canGenerate =
    !isGenerating && (sourceMode === 'project' ? !!projectId : material.trim().length > 0)

  const statusText =
    status === 'generating' && progress
      ? `Writing beat ${progress.completed} of ${progress.total}…`
      : status === 'planning'
        ? 'Planning the story arc…'
        : status === 'done'
          ? 'Ready.'
          : status === 'error'
            ? 'Something went wrong.'
            : ''

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-neutral-200 bg-white p-4">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">Source</h2>
        <div className="mt-2 flex gap-1 rounded-lg bg-neutral-100 p-1 text-xs font-medium">
          <button
            type="button"
            onClick={() => setSourceMode('project')}
            className={`flex-1 rounded-md py-1.5 transition-colors ${
              sourceMode === 'project' ? 'bg-white text-primary shadow-sm' : 'text-neutral-600'
            }`}
          >
            Spec Builder project
          </button>
          <button
            type="button"
            onClick={() => setSourceMode('document')}
            className={`flex-1 rounded-md py-1.5 transition-colors ${
              sourceMode === 'document' ? 'bg-white text-primary shadow-sm' : 'text-neutral-600'
            }`}
          >
            Upload a document
          </button>
        </div>

        {sourceMode === 'project' ? (
          <>
            {status === 'loading_projects' ? (
              <p className="mt-2 text-xs text-neutral-500">Loading Spec Builder projects…</p>
            ) : usableProjects.length === 0 ? (
              <p className="mt-2 text-xs text-neutral-500">
                No Spec Builder projects with a generated spec yet — build one in Spec Builder
                first, or switch to "Upload a document" above.
              </p>
            ) : (
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
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
          </>
        ) : (
          <>
            <div className="mt-2 flex gap-1 rounded-lg bg-neutral-100 p-1 text-xs font-medium">
              <button
                type="button"
                onClick={() => setDocTab('paste')}
                className={`flex-1 rounded-md py-1.5 transition-colors ${
                  docTab === 'paste' ? 'bg-white text-primary shadow-sm' : 'text-neutral-600'
                }`}
              >
                Paste text
              </button>
              <button
                type="button"
                onClick={() => setDocTab('upload')}
                className={`flex-1 rounded-md py-1.5 transition-colors ${
                  docTab === 'upload' ? 'bg-white text-primary shadow-sm' : 'text-neutral-600'
                }`}
              >
                Upload file
              </button>
            </div>

            {docTab === 'upload' ? (
              <div className="mt-3">
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-4 text-center text-xs text-neutral-600 hover:border-primary hover:text-primary">
                  <span className="font-medium">
                    {extracting ? 'Reading file…' : fileName ?? 'Click to choose a file'}
                  </span>
                  <span className="mt-1 text-[10px] text-neutral-600">.txt, .md, .pdf, .docx</span>
                  <input
                    type="file"
                    accept=".txt,.md,.pdf,.docx"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </label>
              </div>
            ) : null}

            <textarea
              value={material}
              onChange={(event) => setMaterial(event.target.value)}
              placeholder="Paste the product doc, PRD, or notes to build the story from…"
              className="mt-3 h-32 w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs text-neutral-900 outline-none focus:border-primary"
            />
          </>
        )}
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">Demo length</h2>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number"
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            value={totalMinutes}
            onChange={(event) =>
              setTotalMinutes(
                Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Number(event.target.value) || DEFAULT_MINUTES)),
              )
            }
            className="w-20 rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs text-neutral-900 outline-none focus:border-primary"
          />
          <span className="text-xs text-neutral-500">minutes</span>
        </div>
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
          Audience / focus (optional)
        </h2>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="e.g. Execs are skeptical about ROI — lean hard into the business value beat."
          className="mt-2 h-20 w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs text-neutral-900 outline-none focus:border-primary"
        />
      </div>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={!canGenerate}
        className="rounded-md bg-primary py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isGenerating ? 'Generating…' : 'Build story'}
      </button>

      {statusText ? (
        <p className={`text-xs ${status === 'error' ? 'text-red-600' : 'text-neutral-600'}`}>{statusText}</p>
      ) : null}
      {errorMessage ? <p className="text-xs text-red-600">{errorMessage}</p> : null}
    </aside>
  )
}
