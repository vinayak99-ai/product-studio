import pptxgen from 'pptxgenjs'
import { NODE_HEIGHT, NODE_WIDTH, type GroupBox } from './elkLayout'
import { getCategoryStyle } from './theme'
import type { DiagramPalette } from './themes'
import type { DiagramCategory, EdgeType, NodeType } from '../types'
import type { DiagramFlowNode } from '../components/nodes/DiagramNodeComponent'
import type { DiagramFlowEdge } from '../components/edges/DiagramEdgeComponent'

const SLIDE_WIDTH_IN = 13.333
const SLIDE_HEIGHT_IN = 7.5
const MARGIN_IN = 0.6
const TITLE_HEIGHT_IN = 0.7

// PowerPoint's native "Flowchart" autoshapes — editable/resizable in PPT, unlike a
// picture of the canvas.
const shapeByNodeType: Record<NodeType, string> = {
  start: 'flowChartTerminator',
  end: 'flowChartTerminator',
  process: 'flowChartProcess',
  decision: 'flowChartDecision',
  io: 'flowChartInputOutput',
  subprocess: 'flowChartPredefinedProcess',
  // PowerPoint's basic-shapes cylinder -- a placeholder mapping; sizing it
  // to actually look like a cylinder (rather than a squashed can) is
  // Phase 3 export-polish work, not blocking here.
  database: 'can',
}

// pptxgenjs wants bare uppercase hex (no '#'); theme palettes store '#rrggbb'.
function hex(value: string): string {
  return value.replace('#', '').toUpperCase()
}

// Derived from the currently active palette (src/lib/themes.ts) so the deck always
// matches whatever theme is selected on screen — not a fixed brand color.
function buildNodeStyles(
  palette: DiagramPalette,
): Record<NodeType, { fill: string; line: string; font: string; bold?: boolean }> {
  return {
    start: { fill: hex(palette.primary), line: hex(palette.primaryDark), font: 'FFFFFF', bold: true },
    end: { fill: hex(palette.neutral900), line: hex(palette.neutral900), font: 'FFFFFF', bold: true },
    process: { fill: 'FFFFFF', line: hex(palette.neutral200), font: hex(palette.neutral900) },
    decision: { fill: hex(palette.accentLight), line: hex(palette.accent), font: hex(palette.neutral900) },
    io: { fill: hex(palette.primaryLight), line: hex(palette.primary), font: hex(palette.neutral900) },
    subprocess: { fill: 'FFFFFF', line: hex(palette.neutral600), font: hex(palette.neutral900) },
    database: { fill: 'FFFFFF', line: hex(palette.neutral300), font: hex(palette.neutral900) },
  }
}

function buildEdgeStyles(palette: DiagramPalette): Record<EdgeType, { color: string; dash: 'solid' | 'dash' }> {
  return {
    default: { color: hex(palette.neutral600), dash: 'solid' },
    conditional: { color: hex(palette.accent), dash: 'dash' },
  }
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

export interface ExportPptxOptions {
  title?: string
  fileName?: string
}

const LEGEND_ROW_HEIGHT_IN = 0.26
const LEGEND_CHIP_GAP_IN = 0.22
const LEGEND_DOT_SIZE_IN = 0.1

// Rough per-character width estimate at the legend's font size -- exact
// text measurement isn't available outside a DOM, and this only needs to
// be close enough to decide when a chip should wrap to the next row.
function estimateChipWidth(label: string): number {
  return LEGEND_DOT_SIZE_IN + 0.08 + label.length * 0.075 + LEGEND_CHIP_GAP_IN
}

export async function exportPptx(
  nodes: DiagramFlowNode[],
  edges: DiagramFlowEdge[],
  groupBoxes: GroupBox[],
  categories: DiagramCategory[],
  palette: DiagramPalette,
  options: ExportPptxOptions = {},
): Promise<void> {
  if (nodes.length === 0) return

  const nodeStyles = buildNodeStyles(palette)
  const edgeStyles = buildEdgeStyles(palette)

  const pptx = new pptxgen()
  pptx.defineLayout({ name: 'FLOWCHART_16x9', width: SLIDE_WIDTH_IN, height: SLIDE_HEIGHT_IN })
  pptx.layout = 'FLOWCHART_16x9'

  const slide = pptx.addSlide()
  slide.background = { color: hex(palette.neutral50) }

  slide.addText(options.title ?? 'Flowchart', {
    x: MARGIN_IN,
    y: 0.25,
    w: SLIDE_WIDTH_IN - MARGIN_IN * 2,
    h: TITLE_HEIGHT_IN - 0.15,
    fontFace: 'Calibri',
    fontSize: 22,
    bold: true,
    color: hex(palette.neutral900),
  })
  slide.addShape('rect', {
    x: MARGIN_IN,
    y: 0.25 + TITLE_HEIGHT_IN - 0.1,
    w: SLIDE_WIDTH_IN - MARGIN_IN * 2,
    h: 0.03,
    fill: { color: hex(palette.primary) },
    line: { color: hex(palette.primary) },
  })

  const contentX = MARGIN_IN
  const contentY = MARGIN_IN + TITLE_HEIGHT_IN
  const contentW = SLIDE_WIDTH_IN - MARGIN_IN * 2

  // Reserves a footer strip for the category legend (wrapping to a second
  // row if there isn't room for every chip on one line) so the diagram
  // itself is scaled to leave that space rather than overlapping it.
  let legendRows = 0
  if (categories.length > 0) {
    legendRows = 1
    let cursorW = 0
    for (const category of categories) {
      const chipW = estimateChipWidth(category.label)
      if (cursorW + chipW > contentW && cursorW > 0) {
        legendRows += 1
        cursorW = 0
      }
      cursorW += chipW
    }
  }
  const legendHeight = legendRows > 0 ? legendRows * LEGEND_ROW_HEIGHT_IN + 0.1 : 0
  const contentH = SLIDE_HEIGHT_IN - contentY - MARGIN_IN - legendHeight

  // Each node is sized to fit its own label (lib/nodeSizing.ts) rather than
  // a fixed box, so the deck has to read each node's actual width/height
  // instead of assuming the old constant -- otherwise shapes on the slide
  // wouldn't match what was on screen.
  const nodeWidth = (node: DiagramFlowNode) => node.data.width ?? node.width ?? NODE_WIDTH
  const nodeHeight = (node: DiagramFlowNode) => node.data.height ?? node.height ?? NODE_HEIGHT

  // Group box extents count toward the layout bounds too -- their padding
  // reaches slightly beyond their tightest-fit member nodes, so leaving
  // them out would let a group's border clip against the slide edge.
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
  const layoutW = Math.max(maxX - minX, 1)
  const layoutH = Math.max(maxY - minY, 1)

  const scale = Math.min(contentW / layoutW, contentH / layoutH)
  const offsetX = contentX + (contentW - layoutW * scale) / 2
  const offsetY = contentY + (contentH - layoutH * scale) / 2

  const boxes = new Map<string, Box>()
  for (const node of nodes) {
    boxes.set(node.id, {
      x: offsetX + (node.position.x - minX) * scale,
      y: offsetY + (node.position.y - minY) * scale,
      w: nodeWidth(node) * scale,
      h: nodeHeight(node) * scale,
    })
  }

  // Group boxes first so they sit behind both edges and node shapes, same
  // stacking order as GroupBoxComponent's zIndex -1 on screen.
  const categoryIndexById = new Map(categories.map((category, index) => [category.id, index]))
  for (const box of groupBoxes) {
    slide.addShape('roundRect', {
      x: offsetX + (box.x - minX) * scale,
      y: offsetY + (box.y - minY) * scale,
      w: box.width * scale,
      h: box.height * scale,
      rectRadius: 0.08,
      fill: { type: 'none' },
      line: { color: hex(palette.neutral300), width: 1, dashType: 'dash' },
    })
    slide.addText(box.label.toUpperCase(), {
      x: offsetX + (box.x - minX) * scale + 0.1,
      y: offsetY + (box.y - minY) * scale - 0.14,
      w: Math.max(box.width * scale - 0.2, 0.5),
      h: 0.22,
      fontFace: 'Calibri',
      fontSize: 8,
      bold: true,
      color: hex(palette.neutral600),
      fill: { color: hex(palette.neutral50) },
    })
  }

  // Edges first so node shapes sit visually on top of the lines.
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

    slide.addShape('line', {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      w: Math.max(Math.abs(end.x - start.x), 0.001),
      h: Math.max(Math.abs(end.y - start.y), 0.001),
      flipH: end.x < start.x,
      flipV: end.y < start.y,
      line: {
        color: style.color,
        width: 1.25,
        dashType: style.dash,
        endArrowType: 'triangle',
      },
    })

    if (edge.label) {
      const midX = (start.x + end.x) / 2
      const midY = (start.y + end.y) / 2
      slide.addText(String(edge.label), {
        x: midX - 0.4,
        y: midY - 0.14,
        w: 0.8,
        h: 0.28,
        align: 'center',
        valign: 'middle',
        fontFace: 'Calibri',
        fontSize: 9,
        color: hex(palette.neutral900),
        fill: { color: 'FFFFFF' },
        line: { color: hex(palette.neutral200), width: 0.5 },
      })
    }
  }

  for (const node of nodes) {
    const box = boxes.get(node.id)!
    const baseStyle = nodeStyles[node.data.type]
    // Same override as the on-screen node: a category, when set, replaces
    // the static per-type palette rather than layering on top of it.
    const categoryIndex = node.data.category_id ? categoryIndexById.get(node.data.category_id) : undefined
    const categoryStyle = categoryIndex !== undefined ? getCategoryStyle(categoryIndex) : null
    const style = categoryStyle
      ? { fill: hex(categoryStyle.fill), line: hex(categoryStyle.border), font: hex(categoryStyle.text), bold: baseStyle.bold }
      : baseStyle

    slide.addShape(shapeByNodeType[node.data.type] as 'rect', {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fill: { color: style.fill },
      line: { color: style.line, width: 1.25 },
    })
    slide.addText(node.data.label, {
      x: box.x + 0.05,
      y: box.y,
      w: Math.max(box.w - 0.1, 0.1),
      h: box.h,
      align: 'center',
      valign: 'middle',
      fontFace: 'Calibri',
      fontSize: 11,
      bold: style.bold,
      color: style.font,
      wrap: true,
      shrinkText: true,
    })
    if (node.data.is_external) {
      slide.addShape('ellipse', {
        x: box.x + box.w - 0.1,
        y: box.y - 0.05,
        w: 0.12,
        h: 0.12,
        fill: { color: '10B981' },
        line: { color: 'FFFFFF', width: 1.5 },
      })
    }
  }

  // Category legend footer -- same fixed hue-order chips as the on-screen
  // DiagramLegend, wrapped across rows using the same estimate the layout
  // pass above used to reserve space.
  if (categories.length > 0) {
    let cursorX = contentX
    let rowY = SLIDE_HEIGHT_IN - MARGIN_IN - legendHeight + 0.08
    for (const category of categories) {
      const chipW = estimateChipWidth(category.label)
      if (cursorX + chipW > contentX + contentW && cursorX > contentX) {
        rowY += LEGEND_ROW_HEIGHT_IN
        cursorX = contentX
      }
      const index = categoryIndexById.get(category.id)!
      const style = getCategoryStyle(index)
      slide.addShape('ellipse', {
        x: cursorX,
        y: rowY + (LEGEND_ROW_HEIGHT_IN - LEGEND_DOT_SIZE_IN) / 2,
        w: LEGEND_DOT_SIZE_IN,
        h: LEGEND_DOT_SIZE_IN,
        fill: { color: hex(style.border) },
        line: { type: 'none' },
      })
      slide.addText(category.label, {
        x: cursorX + LEGEND_DOT_SIZE_IN + 0.06,
        y: rowY,
        w: chipW,
        h: LEGEND_ROW_HEIGHT_IN,
        fontFace: 'Calibri',
        fontSize: 9,
        color: hex(palette.neutral600),
        valign: 'middle',
      })
      cursorX += chipW
    }
  }

  await pptx.writeFile({ fileName: options.fileName ?? 'flowchart.pptx' })
}
