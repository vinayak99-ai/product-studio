import { useState } from 'react'
import { getConnection } from '../lib/jiraApi'
import type { JiraConnectionDetail as JiraConnectionDetailType, JiraConnectionMeta } from '../jiraTypes'
import { JiraConnectionList } from './jira/JiraConnectionList'
import { JiraNewConnection } from './jira/JiraNewConnection'
import { JiraConnectionDetail } from './jira/JiraConnectionDetail'

type View =
  | { name: 'list' }
  | { name: 'new' }
  | { name: 'detail'; detail: JiraConnectionDetailType }

export function JiraPage() {
  const [view, setView] = useState<View>({ name: 'list' })

  const openConnection = async (connection: JiraConnectionMeta) => {
    const detail = await getConnection(connection.id)
    setView({ name: 'detail', detail })
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-50">
      {view.name === 'list' ? (
        <JiraConnectionList onSelect={openConnection} onNew={() => setView({ name: 'new' })} />
      ) : null}
      {view.name === 'new' ? (
        <JiraNewConnection
          onCreated={(meta) => openConnection(meta)}
          onCancel={() => setView({ name: 'list' })}
        />
      ) : null}
      {view.name === 'detail' ? (
        <JiraConnectionDetail
          detail={view.detail}
          onChange={(detail) => setView({ name: 'detail', detail })}
          onBack={() => setView({ name: 'list' })}
        />
      ) : null}
    </div>
  )
}
