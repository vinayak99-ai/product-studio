import { jsPDF } from 'jspdf'
import { NODE_HEIGHT, NODE_WIDTH, type GroupBox } from './elkLayout'
import { getCategoryStyle } from './theme'
import type { DiagramPalette } from './themes'
import type { DiagramCategory, EdgeType, NodeType } from '../types'
import type { DiagramFlowNode } from '../components/nodes/DiagramNodeComponent'
import type { DiagramFlowEdge } from '../components/edges/DiagramEdgeComponent'

// Draws the diagram directly from its node/edge/group data (mirrors
// lib/exportPptx.ts's approach) instead of screenshotting the canvas DOM
// the way lib/export.ts's exportPdf does -- text stays real vector text at
// any size, and there's no grid-background pattern to accidentally bake
// in, because nothing is ever rasterized.
//
// Unlike the PPTX exporter, which has to scale everything to fit a fixed
// 13.333x7.5in slide, a PDF page can be any size -- so the page is sized
// to the diagram's own extent (in the same raw pixel units React Flow
// already positions nodes in, `unit: 'px'`, the same convention the old
// raster exportPdf in lib/export.ts already used for its viewport-sized
// page) rather than shrinking the diagram to fit a fixed page.

const MARGIN_PX = 60
const TITLE_HEIGHT_PX = 70
const LEGEND_ROW_HEIGHT_PX = 34
const LEGEND_DOT_SIZE_PX = 12
const LEGEND_CHIP_GAP_PX = 26

// A page beyond this on either axis would be an unreasonable PDF (and slow
// to rasterize in a viewer) -- past this, the whole diagram is scaled down
// uniformly to fit rather than growing the page further. 200in at 96px/in.
const MAX_PAGE_DIMENSION_PX = 200 * 96

const shapeCornerRadiusPx = 10

function estimateChipWidth(label: string): number {
  return LEGEND_DOT_SIZE_PX + 8 + label.length * 6.5 + LEGEND_CHIP_GAP_PX
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function pointTowards(box: Box, target: { x: number; y: number }): { x: number; y: number } {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const dx = target.x - cx
  const dy = target.y - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const scaleX = dx !== 0 ? box.w / 2 / Math.abs(dx) : Infinity
  const scaleY = dy !== 0 ? box.h / 2 / Math.abs(dy) : Infinity
  const scale = Math.min(scaleX, scaleY)
  return { x: cx + dx * scale, y: cy + dy * scale }
}

function drawPolygon(pdf: jsPDF, points: { x: number; y: number }[], style: string): void {
  if (points.length < 2) return
  const [first, ...rest] = points
  const segments = rest.map((p, i) => {
    const prev = points[i]
    return [p.x - prev.x, p.y - prev.y]
  })
  pdf.lines(segments, first.x, first.y, [1, 1], style, true)
}

function drawArrowhead(pdf: jsPDF, from: { x: number; y: number }, to: { x: number; y: number }, color: string): void {
  const size = 7
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const back = Math.PI - 0.45
  const p2 = { x: to.x + size * Math.cos(angle + back), y: to.y + size * Math.sin(angle + back) }
  const p3 = { x: to.x + size * Math.cos(angle - back), y: to.y + size * Math.sin(angle - back) }
  pdf.setFillColor(color)
  pdf.triangle(to.x, to.y, p2.x, p2.y, p3.x, p3.y, 'F')
}

function buildNodeStyles(palette: DiagramPalette): Record<NodeType, { fill: string; line: string; font: string; bold?: boolean }> {
  return {
    start: { fill: palette.primary, line: palette.primaryDark, font: '#FFFFFF', bold: true },
    end: { fill: palette.neutral900, line: palette.neutral900, font: '#FFFFFF', bold: true },
    process: { fill: '#FFFFFF', line: palette.neutral200, font: palette.neutral900 },
    decision: { fill: palette.accentLight, line: palette.accent, font: palette.neutral900 },
    io: { fill: palette.primaryLight, line: palette.primary, font: palette.neutral900 },
    subprocess: { fill: '#FFFFFF', line: palette.neutral600, font: palette.neutral900 },
    database: { fill: '#FFFFFF', line: palette.neutral300, font: palette.neutral900 },
  }
}

function buildEdgeStyles(palette: DiagramPalette): Record<EdgeType, { color: string; dash: number[] }> {
  return {
    default: { color: palette.neutral600, dash: [] },
    conditional: { color: palette.accent, dash: [5, 3.5] },
  }
}

export interface ExportPdfVectorOptions {
  title?: string
  fileName?: string
}

export async function exportPdfVector(
  nodes: DiagramFlowNode[],
  edges: DiagramFlowEdge[],
  groupBoxes: GroupBox[],
  categories: DiagramCategory[],
  palette: DiagramPalette,
  options: ExportPdfVectorOptions = {},
): Promise<void> {
  if (nodes.length === 0) return

  const nodeStyles = buildNodeStyles(palette)
  const edgeStyles = buildEdgeStyles(palette)
  const categoryIndexById = new Map(categories.map((category, index) => [category.id, index]))

  const nodeWidth = (node: DiagramFlowNode) => node.data.width ?? node.width ?? NODE_WIDTH
  const nodeHeight = (node: DiagramFlowNode) => node.data.height ?? node.height ?? NODE_HEIGHT

  // Group box extents count toward the layout bounds too -- their padding
  // reaches slightly beyond their tightest-fit member nodes.
  const minX = Math.min(...nodes.map((node) => node.position.x), ...groupBoxes.map((box) => box.x))
  const minY = Math.min(...nodes.map((node) => node.position.y), ...groupBoxes.map((box) => box.y))
  const maxX = Math.max(
    ...nodes.map((node) => node.position.x + nodeWidth(node)),
    ...groupBoxes.map((box) => box.x + box.width),
  )
  const maxY = Math.max(
    ...nodes.map((node) => node.position.y + nodeHeight(node)),
    ...groupBoxes.map((box) => box.y + box.height),
  )
  const diagramW = Math.max(maxX - minX, 1)
  const diagramH = Math.max(maxY - minY, 1)

  // Reserves a footer strip for the category legend (wrapping to a second
  // row if there isn't room for every chip on one line).
  let legendRows = 0
  if (categories.length > 0) {
    legendRows = 1
    let cursorW = 0
    for (const category of categories) {
      const chipW = estimateChipWidth(category.label)
      if (cursorW + chipW > diagramW && cursorW > 0) {
        legendRows += 1
        cursorW = 0
      }
      cursorW += chipW
    }
  }
  const legendHeight = legendRows > 0 ? legendRows * LEGEND_ROW_HEIGHT_PX + 16 : 0

  const rawPageW = diagramW + MARGIN_PX * 2
  const rawPageH = diagramH + MARGIN_PX * 2 + TITLE_HEIGHT_PX + legendHeight

  // Past the cap, scale the whole diagram down uniformly to fit rather
  // than growing the page further -- the ask is "a big diagram gets a big,
  // uncropped, clean PDF," not literal multi-page tiling, and a diagram
  // has to be genuinely enormous (hundreds of nodes) to reach 200in.
  const overflowScale = Math.min(MAX_PAGE_DIMENSION_PX / rawPageW, MAX_PAGE_DIMENSION_PX / rawPageH, 1)
  const pageW = rawPageW * overflowScale
  const pageH = rawPageH * overflowScale
  const scale = overflowScale

  const pdf = new jsPDF({ orientation: pageW >= pageH ? 'landscape' : 'portrait', unit: 'px', hotfixes: ['px_scaling'], format: [pageW, pageH] })

  pdf.setFillColor(palette.neutral50)
  pdf.rect(0, 0, pageW, pageH, 'F')

  const contentX = MARGIN_PX * scale
  const contentY = (MARGIN_PX + TITLE_HEIGHT_PX) * scale
  const offsetX = contentX - minX * scale
  const offsetY = contentY - minY * scale

  const tx = (x: number) => offsetX + x * scale
  const ty = (y: number) => offsetY + y * scale
  const ts = (v: number) => v * scale

  // Title
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(22 * scale)
  pdf.setTextColor(palette.neutral900)
  pdf.text(options.title ?? 'Flowchart', MARGIN_PX * scale, (MARGIN_PX + 24) * scale, { baseline: 'alphabetic' })
  pdf.setDrawColor(palette.primary)
  pdf.setLineWidth(3 * scale)
  pdf.line(MARGIN_PX * scale, (MARGIN_PX + 40) * scale, pageW - MARGIN_PX * scale, (MARGIN_PX + 40) * scale)

  const boxes = new Map<string, Box>()
  for (const node of nodes) {
    boxes.set(node.id, { x: tx(node.position.x), y: ty(node.position.y), w: ts(nodeWidth(node)), h: ts(nodeHeight(node)) })
  }

  // Group boxes first so they sit behind edges and node shapes.
  pdf.setFont('helvetica', 'bold')
  for (const box of groupBoxes) {
    const x = tx(box.x)
    const y = ty(box.y)
    const w = ts(box.width)
    const h = ts(box.height)
    pdf.setDrawColor(palette.neutral300)
    pdf.setLineWidth(1 * scale)
    pdf.setLineDashPattern([4 * scale, 3 * scale], 0)
    pdf.roundedRect(x, y, w, h, 8 * scale, 8 * scale, 'S')
    pdf.setLineDashPattern([], 0)

    pdf.setFontSize(8 * scale)
    pdf.setTextColor(palette.neutral600)
    const labelW = Math.max(w - 20 * scale, 20)
    pdf.setFillColor(palette.neutral50)
    pdf.rect(x + 8 * scale, y - 8 * scale, labelW, 14 * scale, 'F')
    pdf.text(box.label.toUpperCase(), x + 10 * scale, y + 2 * scale, { baseline: 'alphabetic', maxWidth: labelW })
  }

  // Edges before node shapes so shapes sit visually on top of the lines.
  for (const edge of edges) {
    const sourceBox = boxes.get(edge.source)
    const targetBox = boxes.get(edge.target)
    if (!sourceBox || !targetBox) continue

    const sourceCenter = { x: sourceBox.x + sourceBox.w / 2, y: sourceBox.y + sourceBox.h / 2 }
    const targetCenter = { x: targetBox.x + targetBox.w / 2, y: targetBox.y + targetBox.h / 2 }
    const start = pointTowards(sourceBox, targetCenter)
    const end = pointTowards(targetBox, sourceCenter)

    const edgeType = (edge.data?.type ?? 'default') as EdgeType
    const style = edgeStyles[edgeType]

    pdf.setDrawColor(style.color)
    pdf.setLineWidth(1.25 * scale)
    pdf.setLineDashPattern(style.dash.map((d) => d * scale), 0)
    pdf.line(start.x, start.y, end.x, end.y)
    pdf.setLineDashPattern([], 0)
    drawArrowhead(pdf, start, end, style.color)

    if (edge.label) {
      const midX = (start.x + end.x) / 2
      const midY = (start.y + end.y) / 2
      const labelW = 80 * scale
      const labelH = 22 * scale
      pdf.setFillColor('#FFFFFF')
      pdf.setDrawColor(palette.neutral200)
      pdf.setLineWidth(0.5 * scale)
      pdf.roundedRect(midX - labelW / 2, midY - labelH / 2, labelW, labelH, 3 * scale, 3 * scale, 'FD')
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9 * scale)
      pdf.setTextColor(palette.neutral900)
      pdf.text(String(edge.label), midX, midY, { align: 'center', baseline: 'middle', maxWidth: labelW - 6 })
    }
  }

  for (const node of nodes) {
    const box = boxes.get(node.id)!
    const baseStyle = nodeStyles[node.data.type]
    const categoryIndex = node.data.category_id ? categoryIndexById.get(node.data.category_id) : undefined
    const categoryStyle = categoryIndex !== undefined ? getCategoryStyle(categoryIndex) : null
    const style = categoryStyle
      ? { fill: categoryStyle.fill, line: categoryStyle.border, font: categoryStyle.text, bold: baseStyle.bold }
      : baseStyle

    pdf.setFillColor(style.fill)
    pdf.setDrawColor(style.line)
    pdf.setLineWidth(1.25 * scale)

    switch (node.data.type) {
      case 'start':
      case 'end': {
        const r = box.h / 2
        pdf.roundedRect(box.x, box.y, box.w, box.h, r, r, 'FD')
        break
      }
      case 'decision': {
        const cx = box.x + box.w / 2
        const cy = box.y + box.h / 2
        drawPolygon(
          pdf,
          [
            { x: cx, y: box.y },
            { x: box.x + box.w, y: cy },
            { x: cx, y: box.y + box.h },
            { x: box.x, y: cy },
          ],
          'FD',
        )
        break
      }
      case 'io': {
        const skew = box.h * 0.3
        drawPolygon(
          pdf,
          [
            { x: box.x + skew, y: box.y },
            { x: box.x + box.w, y: box.y },
            { x: box.x + box.w - skew, y: box.y + box.h },
            { x: box.x, y: box.y + box.h },
          ],
          'FD',
        )
        break
      }
      case 'subprocess': {
        pdf.roundedRect(box.x, box.y, box.w, box.h, shapeCornerRadiusPx * scale, shapeCornerRadiusPx * scale, 'FD')
        pdf.setDrawColor(palette.neutral600)
        pdf.setLineWidth(1 * scale)
        pdf.line(box.x + 6 * scale, box.y, box.x + 6 * scale, box.y + box.h)
        pdf.line(box.x + box.w - 6 * scale, box.y, box.x + box.w - 6 * scale, box.y + box.h)
        break
      }
      case 'database': {
        const capH = Math.max(12 * scale, box.h * 0.22)
        // Rounds all four corners, then the cap ellipse drawn after covers
        // the top edge -- same "rounded bottom only" look the on-screen
        // cylinder achieves with a CSS per-corner radius, since jsPDF's
        // roundedRect only takes one uniform radius.
        pdf.roundedRect(box.x, box.y + capH / 2, box.w, box.h - capH / 2, capH / 2, capH / 2, 'FD')
        pdf.ellipse(box.x + box.w / 2, box.y + capH / 2, box.w / 2, capH / 2, 'FD')
        break
      }
      default: {
        // process
        pdf.roundedRect(box.x, box.y, box.w, box.h, shapeCornerRadiusPx * scale, shapeCornerRadiusPx * scale, 'FD')
      }
    }

    pdf.setFont('helvetica', node.data.type === 'start' || node.data.type === 'end' ? 'bold' : 'normal')
    pdf.setFontSize(11 * scale)
    pdf.setTextColor(style.font)
    pdf.text(node.data.label, box.x + box.w / 2, box.y + box.h / 2, {
      align: 'center',
      baseline: 'middle',
      maxWidth: Math.max(box.w - 12 * scale, 10),
    })

    if (node.data.is_external) {
      pdf.setFillColor('#10B981')
      pdf.setDrawColor('#FFFFFF')
      pdf.setLineWidth(1.5 * scale)
      pdf.ellipse(box.x + box.w - 4 * scale, box.y + 2 * scale, 6 * scale, 6 * scale, 'FD')
    }
  }

  // Category legend footer.
  if (categories.length > 0) {
    let cursorX = MARGIN_PX * scale
    let rowY = pageH - legendHeight * scale - MARGIN_PX * scale + 20 * scale
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9 * scale)
    for (const category of categories) {
      const chipW = estimateChipWidth(category.label) * scale
      if (cursorX + chipW > pageW - MARGIN_PX * scale && cursorX > MARGIN_PX * scale) {
        rowY += LEGEND_ROW_HEIGHT_PX * scale
        cursorX = MARGIN_PX * scale
      }
      const index = categoryIndexById.get(category.id)!
      const style = getCategoryStyle(index)
      pdf.setFillColor(style.border)
      pdf.setDrawColor(style.border)
      pdf.ellipse(cursorX + (LEGEND_DOT_SIZE_PX / 2) * scale, rowY, (LEGEND_DOT_SIZE_PX / 2) * scale, (LEGEND_DOT_SIZE_PX / 2) * scale, 'FD')
      pdf.setTextColor(palette.neutral600)
      pdf.text(category.label, cursorX + (LEGEND_DOT_SIZE_PX + 6) * scale, rowY, { baseline: 'middle' })
      cursorX += chipW
    }
  }

  pdf.save(options.fileName ?? 'flowchart.pdf')
}
