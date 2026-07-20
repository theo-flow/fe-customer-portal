import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Contact | theoflow',
  description: 'Get in touch about the theoflow product suite, pricing, or onboarding your organisation.',
  alternates: { canonical: '/contact' },
}

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children
}
