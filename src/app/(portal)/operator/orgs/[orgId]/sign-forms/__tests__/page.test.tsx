import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ orgId: 'org-new' }),
  useRouter: () => ({ push: mockPush }),
}))
vi.mock('../pdf-info', () => ({
  readPdfInfo: vi.fn(async () => ({ pageCount: 3, pageWidth: 595.32, pageHeight: 841.92 })),
}))

import SignFormsPage from '../page'

const json = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response

const OTHER_FORMS = [
  { formId: 'src-1', name: 'Their AOA', currentVersion: 4, pageCount: 3, roles: ['Customer'], fieldCount: 9, valid: true, updatedAt: '2026-01-01' },
]

function serve(create: Response = json({ formId: 'new-form-id', version: 1 }, true, 201)) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/operator/orgs') return json({ orgs: [{ orgId: 'org-new', orgName: 'New Customer' }, { orgId: 'org-old', orgName: 'Old Customer' }] })
    if (url === '/api/operator/orgs/org-old/sign-forms') return json({ forms: OTHER_FORMS })
    if (url === '/api/operator/orgs/org-new/sign-forms' && (!init || init.method !== 'POST')) return json({ forms: [] })
    if (url === '/api/operator/orgs/org-new/sign-forms/sample') return json({ uploadUrl: 'https://s3.example/put', formId: 'new-form-id' })
    if (url === 'https://s3.example/put') return json({})
    if (url === '/api/operator/orgs/org-new/sign-forms' && init?.method === 'POST') return create
    return json({}, false, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const createBody = (fetchMock: ReturnType<typeof serve>) =>
  JSON.parse(fetchMock.mock.calls.find(c => c[0] === '/api/operator/orgs/org-new/sign-forms' && c[1]?.method === 'POST')![1]!.body as string)

async function chooseSample(container: HTMLElement) {
  await screen.findByText('Add a form')
  const input = container.querySelector('input[type=file]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['%PDF-1.7'], 'Blank AOA.pdf', { type: 'application/pdf' })] } })
}

describe('operator Sign forms page: copying a form from another customer', () => {
  beforeEach(() => { mockPush.mockClear() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('creates from scratch when nothing is chosen to copy', async () => {
    const fetchMock = serve()
    const { container } = render(<SignFormsPage />)
    await chooseSample(container)
    fireEvent.click(screen.getByRole('button', { name: 'Continue to the editor' }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/operator/orgs/org-new/sign-forms/new-form-id'))
    expect(createBody(fetchMock)).not.toHaveProperty('copyFrom')
  })

  it('loads the other customer\'s forms and copies the chosen one, using the newly chosen sample', async () => {
    const fetchMock = serve()
    const { container } = render(<SignFormsPage />)
    await screen.findByText('Add a form')

    fireEvent.change(screen.getByLabelText(/Start from a form set up for a customer/), { target: { value: 'org-old' } })
    const formSelect = await screen.findByLabelText('Form to copy')
    await screen.findByRole('option', { name: 'Their AOA (3 pages)' })
    fireEvent.change(formSelect, { target: { value: 'src-1' } })

    expect(screen.getByText(/never copied/)).toBeInTheDocument()
    expect((screen.getByLabelText('Form name') as HTMLInputElement).value).toBe('Their AOA')   // name suggested

    await chooseSample(container)
    fireEvent.click(screen.getByRole('button', { name: 'Copy and continue to the editor' }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/operator/orgs/org-new/sign-forms/new-form-id'))
    expect(createBody(fetchMock)).toMatchObject({
      formId: 'new-form-id', name: 'Their AOA', pageCount: 3, copyFrom: { orgId: 'org-old', formId: 'src-1' },
    })
  })

  it('shows the server\'s message when the sample does not match, and does not navigate', async () => {
    serve(json({ error: 'This sample does not have the same pages as the form being copied (3 pages, same size).' }, false, 400))
    const { container } = render(<SignFormsPage />)
    await screen.findByText('Add a form')
    fireEvent.change(screen.getByLabelText(/Start from a form set up for a customer/), { target: { value: 'org-old' } })
    await screen.findByRole('option', { name: 'Their AOA (3 pages)' })
    fireEvent.change(screen.getByLabelText('Form to copy'), { target: { value: 'src-1' } })
    await chooseSample(container)
    fireEvent.click(screen.getByRole('button', { name: 'Copy and continue to the editor' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('same pages as the form being copied'))
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('says when the other customer has no forms', async () => {
    serve()
    render(<SignFormsPage />)
    await screen.findByText('Add a form')
    fireEvent.change(screen.getByLabelText(/Start from a form set up for a customer/), { target: { value: 'org-new' } })
    await screen.findByRole('option', { name: 'No forms set up for this customer' })
  })
})
