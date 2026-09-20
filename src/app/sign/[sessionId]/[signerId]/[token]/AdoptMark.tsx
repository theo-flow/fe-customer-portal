'use client'
import type { RefObject } from 'react'
import SignatureCanvas from 'react-signature-canvas'

export type MarkMode = 'draw' | 'type'

// One mark the signer adopts (their signature, or their initials): draw it or
// type it. Both views stay mounted and only one is shown, so switching tabs or
// moving to another step never loses what was drawn.
export default function AdoptMark({
  label, mode, onMode, canvasRef, typed, onTyped, typedLabel, typedPlaceholder, typedClass, visible,
}: {
  label:            string
  mode:             MarkMode
  onMode:           (m: MarkMode) => void
  canvasRef:        RefObject<SignatureCanvas>
  typed:            string
  onTyped:          (v: string) => void
  typedLabel:       string
  typedPlaceholder: string
  typedClass:       string
  visible:          boolean
}) {
  const tab = (m: MarkMode, text: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => onMode(m)}
      className={`flex-1 py-2 rounded-lg text-[13px] font-medium transition-colors
                 ${mode === m ? 'bg-white text-black shadow-sm' : 'text-gray-500'}`}>
      {text}
    </button>
  )

  return (
    <div hidden={!visible} className="space-y-4">
      <div role="tablist" aria-label={`How to add your ${label}`} className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {tab('draw', 'Draw')}
        {tab('type', 'Type')}
      </div>

      <div hidden={mode !== 'draw'}>
        <div className="border border-black/[0.12] rounded-xl overflow-hidden bg-gray-50">
          <SignatureCanvas
            ref={canvasRef}
            penColor="black"
            canvasProps={{ className: 'w-full h-[150px]', 'aria-label': `Draw your ${label}` } as React.CanvasHTMLAttributes<HTMLCanvasElement>}
          />
        </div>
        <button type="button" onClick={() => canvasRef.current?.clear()}
                className="mt-2 text-[12px] font-medium text-gray-400 hover:text-black transition-colors">
          Clear
        </button>
      </div>

      <div hidden={mode !== 'type'}>
        <label className="block text-[13px] font-medium text-black mb-1.5" htmlFor={`typed-${label}`}>{typedLabel}</label>
        <input
          id={`typed-${label}`}
          type="text"
          value={typed}
          onChange={e => onTyped(e.target.value)}
          placeholder={typedPlaceholder}
          className={typedClass}
        />
      </div>
    </div>
  )
}
