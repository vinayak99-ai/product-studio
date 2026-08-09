import type { StorySourceProject, StoryScript, StoryWsProgressMessage } from '../storyTypes'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
const WS_BASE = API_BASE.replace(/^http/, 'ws')

export async function listStoryProjects(): Promise<StorySourceProject[]> {
  const res = await fetch(`${API_BASE}/api/story/projects`)
  if (!res.ok) {
    throw new Error(await res.text())
  }
  return res.json()
}

// Story Builder can source a story from either an existing Spec Builder
// project's generated spec, or a document uploaded/pasted directly --
// exactly one of these two shapes goes over the wire (see
// StoryGenerateRequest._exactly_one_source on the backend).
export type StorySource =
  | { mode: 'project'; projectId: string }
  | { mode: 'document'; material: string; materialName: string }

export function openStoryGenerateSocket(
  source: StorySource,
  totalMinutes: number,
  prompt: string,
  onMessage: (message: StoryWsProgressMessage) => void,
  onError: () => void,
): () => void {
  const socket = new WebSocket(`${WS_BASE}/api/ws/generate-story`)

  socket.onopen = () => {
    const payload =
      source.mode === 'project'
        ? { project_id: source.projectId, total_minutes: totalMinutes, prompt }
        : { material: source.material, material_name: source.materialName, total_minutes: totalMinutes, prompt }
    socket.send(JSON.stringify(payload))
  }
  socket.onmessage = (event) => {
    onMessage(JSON.parse(event.data) as StoryWsProgressMessage)
  }
  socket.onerror = () => {
    onError()
  }

  return () => socket.close()
}

async function downloadStoryFile(path: string, story: StoryScript, filename: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(story),
  })
  if (!res.ok) {
    throw new Error(await res.text())
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function exportStoryScript(story: StoryScript): Promise<void> {
  return downloadStoryFile('/api/story/export/script', story, 'story-script.md')
}

export function exportStoryDeck(story: StoryScript): Promise<void> {
  return downloadStoryFile('/api/story/export/deck', story, 'story-deck.pptx')
}
