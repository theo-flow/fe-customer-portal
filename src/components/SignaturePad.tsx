'use client'
import { useEffect, useRef, useState } from 'react'
import SignatureCanvas from 'react-signature-canvas'

// A printed form's signature line, rendered inline as a real field -- Forge
// keeps it as field_type "signature" (docs/forge-design-method.md), so it
// gets filled in as part of the same form, not a separate emailed link.
// Same draw-or-type pattern and the same library (react-signature-canvas) as
// TheoFlow Sign's own AdoptMark (src/app/sign/[sessionId]/[signerId]/
// [token]/AdoptMark.tsx) -- that component's own state is lifted into its
// parent page across a multi-step signing flow, which doesn't fit
// FieldInput's plain value/onChange contract, so this is a self-contained
// version of the same UX rather than a literal import.
export type SignatureMode = 'draw' | 'type'

export default function SignaturePad({ value, onChange, label, error }: {
  value:    string
  onChange: (val: string) => void
  label:    string
  error?:   string
}) {
  const [mode, setMode] = useState<SignatureMode>('draw')
  const canvasRef = useRef<SignatureCanvas>(null)

  // Resize the drawing surface to its real on-screen size (react-signature-
  // canvas sizes to 0x0 if measured before layout settles) and restore
  // value on mount, e.g. after a validation error re-renders the page.
  useEffect(() => {
    const pad = canvasRef.current
    const canvas = pad?.getCanvas()
    if (!pad || !canvas || !canvas.offsetWidth || !canvas.offsetHeight) return
    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    const w = Math.round(canvas.offsetWidth * ratio)
    const h = Math.round(canvas.offsetHeight * ratio)
    if (canvas.width === w && canvas.height === h) return
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')?.scale(ratio, ratio)
    if (value && value.startsWith('data:image')) pad.fromDataURL(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function draw() {
    const pad = canvasRef.current
    if (!pad || pad.isEmpty()) { onChange(''); return }
    // toDataURL(), not getTrimmedCanvas().toDataURL() -- the latter throws
    // ("trim_canvas is not a function") in this dev environment; the real,
    // production Sign flow (SignCapture.tsx) already reads out a drawn
    // signature via plain toDataURL(), so this matches the proven path.
    onChange(pad.toDataURL('image/png'))
  }

  function clear() {
    canvasRef.current?.clear()
    onChange('')
  }

  const tab = (m: SignatureMode, text: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => setMode(m)}
      className={`flex-1 py-2 rounded-lg text-[13px] font-medium transition-colors
                 ${mode === m ? 'bg-white text-black shadow-sm' : 'text-gray-500'}`}>
      {text}
    </button>
  )

  return (
    <div>
      <label className="block font-medium text-black text-[13px] mb-1.5">{label}</label>
      <div role="tablist" aria-label={`How to add your ${label}`} className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-2">
        {tab('draw', 'Draw')}
        {tab('type', 'Type')}
      </div>

      <div hidden={mode !== 'draw'}>
        <div className={`rounded-xl overflow-hidden bg-gray-50 border ${error ? 'border-red-400' : 'border-black/[0.12]'}`}>
          <SignatureCanvas
            ref={canvasRef}
            penColor="black"
            onEnd={draw}
            canvasProps={{ className: 'w-full h-[120px] touch-none', 'aria-label': label } as React.CanvasHTMLAttributes<HTMLCanvasElement>}
          />
        </div>
        <button type="button" onClick={clear}
                className="mt-1.5 text-[12px] font-medium text-gray-400 hover:text-black transition-colors">
          Clear
        </button>
      </div>

      <div hidden={mode !== 'type'}>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Type your name"
          className={`w-full rounded-xl border bg-white outline-none px-4 py-3 text-[22px] italic
                     ${error ? 'border-red-400' : 'border-black/[0.12] focus:border-black/40 focus:ring-2 focus:ring-black/5'}`}
        />
      </div>

      {error && <p className="mt-1.5 text-[12px] text-red-500">{error}</p>}
    </div>
  )
}
