import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { DetectedField } from '@/lib/sign'

// react-pdf cannot run in jsdom: only the boxes drawn over the pages matter here.
vi.mock('react-pdf', () => ({
  Document: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}))

import DocumentPreview from '../DocumentPreview'

const box = (over: Partial<DetectedField>): DetectedField => ({
  field_id: 'x', field_type: 'signature', signer_order: 1, page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.04,
  source: 'org_configured', confidence: 1, ...over,
})

// the three stacked boxes at the bottom of the POPI Agreement
const FIELDS: DetectedField[] = [
  box({ field_id: 'sig', field_type: 'signature', y: 0.76, height: 0.053 }),
  box({ field_id: 'nm', field_type: 'name', y: 0.82, height: 0.02 }),
  box({ field_id: 'dt', field_type: 'date', y: 0.85, height: 0.02 }),
]
const noop = () => {}

describe('DocumentPreview labels', () => {
  it('labels a box that is still empty', () => {
    render(<DocumentPreview url="x.pdf" fields={FIELDS} onError={noop} />)
    expect(screen.getByText('1. Sign here')).toBeInTheDocument()
    expect(screen.getByText('2. Printed name')).toBeInTheDocument()
    expect(screen.getByText('3. Date')).toBeInTheDocument()
  })

  it('does not draw a label over a box that has its value, so the value can be read', () => {
    render(
      <DocumentPreview url="x.pdf" fields={FIELDS} onError={noop}
        values={{ nm: { kind: 'text', value: 'Sithembiso Mjoko' }, dt: { kind: 'text', value: '21 September 2026' } }} />,
    )
    expect(screen.getByText('Sithembiso Mjoko')).toBeInTheDocument()
    expect(screen.getByText('21 September 2026')).toBeInTheDocument()
    expect(screen.queryByText('2. Printed name')).not.toBeInTheDocument()
    expect(screen.queryByText('3. Date')).not.toBeInTheDocument()
    // the one still empty keeps its label
    expect(screen.getByText('1. Sign here')).toBeInTheDocument()
  })

  it('a drawn signature also hides its label', () => {
    render(<DocumentPreview url="x.pdf" fields={FIELDS} onError={noop} values={{ sig: { kind: 'image', value: 'data:image/png;base64,AAAA' } }} />)
    expect(screen.queryByText('1. Sign here')).not.toBeInTheDocument()
  })

  it('still marks a filled box as done for screen readers', () => {
    render(<DocumentPreview url="x.pdf" fields={FIELDS} onError={noop} values={{ dt: { kind: 'text', value: '21 September 2026' } }} />)
    expect(screen.getByLabelText('3. Date (done)')).toBeInTheDocument()
  })
})
