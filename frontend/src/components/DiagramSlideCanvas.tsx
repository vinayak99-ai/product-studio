import { useState } from 'react'
import { exportDiagramSlidePptx } from '../lib/api'
import type { DiagramSlideResult, DiagramSlideType } from '../diagramSlideTypes'
import { EmptyCanvasState } from './EmptyCanvasState'
import { DiagramSlideIcon } from './icons/ToolIcons'

interface DiagramSlideCanvasProps {
  result: DiagramSlideResult | null
}

const TYPE_LABEL: Record<DiagramSlideType, string> = {
  linear_process: 'Linear process',
  decision_flow: 'Decision flow',
  hierarchy: 'Hierarchy',
  architecture: 'Architecture',
  timeline: 'Timeline',
}

export function DiagramSlideCanvas({ result }: DiagramSlideCanvasProps) {
  const [busy, setBusy] = useState(false)

  const handleDownload = async () => {
    if (!result) return
    setBusy(true)
    try {
      await exportDiagramSlidePptx(result)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-neutral-900">Diagram Slides</h1>
          {result ? (
            <>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                {TYPE_LABEL[result.diagram_type]}
              </span>
              <span className="text-[11px] text-neutral-400">{result.title}</span>
            </>
          ) : null}
        </div>
        <button
          type="button"
          disabled={!result || busy}
          onClick={handleDownload}
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Exporting…' : 'Download PPTX'}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-neutral-50 p-8">
        {result ? (
          <div className="aspect-video w-full max-w-4xl overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
            <iframe
              title="Diagram preview"
              srcDoc={result.html}
              sandbox=""
              className="h-full w-full border-0"
            />
          </div>
        ) : (
          <EmptyCanvasState
            icon={DiagramSlideIcon}
            title="No diagram yet"
            description="Describe a process, decision, hierarchy, system, or timeline and get a hand-composed diagram ready to drop into a slide."
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
