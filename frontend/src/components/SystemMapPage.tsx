import { useState } from 'react'
import { SystemMapProjectList } from './system-map/SystemMapProjectList'
import { SystemMapProject } from './system-map/SystemMapProject'

export function SystemMapPage() {
  const [projectId, setProjectId] = useState<string | null>(null)

  return (
    <div className="flex h-full min-h-0 flex-1 bg-neutral-50">
      {projectId ? (
        <SystemMapProject projectId={projectId} onBack={() => setProjectId(null)} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SystemMapProjectList onSelect={setProjectId} />
        </div>
      )}
    </div>
  )
}
