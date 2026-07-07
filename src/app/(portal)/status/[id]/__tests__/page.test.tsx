import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'doc-1' }),
}))

import StatusPage from '../page'

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response
}

const baseMeta = {
  filename:  'form.pdf',
  fileSize:  12345,
  product:   'decode',
  docType:   'application-form',
  createdAt: '2026-07-01T00:00:00Z',
}

describe('StatusPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('shows an in-progress state for an active, non-failed stage', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ activeStage: 2, failed: false, validationErrors: [], ...baseMeta })
    )

    render(<StatusPage />)

    expect(await screen.findByText('In the pipeline')).toBeInTheDocument()
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.queryByText('Rejected')).not.toBeInTheDocument()
  })

  it('shows a distinct rejected state (not "in progress") when the pipeline reports INVALID', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        activeStage: 4,
        failed: true,
        validationErrors: ['ID number is invalid', 'Missing signature'],
        ...baseMeta,
      })
    )

    render(<StatusPage />)

    expect(await screen.findByText('We couldn’t validate this document')).toBeInTheDocument()
    expect(screen.getByText('Rejected')).toBeInTheDocument()
    expect(screen.queryByText('In progress')).not.toBeInTheDocument()
    expect(screen.getByText('ID number is invalid')).toBeInTheDocument()
    expect(screen.getByText('Missing signature')).toBeInTheDocument()
  })

  it('stops polling once the document is rejected, instead of polling forever', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ activeStage: 4, failed: true, validationErrors: [], ...baseMeta })
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<StatusPage />)

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps polling while the document is still in progress', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ activeStage: 2, failed: false, validationErrors: [], ...baseMeta })
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<StatusPage />)

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
