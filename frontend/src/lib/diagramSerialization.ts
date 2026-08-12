import { isDiagramNode, type CanvasFlowNode } from './canvasFlow'
import type { DiagramFlowEdge } from '../components/edges/DiagramEdgeComponent'
import type { DiagramCategory, DiagramGroup, FlowchartDiagram } from '../types'

// The reverse of what layoutDiagram()/the layout effect build: takes the
// live canvas state (real diagram nodes plus every rendering-only field --
// width/height/categoryIndex/handleDirection/the six edit callbacks -- and
// group-container pseudo-nodes mixed in) and strips it down to exactly the
// backend's FlowchartDiagram shape. Used to send the CURRENT, possibly
// manually-edited diagram to the incremental-edit endpoint, since the
// backend has no concept of canvas geometry at all.
export function toBackendDiagram(
  nodes: CanvasFlowNode[],
  edges: DiagramFlowEdge[],
  groups: DiagramGroup[],
  categories: DiagramCategory[],
): FlowchartDiagram {
  return {
    nodes: nodes.filter(isDiagramNode).map((node) => ({
      id: node.id,
      type: node.data.type,
      label: node.data.label,
      group_id: node.data.group_id ?? null,
      category_id: node.data.category_id ?? null,
      is_external: node.data.is_external ?? false,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.data?.type ?? 'default',
      label: typeof edge.label === 'string' ? edge.label : null,
    })),
    groups,
    categories,
  }
}
