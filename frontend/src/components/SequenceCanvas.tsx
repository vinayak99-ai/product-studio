import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Background, Controls, MarkerType, ReactFlow, useEdgesState, useNodesState } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { layoutSequenceDiagram } from '../lib/sequenceLayout'
import { themePalettes, type ThemeName } from '../lib/themes'
import type { SequenceDiagram } from '../sequenceTypes'
import { LifelineNode, type LifelineFlowNode } from './sequence/LifelineNode'
import { MessageEdge, type MessageFlowEdge } from './sequence/MessageEdge'
import { EmptyCanvasState } from './EmptyCanvasState'
import { SequenceIcon } from './icons/ToolIcons'

interface SequenceCanvasProps {
  diagram: SequenceDiagram | null
  themeName: ThemeName
}

export interface SequenceCanvasHandle {
  domNode: HTMLDivElement | null
}

const nodeTypes = { lifelineNode: LifelineNode }
const edgeTypes = { messageEdge: MessageEdge }

export const SequenceCanvas = forwardRef<SequenceCanvasHandle, SequenceCanvasProps>(
  ({ diagram, themeName }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const [nodes, setNodes, onNodesChange] = useNodesState<LifelineFlowNode>([])
    const [edges, setEdges, onEdgesChange] = useEdgesState<MessageFlowEdge>([])

    useImperativeHandle(ref, () => ({ domNode: containerRef.current }), [])

    // No async layout pass -- the column/row arithmetic in
    // layoutSequenceDiagram is synchronous.
    useEffect(() => {
      if (!diagram || diagram.participants.length === 0) {
        setNodes([])
        setEdges([])
        return
      }

      const layout = layoutSequenceDiagram(diagram)
      const palette = themePalettes[themeName]

      const laidOutNodes: LifelineFlowNode[] = layout.participants.map((p) => ({
        id: p.id,
        type: 'lifelineNode',
        position: { x: p.x - p.headerWidth / 2, y: 0 },
        width: p.headerWidth,
        height: layout.height,
        draggable: false,
        selectable: false,
        data: {
          label: p.label,
          width: p.headerWidth,
          height: layout.height,
          activationBars: layout.activationBars.filter((bar) => bar.participantId === p.id),
          sourceHandles: p.sourceHandles,
          targetHandles: p.targetHandles,
        },
      }))

      const laidOutEdges: MessageFlowEdge[] = layout.messages.map((m) => ({
        id: m.id,
        source: m.source,
        sourceHandle: m.sourceHandleId,
        target: m.target,
        targetHandle: m.targetHandleId,
        type: 'messageEdge',
        label: m.label,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: m.type === 'return' ? palette.neutral600 : palette.neutral900,
          width: 16,
          height: 16,
        },
        data: { type: m.type, stepNumber: m.stepNumber, isSelf: m.isSelf, themeName },
      }))

      setNodes(laidOutNodes)
      setEdges(laidOutEdges)
    }, [diagram, themeName, setNodes, setEdges])

    const isEmpty = !diagram || diagram.participants.length === 0

    return (
      <div ref={containerRef} className="relative h-full w-full bg-neutral-50">
        {isEmpty ? (
          <EmptyCanvasState
            icon={SequenceIcon}
            title="No sequence diagram yet"
            description="Turn a flow description into participants, messages, and returns."
            tips={[
              'Paste your source material in the panel on the left',
              'Add a one-line prompt describing what to focus on',
              'Generate — participants and messages lay out automatically',
            ]}
          />
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodesDraggable={false}
            elementsSelectable={false}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.2}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
    )
  },
)

SequenceCanvas.displayName = 'SequenceCanvas'
