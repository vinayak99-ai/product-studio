import { useState } from 'react'
import { exportHtml, exportMarkdown, regenerate, updateArtifact } from '../../lib/deepAnalysisApi'
import type { DeepAnalysisDocument, GenerateResponse } from '../../deepAnalysisTypes'
import { EditableText } from '../infographic/EditableText'
import { ExportMenu } from '../design-thinking/ExportMenu'

interface DeepAnalysisDocumentViewProps {
  projectId: string
  projectName: string
  artifactId: string
  document: DeepAnalysisDocument
  onDocumentChange: (artifactId: string, document: DeepAnalysisDocument) => void
  onNeedsClarification: (response: GenerateResponse) => void
  onBack: () => void
}

function SectionHeading({ children }: { children: string }) {
  return <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">{children}</h2>
}

// Every edit commits on blur (EditableText's own behavior) straight to the
// backend via PUT .../artifacts/{id} -- the same "manual edit" persistence
// Spec Builder's GeneratedPRD editing uses, just plain-Tailwind + EditableText
// instead of shadcn, matching every other non-Spec-Builder tool this session.
export function DeepAnalysisDocumentView({
  projectId,
  projectName,
  artifactId,
  document,
  onDocumentChange,
  onNeedsClarification,
  onBack,
}: DeepAnalysisDocumentViewProps) {
  const [regenBusy, setRegenBusy] = useState(false)
  const [regenError, setRegenError] = useState<string | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [transcriptOpen, setTranscriptOpen] = useState(false)

  const persist = (next: DeepAnalysisDocument) => {
    onDocumentChange(artifactId, next)
    updateArtifact(projectId, artifactId, next).catch(() => {
      // Best-effort -- local state already reflects the edit; a failed
      // persist just means it won't survive a refresh.
    })
  }

  const updateField = <K extends keyof DeepAnalysisDocument>(key: K, value: DeepAnalysisDocument[K]) => {
    persist({ ...document, [key]: value })
  }

  const updateListItem = <K extends 'background' | 'prior_attempts' | 'root_causes' | 'stakeholder_considerations' | 'constraints' | 'open_risks'>(
    key: K,
    index: number,
    patch: Partial<DeepAnalysisDocument[K][number]>,
  ) => {
    const list = document[key].slice()
    list[index] = { ...list[index], ...patch } as DeepAnalysisDocument[K][number]
    updateField(key, list as DeepAnalysisDocument[K])
  }

  const updateFocusArea = (index: number, value: string) => {
    const list = document.recommended_focus_areas.slice()
    list[index] = value
    updateField('recommended_focus_areas', list)
  }

  const handleRegenerate = async () => {
    setRegenBusy(true)
    setRegenError(null)
    try {
      const res = await regenerate(projectId)
      if (res.status === 'needs_clarification') {
        onNeedsClarification(res)
      } else {
        onDocumentChange(res.artifact_id!, res.document!)
      }
    } catch (err) {
      setRegenError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setRegenBusy(false)
    }
  }

  const handleExportMarkdown = async () => {
    setExportBusy(true)
    try {
      await exportMarkdown(projectId, artifactId, document.title)
    } finally {
      setExportBusy(false)
    }
  }

  const handleExportHtml = async () => {
    setExportBusy(true)
    try {
      await exportHtml(projectId, artifactId, document.title)
    } finally {
      setExportBusy(false)
    }
  }

  return (
    <div className="px-6 py-6">
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-neutral-200 pb-3">
        <button type="button" onClick={onBack} className="shrink-0 text-sm font-medium text-neutral-500 hover:text-neutral-900">
          ← Deep Analysis
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={regenBusy}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {regenBusy ? 'Regenerating…' : 'Regenerate'}
          </button>
          <ExportMenu onExportMarkdown={handleExportMarkdown} onExportHtml={handleExportHtml} busy={exportBusy} disabled={false} />
        </div>
      </div>
      {regenError ? <p className="mb-3 text-sm text-red-600">{regenError}</p> : null}

      <p className="mb-1 text-xs text-neutral-400">{projectName}</p>
      <EditableText
        value={document.title}
        onCommit={(title) => updateField('title', title)}
        as="h1"
        className="mb-4 block text-2xl font-semibold text-neutral-900"
      />

      <div className="flex flex-col gap-6">
        <section>
          <SectionHeading>Problem Statement</SectionHeading>
          <EditableText
            value={document.problem_statement}
            onCommit={(v) => updateField('problem_statement', v)}
            as="p"
            multiline
            className="block rounded-xl border border-neutral-200 bg-white p-4 text-sm leading-relaxed text-neutral-800"
          />
        </section>

        <section>
          <SectionHeading>Executive Summary</SectionHeading>
          <EditableText
            value={document.executive_summary}
            onCommit={(v) => updateField('executive_summary', v)}
            as="p"
            multiline
            className="block rounded-xl border border-neutral-200 bg-primary-light p-4 text-sm leading-relaxed text-primary-dark"
          />
        </section>

        {document.background.length > 0 ? (
          <section>
            <SectionHeading>Background</SectionHeading>
            <div className="flex flex-col gap-2">
              {document.background.map((item, i) => (
                <div key={i} className="rounded-xl border border-neutral-200 bg-white p-4">
                  <EditableText
                    value={item.heading}
                    onCommit={(v) => updateListItem('background', i, { heading: v })}
                    as="h3"
                    className="block text-sm font-bold text-neutral-900"
                  />
                  <EditableText
                    value={item.narrative}
                    onCommit={(v) => updateListItem('background', i, { narrative: v })}
                    as="p"
                    multiline
                    className="mt-1 block text-sm leading-relaxed text-neutral-700"
                  />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {document.prior_attempts.length > 0 ? (
          <section>
            <SectionHeading>Prior Attempts</SectionHeading>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {document.prior_attempts.map((item, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4">
                  <EditableText
                    value={item.name}
                    onCommit={(v) => updateListItem('prior_attempts', i, { name: v })}
                    as="h3"
                    className="block text-sm font-bold text-neutral-900"
                  />
                  <EditableText
                    value={item.description}
                    onCommit={(v) => updateListItem('prior_attempts', i, { description: v })}
                    as="p"
                    multiline
                    className="block text-xs text-neutral-700"
                  />
                  <div className="rounded-lg bg-neutral-50 p-2.5">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Outcome</h4>
                    <EditableText
                      value={item.outcome}
                      onCommit={(v) => updateListItem('prior_attempts', i, { outcome: v })}
                      as="p"
                      multiline
                      className="mt-0.5 block text-xs text-neutral-800"
                    />
                  </div>
                  <div className="rounded-lg bg-accent-light p-2.5">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-accent">Lesson</h4>
                    <EditableText
                      value={item.lesson}
                      onCommit={(v) => updateListItem('prior_attempts', i, { lesson: v })}
                      as="p"
                      multiline
                      className="mt-0.5 block text-xs text-neutral-800"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {document.root_causes.length > 0 ? (
          <section>
            <SectionHeading>Root Causes</SectionHeading>
            <div className="flex flex-col gap-2">
              {document.root_causes.map((item, i) => (
                <div key={i} className="rounded-xl border border-neutral-200 bg-white p-4">
                  <EditableText
                    value={item.cause}
                    onCommit={(v) => updateListItem('root_causes', i, { cause: v })}
                    as="h3"
                    className="block text-sm font-bold text-neutral-900"
                  />
                  <EditableText
                    value={item.evidence}
                    onCommit={(v) => updateListItem('root_causes', i, { evidence: v })}
                    as="p"
                    multiline
                    className="mt-1 block text-sm leading-relaxed text-neutral-700"
                  />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {document.stakeholder_considerations.length > 0 ? (
            <section>
              <SectionHeading>Stakeholder Considerations</SectionHeading>
              <div className="flex flex-col gap-2">
                {document.stakeholder_considerations.map((item, i) => (
                  <div key={i} className="rounded-xl border border-neutral-200 bg-white p-3">
                    <EditableText
                      value={item.heading}
                      onCommit={(v) => updateListItem('stakeholder_considerations', i, { heading: v })}
                      as="h3"
                      className="block text-sm font-bold text-neutral-900"
                    />
                    <EditableText
                      value={item.detail}
                      onCommit={(v) => updateListItem('stakeholder_considerations', i, { detail: v })}
                      as="p"
                      multiline
                      className="mt-1 block text-xs text-neutral-700"
                    />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {document.constraints.length > 0 ? (
            <section>
              <SectionHeading>Constraints</SectionHeading>
              <div className="flex flex-col gap-2">
                {document.constraints.map((item, i) => (
                  <div key={i} className="rounded-xl border border-neutral-200 bg-white p-3">
                    <EditableText
                      value={item.heading}
                      onCommit={(v) => updateListItem('constraints', i, { heading: v })}
                      as="h3"
                      className="block text-sm font-bold text-neutral-900"
                    />
                    <EditableText
                      value={item.detail}
                      onCommit={(v) => updateListItem('constraints', i, { detail: v })}
                      as="p"
                      multiline
                      className="mt-1 block text-xs text-neutral-700"
                    />
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <section>
          <SectionHeading>Success Definition</SectionHeading>
          <EditableText
            value={document.success_definition}
            onCommit={(v) => updateField('success_definition', v)}
            as="p"
            multiline
            className="block rounded-xl border border-neutral-200 bg-white p-4 text-sm leading-relaxed text-neutral-800"
          />
        </section>

        {document.open_risks.length > 0 ? (
          <section>
            <SectionHeading>Open Risks</SectionHeading>
            <div className="flex flex-col gap-2">
              {document.open_risks.map((item, i) => (
                <div key={i} className="rounded-xl border border-red-100 bg-red-50 p-4">
                  <EditableText
                    value={item.risk}
                    onCommit={(v) => updateListItem('open_risks', i, { risk: v })}
                    as="h3"
                    className="block text-sm font-bold text-red-700"
                  />
                  <EditableText
                    value={item.why_it_matters}
                    onCommit={(v) => updateListItem('open_risks', i, { why_it_matters: v })}
                    as="p"
                    multiline
                    className="mt-1 block text-sm leading-relaxed text-red-700"
                  />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {document.recommended_focus_areas.length > 0 ? (
          <section>
            <SectionHeading>Recommended Focus Areas</SectionHeading>
            <ul className="flex flex-col gap-1.5 rounded-xl border border-primary/30 bg-primary-light p-4">
              {document.recommended_focus_areas.map((area, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-primary-dark">
                  <span className="mt-0.5 font-mono text-xs text-primary">{i + 1}.</span>
                  <EditableText
                    value={area}
                    onCommit={(v) => updateFocusArea(i, v)}
                    as="span"
                    multiline
                    className="block flex-1"
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {document.clarifications.length > 0 ? (
          <section>
            <button
              type="button"
              onClick={() => setTranscriptOpen((v) => !v)}
              className="text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-700"
            >
              {transcriptOpen ? '▾' : '▸'} Full Interview Transcript ({document.clarifications.length})
            </button>
            {transcriptOpen ? (
              <div className="mt-2 flex flex-col gap-2">
                {document.clarifications.map((item, i) => (
                  <div key={i} className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
                    <p className="text-neutral-500">{item.question.question}</p>
                    <p className="font-medium text-neutral-900">{item.answer}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  )
}
