import { useCallback, useEffect, useRef, useState } from 'react'
import { extractFile, openGenerateSocket } from '../lib/api'
import type { DiagramStyle, GenerateResponse, ValidationIssue, WsProgressMessage } from '../types'
import { IssuesPanel } from './IssuesPanel'

type Status = 'idle' | 'classifying' | 'calling_llm' | 'validating' | 'done' | 'error'

interface SidebarProps {
  onResult: (result: GenerateResponse) => void
  issues: ValidationIssue[]
}

const STATUS_LABEL: Record<Status, string> = {
  idle: '',
  classifying: 'Choosing a diagram shape…',
  calling_llm: 'Calling OpenAI…',
  validating: 'Validating structure…',
  done: 'Flowchart ready.',
  error: 'Something went wrong.',
}

export function Sidebar({ onResult, issues }: SidebarProps) {
  const [tab, setTab] = useState<'paste' | 'upload'>('paste')
  const [diagramStyle, setDiagramStyle] = useState<DiagramStyle>('process')
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
    setStatus('classifying')
    closeSocketRef.current?.()

    const onMessage = (message: WsProgressMessage) => {
      if (
        message.stage === 'classifying' ||
        message.stage === 'calling_llm' ||
        message.stage === 'validating'
      ) {
        setStatus(message.stage)
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

    closeSocketRef.current = openGenerateSocket(material, prompt, onMessage, onError, diagramStyle)
  }, [material, prompt, diagramStyle, onResult])

  const isGenerating =
    status === 'classifying' || status === 'calling_llm' || status === 'validating'

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-neutral-200 bg-white p-4">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
          Diagram type
        </h2>
        <div className="mt-2 flex gap-1 rounded-lg bg-neutral-100 p-1 text-xs font-medium">
          <button
            type="button"
            onClick={() => setDiagramStyle('process')}
            className={`flex-1 rounded-md py-1.5 transition-colors ${
              diagramStyle === 'process' ? 'bg-white text-primary shadow-sm' : 'text-neutral-600'
            }`}
          >
            Process
          </button>
          <button
            type="button"
            onClick={() => setDiagramStyle('architecture')}
            className={`flex-1 rounded-md py-1.5 transition-colors ${
              diagramStyle === 'architecture' ? 'bg-white text-primary shadow-sm' : 'text-neutral-600'
            }`}
          >
            Architecture
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-neutral-500">
          {diagramStyle === 'architecture'
            ? 'System/ecosystem diagram -- categorized components, databases, external vendors, and a legend, not a step-by-step flow.'
            : 'Step-by-step process flowchart -- start/end, decisions, and branches.'}
        </p>
      </div>

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
          placeholder={
            diagramStyle === 'architecture'
              ? 'Paste source material describing a system or ecosystem (an architecture doc, integration list, data-flow writeup, etc.)'
              : 'Paste source material (a process doc, transcript, requirements, etc.)'
          }
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
          placeholder={
            diagramStyle === 'architecture'
              ? "e.g. Map this into a system ecosystem diagram grouped by owning team, with data stores called out."
              : 'e.g. Map this into a customer onboarding flowchart with decision points.'
          }
          className="mt-2 h-20 w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs text-neutral-900 outline-none focus:border-primary"
        />
      </div>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={isGenerating}
        className="rounded-md bg-primary py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isGenerating ? 'Generating…' : diagramStyle === 'architecture' ? 'Generate diagram' : 'Generate flowchart'}
      </button>

      {status !== 'idle' ? (
        <p
          className={`text-xs ${status === 'error' ? 'text-red-600' : 'text-neutral-600'}`}
        >
          {STATUS_LABEL[status]}
        </p>
      ) : null}
      {errorMessage ? <p className="text-xs text-red-600">{errorMessage}</p> : null}

      <IssuesPanel issues={issues} />
    </aside>
  )
}
