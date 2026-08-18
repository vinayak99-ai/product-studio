import type {
  ArtifactVersionMeta,
  BriefAudience,
  ClarifyQuestion,
  DiagramType,
  DiffEntry,
  ExportFormat,
  GeneratedPRD,
  GlossaryTerm,
  JiraExportResponse,
  JiraImportResponse,
  JiraStatus,
  JiraSyncResponse,
  ProjectMeta,
  SpecInput,
  Stakeholder,
  StepEditResponse,
  StepGenerateResponse,
  StepId,
  UpdateAudience,
} from "./types"

// Spec Builder's backend is mounted at /pm on the same Product Studio API process
// (see backend/app/main.py's app.mount("/pm", spec_builder_app)).
export const API_BASE = import.meta.env.VITE_PM_API_BASE ?? "http://localhost:8000/pm"

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`${res.status} ${res.statusText}: ${body}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  listProjects: () => request<ProjectMeta[]>("/projects"),

  createProject: (name: string) =>
    request<ProjectMeta>("/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  getProject: (projectId: string) =>
    request<ProjectMeta>(`/projects/${projectId}`),

  renameProject: (projectId: string, name: string) =>
    request<ProjectMeta>(`/projects/${projectId}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    }),

  deleteProject: (projectId: string) =>
    request<{ status: string }>(`/projects/${projectId}`, {
      method: "DELETE",
    }),

  // ---- Step 1: Overview (raw notes -> extraction -> clarify -> draft) ----
  generateOverview: (projectId: string, rawNotes: string) =>
    request<StepGenerateResponse>(`/projects/${projectId}/steps/overview/generate`, {
      method: "POST",
      body: JSON.stringify({ raw_notes: rawNotes }),
    }),

  submitOverviewClarifications: (projectId: string, answers: Record<string, string>) =>
    request<StepGenerateResponse>(`/projects/${projectId}/steps/overview/clarify`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    }),

  getPendingClarification: (projectId: string) =>
    request<{ questions: ClarifyQuestion[]; step: StepId }>(`/projects/${projectId}/pending-clarification`),

  getGenerationStatus: (projectId: string) =>
    request<{ stage: string | null }>(`/projects/${projectId}/generation-status`),

  getInput: (projectId: string) => request<SpecInput>(`/projects/${projectId}/input`),

  saveInput: (projectId: string, rawNotes: string) =>
    request<SpecInput>(`/projects/${projectId}/input`, {
      method: "PUT",
      body: JSON.stringify({ raw_notes: rawNotes }),
    }),

  // Resets the WHOLE pipeline back to not_started from the project's
  // persisted input (see getInput/saveInput above) -- does not auto-run
  // it; call generateOverview afterward to start drafting again.
  resetPipeline: (projectId: string) =>
    request<ProjectMeta>(`/projects/${projectId}/regenerate`, {
      method: "POST",
    }),

  // ---- Steps 2-4 & 6: Stories, Requirements, Test Cases, Epics ----
  // (Architecture is the one interactive step -- see the dedicated
  // architecture* methods below.)
  generateStep: (projectId: string, step: StepId) =>
    request<GeneratedPRD>(`/projects/${projectId}/steps/${step}/generate`, { method: "POST" }),

  revisitStep: (projectId: string, step: StepId) =>
    request<GeneratedPRD>(`/projects/${projectId}/steps/${step}/revisit`, { method: "POST" }),

  confirmStep: (projectId: string, step: StepId) =>
    request<GeneratedPRD>(`/projects/${projectId}/steps/${step}/confirm`, { method: "POST" }),

  // Only the fields owned by `step` are read from `prd` server-side -- see
  // STEP_FIELDS in backend/app/spec_builder/main.py. Runs a scope check and
  // may cascade downstream steps to "stale"; `cascaded_to` reports which.
  editStep: (projectId: string, step: StepId, prd: GeneratedPRD) =>
    request<StepEditResponse>(`/projects/${projectId}/steps/${step}/edit`, {
      method: "POST",
      body: JSON.stringify({ prd }),
    }),

  // ---- Step 5: Architecture (interactive clarify + finalize) ----
  architectureClarifyStart: (projectId: string) =>
    request<StepGenerateResponse>(`/projects/${projectId}/steps/architecture/clarify/start`, { method: "POST" }),

  architectureClarifyAnswer: (projectId: string, answers: Record<string, string>) =>
    request<StepGenerateResponse>(`/projects/${projectId}/steps/architecture/clarify/answer`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    }),

  architectureFinalize: (projectId: string) =>
    request<StepGenerateResponse>(`/projects/${projectId}/steps/architecture/finalize`, { method: "POST" }),

  // ---- Completeness review (manual, non-blocking) ----
  runCompletenessReview: (projectId: string, artifactId: string) =>
    request<GeneratedPRD>(`/projects/${projectId}/artifacts/${artifactId}/completeness-review`, { method: "POST" }),

  listArtifacts: (projectId: string) =>
    request<{ artifact_ids: string[] }>(`/projects/${projectId}/artifacts`),

  getArtifact: (projectId: string, artifactId: string) =>
    request<GeneratedPRD>(`/projects/${projectId}/artifacts/${artifactId}`),

  // Only for fields NOT owned by any confirmed step -- the server rejects
  // (400) any change to a confirmed step's fields, directing to editStep
  // instead. Safe for briefs/updates/diagrams/stakeholders-adjacent saves.
  updateArtifact: (projectId: string, artifactId: string, prd: GeneratedPRD, reason: "manual save" | "autosave" = "manual save") =>
    request<{ status: string }>(
      `/projects/${projectId}/artifacts/${artifactId}?reason=${encodeURIComponent(reason)}`,
      {
        method: "PUT",
        body: JSON.stringify(prd),
      }
    ),

  deleteArtifact: (projectId: string, artifactId: string) =>
    request<{ status: string }>(`/projects/${projectId}/artifacts/${artifactId}`, {
      method: "DELETE",
    }),

  generateDiagram: (projectId: string, artifactId: string, diagramType: DiagramType) =>
    request<GeneratedPRD>(`/projects/${projectId}/artifacts/${artifactId}/diagrams`, {
      method: "POST",
      body: JSON.stringify({ diagram_type: diagramType }),
    }),

  setDiagramPng: (projectId: string, artifactId: string, diagramType: DiagramType, pngBase64: string) =>
    request<GeneratedPRD>(`/projects/${projectId}/artifacts/${artifactId}/diagrams/${diagramType}/png`, {
      method: "PUT",
      body: JSON.stringify({ png_base64: pngBase64 }),
    }),

  getJiraStatus: () => request<JiraStatus>("/jira/status"),

  pushToJira: (projectId: string, artifactId: string) =>
    request<JiraExportResponse>(`/projects/${projectId}/artifacts/${artifactId}/jira-export`, {
      method: "POST",
    }),

  importFromJira: (projectId: string, artifactId: string) =>
    request<JiraImportResponse>(`/projects/${projectId}/artifacts/${artifactId}/jira-import`, {
      method: "POST",
    }),

  syncJiraStatus: (projectId: string, artifactId: string) =>
    request<JiraSyncResponse>(`/projects/${projectId}/artifacts/${artifactId}/jira-sync`, {
      method: "POST",
    }),

  getStakeholders: (projectId: string) =>
    request<{ stakeholders: Stakeholder[] }>(`/projects/${projectId}/stakeholders`),

  saveStakeholders: (projectId: string, stakeholders: Stakeholder[]) =>
    request<{ stakeholders: Stakeholder[] }>(`/projects/${projectId}/stakeholders`, {
      method: "PUT",
      body: JSON.stringify({ stakeholders }),
    }),

  getGlossary: (projectId: string) =>
    request<{ terms: GlossaryTerm[] }>(`/projects/${projectId}/glossary`),

  saveGlossary: (projectId: string, terms: GlossaryTerm[]) =>
    request<{ terms: GlossaryTerm[] }>(`/projects/${projectId}/glossary`, {
      method: "PUT",
      body: JSON.stringify({ terms }),
    }),

  generateBrief: (projectId: string, artifactId: string, audience: BriefAudience) =>
    request<GeneratedPRD>(`/projects/${projectId}/artifacts/${artifactId}/briefs`, {
      method: "POST",
      body: JSON.stringify({ audience }),
    }),

  briefExportUrl: (projectId: string, artifactId: string, audience: BriefAudience, format: "md" | "docx") =>
    `${API_BASE}/projects/${projectId}/artifacts/${artifactId}/briefs/${audience}/export/${format}`,

  listVersions: (projectId: string, artifactId: string) =>
    request<{ versions: ArtifactVersionMeta[] }>(`/projects/${projectId}/artifacts/${artifactId}/versions`),

  getDiff: (projectId: string, artifactId: string, fromVersion: number) =>
    request<{ from_version: number; to_version: number | null; entries: DiffEntry[] }>(
      `/projects/${projectId}/artifacts/${artifactId}/diff?from_version=${fromVersion}`
    ),

  composeUpdate: (projectId: string, artifactId: string, fromVersion: number, audience: UpdateAudience) =>
    request<GeneratedPRD>(`/projects/${projectId}/artifacts/${artifactId}/updates`, {
      method: "POST",
      body: JSON.stringify({ from_version: fromVersion, audience }),
    }),

  updateExportUrl: (projectId: string, artifactId: string, updateId: string, format: "md" | "docx") =>
    `${API_BASE}/projects/${projectId}/artifacts/${artifactId}/updates/${updateId}/export/${format}`,

  exportUrl: (projectId: string, artifactId: string, format: ExportFormat) =>
    `${API_BASE}/projects/${projectId}/artifacts/${artifactId}/export/${format}`,
}
