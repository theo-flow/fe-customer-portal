'use client'
// No em dashes or double dashes in any text here -- use a single hyphen (-). See CLAUDE.md.
import { useState } from 'react'
import { MarketingNav } from '@/components/MarketingNav'
import { MarketingFooter } from '@/components/MarketingFooter'
import { INTEREST_OPTIONS, CONTACT_MESSAGE_MAX as MESSAGE_MAX } from '@/lib/contact-form'

type Status = 'idle' | 'submitting' | 'sent' | 'error'

export default function ContactPage() {
  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [org, setOrg]           = useState('')
  const [website, setWebsite]   = useState('')
  const [interest, setInterest] = useState('')
  const [message, setMessage]   = useState('')
  const [status, setStatus]     = useState<Status>('idle')
  const [error, setError]       = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim() || !email.trim() || !org.trim() || !interest) {
      setError('Name, email, organisation and what you need help with are required.')
      return
    }
    setStatus('submitting')
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, org, website, interest, message }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Something went wrong. Please try again.')
      }
      setStatus('sent')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setStatus('error')
    }
  }

  return (
    <div className="bg-white overflow-x-hidden w-full">
      <MarketingNav />
      <div className="h-[56px]" />

      <section className="max-w-[560px] mx-auto px-8 pt-8 pb-12">
        <div className="text-center mb-5">
          <span className="inline-flex text-[11px] font-semibold text-gray-400 uppercase
                           tracking-[0.10em] border border-gray-200 rounded-full px-3 py-[5px]">
            Contact
          </span>
          <p className="mt-3 text-[13px] text-gray-500 leading-relaxed">
            Questions about the product suite, pricing, or onboarding your organisation -
            send a message and we&apos;ll get back to you.
          </p>
        </div>

        {status === 'sent' ? (
          <div role="status" className="rounded-2xl border border-gray-100 bg-[#F5F6FA] px-6 py-8 text-center">
            <p className="text-[14px] font-medium text-black">Message sent.</p>
            <p className="mt-1.5 text-[13px] text-gray-500">We&apos;ll be in touch shortly.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="space-y-3">
            {error && (
              <div role="alert" className="px-4 py-3 rounded-xl text-[13px] text-red-600 bg-red-50 border border-red-100">
                {error}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Name">
                <LightInput value={name} onChange={e => setName(e.target.value)}
                  autoComplete="name" placeholder="Your name" required maxLength={200} />
              </Field>
              <Field label="Email address">
                <LightInput type="email" value={email} onChange={e => setEmail(e.target.value)}
                  autoComplete="email" placeholder="you@example.com" required maxLength={200} />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Organisation">
                <LightInput value={org} onChange={e => setOrg(e.target.value)}
                  autoComplete="organization" placeholder="Your organisation" required maxLength={200} />
              </Field>
              <Field label="Website (optional)">
                <LightInput type="url" value={website} onChange={e => setWebsite(e.target.value)}
                  placeholder="yourcompany.com" maxLength={255} />
              </Field>
            </div>
            <Field label="What do you need help with?">
              <select value={interest} onChange={e => setInterest(e.target.value)} required
                className="w-full px-4 py-3 rounded-xl text-[14px] text-black border border-gray-200
                           outline-none focus:border-gray-400 transition-colors bg-white appearance-none">
                <option value="" disabled>Select one…</option>
                {INTEREST_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </Field>
            <Field label={`Additional details (optional) - ${message.length}/${MESSAGE_MAX}`}>
              <textarea value={message}
                onChange={e => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
                rows={3} maxLength={MESSAGE_MAX} placeholder="Anything else we should know?"
                className="w-full px-4 py-3 rounded-xl text-[14px] text-black border border-gray-200
                           outline-none focus:border-gray-400 transition-colors resize-none" />
            </Field>
            <button type="submit" disabled={status === 'submitting'}
              className="w-full bg-black text-white text-[13px] font-medium py-3.5 rounded-full
                         hover:bg-gray-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {status === 'submitting' ? 'Sending…' : 'Send message'}
            </button>
          </form>
        )}
      </section>

      <MarketingFooter />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-gray-500 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function LightInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props}
      className="w-full px-4 py-3 rounded-xl text-[14px] text-black border border-gray-200
                 outline-none focus:border-gray-400 transition-colors" />
  )
}
