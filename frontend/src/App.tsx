import { useEffect, useRef, useState } from 'react'
import { Rail } from './components/Rail'
import { TopBar } from './components/TopBar'
import { ComingSoonPanel } from './components/ComingSoonPanel'
import { SpecBuilderPanel } from './components/SpecBuilderPanel'
import { Sidebar } from './components/Sidebar'
import { SequenceSidebar } from './components/SequenceSidebar'
import { FlowchartCanvas, type FlowchartCanvasHandle } from './components/FlowchartCanvas'
import { SequenceCanvas, type SequenceCanvasHandle } from './components/SequenceCanvas'
import { InfographicSidebar, type InfographicMode } from './components/InfographicSidebar'
import { InfographicCanvas } from './components/InfographicCanvas'
import { DeckCanvas } from './components/DeckCanvas'
import { StorySidebar } from './components/StorySidebar'
import { StoryCanvas } from './components/StoryCanvas'
import { DesignThinkingPage } from './components/DesignThinkingPage'
import { DocQaPage } from './components/DocQaPage'
import { JiraPage } from './components/JiraPage'
import { DeepAnalysisPage } from './components/DeepAnalysisPage'
import { DiagramLegend } from './components/DiagramLegend'
import { ExportControls } from './components/ExportControls'
import { SequenceExportControls } from './components/SequenceExportControls'
import { SettingsPanel } from './components/SettingsPanel'
import type { LayoutAlgorithm, LayoutDirection } from './lib/elkLayout'
import type { EdgeShape } from './lib/theme'
import { applyTheme, type ThemeName } from './lib/themes'
import { TOOLS, type ToolId } from './lib/tools'
import type { GenerateResponse } from './types'
import type { GenerateSequenceResponse } from './sequenceTypes'
import type { GenerateDeckResponse, GenerateInfographicResponse } from './infographicTypes'
import type { StoryScript } from './storyTypes'

function App() {
  const [activeTool, setActiveTool] = useState<ToolId>('design_thinking')
  const [result, setResult] = useState<GenerateResponse | null>(null)
  const [sequenceResult, setSequenceResult] = useState<GenerateSequenceResponse | null>(null)
  const [infographicMode, setInfographicMode] = useState<InfographicMode>('single')
  const [infographicResult, setInfographicResult] = useState<GenerateInfographicResponse | null>(null)
  const [deckResult, setDeckResult] = useState<GenerateDeckResponse | null>(null)
  const [storyResult, setStoryResult] = useState<StoryScript | null>(null)
  const [layoutAlgorithm, setLayoutAlgorithm] = useState<LayoutAlgorithm>('layered')
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>('DOWN')
  const [edgeShape, setEdgeShape] = useState<EdgeShape>('bezier')
  const [themeName, setThemeName] = useState<ThemeName>('fidelity-green')
  const [snapToGrid, setSnapToGrid] = useState(false)
  const canvasRef = useRef<FlowchartCanvasHandle>(null)
  const sequenceCanvasRef = useRef<SequenceCanvasHandle>(null)
  const flowchartRootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Scoped to this tool's own subtree (not document.documentElement) so
    // picking a diagram theme here can't bleed into Product Studio's shell (Rail,
    // TopBar) or into other tools like Spec Builder, which share the same
    // --color-primary/--color-accent token names for their own branding.
    if (flowchartRootRef.current) {
      applyTheme(themeName, flowchartRootRef.current)
    }
  }, [themeName])

  const comingSoonTool = TOOLS.find((tool) => tool.id === activeTool && tool.status === 'soon')

  return (
    <div className="flex h-screen">
      <Rail activeTool={activeTool} onSelect={setActiveTool} />
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar activeTool={activeTool} />

        {/* Always mounted (just hidden) so React Flow keeps its layout/drag state
            when the user switches to another tool and back. */}
        <div
          ref={flowchartRootRef}
          className={`min-h-0 flex-1 ${activeTool === 'flowchart' ? 'flex' : 'hidden'}`}
        >
          <Sidebar onResult={setResult} issues={result?.issues ?? []} />
          <main className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2">
              <h1 className="text-sm font-semibold text-neutral-900">Diagram</h1>
              <div className="flex items-center gap-2">
                <ExportControls
                  targetRef={canvasRef}
                  disabled={!result}
                  layoutAlgorithm={layoutAlgorithm}
                  themeName={themeName}
                />
                <SettingsPanel
                  layoutAlgorithm={layoutAlgorithm}
                  onLayoutAlgorithmChange={setLayoutAlgorithm}
                  layoutDirection={layoutDirection}
                  onLayoutDirectionChange={setLayoutDirection}
                  edgeShape={edgeShape}
                  onEdgeShapeChange={setEdgeShape}
                  themeName={themeName}
                  onThemeNameChange={setThemeName}
                  snapToGrid={snapToGrid}
                  onSnapToGridChange={setSnapToGrid}
                />
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <FlowchartCanvas
                ref={canvasRef}
                diagram={result?.diagram ?? null}
                layoutAlgorithm={layoutAlgorithm}
                layoutDirection={layoutDirection}
                edgeShape={edgeShape}
                themeName={themeName}
                snapToGrid={snapToGrid}
              />
            </div>
            {result ? <DiagramLegend diagram={result.diagram} /> : null}
          </main>
        </div>

        {/* Sequence diagrams don't share FlowchartCanvas's ELK/edge-shape
            machinery (no layout algorithm, no ELK-routed edge shapes -- see
            sequenceLayout.ts), so this is its own canvas + sidebar pair
            rather than reusing Flowchart Builder's, but the same
            always-mounted+hidden pattern keeps its state across tool switches. */}
        <div className={`min-h-0 flex-1 ${activeTool === 'sequence' ? 'flex' : 'hidden'}`}>
          <SequenceSidebar onResult={setSequenceResult} issues={sequenceResult?.issues ?? []} />
          <main className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2">
              <h1 className="text-sm font-semibold text-neutral-900">Sequence Diagram</h1>
              <SequenceExportControls targetRef={sequenceCanvasRef} disabled={!sequenceResult} />
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

        <div className={`min-h-0 flex-1 ${activeTool === 'jira' ? 'flex' : 'hidden'}`}>
          <JiraPage />
        </div>

        <div className={`min-h-0 flex-1 ${activeTool === 'deep_analysis' ? 'flex' : 'hidden'}`}>
          <DeepAnalysisPage />
        </div>

        {comingSoonTool ? <ComingSoonPanel tool={comingSoonTool} /> : null}
      </div>
    </div>
  )
}

export default App
