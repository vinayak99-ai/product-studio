import { useState } from 'react'
import { createConnection, testConnection } from '../../lib/jiraApi'
import type { JiraConnectionMeta } from '../../jiraTypes'
import { StageIntroCard } from '../design-thinking/StageIntroCard'

interface JiraNewConnectionProps {
  onCreated: (connection: JiraConnectionMeta) => void
  onCancel: () => void
}

type TestStatus = 'idle' | 'testing' | 'ok' | 'failed'

export function JiraNewConnection({ onCreated, onCancel }: JiraNewConnectionProps) {
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [email, setEmail] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [projectKey, setProjectKey] = useState('')

  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testError, setTestError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fieldsFilled = name.trim() && baseUrl.trim() && email.trim() && apiToken.trim() && projectKey.trim()

  const resetTest = () => {
    if (testStatus !== 'idle') setTestStatus('idle')
  }

  const handleTest = async () => {
    if (!fieldsFilled) return
    setTestStatus('testing')
    setTestError(null)
    try {
      await testConnection({ name, base_url: baseUrl, email, api_token: apiToken, project_key: projectKey })
      setTestStatus('ok')
    } catch (err) {
      setTestStatus('failed')
      setTestError(err instanceof Error ? err.message : 'Could not connect.')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (testStatus !== 'ok' || busy) return
    setBusy(true)
    setError(null)
    try {
      const connection = await createConnection({
        name,
        base_url: baseUrl,
        email,
        api_token: apiToken,
        project_key: projectKey,
      })
      onCreated(connection)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-6 py-6">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900">Connect a Jira project</h1>

      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-bold text-neutral-900">Connection details</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Uses an API token, not your Jira password —{' '}
          <a
            href="https://id.atlassian.com/manage-profile/security/api-tokens"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            generate one here
          </a>
          .
        </p>

        <form className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="jira-name" className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
              Connection name
            </label>
            <input
              id="jira-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                resetTest()
              }}
              placeholder="Platform Team — PROJ"
              className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="jira-base-url" className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
                Jira site URL
              </label>
              <input
                id="jira-base-url"
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value)
                  resetTest()
                }}
                placeholder="https://yourcompany.atlassian.net"
                className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="jira-project-key" className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
                Project key
              </label>
              <input
                id="jira-project-key"
                value={projectKey}
                onChange={(e) => {
                  setProjectKey(e.target.value.toUpperCase())
                  resetTest()
                }}
                placeholder="PROJ"
                className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="jira-email" className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
                Email
              </label>
              <input
                id="jira-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  resetTest()
                }}
                placeholder="you@company.com"
                className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="jira-token" className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
                API token
              </label>
              <input
                id="jira-token"
                type="password"
                value={apiToken}
                onChange={(e) => {
                  setApiToken(e.target.value)
                  resetTest()
                }}
                placeholder="••••••••••••"
                className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleTest}
              disabled={!fieldsFilled || testStatus === 'testing'}
              className="rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {testStatus === 'testing' ? 'Testing…' : 'Test connection'}
            </button>
            {testStatus === 'ok' ? (
              <span className="text-sm font-medium text-primary-dark">✓ Connected — ready to save</span>
            ) : null}
            {testStatus === 'failed' ? <span className="text-sm text-red-600">{testError}</span> : null}
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={testStatus !== 'ok' || busy}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </form>
      </div>

      <div className="mt-4">
        <StageIntroCard
          title="What happens next"
          steps={[
            'Pull the project — every epic, story, task, and bug, with status, assignee, priority, and more',
            'Browse it right here, refresh any time',
            'Optionally attach it to a Spec Builder project to enrich its epics and stories',
          ]}
        />
      </div>
    </div>
  )
}
