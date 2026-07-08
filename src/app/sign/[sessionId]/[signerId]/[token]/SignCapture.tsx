'use client'
import { useRef, useState } from 'react'
import SignatureCanvas from 'react-signature-canvas'

type Mode = 'draw' | 'type'

export default function SignCapture({
  sessionId, signerId, token,
}: {
  sessionId: string
  signerId:  string
  token:     string
}) {
  const [mode, setMode]           = useState<Mode>('draw')
  const [typedName, setTypedName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [done, setDone]           = useState(false)
  const sigRef = useRef<SignatureCanvas>(null)

  async function handleSubmit() {
    setError(null)

    let signatureType: 'DRAWN' | 'TYPED'
    let signatureData: string

    if (mode === 'draw') {
      if (!sigRef.current || sigRef.current.isEmpty()) {
        setError('Please draw your signature before submitting.')
        return
      }
      signatureType = 'DRAWN'
      signatureData = sigRef.current.toDataURL('image/png')
    } else {
      if (!typedName.trim()) {
        setError('Please type your name before submitting.')
        return
      }
      signatureType = 'TYPED'
      signatureData = typedName.trim()
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/public/sign/${sessionId}/${signerId}/${token}/submit`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ signatureType, signatureData }),
      })
      if (res.ok) {
        setDone(true)
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Something went wrong. Please try again.')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-5">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24"
               stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
          </svg>
        </div>
        <h2 className="text-[20px] font-semibold text-black mb-2">Signed</h2>
        <p className="text-[14px] text-gray-500">Thank you — your signature has been recorded.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        <button
          type="button"
          onClick={() => setMode('draw')}
          className={`flex-1 py-2 rounded-lg text-[13px] font-medium transition-colors
                     ${mode === 'draw' ? 'bg-white text-black shadow-sm' : 'text-gray-500'}`}>
          Draw
        </button>
        <button
          type="button"
          onClick={() => setMode('type')}
          className={`flex-1 py-2 rounded-lg text-[13px] font-medium transition-colors
                     ${mode === 'type' ? 'bg-white text-black shadow-sm' : 'text-gray-500'}`}>
          Type
        </button>
      </div>

      {mode === 'draw' ? (
        <div>
          <div className="border border-black/[0.12] rounded-xl overflow-hidden bg-gray-50">
            <SignatureCanvas
              ref={sigRef}
              penColor="black"
              canvasProps={{ className: 'w-full h-[150px]' }}
            />
          </div>
          <button
            type="button"
            onClick={() => sigRef.current?.clear()}
            className="mt-2 text-[12px] font-medium text-gray-400 hover:text-black transition-colors">
            Clear
          </button>
        </div>
      ) : (
        <div>
          <label className="block text-[13px] font-medium text-black mb-1.5">Type your full name</label>
          <input
            type="text"
            value={typedName}
            onChange={e => setTypedName(e.target.value)}
            placeholder="Your full name"
            className="w-full px-4 py-3 rounded-xl border border-black/[0.12] text-[22px] italic
                       bg-white outline-none focus:border-black/40 focus:ring-2 focus:ring-black/5 transition-all"
          />
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full py-3.5 rounded-xl bg-black text-white text-[14px] font-semibold
                   hover:bg-gray-800 active:bg-gray-900 transition-colors disabled:opacity-50
                   disabled:cursor-not-allowed">
        {submitting ? 'Submitting…' : 'Submit signature'}
      </button>
    </div>
  )
}
