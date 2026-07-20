import Link from 'next/link'
import { LogoMark } from '@/components/LogoMark'

const LINKS = [
  { href: '/about',    label: 'About' },
  { href: '/product',  label: 'Product' },
  { href: '/features', label: 'Features' },
  { href: '/contact',  label: 'Contact' },
]

export function MarketingNav() {
  return (
    <nav className="fixed inset-x-0 top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-black/[0.06]">
      <div className="max-w-[1200px] mx-auto px-8 h-[56px] flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <LogoMark size={36} className="text-black"/>
          <span className="font-display text-[22px] tracking-tight text-black">theoflow</span>
        </Link>
        <div className="hidden md:flex items-center gap-1">
          {LINKS.map(l => (
            <Link key={l.href} href={l.href}
              className="text-[13px] text-gray-500 hover:text-black transition-colors px-4 py-2 rounded-full">
              {l.label}
            </Link>
          ))}
        </div>
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
