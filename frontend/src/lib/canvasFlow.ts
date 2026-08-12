import type { GroupBoxFlowNode } from '../components/nodes/GroupBoxComponent'
import type { DiagramFlowNode } from '../components/nodes/DiagramNodeComponent'
import { NODE_HEIGHT } from './elkLayout'

// Group-container boxes ride in the same React Flow node array as real
// diagram nodes (so they pan/zoom in lockstep) but are a visually and
// interactively distinct kind. Lives here (not in FlowchartCanvas.tsx,
// which also needs reconcileDiagram.ts, which needs these) so nothing
// creates a circular import between the component and the lib functions
// that operate on its node shape.
export type CanvasFlowNode = DiagramFlowNode | GroupBoxFlowNode

export function isDiagramNode(node: CanvasFlowNode): node is DiagramFlowNode {
  return node.type === 'diagramNode'
}

const DEFAULT_NODE_SPACING = 48

// Shared by "+ Add node" and reconcileDiagram.ts's placement of a brand-new
// node from an incremental AI edit -- drops below the current lowest node
// (or near the origin if there's nothing yet) so it lands in visible empty
// space instead of stacked exactly on top of something.
export function nextFreePosition(diagramNodes: DiagramFlowNode[]): { x: number; y: number } {
  const maxY =
    diagramNodes.length > 0 ? Math.max(...diagramNodes.map((n) => n.position.y + (n.data.height ?? NODE_HEIGHT))) : 0
  const minX = diagramNodes.length > 0 ? Math.min(...diagramNodes.map((n) => n.position.x)) : 0
  return { x: minX, y: maxY + DEFAULT_NODE_SPACING }
}
