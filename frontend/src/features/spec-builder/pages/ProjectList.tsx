import { useEffect, useState } from "react"
import { api } from "@/features/spec-builder/lib/api"
import type { ProjectMeta } from "@/features/spec-builder/lib/types"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardHeader, CardTitle, CardDescription, CardAction } from "@/components/ui/card"
import { AlertDialog } from "@/components/ui/alert-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Pencil, Trash2, Check, X, FileText, MessageCircleQuestion, Layers, Blocks } from "lucide-react"

interface ProjectListProps {
  onSelectProject: (project: ProjectMeta) => void
  onNewProject: () => void
}

export function ProjectList({ onSelectProject, onNewProject }: ProjectListProps) {
  const toast = useToast()
  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")
  const [savingId, setSavingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProjectMeta | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e) => setLoadError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  function startEditing(project: ProjectMeta) {
    setEditingId(project.id)
    setEditingName(project.name)
  }

  function cancelEditing() {
    setEditingId(null)
    setEditingName("")
  }

  async function saveEditing(projectId: string) {
    const name = editingName.trim()
    if (!name) return
    setSavingId(projectId)
    try {
      const updated = await api.renameProject(projectId, name)
      setProjects((prev) => prev.map((p) => (p.id === projectId ? updated : p)))
      setEditingId(null)
      toast({ title: "Project renamed", description: `Now called "${updated.name}"` })
    } catch (e) {
      toast({ title: "Rename failed", description: String(e), variant: "destructive" })
    } finally {
      setSavingId(null)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteProject(deleteTarget.id)
      setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id))
      toast({ title: "Project deleted", description: `"${deleteTarget.name}" was removed.` })
      setDeleteTarget(null)
    } catch (e) {
      toast({ title: "Delete failed", description: String(e), variant: "destructive" })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="px-6 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <Button onClick={onNewProject}>New Project</Button>
      </div>

      {loadError && (
        <p className="mb-4 text-sm text-destructive">
          Couldn't reach the backend ({loadError}). Is it running on{" "}
          {import.meta.env.VITE_API_BASE ?? "http://localhost:8000"}?
        </p>
      )}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-48" />
                <Skeleton className="mt-1 h-4 w-64" />
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="mx-auto max-w-xl rounded-xl border border-dashed p-8 text-center">
          <p className="text-base font-medium">Paste raw notes, get a full spec.</p>
          <div className="mx-auto mt-4 flex max-w-md flex-col gap-2 text-left text-sm text-muted-foreground">
            <p>
              <span className="mr-2 font-mono text-xs">1.</span>Paste whatever you have — meeting
              notes, a Slack thread, a braindump.
            </p>
            <p>
              <span className="mr-2 font-mono text-xs">2.</span>Answer a short round of clarifying
              questions (or accept the suggested defaults).
            </p>
            <p>
              <span className="mr-2 font-mono text-xs">3.</span>Get an editable spec with user
              stories, requirements, architecture decisions, and Jira-ready epics — plus diagrams,
              briefs, and stakeholder updates on demand.
            </p>
          </div>
          <Button className="mt-6" onClick={onNewProject}>
            New Project
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => {
            const isEditing = editingId === project.id
            return (
              <Card
                key={project.id}
                className={isEditing ? "" : "cursor-pointer transition-colors hover:bg-accent/50"}
                onClick={isEditing ? undefined : () => onSelectProject(project)}
              >
                <CardHeader>
                  {isEditing ? (
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <Input
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEditing(project.id)
                          if (e.key === "Escape") cancelEditing()
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={savingId === project.id}
                        onClick={() => saveEditing(project.id)}
                        aria-label="Save name"
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={cancelEditing} aria-label="Cancel">
                        <X className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <CardTitle>{project.name}</CardTitle>
                      <CardDescription>
                        {project.summary?.last_version_reason
                          ? `${project.summary.last_version_reason} · ${new Date(project.updated_at).toLocaleString()}`
                          : `Updated ${new Date(project.updated_at).toLocaleString()}`}
                      </CardDescription>
                      {project.summary && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {project.summary.stage === "clarifying" && (
                            <Badge variant="default">
                              <MessageCircleQuestion className="size-3" />
                              {project.summary.pending_questions} question
                              {project.summary.pending_questions === 1 ? "" : "s"} waiting
                            </Badge>
                          )}
                          {project.summary.stage === "empty" && (
                            <Badge variant="outline">
                              <FileText className="size-3" /> no spec yet
                            </Badge>
                          )}
                          {(project.summary.stage === "in_progress" || project.summary.stage === "complete") && (
                            <>
                              <Badge variant="outline">
                                <FileText className="size-3" />
                                {project.summary.in_jira
                                  ? "in Jira"
                                  : project.summary.stage === "complete"
                                    ? "complete"
                                    : `in progress · ${project.summary.current_step ?? ""}`}
                              </Badge>
                              {project.summary.epic_count > 0 && (
                                <Badge variant="outline">
                                  <Layers className="size-3" />
                                  {project.summary.epic_count} epic
                                  {project.summary.epic_count === 1 ? "" : "s"}
                                  {project.summary.high_impact_epics > 0 &&
                                    ` · ${project.summary.high_impact_epics} high impact`}
                                </Badge>
                              )}
                              {project.summary.proposed_adrs > 0 && (
                                <Badge variant="secondary">
                                  <Blocks className="size-3" />
                                  {project.summary.proposed_adrs} proposed ADR
                                  {project.summary.proposed_adrs === 1 ? "" : "s"}
                                </Badge>
                              )}
                            </>
                          )}
                        </div>
                      )}
                      <CardAction className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation()
                            startEditing(project)
                          }}
                          aria-label="Edit project name"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteTarget(project)
                          }}
                          aria-label="Delete project"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </CardAction>
                    </>
                  )}
                </CardHeader>
              </Card>
            )
          })}
        </div>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        title="Delete project?"
        description={`Delete "${deleteTarget?.name}"? This permanently deletes the project and cannot be undone.`}
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
