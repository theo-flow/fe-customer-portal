import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'sub-1' }),
}))

vi.mock('@/lib/org-context', () => ({
  useOrg: () => ({ orgName: 'Test Org', loading: false }),
}))

import SubmissionDetailPage from '../page'

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response
}

const baseDetail = {
  submissionId: 'sub-1',
  group:        'claim',
  groupLabel:   'Motor Car Claim',
  submittedAt:  '2026-07-17T10:00:00Z',
  status:       'RECEIVED',
}

describe('SubmissionDetailPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders answered field values and a missing badge for a blank optional field', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      ...baseDetail,
      extraction: {
        fields: { id_number: '8001015009087', middle_name: '' },
        schemaFields: [
          { key: 'id_number',   label: 'ID Number',   field_type: 'sa_id', required: true,  options: null },
          { key: 'middle_name', label: 'Middle Name', field_type: 'text',  required: false, options: null },
        ],
        aiResolvedFields: [],
        flaggedFields:    [],
        unresolvedFields: ['middle_name'],
      },
    }))

    render(<SubmissionDetailPage />)

    expect(await screen.findByText('Motor Car Claim')).toBeInTheDocument()
    expect(screen.getByText('8001015009087')).toBeInTheDocument()
    expect(screen.getByText('Not found')).toBeInTheDocument()
    expect(screen.getByText('sub-1', { exact: false })).toBeInTheDocument()
  })

  it('shows a not-found state when the submission does not exist', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'Submission not found' }, false, 404))

    render(<SubmissionDetailPage />)

    expect(await screen.findByText('Submission not found')).toBeInTheDocument()
  })

  it('shows a generic error state on network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network down'))

    render(<SubmissionDetailPage />)

    expect(await screen.findByText('Submission not found')).toBeInTheDocument()
    expect(screen.getByText('Could not load submission.')).toBeInTheDocument()
  })
})
