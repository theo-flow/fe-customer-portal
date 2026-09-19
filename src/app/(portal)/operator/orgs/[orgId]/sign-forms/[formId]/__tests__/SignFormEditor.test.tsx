import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { EditorInitial } from '../SignFormEditor'

// pdfjs cannot run in jsdom. The editor only needs a page-sized box to sit
// its overlay on, so the PDF pieces are replaced with plain elements.
vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: ({ children }: { children: React.ReactNode }) => <div data-testid="doc">{children}</div>,
  Page: ({ pageNumber }: { pageNumber: number }) => <div data-testid={`pdf-page-${pageNumber}`} style={{ height: 900 }} />,
}))

import SignFormEditor from '../SignFormEditor'

const PAGE_W = 640
const PAGE_H = 900

const initial = (over: Partial<EditorInitial['layout']> = {}): EditorInitial => ({
  version: 1, valid: false, sampleUrl: 'https://s3.example/sample.pdf',
  layout: {
    name: 'New AOA', page_count: 3, page_width: 595.32, page_height: 841.92,
    roles: ['Customer'], fields: [], ...over,
  },
})

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response
}

// jsdom has no layout, so every overlay reports a fixed page-sized rectangle.
function stubLayout() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: PAGE_W, bottom: PAGE_H, width: PAGE_W, height: PAGE_H, toJSON: () => ({}),
  } as DOMRect)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
}

const overlays = () => Array.from(document.querySelectorAll('[data-overlay]')) as HTMLElement[]

// Places a box: pick what and from whom, arm placing, click the page at (fx, fy).
function place(page: number, fx: number, fy: number, opts: { type?: string; role?: string; dateFormat?: string } = {}) {
  if (opts.type) fireEvent.change(screen.getByLabelText('What is needed', { selector: '#sf-add-type' }), { target: { value: opts.type } })
  if (opts.role) fireEvent.change(screen.getByLabelText('From whom', { selector: '#sf-add-role' }), { target: { value: opts.role } })
  if (opts.dateFormat) fireEvent.change(screen.getByLabelText('How the date is written', { selector: '#sf-add-datefmt' }), { target: { value: opts.dateFormat } })
  fireEvent.click(screen.getByRole('button', { name: 'Place on the page' }))
  fireEvent.pointerDown(overlays()[page - 1], { clientX: fx * PAGE_W, clientY: fy * PAGE_H })
}

describe('SignFormEditor', () => {
  beforeEach(() => {
    stubLayout()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('renders one overlay per page and reads the layout back page by page', () => {
    render(<SignFormEditor orgId="org-1" formId="f1" initial={initial({
      fields: [{ field_id: 'a', field_type: 'initials', role: 'Customer', page: 1, x: 0.85, y: 0.94, width: 0.1, height: 0.04,
                 instruction: 'Initial here to confirm you have read this page', required: true }],
    })} />)
    expect(overlays()).toHaveLength(3)
    // the per-page summary shows the box and its instruction; empty pages say so
    expect(screen.getAllByText('Initials - Customer').length).toBeGreaterThan(0)
    expect(screen.getByText('Initial here to confirm you have read this page')).toBeInTheDocument()
    expect(screen.getAllByText('Nothing to do on this page.')).toHaveLength(2)
  })

  it('places a box where the operator clicks, centred, and selects it', () => {
    render(<SignFormEditor orgId="org-1" formId="f1" initial={initial()} />)
    place(2, 0.5, 0.5, { type: 'signature' })

    expect(screen.getByText('Selected box')).toBeInTheDocument()
    const box = within(overlays()[1]).getByRole('button', { name: 'Signature - Customer' })
    // default signature box is 30% x 5%, centred on the click
    expect(parseFloat(box.style.left)).toBeCloseTo(35, 0)
    expect(parseFloat(box.style.top)).toBeCloseTo(47.5, 0)
    expect(parseFloat(box.style.width)).toBeCloseTo(30, 0)
    expect(within(overlays()[0]).queryAllByRole('button')).toHaveLength(0)   // only page 2
    expect(screen.getByRole('button', { name: 'Save version' })).toBeEnabled()
  })

  it('clicking a page when not placing just clears the selection', () => {
    render(<SignFormEditor orgId="org-1" formId="f1" initial={initial()} />)
    place(1, 0.5, 0.5)
    expect(screen.getByText('Selected box')).toBeInTheDocument()
    fireEvent.pointerDown(overlays()[0], { clientX: 10, clientY: 10 })
    expect(screen.queryByText('Selected box')).not.toBeInTheDocument()
  })

  it('places a split date with the chosen format', () => {
    render(<SignFormEditor orgId="org-1" formId="f1" initial={initial()} />)
    place(2, 0.3, 0.82, { type: 'date', dateFormat: 'year_2' })
    expect(screen.getAllByText(/two-digit year/).length).toBeGreaterThan(0)
    expect((screen.getByLabelText('How the date is written', { selector: '#sf-sel-datefmt' }) as HTMLSelectElement).value).toBe('year_2')
  })

  it('repeats initials on every page in one step, without stacking duplicates', () => {
    render(<SignFormEditor orgId="org-1" formId="f1" initial={initial()} />)
    place(1, 0.9, 0.95, { type: 'initials' })
    const repeat = screen.getByRole('button', { name: 'Repeat on every page' })
    fireEvent.click(repeat)
    for (const o of overlays()) expect(within(o).getAllByRole('button', { name: 'Initials - Customer' })).toHaveLength(1)
    fireEvent.click(repeat)
    for (const o of overlays()) expect(within(o).getAllByRole('button', { name: 'Initials - Customer' })).toHaveLength(1)
  })

  it('adds a role, then can place a box for it', () => {
    render(<SignFormEditor orgId="org-1" formId="f1" initial={initial()} />)
    fireEvent.change(screen.getByLabelText('New role name'), { target: { value: 'Witness 1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByLabelText('Role name: Witness 1')).toBeInTheDocument()

    place(3, 0.4, 0.06, { type: 'signature', role: 'Witness 1' })
    expect(within(overlays()[2]).getByRole('button', { name: 'Signature - Witness 1' })).toBeInTheDocument()
  })

  it('renaming a role keeps its boxes attached to it', () => {
    render(<SignFormEditor orgId="org-1" formId="f1" initial={initial()} />)
    place(1, 0.5, 0.5)
    const input = screen.getByLabelText('Role name: Customer')
    fireEvent.change(input, { target: { value: 'Client' } })
    fireEvent.blur(input)
    expect(within(overlays()[0]).getByRole('button', { name: 'Signature - Client' })).toBeInTheDocument()
  })

  it('removing a role asks first and takes its boxes with it', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<SignFormEditor orgId="org-1" formId="f1" initial={initial({ roles: ['Customer', 'Seller'] })} />)
    place(1, 0.5, 0.5, { role: 'Seller' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Seller' }))
    expect(confirm).toHaveBeenCalled()
    expect(within(overlays()[0]).queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByLabelText('Role name: Seller')).not.toBeInTheDocument()
  })

  it('declining the confirmation keeps the role and its boxes', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<SignFormEditor orgId="org-1" formId="f1" initial={initial({ roles: ['Customer', 'Seller'] })} />)
    place(1, 0.5, 0.5, { role: 'Seller' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Seller' }))
    expect(within(overlays()[0]).getAllByRole('button', { name: 'Signature - Seller' })).toHaveLength(1)
  })

  it('changing a box type swaps the default instruction but keeps a hand-written one', () => {
    render(<SignFormEditor orgId="org-1" formId="f1" initial={initial()} />)
    place(1, 0.5, 0.5, { type: 'signature' })
    const instruction = screen.getByLabelText('What the signer is told') as HTMLInputElement
    expect(instruction.value).toBe('Sign here')

    fireEvent.change(screen.getByLabelText('What is needed', { selector: '#sf-sel-type' }), { target: { value: 'initials' } })
    expect((screen.getByLabelText('What the signer is told') as HTMLInputElement).value).toBe('Initial here')

    fireEvent.change(screen.getByLabelText('What the signer is told'), { target: { value: 'Initial to confirm the arrears amount' } })
    fireEvent.change(screen.getByLabelText('What is needed', { selector: '#sf-sel-type' }), { target: { value: 'signature' } })
    expect((screen.getByLabelText('What the signer is told') as HTMLInputElement).value).toBe('Initial to confirm the arrears amount')
  })

  it('deletes the selected box with the button and with the Delete key', () => {
    render(<SignFormEditor orgId="org-1" formId="f1" initial={initial()} />)
    place(1, 0.3, 0.3)
    fireEvent.click(screen.getByRole('button', { name: 'Delete box' }))
    expect(within(overlays()[0]).queryAllByRole('button')).toHaveLength(0)

    place(1, 0.3, 0.3)
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(within(overlays()[0]).queryAllByRole('button')).toHaveLength(0)
  })

  it('arrow keys nudge the selected box, and typing in a field does not', () => {
    render(<SignFormEditor orgId="org-1" formId="f1" initial={initial()} />)
    place(1, 0.5, 0.5)
    const box = () => within(overlays()[0]).getByRole('button', { name: 'Signature - Customer' })
    const before = parseFloat(box().style.left)
    fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true })
    expect(parseFloat(box().style.left)).toBeGreaterThan(before)

    const after = parseFloat(box().style.left)
    fireEvent.keyDown(screen.getByLabelText('What the signer is told'), { key: 'ArrowRight' })
    expect(parseFloat(box().style.left)).toBe(after)
  })

  it('dragging moves a box and dragging the corner resizes it, always staying on the page', () => {
    render(<SignFormEditor orgId="org-1" formId="f1" initial={initial()} />)
    place(1, 0.5, 0.5)
    const box = () => within(overlays()[0]).getByRole('button', { name: 'Signature - Customer' })
    const startLeft = parseFloat(box().style.left)

    fireEvent.pointerDown(box(), { clientX: 320, clientY: 450, pointerId: 1 })
    fireEvent.pointerMove(box(), { clientX: 384, clientY: 450, pointerId: 1 })   // +10% of the width
    fireEvent.pointerUp(box(), { pointerId: 1 })
    expect(parseFloat(box().style.left)).toBeCloseTo(startLeft + 10, 0)

    fireEvent.pointerDown(box(), { clientX: 320, clientY: 450, pointerId: 1 })
    fireEvent.pointerMove(box(), { clientX: 10000, clientY: 450, pointerId: 1 })   // far off the page
    fireEvent.pointerUp(box(), { pointerId: 1 })
    expect(parseFloat(box().style.left) + parseFloat(box().style.width)).toBeLessThanOrEqual(100.0001)

    const handle = within(box()).getByLabelText('Resize box')
    const widthBefore = parseFloat(box().style.width)
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 500, pointerId: 2 })
    fireEvent.pointerMove(handle, { clientX: 500 - 32, clientY: 500, pointerId: 2 })   // -5% of the width
    fireEvent.pointerUp(handle, { pointerId: 2 })
    expect(parseFloat(box().style.width)).toBeCloseTo(widthBefore - 5, 0)
  })

  it('saves the whole layout as a new version, conditional on the version it started from', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(jsonResponse({ version: 2, valid: true, warnings: [] }))
    render(<SignFormEditor orgId="org-1" formId="f1" initial={initial()} />)
    place(2, 0.3, 0.8)
    fireEvent.click(screen.getByRole('button', { name: 'Save version' }))

    await waitFor(() => expect(screen.getByText('Saved as version 2.')).toBeInTheDocument())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/operator/orgs/org-1/sign-forms/f1')
    expect((init as RequestInit).method).toBe('PUT')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.baseVersion).toBe(1)
    expect(body.layout).toMatchObject({ name: 'New AOA', page_count: 3, roles: ['Customer'] })
    expect(body.layout.fields).toHaveLength(1)
    expect(screen.getByText(/Ready to send/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save version' })).toBeDisabled()   // nothing unsaved now
  })

  it('shows the reasons when a saved form is not ready to send', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ version: 2, valid: false, warnings: ['Witness 1 has no signature box.'] }))
    render(<SignFormEditor orgId="org-1" formId="f1" initial={initial()} />)
    place(1, 0.5, 0.5)
    fireEvent.click(screen.getByRole('button', { name: 'Save version' }))
    await waitFor(() => expect(screen.getByText('Witness 1 has no signature box.')).toBeInTheDocument())
    expect(screen.getByText(/Needs work/)).toBeInTheDocument()
  })

  it('shows the server message on a conflicting save and stays unsaved', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'Someone else saved this form after you opened it. Reload to see their changes.' }, false, 409))
    render(<SignFormEditor orgId="org-1" formId="f1" initial={initial()} />)
    place(1, 0.5, 0.5)
    fireEvent.click(screen.getByRole('button', { name: 'Save version' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Someone else saved this form'))
    expect(screen.getByRole('button', { name: 'Save version' })).toBeEnabled()
  })

  it('does not call the server when the layout is invalid, and says why', async () => {
    render(<SignFormEditor orgId="org-1" formId="f1" initial={initial()} />)
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save version' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Give the form a name'))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('offers "repeat on every page" only for a form with more than one page', () => {
    render(<SignFormEditor orgId="org-1" formId="f1" initial={initial({ page_count: 1 })} />)
    place(1, 0.5, 0.5)
    expect(screen.queryByRole('button', { name: 'Repeat on every page' })).not.toBeInTheDocument()
  })

  it('cannot place a box until a role exists', () => {
    render(<SignFormEditor orgId="org-1" formId="f1" initial={initial({ roles: [] })} />)
    expect(screen.getByRole('button', { name: 'Place on the page' })).toBeDisabled()
  })
})
