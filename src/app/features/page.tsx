// No em dashes or double dashes in any text here -- use a single hyphen (-). See CLAUDE.md.
import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingNav } from '@/components/MarketingNav'
import { MarketingFooter } from '@/components/MarketingFooter'
import {
  IconBadge, COLOR_PAIRS, IntakeIcon, ExtractionIcon, ValidationIcon, WorkflowIcon, SecurityIcon,
} from '@/components/MarketingIcons'
import { GradientMesh } from '@/components/GradientMesh'

export const metadata: Metadata = {
  title: 'Features | theoflow',
  description: 'Multi-format document intake, field extraction with confidence scoring, real-time SA validators, digital signing, and a POPIA-compliant audit trail - theoflow capabilities in detail.',
  alternates: { canonical: '/features' },
  openGraph: {
    title: 'Features | theoflow',
    description: 'Multi-format document intake, field extraction with confidence scoring, real-time SA validators, digital signing, and a POPIA-compliant audit trail - theoflow capabilities in detail.',
    url: '/features',
    siteName: 'theoflow',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'theoflow - Document Intelligence' }],
    locale: 'en_ZA',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Features | theoflow',
    description: 'Multi-format document intake, field extraction with confidence scoring, real-time SA validators, digital signing, and a POPIA-compliant audit trail - theoflow capabilities in detail.',
    images: ['/og-image.png'],
  },
}

const GROUPS = [
  {
    tag: 'Document intake',
    icon: IntakeIcon,
    pair: COLOR_PAIRS.amber,
    heading: 'Accept any document, from any device',
    items: [
      'PDF, JPG and PNG uploads - financial applications, medical records, government forms, legal agreements',
      'The document type is identified automatically as it arrives, before any field is read',
      'Illegible or corrupt scans are rejected before they enter the pipeline',
      'Public fill links for Channel-published forms - no app, no login required',
    ],
  },
  {
    tag: 'Field extraction',
    icon: ExtractionIcon,
    pair: COLOR_PAIRS.green,
    heading: 'Every field value pulled off the page and read correctly',
    items: [
      'No template needed in advance - printed and handwritten text alike, across any form type',
      'Each field gets a confidence score, so you know exactly what needs a second look',
      'Ambiguous or unmatched labels are re-matched to the correct field - never invented, never guessed',
      'Blank templates are turned into ready-to-publish digital forms in seconds',
    ],
  },
  {
    tag: 'Field validation',
    icon: ValidationIcon,
    pair: COLOR_PAIRS.blue,
    heading: 'Bad data never reaches your database',
    items: [
      'Real-time validation for SA ID numbers, phone formats, dates and currency',
      'Rules engine checks completeness before a submission is filed',
      'Inline error messages on public-facing forms, before submission',
    ],
  },
  {
    tag: 'Submission workflow',
    icon: WorkflowIcon,
    pair: COLOR_PAIRS.purple,
    heading: 'Everyone knows the moment it moves',
    items: [
      'Submitters get instant confirmation with a unique document reference',
      'Reviewers are notified the moment a submission needs attention - no manual chasing',
      'Secure token-based signing sessions, hash-verified per signer',
      'Branded, print-ready PDFs generated on demand from any validated submission',
    ],
  },
  {
    tag: 'Security & compliance',
    icon: SecurityIcon,
    pair: COLOR_PAIRS.teal,
    heading: 'Built for regulated data from day one',
    items: [
      'Full POPIA-compliant audit trail stored per submission',
      'Cognito-backed authentication with per-organisation access control',
      'Serverless AWS architecture in af-south-1 - no shared infrastructure between organisations',
    ],
  },
]

export default function FeaturesPage() {
  return (
    <div className="bg-white overflow-x-hidden w-full">
      <MarketingNav />
      <div className="h-[56px]" />

      <section className="max-w-[760px] mx-auto px-8 pt-10 pb-12 text-center">
        <span className="inline-flex text-[11px] font-semibold text-gray-400 uppercase
                         tracking-[0.10em] border border-gray-200 rounded-full px-3 py-[5px] mb-7">
          Features
        </span>
        <h1 className="font-display text-[clamp(2rem,4.5vw,3.2rem)] leading-[1.1]
                       tracking-[-0.02em] text-black">
          What theoflow actually does, in detail.
        </h1>
      </section>

      {GROUPS.map(g => (
        <section key={g.tag} className="border-t border-black/[0.06] px-8 py-14">
          <div className="max-w-[900px] mx-auto grid sm:grid-cols-[minmax(0,260px)_1fr] gap-8 sm:gap-14">
            <div>
              <IconBadge Icon={g.icon} pair={g.pair} />
              <span className="mt-4 inline-flex text-[11px] font-semibold text-gray-400 uppercase
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

      <section className="relative border-t border-black/[0.06] py-20 px-8 text-center overflow-hidden">
        <GradientMesh base="#F5EDD8" colorA="#F0B848" colorB="#4E82CC" />
        <h2 className="relative font-display text-[1.7rem] text-black mb-4">See it on your own forms</h2>
        <Link href="/register"
          className="relative mt-4 inline-flex bg-black text-white text-[13px] font-medium
                     px-7 py-3 rounded-full hover:bg-gray-900 transition-colors">
          Register your organisation
        </Link>
      </section>

      <MarketingFooter />
    </div>
  )
}
