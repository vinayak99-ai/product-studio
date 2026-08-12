import type { ExtractResponse } from '../types'
import type { SequenceWsProgressMessage } from '../sequenceTypes'
import type { DeckWsProgressMessage, InfographicDiagram, InfographicWsProgressMessage } from '../infographicTypes'
import type { DiagramSlideResult, DiagramSlideWsProgressMessage } from '../diagramSlideTypes'
import type { DiagramShaperResult, DiagramShaperWsProgressMessage } from '../diagramShaperTypes'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
const WS_BASE = API_BASE.replace(/^http/, 'ws')

export async function extractFile(file: File): Promise<ExtractResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${API_BASE}/api/extract`, { method: 'POST', body: formData })
  if (!res.ok) {
    throw new Error(await res.text())
  }
  return res.json()
}

export function openSequenceGenerateSocket(
  material: string,
  prompt: string,
  onMessage: (message: SequenceWsProgressMessage) => void,
  onError: () => void,
): () => void {
  const socket = new WebSocket(`${WS_BASE}/api/ws/generate-sequence`)

  socket.onopen = () => {
    socket.send(JSON.stringify({ material, prompt }))
  }
  socket.onmessage = (event) => {
    onMessage(JSON.parse(event.data) as SequenceWsProgressMessage)
  }
  socket.onerror = () => {
    onError()
  }

  return () => socket.close()
}

export function openInfographicGenerateSocket(
  material: string,
  prompt: string,
  onMessage: (message: InfographicWsProgressMessage) => void,
  onError: () => void,
): () => void {
  const socket = new WebSocket(`${WS_BASE}/api/ws/generate-infographic`)

  socket.onopen = () => {
    socket.send(JSON.stringify({ material, prompt }))
  }
  socket.onmessage = (event) => {
    onMessage(JSON.parse(event.data) as InfographicWsProgressMessage)
  }
  socket.onerror = () => {
    onError()
  }

  return () => socket.close()
}

export function openDeckGenerateSocket(
  material: string,
  prompt: string,
  onMessage: (message: DeckWsProgressMessage) => void,
  onError: () => void,
): () => void {
  const socket = new WebSocket(`${WS_BASE}/api/ws/generate-deck`)

  socket.onopen = () => {
    socket.send(JSON.stringify({ material, prompt }))
  }
  socket.onmessage = (event) => {
    onMessage(JSON.parse(event.data) as DeckWsProgressMessage)
  }
  socket.onerror = () => {
    onError()
  }

  return () => socket.close()
}

export function openDiagramSlideGenerateSocket(
  sourceMaterial: string,
  prompt: string,
  onMessage: (message: DiagramSlideWsProgressMessage) => void,
  onError: () => void,
): () => void {
  const socket = new WebSocket(`${WS_BASE}/api/ws/generate-diagram-slide`)

  socket.onopen = () => {
    socket.send(JSON.stringify({ source_material: sourceMaterial, prompt }))
  }
  socket.onmessage = (event) => {
    onMessage(JSON.parse(event.data) as DiagramSlideWsProgressMessage)
  }
  socket.onerror = () => {
    onError()
  }

  return () => socket.close()
}

// Like exportInfographicPptx: the deliverable is a real .pptx built server-side
// (here by rendering `html` with Playwright and embedding the screenshot
// full-bleed), so this fetches the binary and triggers a download rather than
// rendering anything client-side.
export async function exportDiagramSlidePptx(result: DiagramSlideResult): Promise<void> {
  const res = await fetch(`${API_BASE}/api/diagram-slide/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  })
  if (!res.ok) {
    throw new Error(await res.text())
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'diagram-slide.pptx'
  link.click()
  URL.revokeObjectURL(url)
}

// Same server-side Playwright render as the PPTX export, returned as a
// standalone image instead of embedded in a slide -- for dropping into
// PowerPoint (or anywhere else) by hand.
export async function exportDiagramSlidePng(result: DiagramSlideResult): Promise<void> {
  const res = await fetch(`${API_BASE}/api/diagram-slide/export-png`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  })
  if (!res.ok) {
    throw new Error(await res.text())
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'diagram-slide.png'
  link.click()
  URL.revokeObjectURL(url)
}

// Unlike PNG/PPTX, this needs no round trip -- `result.html` already
// contains the inline <svg>, so this pulls it out client-side (via
// DOMParser on the HTML string itself, not the sandboxed preview iframe --
// sandbox="" gives that iframe an opaque origin the parent can't reach into)
// and serializes just that node back out as a standalone .svg file.
export function exportDiagramSlideSvg(result: DiagramSlideResult): void {
  const doc = new DOMParser().parseFromString(result.html, 'text/html')
  const svg = doc.querySelector('svg')
  if (!svg) {
    throw new Error('No <svg> found in the generated diagram.')
  }
  const svgText = new XMLSerializer().serializeToString(svg)
  const blob = new Blob([svgText], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'diagram-slide.svg'
  link.click()
  URL.revokeObjectURL(url)
}

export function openDiagramShaperGenerateSocket(
  sourceMaterial: string,
  prompt: string,
  onMessage: (message: DiagramShaperWsProgressMessage) => void,
  onError: () => void,
): () => void {
  const socket = new WebSocket(`${WS_BASE}/api/ws/generate-diagram-shaper`)

  socket.onopen = () => {
    socket.send(JSON.stringify({ source_material: sourceMaterial, prompt }))
  }
  socket.onmessage = (event) => {
    onMessage(JSON.parse(event.data) as DiagramShaperWsProgressMessage)
  }
  socket.onerror = () => {
    onError()
  }

  return () => socket.close()
}

// The deliverable is real native PPTX shapes built server-side straight from
// the shape/connector JSON (app/diagram_shaper_pptx.py) -- no screenshot, no
// rendering step client-side, so this just posts the JSON and downloads the
// binary that comes back.
export async function exportDiagramShaperPptx(result: DiagramShaperResult): Promise<void> {
  const res = await fetch(`${API_BASE}/api/diagram-shaper/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  })
  if (!res.ok) {
    throw new Error(await res.text())
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'diagram-shaper.pptx'
  link.click()
  URL.revokeObjectURL(url)
}

const INFOGRAPHIC_FILENAMES: Record<InfographicDiagram['template'], string> = {
  radial_wheel: 'infographic-wheel.pptx',
  comparison_columns: 'infographic-comparison.pptx',
  now_next_later: 'infographic-roadmap.pptx',
  vision_pyramid: 'infographic-vision-pyramid.pptx',
  quarterly_timeline: 'infographic-timeline.pptx',
  bullet_summary: 'infographic-bullets.pptx',
  matrix_2x2: 'infographic-matrix.pptx',
  feature_story: 'infographic-feature-story.pptx',
  hub_spoke: 'infographic-hub-spoke.pptx',
  title_intro: 'infographic-title.pptx',
  agenda: 'infographic-agenda.pptx',
  value_proposition: 'infographic-value-proposition.pptx',
  positioning_statement: 'infographic-positioning.pptx',
  raci_chart: 'infographic-raci.pptx',
  north_star_metric: 'infographic-north-star-metric.pptx',
}

// The deliverable here is the actual .pptx file (the template, populated
// server-side by python-pptx) -- not something rendered client-side, so
// this fetches the binary and triggers a real download rather than parsing
// a JSON diagram the way the other tools' export paths do. Which template
// builder runs server-side is dispatched from the `template` discriminator
// already present on the diagram.
export async function exportInfographicPptx(diagram: InfographicDiagram): Promise<void> {
  const res = await fetch(`${API_BASE}/api/infographic/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(diagram),
  })
  if (!res.ok) {
    throw new Error(await res.text())
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = INFOGRAPHIC_FILENAMES[diagram.template]
  link.click()
  URL.revokeObjectURL(url)
}

export async function exportDeckPptx(slides: InfographicDiagram[]): Promise<void> {
  const res = await fetch(`${API_BASE}/api/infographic/deck/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(slides),
  })
  if (!res.ok) {
    throw new Error(await res.text())
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'infographic-deck.pptx'
  link.click()
  URL.revokeObjectURL(url)
}
