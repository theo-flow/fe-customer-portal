'use client'
import { useRef } from 'react'
import { useAnimationFrame } from 'framer-motion'
import Link from 'next/link'
import { LogoMark } from '@/components/LogoMark'

/* ── Document Intake card ─────────────────────────────────────── */
function DocIntakeCard() {
  const docs = [
    { name: 'medical_record.pdf',    label: 'Medical Record',       color: '#16A34A', bg: '#DCFCE7' },
    { name: 'loan_application.pdf',  label: 'Financial Application', color: '#1D4ED8', bg: '#DBEAFE' },
    { name: 'gov_form_J88.png',      label: 'Government Form',      color: '#9333EA', bg: '#F3E8FF' },
    { name: 'legal_agreement.pdf',   label: 'Legal Agreement',      color: '#B45309', bg: '#FEF3C7' },
  ]
  return (
    /* contain:paint is the cross-browser fix — it creates a hard paint boundary
       that clips filter:blur() even where overflow:hidden fails */
    <div className="absolute inset-0" style={{ contain: 'paint' }}>
      <div className="absolute inset-0" style={{ background: '#F5EDD8' }}/>
      <div className="absolute rounded-full" style={{ top:'0', right:'0', width:'85%', height:'78%', transform:'translate(8%,-8%)', background:'radial-gradient(ellipse at 55% 40%, #F0B848 0%, transparent 70%)', filter:'blur(58px)', opacity:0.92 }}/>
      <div className="absolute rounded-full" style={{ bottom:'0', left:'0', width:'80%', height:'74%', transform:'translate(-8%,10%)', background:'radial-gradient(ellipse at 42% 60%, #4E82CC 0%, transparent 68%)', filter:'blur(60px)', opacity:0.86 }}/>
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity:0.38, mixBlendMode:'overlay' }}>
        <filter id="g-c1"><feTurbulence type="fractalNoise" baseFrequency="0.70" numOctaves="4" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
        <rect width="100%" height="100%" filter="url(#g-c1)"/>
      </svg>
      {/* UI card */}
      <div className="absolute inset-0 flex items-center justify-center p-8 sm:p-12">
        <div className="w-full max-w-[340px] rounded-2xl overflow-hidden shadow-2xl bg-white">
          {/* Header */}
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400"/>
            <span className="text-[11px] font-mono text-gray-400 tracking-wider">intake · accepting documents</span>
          </div>
          {/* Drop zone */}
          <div className="px-5 pt-5">
            <div className="border-2 border-dashed border-gray-200 rounded-xl py-5 text-center">
              <svg className="w-8 h-8 mx-auto mb-2 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
              </svg>
              <p className="text-[12px] font-medium text-gray-600">Drop any document here</p>
              <div className="flex gap-1.5 justify-center mt-2.5">
                {['PDF','JPG','PNG'].map(t => (
                  <span key={t} className="px-2 py-0.5 rounded text-[9px] font-bold tracking-wider bg-gray-100 text-gray-500">{t}</span>
                ))}
              </div>
            </div>
          </div>
          {/* Document list */}
          <div className="px-5 pt-3 pb-5 space-y-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Recently accepted</p>
            {docs.map(d => (
              <div key={d.name} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-50">
                <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center"
                     style={{ background: d.bg }}>
                  <span className="text-[8px] font-bold" style={{ color: d.color }}>
                    {d.name.split('.').pop()?.toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-gray-700 truncate">{d.name}</p>
                </div>
                <span className="flex-shrink-0 text-[9px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                      style={{ background: d.bg, color: d.color }}>
                  {d.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Extraction Engine card ───────────────────────────────────── */
function ExtractionCard() {
  const fields = [
    { label: 'Full Name',   value: 'Sipho Dlamini',    conf: 99 },
    { label: 'Reference',   value: 'POL-2026-••••••',   conf: 98 },
    { label: 'Date',        value: '2026-06-27',        conf: 96 },
    { label: 'Org Unit',    value: 'Claims · Branch 4',  conf: 94 },
    { label: 'Amount (R)',  value: '48 500.00',          conf: 87 },
  ]
  return (
    <div className="absolute inset-0" style={{ contain: 'paint' }}>
      <div className="absolute inset-0" style={{ background: '#EBF4EE' }}/>
      <div className="absolute rounded-full" style={{ top:'0', right:'0', width:'85%', height:'78%', transform:'translate(8%,-8%)', background:'radial-gradient(ellipse at 55% 40%, #5CC8B0 0%, transparent 70%)', filter:'blur(58px)', opacity:0.92 }}/>
      <div className="absolute rounded-full" style={{ bottom:'0', left:'0', width:'80%', height:'74%', transform:'translate(-8%,10%)', background:'radial-gradient(ellipse at 42% 60%, #F0B848 0%, transparent 68%)', filter:'blur(60px)', opacity:0.86 }}/>
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity:0.38, mixBlendMode:'overlay' }}>
        <filter id="g-c2"><feTurbulence type="fractalNoise" baseFrequency="0.70" numOctaves="4" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
        <rect width="100%" height="100%" filter="url(#g-c2)"/>
      </svg>
      {/* UI card */}
      <div className="absolute inset-0 flex items-center justify-center p-8 sm:p-12">
        <div className="w-full max-w-[340px] rounded-2xl overflow-hidden shadow-2xl"
             style={{ background: '#111' }}>
          <div className="px-5 py-3.5 border-b border-white/[0.07] flex items-center justify-between">
            <div className="flex items-center gap-2">
              {[0,1,2].map(i => <div key={i} className="w-2 h-2 rounded-full bg-white/20"/>)}
            </div>
            <span className="text-[10px] font-mono text-white/30 tracking-wider">extraction · 5 fields</span>
          </div>
          <div className="px-5 py-4 space-y-2.5">
            {fields.map(f => (
              <div key={f.label}>
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-[10px] text-white/40 font-mono tracking-wider uppercase">{f.label}</span>
                  <span className="text-[10px] font-semibold" style={{ color: f.conf >= 95 ? '#4ADE80' : f.conf >= 90 ? '#FCD34D' : '#FB923C' }}>
                    {f.conf}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-white font-medium flex-1">{f.value}</span>
                  <div className="w-16 h-[3px] rounded-full bg-white/10 flex-shrink-0">
                    <div className="h-full rounded-full transition-all"
                         style={{ width: `${f.conf}%`, background: f.conf >= 95 ? '#4ADE80' : f.conf >= 90 ? '#FCD34D' : '#FB923C' }}/>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="px-5 pb-4 pt-1 border-t border-white/[0.06]">
            <p className="text-[10px] text-white/25 font-mono">avg confidence · 94.8% · ready to validate</p>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Notification card ────────────────────────────────────────── */
function NotificationCard() {
  return (
    <div className="absolute inset-0" style={{ contain: 'paint' }}>
      <div className="absolute inset-0" style={{ background: '#F8EFE8' }}/>
      <div className="absolute rounded-full" style={{ top:'0', right:'0', width:'85%', height:'78%', transform:'translate(8%,-8%)', background:'radial-gradient(ellipse at 55% 40%, #F08848 0%, transparent 70%)', filter:'blur(58px)', opacity:0.92 }}/>
      <div className="absolute rounded-full" style={{ bottom:'0', left:'0', width:'80%', height:'74%', transform:'translate(-8%,10%)', background:'radial-gradient(ellipse at 42% 60%, #E8C060 0%, transparent 68%)', filter:'blur(60px)', opacity:0.86 }}/>
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity:0.38, mixBlendMode:'overlay' }}>
        <filter id="g-c3"><feTurbulence type="fractalNoise" baseFrequency="0.70" numOctaves="4" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
        <rect width="100%" height="100%" filter="url(#g-c3)"/>
      </svg>
      {/* UI card */}
      <div className="absolute inset-0 flex items-center justify-center p-8 sm:p-12">
        <div className="w-full max-w-[340px] space-y-3">
          {[
            { role: 'Submitter', initials: 'SM', email: 'sipho@orgname.co.za',   msg: 'Your document TF-2026-00142 has been filed successfully.', time: 'now', color: '#1D4ED8', bg: '#DBEAFE' },
            { role: 'Reviewer',  initials: 'TN', email: 'thabo@orgname.co.za',  msg: 'New submission ready for review — TF-2026-00142.',         time: '0s',  color: '#16A34A', bg: '#DCFCE7' },
          ].map(n => (
            <div key={n.role} className="rounded-2xl overflow-hidden shadow-xl bg-white">
              <div className="px-4 py-2.5 flex items-center gap-2 border-b border-gray-100">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                     style={{ background: n.bg, color: n.color }}>{n.initials}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-gray-700">{n.role}</p>
                  <p className="text-[9px] text-gray-400 truncate">{n.email}</p>
                </div>
                <span className="flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                      style={{ background: n.bg, color: n.color }}>✓ Sent</span>
              </div>
              <div className="px-4 py-3">
                <div className="flex items-start gap-2">
                  <div className="w-4 h-4 rounded-full flex-shrink-0 mt-0.5 flex items-center justify-center"
                       style={{ background: n.bg }}>
                    <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5l2 2 4-3.5" stroke={n.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <p className="text-[12px] text-gray-600 leading-relaxed">{n.msg}</p>
                </div>
                <p className="mt-2 text-[9px] text-gray-400 font-mono">Ref: TF-2026-00142 · {n.time}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════
   theoflow — Landing Page
═══════════════════════════════════════════════════════ */
export default function LandingPage() {
  return (
    <div className="bg-white overflow-x-hidden w-full">
      <Nav />

      {/* ── Above-the-fold: locked to exactly one viewport ── */}
      <div
        className="flex flex-col overflow-hidden"
        style={{ height: '100vh', minHeight: '500px' }}
      >
        {/* nav spacer — matches fixed nav height */}
        <div className="flex-none h-[56px]"/>
        {/* hero fills remaining space, centers content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <Hero />
          <Ribbon />
          <Logos />
        </div>
      </div>
      <Stats />
      <Feature tag="Document intake" flip={false}
        heading="Accept any form, from any sector"
        bullets={['PDF, JPG and PNG — financial applications, medical records, government forms, legal agreements',
                  'Auto-detects document type before extraction begins',
                  'Rejects illegible scans before they enter the pipeline']}
        card={<DocIntakeCard/>}/>
      <Feature tag="Extraction engine" flip={true}
        heading="Extract every field with AI confidence scoring"
        bullets={['Our extraction engine reads printed and handwritten text across all document types',
                  'Confidence scores surface fields needing human review',
                  'Rules engine validates completeness before filing']}
        card={<ExtractionCard/>}/>
      <Feature tag="Notification pipeline" flip={false}
        heading="Everyone notified the moment it is filed"
        bullets={['Submitter receives instant confirmation with a unique document reference',
                  'Reviewer notified via email — no chasing, no manual follow-up',
                  'Full POPIA-compliant audit trail stored in DynamoDB']}
        card={<NotificationCard/>}/>
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
        <Link href="/" className="flex items-center gap-3">
          <Mark size={36}/>
          <span className="font-display text-[22px] tracking-tight text-black">theoflow</span>
        </Link>
        <div className="flex items-center gap-1">
          <Link href="/login"
            className="text-[13px] text-gray-500 hover:text-black transition-colors px-4 py-2 rounded-full">
            Sign in
          </Link>
          <Link href="/register"
            className="text-[13px] font-medium bg-black text-white px-5 py-2.5 rounded-full
                       hover:bg-gray-900 transition-colors">
            Get started
          </Link>
        </div>
      </div>
    </nav>
  )
}

/* ── Hero ─────────────────────────────────────────────────────── */
function Hero() {
  return (
    <section className="flex-1 flex flex-col items-center justify-center
                        text-center px-4 sm:px-8 py-6 min-h-0">
      <h1 className="font-display text-[clamp(1.9rem,4.5vw,3.8rem)] leading-[1.06]
                     tracking-[-0.02em] text-black max-w-[700px] mx-auto">
        Document intelligence for every organisation
      </h1>
      <p className="mt-3 sm:mt-4 text-[13px] sm:text-[15px] text-gray-500
                    max-w-[380px] mx-auto leading-relaxed">
        Any sector. Any form. Upload a document and our pipeline classifies, extracts, validates and files it — without a single manual step.
      </p>
      <div className="mt-5 flex items-center justify-center gap-3 flex-wrap">
        <Link href="/register"
          className="flex items-center gap-2 bg-black text-white text-[13px] font-medium
                     px-5 py-2.5 rounded-full hover:bg-gray-800 transition-colors">
          <LogoMark size={15} className="text-white"/>
          Upload a document
        </Link>
        <Link href="/login"
          className="text-[13px] font-medium text-gray-600 px-5 py-2.5 rounded-full
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
      const amp  = H * 0.20
      const half = H * 0.55
      const freq = (Math.PI * 2 * 1.5) / W

      ctx.save()
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

  return (
    <section className="w-full mt-8" style={{ height: 290, overflow: 'visible' }}>
      <canvas ref={canvasRef} className="block w-full h-full"
              style={{ filter: 'blur(28px)' }}/>
    </section>
  )
}

/* ── Partner logos ────────────────────────────────────────────── */
function Logos() {
  const sectors = ['Insurance', 'Banking', 'Healthcare', 'Government', 'Manufacturing', 'Retail', 'Education', 'Legal', 'Agriculture', 'Real Estate', 'ICT', 'Hospitality']
  return (
    <div className="flex-none border-t border-black/[0.06] py-4">
      <div className="flex flex-col gap-2.5 px-4 sm:px-8">
        <p className="text-[9px] font-semibold tracking-[0.20em] uppercase text-center text-gray-400">
          Trusted across every sector
        </p>
        {/* On mobile: horizontal scroll so all items stay on one line */}
        <div className="flex items-center gap-5 sm:gap-6
                        overflow-x-auto sm:overflow-x-visible
                        sm:flex-wrap sm:justify-center
                        scrollbar-none pb-0.5"
             style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {sectors.map(n => (
            <span key={n}
              className="flex-none text-[10px] sm:text-[11px] font-bold tracking-[0.10em] uppercase text-gray-700 whitespace-nowrap">
              {n}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Stats + testimonial ──────────────────────────────────────── */
function Stats() {
  return (
    <section className="max-w-[1200px] mx-auto px-8 py-12 grid md:grid-cols-2 gap-12 items-center">
      <div className="flex gap-8 sm:gap-12">
        {[
          { n: '99.2%', d: 'field extraction accuracy across all form types' },
          { n: '<5 min', d: 'average time from upload to filing' },
        ].map(({ n, d }) => (
          <div key={n}>
            <div className="font-display text-[clamp(2rem,3.5vw,3.2rem)] leading-none tracking-tight text-black">
              {n}
            </div>
            <p className="mt-2 text-[12px] text-gray-400 leading-snug max-w-[120px]">{d}</p>
          </div>
        ))}
      </div>
      <blockquote>
        <p className="text-[0.95rem] sm:text-[1rem] text-gray-700 leading-relaxed">
          "Our operations team manually keyed hundreds of forms every week. With theoflow, the record is in the system before the client leaves the desk."
        </p>
        <footer className="mt-6 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center">
            <span className="text-white text-[10px] font-semibold">TN</span>
          </div>
          <div>
            <div className="text-[13px] font-semibold text-black">Thabo Nkosi</div>
            <div className="text-[12px] text-gray-400">Operations Director · FinServ SA</div>
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
                         border-t border-black/[0.06] overflow-hidden`} style={{ minHeight: 520 }}>
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


/* ── How it works ─────────────────────────────────────────────── */
function Steps() {
  return (
    <section className="bg-[#F5F6FA] px-4 sm:px-8 py-16 lg:py-20 border-t border-black/[0.06]">
      <div className="max-w-[1200px] mx-auto grid lg:grid-cols-2 gap-10 lg:gap-16 items-start">
        <div>
          <h2 className="font-display text-[clamp(1.8rem,3vw,2.8rem)] leading-tight
                         tracking-[-0.02em] text-black mb-8">
            Processing in three steps
          </h2>
          {[
            { n:'1.', t:'Upload any document', b:'Drop a PDF, JPG or PNG — financial applications, medical records, government forms, legal agreements.' },
            { n:'2.', t:'AI classifies and extracts', b:'Our extraction engine reads every field. Our validator checks completeness and flags exceptions before filing.' },
            { n:'3.', t:'Filed — everyone notified', b:'The record is updated instantly. Submitter and reviewer both receive confirmation with a full audit trail.' },
          ].map(s => (
            <div key={s.n} className="border-t border-gray-200 py-5">
              <div className="font-display text-[1.6rem] text-black">{s.n}</div>
              <div className="font-semibold text-[14px] text-black mt-0.5 mb-1.5">{s.t}</div>
              <p className="text-[13px] text-gray-500 leading-relaxed max-w-[420px]">{s.b}</p>
            </div>
          ))}
          <div className="border-t border-gray-200 pt-5">
            <Link href="/register"
              className="inline-flex bg-black text-white text-[13px] font-medium
                         px-7 py-3 rounded-full hover:bg-gray-900 transition-colors">
              Get started
            </Link>
            <p className="mt-2.5 text-[12px] text-gray-400">First document ready in minutes.</p>
          </div>
        </div>

        {/* Dark pipeline card — sticky so it stays in view as steps scroll */}
        <div className="lg:sticky lg:top-24 rounded-2xl overflow-hidden" style={{ background:'#111' }}>
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
        Your first document processed in minutes
      </h2>
      <p className="mt-5 text-[14px] text-gray-400 max-w-[380px] mx-auto leading-relaxed">
        No integrations required. Register your organisation, upload a document, and watch the full pipeline run from classification to filing.
      </p>
      <Link href="/register"
        className="mt-9 inline-flex bg-black text-white text-[13px] font-medium
                   px-9 py-4 rounded-full hover:bg-gray-900 transition-colors">
        Register your organisation
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
        <div className="flex items-center gap-2.5">
          <Mark size={28}/>
          <span className="font-display text-[16px] text-black">theoflow</span>
          <span className="text-[11px] text-gray-300 ml-1">© 2026</span>
        </div>
        <div className="flex items-center gap-8 text-[12px] text-gray-400">
          <Link href="/login" className="hover:text-black transition-colors">Sign in</Link>
          <Link href="/register" className="hover:text-black transition-colors">Register</Link>
          <span>POPIA compliant</span>
        </div>
      </div>
    </footer>
  )
}

/* ── Shared: logo mark ────────────────────────────────────────── */
function Mark({ size = 36 }: { size?: number }) {
  return <LogoMark size={size} className="text-black"/>
}
