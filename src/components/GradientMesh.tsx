// Generalized from the homepage's DocIntakeCard/ExtractionCard/NotificationCard
// pattern (src/app/page.tsx) -- two blurred radial-gradient blobs over a tint,
// with a faint film-grain overlay. Used sparingly (one section, not every
// section) as a deliberate color moment on interior pages that would
// otherwise be flat white/gray.
export function GradientMesh({
  base, colorA, colorB, className = '',
}: {
  base: string
  colorA: string
  colorB: string
  className?: string
}) {
  const id = base.replace(/[^a-zA-Z0-9]/g, '')
  return (
    <div className={`absolute inset-0 ${className}`} style={{ contain: 'paint' }}>
      <div className="absolute inset-0" style={{ background: base }} />
      <div className="absolute rounded-full" style={{
        top: '0', right: '0', width: '75%', height: '85%', transform: 'translate(10%,-12%)',
        background: `radial-gradient(ellipse at 55% 40%, ${colorA} 0%, transparent 70%)`,
        filter: 'blur(60px)', opacity: 0.85,
      }} />
      <div className="absolute rounded-full" style={{
        bottom: '0', left: '0', width: '70%', height: '80%', transform: 'translate(-10%,12%)',
        background: `radial-gradient(ellipse at 42% 60%, ${colorB} 0%, transparent 68%)`,
        filter: 'blur(60px)', opacity: 0.8,
      }} />
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.3, mixBlendMode: 'overlay' }}>
        <filter id={`grain-${id}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.70" numOctaves="4" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain-${id})`} />
      </svg>
    </div>
  )
}
