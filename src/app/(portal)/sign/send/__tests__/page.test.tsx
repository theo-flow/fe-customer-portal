import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { UploadInfo } from '@/lib/sign-form-match'

vi.mock('@/lib/org-context', () => ({ useOrg: () => ({ loading: false }) }))
vi.mock('../pdf-read', () => ({ readUploadInfo: vi.fn() }))

import SendFormPage from '../page'
import { readUploadInfo } from '../pdf-read'

const aoa = {
  formId: 'aoa', name: 'New AOA', currentVersion: 4, pageCount: 3, pageWidth: 595.32, pageHeight: 841.92,
  roles: ['Customer', 'Witness 1', 'Seller'],
  anchors: [{ page: 1, text: 'AMENDMENT OF AGREEMENT' }, { page: 2, text: 'In presence of the undersigned witnesses' }],
}
const consent = {
  formId: 'consent', name: 'Consent', currentVersion: 1, pageCount: 3, pageWidth: 595.32, pageHeight: 841.92,
  roles: ['Customer'], anchors: [{ page: 1, text: 'CONSENT TO CREDIT CHECK' }],
}

const aoaUpload: UploadInfo = {
  pageCount: 3, pageWidth: 595.32, pageHeight: 841.92,
  pageTexts: ['AMENDMENT OF AGREEMENT 777 111 222 THANDI NKOSI', 'In presence of the undersigned witnesses', 'Witness for consumer'],
}

const json = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response

function pdfFile(name = 'thandi-aoa.pdf') {
  const f = new File(['%PDF-1.7'], name, { type: 'application/pdf' })
  Object.defineProperty(f, 'arrayBuffer', { value: async () => new ArrayBuffer(8) })
  return f
}

async function chooseFile(file: File) {
  fireEvent.change(screen.getByLabelText('Choose the PDF'), { target: { files: [file] } })
  await waitFor(() => expect(readUploadInfo).toHaveBeenCalled())
}

function fillPeople(people: Record<string, { name: string; email: string }>) {
  for (const [role, p] of Object.entries(people)) {
    fireEvent.change(screen.getByLabelText(`Name for ${role}`), { target: { value: p.name } })
    fireEvent.change(screen.getByLabelText(`Email for ${role}`), { target: { value: p.email } })
  }
}
const everyone = {
  Customer: { name: 'Thandi Nkosi', email: 'thandi@example.com' },
  'Witness 1': { name: 'Sipho Dlamini', email: 'sipho@example.com' },
  Seller: { name: 'Anele Bank', email: 'anele@bank.example' },
}

const sendBtn = () => screen.getByRole('button', { name: /Send for signature|Sending/ })

describe('SendFormPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('crypto', { subtle: { digest: async () => new Uint8Array(32).fill(1).buffer } })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
    vi.mocked(readUploadInfo).mockReset()
  })
  afterEach(() => { vi.unstubAllGlobals() })

  function withForms(forms: unknown[]) {
    fetchMock.mockImplementation(async (url: string) => (url === '/api/sign/forms' ? json({ forms }) : json({})))
  }

  it('tells the customer to contact TheoFlow when no forms are set up', async () => {
    withForms([])
    render(<SendFormPage />)
    await waitFor(() => expect(screen.getByText('No forms are set up yet')).toBeInTheDocument())
    expect(screen.queryByLabelText('Choose the PDF')).not.toBeInTheDocument()
  })

  it('shows a clear error when the forms cannot be loaded', async () => {
    fetchMock.mockResolvedValue(json({}, false, 500))
    render(<SendFormPage />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded'))
  })

  it('reads the upload and picks the right one of two same-shaped forms by itself', async () => {
    withForms([consent, aoa])
    vi.mocked(readUploadInfo).mockResolvedValue(aoaUpload)
    render(<SendFormPage />)
    await waitFor(() => expect(screen.getByLabelText('Choose the PDF')).toBeInTheDocument())
    await chooseFile(pdfFile())

    await waitFor(() => expect(screen.getByText('This looks like New AOA.')).toBeInTheDocument())
    expect((screen.getByLabelText('Which form is this?') as HTMLSelectElement).value).toBe('aoa')
    expect(screen.getByText('This document matches New AOA.')).toBeInTheDocument()
    // one row per role appears
    for (const role of ['Customer', 'Witness 1', 'Seller']) expect(screen.getByLabelText(`Name for ${role}`)).toBeInTheDocument()
  })

  it('labels every form with how well the document fits it', async () => {
    withForms([consent, aoa])
    vi.mocked(readUploadInfo).mockResolvedValue(aoaUpload)
    render(<SendFormPage />)
    await waitFor(() => screen.getByLabelText('Choose the PDF'))
    await chooseFile(pdfFile())
    await waitFor(() => expect(screen.getByRole('option', { name: 'New AOA (looks right)' })).toBeInTheDocument())
    expect(screen.getByRole('option', { name: 'Consent (does not fit this document)' })).toBeInTheDocument()
  })

  it('does not choose for the person when nothing matches, and blocks sending a form that cannot fit', async () => {
    withForms([consent, aoa])
    vi.mocked(readUploadInfo).mockResolvedValue({ ...aoaUpload, pageCount: 4, pageTexts: ['a', 'b', 'c', 'd'] })
    render(<SendFormPage />)
    await waitFor(() => screen.getByLabelText('Choose the PDF'))
    await chooseFile(pdfFile())
    await waitFor(() => screen.getByLabelText('Which form is this?'))
    expect((screen.getByLabelText('Which form is this?') as HTMLSelectElement).value).toBe('')

    fireEvent.change(screen.getByLabelText('Which form is this?'), { target: { value: 'aoa' } })
    expect(screen.getByRole('alert')).toHaveTextContent('does not fit New AOA')
    expect(screen.getByText('This document has 4 pages, but New AOA has 3.')).toBeInTheDocument()
    fillPeople(everyone)
    expect(sendBtn()).toBeDisabled()
  })

  it('needs the person to confirm when it cannot be sure, then allows sending', async () => {
    // two of the form's three phrases are found: close enough to suggest, not enough to be sure
    withForms([{ ...aoa, anchors: [...aoa.anchors, { page: 3, text: 'Witness for consumer' }] }])
    vi.mocked(readUploadInfo).mockResolvedValue({ ...aoaUpload, pageTexts: ['AMENDMENT OF AGREEMENT', 'In presence of the undersigned witnesses', 'a different last page'] })
    render(<SendFormPage />)
    await waitFor(() => screen.getByLabelText('Choose the PDF'))
    await chooseFile(pdfFile())
    await waitFor(() => screen.getByText(/We could not be sure this is New AOA/))   // lone form is pre-selected, check still shown

    fillPeople(everyone)
    expect(sendBtn()).toBeDisabled()
    fireEvent.click(screen.getByLabelText('I have checked that this is the right form'))
    expect(sendBtn()).toBeEnabled()
  })

  it('stays disabled until every role has a name and a valid email', async () => {
    withForms([aoa])
    vi.mocked(readUploadInfo).mockResolvedValue(aoaUpload)
    render(<SendFormPage />)
    await waitFor(() => screen.getByLabelText('Choose the PDF'))
    await chooseFile(pdfFile())
    await waitFor(() => screen.getByLabelText('Name for Customer'))

    fillPeople({ Customer: everyone.Customer, 'Witness 1': everyone['Witness 1'] })
    expect(sendBtn()).toBeDisabled()
    fillPeople({ Seller: { name: 'Anele Bank', email: 'not-an-email' } })
    expect(sendBtn()).toBeDisabled()
    fillPeople({ Seller: everyone.Seller })
    expect(sendBtn()).toBeEnabled()
  })

  it('uploads the PDF, sends the form and shows each person their own link', async () => {
    const links = [
      { signerId: 's1', role: 'Customer', name: 'Thandi Nkosi', email: 'thandi@example.com', signUrl: 'https://t/sign/x/s1/tok1' },
      { signerId: 's2', role: 'Witness 1', name: 'Sipho Dlamini', email: 'sipho@example.com', signUrl: 'https://t/sign/x/s2/tok2' },
      { signerId: 's3', role: 'Seller', name: 'Anele Bank', email: 'anele@bank.example', signUrl: 'https://t/sign/x/s3/tok3' },
    ]
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/sign/forms') return json({ forms: [aoa] })
      if (url === '/api/sign/upload/presign') return json({ sessionId: 'sess-9', uploadUrl: 'https://s3/put', key: 'sign/source/sess-9/thandi-aoa.pdf' })
      if (url === 'https://s3/put') return json({})
      if (url === '/api/sign/forms/aoa/send') return json({ sessionId: 'sess-9', signers: links, emailQueued: true }, true, 201)
      return json({}, false, 404)
    })
    vi.mocked(readUploadInfo).mockResolvedValue(aoaUpload)
    render(<SendFormPage />)
    await waitFor(() => screen.getByLabelText('Choose the PDF'))
    await chooseFile(pdfFile())
    await waitFor(() => screen.getByLabelText('Name for Customer'))
    fillPeople(everyone)
    fireEvent.click(sendBtn())

    await waitFor(() => expect(screen.getByText('Form sent')).toBeInTheDocument())
    expect(screen.getByText(/being emailed their own signing link/)).toBeInTheDocument()
    expect(screen.getByText('Customer: Thandi Nkosi')).toBeInTheDocument()

    const sendCall = fetchMock.mock.calls.find(c => c[0] === '/api/sign/forms/aoa/send')!
    const body = JSON.parse(sendCall[1].body)
    expect(body.formVersion).toBe(4)
    expect(body.sourceDocument).toMatchObject({ sessionId: 'sess-9', s3Key: 'sign/source/sess-9/thandi-aoa.pdf', filename: 'thandi-aoa.pdf' })
    expect(body.sourceDocument.sha256).toBe('01'.repeat(32))
    expect(body.signers).toEqual([
      { role: 'Customer', name: 'Thandi Nkosi', email: 'thandi@example.com' },
      { role: 'Witness 1', name: 'Sipho Dlamini', email: 'sipho@example.com' },
      { role: 'Seller', name: 'Anele Bank', email: 'anele@bank.example' },
    ])
    // the file itself went straight to S3, not through the API
    expect(fetchMock.mock.calls.some(c => c[0] === 'https://s3/put' && c[1].method === 'PUT')).toBe(true)

    fireEvent.click(screen.getAllByRole('button', { name: 'Copy link' })[1])
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://t/sign/x/s2/tok2'))
  })

  it('says so, and offers the links, when the emails could not be queued', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/sign/forms') return json({ forms: [consent] })
      if (url === '/api/sign/upload/presign') return json({ sessionId: 's', uploadUrl: 'https://s3/put', key: 'sign/source/s/a.pdf' })
      if (url === 'https://s3/put') return json({})
      return json({ sessionId: 's', signers: [{ signerId: 'a', role: 'Customer', name: 'T', email: 't@example.com', signUrl: 'https://t/x' }], emailQueued: false }, true, 201)
    })
    vi.mocked(readUploadInfo).mockResolvedValue({ ...aoaUpload, pageTexts: ['CONSENT TO CREDIT CHECK', 'b', 'c'] })
    render(<SendFormPage />)
    await waitFor(() => screen.getByLabelText('Choose the PDF'))
    await chooseFile(pdfFile('consent.pdf'))
    await waitFor(() => screen.getByLabelText('Name for Customer'))
    fillPeople({ Customer: { name: 'Thandi', email: 't@example.com' } })
    fireEvent.click(sendBtn())
    await waitFor(() => expect(screen.getByText(/emails could not be queued/)).toBeInTheDocument())
  })

  it('shows the server\'s message and stays on the page when sending is refused', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/sign/forms') return json({ forms: [consent] })
      if (url === '/api/sign/upload/presign') return json({ sessionId: 's', uploadUrl: 'https://s3/put', key: 'sign/source/s/a.pdf' })
      if (url === 'https://s3/put') return json({})
      return json({ error: 'This form was updated while you were preparing it. Reload the page and try again.' }, false, 409)
    })
    vi.mocked(readUploadInfo).mockResolvedValue({ ...aoaUpload, pageTexts: ['CONSENT TO CREDIT CHECK', 'b', 'c'] })
    render(<SendFormPage />)
    await waitFor(() => screen.getByLabelText('Choose the PDF'))
    await chooseFile(pdfFile('consent.pdf'))
    await waitFor(() => screen.getByLabelText('Name for Customer'))
    fillPeople({ Customer: { name: 'Thandi', email: 't@example.com' } })
    fireEvent.click(sendBtn())
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('was updated while you were preparing it'))
    expect(screen.queryByText('Form sent')).not.toBeInTheDocument()
    expect(sendBtn()).toBeEnabled()   // can try again
  })

  it('does not call the send route if the upload to storage fails', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/sign/forms') return json({ forms: [consent] })
      if (url === '/api/sign/upload/presign') return json({ sessionId: 's', uploadUrl: 'https://s3/put', key: 'k' })
      if (url === 'https://s3/put') return json({}, false, 403)
      return json({})
    })
    vi.mocked(readUploadInfo).mockResolvedValue({ ...aoaUpload, pageTexts: ['CONSENT TO CREDIT CHECK', 'b', 'c'] })
    render(<SendFormPage />)
    await waitFor(() => screen.getByLabelText('Choose the PDF'))
    await chooseFile(pdfFile('consent.pdf'))
    await waitFor(() => screen.getByLabelText('Name for Customer'))
    fillPeople({ Customer: { name: 'Thandi', email: 't@example.com' } })
    fireEvent.click(sendBtn())
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to upload'))
    expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith('/send'))).toBe(false)
  })

  it('rejects a file that is not a PDF and one that cannot be read', async () => {
    withForms([aoa])
    render(<SendFormPage />)
    await waitFor(() => screen.getByLabelText('Choose the PDF'))

    fireEvent.change(screen.getByLabelText('Choose the PDF'), { target: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Only PDF documents')
    expect(readUploadInfo).not.toHaveBeenCalled()

    vi.mocked(readUploadInfo).mockRejectedValue(new Error('encrypted'))
    await chooseFile(pdfFile('locked.pdf'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be read'))
  })

  it('"Send another form" starts again from the beginning', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/sign/forms') return json({ forms: [consent] })
      if (url === '/api/sign/upload/presign') return json({ sessionId: 's', uploadUrl: 'https://s3/put', key: 'sign/source/s/a.pdf' })
      if (url === 'https://s3/put') return json({})
      return json({ sessionId: 's', signers: [{ signerId: 'a', role: 'Customer', name: 'T', email: 't@example.com', signUrl: 'https://t/x' }], emailQueued: true }, true, 201)
    })
    vi.mocked(readUploadInfo).mockResolvedValue({ ...aoaUpload, pageTexts: ['CONSENT TO CREDIT CHECK', 'b', 'c'] })
    render(<SendFormPage />)
    await waitFor(() => screen.getByLabelText('Choose the PDF'))
    await chooseFile(pdfFile('consent.pdf'))
    await waitFor(() => screen.getByLabelText('Name for Customer'))
    fillPeople({ Customer: { name: 'Thandi', email: 't@example.com' } })
    fireEvent.click(sendBtn())
    await waitFor(() => screen.getByText('Form sent'))
    fireEvent.click(screen.getByRole('button', { name: 'Send another form' }))
    expect(screen.getByLabelText('Choose the PDF')).toBeInTheDocument()
    expect(screen.queryByLabelText('Name for Customer')).not.toBeInTheDocument()
  })
})
