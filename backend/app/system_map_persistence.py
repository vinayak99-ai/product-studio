from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from datetime import datetime, timezone

from app.system_map_models import (
    ArtifactVersionMeta,
    ExtractionDraft,
    MergeCandidate,
    ProjectMeta,
    SourceDocumentMeta,
    SystemMapGraph,
)

# Same file-based-persistence philosophy as every other tool in this
# backend (see deep_analysis_persistence.py). One project = one integration
# map: its source documents, their extraction drafts, pending merge
# candidates, and the confirmed, versioned SystemMapGraph.
DATA_ROOT = Path.home() / "system-map-data" / "projects"


def _project_dir(project_id: str) -> Path:
    return DATA_ROOT / project_id


def create_project(name: str) -> ProjectMeta:
    project_id = f"sysmap_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()
    meta = ProjectMeta(id=project_id, name=name, created_at=now, updated_at=now)

    (_project_dir(project_id) / "documents").mkdir(parents=True, exist_ok=True)
    (_project_dir(project_id) / "extractions").mkdir(parents=True, exist_ok=True)
    (_project_dir(project_id) / "graph").mkdir(parents=True, exist_ok=True)
    (_project_dir(project_id) / "meta.json").write_text(meta.model_dump_json(indent=2), encoding="utf-8")
    return meta


def list_projects() -> list[ProjectMeta]:
    if not DATA_ROOT.exists():
        return []
    projects = []
    for proj_dir in DATA_ROOT.iterdir():
        meta_file = proj_dir / "meta.json"
        if meta_file.exists():
            projects.append(ProjectMeta.model_validate_json(meta_file.read_text(encoding="utf-8")))
    return sorted(projects, key=lambda p: p.updated_at, reverse=True)


def get_project(project_id: str) -> ProjectMeta:
    return ProjectMeta.model_validate_json((_project_dir(project_id) / "meta.json").read_text(encoding="utf-8"))


def rename_project(project_id: str, name: str) -> ProjectMeta:
    meta = get_project(project_id)
    meta.name = name
    meta.updated_at = datetime.now(timezone.utc).isoformat()
    (_project_dir(project_id) / "meta.json").write_text(meta.model_dump_json(indent=2), encoding="utf-8")
    return meta


def delete_project(project_id: str) -> None:
    shutil.rmtree(_project_dir(project_id), ignore_errors=True)


def _touch_project(project_id: str) -> None:
    meta = get_project(project_id)
    meta.updated_at = datetime.now(timezone.utc).isoformat()
    (_project_dir(project_id) / "meta.json").write_text(meta.model_dump_json(indent=2), encoding="utf-8")


# ---------- Source documents ----------
# Raw uploaded content lives here as plain text; extraction results (Phase
# 2) live separately in extractions/, keyed by the same document_id, so a
# document can be re-extracted without touching the stored source text.


def _documents_dir(project_id: str) -> Path:
    return _project_dir(project_id) / "documents"


def _document_meta_path(project_id: str, document_id: str) -> Path:
    return _documents_dir(project_id) / f"{document_id}.json"


def _document_content_path(project_id: str, document_id: str) -> Path:
    return _documents_dir(project_id) / f"{document_id}.txt"


def save_document(project_id: str, filename: str, content: str, kind: str = "raw") -> SourceDocumentMeta:
    document_id = f"doc_{uuid.uuid4().hex[:8]}"
    meta = SourceDocumentMeta(
        id=document_id,
        filename=filename,
        uploaded_at=datetime.now(timezone.utc).isoformat(),
        kind=kind,  # type: ignore[arg-type]
    )
    _documents_dir(project_id).mkdir(parents=True, exist_ok=True)
    _document_meta_path(project_id, document_id).write_text(meta.model_dump_json(indent=2), encoding="utf-8")
    _document_content_path(project_id, document_id).write_text(content, encoding="utf-8")
    _touch_project(project_id)
    return meta


def load_document_content(project_id: str, document_id: str) -> str:
    return _document_content_path(project_id, document_id).read_text(encoding="utf-8")


def load_document_meta(project_id: str, document_id: str) -> SourceDocumentMeta:
    return SourceDocumentMeta.model_validate_json(
        _document_meta_path(project_id, document_id).read_text(encoding="utf-8")
    )


def save_document_meta(project_id: str, meta: SourceDocumentMeta) -> None:
    _document_meta_path(project_id, meta.id).write_text(meta.model_dump_json(indent=2), encoding="utf-8")


def list_documents(project_id: str) -> list[SourceDocumentMeta]:
    docs_dir = _documents_dir(project_id)
    if not docs_dir.exists():
        return []
    metas = [
        SourceDocumentMeta.model_validate_json(f.read_text(encoding="utf-8"))
        for f in docs_dir.glob("*.json")
    ]
    return sorted(metas, key=lambda d: d.uploaded_at)


def delete_document(project_id: str, document_id: str) -> None:
    _document_meta_path(project_id, document_id).unlink(missing_ok=True)
    _document_content_path(project_id, document_id).unlink(missing_ok=True)
    _extraction_path(project_id, document_id).unlink(missing_ok=True)


# ---------- Extraction drafts (Review point 1 -- per document) ----------


def _extractions_dir(project_id: str) -> Path:
    return _project_dir(project_id) / "extractions"


def _extraction_path(project_id: str, document_id: str) -> Path:
    return _extractions_dir(project_id) / f"{document_id}.json"


def save_extraction_draft(project_id: str, draft: ExtractionDraft) -> None:
    _extractions_dir(project_id).mkdir(parents=True, exist_ok=True)
    _extraction_path(project_id, draft.document_id).write_text(draft.model_dump_json(indent=2), encoding="utf-8")


def load_extraction_draft(project_id: str, document_id: str) -> ExtractionDraft | None:
    path = _extraction_path(project_id, document_id)
    if not path.exists():
        return None
    return ExtractionDraft.model_validate_json(path.read_text(encoding="utf-8"))


def list_extraction_drafts(project_id: str) -> list[ExtractionDraft]:
    """Sorted by document_id so assemble_graph_from_drafts's canonical-name
    choice for a merged node (it picks whichever draft's node it processes
    first) is deterministic across calls, not dependent on filesystem
    iteration order."""
    ext_dir = _extractions_dir(project_id)
    if not ext_dir.exists():
        return []
    drafts = [ExtractionDraft.model_validate_json(f.read_text(encoding="utf-8")) for f in ext_dir.glob("*.json")]
    return sorted(drafts, key=lambda d: d.document_id)


def delete_extraction_draft(project_id: str, document_id: str) -> None:
    _extraction_path(project_id, document_id).unlink(missing_ok=True)


# ---------- Merge candidates (Review point 2 -- entity resolution) ----------
# One file per project (not per document): candidates are computed across
# ALL reviewed extraction drafts at once, since the point is catching the
# same real-world system named differently across different documents.


def _merge_candidates_path(project_id: str) -> Path:
    return _project_dir(project_id) / "merge_candidates.json"


def save_merge_candidates(project_id: str, candidates: list[MergeCandidate]) -> None:
    path = _merge_candidates_path(project_id)
    path.write_text(json.dumps([c.model_dump() for c in candidates], indent=2), encoding="utf-8")


def load_merge_candidates(project_id: str) -> list[MergeCandidate]:
    path = _merge_candidates_path(project_id)
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return [MergeCandidate.model_validate(c) for c in data]


# ---------- Confirmed, versioned graph (Review points 3-5) ----------
# Same auto-versioning-on-change, dedupe-identical-saves pattern as every
# other tool's save_artifact -- a version only exists for a save that
# genuinely changed the confirmed graph, and history is never overwritten.


def _graph_path(project_id: str) -> Path:
    return _project_dir(project_id) / "graph" / "graph.json"


def _graph_versions_dir(project_id: str) -> Path:
    return _project_dir(project_id) / "graph" / "versions"


def save_graph(project_id: str, graph: SystemMapGraph, reason: str = "update") -> None:
    graph_dir = _project_dir(project_id) / "graph"
    graph_dir.mkdir(parents=True, exist_ok=True)
    _graph_path(project_id).write_text(graph.model_dump_json(indent=2), encoding="utf-8")

    versions_dir = _graph_versions_dir(project_id)
    versions_dir.mkdir(parents=True, exist_ok=True)
    new_content = graph.model_dump()
    existing = sorted(versions_dir.glob("v*.json"))
    if existing:
        latest = json.loads(existing[-1].read_text(encoding="utf-8"))
        if latest["graph"] == new_content:
            _touch_project(project_id)
            return
        next_version = latest["version"] + 1
    else:
        next_version = 1
    snapshot = {
        "version": next_version,
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "reason": reason,
        "graph": new_content,
    }
    (versions_dir / f"v{next_version:04d}.json").write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
    _touch_project(project_id)


def load_graph(project_id: str) -> SystemMapGraph:
    path = _graph_path(project_id)
    if not path.exists():
        return SystemMapGraph()
    return SystemMapGraph.model_validate_json(path.read_text(encoding="utf-8"))


def list_graph_versions(project_id: str) -> list[ArtifactVersionMeta]:
    versions_dir = _graph_versions_dir(project_id)
    if not versions_dir.exists():
        return []
    metas = []
    for f in sorted(versions_dir.glob("v*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        metas.append(ArtifactVersionMeta(version=data["version"], saved_at=data["saved_at"], reason=data["reason"]))
    return metas


def load_graph_version(project_id: str, version: int) -> SystemMapGraph:
    path = _graph_versions_dir(project_id) / f"v{version:04d}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return SystemMapGraph.model_validate(data["graph"])
