import { useState, type RefObject } from 'react'
import { exportPdf, exportPng } from '../lib/export'
import { exportPptx } from '../lib/exportPptx'
import type { LayoutAlgorithm } from '../lib/elkLayout'
import { themePalettes, type ThemeName } from '../lib/themes'
import type { CanvasFlowNode, FlowchartCanvasHandle } from './FlowchartCanvas'
import type { DiagramFlowNode } from './nodes/DiagramNodeComponent'

function isDiagramNode(node: CanvasFlowNode): node is DiagramFlowNode {
  return node.type === 'diagramNode'
}

interface ExportControlsProps {
  targetRef: RefObject<FlowchartCanvasHandle | null>
  disabled: boolean
  layoutAlgorithm: LayoutAlgorithm
  themeName: ThemeName
}

export function ExportControls({ targetRef, disabled, layoutAlgorithm, themeName }: ExportControlsProps) {
  const [busy, setBusy] = useState<'png' | 'pdf' | 'pptx' | null>(null)
  const pptxAvailable = layoutAlgorithm === 'rectpacking'

  const handleExport = async (kind: 'png' | 'pdf' | 'pptx') => {
    const handle = targetRef.current
    if (!handle) return
    setBusy(kind)
    try {
      if (kind === 'png' && handle.domNode) {
        await exportPng(handle.domNode)
      } else if (kind === 'pdf' && handle.domNode) {
        await exportPdf(handle.domNode)
      } else if (kind === 'pptx') {
        const { nodes, edges } = handle.getFlow()
        // Group-container boxes are a real DOM element (so PNG/PDF, which
        // just screenshot handle.domNode, already show them for free) but
        // aren't a shape exportPptx knows how to draw yet -- see Phase 3 of
        // the architecture-diagram plan. Filter them out rather than let a
        // 'groupBox' node reach exportPptx's NodeType-keyed shape/color
        // lookups, which only cover real diagram node types.
        const diagramNodes = nodes.filter(isDiagramNode)
        await exportPptx(diagramNodes, edges, themePalettes[themeName])
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={disabled || busy !== null}
        onClick={() => handleExport('png')}
        className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy === 'png' ? 'Exporting…' : 'Export PNG'}
      </button>
      <button
        type="button"
        disabled={disabled || busy !== null}
        onClick={() => handleExport('pdf')}
        className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy === 'pdf' ? 'Exporting…' : 'Export PDF'}
      </button>
      <button
        type="button"
        disabled={disabled || busy !== null || !pptxAvailable}
        onClick={() => handleExport('pptx')}
        title={pptxAvailable ? undefined : 'Switch to the Compact (16:9) layout to export PowerPoint'}
        className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy === 'pptx' ? 'Exporting…' : 'Export PPTX'}
      </button>
    </div>
  )
}
