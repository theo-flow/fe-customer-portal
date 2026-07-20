import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingNav } from '@/components/MarketingNav'
import { MarketingFooter } from '@/components/MarketingFooter'

export const metadata: Metadata = {
  title: 'Features | theoflow',
  description: 'Multi-format intake, AI field extraction with confidence scoring, real-time SA validators, digital signing, and a POPIA-compliant audit trail — theoflow capabilities in detail.',
  alternates: { canonical: '/features' },
}

const GROUPS = [
  {
    tag: 'Intake',
    heading: 'Accept any document, from any device',
    items: [
      'PDF, JPG and PNG uploads — financial applications, medical records, government forms, legal agreements',
      'Automatic document-type detection before extraction begins',
      'Illegible or corrupt scans are rejected before they enter the pipeline',
      'Public fill links for Channel-published forms — no app, no login required',
    ],
  },
  {
    tag: 'Extraction & AI',
    heading: 'Every field read, every field scored',
    items: [
      'Template-free universal extraction — reads printed and handwritten text across form types',
      'Per-field confidence scoring surfaces exactly what needs human review',
      'Bedrock-backed re-matching resolves ambiguous or unmatched labels without inventing values',
      'Blank templates are digitised into ready-to-publish schemas in seconds',
    ],
  },
  {
    tag: 'Validation',
    heading: 'Bad data never reaches your database',
    items: [
      'Real-time validation for SA ID numbers, phone formats, dates and currency',
      'Rules engine checks completeness before a submission is filed',
      'Inline error messages on public-facing forms, before submission',
    ],
  },
  {
    tag: 'Workflow',
    heading: 'Everyone knows the moment it moves',
    items: [
      'Submitters get instant confirmation with a unique document reference',
      'Reviewers are notified the moment a submission needs attention — no manual chasing',
      'Secure token-based signing sessions, hash-verified per signer',
      'Branded, print-ready PDFs generated on demand from any validated submission',
    ],
  },
  {
    tag: 'Security & compliance',
    heading: 'Built for regulated data from day one',
    items: [
      'Full POPIA-compliant audit trail stored per submission',
      'Cognito-backed authentication with per-organisation access control',
      'Serverless AWS architecture in af-south-1 — no shared infrastructure between organisations',
    ],
  },
]

export default function FeaturesPage() {
  return (
    <div className="bg-white overflow-x-hidden w-full">
      <MarketingNav />
      <div className="h-[56px]" />

      <section className="max-w-[760px] mx-auto px-8 pt-20 pb-14 text-center">
        <span className="inline-flex text-[11px] font-semibold text-gray-400 uppercase
                         tracking-[0.10em] border border-gray-200 rounded-full px-3 py-[5px] mb-7">
          Features
        </span>
        <h1 className="font-display text-[clamp(2rem,4.5vw,3.2rem)] leading-[1.1]
                       tracking-[-0.02em] text-black">
          What theoflow actually does, in detail.
        </h1>
        <p className="mt-6 text-[15px] text-gray-500 leading-relaxed max-w-[520px] mx-auto">
          Every capability below runs on the same pipeline: classify, extract, validate, file.
        </p>
      </section>

      {GROUPS.map(g => (
        <section key={g.tag} className="border-t border-black/[0.06] px-8 py-14">
          <div className="max-w-[900px] mx-auto grid sm:grid-cols-[minmax(0,260px)_1fr] gap-8 sm:gap-14">
            <div>
              <span className="inline-flex text-[11px] font-semibold text-gray-400 uppercase
                               tracking-[0.10em] border border-gray-200 rounded-full px-3 py-[5px] mb-4">
                {g.tag}
              </span>
              <h2 className="font-display text-[1.5rem] leading-[1.15] tracking-[-0.01em] text-black">
                {g.heading}
              </h2>
            </div>
            <ul>
              {g.items.map((item, i) => (
                <li key={i} className="border-t border-gray-100 first:border-t-0 py-3.5
                                       text-[13.5px] text-gray-500 leading-relaxed">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}

      <section className="border-t border-black/[0.06] py-16 px-8 text-center">
        <h2 className="font-display text-[1.7rem] text-black mb-4">See it on your own forms</h2>
        <Link href="/register"
          className="mt-4 inline-flex bg-black text-white text-[13px] font-medium
                     px-7 py-3 rounded-full hover:bg-gray-900 transition-colors">
          Register your organisation
        </Link>
      </section>

      <MarketingFooter />
    </div>
  )
}
