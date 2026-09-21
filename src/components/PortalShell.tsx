'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, CreditCard, LogOut, Menu, X } from 'lucide-react'
import { LogoMark } from '@/components/LogoMark'
import NotificationBell from '@/components/NotificationBell'
import { useOrg } from '@/lib/org-context'
import { signOut } from '@/lib/auth'
import { isNavItemActive, navGroupsFor, parentPathOf } from '@/lib/portal-nav'

// Left-sidebar portal shell: a fixed 240px column from lg up, an off-canvas drawer
// below it. Layout pattern borrowed from likum-logistics' PortalShell; kept
// monochrome to match the TheoFlow brand instead of a coloured accent.
export function PortalShell({ children }: { children: React.ReactNode }) {
  const path   = usePathname()
  const router = useRouter()
  const { name, email, initials, orgName, role, access, subscribedProducts, loading } = useOrg()
  const groups = navGroupsFor(loading ? [] : subscribedProducts, role)

  // A locked org (its pilot was cancelled) can still sign in and reach Billing, where
  // it restarts on the paid plan. Everything else shows the lock screen.
  const locked = !loading && access?.state === 'locked' && !path?.startsWith('/billing')
  const onPilot = !loading && access?.state === 'trial' && access.daysLeft !== null

  const [drawerOpen, setDrawerOpen] = useState(false)

  // Close the drawer on navigation, and on Escape.
  useEffect(() => { setDrawerOpen(false) }, [path])
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  // Back: to the page the person clicked from. `depth` is how many pages they have
  // moved through inside the portal; with none behind them (a reload, a link opened
  // from an email) Back goes up to the page's section, or Home.
  const [depth, setDepth] = useState(0)
  const lastPath = useRef(path)
  const poppedBack = useRef(false)
  useEffect(() => {
    const onPop = () => { poppedBack.current = true }
    // capture phase: React can update the page before a normal listener has run
    window.addEventListener('popstate', onPop, true)
    return () => window.removeEventListener('popstate', onPop, true)
  }, [])
  useEffect(() => {
    if (lastPath.current === path) return
    lastPath.current = path
    // Read the flag NOW: React may run the update below after the flag has been cleared.
    const wentBack = poppedBack.current
    poppedBack.current = false
    setDepth(d => (wentBack ? Math.max(0, d - 1) : d + 1))
  }, [path])
  const fallback = parentPathOf(path, groups)
  const canGoBack = depth > 0 || fallback !== null
  function goBack() {
    // Our own Back marks itself: the page can change before the browser reports the back step.
    if (depth > 0) { poppedBack.current = true; router.back() }
    else if (fallback) router.push(fallback)
  }

  function handleSignOut() {
    signOut()
    router.push('/')
  }

  const sidebar = (
    <>
      <div className="flex h-16 flex-shrink-0 items-center justify-between px-5">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="h-8 w-8"><LogoMark className="text-black"/></div>
          <span className="font-display text-xl tracking-tight text-gray-900">theoflow</span>
        </Link>
        <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Close menu"
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 lg:hidden">
          <X className="h-5 w-5"/>
        </button>
      </div>

      <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {groups.map((g, i) => (
          <div key={g.label ?? `group-${i}`}>
            {g.label && (
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                {g.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {g.items.map(item => {
                const active = isNavItemActive(item, path)
                const Icon = item.icon
                return (
                  <li key={item.href}>
                    <Link href={item.href} aria-current={active ? 'page' : undefined}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                        active ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                      }`}>
                      <Icon className="h-4 w-4 flex-shrink-0"/>
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex-shrink-0 border-t border-gray-100 p-3">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-black">
            <span className="text-xs font-medium text-white">{initials}</span>
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-gray-900">{name}</p>
            <p className="truncate text-[11px] text-gray-400">{email}</p>
          </div>
        </div>
        <Link href="/billing"
          className="mt-1 flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900">
          <CreditCard className="h-4 w-4 flex-shrink-0"/>
          Billing
        </Link>
        <button type="button" onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-red-600 transition-colors hover:bg-red-50">
          <LogOut className="h-4 w-4 flex-shrink-0"/>
          Sign out
        </button>
      </div>
    </>
  )

  return (
    <div className="min-h-screen bg-white">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-gray-100 bg-white lg:flex">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div aria-hidden="true" onClick={() => setDrawerOpen(false)} className="absolute inset-0 bg-black/30"/>
          <aside role="dialog" aria-modal="true" aria-label="Menu"
            className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white shadow-xl">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-gray-100 bg-white/90 px-4 backdrop-blur-md sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Open menu"
              className="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 lg:hidden">
              <Menu className="h-5 w-5"/>
            </button>
            {canGoBack && (
              <button type="button" onClick={goBack} aria-label="Go back"
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] font-medium text-gray-600 hover:bg-gray-100 hover:text-black">
                <ArrowLeft className="h-4 w-4"/>
                Back
              </button>
            )}
            <Link href="/dashboard" className="flex items-center gap-2 lg:hidden">
              <div className="h-7 w-7"><LogoMark className="text-black"/></div>
            </Link>
            {orgName && <span className="truncate text-[13px] text-gray-500">{orgName}</span>}
          </div>
          <div className="flex items-center gap-3">
            {onPilot && role === 'admin' && (
              <Link href="/billing"
                className="rounded-full bg-amber-50 px-3 py-1 text-[12px] font-medium text-amber-800 hover:bg-amber-100">
                Pilot: {access.daysLeft === 0 ? 'ends today' : `${access.daysLeft} day${access.daysLeft !== 1 ? 's' : ''} left`}
              </Link>
            )}
            {!loading && subscribedProducts.includes('harvest') && <NotificationBell />}
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
          {locked ? (
            <div role="status" className="mx-auto max-w-md rounded-2xl border border-black/[0.08] px-8 py-14 text-center">
              <p className="text-[17px] font-semibold text-black">Your products are locked</p>
              <p className="mt-2 text-[13px] leading-relaxed text-gray-500">
                Your pilot was cancelled. Nothing has been deleted, and everything is here waiting when you carry on.
              </p>
              {role === 'admin' ? (
                <Link href="/billing/upgrade"
                  className="mt-6 inline-block rounded-full bg-black px-6 py-2.5 text-[13px] font-medium text-white hover:bg-black/85">
                  Start the paid plan
                </Link>
              ) : (
                <p className="mt-6 text-[13px] text-gray-400">Ask your organisation admin to start the paid plan.</p>
              )}
            </div>
          ) : children}
        </main>
      </div>
    </div>
  )
}
