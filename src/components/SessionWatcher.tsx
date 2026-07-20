'use client'
import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getAuthCookie, signOut } from '@/lib/auth'
import { decodeJwtClaims } from '@/lib/token'

// Middleware only runs on navigation -- a tab left sitting on an already-
// loaded protected page has no way to notice its token expired underneath
// it until the user happens to click something. This catches that case:
// mounted once in the (portal) layout, so every protected page gets it
// automatically with no per-page wiring.
const CHECK_INTERVAL_MS = 30_000

function isExpired(token: string): boolean {
  const { exp } = decodeJwtClaims(token)
  return !exp || Date.now() / 1000 > exp
}

export default function SessionWatcher() {
  const router   = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    function checkSession() {
      const token = getAuthCookie()
      const next  = encodeURIComponent(pathname)

      // No token at all is a distinct case from a token that expired --
      // mirrors middleware.ts, which only tags the redirect "expired" when
      // a token actually existed and failed the check. Treating "never
      // had a session" as "expired" is what caused reason=expired to show
      // up for users who hadn't logged in.
      if (!token) {
        signOut()
        router.push(`/login?next=${next}`)
        return
      }

      if (isExpired(token)) {
        signOut()
        router.push(`/login?reason=expired&next=${next}`)
      }
    }

    checkSession()
    const interval = setInterval(checkSession, CHECK_INTERVAL_MS)

    // Re-check immediately on refocus -- the common real case is a tab left
    // idle well past expiry, then returned to; waiting for the next interval
    // tick would leave a stale page visible for up to CHECK_INTERVAL_MS.
    function handleVisibility() {
      if (document.visibilityState === 'visible') checkSession()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [router, pathname])

  return null
}
