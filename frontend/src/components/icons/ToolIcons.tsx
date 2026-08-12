import type { SVGProps } from 'react'

export function SpecIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 3.5h6a1 1 0 0 1 1 1V6H8V4.5a1 1 0 0 1 1-1Z" />
      <path d="M8.5 11h7M8.5 14.5h7M8.5 18h4" />
    </svg>
  )
}

export function SequenceIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <rect x="4" y="3" width="6" height="3.5" rx="1" />
      <rect x="14" y="3" width="6" height="3.5" rx="1" />
      <path d="M7 6.5V20M17 6.5V20" strokeDasharray="1.5 2" />
      <path d="M7 10h10M17 10l-3-2.2M17 10l-3 2.2" />
      <path d="M17 15H7M7 15l3-2.2M7 15l3 2.2" />
    </svg>
  )
}

export function InfographicIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path d="M12 12 L12 3.5 A8.5 8.5 0 0 1 20 10.3 Z" />
      <path d="M12 12 L20 10.3 A8.5 8.5 0 0 1 15.5 19.6 Z" />
      <path d="M12 12 L15.5 19.6 A8.5 8.5 0 0 1 6 18.3 Z" />
      <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" opacity="0.15" />
    </svg>
  )
}

export function StoryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <rect x="3" y="5" width="18" height="12" rx="1.5" />
      <path d="M3 9h18" />
      <path d="M10.5 12.1v2.8l2.6-1.4-2.6-1.4Z" fill="currentColor" stroke="none" />
      <path d="M8 20h8" />
    </svg>
  )
}

export function DesignThinkingIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path d="M12 3a6.5 6.5 0 0 0-3.8 11.8c.6.45 1 1.15 1 1.95V17h5.6v-.25c0-.8.4-1.5 1-1.95A6.5 6.5 0 0 0 12 3Z" />
      <path d="M9.5 20h5M10.3 17v1.4a1.2 1.2 0 0 0 1.2 1.2h1a1.2 1.2 0 0 0 1.2-1.2V17" />
      <path d="M12 6.7v3.6M10 8.7l2 1.6 2-1.6" />
    </svg>
  )
}

export function DocQaIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path d="M7 3h6l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M13 3v4h4" />
      <path d="M9 12h3" />
      <path
        d="M9.5 15.3c0-1.27 1.19-2.3 2.65-2.3h1.7c1.46 0 2.65 1.03 2.65 2.3s-1.19 2.3-2.65 2.3h-.3l-1.3 1.15v-1.22c-1.44-.12-2.75-1.13-2.75-2.23Z"
        fill="currentColor"
        fillOpacity="0.12"
      />
    </svg>
  )
}

export function JiraIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8.5 4v16M15.5 4v16" strokeDasharray="1.5 2" />
      <circle cx="8.5" cy="9" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="13" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="9" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function DeepAnalysisIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <circle cx="10.5" cy="10.5" r="3" strokeDasharray="1.3 1.6" />
      <path d="M15.2 15.2 21 21" strokeLinecap="round" />
    </svg>
  )
}

export function DataIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.5" />
      <path d="M4.5 5.5V18c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5V5.5" />
      <path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5" />
    </svg>
  )
}

export function DiagramSlideIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <rect x="2.5" y="4.5" width="19" height="12" rx="1.5" />
      <rect x="5.5" y="7" width="4.5" height="3" rx="0.8" />
      <path d="M10 8.5h3.5" />
      <path d="m17 8.5-2 1.2 2 1.2Z" strokeLinejoin="round" />
      <path d="M9.5 19.5h5" strokeLinecap="round" />
    </svg>
  )
}
