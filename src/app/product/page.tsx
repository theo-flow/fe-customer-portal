import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingNav } from '@/components/MarketingNav'
import { MarketingFooter } from '@/components/MarketingFooter'

export const metadata: Metadata = {
  title: 'Product | theoflow',
  description: 'The theoflow product suite: Forge, Channel, Harvest, Decode, Sign and Print — modular tools that turn paper forms into structured digital workflows.',
  alternates: { canonical: '/product' },
}

const PRODUCTS = [
  {
    tagline: 'Form Creation',
    name: 'theoflow Forge',
    desc: 'Upload a blank paper form. AI extracts every field label, infers input types, and produces a ready-to-publish digital replica in seconds.',
  },
  {
    tagline: 'Form Publishing',
    name: 'theoflow Channel',
    desc: 'Publish any digitised form as a shareable link. Clients, staff, or the public fill it on any device — no app, no login required.',
  },
  {
    tagline: 'Data Collection',
    name: 'theoflow Harvest',
    desc: 'Every submission is validated in real time — SA ID numbers, phone formats, dates, and currency — before it ever reaches your database.',
  },
  {
    tagline: 'Document Intelligence',
    name: 'theoflow Decode',
    desc: 'Upload a filled paper document. The extraction pipeline reads every field value and structures it automatically — no human capture needed.',
  },
  {
    tagline: 'Digital Signing',
    name: 'theoflow Sign',
    desc: 'Route a completed document to one or more signers by secure token link. Every signature is hash-verified and tied to an auditable session.',
  },
  {
    tagline: 'Printable Output',
    name: 'theoflow Print',
    desc: 'Generate a clean, branded printable PDF from any validated digital submission — confirmation documents, pre-filled forms, or records on demand.',
  },
]

export default function ProductPage() {
  return (
    <div className="bg-white overflow-x-hidden w-full">
      <MarketingNav />
      <div className="h-[56px]" />

      <section className="max-w-[760px] mx-auto px-8 pt-20 pb-14 text-center">
        <span className="inline-flex text-[11px] font-semibold text-gray-400 uppercase
                         tracking-[0.10em] border border-gray-200 rounded-full px-3 py-[5px] mb-7">
          The product suite
        </span>
        <h1 className="font-display text-[clamp(2rem,4.5vw,3.2rem)] leading-[1.1]
                       tracking-[-0.02em] text-black">
          One platform. Six modular products.
        </h1>
        <p className="mt-6 text-[15px] text-gray-500 leading-relaxed max-w-[520px] mx-auto">
          Organisations subscribe only to what they need. Every module runs on the same
          serverless pipeline and shares one audit trail.
        </p>
      </section>

      <section className="border-t border-black/[0.06]">
        <div className="max-w-[1000px] mx-auto grid sm:grid-cols-2 gap-px bg-black/[0.06]">
          {PRODUCTS.map(p => (
            <div key={p.name} className="bg-white px-8 py-9">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.10em] mb-2">
                {p.tagline}
              </p>
              <h2 className="font-display text-[1.4rem] text-black mb-2.5">{p.name}</h2>
              <p className="text-[13.5px] text-gray-500 leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-black/[0.06] py-16 px-8 text-center">
        <h2 className="font-display text-[1.7rem] text-black mb-4">
          Not sure which products you need?
        </h2>
        <p className="text-[13.5px] text-gray-500 max-w-[420px] mx-auto mb-8">
          Register your organisation and pick modules as you go — nothing is locked in upfront.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link href="/register"
            className="inline-flex bg-black text-white text-[13px] font-medium
                       px-7 py-3 rounded-full hover:bg-gray-900 transition-colors">
            Register your organisation
          </Link>
          <Link href="/contact"
            className="inline-flex text-[13px] font-medium text-gray-600 px-7 py-3 rounded-full
                       border border-gray-200 bg-white hover:border-gray-300 transition-colors">
            Talk to us first
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
