import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PartialReviewPanel, { type ReviewData } from '../PartialReviewPanel'

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response
}

const baseReview: ReviewData = {
  fields: { id_number: '8001015009087', phone: '0821234567' },
  schemaFields: [
    { key: 'id_number', label: 'ID Number', field_type: 'sa_id', required: true, options: null },
    { key: 'phone',     label: 'Phone Number', field_type: 'phone', required: true, options: null },
  ],
  aiResolvedFields: ['phone'],
  flaggedFields:    [],
  unresolvedFields: [],
}

describe('PartialReviewPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('pre-fills fields from the review data and flags the AI-matched one', () => {
    render(<PartialReviewPanel docId="doc-1" review={baseReview} onAccepted={vi.fn()} />)

    expect(screen.getByDisplayValue('8001015009087')).toBeInTheDocument()
    expect(screen.getByDisplayValue('0821234567')).toBeInTheDocument()
    expect(screen.getByText(/AI-matched/)).toBeInTheDocument()
  })

  it('blocks accept and shows an error when a required field is cleared', async () => {
    const user = userEvent.setup()
    render(<PartialReviewPanel docId="doc-1" review={baseReview} onAccepted={vi.fn()} />)

    const idInput = screen.getByDisplayValue('8001015009087')
    await user.clear(idInput)
    await user.click(screen.getByRole('button', { name: /accept and continue/i }))

    expect(await screen.findByText(/ID Number is required/i)).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('submits edited fields and calls onAccepted on success', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }))
    const onAccepted = vi.fn()
    const user = userEvent.setup()

    render(<PartialReviewPanel docId="doc-1" review={baseReview} onAccepted={onAccepted} />)
    await user.click(screen.getByRole('button', { name: /accept and continue/i }))

    expect(await screen.findByRole('button', { name: /accept and continue/i })).toBeEnabled()
    expect(fetch).toHaveBeenCalledWith('/api/status/doc-1/accept', expect.objectContaining({ method: 'POST' }))
    expect(onAccepted).toHaveBeenCalledTimes(1)
  })

  it('surfaces server-side field errors on a 422 response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ errors: { id_number: 'SA ID number is invalid (checksum failed)' } }, false, 422)
    )
    const onAccepted = vi.fn()
    const user = userEvent.setup()

    render(<PartialReviewPanel docId="doc-1" review={baseReview} onAccepted={onAccepted} />)
    await user.click(screen.getByRole('button', { name: /accept and continue/i }))

    expect(await screen.findByText(/checksum failed/i)).toBeInTheDocument()
    expect(onAccepted).not.toHaveBeenCalled()
  })

  it('sends confirmed/corrected resolutions matching whether the value changed', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }))
    const user = userEvent.setup()

    render(<PartialReviewPanel docId="doc-1" review={baseReview} onAccepted={vi.fn()} />)
    const phoneInput = screen.getByDisplayValue('0821234567')
    await user.clear(phoneInput)
    await user.type(phoneInput, '0829999999')
    await user.click(screen.getByRole('button', { name: /accept and continue/i }))

    await screen.findByRole('button', { name: /accept and continue/i })
    const call = vi.mocked(fetch).mock.calls[0]
    const sentBody = JSON.parse(call[1]!.body as string)
    expect(sentBody.resolutions).toEqual(
      expect.arrayContaining([
        { fieldKey: 'id_number', resolutionType: 'confirmed' },
        { fieldKey: 'phone', resolutionType: 'corrected', correctedValue: '0829999999' },
      ])
    )
  })

  it('excludes a clarify-flagged field from client-side required validation', async () => {
    const user = userEvent.setup()
    render(<PartialReviewPanel docId="doc-1" review={baseReview} onAccepted={vi.fn()} />)

    const idInput = screen.getByDisplayValue('8001015009087')
    await user.clear(idInput)
    await user.click(screen.getAllByRole('button', { name: /can't verify this/i })[0])
    await user.click(screen.getByRole('button', { name: /flag 1 field for clarification/i }))

    expect(screen.queryByText(/ID Number is required/i)).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalled()
  })

  it('shows a saved message instead of calling onAccepted when the response has pending clarifications', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true, pendingClarification: ['id_number'] }))
    const onAccepted = vi.fn()
    const user = userEvent.setup()

    render(<PartialReviewPanel docId="doc-1" review={baseReview} onAccepted={onAccepted} />)
    await user.click(screen.getAllByRole('button', { name: /can't verify this/i })[0])
    await user.click(screen.getByRole('button', { name: /flag 1 field for clarification/i }))

    expect(await screen.findByText(/waiting on the client for 1 field/i)).toBeInTheDocument()
    expect(onAccepted).not.toHaveBeenCalled()
  })
})
