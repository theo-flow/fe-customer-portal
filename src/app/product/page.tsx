// No em dashes or double dashes in any text here -- use a single hyphen (-). See CLAUDE.md.
import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingNav } from '@/components/MarketingNav'
import { MarketingFooter } from '@/components/MarketingFooter'
import {
  IconBadge, COLOR_PAIRS, ForgeIcon, ChannelIcon, HarvestIcon, DecodeIcon, SignIcon, PrintIcon,
} from '@/components/MarketingIcons'
import { GradientMesh } from '@/components/GradientMesh'
import { PLANS, TRIAL_DAYS, planBenefits } from '@/lib/plans'
import { DOCS_PER_SEAT, computeSeatCharge, seatBandRows } from '@/lib/seat-pricing'

export const metadata: Metadata = {
  title: 'Products | theoflow',
  description: 'The theoflow product suite: Forge, Channel, Harvest, Decode, Sign and Print - modular tools that turn paper forms into structured digital workflows.',
  alternates: { canonical: '/product' },
  openGraph: {
    title: 'Products | theoflow',
    description: 'The theoflow product suite: Forge, Channel, Harvest, Decode, Sign and Print - modular tools that turn paper forms into structured digital workflows.',
    url: '/product',
    siteName: 'theoflow',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'theoflow - Document Intelligence' }],
    locale: 'en_ZA',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Products | theoflow',
    description: 'The theoflow product suite: Forge, Channel, Harvest, Decode, Sign and Print - modular tools that turn paper forms into structured digital workflows.',
    images: ['/og-image.png'],
  },
}

const PRODUCTS = [
  {
    tagline: 'Form Creation',
    name: 'theoflow Forge',
    icon: ForgeIcon,
    pair: COLOR_PAIRS.amber,
    desc: 'Upload a blank paper form. Every field label is read, input types are inferred, and a ready-to-publish digital replica is produced in seconds.',
  },
  {
    tagline: 'Form Publishing',
    name: 'theoflow Channel',
    icon: ChannelIcon,
    pair: COLOR_PAIRS.blue,
    desc: 'Publish any digitised form as a shareable link. Clients, staff, or the public fill it on any device - no app, no login required.',
  },
  {
    tagline: 'Data Collection',
    name: 'theoflow Harvest',
    icon: HarvestIcon,
    pair: COLOR_PAIRS.green,
    desc: 'Every submission is validated in real time - SA ID numbers, phone formats, dates, and currency - before it ever reaches your database.',
  },
  {
    tagline: 'Document Intelligence',
    name: 'theoflow Decode',
    icon: DecodeIcon,
    pair: COLOR_PAIRS.purple,
    desc: 'Upload a filled paper document. The extraction pipeline reads every field value and structures it automatically - no human capture needed.',
  },
  {
    tagline: 'Digital Signing',
    name: 'theoflow Sign',
    icon: SignIcon,
    pair: COLOR_PAIRS.teal,
    desc: 'Route a completed document to one or more signers by secure token link. Every signature is hash-verified and tied to an auditable session.',
  },
  {
    tagline: 'Printable Output',
    name: 'theoflow Print',
    icon: PrintIcon,
    pair: COLOR_PAIRS.orange,
    desc: 'Generate a clean, branded printable PDF from any validated digital submission - confirmation documents, pre-filled forms, or records on demand.',
  },
]

export default function ProductPage() {
  return (
    <div className="bg-white overflow-x-hidden w-full">
      <MarketingNav />
      <div className="h-[56px]" />

      <section className="max-w-[760px] mx-auto px-8 pt-10 pb-12 text-center">
        <span className="inline-flex text-[11px] font-semibold text-gray-400 uppercase
                         tracking-[0.10em] border border-gray-200 rounded-full px-3 py-[5px] mb-7">
          The product suite
        </span>
        <h1 className="font-display text-[clamp(2rem,4.5vw,3.2rem)] leading-[1.1]
                       tracking-[-0.02em] text-black">
          One platform. Six modular products.
        </h1>
        <p className="mt-5 text-[13.5px] text-gray-500">
          <Link href="#pricing" className="font-medium text-black underline underline-offset-4 hover:text-gray-600">
            See pricing
          </Link>
        </p>
      </section>

      <section className="border-t border-black/[0.06]">
        <div className="max-w-[1000px] mx-auto grid sm:grid-cols-2 gap-px bg-black/[0.06]">
          {PRODUCTS.map(p => (
            <div key={p.name} className="bg-white px-8 py-9">
              <IconBadge Icon={p.icon} pair={p.pair} />
              <p className="mt-4 text-[11px] font-semibold text-gray-400 uppercase tracking-[0.10em] mb-2">
                {p.tagline}
              </p>
              <h2 className="font-display text-[1.4rem] text-black mb-2.5">{p.name}</h2>
              <p className="text-[13.5px] text-gray-500 leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="border-t border-black/[0.06] py-16 px-8 scroll-mt-16">
        <div className="max-w-[860px] mx-auto">
          <div className="text-center mb-10">
            <span className="inline-flex text-[11px] font-semibold text-gray-400 uppercase
                             tracking-[0.10em] border border-gray-200 rounded-full px-3 py-[5px] mb-5">
              Pricing
            </span>
            <h2 className="font-display text-[1.9rem] leading-tight text-black">
              Try it free, then pay per seat
            </h2>
            <p className="mt-3 text-[13.5px] text-gray-500 max-w-[540px] mx-auto">
              Every plan includes all six products. Billed monthly in rand and settled by EFT.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-black/[0.1] p-6 flex flex-col">
              <h3 className="text-[16px] font-semibold text-black">Pilot</h3>
              <p className="font-display text-[2rem] leading-none text-black mt-3">
                Free<span className="text-[12px] font-sans text-gray-400"> for {TRIAL_DAYS} days</span>
              </p>
              <ul className="mt-5 space-y-2.5 flex-1">
                {planBenefits(PLANS.pilot).map(b => (
                  <li key={b} className="flex gap-2 text-[13px] text-gray-600">
                    <span aria-hidden="true" className="text-black">&#10003;</span>{b}
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-[12px] text-gray-400 leading-relaxed">
                On day {TRIAL_DAYS + 1} you move to Starter and get your first invoice. We email you
                on day 5, and you can cancel any time before then.
              </p>
              <Link href="/register"
                className="mt-5 inline-flex justify-center bg-black text-white text-[13px] font-medium
                           px-6 py-2.5 rounded-full hover:bg-gray-900 transition-colors">
                Start free
              </Link>
            </div>

            <div className="rounded-2xl border border-black p-6 flex flex-col">
              <h3 className="text-[16px] font-semibold text-black">Starter</h3>
              <p className="font-display text-[2rem] leading-none text-black mt-3">
                From R{seatBandRows()[0].priceZar.toLocaleString('en-US')}
                <span className="text-[12px] font-sans text-gray-400"> a seat / month</span>
              </p>
              <ul className="mt-5 space-y-2.5">
                {planBenefits(PLANS.starter).map(b => (
                  <li key={b} className="flex gap-2 text-[13px] text-gray-600">
                    <span aria-hidden="true" className="text-black">&#10003;</span>{b}
                  </li>
                ))}
              </ul>

              <table className="mt-5 w-full text-[13px]">
                <caption className="sr-only">Price of each seat</caption>
                <tbody className="divide-y divide-black/[0.06]">
                  {seatBandRows().map(row => (
                    <tr key={row.label}>
                      <td className="py-2 text-gray-600">{row.label}</td>
                      <td className="py-2 text-right font-medium text-black">
                        R{row.priceZar.toLocaleString('en-US')} each
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-[12px] text-gray-400 leading-relaxed flex-1">
                Each seat is priced by its own position, so the more people you add, the less each
                extra seat costs. For example {[1, 5, 10, 20]
                  .map(n => `${n} seat${n > 1 ? 's' : ''} is R${computeSeatCharge(n).totalZar.toLocaleString('en-US')}`)
                  .join(', ')} a month.
                {' '}Each seat includes {DOCS_PER_SEAT} documents a month.
              </p>

              <Link href="/register"
                className="mt-5 inline-flex justify-center bg-black text-white text-[13px] font-medium
                           px-6 py-2.5 rounded-full hover:bg-gray-900 transition-colors">
                Get started
              </Link>
            </div>
          </div>

          <p className="mt-8 text-center text-[12.5px] text-gray-400">
            Need something different?{' '}
            <Link href="/contact" className="font-medium text-gray-600 underline underline-offset-4 hover:text-black">
              Talk to us
            </Link>
          </p>
        </div>
      </section>

      <section className="relative border-t border-black/[0.06] py-20 px-8 text-center overflow-hidden">
        <GradientMesh base="#F5EDD8" colorA="#F0B848" colorB="#4E82CC" />
        <h2 className="relative font-display text-[1.7rem] text-black mb-4">
          Not sure which products you need?
        </h2>
        <p className="relative text-[13.5px] text-gray-600 max-w-[420px] mx-auto mb-8">
          Register your organisation and pick modules as you go - nothing is locked in upfront.
        </p>
        <div className="relative flex items-center justify-center gap-3 flex-wrap">
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
