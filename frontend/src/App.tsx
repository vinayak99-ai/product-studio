import { useRef, useState } from 'react'
import { Rail } from './components/Rail'
import { TopBar } from './components/TopBar'
import { ComingSoonPanel } from './components/ComingSoonPanel'
import { SpecBuilderPanel } from './components/SpecBuilderPanel'
import { SequenceSidebar } from './components/SequenceSidebar'
import { SequenceCanvas, type SequenceCanvasHandle } from './components/SequenceCanvas'
import { InfographicSidebar, type InfographicMode } from './components/InfographicSidebar'
import { InfographicCanvas } from './components/InfographicCanvas'
import { DeckCanvas } from './components/DeckCanvas'
import { DiagramSlideSidebar } from './components/DiagramSlideSidebar'
import { DiagramSlideCanvas } from './components/DiagramSlideCanvas'
import { StorySidebar } from './components/StorySidebar'
import { StoryCanvas } from './components/StoryCanvas'
import { DesignThinkingPage } from './components/DesignThinkingPage'
import { DocQaPage } from './components/DocQaPage'
import { KnowledgeBasePage } from './components/KnowledgeBasePage'
import { DiscoveryQaPage } from './components/DiscoveryQaPage'
import { JiraPage } from './components/JiraPage'
import { DeepAnalysisPage } from './components/DeepAnalysisPage'
import { SystemMapPage } from './components/SystemMapPage'
import { SequenceExportControls } from './components/SequenceExportControls'
import { themePalettes, type ThemeName } from './lib/themes'
import { TOOLS, type ToolId } from './lib/tools'
import type { GenerateSequenceResponse } from './sequenceTypes'
import type { GenerateDeckResponse, GenerateInfographicResponse } from './infographicTypes'
import type { StoryScript } from './storyTypes'
import type { DiagramSlideResult } from './diagramSlideTypes'

const THEME_LABEL: Record<ThemeName, string> = {
  'fidelity-green': 'Green',
  'slate-blue': 'Blue',
}

function App() {
  const [activeTool, setActiveTool] = useState<ToolId>('design_thinking')
  const [sequenceResult, setSequenceResult] = useState<GenerateSequenceResponse | null>(null)
  const [infographicMode, setInfographicMode] = useState<InfographicMode>('single')
  const [infographicResult, setInfographicResult] = useState<GenerateInfographicResponse | null>(null)
  const [deckResult, setDeckResult] = useState<GenerateDeckResponse | null>(null)
  const [storyResult, setStoryResult] = useState<StoryScript | null>(null)
  const [diagramSlideResult, setDiagramSlideResult] = useState<DiagramSlideResult | null>(null)
  // Sequence Diagram is the only tool left reading this -- it indexes
  // themePalettes directly (see SequenceCanvas.tsx/MessageEdge.tsx), not via
  // any CSS-variable injection, so this is just a plain color choice.
  const [themeName, setThemeName] = useState<ThemeName>('fidelity-green')
  const sequenceCanvasRef = useRef<SequenceCanvasHandle>(null)

  const comingSoonTool = TOOLS.find((tool) => tool.id === activeTool && tool.status === 'soon')

  return (
    <div className="flex h-screen">
      <Rail activeTool={activeTool} onSelect={setActiveTool} />
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar activeTool={activeTool} />

        {/* Sequence diagrams build their own canvas directly on @xyflow/react
            (no layout algorithm/settings panel of their own), but the same
            always-mounted+hidden pattern keeps state across tool switches.
            The theme picker here is the only theme control left in the app --
            it used to live in Flowchart Builder's Settings panel, which
            Sequence had no picker of its own and just inherited themeName
            from. */}
        <div className={`min-h-0 flex-1 ${activeTool === 'sequence' ? 'flex' : 'hidden'}`}>
          <SequenceSidebar onResult={setSequenceResult} issues={sequenceResult?.issues ?? []} />
          <main className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2">
              <h1 className="text-sm font-semibold text-neutral-900">Sequence Diagram</h1>
              <div className="flex items-center gap-2">
                <select
                  value={themeName}
                  onChange={(event) => setThemeName(event.target.value as ThemeName)}
                  className="rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs font-medium text-neutral-900 outline-none focus:border-primary"
                >
                  {(Object.keys(themePalettes) as ThemeName[]).map((name) => (
                    <option key={name} value={name}>
                      {THEME_LABEL[name]}
                    </option>
                  ))}
                </select>
                <SequenceExportControls targetRef={sequenceCanvasRef} disabled={!sequenceResult} />
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <SequenceCanvas ref={sequenceCanvasRef} diagram={sequenceResult?.diagram ?? null} themeName={themeName} />
            </div>
          </main>
        </div>

        {/* Populates a fixed .pptx template server-side (python-pptx) rather
            than computing a layout client-side -- PowerPoint is the actual
            renderer here, so the canvas below is a same-geometry preview,
            not the deliverable itself (that's the downloaded file). */}
        <div className={`min-h-0 flex-1 ${activeTool === 'infographic' ? 'flex' : 'hidden'}`}>
          <InfographicSidebar
            mode={infographicMode}
            onModeChange={setInfographicMode}
            onResult={setInfographicResult}
            onDeckResult={setDeckResult}
            issues={(infographicMode === 'deck' ? deckResult?.issues : infographicResult?.issues) ?? []}
          />
          <main className="flex min-w-0 flex-1 flex-col">
            {infographicMode === 'deck' ? (
              <DeckCanvas deck={deckResult} onDeckChange={setDeckResult} />
            ) : (
              <InfographicCanvas
                diagram={infographicResult?.diagram ?? null}
                onDiagramChange={(diagram) =>
                  setInfographicResult((prev) => (prev ? { ...prev, diagram } : prev))
                }
              />
            )}
          </main>
        </div>

        {/* Hand-composed SVG under strict style/layout rules, not a
            graph-layout algorithm (see backend/app/diagram_slide_rules.py) --
            the preview iframe renders the exact same HTML that gets
            screenshotted server-side for the export, so what's shown here is
            what ends up in the slide. */}
        <div className={`min-h-0 flex-1 ${activeTool === 'diagram_slide' ? 'flex' : 'hidden'}`}>
          <DiagramSlideSidebar onResult={setDiagramSlideResult} />
          <main className="flex min-w-0 flex-1 flex-col">
            <DiagramSlideCanvas result={diagramSlideResult} />
          </main>
        </div>

        {/* Also always mounted+hidden, so switching tools doesn't reload the
            embedded app and lose in-progress (not-yet-autosaved) edits. */}
        <div className={`min-h-0 flex-1 ${activeTool === 'spec' ? 'flex' : 'hidden'}`}>
          <SpecBuilderPanel />
        </div>

        {/* Reads an existing Spec Builder project's PRD as source material
            (see backend/app/routes/story.py) rather than taking pasted/
            uploaded material like the other generation tools -- the whole
            point is reusing work already done in Spec Builder. */}
        <div className={`min-h-0 flex-1 ${activeTool === 'story' ? 'flex' : 'hidden'}`}>
          <StorySidebar onResult={setStoryResult} />
          <main className="flex min-w-0 flex-1 flex-col">
            <StoryCanvas story={storyResult} onStoryChange={setStoryResult} />
          </main>
        </div>

        {/* Same always-mounted+hidden pattern as every other tool above --
            a PM can be several stages into a session; switching tabs must
            not lose it. */}
        <div className={`min-h-0 flex-1 ${activeTool === 'design_thinking' ? 'flex' : 'hidden'}`}>
          <DesignThinkingPage />
        </div>

        <div className={`min-h-0 flex-1 ${activeTool === 'doc_qa' ? 'flex' : 'hidden'}`}>
          <DocQaPage />
        </div>

        <div className={`min-h-0 flex-1 ${activeTool === 'knowledge_base' ? 'flex' : 'hidden'}`}>
          <KnowledgeBasePage />
        </div>

        <div className={`min-h-0 flex-1 ${activeTool === 'discovery_qa' ? 'flex' : 'hidden'}`}>
          <DiscoveryQaPage />
        </div>

        <div className={`min-h-0 flex-1 ${activeTool === 'jira' ? 'flex' : 'hidden'}`}>
          <JiraPage />
        </div>

        <div className={`min-h-0 flex-1 ${activeTool === 'deep_analysis' ? 'flex' : 'hidden'}`}>
          <DeepAnalysisPage />
        </div>

        <div className={`min-h-0 flex-1 ${activeTool === 'system_map' ? 'flex' : 'hidden'}`}>
          <SystemMapPage />
        </div>

        {comingSoonTool ? <ComingSoonPanel tool={comingSoonTool} /> : null}
      </div>
    </div>
  )
}

export default App
