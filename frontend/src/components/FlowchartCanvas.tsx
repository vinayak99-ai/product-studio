import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type OnConnect,
  type OnConnectEnd,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { layoutDiagram, layoutDiagramAuto, type GroupBox, type LayoutAlgorithm, type LayoutDirection } from '../lib/elkLayout'
import { countEdgeCrossings } from '../lib/layoutQuality'
import { measureNodeSize } from '../lib/nodeSizing'
import { nextFreePosition, type CanvasFlowNode } from '../lib/canvasFlow'
import { reconcileDiagram } from '../lib/reconcileDiagram'
import type { EdgeShape } from '../lib/theme'
import { themePalettes, type ThemeName } from '../lib/themes'
import type { DiagramCategory, DiagramGroup, EdgeType, FlowchartDiagram, NodeType } from '../types'
import { DiagramNodeComponent, type DiagramFlowNode } from './nodes/DiagramNodeComponent'
import { GroupBoxComponent, type GroupBoxFlowNode } from './nodes/GroupBoxComponent'
import { DiagramEdgeComponent, type DiagramFlowEdge } from './edges/DiagramEdgeComponent'
import { EmptyCanvasState } from './EmptyCanvasState'
import { FlowchartIcon } from './icons/ToolIcons'
import { ShapeQuickPicker } from './ShapeQuickPicker'

interface FlowchartCanvasProps {
  diagram: FlowchartDiagram | null
  layoutAlgorithm: LayoutAlgorithm
  layoutDirection: LayoutDirection
  edgeShape: EdgeShape
  themeName: ThemeName
  snapToGrid: boolean
  // When true (the "algorithm/direction haven't been manually touched yet"
  // state, tracked in App.tsx), a freshly generated diagram races a small
  // set of layout candidates and picks whichever measures the fewest edge
  // crossings, instead of always using layoutAlgorithm/layoutDirection as
  // given. onAutoLayoutPicked reports the winner back up so Settings stays
  // honest about what's actually on screen -- kept separate from the
  // Settings-facing algorithm/direction callbacks so this sync-back never
  // itself counts as a manual touch. onLayoutQuality reports the crossing
  // count of whatever layout actually rendered (auto-picked or not), so a
  // still-imperfect manual choice can be flagged too.
  autoSelectLayout: boolean
  onAutoLayoutPicked: (algorithm: LayoutAlgorithm, direction: LayoutDirection) => void
  onLayoutQuality: (crossings: number) => void
}

// CanvasFlowNode/isDiagramNode/nextFreePosition live in lib/canvasFlow.ts,
// not here -- reconcileDiagram.ts (used below, in applyEdit) needs them too,
// and having this component import reconcileDiagram while reconcileDiagram
// imports these from this component would be a circular module dependency.
// Re-exported so existing importers (ExportControls.tsx) don't need to
// change where they pull CanvasFlowNode/isDiagramNode from.
export { isDiagramNode, type CanvasFlowNode } from '../lib/canvasFlow'

export interface FlowchartCanvasHandle {
  domNode: HTMLDivElement | null
  getFlow: () => {
    nodes: CanvasFlowNode[]
    edges: DiagramFlowEdge[]
    groupBoxes: GroupBox[]
    groups: DiagramGroup[]
    categories: DiagramCategory[]
  }
  applyEdit: (newDiagram: FlowchartDiagram) => void
}

const nodeTypes = { diagramNode: DiagramNodeComponent, groupBox: GroupBoxComponent }
const edgeTypes = { diagramEdge: DiagramEdgeComponent }
const SNAP_GRID: [number, number] = [16, 16]
const GROUP_NODE_ID_PREFIX = 'grp:'
const DUPLICATE_OFFSET = 32

// Wraps computed group boxes as the non-interactive pseudo-nodes React Flow
// actually renders -- shared by the fresh-generation layout effect and
// applyEdit (an incremental AI edit's own groupBoxes, computed by
// reconcileDiagram.ts rather than ELK, need the exact same wrapping).
function buildGroupBoxNodes(groupBoxes: GroupBox[]): GroupBoxFlowNode[] {
  return groupBoxes.map((box) => ({
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
}

export const FlowchartCanvas = forwardRef<FlowchartCanvasHandle, FlowchartCanvasProps>(
  (
    { diagram, layoutAlgorithm, layoutDirection, edgeShape, themeName, snapToGrid, autoSelectLayout, onAutoLayoutPicked, onLayoutQuality },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const flowInstanceRef = useRef<ReactFlowInstance<CanvasFlowNode, DiagramFlowEdge> | null>(null)
    const addNodeButtonRef = useRef<HTMLButtonElement>(null)
    // Tracks the previous `diagram` prop reference so the layout effect can
    // tell "a genuinely new diagram just arrived" (races layout candidates)
    // apart from "layoutAlgorithm/layoutDirection changed by hand" (respects
    // exactly what was picked) -- both fire the same effect, since both are
    // in its dependency array.
    const prevDiagramRef = useRef<FlowchartDiagram | null>(null)
    // Monotonic, not a boolean -- lets a node's edit-mode effect re-fire on
    // a second Enter press even though "please edit" was already requested
    // once before (see DiagramNodeComponent's editRequestId effect).
    const editRequestCounter = useRef(0)
    const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>([])
    const [edges, setEdges, onEdgesChange] = useEdgesState<DiagramFlowEdge>([])
    const [groupBoxes, setGroupBoxes] = useState<GroupBox[]>([])
    // Set by every node-creation entry point (double-click, "+ Add node",
    // drag-a-handle-to-empty-canvas) instead of creating a node directly --
    // the ShapeQuickPicker's onPick is the one place that actually builds
    // the node, so shape choice is available everywhere a node gets created.
    const [pendingPlacement, setPendingPlacement] = useState<{
      flowPosition: { x: number; y: number }
      screenPosition: { x: number; y: number }
      connectFrom?: { source: string; sourceHandle: string | null }
    } | null>(null)

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
      (
        position: { x: number; y: number },
        overrides: Partial<Pick<DiagramFlowNode['data'], 'type' | 'label' | 'category_id' | 'is_external'>> = {},
        autoEdit = false,
      ): DiagramFlowNode => {
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
            editRequestId: autoEdit ? ++editRequestCounter.current : undefined,
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

    // Every creation entry point below opens the shape picker instead of
    // immediately creating a `process` node -- handlePickShape (defined
    // after the picker's other dependencies) is the one place that
    // actually builds and places the node.
    const handleAddNode = useCallback(() => {
      const diagramNodes = nodes.filter((n): n is DiagramFlowNode => n.type === 'diagramNode')
      const rect = addNodeButtonRef.current?.getBoundingClientRect()
      setPendingPlacement({
        flowPosition: nextFreePosition(diagramNodes),
        screenPosition: rect ? { x: rect.left, y: rect.bottom + 6 } : { x: 16, y: 56 },
      })
    }, [nodes])

    // Detects a double-click on empty canvas (React Flow only exposes a
    // single onPaneClick, not a dedicated double-click event -- the native
    // MouseEvent's own `detail` count, still present on the wrapped React
    // event, is the standard way to tell them apart) and opens the picker
    // at that exact point, converted from screen to flow coordinates via
    // the ReactFlowInstance grabbed in onInit.
    const handlePaneClick = useCallback((event: ReactMouseEvent) => {
      if (event.detail !== 2 || !flowInstanceRef.current) return
      const clickPoint = flowInstanceRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      // buildNewNode's `position` is the box's top-left (matching how
      // handleAddNode already uses it), but a double-click should feel
      // like it drops the node centered under the pointer -- offset by
      // half of what a fresh default-label node actually measures out to.
      const defaultSize = measureNodeSize('New node', 'process')
      setPendingPlacement({
        flowPosition: { x: clickPoint.x - defaultSize.width / 2, y: clickPoint.y - defaultSize.height / 2 },
        screenPosition: { x: event.clientX, y: event.clientY },
      })
    }, [])

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

    // The one place a pendingPlacement actually turns into a node -- shared
    // by every creation entry point (button, double-click, drag-out).
    // When `connectFrom` is set (the drag-out case), also wires an edge
    // back to the node the drag started from via the same handleConnect
    // logic a handle-to-handle drag already uses.
    const handlePickShape = useCallback(
      (type: NodeType) => {
        if (!pendingPlacement) return
        const newNode = buildNewNode(pendingPlacement.flowPosition, { type }, true)
        placeNode(newNode)
        if (pendingPlacement.connectFrom) {
          handleConnect({
            source: pendingPlacement.connectFrom.source,
            sourceHandle: pendingPlacement.connectFrom.sourceHandle,
            target: newNode.id,
            targetHandle: null,
          } as Connection)
        }
        setPendingPlacement(null)
      },
      [pendingPlacement, buildNewNode, placeNode, handleConnect],
    )

    // Drag a handle out and release over empty canvas (not another node's
    // handle) to create a new, already-connected node there in one motion
    // -- the same "drag out into space" pattern other diagramming tools
    // use, instead of requiring node creation and connecting as two
    // separate steps. `connectionState.toNode` is null only when the drop
    // point wasn't over any node at all (dropping on top of a node that
    // just isn't a valid handle target is left alone, since the user was
    // clearly aiming at that node, not empty space).
    const handleConnectEnd: OnConnectEnd = useCallback(
      (event, connectionState) => {
        if (connectionState.isValid || connectionState.toNode || !connectionState.fromNode || !flowInstanceRef.current) return
        const point = 'changedTouches' in event ? event.changedTouches[0] : event
        if (!point) return
        const dropPoint = flowInstanceRef.current.screenToFlowPosition({ x: point.clientX, y: point.clientY })
        const defaultSize = measureNodeSize('New node', 'process')
        setPendingPlacement({
          flowPosition: { x: dropPoint.x - defaultSize.width / 2, y: dropPoint.y - defaultSize.height / 2 },
          screenPosition: { x: point.clientX, y: point.clientY },
          connectFrom: { source: connectionState.fromNode.id, sourceHandle: connectionState.fromHandle?.id ?? null },
        })
      },
      [],
    )

    // The incremental-AI-edit entry point (called via the imperative
    // handle, from App.tsx, once a WS edit response comes back) --
    // deliberately independent of the `diagram` prop/layout effect below,
    // which always re-runs ELK. reconcileDiagram merges the edited diagram
    // into the CURRENT canvas state by node/edge id instead, so anything
    // already manually positioned/added/connected stays exactly as it was
    // unless the edit itself touched it.
    const applyEdit = useCallback(
      (newDiagram: FlowchartDiagram) => {
        const { nodes: nextNodes, edges: nextEdges, groupBoxes: nextGroupBoxes } = reconcileDiagram(nodes, newDiagram, {
          categories: diagram?.categories ?? [],
          edgeShape,
          themeName,
          callbacks: {
            onLabelChange: handleLabelChange,
            onTypeChange: handleTypeChange,
            onCategoryChange: handleCategoryChange,
            onExternalToggle: handleExternalToggle,
            onDelete: handleDeleteNode,
            onDuplicate: (id: string) => handleDuplicateNodeRef.current(id),
            onEdgeTypeChange: handleEdgeTypeChange,
            onEdgeLabelChange: handleEdgeLabelChange,
            onEdgeDelete: handleDeleteEdge,
          },
        })
        setNodes([...buildGroupBoxNodes(nextGroupBoxes), ...nextNodes])
        setGroupBoxes(nextGroupBoxes)
        setEdges(nextEdges)
      },
      [
        nodes,
        diagram,
        edgeShape,
        themeName,
        handleLabelChange,
        handleTypeChange,
        handleCategoryChange,
        handleExternalToggle,
        handleDeleteNode,
        handleEdgeTypeChange,
        handleEdgeLabelChange,
        handleDeleteEdge,
        setNodes,
        setEdges,
      ],
    )

    useImperativeHandle(
      ref,
      () => ({
        domNode: containerRef.current,
        getFlow: () => ({ nodes, edges, groupBoxes, groups: diagram?.groups ?? [], categories: diagram?.categories ?? [] }),
        applyEdit,
      }),
      [nodes, edges, groupBoxes, diagram, applyEdit],
    )

    // Recomputes positions — only needed when the diagram or layout geometry changes.
    useEffect(() => {
      if (!diagram || diagram.nodes.length === 0) {
        prevDiagramRef.current = diagram
        setNodes([])
        setEdges([])
        setGroupBoxes([])
        return
      }

      // A genuinely new diagram (not just a Settings tweak) gets to race
      // layout candidates -- see layoutDiagramAuto's own reasoning. Read
      // before the async work starts so a rapid re-fire can't misread it.
      const isFreshDiagram = diagram !== prevDiagramRef.current
      prevDiagramRef.current = diagram
      const shouldAutoSelect = isFreshDiagram && autoSelectLayout

      let cancelled = false
      // Normalizes both paths to the same shape (crossings always computed,
      // algorithm/direction only meaningful when auto-selection actually ran)
      // instead of relying on structural narrowing between layoutDiagram's
      // and layoutDiagramAuto's return types.
      const runLayout = async () => {
        if (shouldAutoSelect) {
          const auto = await layoutDiagramAuto(diagram)
          return { ...auto, algorithm: auto.algorithm as LayoutAlgorithm | undefined, direction: auto.direction as LayoutDirection | undefined }
        }
        const manual = await layoutDiagram(diagram, layoutAlgorithm, layoutDirection)
        return { ...manual, crossings: countEdgeCrossings(manual.edges), algorithm: undefined, direction: undefined }
      }

      runLayout().then((result) => {
        if (cancelled) return
        const { nodes: laidOutNodes, edges: laidOutEdges, groupBoxes: laidOutGroupBoxes } = result
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
        const groupBoxNodes = buildGroupBoxNodes(laidOutGroupBoxes)
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

        // Reports the crossing count of whatever actually rendered -- auto-
        // picked or a manual choice alike -- so a still-imperfect layout can
        // be flagged regardless of how it was chosen; syncs the winning
        // algorithm/direction back to Settings only on the auto path, via a
        // callback separate from the Settings-facing ones so this doesn't
        // itself count as a manual touch.
        onLayoutQuality(result.crossings)
        if (result.algorithm && result.direction) {
          onAutoLayoutPicked(result.algorithm, result.direction)
        }
      })

      return () => {
        cancelled = true
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [diagram, layoutAlgorithm, layoutDirection, autoSelectLayout])

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

    // Escape/Enter/F2/Cmd+D shortcuts on top of React Flow's own built-in
    // Delete/Backspace handling. Skipped whenever an input/textarea has
    // focus so it never fights the label or edge-label text fields.
    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

        if (event.key === 'Escape') {
          if (pendingPlacement) {
            setPendingPlacement(null)
            return
          }
          setNodes((current) => current.map((n) => (n.selected ? { ...n, selected: false } : n)))
          setEdges((current) => current.map((e) => (e.selected ? { ...e, selected: false } : e)))
          return
        }

        const selectedDiagramNodes = nodes.filter((n): n is DiagramFlowNode => n.type === 'diagramNode' && !!n.selected)
        if (selectedDiagramNodes.length !== 1) return
        const selectedId = selectedDiagramNodes[0].id

        if (event.key === 'Enter' || event.key === 'F2') {
          event.preventDefault()
          setNodes((current) =>
            current.map((n) =>
              n.type === 'diagramNode' && n.id === selectedId
                ? { ...n, data: { ...n.data, editRequestId: ++editRequestCounter.current } }
                : n,
            ),
          )
          return
        }

        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
          event.preventDefault()
          handleDuplicateNode(selectedId)
        }
      }

      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }, [nodes, pendingPlacement, setNodes, setEdges, handleDuplicateNode])

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
            onConnectEnd={handleConnectEnd}
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
                ref={addNodeButtonRef}
                type="button"
                onClick={handleAddNode}
                className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-900 shadow-sm transition-colors hover:border-primary hover:text-primary"
              >
                + Add node
              </button>
            </Panel>
          </ReactFlow>
        )}
        {pendingPlacement ? (
          <ShapeQuickPicker
            screenPosition={pendingPlacement.screenPosition}
            onPick={handlePickShape}
            onDismiss={() => setPendingPlacement(null)}
          />
        ) : null}
      </div>
    )
  },
)

FlowchartCanvas.displayName = 'FlowchartCanvas'
