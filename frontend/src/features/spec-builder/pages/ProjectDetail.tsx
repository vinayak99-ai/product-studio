import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/features/spec-builder/lib/api"
import type { ClarifyQuestion, GeneratedPRD, UserStory } from "@/features/spec-builder/lib/types"
import { confirmedStepsChanged, nonStepFields } from "@/features/spec-builder/lib/pipelineFields"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { AlertDialog } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { SourceNotesSection } from "@/features/spec-builder/components/SourceNotesSection"
import { EditableList } from "@/features/spec-builder/components/EditableList"
import { IdentifiedList } from "@/features/spec-builder/components/IdentifiedList"
import { KeyEntityList } from "@/features/spec-builder/components/KeyEntityList"
import { TestCaseList } from "@/features/spec-builder/components/TestCaseList"
import { PipelineStepper } from "@/features/spec-builder/components/PipelineStepper"
import { UserStoryCard } from "@/features/spec-builder/components/UserStoryCard"
import { Section } from "@/features/spec-builder/components/Section"
import { ExportMenu } from "@/features/spec-builder/components/ExportMenu"
import { EditableBlock } from "@/features/spec-builder/components/EditableBlock"
import { ViewModeProvider, type ViewMode } from "@/features/spec-builder/hooks/view-mode"
import { OutlineNav, type OutlineSection } from "@/features/spec-builder/components/OutlineNav"
import { DiagramsSection } from "@/features/spec-builder/components/DiagramsSection"
import { ArchitectureDecisionsSection } from "@/features/spec-builder/components/ArchitectureDecisionsSection"
import { EpicsSection, DeliveryStatusBar } from "@/features/spec-builder/components/EpicsSection"
import { StakeholdersSection } from "@/features/spec-builder/components/StakeholdersSection"
import { GlossarySection } from "@/features/spec-builder/components/GlossarySection"
import { BriefsSection } from "@/features/spec-builder/components/BriefsSection"
import { UpdatesSection } from "@/features/spec-builder/components/UpdatesSection"
import {
  AlignLeft,
  AlertTriangle,
  Blocks,
  BookMarked,
  BookOpen,
  CheckSquare,
  Database,
  Eye,
  FileText,
  GitBranch,
  HelpCircle,
  Layers,
  ListChecks,
  Pencil,
  Plus,
  RefreshCw,
  Target,
  Users,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface ProjectDetailProps {
  projectId: string
  projectName: string
  initialArtifactId?: string
  initialPrd?: GeneratedPRD
  onBack: () => void
  onNeedsClarification?: (projectId: string, projectName: string, questions: ClarifyQuestion[]) => void
}

const emptyStory: UserStory = {
  title: "",
  priority: "",
  description: "",
  why_this_priority: "",
  independent_test: "",
  acceptance_scenarios: [],
}

// The document itself lives on the Spec tab; the audience layer (who cares,
// shared language, projections, "what changed" updates) lives on Comms.
const SPEC_OUTLINE: OutlineSection[] = [
  { id: "overview", label: "Overview", icon: AlignLeft },
  { id: "source-notes", label: "Source Notes", icon: FileText },
  { id: "stories", label: "User Stories", icon: BookOpen },
  { id: "edge-cases", label: "Edge Cases", icon: AlertTriangle },
  { id: "functional-requirements", label: "Requirements", icon: ListChecks },
  { id: "key-entities", label: "Key Entities", icon: Database },
  { id: "test-cases", label: "Test Cases", icon: CheckSquare },
  { id: "assumptions", label: "Assumptions", icon: HelpCircle },
  { id: "architecture", label: "Architecture", icon: Blocks },
  { id: "epics", label: "Epics", icon: Layers },
  { id: "diagrams", label: "Diagrams", icon: GitBranch },
]

const COMMS_OUTLINE: OutlineSection[] = [
  { id: "stakeholders", label: "Stakeholders", icon: Users },
  { id: "glossary", label: "Glossary", icon: BookMarked },
  { id: "briefs", label: "Briefs", icon: FileText },
  { id: "updates", label: "Updates", icon: RefreshCw },
]

type DetailTab = "spec" | "comms"

export function ProjectDetail({
  projectId,
  projectName,
  initialArtifactId,
  initialPrd,
  onBack,
  onNeedsClarification,
}: ProjectDetailProps) {
  const toast = useToast()
  const [artifactId, setArtifactId] = useState<string | null>(initialArtifactId ?? null)
  const [prd, setPrd] = useState<GeneratedPRD | null>(initialPrd ?? null)
  const [loading, setLoading] = useState(!initialPrd)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Reading is the default mode; editing is a gesture away (per-block
  // click-to-edit, or flip the whole page with this toggle).
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem("aipm-view-mode") as ViewMode) || "read"
  )

  useEffect(() => {
    localStorage.setItem("aipm-view-mode", viewMode)
  }, [viewMode])

  const [tab, setTab] = useState<DetailTab>("spec")
  // "Something needs an eye here" markers for the outline rail / tab labels.
  const [updatesAttention, setUpdatesAttention] = useState(false)

  // Drives the Source Notes section's "input changed since generation"
  // badge. Refetched after a regenerate (see handleRegenerated below) so the
  // badge clears immediately rather than waiting for a full remount.
  const [inputUpdatedAt, setInputUpdatedAt] = useState<string | null>(null)
  const [lastGeneratedAt, setLastGeneratedAt] = useState<string | null>(null)

  const refreshMetaTimestamps = useCallback(() => {
    api
      .getProject(projectId)
      .then((meta) => {
        setInputUpdatedAt(meta.input_updated_at)
        setLastGeneratedAt(meta.last_generated_at)
      })
      .catch(() => {})
  }, [projectId])

  useEffect(() => {
    refreshMetaTimestamps()
  }, [refreshMetaTimestamps])

  useEffect(() => {
    if (initialPrd) return
    setLoading(true)
    api
      .listArtifacts(projectId)
      .then(async ({ artifact_ids }) => {
        if (artifact_ids.length > 0) {
          const id = artifact_ids[0]
          const loaded = await api.getArtifact(projectId, id)
          setArtifactId(id)
          setPrd(loaded)
          lastSyncedPrdRef.current = loaded
          return
        }
        // No artifact yet -- check whether this project has an unanswered
        // clarification round waiting (e.g. the PM navigated away mid-flow).
        if (onNeedsClarification) {
          try {
            const { questions } = await api.getPendingClarification(projectId)
            onNeedsClarification(projectId, projectName, questions)
            return
          } catch {
            // no pending clarification either -- fall through to "no PRD yet"
          }
        }
        setPrd(null)
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [projectId, projectName, initialPrd, onNeedsClarification])

  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  // After a failed autosave, hold off until the next edit rather than
  // retrying on a loop; manual save (button / Cmd+S) still works.
  const [autosavePaused, setAutosavePaused] = useState(false)

  // Latest prd, so an in-flight save knows whether edits arrived while it
  // was running (in which case the doc is still dirty afterwards).
  const prdRef = useRef(prd)
  prdRef.current = prd

  // The prd as of the last successful save/load from the server -- diffed
  // against the current snapshot in doSave to tell which pipeline steps'
  // fields actually changed, since a confirmed step's fields can't go
  // through the plain PUT (the backend rejects that) and must instead go
  // through POST /steps/{step}/edit, which runs a scope check and may
  // cascade downstream steps to "stale".
  const lastSyncedPrdRef = useRef<GeneratedPRD | null>(initialPrd ?? null)

  const doSave = useCallback(
    async (reason: "manual save" | "autosave"): Promise<boolean> => {
      const snapshot = prdRef.current
      if (!snapshot || !artifactId) return false
      setSaving(true)
      try {
        let working = snapshot
        const baseline = lastSyncedPrdRef.current
        const touchedConfirmedSteps = baseline ? confirmedStepsChanged(baseline, working) : []

        for (const step of touchedConfirmedSteps) {
          const res = await api.editStep(projectId, step, working)
          // Adopt the server's view of this step's owned fields + pipeline
          // state (including any cascade), but keep the PM's not-yet-saved
          // edits to fields editStep doesn't own (title, diagrams, briefs,
          // updates, ...) rather than letting the server's stale copy of
          // those win.
          working = { ...working, ...res.prd, ...nonStepFields(working) }
          if (res.scope_check?.classification === "scope_change" && res.cascaded_to.length > 0) {
            toast({
              title: `${step} edited — downstream steps need another look`,
              description: `${res.cascaded_to.join(", ")} marked stale: ${res.scope_check.rationale}`,
            })
          }
        }

        await api.updateArtifact(projectId, artifactId, working, reason)
        if (prdRef.current === snapshot) {
          setPrd(working)
          setDirty(false)
        }
        lastSyncedPrdRef.current = working
        setLastSavedAt(new Date())
        return true
      } catch (e) {
        toast({ title: "Save failed", description: String(e), variant: "destructive" })
        return false
      } finally {
        setSaving(false)
      }
    },
    [artifactId, projectId, toast]
  )

  const handleSave = useCallback(() => doSave("manual save"), [doSave])

  function handleRegenerated(newArtifactId: string, newPrd: GeneratedPRD) {
    // The one place that replaces `prd` wholesale -- every other
    // regenerate-style action here (Architecture/Epics/Diagrams/Briefs/
    // Updates) merges exactly one field back via onChange/update(). A full
    // spec regeneration from updated input is a different kind of action:
    // stories, requirements, entities, criteria, ADRs, and epics all derive
    // from the same extraction+generation pass, so there's no single field
    // to merge -- the whole document is new. The prior version isn't lost;
    // it's preserved in this artifact's version history.
    setArtifactId(newArtifactId)
    setPrd(newPrd)
    lastSyncedPrdRef.current = newPrd
    setDirty(false)
    setAutosavePaused(false)
    setLastSavedAt(new Date())
    refreshMetaTimestamps()
    toast({ title: "Spec regenerated", description: "Redrafted from the updated source notes." })
  }

  // The pipeline step actions (generate/confirm/revisit) already save
  // server-side -- this just syncs local state and the diff baseline so a
  // later inline edit isn't compared against a stale snapshot.
  function handlePipelineChange(newPrd: GeneratedPRD) {
    setPrd(newPrd)
    lastSyncedPrdRef.current = newPrd
    setLastSavedAt(new Date())
  }

  // Debounced autosave: 2s after the last edit. The server dedupes
  // identical content, so this never spams the version history.
  useEffect(() => {
    if (!dirty || saving || autosavePaused || !artifactId) return
    const timer = setTimeout(() => {
      void doSave("autosave").then((ok) => {
        if (!ok) setAutosavePaused(true)
      })
    }, 2000)
    return () => clearTimeout(timer)
  }, [dirty, saving, autosavePaused, artifactId, prd, doSave])

  // Cmd/Ctrl+S saves instead of triggering the browser's save-page dialog.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        if (!saving) void handleSave()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [handleSave, saving])

  function handleBack() {
    if (dirty) {
      setConfirmingLeave(true)
    } else {
      onBack()
    }
  }

  // Attention markers, computed from the artifact itself where possible.
  const proposedAdrCount = prd?.architecture_decisions.filter((d) => d.status === "proposed").length ?? 0
  const unresolvedNoteCount =
    prd?.epics.reduce((n, e) => n + e.stories.filter((s) => s.notes).length, 0) ?? 0

  // "The spec has moved past the last composed update" needs the diff
  // endpoint; keyed on the last update's to_version + saves, not on every
  // keystroke.
  const lastUpdateToVersion =
    prd && prd.updates.length > 0 ? prd.updates[prd.updates.length - 1].to_version : null
  useEffect(() => {
    if (lastUpdateToVersion === null || !artifactId) {
      setUpdatesAttention(false)
      return
    }
    let cancelled = false
    api
      .getDiff(projectId, artifactId, lastUpdateToVersion)
      .then((res) => {
        if (!cancelled) setUpdatesAttention(res.entries.length > 0)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [projectId, artifactId, lastUpdateToVersion, lastSavedAt])

  const specOutline = SPEC_OUTLINE.map((s) => {
    if (s.id === "architecture" && proposedAdrCount > 0)
      return { ...s, attention: true, attentionTitle: `${proposedAdrCount} proposed decision${proposedAdrCount === 1 ? "" : "s"} awaiting review` }
    if (s.id === "epics" && unresolvedNoteCount > 0)
      return { ...s, attention: true, attentionTitle: `${unresolvedNoteCount} unresolved enrichment note${unresolvedNoteCount === 1 ? "" : "s"}` }
    return s
  })
  const commsOutline = COMMS_OUTLINE.map((s) =>
    s.id === "updates" && updatesAttention
      ? { ...s, attention: true, attentionTitle: "The spec has changed since the last update" }
      : s
  )
  const commsAttention = updatesAttention

  function update<K extends keyof GeneratedPRD>(key: K, value: GeneratedPRD[K]) {
    if (!prd) return
    setPrd({ ...prd, [key]: value })
    setDirty(true)
    setAutosavePaused(false)
  }

  function removeUserStory(index: number) {
    if (!prd) return
    const removed = prd.user_stories[index]
    update(
      "user_stories",
      prd.user_stories.filter((_, idx) => idx !== index)
    )
    toast({
      title: "Story removed",
      description: removed.title || `Story ${index + 1}`,
      action: {
        label: "Undo",
        onClick: () =>
          setPrd((current) => {
            if (!current) return current
            const stories = [...current.user_stories]
            stories.splice(Math.min(index, stories.length), 0, removed)
            return { ...current, user_stories: stories }
          }),
      },
    })
  }

  return (
    <div className="px-6 py-6">
      <div className="sticky top-0 z-10 -mx-6 mb-6 flex items-center justify-between border-b bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <Button variant="ghost" onClick={handleBack}>
          ← Projects
        </Button>
        {artifactId && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border p-0.5" role="group" aria-label="View mode">
              {(
                [
                  { mode: "read" as ViewMode, label: "Read", icon: Eye },
                  { mode: "edit" as ViewMode, label: "Edit", icon: Pencil },
                ]
              ).map(({ mode, label, icon: Icon }) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={viewMode === mode}
                  onClick={() => setViewMode(mode)}
                  className={cn(
                    "flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                    viewMode === mode
                      ? "bg-primary-light text-primary-dark"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="size-3.5" /> {label}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground" role="status">
              {saving
                ? "Saving…"
                : dirty
                  ? "Unsaved changes"
                  : lastSavedAt
                    ? `Saved ${lastSavedAt.toLocaleTimeString()}`
                    : ""}
            </span>
            <ExportMenu projectId={projectId} artifactId={artifactId} />
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex gap-8">
          <div className="sticky top-20 hidden w-56 shrink-0 flex-col gap-2 lg:flex">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <Skeleton className="h-16 w-full rounded-xl" />
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-40 w-full rounded-xl" />
            ))}
          </div>
        </div>
      )}
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {!loading && !prd && (
        <p className="text-sm text-muted-foreground">
          No PRD generated yet for "{projectName}". Go back and use "New Project" to generate one.
        </p>
      )}

      {prd && (
        <ViewModeProvider mode={viewMode}>
        <div className="mb-4 flex gap-1 border-b" role="tablist" aria-label="Project areas">
          {(
            [
              { key: "spec" as DetailTab, label: "Spec" },
              { key: "comms" as DetailTab, label: "Comms" },
            ]
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                tab === key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
              {key === "comms" && commsAttention && (
                <span
                  className="size-1.5 rounded-full bg-amber-500"
                  title="The spec has changed since the last update"
                />
              )}
            </button>
          ))}
        </div>
        <div className="flex gap-8">
          <OutlineNav sections={tab === "spec" ? specOutline : commsOutline} />

          <div className={cn("flex min-w-0 flex-1 flex-col gap-4", tab !== "spec" && "hidden")}>
            <div id="overview" className="scroll-mt-20 flex flex-col gap-2 rounded-xl border bg-card p-4">
              <EditableBlock
                label="title"
                read={
                  <div className="flex flex-col gap-1">
                    <h1 className="text-2xl font-semibold tracking-tight">{prd.title || "(untitled)"}</h1>
                    <p className="text-xs text-muted-foreground">{projectName}</p>
                  </div>
                }
              >
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  className="text-lg font-semibold"
                  value={prd.title}
                  onChange={(e) => update("title", e.target.value)}
                />
              </EditableBlock>

              {prd.epics.length > 0 && (
                <div className="flex flex-col gap-2 border-t pt-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">
                      <FileText className="size-3" />
                      {prd.epics.some((e) => e.jira_key || e.stories.some((s) => s.jira_key))
                        ? "in Jira"
                        : "not yet in Jira"}
                    </Badge>
                    <Badge variant="outline">
                      <Layers className="size-3" />
                      {prd.epics.length} epic{prd.epics.length === 1 ? "" : "s"}
                      {prd.epics.filter((e) => e.business_impact === "high").length > 0 &&
                        ` · ${prd.epics.filter((e) => e.business_impact === "high").length} high impact`}
                    </Badge>
                    {prd.architecture_decisions.filter((d) => d.status === "proposed").length > 0 && (
                      <Badge variant="secondary">
                        <Blocks className="size-3" />
                        {prd.architecture_decisions.filter((d) => d.status === "proposed").length} proposed ADR
                        {prd.architecture_decisions.filter((d) => d.status === "proposed").length === 1 ? "" : "s"}
                      </Badge>
                    )}
                  </div>
                  <DeliveryStatusBar epics={prd.epics} />
                </div>
              )}

              {(prd.problem_statement || prd.goals.length > 0 || prd.target_users.length > 0) && (
                <div className="flex flex-col gap-3 border-t pt-3">
                  <EditableBlock
                    label="problem statement"
                    read={
                      <p className="text-sm leading-relaxed">
                        {prd.problem_statement || <span className="text-muted-foreground italic">(empty)</span>}
                      </p>
                    }
                  >
                    <Label htmlFor="problem-statement">Problem statement</Label>
                    <Textarea
                      id="problem-statement"
                      className="min-h-16"
                      value={prd.problem_statement}
                      onChange={(e) => update("problem_statement", e.target.value)}
                    />
                  </EditableBlock>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <EditableList
                      id="goals"
                      icon={Target}
                      label="Goals"
                      items={prd.goals}
                      onChange={(goals) => update("goals", goals)}
                    />
                    <EditableList
                      id="target-users"
                      icon={Users}
                      label="Target users"
                      items={prd.target_users}
                      onChange={(target_users) => update("target_users", target_users)}
                    />
                  </div>

                  {prd.personas.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <p className="text-xs font-medium text-muted-foreground">Personas</p>
                      <div className="flex flex-wrap gap-2">
                        {prd.personas.map((p) => (
                          <Badge key={p.id} variant="outline" title={p.description} className="font-normal">
                            {p.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {prd.use_cases.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <p className="text-xs font-medium text-muted-foreground">Use cases</p>
                      <ul className="flex flex-col gap-1">
                        {prd.use_cases.map((u) => (
                          <li key={u.id} className="text-sm">
                            <span className="font-medium">{u.title}</span>{" "}
                            <span className="text-muted-foreground">
                              ({u.actor}) — {u.goal}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            <PipelineStepper projectId={projectId} prd={prd} onPrdChange={handlePipelineChange} />

            <SourceNotesSection
              projectId={projectId}
              projectName={projectName}
              inputUpdatedAt={inputUpdatedAt}
              lastGeneratedAt={lastGeneratedAt}
              onNeedsClarification={onNeedsClarification ?? (() => {})}
              onRegenerated={handleRegenerated}
            />

            <Section
              id="stories"
              title="User Stories"
              icon={BookOpen}
              count={prd.user_stories.length}
              actions={
                viewMode === "edit" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => update("user_stories", [...prd.user_stories, { ...emptyStory }])}
                  >
                    <Plus className="size-4" /> Add story
                  </Button>
                ) : undefined
              }
            >
              {prd.user_stories.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No user stories yet. These are drafted automatically when a spec is generated.
                </p>
              )}
              {prd.user_stories.map((story, i) => (
                <UserStoryCard
                  key={i}
                  index={i}
                  story={story}
                  onChange={(updated) => {
                    const next = [...prd.user_stories]
                    next[i] = updated
                    update("user_stories", next)
                  }}
                  onRemove={() => removeUserStory(i)}
                />
              ))}
            </Section>

            <EditableList
              id="edge-cases"
              icon={AlertTriangle}
              label="Edge cases"
              items={prd.edge_cases}
              onChange={(edge_cases) => update("edge_cases", edge_cases)}
            />

            <IdentifiedList
              id="functional-requirements"
              icon={ListChecks}
              label="Functional requirements"
              prefix="FR"
              items={prd.functional_requirements}
              onChange={(functional_requirements) => update("functional_requirements", functional_requirements)}
              defaultItem={{ kind: "functional" }}
            />

            <KeyEntityList
              id="key-entities"
              icon={Database}
              items={prd.key_entities}
              onChange={(key_entities) => update("key_entities", key_entities)}
            />

            <TestCaseList
              items={prd.test_cases}
              onChange={(test_cases) => update("test_cases", test_cases)}
            />

            <EditableList
              id="assumptions"
              icon={HelpCircle}
              label="Assumptions"
              items={prd.assumptions}
              onChange={(assumptions) => update("assumptions", assumptions)}
            />

            {artifactId && (
              <ArchitectureDecisionsSection
                projectId={projectId}
                artifactId={artifactId}
                decisions={prd.architecture_decisions}
                technicalContext={prd.technical_context}
                onChange={(architecture_decisions) => update("architecture_decisions", architecture_decisions)}
                onGenerated={handlePipelineChange}
              />
            )}

            {artifactId && (
              <EpicsSection
                projectId={projectId}
                artifactId={artifactId}
                epics={prd.epics}
                onChange={(epics) => update("epics", epics)}
                onGenerated={handlePipelineChange}
              />
            )}

            {artifactId && (
              <DiagramsSection
                projectId={projectId}
                artifactId={artifactId}
                diagrams={prd.diagrams}
                onChange={(diagrams) => update("diagrams", diagrams)}
              />
            )}
          </div>

          {/* Comms: the audience layer — who cares, shared language, audience
              projections, and "what changed" updates. Kept mounted (hidden via
              CSS) so in-progress edits survive tab switches. */}
          <div className={cn("flex min-w-0 flex-1 flex-col gap-4", tab !== "comms" && "hidden")}>
            {artifactId && (
              <>
                <StakeholdersSection projectId={projectId} />

                <GlossarySection projectId={projectId} />

                <BriefsSection
                  projectId={projectId}
                  artifactId={artifactId}
                  briefs={prd.briefs}
                  onChange={(briefs) => update("briefs", briefs)}
                />

                <UpdatesSection
                  projectId={projectId}
                  artifactId={artifactId}
                  updates={prd.updates}
                  onChange={(updates) => update("updates", updates)}
                />
              </>
            )}
          </div>
        </div>
        </ViewModeProvider>
      )}

      <AlertDialog
        open={confirmingLeave}
        title="Unsaved changes"
        description="You have edits that haven't been saved yet. Save them before leaving?"
        confirmLabel="Save and leave"
        secondaryLabel="Leave without saving"
        onSecondary={() => {
          setConfirmingLeave(false)
          onBack()
        }}
        cancelLabel="Stay"
        busy={saving}
        onConfirm={async () => {
          const ok = await handleSave()
          setConfirmingLeave(false)
          if (ok) onBack()
        }}
        onCancel={() => setConfirmingLeave(false)}
      />
    </div>
  )
}
