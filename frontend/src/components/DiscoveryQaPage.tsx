import { useState } from 'react'
import { getSession } from '../lib/discoveryQaApi'
import type { DiscoverySessionDetail, DiscoverySessionMeta } from '../discoveryQaTypes'
import { DiscoveryQaSessionList } from './discovery-qa/DiscoveryQaSessionList'
import { DiscoveryQaPrep } from './discovery-qa/DiscoveryQaPrep'
import { DiscoveryQaSession } from './discovery-qa/DiscoveryQaSession'

type View =
  | { name: 'list' }
  | { name: 'prep' }
  | { name: 'session'; detail: DiscoverySessionDetail }

export function DiscoveryQaPage() {
  const [view, setView] = useState<View>({ name: 'list' })

  const openSession = async (session: DiscoverySessionMeta) => {
    const detail = await getSession(session.id)
    setView({ name: 'session', detail })
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-50">
      {view.name === 'list' ? (
        <DiscoveryQaSessionList onSelect={openSession} onNew={() => setView({ name: 'prep' })} />
      ) : null}
      {view.name === 'prep' ? (
        <DiscoveryQaPrep
          onCreated={(detail) => setView({ name: 'session', detail })}
          onCancel={() => setView({ name: 'list' })}
        />
      ) : null}
      {view.name === 'session' ? (
        <DiscoveryQaSession
          detail={view.detail}
          onChange={(detail) => setView({ name: 'session', detail })}
          onBack={() => setView({ name: 'list' })}
        />
      ) : null}
    </div>
  )
}
