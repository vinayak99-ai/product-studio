import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/features/spec-builder/lib/api"
import type { ClarifyQuestion, GeneratedPRD, SpecInput } from "@/features/spec-builder/lib/types"
import { extractFile } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Section } from "@/features/spec-builder/components/Section"
import { PipelineProgress } from "@/features/spec-builder/components/PipelineProgress"
import { FileText } from "lucide-react"

interface SourceNotesSectionProps {
  projectId: string
  projectName: string
  inputUpdatedAt: string | null
  lastGeneratedAt: string | null
  onNeedsClarification: (projectId: string, projectName: string, questions: ClarifyQuestion[]) => void
  onRegenerated: (artifactId: string, prd: GeneratedPRD) => void
}

// The editable source behind the generated spec -- separate from the spec
// itself (GeneratedPRD, edited elsewhere on this page) so a PM can revise
// what the agents were told and ask them to redraft, instead of the raw
// notes being a write-once artifact from "New Project."
export function SourceNotesSection({
  projectId,
  projectName,
  inputUpdatedAt,
  lastGeneratedAt,
  onNeedsClarification,
  onRegenerated,
}: SourceNotesSectionProps) {
  const toast = useToast()
  const [input, setInput] = useState<SpecInput | null>(null)
  const [rawNotes, setRawNotes] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    api
      .getInput(projectId)
      .then((data) => {
        if (cancelled) return
        setInput(data)
        setRawNotes(data.raw_notes)
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  // Same "ref mirrors state so an in-flight save can tell whether more edits
  // arrived while it was running" pattern as ProjectDetail's doSave.
  const rawNotesRef = useRef(rawNotes)
  rawNotesRef.current = rawNotes

  const doSave = useCallback(async () => {
    setSaving(true)
    try {
      const snapshot = rawNotesRef.current
      const saved = await api.saveInput(projectId, snapshot)
      if (rawNotesRef.current === snapshot) setDirty(false)
      setInput(saved)
    } catch (e) {
      toast({ title: "Failed to save notes", description: String(e), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }, [projectId, toast])

  // Same 2s debounce as the PRD's own autosave (ProjectDetail.tsx).
  useEffect(() => {
    if (!dirty || saving) return
    const timer = setTimeout(() => void doSave(), 2000)
    return () => clearTimeout(timer)
  }, [dirty, saving, rawNotes, doSave])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setExtracting(true)
    setError(null)
    try {
      const result = await extractFile(file)
      setRawNotes(result.text)
      setDirty(true)
    } catch (err) {
      setError(`${err}`)
    } finally {
      setExtracting(false)
    }
  }

  async function handleRegenerate() {
    setRegenerating(true)
    setError(null)
    try {
      // Regenerate reads from persisted input, not this component's local
      // state -- flush a pending edit first so it isn't regenerating from
      // stale notes.
      if (dirty) await doSave()
      const res = await api.regenerateSpec(projectId)
      if (res.status === "needs_clarification") {
        onNeedsClarification(projectId, projectName, res.questions)
      } else {
        onRegenerated(res.artifact_id!, res.prd!)
      }
    } catch (err) {
      setError(`${err}`)
    } finally {
      setRegenerating(false)
    }
  }

  const changedSinceGeneration =
    !!inputUpdatedAt && (!lastGeneratedAt || inputUpdatedAt > lastGeneratedAt)

  return (
    <Section
      id="source-notes"
      title="Source Notes"
      icon={FileText}
      defaultOpen={false}
      actions={
        <div className="flex items-center gap-2">
          {saving ? (
            <span className="text-xs text-muted-foreground">Saving…</span>
          ) : dirty ? (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={regenerating || loading}
            onClick={handleRegenerate}
          >
            {regenerating ? "Regenerating…" : "Regenerate spec"}
          </Button>
        </div>
      }
    >
      {changedSinceGeneration && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Input changed since this spec was generated — click "Regenerate spec" to redraft it from
          the current notes.
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          The raw notes behind this spec. Edit them and regenerate to redraft the whole spec from
          scratch — the current version is kept in Version History, so nothing is lost.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={extracting || loading}
          onClick={() => fileInputRef.current?.click()}
        >
          {extracting ? "Reading file…" : "Upload .txt/.md"}
        </Button>
        <input ref={fileInputRef} type="file" accept=".txt,.md" className="hidden" onChange={handleFileChange} />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Textarea
          className="min-h-40"
          value={rawNotes}
          onChange={(e) => {
            setRawNotes(e.target.value)
            setDirty(true)
          }}
          placeholder="Paste or write the raw notes this spec should be generated from…"
        />
      )}

      {input && input.clarifications.length > 0 && (
        <details className="rounded-md border">
          <summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground select-none">
            Previously answered clarifications ({input.clarifications.length})
          </summary>
          <div className="flex flex-col gap-2 border-t px-3 py-2">
            {input.clarifications.map((item, i) => (
              <div key={i} className="text-sm">
                <p className="text-muted-foreground">{item.question.question}</p>
                <p className="font-medium">{item.answer}</p>
              </div>
            ))}
          </div>
        </details>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {regenerating && <PipelineProgress projectId={projectId} active={regenerating} />}
    </Section>
  )
}
