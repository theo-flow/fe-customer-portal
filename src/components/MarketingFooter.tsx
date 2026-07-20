import Link from 'next/link'
import { LogoMark } from '@/components/LogoMark'

const LINKS = [
  { href: '/about',    label: 'About' },
  { href: '/product',  label: 'Product' },
  { href: '/features', label: 'Features' },
  { href: '/contact',  label: 'Contact' },
]

export function MarketingFooter() {
  return (
    <footer className="border-t border-black/[0.06] py-7 px-8">
      <div className="max-w-[1200px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <LogoMark size={28} className="text-black"/>
          <span className="font-display text-[16px] text-black">theoflow</span>
          <span className="text-[11px] text-gray-300 ml-1">© 2026</span>
        </div>
        <div className="flex items-center gap-6 sm:gap-8 text-[12px] text-gray-400 flex-wrap justify-center">
          {LINKS.map(l => (
            <Link key={l.href} href={l.href} className="hover:text-black transition-colors">
              {l.label}
            </Link>
          ))}
          <Link href="/login" className="hover:text-black transition-colors">Sign in</Link>
          <Link href="/register" className="hover:text-black transition-colors">Register</Link>
          <span>POPIA compliant</span>
        </div>
      </div>
    </footer>
  )
}
