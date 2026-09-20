import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { createRef } from 'react'
import type SignatureCanvas from 'react-signature-canvas'
import AdoptMark from '../AdoptMark'

// A pad that behaves like the real one: its drawing surface only has a size once
// somebody sets it, and a canvas that is hidden measures 0 wide.
const scale = vi.fn()
const surface = { width: 0, height: 0, offsetWidth: 0, offsetHeight: 0, getContext: () => ({ scale }) }
const strokes = [{ points: [{ x: 1, y: 1 }] }]
const clear = vi.fn()
const fromData = vi.fn()

vi.mock('react-signature-canvas', async () => {
  const React = await import('react')
  const Pad = React.forwardRef((_props: unknown, ref: React.Ref<unknown>) => {
    React.useImperativeHandle(ref, () => ({
      getCanvas: () => surface,
      toData: () => strokes,
      clear,
      fromData,
      isEmpty: () => true,
      toDataURL: () => '',
    }))
    return <canvas aria-label="pad" />
  })
  Pad.displayName = 'MockPad'
  return { default: Pad }
})

function pad(visible: boolean) {
  const ref = createRef<SignatureCanvas>()
  const props = {
    label: 'signature', mode: 'draw' as const, onMode: () => {}, canvasRef: ref, typed: '', onTyped: () => {},
    typedLabel: 'Type', typedPlaceholder: 'x', typedClass: '', visible,
  }
  return { ref, props }
}

describe('AdoptMark drawing surface', () => {
  it('gives the pad a real size when it is shown, after being mounted hidden', () => {
    Object.assign(surface, { width: 0, height: 0, offsetWidth: 0, offsetHeight: 0 })
    const { props } = pad(false)
    const { rerender } = render(<AdoptMark {...props} />)
    // still hidden: nothing to measure, so nothing is touched
    expect(surface.width).toBe(0)

    // the step is reached and the pad is shown: the browser now reports its real size
    Object.assign(surface, { offsetWidth: 596, offsetHeight: 150 })
    rerender(<AdoptMark {...props} visible />)
    expect(surface.width).toBeGreaterThan(0)
    expect(surface.height).toBeGreaterThan(0)
    expect(scale).toHaveBeenCalled()
    // whatever was already drawn is put back
    expect(fromData).toHaveBeenCalledWith(strokes)
  })

  it('leaves an already sized pad alone', () => {
    Object.assign(surface, { width: 596, height: 150, offsetWidth: 596, offsetHeight: 150 })
    clear.mockClear(); fromData.mockClear()
    const { props } = pad(true)
    render(<AdoptMark {...props} />)
    expect(clear).not.toHaveBeenCalled()
    expect(fromData).not.toHaveBeenCalled()
  })
})
