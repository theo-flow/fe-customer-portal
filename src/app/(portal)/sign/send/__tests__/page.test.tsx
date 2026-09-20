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

const pickForm = (name: string) => fireEvent.click(screen.getByRole('radio', { name: new RegExp(name) }))
const DOT = String.fromCharCode(0xb7)
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

  it('shows every saved form up front, before any document is added', async () => {
    withForms([consent, aoa])
    render(<SendFormPage />)
    await waitFor(() => expect(screen.getByRole('radio', { name: /New AOA/ })).toBeInTheDocument())
    expect(screen.getByRole('radio', { name: /Consent/ })).toBeInTheDocument()
    expect(screen.getByText(`3 pages ${DOT} signed by Customer, Witness 1, Seller`)).toBeInTheDocument()
    expect(screen.queryByLabelText('Choose the PDF')).not.toBeInTheDocument()
    expect(screen.getByText(/Choose the form first/)).toBeInTheDocument()
  })

  it('has a way back to the signing sessions', async () => {
    withForms([aoa])
    render(<SendFormPage />)
    const back = await screen.findByRole('link', { name: /Back to signing sessions/ })
    expect(back).toHaveAttribute('href', '/sign')
  })

  it('a lone form is already chosen, so the document can be added straight away', async () => {
    withForms([aoa])
    render(<SendFormPage />)
    await waitFor(() => expect(screen.getByLabelText('Choose the PDF')).toBeInTheDocument())
    expect((screen.getByRole('radio', { name: /New AOA/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('choosing a form lets you add the document, which is then checked against that form', async () => {
    withForms([consent, aoa])
    vi.mocked(readUploadInfo).mockResolvedValue(aoaUpload)
    render(<SendFormPage />)
    await waitFor(() => screen.getByRole('radio', { name: /New AOA/ }))
    pickForm('New AOA')
    await waitFor(() => screen.getByLabelText('Choose the PDF'))
    await chooseFile(pdfFile())

    await waitFor(() => expect(screen.getByText('This document matches New AOA.')).toBeInTheDocument())
    for (const role of ['Customer', 'Witness 1', 'Seller']) expect(screen.getByLabelText(`Name for ${role}`)).toBeInTheDocument()
  })

  it('offers to switch when the document looks like a different form than the one chosen', async () => {
    withForms([consent, aoa])
    vi.mocked(readUploadInfo).mockResolvedValue(aoaUpload)
    render(<SendFormPage />)
    await waitFor(() => screen.getByRole('radio', { name: /Consent/ }))
    pickForm('Consent')
    await waitFor(() => screen.getByLabelText('Choose the PDF'))
    await chooseFile(pdfFile())

    await waitFor(() => expect(screen.getByText(/This document looks like New AOA/)).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('does not fit Consent')
    fireEvent.click(screen.getByRole('button', { name: 'Use New AOA instead' }))
    expect((screen.getByRole('radio', { name: /New AOA/ }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('This document matches New AOA.')).toBeInTheDocument()
  })

  it('blocks sending a document that cannot fit the chosen form', async () => {
    withForms([consent, aoa])
    vi.mocked(readUploadInfo).mockResolvedValue({ ...aoaUpload, pageCount: 4, pageTexts: ['a', 'b', 'c', 'd'] })
    render(<SendFormPage />)
    await waitFor(() => screen.getByRole('radio', { name: /New AOA/ }))
    pickForm('New AOA')
    await waitFor(() => screen.getByLabelText('Choose the PDF'))
    await chooseFile(pdfFile())

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('does not fit New AOA'))
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

  describe('working out who the form is for', () => {
    const W = 595.32
    const H = 841.92
    // text placed so its centre lands `top` down the page and `left` across it
    const at = (str: string, left: number, top: number, width = 120, height = 10) => ({
      str, width, height, transform: [1, 0, 0, 1, left * W, (1 - top) * H - height / 2],
    })

    const readingForm = {
      ...aoa,
      reads: [{ role: 'Customer', kind: 'name', page: 1, x: 0.30, y: 0.33, width: 0.30, height: 0.03 }],
      roleDefaults: [{ role: 'Seller', name: 'Anele Botha', email: 'anele@bank.example' }],
    }
    const upload = (name = 'THANDI NKOSI'): UploadInfo => ({
      ...aoaUpload,
      pageItems: [[at('AMENDMENT OF AGREEMENT', 0.25, 0.17, 300), at(name, 0.32, 0.34, 150)], [], []],
    })

    async function open(form: unknown, info: UploadInfo) {
      withForms([form])
      vi.mocked(readUploadInfo).mockResolvedValue(info)
      render(<SendFormPage />)
      await waitFor(() => screen.getByLabelText('Choose the PDF'))
      await chooseFile(pdfFile())
      await waitFor(() => screen.getByLabelText('Name for Customer'))
    }

    it('fills in the customer from the document, the usual person for a fixed role, and leaves the rest', async () => {
      await open(readingForm, upload())
      expect((screen.getByLabelText('Name for Customer') as HTMLInputElement).value).toBe('Thandi Nkosi')
      expect((screen.getByLabelText('Email for Customer') as HTMLInputElement).value).toBe('')   // the form prints no email
      expect((screen.getByLabelText('Name for Seller') as HTMLInputElement).value).toBe('Anele Botha')
      expect((screen.getByLabelText('Email for Seller') as HTMLInputElement).value).toBe('anele@bank.example')
      expect((screen.getByLabelText('Name for Witness 1') as HTMLInputElement).value).toBe('')
    })

    it('tells the agent what was filled in and to check it', async () => {
      await open(readingForm, upload())
      expect(screen.getByText(/We filled in the people we could from the document/)).toBeInTheDocument()
      expect(screen.getByText('Name read from the document.')).toBeInTheDocument()
      expect(screen.getByText('Usual person for this form.')).toBeInTheDocument()
    })

    it('does not send until the agent supplies what could not be read, such as the email', async () => {
      await open(readingForm, upload())
      fillPeople({ 'Witness 1': everyone['Witness 1'] })
      expect(sendBtn()).toBeDisabled()                                   // customer email is still missing
      fireEvent.change(screen.getByLabelText('Email for Customer'), { target: { value: 'thandi@example.com' } })
      expect(sendBtn()).toBeEnabled()
    })

    it('the agent can correct what was read', async () => {
      await open(readingForm, upload())
      fireEvent.change(screen.getByLabelText('Name for Customer'), { target: { value: 'Thandi N. Nkosi' } })
      expect((screen.getByLabelText('Name for Customer') as HTMLInputElement).value).toBe('Thandi N. Nkosi')
    })

    it('says so when no name could be read, instead of guessing', async () => {
      await open(readingForm, { ...upload(), pageItems: [[at('AMENDMENT OF AGREEMENT', 0.25, 0.17, 300)], [], []] })
      expect((screen.getByLabelText('Name for Customer') as HTMLInputElement).value).toBe('')
      expect(screen.getByText('No name could be read from the document. Please type it.')).toBeInTheDocument()
    })

    it('never puts something that is not a name into the name box', async () => {
      await open(readingForm, upload('R23 062.01'))
      expect((screen.getByLabelText('Name for Customer') as HTMLInputElement).value).toBe('')
    })

    it('a different upload starts clean: nothing from the last person carries over', async () => {
      await open(readingForm, upload('THANDI NKOSI'))
      fireEvent.change(screen.getByLabelText('Email for Customer'), { target: { value: 'thandi@example.com' } })

      vi.mocked(readUploadInfo).mockResolvedValue(upload('SIPHO DLAMINI'))
      fireEvent.change(screen.getByLabelText('Choose the PDF'), { target: { files: [pdfFile('sipho-aoa.pdf')] } })
      await waitFor(() => expect((screen.getByLabelText('Name for Customer') as HTMLInputElement).value).toBe('Sipho Dlamini'))
      expect((screen.getByLabelText('Email for Customer') as HTMLInputElement).value).toBe('')
    })

    it('changing the form keeps what the agent already typed', async () => {
      withForms([readingForm, { ...consent, roles: ['Customer'], reads: [], roleDefaults: [] }])
      vi.mocked(readUploadInfo).mockResolvedValue(upload())
      render(<SendFormPage />)
      await waitFor(() => screen.getByRole('radio', { name: /New AOA/ }))
      pickForm('New AOA')
      await waitFor(() => screen.getByLabelText('Choose the PDF'))
      await chooseFile(pdfFile())
      await waitFor(() => screen.getByLabelText('Name for Customer'))
      fireEvent.change(screen.getByLabelText('Email for Customer'), { target: { value: 'thandi@example.com' } })

      pickForm('Consent')
      expect((screen.getByLabelText('Email for Customer') as HTMLInputElement).value).toBe('thandi@example.com')
      expect((screen.getByLabelText('Name for Customer') as HTMLInputElement).value).toBe('Thandi Nkosi')
    })

    it('a form that does not say who it is for still works exactly as before', async () => {
      await open(aoa, upload())
      expect((screen.getByLabelText('Name for Customer') as HTMLInputElement).value).toBe('')
      expect(screen.queryByText(/We filled in the people we could/)).not.toBeInTheDocument()
    })

    it('sends the name that was read together with the email the agent typed', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url === '/api/sign/forms') return json({ forms: [readingForm] })
        if (url === '/api/sign/upload/presign') return json({ sessionId: 's', uploadUrl: 'https://s3/put', key: 'sign/source/s/a.pdf' })
        if (url === 'https://s3/put') return json({})
        return json({ sessionId: 's', signers: [{ signerId: 'a', role: 'Customer', name: 'Thandi Nkosi', email: 't@example.com', signUrl: 'https://t/x' }], emailQueued: true }, true, 201)
      })
      vi.mocked(readUploadInfo).mockResolvedValue(upload())
      render(<SendFormPage />)
      await waitFor(() => screen.getByLabelText('Choose the PDF'))
      await chooseFile(pdfFile())
      await waitFor(() => screen.getByLabelText('Name for Customer'))
      fireEvent.change(screen.getByLabelText('Email for Customer'), { target: { value: 'thandi@example.com' } })
      fillPeople({ 'Witness 1': everyone['Witness 1'] })
      fireEvent.click(sendBtn())
      await waitFor(() => screen.getByText('Form sent'))

      const sendCall = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/send'))!
      const sent = JSON.parse(sendCall[1].body)
      expect(sent.signers).toEqual([
        { role: 'Customer', name: 'Thandi Nkosi', email: 'thandi@example.com' },
        { role: 'Witness 1', name: 'Sipho Dlamini', email: 'sipho@example.com' },
        { role: 'Seller', name: 'Anele Botha', email: 'anele@bank.example' },
      ])
    })
  })
})
