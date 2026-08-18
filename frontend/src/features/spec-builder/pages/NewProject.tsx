import { useRef, useState } from "react"
import { api } from "@/features/spec-builder/lib/api"
import type { ClarifyQuestion, GeneratedPRD } from "@/features/spec-builder/lib/types"
import { extractFile } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { PipelineProgress } from "@/features/spec-builder/components/PipelineProgress"
import { StageIntroCard } from "@/components/design-thinking/StageIntroCard"

interface NewProjectProps {
  onGenerated: (projectId: string, artifactId: string, prd: GeneratedPRD) => void
  onNeedsClarification: (projectId: string, projectName: string, questions: ClarifyQuestion[]) => void
  onCancel: () => void
}

export function NewProject({ onGenerated, onNeedsClarification, onCancel }: NewProjectProps) {
  const [name, setName] = useState("")
  const [rawNotes, setRawNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canSubmit = name.trim().length > 0 && rawNotes.trim().length > 0 && !busy

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setExtracting(true)
    setError(null)
    try {
      const result = await extractFile(file)
      setRawNotes(result.text)
    } catch (err) {
      setError(`${err}`)
    } finally {
      setExtracting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const project = await api.createProject(name.trim())
      setBusyProjectId(project.id)
      const res = await api.generateOverview(project.id, rawNotes.trim())
      if (res.status === "needs_clarification") {
        onNeedsClarification(project.id, project.name, res.questions)
      } else {
        onGenerated(project.id, res.artifact_id!, res.prd!)
      }
    } catch (err) {
      setError(
        `${err}. If this is an authentication error, make sure the right *_API_KEY is set in config/.env for whichever AIPM_MODEL you've configured.`
      )
    } finally {
      setBusy(false)
      setBusyProjectId(null)
    }
  }

  return (
    <div className="px-6 py-6">
      <h1 className="mb-6 text-2xl font-semibold">New Project</h1>

      <Card>
        <CardHeader>
          <CardTitle>Raw notes → PRD</CardTitle>
          <CardDescription>
            Paste whatever you have — a Slack thread, meeting notes, a rough
            idea. The extraction and generation agents will turn it into a
            structured PRD.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Project name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Checkout Redesign"
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="notes">Raw notes</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={extracting}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {extracting ? "Reading file…" : "Upload .txt/.md"}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
              <Textarea
                id="notes"
                className="min-h-48"
                value={rawNotes}
                onChange={(e) => setRawNotes(e.target.value)}
                placeholder="We want to speed up checkout, it's too slow and we're losing customers at payment... or upload a .txt/.md file above"
              />
              <p className="text-xs text-muted-foreground">
                Works best with a couple of paragraphs — meeting notes, Slack threads, and braindumps
                are all fine; the agents will ask about anything they can't infer.
                {rawNotes.trim().length > 0 && rawNotes.trim().length < 200 && (
                  <span> Short notes are fine too — just expect more clarifying questions.</span>
                )}
              </p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {busy && <PipelineProgress projectId={busyProjectId} active={busy} />}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {busy ? "Generating…" : "Generate PRD"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="mt-4">
        <StageIntroCard
          title="What happens next"
          steps={[
            "The Extraction Agent pulls out the problem, goals, and target users",
            "The Clarify Agent asks a short round of questions about anything it can't infer (or accept its recommended defaults)",
            "You'll get a drafted Overview to review and confirm, then work through Stories, Requirements, Test Cases, Architecture, and Epics one step at a time — each one builds on the last, confirmed step by confirmed step",
          ]}
        />
      </div>
    </div>
  )
}
