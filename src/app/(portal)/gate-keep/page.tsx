'use client'
import { useState, useRef } from 'react'
import { useOrg } from '@/lib/org-context'

const ACCEPTED = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/tiff', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv', 'text/plain',
  'application/zip',
  'video/mp4', 'video/quicktime',
  'audio/mpeg', 'audio/wav',
]
const MAX_MB    = 50
const MAX_BYTES = MAX_MB * 1024 * 1024

type Phase = 'pending' | 'uploading' | 'done' | 'error'

interface FileEntry {
  id:       string
  file:     File
  phase:    Phase
  progress: number
  error:    string
}

function validate(f: File): string {
  if (f.size === 0)             return 'File appears empty.'
  if (!ACCEPTED.includes(f.type)) return 'Unsupported file type.'
  if (f.size > MAX_BYTES)       return `File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_MB} MB.`
  return ''
}

function uploadOne(entry: FileEntry, onProgress: (pct: number) => void): Promise<void> {
  return fetch('/api/gate-keep/presign', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      filename:      entry.file.name,
      contentType:   entry.file.type || 'application/octet-stream',
      contentLength: entry.file.size,
    }),
  }).then(async res => {
    if (!res.ok) {
      const msg = res.status === 403 ? 'Gate-Keep subscription required.'
                : res.status === 415 ? 'Unsupported file type.'
                : res.status === 413 ? `File too large. Max ${MAX_MB} MB.`
                : 'Something went wrong - please try again.'
      throw new Error(msg)
    }
    const { uploadUrl } = await res.json() as { uploadUrl: string; key: string }

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.upload.onprogress = e => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      }
      xhr.onload = () => {
        xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed.'))
      }
      xhr.onerror   = () => reject(new Error('No internet connection.'))
      xhr.ontimeout = () => reject(new Error('Upload timed out.'))
      xhr.timeout   = 120_000
      xhr.open('PUT', uploadUrl)
      xhr.setRequestHeader('Content-Type', entry.file.type || 'application/octet-stream')
      xhr.send(entry.file)
    })
  })
}

export default function GateKeepPage() {
  const { orgName, loading } = useOrg()
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [drag, setDrag]       = useState(false)
  const inputRef              = useRef<HTMLInputElement>(null)

  function setEntry(id: string, patch: Partial<FileEntry>) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))
  }

  function addFiles(files: FileList | File[]) {
    const next: FileEntry[] = Array.from(files).map(file => {
      const err = validate(file)
      return {
        id:       `${file.name}-${file.size}-${crypto.randomUUID()}`,
        file,
        phase:    err ? 'error' : 'pending',
        progress: 0,
        error:    err,
      }
    })
    setEntries(prev => [...prev, ...next])
  }

  async function handleUploadAll() {
    const pending = entries.filter(e => e.phase === 'pending')
    await Promise.allSettled(pending.map(async entry => {
      setEntry(entry.id, { phase: 'uploading', progress: 0, error: '' })
      try {
        await uploadOne(entry, pct => setEntry(entry.id, { progress: pct }))
        setEntry(entry.id, { phase: 'done', progress: 100 })
      } catch (err) {
        setEntry(entry.id, {
          phase: 'error',
          error: err instanceof Error ? err.message : 'Upload failed - please try again.',
        })
      }
    }))
  }

  function handleRemove(id: string) {
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  const pendingCount = entries.filter(e => e.phase === 'pending').length
  const doneCount    = entries.filter(e => e.phase === 'done').length
  const uploading    = entries.some(e => e.phase === 'uploading')

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map(i => (
          <div key={i} className="h-[100px] rounded-2xl border border-black/[0.06] animate-pulse bg-gray-50"/>
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-1">
          {orgName} · Gate-Keep
        </p>
        <h1 className="font-display text-[2.1rem] leading-tight text-black">Your files</h1>
        <p className="text-[13px] text-gray-400 mt-1">
          Upload files to store them securely. Select as many as you like.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e  => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => {
          e.preventDefault(); setDrag(false)
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl cursor-pointer flex flex-col
                    items-center justify-center py-10 transition-all duration-200 mb-4
                    ${drag
                      ? 'border-black bg-gray-50 scale-[1.01]'
                      : 'border-black/[0.12] hover:border-black/[0.3] hover:bg-gray-50/40'}`}>
        <input
          ref={inputRef} type="file" multiple
          className="hidden"
          onChange={e => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = '' }}
        />
        <svg className="w-5 h-5 text-gray-300 mb-2" fill="none" viewBox="0 0 24 24"
             stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021
                   18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
        </svg>
        <p className="text-[12px] font-medium text-gray-500">Drop files here</p>
        <p className="text-[11px] text-gray-300 mt-1">or click to browse · max {MAX_MB} MB per file</p>
      </div>

      {/* File list */}
      {entries.length > 0 && (
        <div className="space-y-2 mb-4">
          {entries.map(entry => (
            <div key={entry.id}
                 className="flex items-center gap-3 px-4 py-3 border border-black/[0.08] rounded-xl bg-gray-50/50">
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24"
                   stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0
                         0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621
                         0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0
                         1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-black truncate">{entry.file.name}</p>
                {entry.phase === 'error' ? (
                  <p className="text-[11px] text-red-500">{entry.error}</p>
                ) : entry.phase === 'uploading' ? (
                  <div className="h-[2px] bg-gray-100 rounded-full overflow-hidden mt-1 w-32">
                    <div className="h-full bg-black transition-all duration-75 rounded-full"
                         style={{ width: `${entry.progress}%` }}/>
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400">{(entry.file.size / 1024 / 1024).toFixed(1)} MB</p>
                )}
              </div>
              {entry.phase === 'done' && (
                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-green-50 text-green-700">
                  Uploaded
                </span>
              )}
              {entry.phase === 'pending' && (
                <button onClick={() => handleRemove(entry.id)}
                        className="text-gray-300 hover:text-gray-600 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {pendingCount > 0 && (
        <button
          onClick={handleUploadAll}
          disabled={uploading}
          className="w-full bg-black text-white text-[13px] font-medium py-3 rounded-full
                     hover:bg-gray-900 transition-colors disabled:opacity-50">
          {uploading ? 'Uploading…' : `Upload ${pendingCount} file${pendingCount === 1 ? '' : 's'}`}
        </button>
      )}

      {doneCount > 0 && pendingCount === 0 && !uploading && (
        <p className="text-[13px] text-green-700 font-medium text-center mt-4">
          {doneCount} file{doneCount === 1 ? '' : 's'} uploaded successfully.
        </p>
      )}
    </div>
  )
}
