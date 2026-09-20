import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { DetectedField } from '@/lib/sign'
import { formatChosenDate, todaySAST, dateBounds } from '@/lib/sign-tasks'
import { CONSENT_TEXT, CONSENT_VERSION } from '@/lib/sign-consent'

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
      getCanvas: () => document.createElement('canvas'),
      toData: () => [],
      fromData: () => {},
    }))
    return <canvas aria-label={label} />
  })
  Canvas.displayName = 'MockSignatureCanvas'
  return { default: Canvas }
})

// react-pdf cannot run in jsdom: the document becomes one clickable box per field,
// showing whatever value the page has put into it.
vi.mock('next/dynamic', () => ({
  default: () => function Preview({ fields, values, activeType, onBoxClick }: {
    fields: DetectedField[]
    values?: Record<string, { kind: string; value: string }>
    activeType?: string | null
    onBoxClick?: (f: DetectedField) => void
  }) {
    return (
      <div data-testid="preview" data-active={activeType ?? ''}>
        {fields.map(f => (
          <button key={f.field_id ?? f.y} type="button" data-testid={`box-${f.field_id}`} onClick={() => onBoxClick?.(f)}>
            {f.field_id ? (values?.[f.field_id]?.value ?? '') : ''}
          </button>
        ))}
      </div>
    )
  },
}))

import SignCapture from '../SignCapture'

const box = (over: Partial<DetectedField>): DetectedField => ({
  field_id: 'x', field_type: 'signature', signer_order: 1, page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.04,
  source: 'org_configured', confidence: 1, ...over,
})

// The customer's boxes on the New AOA
const CUSTOMER: DetectedField[] = [
  box({ field_id: 'i1', field_type: 'initials', page: 1, y: 0.94, x: 0.85, instruction: 'Initial here to confirm you have read this page' }),
  box({ field_id: 'i2', field_type: 'initials', page: 2, y: 0.94, x: 0.85, instruction: 'Initial here to confirm you have read this page' }),
  box({ field_id: 's1', field_type: 'signature', page: 2, y: 0.79, instruction: 'Sign here' }),
  box({ field_id: 'p1', field_type: 'place', page: 2, y: 0.79, x: 0.5, instruction: 'Write where you are signing' }),
  box({ field_id: 'd1', field_type: 'date', page: 2, y: 0.82, x: 0.1, date_format: 'day_month', instruction: 'Choose the date' }),
  box({ field_id: 'd2', field_type: 'date', page: 2, y: 0.82, x: 0.5, date_format: 'year_2', instruction: 'Choose the date' }),
  box({ field_id: 'n1', field_type: 'name', page: 2, y: 0.9, instruction: 'Print your full name' }),
]
const WITNESS: DetectedField[] = [box({ field_id: 'w1', page: 2, y: 0.86, instruction: 'Sign as a witness' })]

const json = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response

function serve(doc: Record<string, unknown> | 'fail', submit: Response = json({ ok: true }), decline: Response = json({ ok: true })) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/document')) return doc === 'fail' ? json({}, false, 500) : json({ url: 'https://s3/x.pdf', ...doc })
    if (url.endsWith('/submit')) return submit
    if (url.endsWith('/decline')) return decline
    return json({}, false, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const customerDoc = { detectedFields: CUSTOMER, signerName: 'Thandi Nkosi', signerRole: 'Customer', formName: 'New AOA' }
const mount = () => render(<SignCapture sessionId="sess-1" signerId="signer-1" token="tok" />)
const primary = (name: RegExp | string) => fireEvent.click(screen.getByRole('button', { name }))
const agree = () => fireEvent.click(screen.getByRole('checkbox', { name: CONSENT_TEXT }))
// Nothing can be sent until the whole document has been looked through.
async function reviewIt() {
  primary('Preview my signed document')
  await screen.findByText('Check your signed document')
  primary('This is correct')
  await screen.findByText('That is everything')
}
const boxText = (id: string) => screen.getByTestId(`box-${id}`).textContent
const submittedBody = (fetchMock: ReturnType<typeof serve>) =>
  JSON.parse((fetchMock.mock.calls.find(c => String(c[0]).endsWith('/submit'))![1] as unknown as RequestInit).body as string)

const declinedBody = (fetchMock: ReturnType<typeof serve>) =>
  JSON.parse((fetchMock.mock.calls.find(c => String(c[0]).endsWith('/decline'))![1] as unknown as RequestInit).body as string)

const yesterday = () => new Date(Date.now() + 2 * 3600000 - 86400000).toISOString().slice(0, 10)

// walks a customer to the date step
async function toDate() {
  mount()
  await screen.findByText(/here is what you need to do/)
  primary('Start')
  drawn.add('Draw your signature'); primary('Use this signature')
  primary('Use these initials')
  await screen.findByLabelText('Choose the date')
}

describe('SignCapture: the signer works on the document', () => {
  beforeEach(() => { drawn.clear() })
  afterEach(() => { vi.unstubAllGlobals() })

  describe('the checklist', () => {
    it('opens with one line per KIND of task, not one per box', async () => {
      serve(customerDoc)
      mount()
      await screen.findByText('Thandi Nkosi, here is what you need to do')
      expect(screen.getByText(/You are signing as/)).toHaveTextContent('You are signing as Customer.')
      const lines = screen.getAllByRole('listitem').map(li => li.textContent)
      expect(lines).toEqual([
        '1Sign on page 2',
        '2Initial on pages 1 and 2',
        '3Choose the date, it is written on page 2',
        '4Write where you are signing, on page 2',
      ])
      expect(screen.getByTestId('preview')).toBeInTheDocument()   // the document is on screen from the start
    })

    it('fills in the printed name straight away, since there is nothing to do', async () => {
      serve(customerDoc)
      mount()
      await screen.findByText(/here is what you need to do/)
      expect(boxText('n1')).toBe('Thandi Nkosi')
      expect(boxText('s1')).toBe('')
    })
  })

  describe('one kind of task at a time, with the boxes lighting up', () => {
    it('shows which step it is, what to do in the operator\'s words, and where it applies', async () => {
      serve(customerDoc)
      mount()
      await screen.findByText(/here is what you need to do/)
      primary('Start')
      expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
      expect(screen.getByText('Your signature', { selector: 'h2' })).toBeInTheDocument()
      expect(screen.getByText('Sign here')).toBeInTheDocument()
      expect(screen.getByText('Applies to page 2')).toBeInTheDocument()
      expect(screen.getByTestId('preview').getAttribute('data-active')).toBe('signature')
    })

    it('will not move on without a signature', async () => {
      serve(customerDoc)
      mount()
      await screen.findByText(/here is what you need to do/)
      primary('Start')
      primary('Use this signature')
      expect(screen.getByRole('alert')).toHaveTextContent('Please add your signature.')
      expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
    })

    it('one signature fills every signature box, and the initials step then applies to every page at once', async () => {
      serve(customerDoc)
      mount()
      await screen.findByText(/here is what you need to do/)
      primary('Start')
      drawn.add('Draw your signature')
      primary('Use this signature')
      expect(boxText('s1')).toBe('data:image/png;base64,DRAWN-Draw your signature')

      expect(screen.getByText('Step 2 of 4')).toBeInTheDocument()
      expect(screen.getByText('Applies to pages 1 and 2')).toBeInTheDocument()
      expect(screen.getByTestId('preview').getAttribute('data-active')).toBe('initials')
      // started from the name, and already showing in BOTH initials boxes before they press anything
      expect((screen.getByLabelText('Type your initials') as HTMLInputElement).value).toBe('TN')
      expect(boxText('i1')).toBe('TN')
      expect(boxText('i2')).toBe('TN')
    })

    it('what they type appears in the boxes as they type', async () => {
      serve(customerDoc)
      mount()
      await screen.findByText(/here is what you need to do/)
      primary('Start')
      fireEvent.click(screen.getByRole('tab', { name: 'Type' }))
      fireEvent.change(screen.getByLabelText('Type your full name'), { target: { value: 'Thandi Nkosi' } })
      expect(boxText('s1')).toBe('Thandi Nkosi')
      fireEvent.change(screen.getByLabelText('Type your full name'), { target: { value: 'Thandi N' } })
      expect(boxText('s1')).toBe('Thandi N')
    })

    it('will not move on without initials', async () => {
      serve(customerDoc)
      mount()
      await screen.findByText(/here is what you need to do/)
      primary('Start')
      drawn.add('Draw your signature'); primary('Use this signature')
      fireEvent.change(screen.getByLabelText('Type your initials'), { target: { value: '' } })
      primary('Use these initials')
      expect(screen.getByRole('alert')).toHaveTextContent('Please add your initials.')
    })
  })

  describe('the date the form asks for', () => {
    it('starts as today, and can only go back a limited number of days, never forward', async () => {
      serve(customerDoc)
      await toDate()
      const input = screen.getByLabelText('Choose the date') as HTMLInputElement
      const { min, max } = dateBounds()
      expect(input.value).toBe(todaySAST())
      expect(input.min).toBe(min)
      expect(input.max).toBe(max)
    })

    it('writes the chosen date into each date box in the format that box asks for, live', async () => {
      serve(customerDoc)
      await toDate()
      expect(boxText('d1')).toBe(formatChosenDate(todaySAST(), 'day_month'))
      expect(boxText('d2')).toBe(formatChosenDate(todaySAST(), 'year_2'))

      fireEvent.change(screen.getByLabelText('Choose the date'), { target: { value: yesterday() } })
      expect(boxText('d1')).toBe(formatChosenDate(yesterday(), 'day_month'))
      expect(screen.getByText(/It will be written on the form as:/)).toHaveTextContent(formatChosenDate(yesterday(), 'day_month'))
    })

    it('refuses a date in the future or an empty date, and says why', async () => {
      serve(customerDoc)
      await toDate()
      fireEvent.change(screen.getByLabelText('Choose the date'), { target: { value: '2999-01-01' } })
      primary('Use this date')
      expect(screen.getByRole('alert')).toHaveTextContent('The date cannot be in the future.')
      fireEvent.change(screen.getByLabelText('Choose the date'), { target: { value: '' } })
      primary('Use this date')
      expect(screen.getByRole('alert')).toHaveTextContent('Please choose a valid date.')
      expect(screen.getByText('Step 3 of 4')).toBeInTheDocument()
    })
  })

  describe('where they signed', () => {
    it('shows what they type in the place box, and will not move on without it', async () => {
      serve(customerDoc)
      await toDate()
      primary('Use this date')
      expect(screen.getByText('Step 4 of 4')).toBeInTheDocument()
      primary('Use this place')
      expect(screen.getByRole('alert')).toHaveTextContent('Please say where you are signing.')
      fireEvent.change(screen.getByLabelText('Where are you signing?'), { target: { value: 'Cape Town' } })
      expect(boxText('p1')).toBe('Cape Town')
    })
  })

  describe('finishing', () => {
    async function throughToFinish(fetchMock: ReturnType<typeof serve>, chosen = yesterday()) {
      await toDate()
      fireEvent.change(screen.getByLabelText('Choose the date'), { target: { value: chosen } })
      primary('Use this date')
      fireEvent.change(screen.getByLabelText('Where are you signing?'), { target: { value: 'Cape Town' } })
      primary('Use this place')
      await screen.findByText('Preview before you send')
      return fetchMock
    }

    it('submits everything, including the date they chose and where they signed', async () => {
      const fetchMock = serve(customerDoc)
      await throughToFinish(fetchMock)
      await reviewIt()
      agree(); primary('Submit and finish')
      await screen.findByText('Signed')
      expect(screen.getByText('Thank you, your signature has been recorded.')).toBeInTheDocument()
      expect(submittedBody(fetchMock)).toEqual({
        signatureType: 'DRAWN', signatureData: 'data:image/png;base64,DRAWN-Draw your signature',
        initialsType: 'TYPED', initialsData: 'TN',
        signingDate: yesterday(),
        placeValues: { p1: 'Cape Town' }, placeData: 'Cape Town',
        consent: true, consentVersion: CONSENT_VERSION,
      })
    })

    it('cannot be submitted until they agree to sign electronically', async () => {
      const fetchMock = serve(customerDoc)
      await throughToFinish(fetchMock)
      await reviewIt()
      expect(screen.getByRole('button', { name: 'Submit and finish' })).toBeDisabled()
      agree()
      expect(screen.getByRole('button', { name: 'Submit and finish' })).toBeEnabled()
      agree()   // and un-ticking takes it away again
      expect(screen.getByRole('button', { name: 'Submit and finish' })).toBeDisabled()
      expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith('/submit'))).toBe(false)
    })

    it('every box is filled on the document before they submit', async () => {
      const fetchMock = serve(customerDoc)
      await throughToFinish(fetchMock)
      for (const id of ['s1', 'i1', 'i2', 'd1', 'd2', 'p1', 'n1']) expect(boxText(id)).not.toBe('')
    })

    it('tapping a box on the document jumps back to that task, and the answers are kept', async () => {
      const fetchMock = serve(customerDoc)
      await throughToFinish(fetchMock)
      fireEvent.click(screen.getByTestId('box-i1'))
      expect(screen.getByText('Step 2 of 4')).toBeInTheDocument()
      expect(screen.getByText('Your initials', { selector: 'h2' })).toBeInTheDocument()
      expect(boxText('s1')).toBe('data:image/png;base64,DRAWN-Draw your signature')   // signature still applied
      fireEvent.change(screen.getByLabelText('Type your initials'), { target: { value: 'T.N' } })
      expect(boxText('i2')).toBe('T.N')
    })

    it('Back keeps what was drawn and what was chosen', async () => {
      const fetchMock = serve(customerDoc)
      await throughToFinish(fetchMock)
      for (let i = 0; i < 5; i++) primary('Back')   // finish, place, date, initials, signature, back to the checklist
      expect(screen.getByText(/here is what you need to do/)).toBeInTheDocument()
      primary('Start')
      expect(drawn.has('Draw your signature')).toBe(true)
      expect(boxText('d1')).toBe(formatChosenDate(yesterday(), 'day_month'))
    })

    describe('the preview before sending', () => {
      it('offers only the preview at first: no agreement box and no way to send', async () => {
        const fetchMock = serve(customerDoc)
        await throughToFinish(fetchMock)
        expect(screen.getByRole('button', { name: 'Preview my signed document' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Submit and finish' })).not.toBeInTheDocument()
        expect(screen.queryByRole('checkbox', { name: CONSENT_TEXT })).not.toBeInTheDocument()
        expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith('/submit'))).toBe(false)
      })

      it('shows the document with their details, and a summary of them, to check', async () => {
        const fetchMock = serve(customerDoc)
        await throughToFinish(fetchMock)
        primary('Preview my signed document')
        await screen.findByText('Check your signed document')
        expect(screen.getByTestId('preview')).toBeInTheDocument()
        expect(boxText('p1')).toBe('Cape Town')
        expect(boxText('s1')).toBe('data:image/png;base64,DRAWN-Draw your signature')
        const summary = screen.getByText('Name').closest('dl') as HTMLElement
        expect(summary).toHaveTextContent('Thandi Nkosi')
        expect(summary).toHaveTextContent('Cape Town')
        expect(summary).toHaveTextContent('TN')
      })

      it('"Change something" goes back without counting as checked', async () => {
        const fetchMock = serve(customerDoc)
        await throughToFinish(fetchMock)
        primary('Preview my signed document')
        primary('Change something')
        await screen.findByText('Preview before you send')
        expect(screen.queryByRole('button', { name: 'Submit and finish' })).not.toBeInTheDocument()
      })

      it('"This is correct" opens the agreement and the send button', async () => {
        const fetchMock = serve(customerDoc)
        await throughToFinish(fetchMock)
        await reviewIt()
        expect(screen.getByRole('button', { name: 'Submit and finish' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Preview again' })).toBeInTheDocument()
      })

      it('changing an answer after checking means checking again', async () => {
        const fetchMock = serve(customerDoc)
        await throughToFinish(fetchMock)
        await reviewIt()
        fireEvent.click(screen.getByTestId('box-i1'))
        fireEvent.change(screen.getByLabelText('Type your initials'), { target: { value: 'T.N' } })
        primary('Use these initials')
        primary('Use this date')
        primary('Use this place')
        await screen.findByText('Preview before you send')
        expect(screen.queryByRole('button', { name: 'Submit and finish' })).not.toBeInTheDocument()
      })
    })

    it('shows the server\'s message and stays on the last step when submitting fails', async () => {
      const fetchMock = serve(customerDoc, json({ error: 'This signing link has expired or already been used' }, false, 403))
      await throughToFinish(fetchMock)
      await reviewIt()
      agree(); primary('Submit and finish')
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('expired or already been used'))
      expect(screen.queryByText('Signed')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Submit and finish' })).toBeEnabled()
    })
  })

  describe('other people, other forms', () => {
    it('a witness has one task, and is never asked for initials, a date or a place', async () => {
      serve({ detectedFields: WITNESS, signerName: 'Sipho Dlamini', signerRole: 'Witness 1', formName: 'New AOA' })
      mount()
      await screen.findByText(/here is what you need to do/)
      expect(screen.getAllByRole('listitem')).toHaveLength(1)
      primary('Start')
      expect(screen.getByText('Step 1 of 1')).toBeInTheDocument()
      expect(screen.queryByLabelText('Choose the date')).not.toBeInTheDocument()
      drawn.add('Draw your signature'); primary('Use this signature')
      await screen.findByText('Preview before you send')
    })

    it('a typed signature works and is what gets sent', async () => {
      const fetchMock = serve({ detectedFields: WITNESS, signerName: 'Sipho Dlamini', signerRole: 'Witness 1', formName: null })
      mount()
      await screen.findByText(/here is what you need to do/)
      primary('Start')
      fireEvent.click(screen.getByRole('tab', { name: 'Type' }))
      fireEvent.change(screen.getByLabelText('Type your full name'), { target: { value: '  Sipho Dlamini ' } })
      primary('Use this signature')
      await reviewIt()
      agree(); primary('Submit and finish')
      await screen.findByText('Signed')
      expect(submittedBody(fetchMock)).toMatchObject({ signatureType: 'TYPED', signatureData: 'Sipho Dlamini' })
    })

    it('an older session with no boxes has no checklist, just a signature and a final check', async () => {
      const fetchMock = serve({ detectedFields: [], signerName: 'Jane', signerRole: null, formName: null })
      mount()
      await screen.findByText('Your signature', { selector: 'h2' })
      expect(screen.queryByText(/here is what you need to do/)).not.toBeInTheDocument()
      expect(screen.getByTestId('preview')).toBeInTheDocument()
      drawn.add('Draw your signature'); primary('Use this signature')
      agree(); primary('Submit and finish')
      await screen.findByText('Signed')
      expect(submittedBody(fetchMock)).toMatchObject({ signatureType: 'DRAWN' })
    })
  })

  describe('declining to sign', () => {
    it('is offered from the start, and going back returns to where they were', async () => {
      serve(customerDoc)
      mount()
      await screen.findByText(/here is what you need to do/)
      primary('I cannot sign this document')
      expect(screen.getByRole('heading', { name: 'Decline to sign' })).toBeInTheDocument()
      primary('Go back')
      expect(screen.getByText(/here is what you need to do/)).toBeInTheDocument()
    })

    it('sends the reason, then tells them it is done and that the sender knows', async () => {
      const fetchMock = serve(customerDoc)
      mount()
      await screen.findByText(/here is what you need to do/)
      primary('I cannot sign this document')
      fireEvent.change(screen.getByLabelText(/Why are you not signing/), { target: { value: 'Wrong amount on page 2' } })
      primary('Decline to sign')
      await screen.findByText('You have declined to sign')
      expect(declinedBody(fetchMock)).toEqual({ reason: 'Wrong amount on page 2' })
      expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith('/submit'))).toBe(false)
    })

    it('needs no reason', async () => {
      const fetchMock = serve(customerDoc)
      mount()
      await screen.findByText(/here is what you need to do/)
      primary('I cannot sign this document')
      primary('Decline to sign')
      await screen.findByText('You have declined to sign')
      expect(declinedBody(fetchMock)).toEqual({ reason: '' })
    })

    it('shows the server\'s message and stays put when it fails', async () => {
      serve(customerDoc, json({ ok: true }), json({ error: 'This signing link has expired or already been used' }, false, 403))
      mount()
      await screen.findByText(/here is what you need to do/)
      primary('I cannot sign this document')
      primary('Decline to sign')
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('expired or already been used'))
      expect(screen.queryByText('You have declined to sign')).not.toBeInTheDocument()
    })
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
    expect(container.textContent).not.toContain(String.fromCharCode(0x2014))
    primary('Start')
    expect(container.textContent).not.toContain(String.fromCharCode(0x2014))
    expect(container.textContent).not.toContain('--')
  })
})
