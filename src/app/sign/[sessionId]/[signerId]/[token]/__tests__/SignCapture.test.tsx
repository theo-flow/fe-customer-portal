import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { DetectedField } from '@/lib/sign'

// Which canvases the "signer" has drawn on, keyed by the canvas label.
const drawn = vi.hoisted(() => new Set<string>())

vi.mock('react-signature-canvas', async () => {
  const React = await import('react')
  const Canvas = React.forwardRef((props: { canvasProps?: Record<string, string> }, ref: React.Ref<unknown>) => {
    const label = props.canvasProps?.['aria-label'] ?? 'canvas'
    React.useImperativeHandle(ref, () => ({
      isEmpty: () => !drawn.has(label),
      toDataURL: () => `data:image/png;base64,DRAWN-${label}`,
      clear: () => { drawn.delete(label) },
    }))
    return <canvas aria-label={label} />
  })
  Canvas.displayName = 'MockSignatureCanvas'
  return { default: Canvas }
})

// react-pdf cannot run in jsdom: the preview becomes a list of the boxes it was given.
vi.mock('next/dynamic', () => ({
  default: () => function Preview({ fields }: { fields: DetectedField[] }) {
    return <div data-testid="preview">{fields.map(f => <span key={f.field_id ?? f.y}>{f.field_type}</span>)}</div>
  },
}))

import SignCapture from '../SignCapture'

const box = (over: Partial<DetectedField>): DetectedField => ({
  field_id: 'x', field_type: 'signature', signer_order: 1, page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.04,
  source: 'org_configured', confidence: 1, ...over,
})

const CUSTOMER: DetectedField[] = [
  box({ field_id: 'i1', field_type: 'initials', page: 1, y: 0.94, x: 0.85, instruction: 'Initial here to confirm you have read this page' }),
  box({ field_id: 's1', field_type: 'signature', page: 2, y: 0.79, instruction: 'Sign here' }),
  box({ field_id: 'p1', field_type: 'place', page: 2, y: 0.79, x: 0.5, instruction: 'Write where you are signing' }),
  box({ field_id: 'd1', field_type: 'date', page: 2, y: 0.82, instruction: 'The date is filled in for you' }),
]
const WITNESS: DetectedField[] = [box({ field_id: 'w1', page: 2, y: 0.86, instruction: 'Sign as a witness' })]

const json = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response

function serve(doc: Record<string, unknown> | 'fail', submit: Response = json({ ok: true })) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/document')) return doc === 'fail' ? json({}, false, 500) : json({ url: 'https://s3/x.pdf', ...doc })
    if (url.endsWith('/submit')) return submit
    return json({}, false, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const customerDoc = { detectedFields: CUSTOMER, signerName: 'Thandi Nkosi', signerRole: 'Customer', formName: 'New AOA' }
const mount = () => render(<SignCapture sessionId="sess-1" signerId="signer-1" token="tok" />)
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }))
const stepLabel = () => screen.getByText(/^Step \d+ of \d+$/).textContent
const submittedBody = (fetchMock: ReturnType<typeof serve>) =>
  JSON.parse((fetchMock.mock.calls.find(c => String(c[0]).endsWith('/submit'))![1] as unknown as RequestInit).body as string)

describe('SignCapture (the signer\'s step-by-step page)', () => {
  beforeEach(() => { drawn.clear() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('starts with a numbered checklist of exactly what this person has to do, in the operator\'s words', async () => {
    serve(customerDoc)
    mount()
    await screen.findByText('Thandi Nkosi, here is what you need to do')
    expect(stepLabel()).toBe('Step 1 of 5')
    expect(screen.getByText(/You are signing as/)).toHaveTextContent('You are signing as Customer.')

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(items[0]).toHaveTextContent('1Page 1: Initial here to confirm you have read this page')
    expect(items[1]).toHaveTextContent('2Page 2: Sign here')
    expect(items[2]).toHaveTextContent('3Page 2: Write where you are signing')
    expect(items[3]).toHaveTextContent('4Page 2: The date is filled in for youfilled in for you')
  })

  it('walks the customer through signature, initials, place and review, then submits everything', async () => {
    const fetchMock = serve(customerDoc)
    mount()
    await screen.findByText(/here is what you need to do/)
    next()

    // step 2: signature, cannot skip
    expect(stepLabel()).toBe('Step 2 of 5')
    expect(screen.getByText('It will be placed on page 2. Draw it, or type your name.')).toBeVisible()
    next()
    expect(screen.getByRole('alert')).toHaveTextContent('Please add your signature.')
    expect(stepLabel()).toBe('Step 2 of 5')
    drawn.add('Draw your signature')
    next()

    // step 3: initials start as the letters of the name
    expect(stepLabel()).toBe('Step 3 of 5')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect((screen.getByLabelText('Type your initials') as HTMLInputElement).value).toBe('TN')
    next()

    // step 4: where signed, cannot skip
    expect(stepLabel()).toBe('Step 4 of 5')
    next()
    expect(screen.getByRole('alert')).toHaveTextContent('Please say where you are signing (page 2).')
    fireEvent.change(screen.getByLabelText('Page 2: Write where you are signing'), { target: { value: 'Cape Town' } })
    next()

    // step 5: review with the document, then finish
    expect(stepLabel()).toBe('Step 5 of 5')
    expect(screen.getByTestId('preview')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Submit and finish' }))

    await screen.findByText('Signed')
    expect(screen.getByText('Thank you, your signature has been recorded.')).toBeInTheDocument()
    expect(submittedBody(fetchMock)).toEqual({
      signatureType: 'DRAWN', signatureData: 'data:image/png;base64,DRAWN-Draw your signature',
      initialsType: 'TYPED', initialsData: 'TN',
      placeValues: { p1: 'Cape Town' }, placeData: 'Cape Town',
    })
  })

  it('a witness only sees the steps that apply to them', async () => {
    serve({ detectedFields: WITNESS, signerName: 'Sipho Dlamini', signerRole: 'Witness 1', formName: 'New AOA' })
    mount()
    await screen.findByText(/here is what you need to do/)
    expect(stepLabel()).toBe('Step 1 of 3')
    expect(screen.getByText('Witness 1')).toBeInTheDocument()
    next()
    expect(screen.queryByText('Your initials', { selector: 'h2' })).not.toBeInTheDocument()   // a witness is never asked for initials
    drawn.add('Draw your signature')
    next()
    expect(stepLabel()).toBe('Step 3 of 3')   // straight to review: no initials, no place
  })

  it('accepts a typed signature instead of a drawn one', async () => {
    const fetchMock = serve({ detectedFields: WITNESS, signerName: 'Sipho Dlamini', signerRole: 'Witness 1', formName: null })
    mount()
    await screen.findByText(/here is what you need to do/)
    next()
    fireEvent.click(screen.getByRole('tab', { name: 'Type' }))
    fireEvent.change(screen.getByLabelText('Type your full name'), { target: { value: '  Sipho Dlamini ' } })
    next()
    fireEvent.click(screen.getByRole('button', { name: 'Submit and finish' }))
    await screen.findByText('Signed')
    expect(submittedBody(fetchMock)).toMatchObject({ signatureType: 'TYPED', signatureData: 'Sipho Dlamini' })
  })

  it('lets the signer change their initials, and sends what they typed', async () => {
    const fetchMock = serve({ ...customerDoc, detectedFields: [CUSTOMER[0], CUSTOMER[1]] })
    mount()
    await screen.findByText(/here is what you need to do/)
    next(); drawn.add('Draw your signature'); next()
    fireEvent.change(screen.getByLabelText('Type your initials'), { target: { value: 'T.N' } })
    next()
    fireEvent.click(screen.getByRole('button', { name: 'Submit and finish' }))
    await screen.findByText('Signed')
    expect(submittedBody(fetchMock)).toMatchObject({ initialsType: 'TYPED', initialsData: 'T.N' })
  })

  it('will not go past the initials step with them cleared', async () => {
    serve({ ...customerDoc, detectedFields: [CUSTOMER[0], CUSTOMER[1]] })
    mount()
    await screen.findByText(/here is what you need to do/)
    next(); drawn.add('Draw your signature'); next()
    fireEvent.change(screen.getByLabelText('Type your initials'), { target: { value: '' } })
    next()
    expect(screen.getByRole('alert')).toHaveTextContent('Please add your initials.')
  })

  it('keeps what was entered when the signer goes back and forward again', async () => {
    serve(customerDoc)
    mount()
    await screen.findByText(/here is what you need to do/)
    next(); drawn.add('Draw your signature'); next(); next()
    fireEvent.change(screen.getByLabelText('Page 2: Write where you are signing'), { target: { value: 'Durban' } })
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(stepLabel()).toBe('Step 2 of 5')
    expect(drawn.has('Draw your signature')).toBe(true)
    next(); next()
    expect((screen.getByLabelText('Page 2: Write where you are signing') as HTMLInputElement).value).toBe('Durban')
    next()
    expect(stepLabel()).toBe('Step 5 of 5')
  })

  it('has no Back button on the first step', async () => {
    serve(customerDoc)
    mount()
    await screen.findByText(/here is what you need to do/)
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })

  it('an older session with no boxes asks for a signature and a final check, as before', async () => {
    const fetchMock = serve({ detectedFields: [], signerName: 'Jane', signerRole: null, formName: null })
    mount()
    await screen.findByText('Your signature', { selector: 'h2' })
    expect(stepLabel()).toBe('Step 1 of 2')
    expect(screen.queryByText(/here is what you need to do/)).not.toBeInTheDocument()
    drawn.add('Draw your signature')
    next()
    fireEvent.click(screen.getByRole('button', { name: 'Submit and finish' }))
    await screen.findByText('Signed')
    expect(submittedBody(fetchMock)).toMatchObject({ signatureType: 'DRAWN' })
  })

  it('shows the server\'s message and stays on the last step when submitting fails', async () => {
    serve(customerDoc, json({ error: 'This signing link has expired or already been used' }, false, 403))
    mount()
    await screen.findByText(/here is what you need to do/)
    next(); drawn.add('Draw your signature'); next(); next()
    fireEvent.change(screen.getByLabelText('Page 2: Write where you are signing'), { target: { value: 'Cape Town' } })
    next()
    fireEvent.click(screen.getByRole('button', { name: 'Submit and finish' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('expired or already been used'))
    expect(screen.queryByText('Signed')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit and finish' })).toBeEnabled()   // can retry
  })

  it('offers a reload when the document cannot be loaded', async () => {
    serve('fail')
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('This document could not be loaded.')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('never shows a long dash anywhere in what the signer reads', async () => {
    serve(customerDoc)
    const { container } = mount()
    await screen.findByText(/here is what you need to do/)
    for (let i = 0; i < 4; i++) next()
    expect(container.textContent).not.toContain(String.fromCharCode(0x2014))
    expect(container.textContent).not.toContain('--')
  })
})
