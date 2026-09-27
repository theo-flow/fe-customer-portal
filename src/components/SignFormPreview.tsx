'use client'
import { useEffect, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { FIELD_TYPE_LABELS, isReadType, type FormLayout } from '@/lib/sign-form'
import { askedSteps, emailLines, inReadingOrder, roleColour } from '@/lib/sign-form-preview'

// Set in this module, as react-pdf requires (see the signing page's DocumentPreview).
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

const MAX_PAGE_WIDTH = 560

// A saved Sign form as it will be sent: every page with each box numbered and
// coloured by who fills it in, what each person is asked, and what their
// signing email tells them to do. Read only; available whether or not the form
// has been sent before.
export default function SignFormPreview({ sampleUrl, layout }: { sampleUrl: string; layout: FormLayout }) {
  const [numPages, setNumPages] = useState(0)
  const [failed, setFailed] = useState(false)
  const [pageWidth, setPageWidth] = useState(360)

  useEffect(() => {
    const compute = () => setPageWidth(Math.min(MAX_PAGE_WIDTH, window.innerWidth - 48))
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [])

  const boxes = inReadingOrder(layout.fields.filter(f => !isReadType(f.field_type)))
  const number = new Map(boxes.map((f, i) => [f.field_id, i + 1]))

  return (
    <div className="space-y-8">
      <p className="text-[13px] text-gray-500">
        {boxes.length} box{boxes.length !== 1 ? 'es' : ''} &middot; signed by {layout.roles.join(', ')} &middot;{' '}
        {layout.standard_document ? 'no upload, the same document is sent to everyone' : "staff upload each customer's own copy when sending"}
      </p>

      <section aria-labelledby="pv-boxes">
        <h2 id="pv-boxes" className="text-[14px] font-semibold text-black mb-1">Boxes on the form</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
          {layout.roles.map(r => (
            <span key={r} className="inline-flex items-center gap-1.5 text-[12px] text-gray-600">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: roleColour(layout.roles, r) }} />{r}
            </span>
          ))}
        </div>
        {failed ? (
          <p role="alert" className="text-[13px] text-red-600">The form&apos;s pages could not be shown. Reload the page to try again.</p>
        ) : (
          <Document file={sampleUrl} onLoadSuccess={({ numPages: n }) => setNumPages(n)} onLoadError={() => setFailed(true)}
                    loading={<div className="h-64 rounded-xl bg-gray-50 animate-pulse" />}>
            <div className="flex flex-wrap gap-4">
              {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
                <div key={pageNum}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400 mb-1">Page {pageNum}</p>
                  <div className="relative border border-black/[0.1] bg-white" style={{ width: pageWidth }}>
                    <Page pageNumber={pageNum} width={pageWidth} renderTextLayer={false} renderAnnotationLayer={false} />
                    {boxes.filter(f => f.page === pageNum).map(f => {
                      const c = roleColour(layout.roles, f.role)
                      return (
                        <div key={f.field_id} className="absolute border-[1.5px] rounded-[2px]"
                             title={`${number.get(f.field_id)}. ${FIELD_TYPE_LABELS[f.field_type]} - ${f.role}: ${f.instruction}`}
                             style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%`, borderColor: c, background: `${c}22` }}>
                          <span className="absolute -top-[14px] -left-[1.5px] px-1 text-[10px] font-semibold leading-[14px] text-white rounded-t-[3px]" style={{ background: c }}>
                            {number.get(f.field_id)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Document>
        )}
      </section>

      <section aria-labelledby="pv-asked">
        <h2 id="pv-asked" className="text-[14px] font-semibold text-black mb-3">What each person is asked, and their email</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {layout.roles.map(r => (
            <div key={r} className="rounded-xl border border-black/[0.08] px-4 py-3">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-black mb-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: roleColour(layout.roles, r) }} />{r}
              </p>
              <ol className="list-decimal pl-5 space-y-1 text-[13px] text-black">
                {askedSteps(layout.fields, r).map(step => (
                  <li key={step.title}>
                    {step.title}
                    {step.items.length > 0 && (
                      <ol className="list-[lower-alpha] pl-5 mt-1 space-y-0.5 text-gray-600">
                        {step.items.map((q, i) => <li key={i}>{q}</li>)}
                      </ol>
                    )}
                  </li>
                ))}
              </ol>
              <p className="text-[12px] font-semibold text-black mt-3 mb-1">What their email tells them to do</p>
              <ul className="space-y-0.5 text-[12px] text-gray-600">
                {emailLines(layout.fields, r).map(line => <li key={line}>{line}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
