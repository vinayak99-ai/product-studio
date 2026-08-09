import { useEffect, useRef, useState } from 'react'

interface ExportMenuProps {
  onExportMarkdown: () => void
  onExportHtml: () => void
  busy: boolean
  disabled: boolean
  // 'header' matches the outlined buttons in StageHeader; 'primary' matches
  // the filled call-to-action button TestStage already uses for its export.
  variant?: 'header' | 'primary'
}

const BUTTON_CLASS: Record<'header' | 'primary', string> = {
  header:
    'rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50',
  primary:
    'rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60',
}

// One export dropdown reused wherever Design Thinking offers to hand off
// the session -- same idea as Spec Builder's ExportMenu, in this module's
// own plain-Tailwind vocabulary instead of shadcn.
export function ExportMenu({ onExportMarkdown, onExportHtml, busy, disabled, variant = 'header' }: ExportMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || busy}
        className={BUTTON_CLASS[variant]}
      >
        {busy ? 'Exporting…' : 'Export ▾'}
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-neutral-200 bg-white p-1 shadow-md">
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onExportMarkdown()
            }}
            className="block w-full rounded px-2.5 py-2 text-left text-xs text-neutral-700 hover:bg-neutral-100"
          >
            <span className="font-medium text-neutral-900">Markdown (.md)</span>
            <span className="block text-[11px] text-neutral-500">For uploading into Spec Builder</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onExportHtml()
            }}
            className="block w-full rounded px-2.5 py-2 text-left text-xs text-neutral-700 hover:bg-neutral-100"
          >
            <span className="font-medium text-neutral-900">HTML (.html)</span>
            <span className="block text-[11px] text-neutral-500">Open it and paste into Confluence</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
