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

// Two plain, always-visible buttons -- a prior dropdown version of this
// (open on click, absolutely positioned) ended up clipped/hidden in some
// layouts, so this trades the extra affordance for something that can't
// fail to render.
export function ExportMenu({ onExportMarkdown, onExportHtml, busy, disabled, variant = 'header' }: ExportMenuProps) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button type="button" onClick={onExportMarkdown} disabled={disabled || busy} className={BUTTON_CLASS[variant]}>
        {busy ? 'Exporting…' : 'Export Markdown'}
      </button>
      <button type="button" onClick={onExportHtml} disabled={disabled || busy} className={BUTTON_CLASS[variant]}>
        {busy ? 'Exporting…' : 'Export HTML'}
      </button>
    </div>
  )
}
