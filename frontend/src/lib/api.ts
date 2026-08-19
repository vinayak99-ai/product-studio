import type { ExtractResponse } from '../types'
import type { SequenceWsProgressMessage } from '../sequenceTypes'
import type { DeckWsProgressMessage, InfographicDiagram, InfographicWsProgressMessage } from '../infographicTypes'
import type { DiagramSlideResult, DiagramSlideWsProgressMessage } from '../diagramSlideTypes'

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

// The browser's anchor `download` attribute wins over whatever filename the
// Content-Disposition header carried (a blob: URL download doesn't consult
// it), so this is the filename that actually shows up for the user -- same
// independent-copy slugify as deep_analysis's/design_thinking's frontend
// and backend pairs, kept in sync by convention rather than a shared import.
function slugify(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return slug || 'diagram-slide'
}

// Diagram Slides' only export -- `result.html` already contains the inline
// <svg>, so this needs no server round trip: pulls it out client-side (via
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
  link.download = `${slugify(result.title)}.svg`
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
