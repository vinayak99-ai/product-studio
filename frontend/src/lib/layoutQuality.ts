import type { Edge } from '@xyflow/react'
import type { DiagramEdgeData, Waypoint } from './elkLayout'

// Standard orientation/cross-product segment-intersection test -- treats a
// shared endpoint as a touch, not a crossing (irrelevant here anyway since
// countEdgeCrossings already skips edge pairs sharing a node).
function orientation(a: Waypoint, b: Waypoint, c: Waypoint): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)
  if (value === 0) return 0
  return value > 0 ? 1 : 2
}

function onSegment(a: Waypoint, b: Waypoint, c: Waypoint): boolean {
  return (
    b.x <= Math.max(a.x, c.x) && b.x >= Math.min(a.x, c.x) && b.y <= Math.max(a.y, c.y) && b.y >= Math.min(a.y, c.y)
  )
}

function segmentsIntersect(p1: Waypoint, p2: Waypoint, p3: Waypoint, p4: Waypoint): boolean {
  const o1 = orientation(p1, p2, p3)
  const o2 = orientation(p1, p2, p4)
  const o3 = orientation(p3, p4, p1)
  const o4 = orientation(p3, p4, p2)

  if (o1 !== o2 && o3 !== o4) return true

  // Collinear special cases -- an overlapping (not just touching) run counts
  // as a crossing too, the same as a diamond edge visually overlapping a
  // parallel line for part of its length.
  if (o1 === 0 && onSegment(p1, p3, p2)) return true
  if (o2 === 0 && onSegment(p1, p4, p2)) return true
  if (o3 === 0 && onSegment(p3, p1, p4)) return true
  if (o4 === 0 && onSegment(p3, p2, p4)) return true

  return false
}

// "Does this layout look bad" as a computable fact instead of a guess --
// counts how many times two DIFFERENT edges' routed polylines cross each
// other. Edges sharing a source or target node are skipped: meeting at a
// shared node is a normal junction, not a bad crossing. Brute-force
// segment-pair comparison is intentional -- a flowchart rarely has more
// than a few dozen edges, so there's no need for a sweep-line optimization.
export function countEdgeCrossings(edges: Edge<DiagramEdgeData>[]): number {
  let crossings = 0
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i]
    const aPoints = a.data?.waypoints
    if (!aPoints || aPoints.length < 2) continue

    for (let j = i + 1; j < edges.length; j++) {
      const b = edges[j]
      if (a.source === b.source || a.source === b.target || a.target === b.source || a.target === b.target) continue

      const bPoints = b.data?.waypoints
      if (!bPoints || bPoints.length < 2) continue

      for (let p = 0; p < aPoints.length - 1; p++) {
        for (let q = 0; q < bPoints.length - 1; q++) {
          if (segmentsIntersect(aPoints[p], aPoints[p + 1], bPoints[q], bPoints[q + 1])) {
            crossings += 1
          }
        }
      }
    }
  }
  return crossings
}

// Crossings alone miss a real bad case: two edges can run parallel and
// close together for a long stretch (a winding detour around a row-wrap,
// say) without their lines ever literally intersecting -- still reads as
// cluttered, just not as a "crossing." Bend count is the standard second
// half of graph-drawing aesthetics alongside crossing count (the Sugiyama
// framework's own criteria: minimize both) and catches exactly that --
// every additional turn in a route is a vote for "this could be simpler."
//
// Only counts a waypoint as a bend if it's a genuine direction change (a
// non-zero cross product between the incoming and outgoing segment) --
// ELK sometimes emits an extra collinear waypoint along an otherwise
// dead-straight run (confirmed directly: a plain 2-node/1-edge diagram
// under Compact still came back with an interior waypoint despite
// rendering as one straight line), and counting that as a real bend would
// unfairly penalize a layout that's actually just as clean as a candidate
// with a literally shorter waypoint list.
export function countTotalBends(edges: Edge<DiagramEdgeData>[]): number {
  let bends = 0
  for (const edge of edges) {
    const points = edge.data?.waypoints
    if (!points || points.length < 3) continue
    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1]
      const curr = points[i]
      const next = points[i + 1]
      const cross = (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x)
      if (Math.abs(cross) > 0.01) bends += 1
    }
  }
  return bends
}
