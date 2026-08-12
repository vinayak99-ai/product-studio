import { isDiagramNode, nextFreePosition, type CanvasFlowNode } from './canvasFlow'
import type { DiagramFlowEdge } from '../components/edges/DiagramEdgeComponent'
import type { DiagramFlowNode } from '../components/nodes/DiagramNodeComponent'
import type { EdgeShape } from './theme'
import type { ThemeName } from './themes'
import { NODE_HEIGHT, NODE_WIDTH, type GroupBox } from './elkLayout'
import { measureNodeSize } from './nodeSizing'
import type { DiagramCategory, EdgeType, FlowchartDiagram, NodeType } from '../types'

// Mirrors elkLayout.ts's GROUP_PADDING ('[top=40.0,left=18.0,bottom=18.0,
// right=18.0]', an ELK layout-option string) as plain numbers -- a fresh
// generation runs that through ELK; an incremental edit instead computes a
// group's box directly as a tight bounding rect over its members' current
// positions, so the two need to agree on the same padding to look
// consistent whichever path produced them. Keep in sync if either changes.
const GROUP_PADDING = { top: 40, left: 18, bottom: 18, right: 18 }

interface ReconcileCallbacks {
  onLabelChange: (id: string, label: string) => void
  onTypeChange: (id: string, type: NodeType) => void
  onCategoryChange: (id: string, categoryId: string | null) => void
  onExternalToggle: (id: string, isExternal: boolean) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
  onEdgeTypeChange: (id: string, type: EdgeType) => void
  onEdgeLabelChange: (id: string, label: string) => void
  onEdgeDelete: (id: string) => void
}

export interface ReconcileOptions {
  categories: DiagramCategory[]
  edgeShape?: EdgeShape
  themeName?: ThemeName
  callbacks: ReconcileCallbacks
}

// The core of "AI edits preserve your manual layout": unlike a fresh
// generation (which always runs the full ELK layout, see
// FlowchartCanvas.tsx's layout effect), an incremental edit's result is
// merged into the CURRENT canvas state by node/edge id instead of being
// laid out from scratch. A node whose id already exists keeps its position
// (and size, unless its label/type actually changed); a new id gets placed
// near the rest of the diagram instead of on top of anything; an id that's
// gone gets dropped. Edges and group boxes are cheap to fully rebuild since
// neither carries manually-set geometry beyond what member node positions
// already determine.
export function reconcileDiagram(
  currentNodes: CanvasFlowNode[],
  newDiagram: FlowchartDiagram,
  options: ReconcileOptions,
): { nodes: DiagramFlowNode[]; edges: DiagramFlowEdge[]; groupBoxes: GroupBox[] } {
  const { categories, edgeShape, themeName, callbacks } = options
  const currentById = new Map(currentNodes.filter(isDiagramNode).map((node) => [node.id, node]))
  const categoryIndexById = new Map(categories.map((category, index) => [category.id, index]))
  const groupIds = new Set(newDiagram.groups.map((group) => group.id))

  const nextNodes: DiagramFlowNode[] = []
  let newNodeCount = 0

  for (const node of newDiagram.nodes) {
    const existing = currentById.get(node.id)
    const groupId = node.group_id && groupIds.has(node.group_id) ? node.group_id : null
    const categoryIndex = node.category_id ? categoryIndexById.get(node.category_id) : undefined

    const labelOrTypeChanged = !existing || existing.data.label !== node.label || existing.data.type !== node.type
    const size = labelOrTypeChanged
      ? measureNodeSize(node.label, node.type)
      : { width: existing!.data.width ?? existing!.width ?? NODE_WIDTH, height: existing!.data.height ?? existing!.height ?? NODE_HEIGHT }

    // A brand-new id from this edit -- place it below the diagram like
    // "+ Add node" does, stacking successive new nodes from the same edit
    // instead of dropping them all on the same spot.
    const position = existing
      ? existing.position
      : (() => {
          const base = nextFreePosition(currentNodes.filter(isDiagramNode))
          const offset = newNodeCount * (NODE_HEIGHT + 48)
          newNodeCount += 1
          return { x: base.x, y: base.y + offset }
        })()

    nextNodes.push({
      id: node.id,
      type: 'diagramNode',
      position,
      width: size.width,
      height: size.height,
      selected: false,
      data: {
        id: node.id,
        type: node.type,
        label: node.label,
        group_id: groupId,
        category_id: node.category_id ?? null,
        categoryIndex,
        is_external: node.is_external ?? false,
        categories,
        width: size.width,
        height: size.height,
        onLabelChange: callbacks.onLabelChange,
        onTypeChange: callbacks.onTypeChange,
        onCategoryChange: callbacks.onCategoryChange,
        onExternalToggle: callbacks.onExternalToggle,
        onDelete: callbacks.onDelete,
        onDuplicate: callbacks.onDuplicate,
      },
      draggable: true,
    })
  }

  const nextEdges: DiagramFlowEdge[] = newDiagram.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'diagramEdge',
    label: edge.label ?? undefined,
    data: {
      type: edge.type,
      edgeShape,
      themeName,
      onTypeChange: callbacks.onEdgeTypeChange,
      onLabelChange: callbacks.onEdgeLabelChange,
      onDelete: callbacks.onEdgeDelete,
    },
  }))

  const nodesByGroup = new Map<string, DiagramFlowNode[]>()
  for (const node of nextNodes) {
    if (!node.data.group_id) continue
    const bucket = nodesByGroup.get(node.data.group_id)
    if (bucket) bucket.push(node)
    else nodesByGroup.set(node.data.group_id, [node])
  }

  const groupBoxes: GroupBox[] = []
  for (const group of newDiagram.groups) {
    const members = nodesByGroup.get(group.id)
    if (!members || members.length === 0) continue
    const minX = Math.min(...members.map((n) => n.position.x)) - GROUP_PADDING.left
    const minY = Math.min(...members.map((n) => n.position.y)) - GROUP_PADDING.top
    const maxX = Math.max(...members.map((n) => n.position.x + (n.data.width ?? NODE_WIDTH))) + GROUP_PADDING.right
    const maxY = Math.max(...members.map((n) => n.position.y + (n.data.height ?? NODE_HEIGHT))) + GROUP_PADDING.bottom
    groupBoxes.push({ id: group.id, label: group.label, x: minX, y: minY, width: maxX - minX, height: maxY - minY })
  }

  return { nodes: nextNodes, edges: nextEdges, groupBoxes }
}
