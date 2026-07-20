import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingNav } from '@/components/MarketingNav'
import { MarketingFooter } from '@/components/MarketingFooter'

export const metadata: Metadata = {
  title: 'About | theoflow',
  description: 'theoflow is a digital forms intelligence platform built to eliminate manual document capture for South African organisations, in any sector.',
  alternates: { canonical: '/about' },
}

export default function AboutPage() {
  return (
    <div className="bg-white overflow-x-hidden w-full">
      <MarketingNav />
      <div className="h-[56px]" />

      <section className="max-w-[760px] mx-auto px-8 pt-20 pb-16 text-center">
        <span className="inline-flex text-[11px] font-semibold text-gray-400 uppercase
                         tracking-[0.10em] border border-gray-200 rounded-full px-3 py-[5px] mb-7">
          About theoflow
        </span>
        <h1 className="font-display text-[clamp(2rem,4.5vw,3.2rem)] leading-[1.1]
                       tracking-[-0.02em] text-black">
          Every form in your organisation — structured, digital, and intelligent.
        </h1>
        <p className="mt-6 text-[15px] text-gray-500 leading-relaxed max-w-[560px] mx-auto">
          South African organisations still run on paper. Forms are filled by hand, scanned at
          best, manually captured at worst — data lost in transit, processing slowed to a crawl.
          theoflow eliminates manual capture entirely, from the blank template to the validated,
          filed submission.
        </p>
      </section>

      <section className="border-t border-black/[0.06] py-16 px-8">
        <div className="max-w-[900px] mx-auto grid sm:grid-cols-2 gap-10">
          <div>
            <h2 className="font-display text-[1.5rem] text-black mb-3">One platform, industry-agnostic</h2>
            <p className="text-[13.5px] text-gray-500 leading-relaxed">
              theoflow was built for insurance, but the same pipeline — classify, extract, validate,
              file — applies wherever an organisation collects paper or scanned forms: banking,
              healthcare, government, and beyond. Any sector, any form.
            </p>
          </div>
          <div>
            <h2 className="font-display text-[1.5rem] text-black mb-3">Modular by design</h2>
            <p className="text-[13.5px] text-gray-500 leading-relaxed">
              Organisations subscribe only to the products they need. Each module — Forge, Channel,
              Harvest, Decode, Sign, Print — runs on shared serverless infrastructure, so new
              capabilities ship without disrupting what's already live.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-black/[0.06] py-16 px-8 bg-[#F5F6FA]">
        <div className="max-w-[900px] mx-auto text-center">
          <h2 className="font-display text-[1.5rem] text-black mb-3">Built by Genie-yus AI Partnership</h2>
          <p className="text-[13.5px] text-gray-500 leading-relaxed max-w-[520px] mx-auto">
            theoflow is built and operated by Sithembiso Mjoko in partnership with Genie-yus AI —
            serverless on AWS, deployed in af-south-1, with POPIA compliance built into the
            audit trail from the first submission.
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
