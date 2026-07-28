// Small hand-drawn line-icon set for the interior marketing pages
// (About/Features/Product), matching the stroke weight and rounded-cap style
// already used on the homepage (see DocIntakeCard's dropzone icon in
// src/app/page.tsx). Paired with COLOR_PAIRS below, which reuses the exact
// hex values from the homepage's document-color palette, so these pages
// share one consistent, already-established color language rather than
// inventing a second one.

type IconProps = { className?: string }

function Base({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      {children}
    </svg>
  )
}

export function IntakeIcon({ className }: IconProps) {
  return <Base className={className}>
    <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
  </Base>
}

export function ExtractionIcon({ className }: IconProps) {
  return <Base className={className}>
    <path d="M12 3l1.6 4.9L18.5 9.5l-4.9 1.6L12 16l-1.6-4.9L5.5 9.5l4.9-1.6L12 3z" />
  </Base>
}

export function ValidationIcon({ className }: IconProps) {
  return <Base className={className}>
    <path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6l7-3z" />
    <path d="M9 12.2l2 2 4-4.2" />
  </Base>
}

export function WorkflowIcon({ className }: IconProps) {
  return <Base className={className}>
    <path d="M12 3a5 5 0 00-5 5v3c0 .8-.3 1.5-.9 2.1L5 14.5h14l-1.1-1.4A3 3 0 0117 11V8a5 5 0 00-5-5z" />
    <path d="M10 18a2 2 0 004 0" />
  </Base>
}

export function SecurityIcon({ className }: IconProps) {
  return <Base className={className}>
    <path d="M6 10.5V8a6 6 0 1112 0v2.5" />
    <rect x="5" y="10.5" width="14" height="9.5" rx="1.4" />
  </Base>
}

export function ForgeIcon({ className }: IconProps) {
  return <Base className={className}>
    <path d="M7 3h6l4 4v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z" />
    <path d="M12 11.5v5.5M9.3 14.3h5.4" />
  </Base>
}

export function ChannelIcon({ className }: IconProps) {
  return <Base className={className}>
    <path d="M3.5 11.2L20 3.5l-7.7 16.5-2-7-7-1.8z" />
  </Base>
}

export function HarvestIcon({ className }: IconProps) {
  return <Base className={className}>
    <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M12 3v13.5m0 0l-4.5-4.5m4.5 4.5l4.5-4.5" />
  </Base>
}

export function DecodeIcon({ className }: IconProps) {
  return <Base className={className}>
    <path d="M6 3h7l4 4v13.2a.8.8 0 01-.8.8H6a.8.8 0 01-.8-.8V3.8A.8.8 0 016 3z" />
    <circle cx="9.6" cy="13.2" r="2.3" />
    <path d="M11.3 14.9l2 2" />
  </Base>
}

export function SignIcon({ className }: IconProps) {
  return <Base className={className}>
    <path d="M4 20h4L18.5 9.5a2.1 2.1 0 00-3-3L5 17v3z" />
    <path d="M14.3 7.2l2.5 2.5" />
  </Base>
}

export function PrintIcon({ className }: IconProps) {
  return <Base className={className}>
    <path d="M6.5 9V3.8h11V9" />
    <rect x="3.5" y="9" width="17" height="7.5" rx="1.2" />
    <path d="M6.5 13.7h11v6.5h-11z" />
  </Base>
}

// Reuses the exact hex pairs from the homepage's DocIntakeCard doc-color
// palette (src/app/page.tsx) -- one consistent secondary palette across the
// whole marketing site, not a new one invented per page.
export const COLOR_PAIRS = {
  amber:  { color: '#B45309', bg: '#FEF3C7' },
  green:  { color: '#16A34A', bg: '#DCFCE7' },
  blue:   { color: '#1D4ED8', bg: '#DBEAFE' },
  purple: { color: '#9333EA', bg: '#F3E8FF' },
  teal:   { color: '#0D9488', bg: '#CCFBF1' },
  orange: { color: '#EA580C', bg: '#FFEDD5' },
} as const

export function IconBadge({ Icon, pair, size = 40 }: {
  Icon: (p: IconProps) => React.ReactNode
  pair: typeof COLOR_PAIRS[keyof typeof COLOR_PAIRS]
  size?: number
}) {
  return (
    <div className="rounded-xl flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, background: pair.bg, color: pair.color }}>
      <Icon className="w-[52%] h-[52%]" />
    </div>
  )
}
