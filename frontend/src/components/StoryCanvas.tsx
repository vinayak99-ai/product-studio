import { useState } from 'react'
import { exportStoryDeck, exportStoryScript } from '../lib/storyApi'
import { storyFrameworkLabel, type StoryBeat, type StoryScript } from '../storyTypes'
import { renderInfographicPreview } from './infographic/previewRegistry'

interface StoryCanvasProps {
  story: StoryScript | null
  onStoryChange: (story: StoryScript) => void
}

function formatMinute(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export function StoryCanvas({ story, onStoryChange }: StoryCanvasProps) {
  const [selected, setSelected] = useState(0)
  const [busyScript, setBusyScript] = useState(false)
  const [busyDeck, setBusyDeck] = useState(false)

  const beat = story?.beats[Math.min(selected, story.beats.length - 1)] ?? null

  const updateBeat = (updated: StoryBeat) => {
    if (!story) return
    const beats = story.beats.slice()
    beats[Math.min(selected, story.beats.length - 1)] = updated
    onStoryChange({ ...story, beats })
  }

  const handleExportScript = async () => {
    if (!story) return
    setBusyScript(true)
    try {
      await exportStoryScript(story)
    } finally {
      setBusyScript(false)
    }
  }

  const handleExportDeck = async () => {
    if (!story) return
    setBusyDeck(true)
    try {
      await exportStoryDeck(story)
    } finally {
      setBusyDeck(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-neutral-900">{story?.title ?? 'Story'}</h1>
          {story ? (
            <>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                {story.beats.length} beats · {story.total_minutes} min
              </span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {storyFrameworkLabel(story.framework)}
              </span>
              <span className="text-[11px] text-neutral-400">from {story.source_project_name}</span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!story || busyScript}
            onClick={handleExportScript}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyScript ? 'Exporting…' : 'Download Script'}
          </button>
          <button
            type="button"
            disabled={!story || busyDeck}
            onClick={handleExportDeck}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyDeck ? 'Exporting…' : 'Download Deck PPTX'}
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {story ? (
          <>
            <aside className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-neutral-200 bg-white p-3">
              {story.beats.map((b, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelected(i)}
                  className={`flex flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors ${
                    i === selected ? 'bg-primary/10 text-primary' : 'text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                    {formatMinute(b.start_minute)}–{formatMinute(b.end_minute)} min
                  </span>
                  <span className="line-clamp-2 text-xs font-medium">{b.label}</span>
                </button>
              ))}
            </aside>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-neutral-50 p-6">
              <div className="mx-auto w-full max-w-4xl">
                {beat ? renderInfographicPreview(beat.slide, (slide) => updateBeat({ ...beat, slide })) : null}
              </div>
              {beat ? (
                <div className="mx-auto mt-6 w-full max-w-4xl">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Narration — what to say ({formatMinute(beat.end_minute - beat.start_minute)} min)
                  </h3>
                  <textarea
                    value={beat.narration}
                    onChange={(event) => updateBeat({ ...beat, narration: event.target.value })}
                    className="mt-2 h-48 w-full resize-y rounded-lg border border-neutral-200 bg-white p-3 text-sm leading-relaxed text-neutral-800 outline-none focus:border-primary"
                  />
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center bg-neutral-50">
            <p className="text-sm text-neutral-500">Pick a project and build a story to see it here.</p>
          </div>
        )}
      </div>
    </div>
  )
}
