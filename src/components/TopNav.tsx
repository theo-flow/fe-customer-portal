'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import { LogoMark } from '@/components/LogoMark'
import { useOrg } from '@/lib/org-context'
import { signOut } from '@/lib/auth'

interface NavItem { href: string; label: string; built: boolean }

function navItemsFor(products: string[]): NavItem[] {
  const items: NavItem[] = [
    { href: '/dashboard', label: 'Home', built: true },
  ]
  if (products.includes('forge'))   items.push({ href: '/templates',   label: 'Templates',   built: false })
  if (products.includes('channel')) items.push({ href: '/forms',       label: 'Forms',       built: false })
  if (products.includes('harvest')) items.push({ href: '/submissions', label: 'Submissions', built: false })
  if (products.includes('decode'))  items.push({ href: '/upload',      label: 'Upload',      built: true  })
  return items
}

// Mobile bottom-nav icons
const NAV_ICONS: Record<string, JSX.Element> = {
  '/dashboard':  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>,
  '/templates':  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>,
  '/forms':      <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>,
  '/submissions':<path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>,
  '/upload':     <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>,
}

export function TopNav() {
  const path   = usePathname()
  const router = useRouter()
  const { name, email, initials, orgName, subscribedProducts, loading } = useOrg()
  const navItems = navItemsFor(loading ? [] : subscribedProducts)

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  function handleSignOut() {
    setMenuOpen(false)
    signOut()
    router.push('/')
  }

  return (
    <>
      {/* Desktop top bar */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex items-center h-16 gap-8">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-3 flex-shrink-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10">
              <LogoMark className="text-black"/>
            </div>
            <span className="font-display text-xl sm:text-2xl text-gray-900 tracking-tight">theoflow</span>
          </Link>

          {/* Nav links */}
          <nav className="hidden md:flex items-center gap-1 ml-4">
            {navItems.map(n => {
              const active = path?.startsWith(n.href) && (n.href !== '/dashboard' || path === '/dashboard')
              return (
                <Link key={n.href} href={n.href}
                  className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? 'bg-gray-100 text-gray-900'
                      : n.built
                        ? 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                        : 'text-gray-300 cursor-default pointer-events-none'
                  }`}>
                  {n.label}
                  {!n.built && (
                    <span className="ml-1.5 text-[9px] font-semibold uppercase tracking-wide
                                     text-gray-300">
                      soon
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>

          {/* Right: org name + avatar dropdown */}
          <div className="ml-auto flex items-center gap-2.5">
            {orgName && (
              <span className="hidden sm:block text-[12px] text-gray-400 max-w-[160px] truncate">
                {orgName}
              </span>
            )}
            {name && (
              <span className="hidden lg:block text-[13px] font-medium text-gray-600 max-w-[160px] truncate">
                {name}
              </span>
            )}

            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(prev => !prev)}
                title={name}
                className="w-8 h-8 rounded-full bg-black flex items-center justify-center
                           cursor-pointer hover:opacity-70 transition-opacity flex-shrink-0">
                <span className="font-medium text-white text-xs">{initials}</span>
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-10 w-52 bg-white rounded-2xl shadow-lg
                                border border-black/[0.08] py-1 z-50">
                  <div className="px-4 py-2.5 border-b border-black/[0.06]">
                    <p className="text-[13px] font-medium text-black truncate">{name}</p>
                    <p className="text-[11px] text-gray-400 truncate">{email}</p>
                  </div>
                  <div className="p-1">
                    <Link href="/settings" onClick={() => setMenuOpen(false)}
                      className="flex items-center px-3 py-2 rounded-xl text-[13px] text-gray-700
                                 hover:bg-gray-50 transition-colors">
                      Settings
                    </Link>
                    <button onClick={handleSignOut}
                      className="w-full flex items-center px-3 py-2 rounded-xl text-[13px]
                                 text-red-600 hover:bg-red-50 transition-colors">
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-100">
        <div className="flex">
          {navItems.map(n => {
            const active = path?.startsWith(n.href) && (n.href !== '/dashboard' || path === '/dashboard')
            return (
              <Link key={n.href} href={n.href}
                className={`flex-1 flex flex-col items-center py-3 text-xs font-medium transition-colors ${
                  active ? 'text-black' : n.built ? 'text-gray-400' : 'text-gray-200 pointer-events-none'
                }`}>
                <svg className="w-5 h-5 mb-1" fill="none" viewBox="0 0 24 24"
                     stroke="currentColor" strokeWidth={1.8}>
                  {NAV_ICONS[n.href]}
                </svg>
                {n.label}
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
