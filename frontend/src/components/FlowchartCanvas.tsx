import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { Background, Controls, MiniMap, ReactFlow, useEdgesState, useNodesState } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { layoutDiagram, type LayoutAlgorithm, type LayoutDirection } from '../lib/elkLayout'
import type { EdgeShape } from '../lib/theme'
import { themePalettes, type ThemeName } from '../lib/themes'
import type { FlowchartDiagram } from '../types'
import { DiagramNodeComponent, type DiagramFlowNode } from './nodes/DiagramNodeComponent'
import { GroupBoxComponent, type GroupBoxFlowNode } from './nodes/GroupBoxComponent'
import { DiagramEdgeComponent, type DiagramFlowEdge } from './edges/DiagramEdgeComponent'
import { EmptyCanvasState } from './EmptyCanvasState'
import { FlowchartIcon } from './icons/ToolIcons'

interface FlowchartCanvasProps {
  diagram: FlowchartDiagram | null
  layoutAlgorithm: LayoutAlgorithm
  layoutDirection: LayoutDirection
  edgeShape: EdgeShape
  themeName: ThemeName
  snapToGrid: boolean
}

// Group-container boxes ride in the same React Flow node array as real
// diagram nodes (so they pan/zoom in lockstep) but are a visually and
// interactively distinct kind -- see the zIndex/selectable/draggable guards
// where they're built below.
export type CanvasFlowNode = DiagramFlowNode | GroupBoxFlowNode

export interface FlowchartCanvasHandle {
  domNode: HTMLDivElement | null
  getFlow: () => { nodes: CanvasFlowNode[]; edges: DiagramFlowEdge[] }
}

const nodeTypes = { diagramNode: DiagramNodeComponent, groupBox: GroupBoxComponent }
const edgeTypes = { diagramEdge: DiagramEdgeComponent }
const SNAP_GRID: [number, number] = [16, 16]
const GROUP_NODE_ID_PREFIX = 'grp:'

export const FlowchartCanvas = forwardRef<FlowchartCanvasHandle, FlowchartCanvasProps>(
  ({ diagram, layoutAlgorithm, layoutDirection, edgeShape, themeName, snapToGrid }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>([])
    const [edges, setEdges, onEdgesChange] = useEdgesState<DiagramFlowEdge>([])

    useImperativeHandle(
      ref,
      () => ({
        domNode: containerRef.current,
        getFlow: () => ({ nodes, edges }),
      }),
      [nodes, edges],
    )

    // Recomputes positions — only needed when the diagram or layout geometry changes.
    useEffect(() => {
      if (!diagram || diagram.nodes.length === 0) {
        setNodes([])
        setEdges([])
        return
      }

      let cancelled = false
      layoutDiagram(diagram, layoutAlgorithm, layoutDirection).then(({ nodes: laidOutNodes, edges: laidOutEdges, groupBoxes }) => {
        if (cancelled) return
        const withCallbacks: DiagramFlowNode[] = laidOutNodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            onLabelChange: (id: string, label: string) => {
              setNodes((current) =>
                current.map((n) => (n.type === 'diagramNode' && n.id === id ? { ...n, data: { ...n.data, label } } : n)),
              )
            },
          },
        }))
        // Group boxes go first in the array (React Flow renders later nodes
        // on top) and are explicitly non-interactive -- purely a visual
        // container, never draggable/selectable/connectable itself, so
        // dragging or clicking a member node underneath always wins.
        const groupBoxNodes: GroupBoxFlowNode[] = groupBoxes.map((box) => ({
          id: GROUP_NODE_ID_PREFIX + box.id,
          type: 'groupBox',
          position: { x: box.x, y: box.y },
          width: box.width,
          height: box.height,
          data: { label: box.label, width: box.width, height: box.height },
          draggable: false,
          selectable: false,
          focusable: false,
          zIndex: -1,
        }))
        setNodes([...groupBoxNodes, ...withCallbacks])
        setEdges(
          laidOutEdges.map((edge) => ({
            ...edge,
            data: { ...edge.data, edgeShape, themeName },
          })) as DiagramFlowEdge[],
        )
      })

      return () => {
        cancelled = true
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [diagram, layoutAlgorithm, layoutDirection])

    // Restyle pass — edge shape/theme are just rendering choices, no need to re-run elk.
    // Keeps the routed waypoints and node boxes from the layout pass so
    // switching edge style doesn't fall back to a naive straight line
    // through other nodes, or lose label placement's box-clearance data.
    useEffect(() => {
      setEdges(
        (current) =>
          current.map((edge) => ({
            ...edge,
            data: {
              type: edge.data?.type ?? 'default',
              waypoints: edge.data?.waypoints,
              nodeBoxes: edge.data?.nodeBoxes,
              edgeShape,
              themeName,
            },
          })) as DiagramFlowEdge[],
      )
    }, [edgeShape, themeName, setEdges])

    const isEmpty = useMemo(() => !diagram || diagram.nodes.length === 0, [diagram])
    const palette = themePalettes[themeName]

    return (
      <div ref={containerRef} className="relative h-full w-full bg-neutral-50">
        {isEmpty ? (
          <EmptyCanvasState
            icon={FlowchartIcon}
            title="No flowchart yet"
            description="Turn a process doc, transcript, or set of steps into an editable flowchart."
            tips={[
              'Paste your source material in the panel on the left',
              'Add a one-line prompt describing what to focus on',
              'Generate — layout, theme, and export apply automatically',
            ]}
          />
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            snapToGrid={snapToGrid}
            snapGrid={SNAP_GRID}
            proOptions={{ hideAttribution: true }}
          >
            <Background color={palette.neutral200} gap={20} />
            <Controls />
            <MiniMap
              pannable
              zoomable
              nodeColor={palette.primary}
              maskColor="rgba(237, 239, 236, 0.6)"
              className="!border !border-neutral-200"
            />
          </ReactFlow>
        )}
      </div>
    )
  },
)

FlowchartCanvas.displayName = 'FlowchartCanvas'
