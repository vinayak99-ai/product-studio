import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'
import type { Edge, Node } from '@xyflow/react'
import type { DiagramCategory, DiagramEdge, DiagramNode, FlowchartDiagram } from '../types'
import { routeEdgesOnGrid } from './gridRouter'
import { measureNodeSize, BASE_HEIGHT } from './nodeSizing'

const elk = new ELK()

// Fallback size only — actual node dimensions are measured per-label in
// measureNodeSize() so a box fits its content instead of every node getting
// an identical fixed size regardless of label length.
export const NODE_WIDTH = 200
export const NODE_HEIGHT = BASE_HEIGHT

// 16:9 — matches the PPTX slide aspect ratio, so the compact layout is already
// slide-shaped before export ever touches it.
const SLIDE_ASPECT_RATIO = '1.7778'

export type LayoutAlgorithm = 'layered' | 'mrtree' | 'rectpacking'
export type LayoutDirection = 'DOWN' | 'RIGHT'

// "Compact" (the 'rectpacking' id, kept for backwards compatibility with the
// UI/export code that key off it) is pinned to a left-to-right flow instead
// of exposing a direction toggle -- it always wraps a single flow-ordered
// chain into rows, so "direction" isn't a free choice the way it is for
// layered/mrtree.
export const DIRECTION_SUPPORTED: Record<LayoutAlgorithm, boolean> = {
  layered: true,
  mrtree: true,
  rectpacking: false,
}

function buildLayoutOptions(algorithm: LayoutAlgorithm, direction: LayoutDirection): Record<string, string> {
  switch (algorithm) {
    case 'layered':
      return {
        'elk.algorithm': 'layered',
        'elk.direction': direction,
        'elk.layered.spacing.nodeNodeBetweenLayers': '70',
        'elk.spacing.nodeNode': '48',
        'elk.spacing.edgeNode': '24',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        // Routes edges in axis-aligned segments around any node in the way,
        // instead of a straight line that can cut through unrelated boxes —
        // load-bearing for edges that skip a layer or loop back to an earlier node.
        'elk.edgeRouting': 'ORTHOGONAL',
      }
    case 'mrtree':
      return {
        'elk.algorithm': 'mrtree',
        'elk.direction': direction,
        'elk.spacing.nodeNode': '48',
        'elk.spacing.edgeNode': '24',
        'elk.mrtree.spacing.nodeNodeBetweenLayers': '70',
        'elk.edgeRouting': 'ORTHOGONAL',
      }
    case 'rectpacking':
      // Deliberately NOT the ELK 'rectpacking' algorithm: rectpacking is a
      // pure bin-packer that sorts nodes by size to fill the target aspect
      // ratio densely, completely ignoring which nodes are actually
      // connected. That's what produced long, winding edges crossing half
      // the diagram to reach a node the graph put right next to it.
      // 'layered' + row-wrapping instead lays nodes out in real flow order
      // (same as the "Flowchart" option) and only wraps that single chain
      // into rows once it gets too wide for the target aspect ratio, so
      // connected nodes stay adjacent -- short edges, like the canonical
      // shapes -- while still landing on a compact, slide-shaped canvas.
      // Bonus: unlike rectpacking, layered always computes real routed
      // edge sections, so this path no longer needs the gridRouter fallback.
      return {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.layered.spacing.nodeNodeBetweenLayers': '50',
        'elk.spacing.nodeNode': '32',
        'elk.spacing.edgeNode': '20',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.wrapping.strategy': 'MULTI_EDGE',
        'elk.aspectRatio': SLIDE_ASPECT_RATIO,
        'elk.layered.wrapping.additionalEdgeSpacing': '20',
        'elk.layered.wrapping.correctionFactor': '1',
      }
  }
}

export type DiagramNodeData = DiagramNode & {
  categoryIndex?: number
  // The diagram's full category legend, not just this node's own slot --
  // lets the node's selection toolbar (DiagramNodeComponent) offer every
  // category as a reassignment option without prop-drilling the diagram
  // itself down through React Flow's node data.
  categories?: DiagramCategory[]
  handleDirection?: LayoutDirection
  width?: number
  height?: number
  // Bumped (never just set to `true`) whenever something wants this node's
  // label to jump straight into edit mode -- a freshly placed node via the
  // shape picker, or an existing selected node via the Enter/F2 shortcut.
  // A counter instead of a boolean so DiagramNodeComponent's effect can
  // fire again on a second Enter press even though the value "changed" to
  // the same conceptual request.
  editRequestId?: number
} & Record<string, unknown>

export interface Waypoint {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface GroupBox {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
}

export type DiagramEdgeData = {
  type: string
  waypoints?: Waypoint[]
  // Every node's box, so a label can be kept clear of any node it passes
  // near -- not just its own source/target. A long routed edge (e.g. a
  // row-wrap transition in Compact) can run right alongside an unrelated
  // node the label would otherwise land on top of.
  nodeBoxes?: Box[]
}

// ELK node ids for group containers are prefixed to keep them out of the
// same id-space as real diagram nodes (LLM-generated slugs never contain a
// colon) -- lets the post-layout walk tell "this child is a group
// container" apart from "this child is a leaf node" by id alone.
const GROUP_NODE_PREFIX = 'grp:'

// Reserves room at the top of a group's interior for the title pill
// GroupBoxComponent renders, plus a little breathing room on every side so
// member nodes never touch the border.
const GROUP_PADDING = '[top=40.0,left=18.0,bottom=18.0,right=18.0]'

export async function layoutDiagram(
  diagram: FlowchartDiagram,
  algorithm: LayoutAlgorithm = 'layered',
  direction: LayoutDirection = 'DOWN',
): Promise<{
  nodes: Node<DiagramNodeData, 'diagramNode'>[]
  edges: Edge<DiagramEdgeData, 'diagramEdge'>[]
  groupBoxes: GroupBox[]
}> {
  const sizesById = new Map(diagram.nodes.map((node) => [node.id, measureNodeSize(node.label, node.type)]))
  const groupsById = new Map(diagram.groups.map((group) => [group.id, group]))

  // A node's group only counts if it resolves to a real, declared group --
  // validate_diagram() already flags a dangling group_id as a warning
  // (unknown_group), so this treats that case the same as ungrouped rather
  // than crashing on a missing lookup.
  const groupIdOf = (node: DiagramNode): string | null =>
    node.group_id && groupsById.has(node.group_id) ? node.group_id : null

  const leafElkNode = (node: DiagramNode): ElkNode => {
    const size = sizesById.get(node.id)!
    return { id: node.id, width: size.width, height: size.height }
  }

  const ungroupedNodes = diagram.nodes.filter((node) => groupIdOf(node) === null)
  const groupedNodesByGroupId = new Map<string, DiagramNode[]>()
  for (const node of diagram.nodes) {
    const groupId = groupIdOf(node)
    if (!groupId) continue
    const bucket = groupedNodesByGroupId.get(groupId)
    if (bucket) bucket.push(node)
    else groupedNodesByGroupId.set(groupId, [node])
  }

  // Edges must live in the `edges` list of the lowest common ancestor of
  // their two endpoints (ELK's own hierarchical-layout requirement) -- same
  // group on both ends -> that group's own list; anything else (different
  // groups, or either endpoint ungrouped) -> the root's list.
  const rootEdges: ElkNode['edges'] = []
  const groupEdgesByGroupId = new Map<string, NonNullable<ElkNode['edges']>>()
  for (const edge of diagram.edges) {
    const sourceGroup = groupIdOf(diagram.nodes.find((n) => n.id === edge.source)!)
    const targetGroup = groupIdOf(diagram.nodes.find((n) => n.id === edge.target)!)
    const elkEdge = { id: edge.id, sources: [edge.source], targets: [edge.target] }
    if (sourceGroup && sourceGroup === targetGroup) {
      const bucket = groupEdgesByGroupId.get(sourceGroup)
      if (bucket) bucket.push(elkEdge)
      else groupEdgesByGroupId.set(sourceGroup, [elkEdge])
    } else {
      rootEdges.push(elkEdge)
    }
  }

  const groupChildren: ElkNode[] = Array.from(groupedNodesByGroupId.entries()).map(([groupId, members]) => ({
    id: GROUP_NODE_PREFIX + groupId,
    layoutOptions: { 'elk.padding': GROUP_PADDING },
    children: members.map(leafElkNode),
    edges: groupEdgesByGroupId.get(groupId) ?? [],
  }))

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions: buildLayoutOptions(algorithm, direction),
    children: [...ungroupedNodes.map(leafElkNode), ...groupChildren],
    edges: rootEdges,
  }

  const result = await elk.layout(elkGraph)
  const nodesById = new Map(diagram.nodes.map((node) => [node.id, node]))
  // Fixed position in diagram.categories, not a hash of the id -- the same
  // slot (and so the same color, via getCategoryStyle) every time the same
  // diagram is laid out, matching the "fixed hue order" rule the legend
  // itself follows (see theme.ts).
  const categoryIndexById = new Map(diagram.categories.map((category, index) => [category.id, index]))

  // Compact is pinned to a left-to-right flow (see buildLayoutOptions), so
  // its nodes always get left/right handles regardless of whatever direction
  // was last selected on layered/mrtree.
  const handleDirection: LayoutDirection | undefined =
    algorithm === 'rectpacking' ? 'RIGHT' : DIRECTION_SUPPORTED[algorithm] ? direction : undefined

  // ELK gives every node's x/y relative to its own parent, not the graph --
  // a group's members are relative to THAT group's origin, not absolute
  // canvas coordinates. Walk the (at most 2-level) tree once, adding each
  // group's own resolved offset onto its members, so everything downstream
  // (React Flow positions, edge-label clearance boxes, the grid-routing
  // fallback) can keep working with plain absolute coordinates exactly as
  // it did before groups existed.
  interface FlatLeaf {
    id: string
    x: number
    y: number
    width: number
    height: number
  }
  const flatLeaves: FlatLeaf[] = []
  const groupBoxes: GroupBox[] = []
  for (const child of result.children ?? []) {
    if (child.id.startsWith(GROUP_NODE_PREFIX)) {
      const groupId = child.id.slice(GROUP_NODE_PREFIX.length)
      const gx = child.x ?? 0
      const gy = child.y ?? 0
      groupBoxes.push({
        id: groupId,
        label: groupsById.get(groupId)!.label,
        x: gx,
        y: gy,
        width: child.width ?? 0,
        height: child.height ?? 0,
      })
      for (const member of child.children ?? []) {
        flatLeaves.push({
          id: member.id,
          x: gx + (member.x ?? 0),
          y: gy + (member.y ?? 0),
          width: member.width ?? NODE_WIDTH,
          height: member.height ?? NODE_HEIGHT,
        })
      }
    } else {
      flatLeaves.push({
        id: child.id,
        x: child.x ?? 0,
        y: child.y ?? 0,
        width: child.width ?? NODE_WIDTH,
        height: child.height ?? NODE_HEIGHT,
      })
    }
  }

  const nodes: Node<DiagramNodeData, 'diagramNode'>[] = flatLeaves.map((leaf) => {
    const diagramNode = nodesById.get(leaf.id)!
    const categoryIndex = diagramNode.category_id ? categoryIndexById.get(diagramNode.category_id) : undefined
    return {
      id: leaf.id,
      type: 'diagramNode',
      position: { x: leaf.x, y: leaf.y },
      // Top-level width/height so React Flow's own viewport/fitView math is
      // correct immediately, not just after the DOM node is first measured.
      width: leaf.width,
      height: leaf.height,
      data: { ...diagramNode, categoryIndex, categories: diagram.categories, handleDirection, width: leaf.width, height: leaf.height },
      draggable: true,
    }
  })

  // ELK computes obstacle-avoiding routes as part of layout (bend points that
  // steer around any node in the way), keyed by edge id. Read those back so
  // rendering can follow the same route instead of drawing a naive straight
  // line between node ports that can cut through unrelated nodes. Root-level
  // edges are already in absolute coordinates; a group's own edges are
  // relative to that group's origin (same reasoning as the node flattening
  // above), so those need the same offset added to every point.
  const routesById = new Map<string, Waypoint[]>()
  const collectRoutes = (elkEdges: ElkNode['edges'] | undefined, offsetX: number, offsetY: number) => {
    for (const elkEdge of elkEdges ?? []) {
      const section = elkEdge.sections?.[0]
      if (!section) continue
      const shift = (p: Waypoint): Waypoint => ({ x: p.x + offsetX, y: p.y + offsetY })
      const points: Waypoint[] = [
        shift(section.startPoint),
        ...(section.bendPoints ?? []).map(shift),
        shift(section.endPoint),
      ]
      routesById.set(elkEdge.id, points)
    }
  }
  collectRoutes(result.edges, 0, 0)
  for (const child of result.children ?? []) {
    if (child.id.startsWith(GROUP_NODE_PREFIX)) {
      collectRoutes(child.edges, child.x ?? 0, child.y ?? 0)
    }
  }

  // rectpacking (and potentially other future algorithms) never populates
  // edge sections at all -- verified directly against elkjs, not just this
  // graph -- regardless of elk.edgeRouting. Route those ourselves on a grid
  // so they still avoid node boxes instead of silently falling back to a
  // naive point-to-point line.
  if (routesById.size === 0 && diagram.edges.length > 0) {
    const gridRoutes = routeEdgesOnGrid(flatLeaves, diagram.edges)
    for (const [id, points] of gridRoutes) routesById.set(id, points)
  }

  // So the edge label can be kept clear of every node's actual box (nothing
  // else knows their real position/size -- the label chip is positioned
  // independently of ELK's own layout and routing math). One shared array,
  // not recomputed per edge.
  const nodeBoxes: Box[] = flatLeaves.map((leaf) => ({ x: leaf.x, y: leaf.y, width: leaf.width, height: leaf.height }))

  const edges: Edge<DiagramEdgeData, 'diagramEdge'>[] = diagram.edges.map((edge: DiagramEdge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label ?? undefined,
    type: 'diagramEdge',
    data: {
      type: edge.type,
      waypoints: routesById.get(edge.id),
      nodeBoxes,
    },
  }))

  return { nodes, edges, groupBoxes }
}
