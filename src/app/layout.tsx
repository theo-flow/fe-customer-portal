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
  metadataBase: new URL('https://theoflow.bytheodore.co.za'),
  title: 'theoflow | Digital Forms Intelligence Platform',
  description: 'Upload any document — theoflow classifies, extracts, validates and files it, without a single manual step.',
  verification: {
    google: 'EV2SfQwTeTGjwd_xITbZDRfPjmPASWDQ0t9oMAm3yIs',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
}

const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: 'theoflow',
      url: 'https://theoflow.bytheodore.co.za',
      logo: 'https://theoflow.bytheodore.co.za/icon.svg',
    },
    {
      '@type': 'WebSite',
      name: 'theoflow',
      url: 'https://theoflow.bytheodore.co.za',
    },
    {
      '@type': 'SiteNavigationElement',
      name: ['About', 'Product', 'Features', 'Contact'],
      url: [
        'https://theoflow.bytheodore.co.za/about',
        'https://theoflow.bytheodore.co.za/product',
        'https://theoflow.bytheodore.co.za/features',
        'https://theoflow.bytheodore.co.za/contact',
      ],
    },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${playfairDisplay.variable} ${inter.variable} ${jetbrains.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        {children}
      </body>
    </html>
  )
}
