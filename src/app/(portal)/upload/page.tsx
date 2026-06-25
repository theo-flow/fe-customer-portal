'use client'
import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

type UploadState = 'idle' | 'selected' | 'uploading' | 'done' | 'error'

const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png']
const ACCEPTED_EXT = '.pdf, .jpg, .jpeg, .png'
const MAX_MB = 10

export default function UploadPage() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<UploadState>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')

  const validate = (f: File): string => {
    if (!ACCEPTED.includes(f.type)) return 'Only PDF, JPG, and PNG files are accepted.'
    if (f.size > MAX_MB * 1024 * 1024) return `File must be under ${MAX_MB}MB.`
    return ''
  }

  const selectFile = (f: File) => {
    const err = validate(f)
    if (err) { setError(err); setState('error'); return }
    setError('')
    setFile(f)
    setState('selected')
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) selectFile(f)
  }, [])

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true) }
  const onDragLeave = () => setDragging(false)

  const handleUpload = async () => {
    if (!file) return
    setState('uploading')
    setProgress(0)

    // Simulate upload progress — replace with real presigned URL PUT
    for (let p = 0; p <= 100; p += 5) {
      await new Promise(r => setTimeout(r, 60))
      setProgress(p)
    }

    // TODO: real flow:
    // 1. POST /uploads/request-url → { doc_id, upload_url }
    // 2. PUT file to upload_url with XMLHttpRequest (for progress events)
    // 3. router.push(`/status/${doc_id}`)

    setState('done')
    await new Promise(r => setTimeout(r, 400))
    router.push('/status/DAI-2026-00142')
  }

  const reset = () => { setState('idle'); setFile(null); setProgress(0); setError('') }

  const sizeMB = file ? (file.size / 1024 / 1024).toFixed(1) : ''

  return (
    <div className="max-w-xl mx-auto">
      <div className="mb-6">
        <h1 className="font-display text-2xl sm:text-3xl text-forest-deep">Upload document</h1>
        <p className="text-slate text-sm mt-1">Submit your insurance form for processing</p>
      </div>

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => state === 'idle' || state === 'error' ? inputRef.current?.click() : undefined}
        className={`
          relative border-2 border-dashed rounded-2xl transition-all duration-200 cursor-pointer
          ${dragging
            ? 'border-accent bg-green-50 scale-[1.01]'
            : state === 'selected' || state === 'uploading' || state === 'done'
              ? 'border-accent/40 bg-green-50/40 cursor-default'
              : state === 'error'
                ? 'border-red-300 bg-red-50'
                : 'border-gray-300 bg-white hover:border-accent hover:bg-green-50/30'
          }
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXT}
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) selectFile(f) }}
        />

        <div className="flex flex-col items-center justify-center px-6 py-12 sm:py-16 text-center">

          {/* Icon */}
          {state === 'idle' || state === 'error' ? (
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-colors
              ${state === 'error' ? 'bg-red-100' : 'bg-gray-100 group-hover:bg-green-100'}`}>
              <svg className={`w-7 h-7 ${state === 'error' ? 'text-red-500' : 'text-gray-400'}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
          ) : state === 'uploading' ? (
            <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-accent animate-spin-slow" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            </div>
          ) : state === 'done' ? (
            <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
          ) : (
            <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
          )}

          {/* Text */}
          {state === 'idle' && (
            <>
              <p className="font-medium text-gray-700 mb-1">Drop your document here</p>
              <p className="text-gray-400 text-sm">or tap to browse</p>
              <p className="text-gray-300 text-xs mt-3">PDF, JPG, PNG · max {MAX_MB}MB</p>
            </>
          )}
          {state === 'error' && (
            <>
              <p className="font-medium text-red-600 mb-1">{error}</p>
              <p className="text-red-400 text-sm">Tap to choose a different file</p>
            </>
          )}
          {state === 'selected' && (
            <>
              <p className="font-medium text-gray-800 mb-0.5 break-all px-4">{file?.name}</p>
              <p className="text-gray-400 text-sm">{sizeMB} MB</p>
            </>
          )}
          {state === 'uploading' && (
            <>
              <p className="font-medium text-gray-700 mb-1">Uploading…</p>
              <p className="text-accent text-sm font-mono">{progress}%</p>
            </>
          )}
          {state === 'done' && (
            <p className="font-medium text-green-700">Upload complete — redirecting…</p>
          )}
        </div>

        {/* Progress bar overlay */}
        {state === 'uploading' && (
          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-green-100 rounded-b-2xl overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-100 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="mt-4 space-y-2">
        {state === 'selected' && (
          <>
            <button onClick={handleUpload} className="btn-primary">
              Upload document
            </button>
            <button onClick={reset} className="w-full py-3 text-sm text-gray-500 hover:text-gray-700 transition-colors">
              Choose a different file
            </button>
          </>
        )}
      </div>

      {/* Tips */}
      {(state === 'idle' || state === 'error') && (
        <div className="mt-6 p-4 bg-forest-deep/5 border border-forest-deep/10 rounded-xl">
          <p className="text-xs font-medium text-forest-mid mb-2">For best results</p>
          <ul className="text-xs text-slate space-y-1">
            <li>• Ensure all text is clearly legible</li>
            <li>• Scan at 300 DPI or higher for physical forms</li>
            <li>• Submit one form per upload</li>
          </ul>
        </div>
      )}
    </div>
  )
}
