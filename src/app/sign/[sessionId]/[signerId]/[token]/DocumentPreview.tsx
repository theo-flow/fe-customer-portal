'use client'
import { useEffect, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import type { DetectedField } from '@/lib/sign'
import { orderFields } from '@/lib/sign-tasks'

// Must be set in this same module (react-pdf's requirement) -- setting it
// elsewhere and importing this component later can let the default value
// win due to module execution order.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const FIELD_TYPE_LABELS: Record<DetectedField['field_type'], string> = {
  signature: 'Sign here',
  initials: 'Initials',
  name: 'Printed name',
  date: 'Date',
  place: 'Place',
}

// What has been put into a box so far: a drawn image, or text.
export interface BoxValue {
  kind:  'image' | 'text'
  value: string
}

const MAX_PAGE_WIDTH = 640
const PAGE_HORIZONTAL_PADDING = 48

// The document the signer works ON. Every box they have to fill is drawn over
// the real page. A box shows what has been put into it (so they see exactly
// what will be stamped), is highlighted while it is the thing being asked for
// (activeType), turns green once done, and can be clicked to jump to it.
// Purely presentational: SignCapture owns the fetch and all the answers, and
// falls back to its plain flow on any load error (see onError below).
export default function DocumentPreview({
  url, fields, values = {}, activeType = null, review = false, onError, onBoxClick,
}: {
  url:          string
  fields:       DetectedField[]
  values?:      Record<string, BoxValue>
  activeType?:  DetectedField['field_type'] | null
  /** The final check: every page, and only what has been entered, as it will be stamped. */
  review?:      boolean
  onError:      () => void
  onBoxClick?:  (field: DetectedField) => void
}) {
  const [numPages, setNumPages]   = useState(0)
  const [pageWidth, setPageWidth] = useState(360)

  useEffect(() => {
    const compute = () => setPageWidth(Math.min(MAX_PAGE_WIDTH, window.innerWidth - PAGE_HORIZONTAL_PADDING))
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [])

  const ordered = orderFields(fields)   // the same numbering the checklist uses
  const pagesWithFields = Array.from(new Set(fields.map(f => f.page))).sort((a, b) => a - b)
  const pagesToShow = review && numPages > 0
    ? Array.from({ length: numPages }, (_, i) => i + 1)
    : pagesWithFields.length > 0 ? pagesWithFields : [1]

  // Bring the boxes being asked for into view as the signer moves on.
  useEffect(() => {
    if (!activeType) return
    const first = ordered.find(f => f.field_type === activeType)
    if (first?.field_id) document.getElementById(`sbox-${first.field_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType, numPages])

  return (
    <div className="space-y-3">
      <Document
        file={url}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        onLoadError={onError}
        loading={<div className="h-64 rounded-xl bg-gray-50 animate-pulse" />}
      >
        {pagesToShow
          .filter(p => numPages === 0 || p <= numPages)
          .map(pageNum => (
            <div key={pageNum} className="mb-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400 mb-1">Page {pageNum}</p>
              <div className="relative rounded-xl border border-black/[0.08] overflow-hidden bg-white" style={{ width: pageWidth }}>
                <Page pageNumber={pageNum} width={pageWidth} renderTextLayer={false} renderAnnotationLayer={false} />
                {fields.filter(f => f.page === pageNum).map((field, i) => {
                  const value = field.field_id ? values[field.field_id] : undefined
                  const done = !!value
                  const active = !done && activeType === field.field_type
                  const tone = review
                    ? 'border-transparent'
                    : done
                    ? 'border-green-500 bg-green-500/10'
                    : active
                      ? 'border-indigo-600 bg-indigo-500/20 ring-2 ring-indigo-300 animate-pulse'
                      : 'border-indigo-300 bg-indigo-500/5'
                  return (
                    <div
                      key={field.field_id ?? i}
                      id={field.field_id ? `sbox-${field.field_id}` : undefined}
                      role={onBoxClick ? 'button' : undefined}
                      tabIndex={onBoxClick ? 0 : undefined}
                      aria-label={`${ordered.indexOf(field) + 1}. ${FIELD_TYPE_LABELS[field.field_type]}${done ? ' (done)' : ''}`}
                      onClick={onBoxClick ? () => onBoxClick(field) : undefined}
                      onKeyDown={onBoxClick ? e => { if (e.key === 'Enter' || e.key === ' ') onBoxClick(field) } : undefined}
                      className={`absolute border-2 rounded-sm flex items-center overflow-hidden ${tone} ${onBoxClick ? 'cursor-pointer' : 'pointer-events-none'}`}
                      style={{
                        left:   `${field.x * 100}%`,
                        top:    `${field.y * 100}%`,
                        width:  `${field.width * 100}%`,
                        height: `${field.height * 100}%`,
                      }}
                    >
                      {!review && <span className={`absolute -top-[1px] -left-[1px] text-[10px] font-semibold text-white px-1.5 py-0.5 rounded-br-md whitespace-nowrap ${done ? 'bg-green-600' : 'bg-indigo-500'}`}>
                        {ordered.indexOf(field) + 1}. {FIELD_TYPE_LABELS[field.field_type]}
                      </span>}
                      {value?.kind === 'image' && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={value.value} alt="" className="w-full h-full object-contain" />
                      )}
                      {value?.kind === 'text' && (
                        <span className="px-1 text-[12px] italic text-black whitespace-nowrap overflow-hidden text-ellipsis">{value.value}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
      </Document>
    </div>
  )
}
