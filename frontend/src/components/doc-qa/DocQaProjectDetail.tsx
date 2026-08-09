import { useState } from 'react'
import { ask, renameProject, summarize } from '../../lib/docQaApi'
import type { ChatMessage, DocQaProjectDetail as DocQaProjectDetailType } from '../../docQaTypes'
import { EditableText } from '../infographic/EditableText'
import { GenerateBar } from '../design-thinking/GenerateBar'
import { StageIntroCard } from '../design-thinking/StageIntroCard'

interface DocQaProjectDetailProps {
  detail: DocQaProjectDetailType
  onChange: (detail: DocQaProjectDetailType) => void
  onBack: () => void
}

export function DocQaProjectDetail({ detail, onChange, onBack }: DocQaProjectDetailProps) {
  const { meta, summary, chat } = detail
  const [summaryPrompt, setSummaryPrompt] = useState('')
  const [summaryBusy, setSummaryBusy] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const [question, setQuestion] = useState('')
  const [askBusy, setAskBusy] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)

  const handleRename = async (name: string) => {
    if (!name.trim() || name === meta.name) return
    const updated = await renameProject(meta.id, name.trim())
    onChange({ ...detail, meta: updated })
  }

  const handleSummarize = async () => {
    setSummaryError(null)
    setSummaryBusy(true)
    try {
      const result = await summarize(meta.id, summaryPrompt)
      onChange({ ...detail, summary: result.summary, meta: { ...meta, has_summary: true } })
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSummaryBusy(false)
    }
  }

  const handleAsk = async () => {
    const q = question.trim()
    if (!q) return
    setAskError(null)
    setAskBusy(true)
    try {
      const result = await ask(meta.id, q)
      onChange({ ...detail, chat: result.chat, meta: { ...meta, message_count: result.chat.length } })
      setQuestion('')
    } catch (err) {
      setAskError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setAskBusy(false)
    }
  }

  return (
    <div className="px-6 py-6">
      <div className="mb-4 flex items-center justify-between border-b border-neutral-200 pb-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="text-sm font-medium text-neutral-500 hover:text-neutral-900"
          >
            ← Documents
          </button>
          <div>
            <EditableText
              value={meta.name}
              onCommit={handleRename}
              as="h2"
              className="text-lg font-semibold text-neutral-900"
            />
            <p className="text-xs text-neutral-500">{meta.filename}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">Summary</h2>
          <GenerateBar
            prompt={summaryPrompt}
            onPromptChange={setSummaryPrompt}
            placeholder="Optional focus, e.g. 'Focus on the risks section.'"
            onGenerate={handleSummarize}
            busy={summaryBusy}
            hasResult={!!summary}
            error={summaryError}
          />
          {summary ? (
            <div className="whitespace-pre-wrap rounded-xl border border-neutral-200 bg-white p-4 text-sm leading-relaxed text-neutral-800">
              {summary}
            </div>
          ) : (
            <StageIntroCard
              title="What Summarize produces"
              steps={[
                'A few short paragraphs covering what the document is and its main points',
                'Grounded strictly in the document — no outside knowledge added',
                "Optionally nudge it toward a specific angle, e.g. 'focus on the risks'",
              ]}
            />
          )}
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">Ask questions</h2>

          {chat.length === 0 ? (
            <StageIntroCard
              title="What Q&A produces"
              steps={[
                'Ask anything about the document — a specific fact, a summary of a section, a comparison',
                "Every answer is grounded in the document; it says so if the document doesn't cover it",
                'Follow-up questions use the conversation so far for context',
              ]}
            />
          ) : (
            <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-3">
              {chat.map((message, i) => (
                <ChatBubble key={i} message={message} />
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !askBusy) handleAsk()
              }}
              placeholder="Ask a question about this document…"
              className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={handleAsk}
              disabled={askBusy || !question.trim()}
              className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {askBusy ? 'Thinking…' : 'Ask'}
            </button>
          </div>
          {askError ? <p className="text-xs text-red-600">{askError}</p> : null}
        </div>
      </div>
    </div>
  )
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
          isUser ? 'bg-primary text-white' : 'bg-neutral-100 text-neutral-800'
        }`}
      >
        {message.content}
      </div>
    </div>
  )
}
