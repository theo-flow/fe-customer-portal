// No em dashes or double dashes in any text here -- use a single hyphen (-). See CLAUDE.md.
import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingNav } from '@/components/MarketingNav'
import { MarketingFooter } from '@/components/MarketingFooter'
import { GradientMesh } from '@/components/GradientMesh'
import { IconBadge, COLOR_PAIRS, ExtractionIcon, WorkflowIcon } from '@/components/MarketingIcons'

export const metadata: Metadata = {
  title: 'About | theoflow',
  description: 'theoflow is a digital forms intelligence platform built to eliminate manual document capture for South African organisations, in any sector.',
  alternates: { canonical: '/about' },
  openGraph: {
    title: 'About | theoflow',
    description: 'theoflow is a digital forms intelligence platform built to eliminate manual document capture for South African organisations, in any sector.',
    url: '/about',
    siteName: 'theoflow',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'theoflow - Document Intelligence' }],
    locale: 'en_ZA',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'About | theoflow',
    description: 'theoflow is a digital forms intelligence platform built to eliminate manual document capture for South African organisations, in any sector.',
    images: ['/og-image.png'],
  },
}

export default function AboutPage() {
  return (
    <div className="bg-white overflow-x-hidden w-full">
      <MarketingNav />
      <div className="h-[56px]" />

      <section className="max-w-[760px] mx-auto px-8 pt-10 pb-14 text-center">
        <span className="inline-flex text-[11px] font-semibold text-gray-400 uppercase
                         tracking-[0.10em] border border-gray-200 rounded-full px-3 py-[5px] mb-7">
          About theoflow
        </span>
        <h1 className="font-display text-[clamp(2rem,4.5vw,3.2rem)] leading-[1.1]
                       tracking-[-0.02em] text-black">
          Every form in your organisation - structured, digital, and intelligent.
        </h1>
      </section>

      <section className="border-t border-black/[0.06] py-16 px-8">
        <div className="max-w-[900px] mx-auto grid sm:grid-cols-2 gap-10">
          <div>
            <IconBadge Icon={ExtractionIcon} pair={COLOR_PAIRS.green} />
            <h2 className="font-display text-[1.5rem] text-black mt-4 mb-3">One platform, industry-agnostic</h2>
            <p className="text-[13.5px] text-gray-500 leading-relaxed">
              theoflow was built for insurance, but the same pipeline - classify, extract, validate,
              file - applies wherever an organisation collects paper or scanned forms: banking,
              healthcare, government, and beyond. Any sector, any form.
            </p>
          </div>
          <div>
            <IconBadge Icon={WorkflowIcon} pair={COLOR_PAIRS.purple} />
            <h2 className="font-display text-[1.5rem] text-black mt-4 mb-3">Modular by design</h2>
            <p className="text-[13.5px] text-gray-500 leading-relaxed">
              Organisations subscribe only to the products they need. Each module - Forge, Channel,
              Harvest, Decode, Sign, Print - runs on shared serverless infrastructure, so new
              capabilities ship without disrupting what's already live.
            </p>
          </div>
        </div>
      </section>

      <section className="relative border-t border-black/[0.06] py-20 px-8 overflow-hidden">
        <GradientMesh base="#F5EDD8" colorA="#F0B848" colorB="#4E82CC" />
        <div className="relative max-w-[900px] mx-auto text-center">
          <h2 className="font-display text-[1.6rem] text-black mb-3">Built by ByTheodore</h2>
          <p className="text-[13.5px] text-gray-600 leading-relaxed max-w-[560px] mx-auto">
            TheoFlow is built and operated by <strong className="font-semibold text-black">ByTheodore</strong> in
            partnership with <strong className="font-semibold text-black">Genieyus AI</strong>. Powered by AWS
            and built on a secure serverless cloud architecture, the platform is designed for
            scalability, reliability, and transparency. Security, compliance, and end-to-end audit
            trails are built into every workflow, giving organizations complete visibility,
            accountability, and confidence in every business process.
          </p>
          <Link href="/product"
            className="mt-8 inline-flex bg-black text-white text-[13px] font-medium
                       px-7 py-3 rounded-full hover:bg-gray-900 transition-colors">
            See the product suite
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
