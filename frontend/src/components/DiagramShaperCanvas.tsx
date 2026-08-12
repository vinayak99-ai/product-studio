import { useEffect, useRef, useState } from 'react'
import { exportDiagramShaperPptx } from '../lib/api'
import type { DiagramShaperType, GenerateDiagramShaperResponse } from '../diagramShaperTypes'
import { EmptyCanvasState } from './EmptyCanvasState'
import { DiagramShaperIcon } from './icons/ToolIcons'

interface DiagramShaperCanvasProps {
  response: GenerateDiagramShaperResponse | null
}

const TYPE_LABEL: Record<DiagramShaperType, string> = {
  linear_process: 'Linear process',
  decision_flow: 'Decision flow',
  hierarchy: 'Hierarchy',
  architecture: 'Architecture',
  timeline: 'Timeline',
}

export function DiagramShaperCanvas({ response }: DiagramShaperCanvasProps) {
  const [busy, setBusy] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)

  // Tracks the *browser's* fullscreen state (not just our own toggle click)
  // so the button/label stay correct if the user exits via Escape or the
  // browser's own UI instead of clicking again.
  useEffect(() => {
    const handleChange = () => setIsFullscreen(document.fullscreenElement === previewRef.current)
    document.addEventListener('fullscreenchange', handleChange)
    return () => document.removeEventListener('fullscreenchange', handleChange)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      previewRef.current?.requestFullscreen()
    }
  }

  const handleDownload = async () => {
    if (!response) return
    setBusy(true)
    try {
      await exportDiagramShaperPptx(response.result)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-neutral-900">Diagram Shaper</h1>
          {response ? (
            <>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                {TYPE_LABEL[response.result.diagram_type]}
              </span>
              <span className="text-[11px] text-neutral-400">{response.result.title}</span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!response}
            onClick={toggleFullscreen}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Full screen
          </button>
          <button
            type="button"
            disabled={!response || busy}
            onClick={handleDownload}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Exporting…' : 'Download PPTX'}
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-neutral-50 p-8">
        {response ? (
          <div
            ref={previewRef}
            className={
              isFullscreen
                ? 'relative flex h-full w-full items-center justify-center bg-black'
                : 'aspect-video w-full max-w-4xl overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm'
            }
          >
            <iframe
              title="Diagram preview"
              srcDoc={response.html}
              sandbox=""
              className={isFullscreen ? 'aspect-video max-h-full max-w-full border-0' : 'h-full w-full border-0'}
            />
            {/* The browser puts a fullscreened element in the page's "top
                layer", above everything else in the document -- including
                the header button that triggered fullscreen in the first
                place. Escape still exits, but a visible, clickable way out
                has to live inside this element, not the header. */}
            {isFullscreen ? (
              <button
                type="button"
                onClick={toggleFullscreen}
                className="absolute right-4 top-4 rounded-md border border-white/20 bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:border-white/40"
              >
                Exit full screen
              </button>
            ) : null}
          </div>
        ) : (
          <EmptyCanvasState
            icon={DiagramShaperIcon}
            title="No diagram yet"
            description="Describe a process, decision, hierarchy, system, or timeline and get a diagram built from real shapes and connectors, ready to export as native, editable PowerPoint shapes."
            tips={[
              'Paste your source material in the panel on the left',
              'Add a one-line prompt describing what to focus on',
              'Generate -- the diagram type is picked automatically',
            ]}
          />
        )}
      </div>
    </div>
  )
}
