interface Props { size?: 'sm' | 'md' | 'lg' }

export function BrandMark({ size = 'md' }: Props) {
  const icon = { sm: 'w-6 h-6', md: 'w-8 h-8', lg: 'w-10 h-10' }[size]
  const text = { sm: 'text-base', md: 'text-lg', lg: 'text-xl' }[size]
  return (
    <div className="inline-flex items-center gap-2.5">
      <div className={`${icon} rounded-lg bg-accent flex items-center justify-center flex-shrink-0`}>
        <svg className="w-3/5 h-3/5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <span className={`font-display ${text} text-white tracking-wide`}>Daai Insure</span>
    </div>
  )
}
