'use client'
import { useRef } from 'react'
import { useAnimationFrame } from 'framer-motion'
import Link from 'next/link'

/* ═══════════════════════════════════════════════════════
   theoflow — Landing Page
═══════════════════════════════════════════════════════ */
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white overflow-x-hidden">
      <Nav />
      <Hero />
      <Ribbon />
      <Logos />
      <Stats />
      <Feature tag="Document intake" flip={false}
        heading="Accept any insurance form, automatically"
        bullets={['PDF, JPG and PNG — motor, life, property, liability',
                  'Auto-detects form type before extraction begins',
                  'Rejects illegible scans before they enter the pipeline']}
        card={<Card id="c1" base="#F5EDD8" warm="#F0B848" cool="#4E82CC"/>}/>
      <Feature tag="Extraction engine" flip={true}
        heading="Extract every field with AI confidence scoring"
        bullets={['AWS Textract reads printed and handwritten text',
                  'Confidence scores surface fields needing human review',
                  'Rules engine validates completeness before filing']}
        card={<Card id="c2" base="#EBF4EE" warm="#5CC8B0" cool="#F0B848"/>}/>
      <Feature tag="Notification pipeline" flip={false}
        heading="Everyone notified the moment it is filed"
        bullets={['Broker gets instant confirmation with document ID',
                  'Client notified via SES — no chasing, no paperwork',
                  'Full POPIA-compliant audit trail in DynamoDB']}
        card={<Card id="c3" base="#F8EFE8" warm="#F08848" cool="#E8C060"/>}/>
      <Steps />
      <CTA />
      <Footer />
    </div>
  )
}

/* ── Nav ──────────────────────────────────────────────────────── */
function Nav() {
  return (
    <nav className="fixed inset-x-0 top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-black/[0.06]">
      <div className="max-w-[1200px] mx-auto px-8 h-[56px] flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <Mark />
          <span className="font-display text-[15px] tracking-tight text-black">theoflow</span>
        </Link>
        <div className="flex items-center gap-1">
          <Link href="/login"
            className="text-[13px] text-gray-500 hover:text-black transition-colors px-4 py-2 rounded-full">
            Sign in
          </Link>
          <Link href="/register"
            className="text-[13px] font-medium bg-black text-white px-5 py-2.5 rounded-full
                       hover:bg-gray-900 transition-colors">
            Try for free
          </Link>
        </div>
      </div>
    </nav>
  )
}

/* ── Hero ─────────────────────────────────────────────────────── */
function Hero() {
  return (
    <section className="pt-[140px] pb-2 text-center px-8">
      <h1 className="font-display text-[clamp(2.8rem,6vw,5.5rem)] leading-[1.05]
                     tracking-[-0.025em] text-black max-w-[860px] mx-auto">
        Document intelligence for every insurance broker
      </h1>
      <p className="mt-6 text-[15px] text-gray-500 max-w-[400px] mx-auto leading-relaxed">
        Upload any insurance form. Our AI classifies, extracts and files it in minutes.
      </p>
      <div className="mt-8 flex items-center justify-center gap-3">
        <Link href="/register"
          className="flex items-center gap-2 bg-black text-white text-[13px] font-medium
                     px-[22px] py-[11px] rounded-full hover:bg-gray-800 transition-colors">
          <Mark size={14} invert />
          Upload a document
        </Link>
        <Link href="/login"
          className="text-[13px] font-medium text-gray-600 px-[22px] py-[11px] rounded-full
                     border border-gray-200 bg-white hover:border-gray-300 transition-colors">
          Sign in
        </Link>
      </div>
    </section>
  )
}

/* ── Ribbon wave — canvas driven by framer-motion useAnimationFrame ── */
function Ribbon() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const t = useRef(0)

  useAnimationFrame(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Sync canvas pixel size to CSS size on every frame (handles resize too)
    const W = canvas.clientWidth
    const H = canvas.clientHeight
    if (!W || !H) return
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width  = W
      canvas.height = H
    }

    ctx.clearRect(0, 0, W, H)

    const band = (phase: number, r: number, g: number, b: number, alpha: number) => {
      const mid  = H * 0.5
      const amp  = H * 0.20                    // wave amplitude
      // half-thickness LARGER than half the canvas so ribbon fills top-to-bottom with no edge
      const half = H * 0.55
      const freq = (Math.PI * 2 * 1.5) / W

      ctx.save()
      // NO ctx.filter here — blur is applied as CSS on the canvas element below
      // That prevents canvas from clipping the blur at pixel 0 and H
      ctx.globalAlpha = alpha
      ctx.beginPath()

      for (let x = 0; x <= W; x += 4) {
        const y = mid + amp * Math.sin(freq * x + phase)
        x === 0 ? ctx.moveTo(x, y - half) : ctx.lineTo(x, y - half)
      }
      for (let x = W; x >= 0; x -= 4) {
        const y = mid + amp * Math.sin(freq * x + phase)
        ctx.lineTo(x, y + half)
      }
      ctx.closePath()
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.fill()
      ctx.restore()
    }

    band(t.current,                  72,  128, 212, 0.88)  // cobalt blue
    band(t.current + Math.PI * 0.52, 238, 180,  62, 0.90)  // amber — in front
    t.current += 0.020
  })

  // CSS blur on the canvas element — does NOT clip at canvas boundaries
  // so the ribbon fades softly into the page above and below (no hard edge)
  return (
    <section className="w-full mt-8" style={{ height: 290, overflow: 'visible' }}>
      <canvas ref={canvasRef} className="block w-full h-full"
              style={{ filter: 'blur(28px)' }}/>
    </section>
  )
}

/* ── Partner logos ────────────────────────────────────────────── */
function Logos() {
  const names = ['Standard Bank', 'Old Mutual', 'Santam', 'Discovery', 'Momentum', 'Hollard']
  return (
    <div className="border-y border-black/[0.06] py-6 mt-1">
      <div className="max-w-[1200px] mx-auto px-8
                      flex items-center justify-between flex-wrap gap-6">
        {names.map(n => (
          <span key={n}
            className="text-[11px] font-extrabold tracking-[0.14em] uppercase text-gray-250"
            style={{ color: '#C8C8C8' }}>
            {n}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ── Stats + testimonial ──────────────────────────────────────── */
function Stats() {
  return (
    <section className="max-w-[1200px] mx-auto px-8 py-28 grid md:grid-cols-2 gap-24 items-center">
      <div className="flex gap-16">
        {[
          { n: '99.2%', d: 'field extraction accuracy across all form types' },
          { n: '<5 min', d: 'average time from upload to filing' },
        ].map(({ n, d }) => (
          <div key={n}>
            <div className="font-display text-[clamp(3rem,5.5vw,5.5rem)] leading-none tracking-tight text-black">
              {n}
            </div>
            <p className="mt-2.5 text-[13px] text-gray-400 leading-snug max-w-[120px]">{d}</p>
          </div>
        ))}
      </div>
      <blockquote>
        <p className="text-[1.05rem] sm:text-[1.15rem] text-gray-700 leading-relaxed">
          "Our claims team used to spend half the day keying data from forms. With theoflow, the document is filed before we've even had our morning coffee."
        </p>
        <footer className="mt-6 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center">
            <span className="text-white text-[10px] font-semibold">TN</span>
          </div>
          <div>
            <div className="text-[13px] font-semibold text-black">Thabo Nkosi</div>
            <div className="text-[12px] text-gray-400">Claims Director · InsureCo SA</div>
          </div>
        </footer>
      </blockquote>
    </section>
  )
}

/* ── Feature row ──────────────────────────────────────────────── */
function Feature({ tag, heading, bullets, flip, card }: {
  tag: string; heading: string; bullets: string[]
  flip: boolean; card: React.ReactNode
}) {
  return (
    <section className={`flex flex-col ${flip ? 'lg:flex-row-reverse' : 'lg:flex-row'}
                         border-t border-black/[0.06]`} style={{ minHeight: 520 }}>
      {/* Text — ~40% */}
      <div className="flex flex-col justify-center
                      px-8 sm:px-12 lg:px-16 py-16 lg:py-24
                      lg:w-[40%] flex-shrink-0">
        <span className="inline-flex self-start text-[11px] font-semibold text-gray-400
                         uppercase tracking-[0.10em] border border-gray-200 rounded-full
                         px-3 py-[5px] mb-7">
          {tag}
        </span>
        <h2 className="font-display text-[clamp(1.7rem,2.8vw,2.5rem)] leading-[1.12]
                       tracking-[-0.015em] text-black mb-9">
          {heading}
        </h2>
        <ul>
          {bullets.map((b, i) => (
            <li key={i} className="border-t border-gray-100 py-4
                                   text-[13.5px] text-gray-500 leading-relaxed">
              {b}
            </li>
          ))}
          <li className="border-t border-gray-100"/>
        </ul>
      </div>

      {/* Art card — fills remaining space, no border, no rounding on outer edges */}
      <div className="relative flex-1" style={{ minHeight: 360 }}>
        {card}
      </div>
    </section>
  )
}

/* ── Gradient art card ────────────────────────────────────────── */
function Card({ id, base, warm, cool }: {
  id: string; base: string; warm: string; cool: string
}) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0" style={{ background: base }}/>
      <div className="blob-one absolute rounded-full" style={{
        top:'-8%', right:'-8%', width:'85%', height:'78%', willChange:'transform',
        background:`radial-gradient(ellipse at 55% 40%, ${warm} 0%, transparent 70%)`,
        filter:'blur(58px)', opacity:0.92,
      }}/>
      <div className="blob-two absolute rounded-full" style={{
        bottom:'-10%', left:'-8%', width:'80%', height:'74%', willChange:'transform',
        background:`radial-gradient(ellipse at 42% 60%, ${cool} 0%, transparent 68%)`,
        filter:'blur(60px)', opacity:0.86,
      }}/>
      <div className="blob-three absolute rounded-full" style={{
        top:'25%', left:'15%', width:'62%', height:'56%', willChange:'transform',
        background:`radial-gradient(ellipse at 50% 50%, #FBEFD4 0%, transparent 74%)`,
        filter:'blur(50px)', opacity:0.72,
      }}/>
      <div className="blob-five absolute rounded-full" style={{
        bottom:'-5%', right:'-4%', width:'58%', height:'52%', willChange:'transform',
        background:`radial-gradient(ellipse at 62% 64%, ${warm} 0%, transparent 68%)`,
        filter:'blur(54px)', opacity:0.78,
      }}/>
      {/* Grain */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none"
           style={{ opacity:0.42, mixBlendMode:'overlay' }}>
        <filter id={id}>
          <feTurbulence type="fractalNoise" baseFrequency="0.70" numOctaves="4" stitchTiles="stitch"/>
          <feColorMatrix type="saturate" values="0"/>
        </filter>
        <rect width="100%" height="100%" filter={`url(#${id})`}/>
      </svg>
    </div>
  )
}

/* ── How it works ─────────────────────────────────────────────── */
function Steps() {
  return (
    <section className="bg-[#F9F8F6] px-8 py-28 border-t border-black/[0.06]">
      <div className="max-w-[1200px] mx-auto grid lg:grid-cols-2 gap-20 items-start">
        <div>
          <h2 className="font-display text-[clamp(2rem,3.5vw,3.2rem)] leading-tight
                         tracking-[-0.02em] text-black mb-16">
            Get started in minutes
          </h2>
          {[
            { n:'1.', t:'Upload any form', b:'Drop a PDF, JPG or PNG. We accept motor, life, property and liability forms from any insurer.' },
            { n:'2.', t:'AI classifies and extracts', b:'Textract reads every field. Our validator checks completeness and flags issues before filing.' },
            { n:'3.', t:'Filed — everyone notified', b:'The record is updated instantly. Broker and client both receive confirmation within seconds.' },
          ].map(s => (
            <div key={s.n} className="border-t border-gray-200 py-8">
              <div className="font-display text-[2rem] text-black">{s.n}</div>
              <div className="font-semibold text-[14px] text-black mt-0.5 mb-2">{s.t}</div>
              <p className="text-[13px] text-gray-500 leading-relaxed max-w-[300px]">{s.b}</p>
            </div>
          ))}
          <div className="border-t border-gray-200 pt-8">
            <Link href="/register"
              className="inline-flex bg-black text-white text-[13px] font-medium
                         px-7 py-3.5 rounded-full hover:bg-gray-900 transition-colors">
              Get started
            </Link>
            <p className="mt-3 text-[12px] text-gray-400">First document ready in minutes.</p>
          </div>
        </div>

        {/* Dark pipeline card */}
        <div className="rounded-2xl overflow-hidden" style={{ background:'#111' }}>
          <div className="px-6 py-4 border-b border-white/[0.07] flex items-center gap-2">
            {[0,1,2].map(i => <div key={i} className="w-2.5 h-2.5 rounded-full bg-white/20"/>)}
            <span className="ml-2 text-[11px] text-white/30 font-mono">
              pipeline · DAI-2026-00142
            </span>
          </div>
          <div className="px-6 py-6 space-y-[14px]">
            {[
              { s:'RECEIVED',   ok:true },
              { s:'CLASSIFIED', ok:true },
              { s:'EXTRACTED',  ok:true },
              { s:'VALIDATED',  ok:true },
              { s:'GENERATED',  ok:true },
              { s:'FILED',      ok:false, active:true },
              { s:'NOTIFIED',   ok:false },
            ].map(({ s, ok, active }) => (
              <div key={s} className="flex items-center gap-3">
                <div className={`w-[18px] h-[18px] rounded-full flex-shrink-0
                                 flex items-center justify-center
                  ${ok     ? 'bg-white'
                  : active ? 'border-2 border-amber-400'
                  :          'border border-white/15'}`}>
                  {ok && <svg className="w-2.5 h-2.5 text-black" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2.5 2.5 3.5-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>}
                  {active && <div className="w-1.5 h-1.5 rounded-full bg-amber-400"/>}
                </div>
                <span className={`text-[11px] font-mono tracking-widest
                  ${ok ? 'text-white/55' : active ? 'text-amber-400' : 'text-white/18'}`}>
                  {s}
                </span>
                {active && <span className="ml-auto text-[10px] text-amber-400/70 animate-pulse">filing…</span>}
              </div>
            ))}
          </div>
          <div className="px-6 pb-5 pt-1">
            <div className="h-[3px] rounded-full bg-white/10">
              <div className="h-full rounded-full bg-white/50 transition-all" style={{ width:'72%' }}/>
            </div>
            <p className="mt-2 text-[11px] text-white/30">72% complete · ~23 s remaining</p>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ── Final CTA ────────────────────────────────────────────────── */
function CTA() {
  return (
    <section className="py-28 px-8 text-center border-t border-black/[0.06]">
      <h2 className="font-display text-[clamp(2.2rem,4vw,4rem)] leading-[1.08]
                     tracking-[-0.02em] text-black max-w-[700px] mx-auto">
        Process your first document in minutes
      </h2>
      <p className="mt-5 text-[14px] text-gray-400 max-w-[340px] mx-auto leading-relaxed">
        No setup. No integrations required to start. Just upload and watch the pipeline run.
      </p>
      <Link href="/register"
        className="mt-9 inline-flex bg-black text-white text-[13px] font-medium
                   px-9 py-4 rounded-full hover:bg-gray-900 transition-colors">
        Get started free
      </Link>
    </section>
  )
}

/* ── Footer ───────────────────────────────────────────────────── */
function Footer() {
  return (
    <footer className="border-t border-black/[0.06] py-7 px-8">
      <div className="max-w-[1200px] mx-auto
                      flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Mark size={18}/>
          <span className="font-display text-[13px] text-black">theoflow</span>
          <span className="text-[11px] text-gray-300 ml-1">© 2026</span>
        </div>
        <div className="flex items-center gap-8 text-[12px] text-gray-400">
          <Link href="/login" className="hover:text-black transition-colors">Sign in</Link>
          <Link href="/register" className="hover:text-black transition-colors">Register</Link>
          <span>POPIA compliant</span>
          <span>Data stays in South Africa</span>
        </div>
      </div>
    </footer>
  )
}

/* ── Shared: logo mark ────────────────────────────────────────── */
function Mark({ size = 26, invert = false }: { size?: number; invert?: boolean }) {
  return (
    <div style={{ width:size, height:size }}
         className={`rounded-md flex items-center justify-center flex-shrink-0
           ${invert ? 'bg-white' : 'bg-black'}`}>
      <svg style={{ width:size*0.52, height:size*0.52 }} viewBox="0 0 16 16" fill="none">
        <path d="M2 4h12M2 8h8M2 12h5" stroke={invert ? 'black' : 'white'}
              strokeWidth="2" strokeLinecap="round"/>
      </svg>
    </div>
  )
}
