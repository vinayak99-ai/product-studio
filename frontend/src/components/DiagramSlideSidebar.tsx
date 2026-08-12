import { useCallback, useEffect, useRef, useState } from 'react'
import { extractFile, openDiagramSlideGenerateSocket } from '../lib/api'
import type { DiagramSlideResult, DiagramSlideWsProgressMessage } from '../diagramSlideTypes'

type Status = 'idle' | 'calling_llm' | 'done' | 'error'

interface DiagramSlideSidebarProps {
  onResult: (result: DiagramSlideResult) => void
}

const STATUS_LABEL: Record<Status, string> = {
  idle: '',
  calling_llm: 'Composing the diagram…',
  done: 'Ready.',
  error: 'Something went wrong.',
}

export function DiagramSlideSidebar({ onResult }: DiagramSlideSidebarProps) {
  const [tab, setTab] = useState<'paste' | 'upload'>('paste')
  const [material, setMaterial] = useState('')
  const [prompt, setPrompt] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const closeSocketRef = useRef<(() => void) | null>(null)

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
    if (!material.trim() || !prompt.trim()) {
      setErrorMessage('Add source material and a prompt before generating.')
      return
    }
    setErrorMessage(null)
    setStatus('calling_llm')
    closeSocketRef.current?.()

    const onMessage = (message: DiagramSlideWsProgressMessage) => {
      if (message.stage === 'calling_llm') {
        setStatus('calling_llm')
      } else if (message.stage === 'done') {
        setStatus('done')
        onResult(message.result.result)
      } else if (message.stage === 'error') {
        setStatus('error')
        setErrorMessage(message.message)
      }
    }

    const onError = () => {
      setStatus('error')
      setErrorMessage('Connection to backend failed. Is the API running?')
    }

    closeSocketRef.current = openDiagramSlideGenerateSocket(material, prompt, onMessage, onError)
  }, [material, prompt, onResult])

  const isGenerating = status === 'calling_llm'

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-neutral-200 bg-white p-4">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
          Source material
        </h2>
        <div className="mt-2 flex gap-1 rounded-lg bg-neutral-100 p-1 text-xs font-medium">
          <button
            type="button"
            onClick={() => setTab('paste')}
            className={`flex-1 rounded-md py-1.5 transition-colors ${
              tab === 'paste' ? 'bg-white text-primary shadow-sm' : 'text-neutral-600'
            }`}
          >
            Paste text
          </button>
          <button
            type="button"
            onClick={() => setTab('upload')}
            className={`flex-1 rounded-md py-1.5 transition-colors ${
              tab === 'upload' ? 'bg-white text-primary shadow-sm' : 'text-neutral-600'
            }`}
          >
            Upload file
          </button>
        </div>

        {tab === 'upload' ? (
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
          placeholder="Paste source material describing a process, decision, hierarchy, system, or timeline."
          className="mt-3 h-40 w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs text-neutral-900 outline-none focus:border-primary"
        />
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
          Prompt
        </h2>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="e.g. Turn this into a diagram for the slide. We'll pick the type -- process, decision flow, hierarchy, architecture, or timeline -- that fits best."
          className="mt-2 h-20 w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs text-neutral-900 outline-none focus:border-primary"
        />
      </div>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={isGenerating}
        className="rounded-md bg-primary py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isGenerating ? 'Generating…' : 'Generate diagram'}
      </button>

      {status !== 'idle' ? (
        <p className={`text-xs ${status === 'error' ? 'text-red-600' : 'text-neutral-600'}`}>
          {STATUS_LABEL[status]}
        </p>
      ) : null}
      {errorMessage ? <p className="text-xs text-red-600">{errorMessage}</p> : null}
    </aside>
  )
}
