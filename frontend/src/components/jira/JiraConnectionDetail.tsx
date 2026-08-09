import { useEffect, useState } from 'react'
import {
  attachToSpecBuilder,
  listSpecBuilderProjects,
  pullConnection,
  renameConnection,
} from '../../lib/jiraApi'
import type {
  AttachToSpecBuilderResponse,
  JiraConnectionDetail as JiraConnectionDetailType,
  JiraIssueRef,
  SpecBuilderProjectOption,
} from '../../jiraTypes'
import { EditableText } from '../infographic/EditableText'
import { StageIntroCard } from '../design-thinking/StageIntroCard'

interface JiraConnectionDetailProps {
  detail: JiraConnectionDetailType
  onChange: (detail: JiraConnectionDetailType) => void
  onBack: () => void
}

function KeyBadge({ jiraKey, baseUrl }: { jiraKey: string; baseUrl: string }) {
  return (
    <a
      href={`${baseUrl}/browse/${jiraKey}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-mono font-medium text-neutral-700 hover:bg-primary-light hover:text-primary-dark"
    >
      {jiraKey}
    </a>
  )
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null
  const lower = status.toLowerCase()
  const variant = lower === 'done' ? 'bg-primary-light text-primary-dark' : lower.includes('progress') ? 'bg-accent-light text-accent' : 'bg-neutral-100 text-neutral-600'
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${variant}`}>{status}</span>
}

function IssueRow({ issue, baseUrl }: { issue: JiraIssueRef; baseUrl: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs">
      <KeyBadge jiraKey={issue.key} baseUrl={baseUrl} />
      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        {issue.issue_type}
      </span>
      <span className="min-w-0 flex-1 truncate text-neutral-800">{issue.title}</span>
      <StatusBadge status={issue.status} />
      {issue.assignee ? <span className="text-neutral-500">{issue.assignee}</span> : null}
      {issue.sprint ? (
        <span className="rounded-full border border-neutral-200 px-2 py-0.5 text-[10px] text-neutral-500">{issue.sprint}</span>
      ) : null}
      {issue.story_points != null ? (
        <span className="rounded-full border border-neutral-200 px-2 py-0.5 text-[10px] text-neutral-500">{issue.story_points} pts</span>
      ) : null}
    </div>
  )
}

export function JiraConnectionDetail({ detail, onChange, onBack }: JiraConnectionDetailProps) {
  const { meta, snapshot } = detail
  const [pullBusy, setPullBusy] = useState(false)
  const [pullError, setPullError] = useState<string | null>(null)

  const [specProjects, setSpecProjects] = useState<SpecBuilderProjectOption[]>([])
  const [selectedSpecProject, setSelectedSpecProject] = useState('')
  const [attachBusy, setAttachBusy] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [attachResult, setAttachResult] = useState<AttachToSpecBuilderResponse | null>(null)

  useEffect(() => {
    listSpecBuilderProjects(meta.id)
      .then((options) => {
        setSpecProjects(options)
        if (options.length > 0) setSelectedSpecProject(options[0].id)
      })
      .catch(() => {
        // Non-critical -- the attach panel just won't have anything to pick if this fails.
      })
  }, [meta.id])

  const handleRename = async (name: string) => {
    if (!name.trim() || name === meta.name) return
    const updated = await renameConnection(meta.id, name.trim())
    onChange({ ...detail, meta: updated })
  }

  const handlePull = async () => {
    setPullBusy(true)
    setPullError(null)
    try {
      const updated = await pullConnection(meta.id)
      onChange(updated)
    } catch (err) {
      setPullError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setPullBusy(false)
    }
  }

  const handleAttach = async () => {
    if (!selectedSpecProject) return
    setAttachBusy(true)
    setAttachError(null)
    setAttachResult(null)
    try {
      const result = await attachToSpecBuilder(meta.id, selectedSpecProject)
      setAttachResult(result)
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setAttachBusy(false)
    }
  }

  const otherIssueCount = snapshot?.other_issues.length ?? 0
  const storyCount = snapshot?.epics.reduce((n, e) => n + e.stories.length, 0) ?? 0

  return (
    <div className="px-6 py-6">
      <div className="mb-4 flex items-center justify-between border-b border-neutral-200 pb-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="text-sm font-medium text-neutral-500 hover:text-neutral-900">
            ← Jira
          </button>
          <div>
            <EditableText value={meta.name} onCommit={handleRename} as="h2" className="text-lg font-semibold text-neutral-900" />
            <p className="text-xs text-neutral-500">
              {meta.project_key} — {meta.base_url.replace(/^https?:\/\//, '')}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handlePull}
          disabled={pullBusy}
          className="shrink-0 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pullBusy ? 'Pulling…' : snapshot ? 'Refresh' : 'Pull project'}
        </button>
      </div>

      {pullError ? <p className="mb-4 text-sm text-red-600">{pullError}</p> : null}
      {meta.truncated ? (
        <p className="mb-4 rounded-lg border border-accent/40 bg-accent-light px-3 py-2 text-xs text-accent">
          This project has more issues than one pull can hold — showing the first {meta.issue_count.toLocaleString()}.
        </p>
      ) : null}

      {!snapshot ? (
        <StageIntroCard
          title="Nothing pulled yet"
          steps={[
            'Click "Pull project" to fetch every epic, story, task, and bug from Jira',
            'Browse it here, refresh whenever it changes',
            'Attach it to a Spec Builder project to enrich its epics and stories',
          ]}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <span className="rounded-full bg-primary-light px-2 py-0.5 font-medium text-primary-dark">
              {snapshot.epics.length} epic{snapshot.epics.length === 1 ? '' : 's'}
            </span>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-medium text-neutral-600">
              {storyCount} stor{storyCount === 1 ? 'y' : 'ies'}
            </span>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-medium text-neutral-600">
              {otherIssueCount} other issue{otherIssueCount === 1 ? '' : 's'}
            </span>
            {meta.last_synced_at ? <span>Last pulled {new Date(meta.last_synced_at).toLocaleString()}</span> : null}
          </div>

          {snapshot.epics.length > 0 ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">Epics</h3>
              <div className="flex flex-col gap-3">
                {snapshot.epics.map((epic) => (
                  <div key={epic.key} className="rounded-xl border border-neutral-200 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <KeyBadge jiraKey={epic.key} baseUrl={meta.base_url} />
                      <span className="text-sm font-bold text-neutral-900">{epic.title}</span>
                      <StatusBadge status={epic.status} />
                    </div>
                    {epic.stories.length > 0 ? (
                      <div className="mt-2.5 flex flex-col gap-1.5">
                        {epic.stories.map((story) => (
                          <IssueRow key={story.key} issue={story} baseUrl={meta.base_url} />
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-neutral-400">No stories under this epic.</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {snapshot.other_issues.length > 0 ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">
                Other issues — unlinked stories, tasks, bugs, and more
              </h3>
              <div className="flex flex-col gap-1.5">
                {snapshot.other_issues.map((issue) => (
                  <IssueRow key={issue.key} issue={issue} baseUrl={meta.base_url} />
                ))}
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-primary/30 bg-primary-light p-4">
            <h3 className="text-sm font-bold text-primary-dark">Attach to Spec Builder</h3>
            <p className="mt-1 text-xs text-neutral-600">
              Merges this project's epics and stories into a Spec Builder spec — same enrichment agent
              that classifies functional vs. technical work and fills gaps in thin descriptions. Only
              Epic and Story issues are attached; tasks and bugs stay browse-only here.
            </p>
            {specProjects.length === 0 ? (
              <p className="mt-3 text-xs text-neutral-500">
                No Spec Builder projects with a generated spec yet — build one in Spec Builder first.
              </p>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  value={selectedSpecProject}
                  onChange={(e) => {
                    setSelectedSpecProject(e.target.value)
                    setAttachResult(null)
                  }}
                  className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary"
                >
                  {specProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAttach}
                  disabled={attachBusy}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {attachBusy ? 'Attaching…' : 'Attach'}
                </button>
              </div>
            )}
            {attachError ? <p className="mt-2 text-xs text-red-600">{attachError}</p> : null}
            {attachResult ? (
              <p className="mt-2 text-xs text-primary-dark">
                Added {attachResult.new_epics} epic{attachResult.new_epics === 1 ? '' : 's'} and{' '}
                {attachResult.new_stories} stor{attachResult.new_stories === 1 ? 'y' : 'ies'}.
                {attachResult.unmapped_requirements.length > 0
                  ? ` ${attachResult.unmapped_requirements.length} requirement${attachResult.unmapped_requirements.length === 1 ? '' : 's'} still have no matching story.`
                  : ''}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
