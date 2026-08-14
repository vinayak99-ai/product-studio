import { useState } from 'react'
import type { KbCollectionMeta } from '../../knowledgeBaseTypes'
import { EditableText } from '../infographic/EditableText'

export type KbView = { name: 'search' } | { name: 'goal' } | { name: 'manage'; collectionId: string }

interface KnowledgeBaseSidebarProps {
  collections: KbCollectionMeta[]
  view: KbView
  onSelectSearch: () => void
  onSelectGoal: () => void
  onSelectCollection: (id: string) => void
  onCreate: (name: string) => Promise<void>
  onRename: (id: string, name: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export function KnowledgeBaseSidebar({
  collections,
  view,
  onSelectSearch,
  onSelectGoal,
  onSelectCollection,
  onCreate,
  onRename,
  onDelete,
}: KnowledgeBaseSidebarProps) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try {
      await onCreate(name)
      setNewName('')
      setCreating(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col overflow-y-auto border-r border-neutral-200 bg-white p-3">
      <button
        type="button"
        onClick={onSelectSearch}
        className={`mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors ${
          view.name === 'search' ? 'bg-primary/10 text-primary' : 'text-neutral-700 hover:bg-neutral-100'
        }`}
      >
        🔍 Search across collections
      </button>

      <button
        type="button"
        onClick={onSelectGoal}
        className={`mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors ${
          view.name === 'goal' ? 'bg-primary/10 text-primary' : 'text-neutral-700 hover:bg-neutral-100'
        }`}
      >
        🎯 Goals
      </button>

      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Collections</h2>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="text-xs font-medium text-primary hover:text-primary-dark"
        >
          {creating ? 'Cancel' : '+ New'}
        </button>
      </div>

      {creating ? (
        <div className="mb-2 flex flex-col gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 p-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) handleCreate()
            }}
            placeholder="Collection name"
            className="rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900 outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy || !newName.trim()}
            className="rounded-md bg-primary px-2 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        {collections.map((c) => {
          const isActive = view.name === 'manage' && view.collectionId === c.id
          return (
            <div
              key={c.id}
              className={`group flex cursor-pointer items-start justify-between gap-1 rounded-lg px-3 py-2 transition-colors ${
                isActive ? 'bg-primary/10' : 'hover:bg-neutral-100'
              }`}
              onClick={() => onSelectCollection(c.id)}
            >
              <div className="min-w-0 flex-1">
                <EditableText
                  value={c.name}
                  onCommit={(name) => name.trim() && name !== c.name && onRename(c.id, name.trim())}
                  as="p"
                  className={`truncate text-sm font-medium ${isActive ? 'text-primary' : 'text-neutral-900'}`}
                />
                <p className="text-[11px] text-neutral-500">
                  {c.document_count} doc{c.document_count === 1 ? '' : 's'}
                  {c.is_default_included ? ' · always searched' : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(c.id)
                }}
                aria-label={`Delete ${c.name}`}
                className="shrink-0 rounded p-1 text-neutral-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
