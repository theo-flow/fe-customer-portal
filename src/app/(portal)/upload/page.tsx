'use client'
import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useOrg } from '@/lib/org-context'

const ACCEPTED  = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff']
const MAX_MB    = 50
const MAX_BYTES = MAX_MB * 1024 * 1024

type Step = 'group' | 'file' | 'uploading' | 'done'

function presignErrorMessage(status: number): string {
  switch (status) {
    case 400: return "We couldn't read this document. Please check the file and try again."
    // /api/uploads/presign returns 401 whenever no tf_token cookie was sent
    // at all (see route.ts) -- it has no separate "expired" check, so this
    // never actually means "your session expired," only "you're not signed
    // in right now." Asserting expiry here is misleading for someone who
    // was never authenticated in the first place.
    case 401: return 'Please sign in to continue.'
    case 403: return "You don't have permission to upload documents. Please contact your administrator."
    case 409: return 'This document has already been submitted.'
    case 413: return `This file is too large. Please upload a document smaller than ${MAX_MB} MB.`
    case 415: return "This file type isn't supported. Please upload a PDF, JPG, PNG or TIFF."
    case 429: return "You've uploaded too many documents recently. Please wait a few minutes and try again."
    default:  return "Something went wrong on our end. Please try again, or contact support if the issue continues."
  }
}

function s3ErrorMessage(status: number): string {
  switch (status) {
    case 400: return "We couldn't read this document. It may be corrupted — please try a different file."
    case 403: return 'Your upload session expired. Please go back and try again.'
    case 413: return `This file is too large. Please upload a document smaller than ${MAX_MB} MB.`
    case 415: return "This file type isn't supported. Please upload a PDF, JPG, PNG or TIFF."
    default:  return 'The upload failed. Please try again.'
  }
}

export default function UploadPage() {
  const router   = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const xhrRef   = useRef<XMLHttpRequest | null>(null)
  const { subscribedProducts, formGroups, loading } = useOrg()

  const [step,      setStep]     = useState<Step>('group')
  const [group,     setGroup]    = useState<{ group: string; groupLabel: string } | null>(null)
  const [file,      setFile]     = useState<File | null>(null)
  const [dragging,  setDragging] = useState(false)
  const [error,     setError]    = useState('')
  const [progress,  setProgress] = useState(0)

  const validate = (f: File): string => {
    if (f.size === 0)               return 'This file appears to be empty. Please choose a valid document.'
    if (!ACCEPTED.includes(f.type)) return "This file type isn't supported. Please upload a PDF, JPG, PNG or TIFF."
    if (f.size > MAX_BYTES)         return `This file is too large (${(f.size / 1024 / 1024).toFixed(1)} MB). The maximum is ${MAX_MB} MB.`
    return ''
  }

  const selectFile = (f: File) => {
    const err = validate(f)
    if (err) { setError(err); return }
    setError('')
    setFile(f)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) selectFile(f)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setDragging(true) }
  const onDragLeave = () => setDragging(false)

  const cancelUpload = () => {
    xhrRef.current?.abort()
    xhrRef.current = null
  }

  const handleUpload = async () => {
    if (!file) return
    setStep('uploading')
    setProgress(0)
    setError('')

    try {
      // 1. Get presigned URL
      const res = await fetch('/api/uploads/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group:         group?.group,
          groupLabel:    group?.groupLabel,
          filename:      file.name,
          contentType:   file.type || 'application/octet-stream',
          contentLength: file.size,
        }),
      })
      if (!res.ok) {
        throw new Error(presignErrorMessage(res.status))
      }
      const { docId, uploadUrl } = await res.json() as { docId: string; uploadUrl: string }

      // 2. PUT file directly to S3 with real progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhrRef.current = xhr
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100))
        }
        xhr.onload = () => {
          xhrRef.current = null
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve()
          } else {
            reject(new Error(s3ErrorMessage(xhr.status)))
          }
        }
        xhr.onerror = () => {
          xhrRef.current = null
          reject(new Error('No internet connection. Please check your connection and try again.'))
        }
        xhr.onabort = () => {
          xhrRef.current = null
          reject(new Error('Upload cancelled.'))
        }
        xhr.ontimeout = () => {
          xhrRef.current = null
          reject(new Error('The upload is taking too long. Please try again on a stable connection.'))
        }
        xhr.timeout = 120_000
        xhr.open('PUT', uploadUrl)
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
        xhr.send(file)
      })

      // 3. Confirm upload — sets status to UPLOADED in DynamoDB
      const confirmRes = await fetch('/api/uploads/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId }),
      })
      if (!confirmRes.ok) {
        throw new Error(presignErrorMessage(confirmRes.status))
      }

      setStep('done')
      await new Promise(r => setTimeout(r, 400))
      router.push(`/status/${docId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong on our end. Please try again, or contact support if the issue continues.")
      setStep('file')
    }
  }

  const reset = () => {
    setStep('group')
    setGroup(null)
    setFile(null)
    setError('')
    setProgress(0)
  }

  const sizeMB = file ? (file.size / 1024 / 1024).toFixed(1) : ''

  // Decode access guard
  if (!loading && !subscribedProducts.includes('decode')) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-[15px] font-semibold text-black mb-1">Access restricted</p>
        <p className="text-[13px] text-gray-400 mb-6 max-w-xs">
          Document upload requires a TheoFlow Decode subscription. Contact your administrator.
        </p>
        <Link href="/dashboard"
          className="px-6 py-2.5 bg-black text-white text-[13px] font-medium rounded-full hover:bg-gray-900 transition-colors">
          Back to dashboard
        </Link>
      </div>
    )
  }

  return (
    <div className="flex -mx-4 sm:-mx-6 -mt-6 sm:-mt-10 h-[calc(100vh-64px)]">

      {/* ── LEFT: Upload flow ────────────────────────────────── */}
      <div className="flex-1 flex flex-col px-5 sm:px-10 lg:px-14 py-8 pb-24 md:pb-8 overflow-y-auto">

        <div className="mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-2">
            TheoFlow Decode
          </p>
          <h1 className="font-display text-[2.2rem] leading-tight tracking-tight text-black">
            Upload a document
          </h1>
          <p className="mt-2 text-[13px] text-gray-500">
            Select the form group, attach the filled document, and submit it for extraction.
          </p>
        </div>

        {/* Step 1 — Form group */}
        <StepRow n="1" label="Form group" done={!!group} summary={group?.groupLabel}
          onEdit={() => { setGroup(null); setFile(null); setStep('group') }}>
          {step === 'group' && (
            <div className="mt-3 flex flex-wrap gap-2">
              {loading
                ? <p className="text-[13px] text-gray-400">Loading…</p>
                : formGroups.length === 0
                  ? <p className="text-[13px] text-gray-400">No form groups configured for your organisation.</p>
                  : formGroups.map(g => (
                      <button key={g.group}
                        onClick={() => { setGroup(g); setStep('file') }}
                        className="px-4 py-2 rounded-full border border-black/[0.12] text-[13px]
                                   font-medium text-gray-700 hover:border-black hover:text-black
                                   transition-colors bg-white">
                        {g.groupLabel}
                      </button>
                    ))
              }
            </div>
          )}
        </StepRow>

        {/* Step 2 — File */}
        {group && (
          <StepRow n="2" label="Attach document" done={step === 'uploading' || step === 'done'}>

            {step === 'file' && (
              <>
                {!file && (
                  <div
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onClick={() => inputRef.current?.click()}
                    className={`mt-3 border-2 border-dashed rounded-2xl cursor-pointer
                      flex flex-col items-center justify-center py-12 transition-all duration-200
                      ${dragging
                        ? 'border-black bg-gray-50 scale-[1.01]'
                        : 'border-black/[0.15] hover:border-black/[0.35] hover:bg-gray-50/40'}`}>
                    <input ref={inputRef} type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) selectFile(f) }}/>
                    <div className="w-11 h-11 rounded-xl border border-black/[0.08] bg-white
                                    flex items-center justify-center mb-3 shadow-sm">
                      <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24"
                           stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021
                             18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
                      </svg>
                    </div>
                    <p className="text-[13px] font-medium text-black">Drop file here</p>
                    <p className="text-[12px] text-gray-400 mt-1">or click to browse</p>
                    <p className="text-[11px] text-gray-300 mt-2.5">
                      PDF · JPG · PNG · TIFF &nbsp;·&nbsp; up to {MAX_MB} MB
                    </p>
                  </div>
                )}

                {error && <p data-testid="upload-error" className="mt-3 text-[13px] text-red-500 font-medium">{error}</p>}

                {file && (
                  <>
                    <div className="mt-3 flex items-center gap-3 px-4 py-3.5 border
                                    border-black/[0.1] rounded-xl bg-gray-50/50">
                      <div className="w-9 h-9 rounded-lg border border-black/[0.08] bg-white
                                      flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24"
                             stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round"
                            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125
                               1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25
                               m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504
                               1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25
                               a9 9 0 00-9-9z"/>
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-black truncate">{file.name}</p>
                        <p className="text-[12px] text-gray-400">{sizeMB} MB</p>
                      </div>
                      <button onClick={() => setFile(null)}
                        className="text-gray-300 hover:text-gray-600 transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24"
                             stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                      </button>
                    </div>

                    <button onClick={handleUpload}
                      className="mt-4 w-full bg-black text-white text-[13px] font-medium
                                 py-3.5 rounded-full hover:bg-gray-900 transition-colors">
                      Submit to pipeline
                    </button>
                    <button onClick={reset}
                      className="mt-2 w-full text-[13px] text-gray-400 hover:text-black
                                 py-2 transition-colors">
                      Start over
                    </button>
                  </>
                )}
              </>
            )}

            {step === 'uploading' && (
              <div className="mt-3 py-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-7 h-7 rounded-full border-2 border-black border-t-transparent
                                  animate-spin flex-shrink-0"/>
                  <div className="flex-1">
                    <p className="text-[13px] font-medium text-black">Uploading…</p>
                    <p className="text-[12px] text-gray-400 truncate">{file?.name}</p>
                  </div>
                  <span className="font-mono text-[13px] text-black">{progress}%</span>
                </div>
                <div className="h-[2px] bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-black transition-all duration-75 rounded-full"
                       style={{ width: `${progress}%` }}/>
                </div>
                <button onClick={cancelUpload}
                  className="mt-3 w-full text-[13px] text-gray-400 hover:text-black
                             py-2 transition-colors">
                  Cancel
                </button>
              </div>
            )}

          </StepRow>
        )}

      </div>

      {/* ── RIGHT: Art + pipeline ─────────────────────────────── */}
      <div className="hidden lg:flex flex-col w-[42%] xl:w-[44%] flex-shrink-0
                      border-l border-black/[0.06] h-full overflow-hidden">

        {/* Gradient art */}
        <div className="relative overflow-hidden flex-shrink-0" style={{ height: '38%' }}>
          <div className="absolute inset-0" style={{ background: '#EEF0F8' }}/>
          <div className="blob-one absolute rounded-full" style={{
            top: '-10%', right: '-8%', width: '80%', height: '80%',
            background: 'radial-gradient(ellipse at 58% 38%, #E8B84B 0%, #D4952A 42%, transparent 70%)',
            filter: 'blur(48px)', opacity: 0.85,
          }}/>
          <div className="blob-two absolute rounded-full" style={{
            bottom: '-12%', left: '-6%', width: '72%', height: '72%',
            background: 'radial-gradient(ellipse at 40% 62%, #4878CC 0%, #3060B8 42%, transparent 70%)',
            filter: 'blur(52px)', opacity: 0.70,
          }}/>
          <div className="blob-three absolute rounded-full" style={{
            top: '20%', left: '18%', width: '60%', height: '56%',
            background: 'radial-gradient(ellipse at 50% 50%, #F8F0DC 0%, transparent 68%)',
            filter: 'blur(40px)', opacity: 0.88,
          }}/>
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <p className="font-display text-[1.25rem] leading-snug text-black/75 text-center max-w-[200px]">
              One upload. The pipeline handles everything.
            </p>
          </div>
        </div>

        {/* Pipeline steps */}
        <div className="flex-1 flex flex-col px-8 py-6 overflow-hidden">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 mb-5 flex-shrink-0">
            What happens next
          </p>
          <div className="flex-1 flex flex-col justify-between">
            {[
              { n: '01', t: 'Received',   d: 'File validated and assigned a document ID' },
              { n: '02', t: 'Classified', d: 'AI identifies the form type' },
              { n: '03', t: 'Extracted',  d: 'Every field read and confidence-scored' },
              { n: '04', t: 'Validated',  d: 'Rules engine checks completeness' },
              { n: '05', t: 'Filed',      d: 'PDF stored in document hub' },
              { n: '06', t: 'Notified',   d: 'User and operator confirmed via email' },
            ].map(s => (
              <div key={s.n} className="flex gap-3 items-start">
                <span className="font-mono text-[10px] text-gray-300 w-5 flex-shrink-0 pt-0.5">
                  {s.n}
                </span>
                <div>
                  <p className="text-[12px] font-semibold text-black leading-none">{s.t}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{s.d}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-gray-300 text-[10px] mt-5 flex-shrink-0">
            <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24"
                 stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0
                   002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0
                   00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
            </svg>
            256-bit TLS · POPIA compliant · Data stays in South Africa
          </div>
        </div>

      </div>
    </div>
  )
}

function StepRow({ n, label, done, summary, onEdit, children }: {
  n: string
  label: string
  done: boolean
  summary?: string
  onEdit?: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="mb-7">
      <div className="flex items-center gap-3">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0
                         text-[11px] font-semibold transition-colors
                         ${done ? 'bg-black text-white' : 'border border-black/[0.2] text-gray-400'}`}>
          {done
            ? <svg className="w-3 h-3" fill="none" viewBox="0 0 10 10">
                <path d="M2 5l2.5 2.5 3.5-4" stroke="currentColor"
                      strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            : n}
        </div>
        <span className="text-[13px] font-semibold text-black">{label}</span>
        {done && summary && (
          <>
            <span className="text-[12px] text-gray-400">{summary}</span>
            {onEdit && (
              <button onClick={onEdit}
                className="ml-auto text-[12px] text-gray-400 hover:text-black transition-colors">
                Change
              </button>
            )}
          </>
        )}
      </div>
      {children}
    </div>
  )
}
