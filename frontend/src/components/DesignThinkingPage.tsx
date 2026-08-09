import { useState } from 'react'
import { EMPTY_SESSION, STAGES, type DesignThinkingStage } from '../designThinkingTypes'
import { exportDesignThinkingHtml, exportDesignThinkingMarkdown } from '../lib/designThinkingApi'
import { StageHeader } from './design-thinking/StageHeader'
import { EmpathizeStage } from './design-thinking/EmpathizeStage'
import { DefineStage } from './design-thinking/DefineStage'
import { IdeateStage } from './design-thinking/IdeateStage'
import { PrototypeStage } from './design-thinking/PrototypeStage'
import { TestStage } from './design-thinking/TestStage'

export function DesignThinkingPage() {
  const [session, setSession] = useState(EMPTY_SESSION)
  const [activeStage, setActiveStage] = useState<DesignThinkingStage>('empathize')
  const [exportBusy, setExportBusy] = useState(false)
  // Gates both the Empathize stage's "Continue to Define" button and the
  // stepper nav below -- a PM has to explicitly review and approve the
  // generated goals/pains/behaviors before the rest of the flow builds on
  // them, not just glance at a card grid and click through.
  const [personasApproved, setPersonasApproved] = useState(false)

  const furthestIndex = (() => {
    if (session.concept_briefs.length > 0) return 4
    if (session.concept_sparks.some((s) => s.selected)) return 3
    if (session.problem_statements.length > 0) return 2
    if (session.personas.length > 0 && personasApproved) return 1
    return 0
  })()

  const goTo = (stage: DesignThinkingStage) => setActiveStage(stage)
  const goToIndex = (i: number) => setActiveStage(STAGES[i].id)

  const handleExport = async (format: 'markdown' | 'html') => {
    setExportBusy(true)
    try {
      const exportedSession = { ...session, problem_area: session.problem_area.trim() || 'Untitled exploration' }
      if (format === 'html') {
        await exportDesignThinkingHtml(exportedSession)
      } else {
        await exportDesignThinkingMarkdown(exportedSession)
      }
    } finally {
      setExportBusy(false)
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <StageHeader
        problemArea={session.problem_area}
        onProblemAreaChange={(problem_area) => setSession((s) => ({ ...s, problem_area }))}
        activeStage={activeStage}
        furthestIndex={furthestIndex}
        onSelectStage={goTo}
        onExportMarkdown={() => handleExport('markdown')}
        onExportHtml={() => handleExport('html')}
        exportBusy={exportBusy}
        canExport={session.personas.length > 0}
      />
      <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-50 p-4">
        {activeStage === 'empathize' ? (
          <EmpathizeStage
            problemArea={session.problem_area}
            personas={session.personas}
            onChange={(personas) => setSession((s) => ({ ...s, personas }))}
            approved={personasApproved}
            onApprovedChange={setPersonasApproved}
            onContinue={() => goToIndex(1)}
          />
        ) : null}
        {activeStage === 'define' ? (
          <DefineStage
            personas={session.personas}
            statements={session.problem_statements}
            onChange={(problem_statements) => setSession((s) => ({ ...s, problem_statements }))}
            onContinue={() => goToIndex(2)}
          />
        ) : null}
        {activeStage === 'ideate' ? (
          <IdeateStage
            statements={session.problem_statements}
            hmws={session.how_might_we}
            onHmwChange={(how_might_we) => setSession((s) => ({ ...s, how_might_we }))}
            sparks={session.concept_sparks}
            onSparksChange={(concept_sparks) => setSession((s) => ({ ...s, concept_sparks }))}
            onContinue={() => goToIndex(3)}
          />
        ) : null}
        {activeStage === 'prototype' ? (
          <PrototypeStage
            sparks={session.concept_sparks}
            briefs={session.concept_briefs}
            onChange={(concept_briefs) => setSession((s) => ({ ...s, concept_briefs }))}
            onContinue={() => goToIndex(4)}
          />
        ) : null}
        {activeStage === 'test' ? (
          <TestStage
            briefs={session.concept_briefs}
            plans={session.validation_plans}
            onChange={(validation_plans) => setSession((s) => ({ ...s, validation_plans }))}
            onExportMarkdown={() => handleExport('markdown')}
            onExportHtml={() => handleExport('html')}
            exportBusy={exportBusy}
          />
        ) : null}
      </div>
    </div>
  )
}
