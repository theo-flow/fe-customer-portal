'use client'
import { useEffect, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import type { DetectedField } from '@/lib/sign'

// Must be set in this same module (react-pdf's requirement) -- setting it
// elsewhere and importing this component later can let the default value
// win due to module execution order.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const FIELD_TYPE_LABELS: Record<DetectedField['field_type'], string> = {
  signature: 'Sign here',
  date: 'Date',
  place: 'Place',
}

const MAX_PAGE_WIDTH = 520
const PAGE_HORIZONTAL_PADDING = 64

// Purely presentational -- SignCapture owns the single fetch for both the
// document URL and detected fields (it also needs the fields to decide
// whether to show a "place" input), so this component just renders what
// it's given. Never blocks signing: SignCapture only mounts this when a
// url is actually available, and falls back to its plain draw/type flow
// on any load error (see onLoadError below).
export default function DocumentPreview({
  url, fields, onError,
}: {
  url:    string
  fields: DetectedField[]
  onError: () => void
}) {
  const [numPages, setNumPages]   = useState(0)
  const [pageWidth, setPageWidth] = useState(360)

  useEffect(() => {
    const compute = () => setPageWidth(Math.min(MAX_PAGE_WIDTH, window.innerWidth - PAGE_HORIZONTAL_PADDING))
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [])

  const pagesWithFields = Array.from(new Set(fields.map(f => f.page))).sort((a, b) => a - b)
  const pagesToShow = pagesWithFields.length > 0 ? pagesWithFields : [1]

  return (
    <div className="mb-6 space-y-3">
      <Document
        file={url}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        onLoadError={onError}
        loading={<div className="h-64 rounded-xl bg-gray-50 animate-pulse" />}
      >
        {pagesToShow
          .filter(p => numPages === 0 || p <= numPages)
          .map(pageNum => (
            <div key={pageNum} className="relative rounded-xl border border-black/[0.08] overflow-hidden mb-3">
              <Page pageNumber={pageNum} width={pageWidth} renderTextLayer={false} renderAnnotationLayer={false} />
              {fields.filter(f => f.page === pageNum).map((field, i) => (
                <div
                  key={i}
                  className="absolute border-2 border-indigo-500 bg-indigo-500/10 rounded-sm pointer-events-none"
                  style={{
                    left:   `${field.x * 100}%`,
                    top:    `${field.y * 100}%`,
                    width:  `${field.width * 100}%`,
                    height: `${field.height * 100}%`,
                  }}
                >
                  <span className="absolute -top-[1px] -left-[1px] text-[10px] font-semibold text-white bg-indigo-500 px-1.5 py-0.5 rounded-br-md whitespace-nowrap">
                    {FIELD_TYPE_LABELS[field.field_type]}
                  </span>
                </div>
              ))}
            </div>
          ))}
      </Document>
      {pagesWithFields.length > 0 && (
        <p className="text-[12px] text-gray-400">
          Showing {pagesWithFields.length} of {numPages || '…'} page{numPages !== 1 ? 's' : ''} — highlighted where you need to act.
        </p>
      )}
    </div>
  )
}
