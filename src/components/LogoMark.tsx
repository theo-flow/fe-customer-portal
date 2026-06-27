interface Props {
  size?: number
  className?: string
}

export function LogoMark({ size = 28, className = '' }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="theoflow"
    >
      {/* Back document */}
      <rect x="33" y="18" width="36" height="46" rx="3"
            stroke="currentColor" strokeWidth="2.2" opacity="0.28"/>
      {/* Mid document */}
      <rect x="29" y="22" width="36" height="46" rx="3"
            stroke="currentColor" strokeWidth="2.2" opacity="0.55"/>
      {/* Front document */}
      <rect x="25" y="26" width="36" height="46" rx="3"
            stroke="currentColor" strokeWidth="2.4"/>
      {/* Document content lines */}
      <line x1="33" y1="39" x2="53" y2="39"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.75"/>
      <line x1="33" y1="47" x2="53" y2="47"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.5"/>
      <line x1="33" y1="55" x2="44" y2="55"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.3"/>
      {/* Flow arrow */}
      <line x1="64" y1="50" x2="75" y2="50"
            stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
      <polyline points="71,45 75,50 71,55"
                stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
