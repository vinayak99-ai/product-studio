import { useEffect, useRef, useState } from "react"
import type { BusinessImpact, Epic, EpicStory, GeneratedPRD, JiraPushResult, JiraStatus } from "@/features/spec-builder/lib/types"
import { api } from "@/features/spec-builder/lib/api"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EditableList } from "@/features/spec-builder/components/EditableList"
import { Section } from "@/features/spec-builder/components/Section"
import { EditableBlock } from "@/features/spec-builder/components/EditableBlock"
import { ChevronDown, Layers, Trash2, Plus } from "lucide-react"

interface EpicsSectionProps {
  projectId: string
  artifactId: string
  epics: Epic[]
  onChange: (epics: Epic[]) => void
  // The pipeline Generate/Revisit calls return the FULL prd, including
  // updated `pipeline` step status -- syncing only `epics` would leave the
  // PipelineStepper's epics chip stuck on a stale status.
  onGenerated: (prd: GeneratedPRD) => void
}

function emptyTechnicalStory(epic: Epic): EpicStory {
  return {
    id: `STORY-NEW-${epic.stories.length + 1}`,
    story_type: "technical",
    title: "",
    description: "",
    acceptance_criteria: [],
    jira_key: null,
    jira_status: null,
    notes: null,
  }
}

interface ImportSummary {
  newEpics: number
  newStories: number
  unmapped: string[]
}

function JiraKeyBadge({ jiraKey, baseUrl }: { jiraKey: string; baseUrl: string | null }) {
  if (!baseUrl) return <Badge variant="secondary">{jiraKey}</Badge>
  return (
    <Badge variant="secondary" asChild>
      <a
        href={`${baseUrl}/browse/${jiraKey}`}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        {jiraKey}
      </a>
    </Badge>
  )
}

function JiraStatusBadge({ status }: { status: string | null }) {
  if (!status) return null
  const variant = status.toLowerCase() === "done" ? "default" : status.toLowerCase().includes("progress") ? "secondary" : "outline"
  return <Badge variant={variant}>{status}</Badge>
}

const IMPACT_RANK: Record<BusinessImpact, number> = { high: 0, medium: 1, low: 2 }

type DeliveryBucket = "done" | "in_progress" | "todo" | "unlinked"

function deliveryBucket(jiraKey: string | null, jiraStatus: string | null): DeliveryBucket {
  if (!jiraKey) return "unlinked"
  const s = (jiraStatus ?? "").toLowerCase()
  if (s === "done" || s === "closed" || s === "resolved") return "done"
  if (s.includes("progress") || s.includes("review")) return "in_progress"
  return "todo"
}

const BUCKET_META: Record<DeliveryBucket, { label: string; className: string }> = {
  done: { label: "Done", className: "bg-emerald-500" },
  in_progress: { label: "In Progress", className: "bg-amber-500" },
  todo: { label: "To Do", className: "bg-muted-foreground/40" },
  unlinked: { label: "not in Jira", className: "bg-muted" },
}

export function DeliveryStatusBar({ epics }: { epics: Epic[] }) {
  const counts: Record<DeliveryBucket, number> = { done: 0, in_progress: 0, todo: 0, unlinked: 0 }
  for (const epic of epics) {
    counts[deliveryBucket(epic.jira_key, epic.jira_status)]++
    for (const story of epic.stories) counts[deliveryBucket(story.jira_key, story.jira_status)]++
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (total === 0) return null
  const buckets = (Object.keys(BUCKET_META) as DeliveryBucket[]).filter((b) => counts[b] > 0)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-2 overflow-hidden rounded-full border" role="img" aria-label="Delivery status summary">
        {buckets.map((b) => (
          <div
            key={b}
            className={BUCKET_META[b].className}
            style={{ width: `${(counts[b] / total) * 100}%` }}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {buckets.map((b, i) => (
          <span key={b}>
            {i > 0 && " · "}
            <span className={`mr-1 inline-block size-2 rounded-full align-middle ${BUCKET_META[b].className}`} />
            {counts[b]} {BUCKET_META[b].label}
          </span>
        ))}
      </p>
    </div>
  )
}

function cycleImpact(current: BusinessImpact): BusinessImpact {
  return current === "high" ? "medium" : current === "medium" ? "low" : "high"
}

function ImpactBadge({ impact, onClick }: { impact: BusinessImpact; onClick: () => void }) {
  const variant = impact === "high" ? "default" : impact === "medium" ? "secondary" : "outline"
  return (
    <Badge
      role="button"
      tabIndex={0}
      variant={variant}
      className="cursor-pointer"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation()
          onClick()
        }
      }}
    >
      {impact} impact
    </Badge>
  )
}

export function EpicsSection({ projectId, artifactId, epics, onChange, onGenerated }: EpicsSectionProps) {
  const toast = useToast()
  // Latest epics/onChange, so a toast's Undo (fired seconds later) restores
  // into the list as it is then, not as it was at deletion time.
  const latest = useRef({ epics, onChange })
  latest.current = { epics, onChange }
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [jiraStatus, setJiraStatus] = useState<JiraStatus | null>(null)
  const [confirmingPush, setConfirmingPush] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)
  const [pushResults, setPushResults] = useState<JiraPushResult[] | null>(null)

  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [jiraMenuOpen, setJiraMenuOpen] = useState(false)

  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncSummary, setSyncSummary] = useState<{ updated: number; unchanged: number } | null>(null)

  useEffect(() => {
    api.getJiraStatus().then(setJiraStatus).catch(() => setJiraStatus(null))
  }, [])

  async function handleRegenerate() {
    setGenerating(true)
    setError(null)
    try {
      const updated = await api.generateStep(projectId, "epics")
      onGenerated(updated)
    } catch (err) {
      setError(`${err}`)
    } finally {
      setGenerating(false)
    }
  }

  async function handleImport() {
    setImporting(true)
    setImportError(null)
    try {
      const beforeKeys = new Set(
        epics.flatMap((e) => [e.jira_key, ...e.stories.map((s) => s.jira_key)])
      )
      const res = await api.importFromJira(projectId, artifactId)
      let newEpics = 0
      let newStories = 0
      for (const e of res.prd.epics) {
        if (e.jira_key && !beforeKeys.has(e.jira_key)) newEpics++
        for (const s of e.stories) {
          if (s.jira_key && !beforeKeys.has(s.jira_key)) newStories++
        }
      }
      onChange(res.prd.epics)
      setImportSummary({ newEpics, newStories, unmapped: res.unmapped_requirements })
    } catch (err) {
      setImportError(`${err}`)
    } finally {
      setImporting(false)
    }
  }

  async function handleSync() {
    setSyncing(true)
    setSyncError(null)
    try {
      const res = await api.syncJiraStatus(projectId, artifactId)
      onChange(res.prd.epics)
      setSyncSummary({ updated: res.updated, unchanged: res.unchanged })
    } catch (err) {
      setSyncError(`${err}`)
    } finally {
      setSyncing(false)
    }
  }

  async function handlePush() {
    setPushing(true)
    setPushError(null)
    try {
      const res = await api.pushToJira(projectId, artifactId)
      onChange(res.prd.epics)
      setPushResults(res.results)
      setConfirmingPush(false)
    } catch (err) {
      setPushError(`${err}`)
    } finally {
      setPushing(false)
    }
  }

  // Display-order only: higher-impact epics render first. The underlying
  // `epics` array, EPIC-N ids, and story numbering are untouched -- update/
  // remove handlers below still index into the real array via `ei`.
  const displayEpics = epics
    .map((epic, index) => ({ epic, index }))
    .sort((a, b) => IMPACT_RANK[a.epic.business_impact] - IMPACT_RANK[b.epic.business_impact])

  const hasLinkedItems = epics.some((e) => e.jira_key || e.stories.some((s) => s.jira_key))
  const unpushedEpics = epics.filter((e) => !e.jira_key).length
  const unpushedStories = epics.reduce(
    (sum, e) => sum + e.stories.filter((s) => !s.jira_key).length,
    0
  )

  function updateEpic(index: number, patch: Partial<Epic>) {
    const next = [...epics]
    next[index] = { ...next[index], ...patch }
    onChange(next)
  }

  function removeEpic(index: number) {
    const removed = epics[index]
    onChange(epics.filter((_, i) => i !== index))
    toast({
      title: `${removed.id} removed`,
      description: removed.title || undefined,
      action: {
        label: "Undo",
        onClick: () => {
          const { epics: current, onChange: change } = latest.current
          const next = [...current]
          next.splice(Math.min(index, next.length), 0, removed)
          change(next)
        },
      },
    })
  }

  function updateStory(epicIndex: number, storyIndex: number, patch: Partial<EpicStory>) {
    const epic = epics[epicIndex]
    const stories = [...epic.stories]
    stories[storyIndex] = { ...stories[storyIndex], ...patch }
    updateEpic(epicIndex, { stories })
  }

  function removeStory(epicIndex: number, storyIndex: number) {
    const epic = epics[epicIndex]
    const removed = epic.stories[storyIndex]
    updateEpic(epicIndex, { stories: epic.stories.filter((_, i) => i !== storyIndex) })
    toast({
      title: `${removed.id} removed`,
      description: removed.title || undefined,
      action: {
        label: "Undo",
        onClick: () => {
          const { epics: current, onChange: change } = latest.current
          const target = current[Math.min(epicIndex, current.length - 1)]
          if (!target) return
          const stories = [...target.stories]
          stories.splice(Math.min(storyIndex, stories.length), 0, removed)
          const next = [...current]
          next[Math.min(epicIndex, current.length - 1)] = { ...target, stories }
          change(next)
        },
      },
    })
  }

  function addTechnicalStory(epicIndex: number) {
    const epic = epics[epicIndex]
    updateEpic(epicIndex, { stories: [...epic.stories, emptyTechnicalStory(epic)] })
  }

  return (
    <Section
      id="epics"
      title="Epics"
      icon={Layers}
      count={epics.length}
      actions={
        <>
          {/* Sync is the routine action, so it stays a first-class button;
              the structural one-offs (push/import) live in the Jira menu. */}
          {jiraStatus?.configured && hasLinkedItems && (
            <Button type="button" variant="outline" size="sm" disabled={syncing} onClick={handleSync}>
              {syncing ? "Syncing…" : "Sync status"}
            </Button>
          )}
          {jiraStatus?.configured && (
            <div className="relative">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-haspopup="menu"
                aria-expanded={jiraMenuOpen}
                onClick={() => setJiraMenuOpen((o) => !o)}
              >
                Jira <ChevronDown className="size-3.5" />
              </Button>
              {jiraMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setJiraMenuOpen(false)} />
                  <div
                    role="menu"
                    className="absolute right-0 z-20 mt-1 w-48 rounded-md border bg-card p-1 shadow-md"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      disabled={epics.length === 0 || pushing}
                      className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                      onClick={() => {
                        setJiraMenuOpen(false)
                        setPushResults(null)
                        setConfirmingPush(true)
                      }}
                    >
                      Push to Jira…
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={importing}
                      className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                      onClick={() => {
                        setJiraMenuOpen(false)
                        void handleImport()
                      }}
                    >
                      {importing ? "Importing…" : "Import from Jira"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          <Button type="button" variant="outline" size="sm" disabled={generating} onClick={handleRegenerate}>
            {generating ? "Generating…" : epics.length > 0 ? "Regenerate" : "Generate"}
          </Button>
        </>
      }
    >
      {error && <p className="text-sm text-destructive">{error}</p>}
      {importError && <p className="text-sm text-destructive">{importError}</p>}
      {syncError && <p className="text-sm text-destructive">{syncError}</p>}

      {syncSummary && (
        <div className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm">
          <p>
            Synced Jira status: <strong>{syncSummary.updated}</strong> changed,{" "}
            <strong>{syncSummary.unchanged}</strong> unchanged.
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSyncSummary(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {importSummary && (
        <div className="flex items-start justify-between gap-2 rounded-md border p-3 text-sm">
          <p>
            Imported <strong>{importSummary.newEpics}</strong> epic{importSummary.newEpics === 1 ? "" : "s"} and{" "}
            <strong>{importSummary.newStories}</strong> stor{importSummary.newStories === 1 ? "y" : "ies"} from
            Jira.
            {importSummary.unmapped.length > 0 && (
              <>
                {" "}
                <strong>{importSummary.unmapped.length}</strong> requirement
                {importSummary.unmapped.length === 1 ? "" : "s"} with no corresponding story:{" "}
                {importSummary.unmapped.join("; ")}
              </>
            )}
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={() => setImportSummary(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {epics.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No epics yet. These are drafted automatically from the user stories above when a spec is generated.
        </p>
      )}

      {epics.length > 0 && (
        <div className="flex flex-col gap-2">
          <DeliveryStatusBar epics={epics} />
          {epics.length > 1 && (
            <p className="text-xs text-muted-foreground">
              Sorted by business impact — epic ids and story numbering are unchanged.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {displayEpics.map(({ epic, index: ei }) => (
          <Card key={epic.id}>
            <EditableBlock
              label={epic.title || epic.id}
              read={
                <div className="flex flex-col gap-2 px-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{epic.id}</span>
                    {epic.jira_key && (
                      <JiraKeyBadge jiraKey={epic.jira_key} baseUrl={jiraStatus?.base_url ?? null} />
                    )}
                    <JiraStatusBadge status={epic.jira_status} />
                    <ImpactBadge
                      impact={epic.business_impact}
                      onClick={() => updateEpic(ei, { business_impact: cycleImpact(epic.business_impact) })}
                    />
                    <h3 className="text-base font-semibold">{epic.title}</h3>
                  </div>
                  {epic.business_impact_rationale && (
                    <p className="text-xs text-muted-foreground italic">{epic.business_impact_rationale}</p>
                  )}
                  {epic.description && (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{epic.description}</p>
                  )}
                  {epic.stories.length > 0 && (
                    <div className="mt-1 flex flex-col gap-1.5">
                      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        Stories
                      </p>
                      {epic.stories.map((story) => (
                        <div key={story.id} className="text-sm leading-relaxed">
                          <span className="mr-1 font-mono text-xs text-muted-foreground">{story.id}</span>{" "}
                          <Badge variant={story.story_type === "functional" ? "default" : "outline"}>
                            {story.story_type}
                          </Badge>{" "}
                          {story.jira_key && (
                            <JiraKeyBadge jiraKey={story.jira_key} baseUrl={jiraStatus?.base_url ?? null} />
                          )}{" "}
                          <JiraStatusBadge status={story.jira_status} />{" "}
                          <span className="font-medium">{story.title}</span>
                          {story.description && (
                            <span className="text-muted-foreground"> — {story.description}</span>
                          )}
                          {story.acceptance_criteria.length > 0 && (
                            <ul className="mt-0.5 list-disc pl-8 text-sm text-muted-foreground">
                              {story.acceptance_criteria.map((c, i) => (
                                <li key={i}>{c}</li>
                              ))}
                            </ul>
                          )}
                          {story.notes && (
                            <p className="pl-4 text-xs text-muted-foreground italic">Note: {story.notes}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              }
            >
            <CardHeader className="flex-row items-center justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">{epic.id}</CardTitle>
                {epic.jira_key && (
                  <JiraKeyBadge jiraKey={epic.jira_key} baseUrl={jiraStatus?.base_url ?? null} />
                )}
                <JiraStatusBadge status={epic.jira_status} />
                <ImpactBadge
                  impact={epic.business_impact}
                  onClick={() => updateEpic(ei, { business_impact: cycleImpact(epic.business_impact) })}
                />
              </div>
              <Button variant="ghost" size="icon" onClick={() => removeEpic(ei)} aria-label="Remove epic">
                <Trash2 className="size-4" />
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {epic.business_impact_rationale && (
                <p className="text-xs text-muted-foreground italic">{epic.business_impact_rationale}</p>
              )}
              <div className="flex flex-col gap-2">
                <Label>Title</Label>
                <Input value={epic.title} onChange={(e) => updateEpic(ei, { title: e.target.value })} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Description</Label>
                <Textarea
                  className="min-h-16"
                  value={epic.description}
                  onChange={(e) => updateEpic(ei, { description: e.target.value })}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label>Stories</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => addTechnicalStory(ei)}>
                  <Plus className="size-4" /> Add technical story
                </Button>
              </div>

              <div className="flex flex-col gap-3">
                {epic.stories.map((story, si) => (
                  <div key={story.id} className="flex flex-col gap-2 rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{story.id}</span>
                        <Badge variant={story.story_type === "functional" ? "default" : "outline"}>
                          {story.story_type}
                        </Badge>
                        {story.jira_key && (
                          <JiraKeyBadge jiraKey={story.jira_key} baseUrl={jiraStatus?.base_url ?? null} />
                        )}
                        <JiraStatusBadge status={story.jira_status} />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeStory(ei, si)}
                        aria-label="Remove story"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    <Input
                      value={story.title}
                      placeholder="Story title"
                      onChange={(e) => updateStory(ei, si, { title: e.target.value })}
                    />
                    <Textarea
                      className="min-h-14"
                      value={story.description}
                      placeholder="Description"
                      onChange={(e) => updateStory(ei, si, { description: e.target.value })}
                    />
                    <EditableList
                      label="Acceptance criteria"
                      items={story.acceptance_criteria}
                      onChange={(acceptance_criteria) => updateStory(ei, si, { acceptance_criteria })}
                    />
                    {story.notes && (
                      <p className="text-xs text-muted-foreground italic">Note: {story.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
            </EditableBlock>
          </Card>
        ))}
      </div>

      {jiraStatus?.configured && (confirmingPush || pushResults) && (
        <div className="flex flex-col gap-3 rounded-md border p-4">
          {confirmingPush && (
            <div className="flex flex-col gap-3">
              <p className="text-sm">
                About to create <strong>{unpushedEpics}</strong> new epic
                {unpushedEpics === 1 ? "" : "s"} and <strong>{unpushedStories}</strong> new
                stor{unpushedStories === 1 ? "y" : "ies"} in{" "}
                <strong>{jiraStatus.project_key}</strong>. Already-pushed items will be
                skipped. Continue?
              </p>
              {pushError && <p className="text-sm text-destructive">{pushError}</p>}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmingPush(false)}
                  disabled={pushing}
                >
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={handlePush} disabled={pushing}>
                  {pushing ? "Pushing…" : "Push to Jira"}
                </Button>
              </div>
            </div>
          )}

          {pushResults && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>Push results</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPushResults(null)}
                >
                  Dismiss
                </Button>
              </div>
              <div className="flex flex-col gap-1">
                {pushResults.map((r) => (
                  <div key={`${r.item_type}-${r.id}`} className="flex items-center gap-2 text-sm">
                    <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">{r.id}</span>
                    {r.status === "created" && r.jira_key && (
                      <>
                        <Badge variant="default">created</Badge>
                        <JiraKeyBadge jiraKey={r.jira_key} baseUrl={jiraStatus.base_url} />
                      </>
                    )}
                    {r.status === "skipped" && r.jira_key && (
                      <>
                        <Badge variant="secondary">already pushed</Badge>
                        <JiraKeyBadge jiraKey={r.jira_key} baseUrl={jiraStatus.base_url} />
                      </>
                    )}
                    {r.status === "error" && (
                      <>
                        <Badge variant="destructive">error</Badge>
                        <span className="text-destructive">{r.detail}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}
