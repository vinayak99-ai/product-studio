from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from datetime import datetime, timezone

from app.jira_models import JiraConnectionMeta, JiraProjectSnapshot

DATA_ROOT = Path.home() / "jira-data" / "connections"


def _connection_dir(connection_id: str) -> Path:
    return DATA_ROOT / connection_id


def _meta_path(connection_id: str) -> Path:
    return _connection_dir(connection_id) / "meta.json"


def _secret_path(connection_id: str) -> Path:
    return _connection_dir(connection_id) / "secret.json"


def _snapshot_path(connection_id: str) -> Path:
    return _connection_dir(connection_id) / "snapshot.json"


def create_connection(
    name: str, base_url: str, email: str, api_token: str, project_key: str
) -> JiraConnectionMeta:
    connection_id = f"jira_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()
    meta = JiraConnectionMeta(
        id=connection_id,
        name=name,
        base_url=base_url,
        email=email,
        project_key=project_key,
        created_at=now,
        updated_at=now,
    )

    _connection_dir(connection_id).mkdir(parents=True, exist_ok=True)
    _meta_path(connection_id).write_text(meta.model_dump_json(indent=2))
    # Kept in its own file, never merged into meta.json, so listing/reading
    # a connection's metadata can never accidentally echo the token back.
    _secret_path(connection_id).write_text(json.dumps({"api_token": api_token}))
    return meta


def list_connections() -> list[JiraConnectionMeta]:
    if not DATA_ROOT.exists():
        return []
    connections = []
    for conn_dir in DATA_ROOT.iterdir():
        meta_file = conn_dir / "meta.json"
        if meta_file.exists():
            connections.append(JiraConnectionMeta.model_validate_json(meta_file.read_text()))
    return sorted(connections, key=lambda c: c.updated_at, reverse=True)


def get_connection(connection_id: str) -> JiraConnectionMeta:
    return JiraConnectionMeta.model_validate_json(_meta_path(connection_id).read_text())


def get_secret(connection_id: str) -> str:
    data = json.loads(_secret_path(connection_id).read_text())
    return data["api_token"]


def rename_connection(connection_id: str, name: str) -> JiraConnectionMeta:
    meta = get_connection(connection_id)
    meta.name = name
    meta.updated_at = datetime.now(timezone.utc).isoformat()
    _meta_path(connection_id).write_text(meta.model_dump_json(indent=2))
    return meta


def delete_connection(connection_id: str) -> None:
    shutil.rmtree(_connection_dir(connection_id), ignore_errors=True)


def save_snapshot(
    connection_id: str, snapshot: JiraProjectSnapshot, truncated: bool
) -> JiraConnectionMeta:
    _snapshot_path(connection_id).write_text(snapshot.model_dump_json(indent=2))

    issue_count = len(snapshot.other_issues) + sum(
        1 + len(e.stories) for e in snapshot.epics
    )
    meta = get_connection(connection_id)
    meta.last_synced_at = snapshot.fetched_at
    meta.issue_count = issue_count
    meta.truncated = truncated
    meta.updated_at = datetime.now(timezone.utc).isoformat()
    _meta_path(connection_id).write_text(meta.model_dump_json(indent=2))
    return meta


def load_snapshot(connection_id: str) -> JiraProjectSnapshot | None:
    path = _snapshot_path(connection_id)
    if not path.exists():
        return None
    return JiraProjectSnapshot.model_validate_json(path.read_text())
