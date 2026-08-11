import type { Node, NodeProps } from '@xyflow/react'

export interface GroupBoxData {
  label: string
  width: number
  height: number
  [key: string]: unknown
}

export type GroupBoxFlowNode = Node<GroupBoxData, 'groupBox'>

// A bounding container rendered behind its member DiagramNodeComponents
// (see FlowchartCanvas.tsx's zIndex ordering) -- computed from ELK's own
// hierarchical layout (lib/elkLayout.ts), not a manually-fitted box, so it
// actually encloses its members rather than approximating around them.
export function GroupBoxComponent({ data }: NodeProps<GroupBoxFlowNode>) {
  return (
    <div
      className="relative rounded-xl border border-dashed border-neutral-400 bg-neutral-900/[0.025]"
      style={{ width: data.width, height: data.height }}
    >
      <div className="absolute -top-2.5 left-3 whitespace-nowrap rounded-full border border-neutral-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 shadow-sm">
        {data.label}
      </div>
    </div>
  )
}
