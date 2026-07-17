import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import './globals.css'

// Self-hosted, not next/font/google: that requires a live fetch to
// fonts.googleapis.com/fonts.gstatic.com at build time, which fails in any
// network-restricted environment (locked-down CI runners, this project's
// own sandboxed dev sessions -- confirmed via a raw curl failure too, not
// just Node's fetch, so it wasn't fixable in code without removing the
// network dependency entirely). Variable-font files keep this to 4 files
// total while still covering the full weight/style range the app uses --
// see src/app/fonts/README.md for exactly what to place here.
const playfairDisplay = localFont({
  src: [
    { path: './fonts/PlayfairDisplay-Variable.woff2', weight: '400 900', style: 'normal' },
    { path: './fonts/PlayfairDisplay-Italic-Variable.woff2', weight: '400 900', style: 'italic' },
  ],
  variable: '--font-display',
  display: 'swap',
})

const inter = localFont({
  src: './fonts/Inter-Variable.woff2',
  weight: '100 900',
  variable: '--font-body',
  display: 'swap',
})

const jetbrains = localFont({
  src: './fonts/JetBrainsMono-Variable.woff2',
  weight: '100 800',
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'theoflow | Document Intelligence',
  description: 'Upload and track your insurance documents — fast, secure, paperless.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${playfairDisplay.variable} ${inter.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  )
}
