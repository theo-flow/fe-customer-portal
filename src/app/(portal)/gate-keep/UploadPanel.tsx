'use client'
import { useRef, useState } from 'react'
import { ALLOWED_CONTENT_TYPES, MAX_UPLOAD_BYTES } from '@/lib/gate-keep-catalog'
import { formatFileSize } from '@/lib/gate-keep-view'
import { api } from './api'

const MAX_MB = MAX_UPLOAD_BYTES / 1024 / 1024

type Phase = 'pending' | 'uploading' | 'done' | 'error'

interface FileEntry {
  id:       string
  file:     File
  phase:    Phase
  progress: number
  error:    string
}

function validate(f: File): string {
  if (f.size === 0)                        return 'File appears empty.'
  if (!ALLOWED_CONTENT_TYPES.includes(f.type)) return 'Unsupported file type.'
  if (f.size > MAX_UPLOAD_BYTES)           return `File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_MB} MB.`
  return ''
}

// Three steps per file: reserve it (get a presigned URL), send the bytes straight
// to S3, then confirm so it appears in its folder.
async function uploadOne(folderId: string, entry: FileEntry, onProgress: (pct: number) => void): Promise<void> {
  const { fileId, uploadUrl } = await api<{ fileId: string; uploadUrl: string }>('POST', '/api/gate-keep/files', {
    folderId,
    filename:      entry.file.name,
    contentType:   entry.file.type || 'application/octet-stream',
    contentLength: entry.file.size,
  })

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)) }
    xhr.onload    = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed.')))
    xhr.onerror   = () => reject(new Error('No internet connection.'))
    xhr.ontimeout = () => reject(new Error('Upload timed out.'))
    xhr.timeout   = 120_000
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('Content-Type', entry.file.type || 'application/octet-stream')
    xhr.send(entry.file)
  })

  await api('POST', `/api/gate-keep/files/${fileId}/confirm`)
}

export function UploadPanel({ folderId, folderLabel, note, onUploaded }: {
  folderId:    string
  folderLabel: string
  // Shown under the destination, for example that what is added here belongs to the organisation.
  note?: string
  onUploaded:  () => void
}) {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [drag, setDrag]       = useState(false)
  const inputRef              = useRef<HTMLInputElement>(null)

  function setEntry(id: string, patch: Partial<FileEntry>) {
    setEntries(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)))
  }

  function addFiles(files: FileList | File[]) {
    const next: FileEntry[] = Array.from(files).map(file => {
      const err = validate(file)
      return { id: `${file.name}-${file.size}-${crypto.randomUUID()}`, file, phase: err ? 'error' : 'pending', progress: 0, error: err }
    })
    setEntries(prev => [...prev, ...next])
  }

  async function handleUploadAll() {
    const pending = entries.filter(e => e.phase === 'pending')
    await Promise.allSettled(pending.map(async entry => {
      setEntry(entry.id, { phase: 'uploading', progress: 0, error: '' })
      try {
        await uploadOne(folderId, entry, pct => setEntry(entry.id, { progress: pct }))
        setEntry(entry.id, { phase: 'done', progress: 100 })
      } catch (err) {
        setEntry(entry.id, { phase: 'error', error: err instanceof Error ? err.message : 'Upload failed - please try again.' })
      }
    }))
    onUploaded()
  }

  const pendingCount = entries.filter(e => e.phase === 'pending').length
  const doneCount    = entries.filter(e => e.phase === 'done').length
  const uploading    = entries.some(e => e.phase === 'uploading')

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className={`mb-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed py-10 transition-all duration-200 ${
          drag ? 'scale-[1.01] border-black bg-gray-50' : 'border-black/[0.12] hover:border-black/[0.3] hover:bg-gray-50/40'
        }`}>
        <input ref={inputRef} type="file" multiple className="hidden"
          onChange={e => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = '' }}/>
        <svg className="mb-2 h-5 w-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
        </svg>
        <p className="text-[12px] font-medium text-gray-500">Drop files here</p>
        <p className="mt-1 text-[11px] text-gray-300">or click to browse · max {MAX_MB} MB per file</p>
        <p className="mt-1 text-[11px] text-gray-400">Uploading to: {folderLabel}</p>
        {note && <p role="note" className="mt-1 text-[11px] font-medium text-amber-700">{note}</p>}
      </div>

      {entries.length > 0 && (
        <div className="mb-4 space-y-2">
          {entries.map(entry => (
            <div key={entry.id} className="flex items-center gap-3 rounded-xl border border-black/[0.08] bg-gray-50/50 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-black">{entry.file.name}</p>
                {entry.phase === 'error' ? (
                  <p className="text-[11px] text-red-500">{entry.error}</p>
                ) : entry.phase === 'uploading' ? (
                  <div className="mt-1 h-[2px] w-32 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-black transition-all duration-75" style={{ width: `${entry.progress}%` }}/>
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400">{formatFileSize(entry.file.size)}</p>
                )}
              </div>
              {entry.phase === 'done' && (
                <span className="rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-semibold text-green-700">Uploaded</span>
              )}
              {entry.phase === 'pending' && (
                <button onClick={() => setEntries(prev => prev.filter(e => e.id !== entry.id))} aria-label={`Remove ${entry.file.name}`}
                  className="text-gray-300 transition-colors hover:text-gray-600">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {pendingCount > 0 && (
        <button onClick={handleUploadAll} disabled={uploading}
          className="w-full rounded-full bg-black py-3 text-[13px] font-medium text-white transition-colors hover:bg-gray-900 disabled:opacity-50">
          {uploading ? 'Uploading…' : `Upload ${pendingCount} file${pendingCount === 1 ? '' : 's'}`}
        </button>
      )}

      {doneCount > 0 && pendingCount === 0 && !uploading && (
        <p className="mt-4 text-center text-[13px] font-medium text-green-700">
          {doneCount} file{doneCount === 1 ? '' : 's'} uploaded successfully.
        </p>
      )}
    </div>
  )
}
