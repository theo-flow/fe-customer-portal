import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Contact | theoflow',
  description: 'Get in touch about the theoflow product suite, pricing, or onboarding your organisation.',
  alternates: { canonical: '/contact' },
  openGraph: {
    title: 'Contact | theoflow',
    description: 'Get in touch about the theoflow product suite, pricing, or onboarding your organisation.',
    url: '/contact',
    siteName: 'theoflow',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'theoflow - Document Intelligence' }],
    locale: 'en_ZA',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Contact | theoflow',
    description: 'Get in touch about the theoflow product suite, pricing, or onboarding your organisation.',
    images: ['/og-image.png'],
  },
}

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children
}
