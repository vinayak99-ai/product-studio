import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type OnConnect,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { layoutDiagram, NODE_HEIGHT, type GroupBox, type LayoutAlgorithm, type LayoutDirection } from '../lib/elkLayout'
import { measureNodeSize } from '../lib/nodeSizing'
import type { EdgeShape } from '../lib/theme'
import { themePalettes, type ThemeName } from '../lib/themes'
import type { DiagramCategory, EdgeType, FlowchartDiagram, NodeType } from '../types'
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
const DUPLICATE_OFFSET = 32

export const FlowchartCanvas = forwardRef<FlowchartCanvasHandle, FlowchartCanvasProps>(
  ({ diagram, layoutAlgorithm, layoutDirection, edgeShape, themeName, snapToGrid }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const flowInstanceRef = useRef<ReactFlowInstance<CanvasFlowNode, DiagramFlowEdge> | null>(null)
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

    const handleEdgeTypeChange = useCallback(
      (id: string, type: EdgeType) => {
        setEdges((current) => current.map((edge) => (edge.id === id ? { ...edge, data: { ...edge.data, type } } : edge)))
      },
      [setEdges],
    )

    const handleEdgeLabelChange = useCallback(
      (id: string, label: string) => {
        setEdges((current) => current.map((edge) => (edge.id === id ? { ...edge, label } : edge)))
      },
      [setEdges],
    )

    const handleDeleteEdge = useCallback(
      (id: string) => {
        setEdges((current) => current.filter((edge) => edge.id !== id))
      },
      [setEdges],
    )

    // handleDuplicateNode (defined below, since its body needs buildNewNode)
    // and buildNewNode (whose returned node data needs to carry
    // onDuplicate) refer to each other -- a ref indirection breaks that
    // circular dependency without either one needing the other in its own
    // useCallback dependency array. Kept current via the plain assignment
    // right after handleDuplicateNode's own definition, which runs on every
    // render well before any user interaction could invoke it.
    const handleDuplicateNodeRef = useRef<(id: string) => void>(() => {})

    // Shared by the "+ Add node" button, double-click-to-place, and
    // Duplicate -- every way of manually creating a node needs the exact
    // same data shape (all six edit callbacks + a fresh id), only the
    // position and starting label/type/category differ per caller.
    const buildNewNode = useCallback(
      (position: { x: number; y: number }, overrides: Partial<Pick<DiagramFlowNode['data'], 'type' | 'label' | 'category_id' | 'is_external'>> = {}): DiagramFlowNode => {
        const newId = `manual_${Math.random().toString(36).slice(2, 9)}`
        const type = overrides.type ?? 'process'
        const label = overrides.label ?? 'New node'
        const size = measureNodeSize(label, type)
        const categoryId = overrides.category_id ?? null
        const categories = diagram?.categories ?? []
        const categoryIndex = categoryId ? categories.findIndex((category) => category.id === categoryId) : -1
        return {
          id: newId,
          type: 'diagramNode',
          position,
          width: size.width,
          height: size.height,
          selected: true,
          data: {
            id: newId,
            type,
            label,
            group_id: null,
            category_id: categoryId,
            categoryIndex: categoryIndex === -1 ? undefined : categoryIndex,
            is_external: overrides.is_external ?? false,
            categories: diagram?.categories,
            width: size.width,
            height: size.height,
            onLabelChange: handleLabelChange,
            onTypeChange: handleTypeChange,
            onCategoryChange: handleCategoryChange,
            onExternalToggle: handleExternalToggle,
            onDelete: handleDeleteNode,
            onDuplicate: (duplicateId: string) => handleDuplicateNodeRef.current(duplicateId),
          },
          draggable: true,
        }
      },
      [diagram, handleLabelChange, handleTypeChange, handleCategoryChange, handleExternalToggle, handleDeleteNode],
    )

    // Deselects everything else so only the just-placed/duplicated node's
    // toolbar is showing -- otherwise a previously-selected node's toolbar
    // would stay open alongside the new one.
    const placeNode = useCallback(
      (newNode: DiagramFlowNode) => {
        setNodes((current) => [...current.map((n) => ({ ...n, selected: false })), newNode])
      },
      [setNodes],
    )

    const handleAddNode = useCallback(() => {
      setNodes((current) => {
        const diagramNodes = current.filter((n): n is DiagramFlowNode => n.type === 'diagramNode')
        // Drops below the current lowest node (or near the origin if the
        // canvas is otherwise empty) so it lands in visible empty space
        // instead of stacked exactly on top of something.
        const maxY =
          diagramNodes.length > 0 ? Math.max(...diagramNodes.map((n) => n.position.y + (n.data.height ?? NODE_HEIGHT))) : 0
        const minX = diagramNodes.length > 0 ? Math.min(...diagramNodes.map((n) => n.position.x)) : 0
        const newNode = buildNewNode({ x: minX, y: maxY + DEFAULT_NODE_SPACING })
        return [...current.map((n) => ({ ...n, selected: false })), newNode]
      })
    }, [setNodes, buildNewNode])

    // Detects a double-click on empty canvas (React Flow only exposes a
    // single onPaneClick, not a dedicated double-click event -- the native
    // MouseEvent's own `detail` count, still present on the wrapped React
    // event, is the standard way to tell them apart) and drops a node
    // exactly there, converted from screen to flow coordinates via the
    // ReactFlowInstance grabbed in onInit.
    const handlePaneClick = useCallback(
      (event: ReactMouseEvent) => {
        if (event.detail !== 2 || !flowInstanceRef.current) return
        const clickPoint = flowInstanceRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY })
        // buildNewNode's `position` is the box's top-left (matching how
        // handleAddNode already uses it), but a double-click should feel
        // like it drops the node centered under the pointer -- offset by
        // half of what a fresh default-label node actually measures out to.
        const defaultSize = measureNodeSize('New node', 'process')
        const position = { x: clickPoint.x - defaultSize.width / 2, y: clickPoint.y - defaultSize.height / 2 }
        placeNode(buildNewNode(position))
      },
      [buildNewNode, placeNode],
    )

    const handleDuplicateNode = useCallback(
      (id: string) => {
        setNodes((current) => {
          const source = current.find((n): n is DiagramFlowNode => n.type === 'diagramNode' && n.id === id)
          if (!source) return current
          const clone = buildNewNode(
            { x: source.position.x + DUPLICATE_OFFSET, y: source.position.y + DUPLICATE_OFFSET },
            {
              type: source.data.type,
              label: `${source.data.label} (copy)`,
              category_id: source.data.category_id ?? null,
              is_external: source.data.is_external,
            },
          )
          return [...current.map((n) => ({ ...n, selected: false })), clone]
        })
      },
      [setNodes, buildNewNode],
    )
    handleDuplicateNodeRef.current = handleDuplicateNode

    // Drag from one node's handle to another to draw a new edge -- the
    // handles were already rendered on every node (DiagramNodeComponent),
    // this is the one missing piece that makes dragging from one actually
    // commit anything. No `waypoints` set, so DiagramEdgeComponent already
    // falls back correctly to a live bezier/step path recomputed from the
    // handles' current positions -- no ELK re-layout needed for a manual
    // edge, same as how a manually dragged node's edges already redraw live.
    const handleConnect: OnConnect = useCallback(
      (connection) => {
        if (!connection.source || !connection.target || connection.source === connection.target) return
        const newEdge: DiagramFlowEdge = {
          id: `manual_edge_${Math.random().toString(36).slice(2, 9)}`,
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle,
          targetHandle: connection.targetHandle,
          type: 'diagramEdge',
          data: {
            type: 'default',
            edgeShape,
            themeName,
            onTypeChange: handleEdgeTypeChange,
            onLabelChange: handleEdgeLabelChange,
            onDelete: handleDeleteEdge,
          },
        }
        setEdges((current) => [...current, newEdge])
      },
      [setEdges, edgeShape, themeName, handleEdgeTypeChange, handleEdgeLabelChange, handleDeleteEdge],
    )

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
            onDuplicate: (id: string) => handleDuplicateNodeRef.current(id),
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
            data: {
              ...edge.data,
              edgeShape,
              themeName,
              onTypeChange: handleEdgeTypeChange,
              onLabelChange: handleEdgeLabelChange,
              onDelete: handleDeleteEdge,
            },
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
              onTypeChange: handleEdgeTypeChange,
              onLabelChange: handleEdgeLabelChange,
              onDelete: handleDeleteEdge,
            },
          })) as DiagramFlowEdge[],
      )
    }, [edgeShape, themeName, setEdges, handleEdgeTypeChange, handleEdgeLabelChange, handleDeleteEdge])

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
            onConnect={handleConnect}
            onInit={(instance) => {
              flowInstanceRef.current = instance
            }}
            onPaneClick={handlePaneClick}
            connectionLineStyle={{ stroke: palette.primary, strokeWidth: 2 }}
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
