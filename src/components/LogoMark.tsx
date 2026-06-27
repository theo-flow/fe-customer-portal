interface Props {
  size?: number
  className?: string
}

export function LogoMark({ size, className = '' }: Props) {
  return (
    <svg
      width={size ?? '100%'}
      height={size ?? '100%'}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="theoflow"
    >
      {/* Back document — dashed, very faded (depth) */}
      <rect x="37" y="14" width="28" height="46" rx="1.5"
            stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 2.5" opacity="0.2"/>
      {/* Mid document */}
      <rect x="33" y="18" width="28" height="46" rx="1.5"
            stroke="currentColor" strokeWidth="1.8" opacity="0.45"/>
      {/* Front document — heavy border */}
      <rect x="29" y="22" width="28" height="46" rx="1.5"
            stroke="currentColor" strokeWidth="3.2"/>
      {/* Form header rule — thick bar across top of front doc */}
      <line x1="29" y1="33" x2="57" y2="33"
            stroke="currentColor" strokeWidth="3.2"/>
      {/* Content lines — thick/thin contrast like old typeset text */}
      <line x1="34" y1="41" x2="53" y2="41"
            stroke="currentColor" strokeWidth="2.2" strokeLinecap="square"/>
      <line x1="34" y1="49" x2="53" y2="49"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" opacity="0.6"/>
      <line x1="34" y1="57" x2="46" y2="57"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" opacity="0.35"/>
      {/* Flow arrow — solid filled head, engraving weight */}
      <line x1="61" y1="46" x2="73" y2="46"
            stroke="currentColor" strokeWidth="2.8" strokeLinecap="square"/>
      <polygon points="69,40 77,46 69,52" fill="currentColor"/>
    </svg>
  )
}
