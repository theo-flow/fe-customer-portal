'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogoMark } from '@/components/LogoMark'

const NAV = [
  { href: '/upload',    label: 'Upload' },
  { href: '/dashboard', label: 'Documents' },
]

export function TopNav() {
  const path = usePathname()
  const [initials, setInitials] = useState('··')

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.initials) setInitials(d.initials) })
      .catch(() => {})
  }, [])

  return (
    <>
      {/* Desktop top bar */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex items-center h-16 gap-8">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2.5 flex-shrink-0">
            <LogoMark size={28} className="text-black"/>
            <span className="font-display text-lg text-gray-900 tracking-tight">theoflow</span>
          </Link>

          {/* Nav links — hidden on mobile */}
          <nav className="hidden md:flex items-center gap-1 ml-4">
            {NAV.map(n => (
              <Link key={n.href} href={n.href}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  path?.startsWith(n.href)
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                }`}>
                {n.label}
              </Link>
            ))}
          </nav>

          {/* Right: avatar */}
          <div className="ml-auto flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-black flex items-center justify-center cursor-pointer hover:opacity-70 transition-opacity">
              <span className="font-medium text-white text-xs">{initials}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-100">
        <div className="flex">
          {NAV.map(n => (
            <Link key={n.href} href={n.href}
              className={`flex-1 flex flex-col items-center py-3 text-xs font-medium transition-colors ${
                path?.startsWith(n.href)
                  ? 'text-black'
                  : 'text-gray-400'
              }`}>
              {n.href === '/upload'
                ? <svg className="w-5 h-5 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
                  </svg>
                : <svg className="w-5 h-5 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>
                  </svg>
              }
              {n.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  )
}
