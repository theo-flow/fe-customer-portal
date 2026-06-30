import { NextRequest, NextResponse } from 'next/server'

// Routes that require a valid session
const PROTECTED = ['/dashboard', '/upload', '/status', '/forms', '/submissions', '/templates']

// Routes that authenticated users should be bounced away from
const AUTH_ROUTES = ['/login', '/register', '/verify', '/forgot-password']

function isExpired(token: string): boolean {
  try {
    const payload = token.split('.')[1]
    const { exp } = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp: number }
    return Date.now() / 1000 > exp
  } catch {
    return true
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const token = req.cookies.get('tf_token')?.value
  const authenticated = token && !isExpired(token)

  // Redirect logged-in users away from auth pages
  if (AUTH_ROUTES.some(r => pathname.startsWith(r))) {
    if (authenticated) {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
    return NextResponse.next()
  }

  // Protect portal routes
  if (PROTECTED.some(r => pathname.startsWith(r))) {
    if (!authenticated) {
      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/upload/:path*',
    '/status/:path*',
    '/forms/:path*',
    '/submissions/:path*',
    '/templates/:path*',
    '/login',
    '/register',
    '/verify',
    '/forgot-password',
  ],
}
