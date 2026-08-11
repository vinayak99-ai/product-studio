import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Background, Controls, MiniMap, Panel, ReactFlow, useEdgesState, useNodesState } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { layoutDiagram, type GroupBox, type LayoutAlgorithm, type LayoutDirection } from '../lib/elkLayout'
import { measureNodeSize } from '../lib/nodeSizing'
import type { EdgeShape } from '../lib/theme'
import { themePalettes, type ThemeName } from '../lib/themes'
import type { DiagramCategory, FlowchartDiagram, NodeType } from '../types'
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
  getFlow: () => { nodes: CanvasFlowNode[]; edges: DiagramFlowEdge[]; groupBoxes: GroupBox[]; categories: DiagramCategory[] }
}

const nodeTypes = { diagramNode: DiagramNodeComponent, groupBox: GroupBoxComponent }
const edgeTypes = { diagramEdge: DiagramEdgeComponent }
const SNAP_GRID: [number, number] = [16, 16]
const GROUP_NODE_ID_PREFIX = 'grp:'
const DEFAULT_NODE_SPACING = 48

export const FlowchartCanvas = forwardRef<FlowchartCanvasHandle, FlowchartCanvasProps>(
  ({ diagram, layoutAlgorithm, layoutDirection, edgeShape, themeName, snapToGrid }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>([])
    const [edges, setEdges, onEdgesChange] = useEdgesState<DiagramFlowEdge>([])
    const [groupBoxes, setGroupBoxes] = useState<GroupBox[]>([])

    useImperativeHandle(
      ref,
      () => ({
        domNode: containerRef.current,
        getFlow: () => ({ nodes, edges, groupBoxes, categories: diagram?.categories ?? [] }),
      }),
      [nodes, edges, groupBoxes, diagram],
    )

    // Stable across renders (setNodes/setEdges never change identity), so
    // every node -- generated or manually added later via handleAddNode --
    // can share the exact same callback instances instead of each layout
    // pass minting fresh ones.
    const handleLabelChange = useCallback(
      (id: string, label: string) => {
        setNodes((current) =>
          current.map((n) => (n.type === 'diagramNode' && n.id === id ? { ...n, data: { ...n.data, label } } : n)),
        )
      },
      [setNodes],
    )

    const handleTypeChange = useCallback(
      (id: string, type: NodeType) => {
        setNodes((current) =>
          current.map((n) => {
            if (n.type !== 'diagramNode' || n.id !== id) return n
            const size = measureNodeSize(n.data.label, type)
            return { ...n, width: size.width, height: size.height, data: { ...n.data, type, width: size.width, height: size.height } }
          }),
        )
      },
      [setNodes],
    )

    const handleCategoryChange = useCallback(
      (id: string, categoryId: string | null) => {
        setNodes((current) =>
          current.map((n) => {
            if (n.type !== 'diagramNode' || n.id !== id) return n
            const categories = n.data.categories ?? []
            const index = categoryId ? categories.findIndex((category) => category.id === categoryId) : -1
            return { ...n, data: { ...n.data, category_id: categoryId, categoryIndex: index === -1 ? undefined : index } }
          }),
        )
      },
      [setNodes],
    )

    const handleExternalToggle = useCallback(
      (id: string, isExternal: boolean) => {
        setNodes((current) =>
          current.map((n) => (n.type === 'diagramNode' && n.id === id ? { ...n, data: { ...n.data, is_external: isExternal } } : n)),
        )
      },
      [setNodes],
    )

    const handleDeleteNode = useCallback(
      (id: string) => {
        setNodes((current) => current.filter((n) => n.id !== id))
        setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id))
      },
      [setNodes, setEdges],
    )

    const handleAddNode = useCallback(() => {
      const newId = `manual_${Math.random().toString(36).slice(2, 9)}`
      const size = measureNodeSize('New node', 'process')
      setNodes((current) => {
        const diagramNodes = current.filter((n): n is DiagramFlowNode => n.type === 'diagramNode')
        // Drops below the current lowest node (or near the origin if the
        // canvas is otherwise empty) so it lands in visible empty space
        // instead of stacked exactly on top of something -- there's no
        // "click an empty spot to place it" gesture here, just a button.
        const maxY =
          diagramNodes.length > 0
            ? Math.max(...diagramNodes.map((n) => n.position.y + (n.data.height ?? size.height)))
            : 0
        const minX = diagramNodes.length > 0 ? Math.min(...diagramNodes.map((n) => n.position.x)) : 0
        const newNode: DiagramFlowNode = {
          id: newId,
          type: 'diagramNode',
          position: { x: minX, y: maxY + DEFAULT_NODE_SPACING },
          width: size.width,
          height: size.height,
          selected: true,
          data: {
            id: newId,
            type: 'process',
            label: 'New node',
            group_id: null,
            category_id: null,
            is_external: false,
            categories: diagram?.categories,
            width: size.width,
            height: size.height,
            onLabelChange: handleLabelChange,
            onTypeChange: handleTypeChange,
            onCategoryChange: handleCategoryChange,
            onExternalToggle: handleExternalToggle,
            onDelete: handleDeleteNode,
          },
          draggable: true,
        }
        // Deselects everything else so only the just-added node's toolbar
        // is showing -- otherwise a previously-selected node's toolbar
        // would stay open alongside the new one.
        return [...current.map((n) => ({ ...n, selected: false })), newNode]
      })
    }, [diagram, setNodes, handleLabelChange, handleTypeChange, handleCategoryChange, handleExternalToggle, handleDeleteNode])

    // Recomputes positions — only needed when the diagram or layout geometry changes.
    useEffect(() => {
      if (!diagram || diagram.nodes.length === 0) {
        setNodes([])
        setEdges([])
        setGroupBoxes([])
        return
      }

      let cancelled = false
      layoutDiagram(diagram, layoutAlgorithm, layoutDirection).then(({ nodes: laidOutNodes, edges: laidOutEdges, groupBoxes: laidOutGroupBoxes }) => {
        if (cancelled) return
        const withCallbacks: DiagramFlowNode[] = laidOutNodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            onLabelChange: handleLabelChange,
            onTypeChange: handleTypeChange,
            onCategoryChange: handleCategoryChange,
            onExternalToggle: handleExternalToggle,
            onDelete: handleDeleteNode,
          },
        }))
        // Group boxes go first in the array (React Flow renders later nodes
        // on top) and are explicitly non-interactive -- purely a visual
        // container, never draggable/selectable/connectable itself, so
        // dragging or clicking a member node underneath always wins.
        const groupBoxNodes: GroupBoxFlowNode[] = laidOutGroupBoxes.map((box) => ({
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
        setGroupBoxes(laidOutGroupBoxes)
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
            <Panel position="top-left">
              <button
                type="button"
                onClick={handleAddNode}
                className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-900 shadow-sm transition-colors hover:border-primary hover:text-primary"
              >
                + Add node
              </button>
            </Panel>
          </ReactFlow>
        )}
      </div>
    )
  },
)

FlowchartCanvas.displayName = 'FlowchartCanvas'
