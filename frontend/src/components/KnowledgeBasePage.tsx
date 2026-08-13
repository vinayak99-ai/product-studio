import { useEffect, useState } from 'react'
import {
  createCollection,
  deleteCollection,
  getCollection,
  listCollections,
  renameCollection,
} from '../lib/knowledgeBaseApi'
import type { KbCollectionDetail, KbCollectionMeta } from '../knowledgeBaseTypes'
import { KnowledgeBaseSidebar, type KbView } from './knowledge-base/KnowledgeBaseSidebar'
import { KbCollectionManage } from './knowledge-base/KbCollectionManage'
import { KbSearchPanel } from './knowledge-base/KbSearchPanel'

export function KnowledgeBasePage() {
  const [collections, setCollections] = useState<KbCollectionMeta[]>([])
  const [collectionsLoaded, setCollectionsLoaded] = useState(false)
  const [view, setView] = useState<KbView>({ name: 'search' })
  const [detail, setDetail] = useState<KbCollectionDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refreshCollections = () =>
    listCollections()
      .then((list) => {
        setCollections(list)
        setCollectionsLoaded(true)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load collections.'))

  useEffect(() => {
    refreshCollections()
  }, [])

  // Keyed on a counter, not just `view`, so the Retry button can force a
  // re-fetch even when the user hasn't navigated away and back.
  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    if (view.name === 'manage') {
      setDetail(null)
      setDetailError(null)
      getCollection(view.collectionId)
        .then(setDetail)
        .catch((err) => setDetailError(err instanceof Error ? err.message : 'Failed to load collection.'))
    } else {
      setDetail(null)
      setDetailError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, retryTick])

  const handleCreate = async (name: string) => {
    const created = await createCollection(name)
    await refreshCollections()
    setView({ name: 'manage', collectionId: created.id })
  }

  const handleRename = async (id: string, name: string) => {
    await renameCollection(id, name)
    await refreshCollections()
  }

  const handleDelete = async (id: string) => {
    await deleteCollection(id)
    await refreshCollections()
    if (view.name === 'manage' && view.collectionId === id) {
      setView({ name: 'search' })
    }
  }

  const handleDetailChange = (updated: KbCollectionDetail) => {
    setDetail(updated)
    setCollections((prev) => prev.map((c) => (c.id === updated.meta.id ? updated.meta : c)))
  }

  return (
    <div className="flex h-full min-h-0 flex-1">
      <KnowledgeBaseSidebar
        collections={collections}
        view={view}
        onSelectSearch={() => setView({ name: 'search' })}
        onSelectCollection={(id) => setView({ name: 'manage', collectionId: id })}
        onCreate={handleCreate}
        onRename={handleRename}
        onDelete={handleDelete}
      />
      <div className="min-h-0 flex-1 bg-neutral-50">
        {error ? <p className="p-4 text-sm text-red-600">{error}</p> : null}
        {view.name === 'search' ? (
          // Gated on collectionsLoaded, not just an empty-array check --
          // KbSearchPanel's default-included pre-check is computed once at
          // mount (see its useState initializer), so it must not mount
          // until `collections` holds the real fetched list, or the
          // pre-check silently never applies.
          collectionsLoaded ? (
            <KbSearchPanel
              collections={collections}
              onOpenDocument={(collectionId) => setView({ name: 'manage', collectionId })}
            />
          ) : (
            <p className="p-6 text-sm text-neutral-500">Loading…</p>
          )
        ) : detail ? (
          <KbCollectionManage detail={detail} onChange={handleDetailChange} />
        ) : detailError ? (
          <div className="p-6">
            <p className="text-sm text-red-600">{detailError}</p>
            <button
              type="button"
              onClick={() => setRetryTick((t) => t + 1)}
              className="mt-3 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:border-primary hover:text-primary"
            >
              Retry
            </button>
          </div>
        ) : (
          <p className="p-6 text-sm text-neutral-500">Loading…</p>
        )}
      </div>
    </div>
  )
}
