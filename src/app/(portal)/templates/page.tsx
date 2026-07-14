'use client'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useOrg } from '@/lib/org-context'
import { FORM_GROUPS } from '@/lib/form-groups'

const ACCEPTED  = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff']
const MAX_MB    = 50
const MAX_BYTES = MAX_MB * 1024 * 1024

type Phase = 'idle' | 'ready' | 'uploading' | 'done' | 'error'
type ServerStatus = 'ANALYZING' | 'READY' | 'ERROR'

// Mirrors fn-00-template-analyser's 6-stage pipeline (Module 8).
const STAGE_LABELS: Record<string, string> = {
  QUEUED:                'Queued',
  OCR:                   'Reading document',
  STRUCTURING:           'Structuring fields',
  DOCUMENT_INTELLIGENCE: 'Assessing complexity',
  FIELD_INFERENCE:       'Inferring field types',
  LLM:                   'Resolving ambiguous fields',
  VALIDATION:            'Validating schema',
}

interface GroupState {
  phase:             Phase
  file?:             File
  progress:          number
  error:             string
  serverStatus?:     ServerStatus
  serverStage?:      string | null
  serverError?:      string | null
  serverFieldCount?: number | null
}

function validate(f: File): string {
  if (f.size === 0)               return 'File appears empty.'
  if (!ACCEPTED.includes(f.type)) return `Unsupported type. Upload a PDF, JPG, PNG or TIFF.`
  if (f.size > MAX_BYTES)         return `File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_MB} MB.`
  return ''
}

// ── Single group upload card ──────────────────────────────────────────────────

function GroupCard({ fg, state, onFileSelect, onUpload, onRetry }: {
  fg:           { group: string; groupLabel: string }
  state:        GroupState
  onFileSelect: (group: string, file: File) => void
  onUpload:     (group: string) => void
  onRetry:      (group: string) => void
}) {
  const inputRef  = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)

  const pick = (f: File) => {
    const err = validate(f)
    if (err) { onFileSelect(fg.group, f); return }
    onFileSelect(fg.group, f)
  }

  const { phase, file, progress, error, serverStatus, serverStage, serverError, serverFieldCount } = state
  const analysed = phase === 'done' && serverStatus === 'READY'
  const failed    = phase === 'done' && serverStatus === 'ERROR'
  const analysing = phase === 'done' && (!serverStatus || serverStatus === 'ANALYZING')

  return (
    <div className="rounded-2xl border border-black/[0.08] p-5">

      {/* Header row */}
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0
                         ${analysed ? 'bg-green-50' : failed ? 'bg-red-50' : 'bg-gray-50'}`}>
          {analysed ? (
            <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24"
                 stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
            </svg>
          ) : failed ? (
            <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24"
                 stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          ) : (
            <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24"
                 stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round"
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0
                       01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z"/>
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-black">{fg.groupLabel}</p>
          {analysing && (
            <p className="text-[12px] text-amber-600 font-medium mt-0.5">
              {serverStage && STAGE_LABELS[serverStage] ? STAGE_LABELS[serverStage] : 'Analysing template…'}
            </p>
          )}
          {analysed && (
            <p className="text-[12px] text-green-600 font-medium mt-0.5">
              {serverFieldCount ?? 0} field{serverFieldCount === 1 ? '' : 's'} extracted
            </p>
          )}
          {failed && (
            <p className="text-[12px] text-red-500 font-medium mt-0.5">
              {serverError || 'Something went wrong while analysing this template.'}
            </p>
          )}
        </div>
        {analysing && (
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full
                           bg-amber-50 text-amber-700">
            Processing
          </span>
        )}
        {analysed && (
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full
                           bg-green-50 text-green-700">
            Ready
          </span>
        )}
        {failed && (
          <button
            onClick={() => onRetry(fg.group)}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-full
                       bg-black text-white hover:bg-gray-800 transition-colors whitespace-nowrap"
          >
            Try again
          </button>
        )}
      </div>

      {/* Drop zone — idle or error */}
      {(phase === 'idle' || phase === 'error') && (
        <>
          <div
            onDragOver={e  => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => {
              e.preventDefault(); setDrag(false)
              const f = e.dataTransfer.files[0]
              if (f) pick(f)
            }}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl cursor-pointer flex flex-col
                        items-center justify-center py-8 transition-all duration-200
                        ${drag
                          ? 'border-black bg-gray-50 scale-[1.01]'
                          : 'border-black/[0.12] hover:border-black/[0.3] hover:bg-gray-50/40'}`}>
            <input
              ref={inputRef} type="file"
              accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) pick(f) }}
            />
            <svg className="w-5 h-5 text-gray-300 mb-2" fill="none" viewBox="0 0 24 24"
                 stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021
                       18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
            </svg>
            <p className="text-[12px] font-medium text-gray-500">Drop blank template here</p>
            <p className="text-[11px] text-gray-300 mt-1">or click to browse · PDF · JPG · PNG · TIFF</p>
          </div>
          {phase === 'error' && (
            <p className="text-[12px] text-red-500 font-medium mt-2">{error}</p>
          )}
        </>
      )}

      {/* File selected — ready to upload */}
      {phase === 'ready' && file && (
        <>
          <div className="flex items-center gap-3 px-4 py-3 border border-black/[0.08]
                          rounded-xl bg-gray-50/50 mb-3">
            <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24"
                 stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0
                       0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621
                       0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0
                       1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-black truncate">{file.name}</p>
              <p className="text-[11px] text-gray-400">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
            </div>
            <button
              onClick={() => onRetry(fg.group)}
              className="text-gray-300 hover:text-gray-600 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
          <button
            onClick={() => onUpload(fg.group)}
            className="w-full bg-black text-white text-[13px] font-medium py-3 rounded-full
                       hover:bg-gray-900 transition-colors">
            Upload template
          </button>
        </>
      )}

      {/* Uploading */}
      {phase === 'uploading' && file && (
        <div className="py-2">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-5 h-5 rounded-full border-2 border-black border-t-transparent
                            animate-spin flex-shrink-0"/>
            <p className="text-[13px] font-medium text-black flex-1 truncate">{file.name}</p>
            <span className="font-mono text-[12px] text-black">{progress}%</span>
          </div>
          <div className="h-[2px] bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-black transition-all duration-75 rounded-full"
                 style={{ width: `${progress}%` }}/>
          </div>
        </div>
      )}

    </div>
  )
}

// ── Add a form group (post-registration -- previously only possible at signup) ──

function AddGroupCard({ existingGroups, onAdded }: {
  existingGroups: string[]
  onAdded:        () => void
}) {
  const [open, setOpen]           = useState(false)
  const [customName, setCustomName] = useState('')
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [error, setError]         = useState('')

  const available = FORM_GROUPS.filter(g => !existingGroups.includes(g.key))

  async function addGroup(group: string | undefined, groupLabel: string) {
    if (!groupLabel.trim()) return
    setSubmitting(group ?? groupLabel)
    setError('')
    try {
      const res = await fetch('/api/organizations/groups', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ group, groupLabel: groupLabel.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Failed to add group.')
        return
      }
      setCustomName('')
      setOpen(false)
      onAdded()
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setSubmitting(null)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl border border-dashed border-black/[0.15] p-5
                   flex items-center justify-center gap-2 text-[13px] font-medium
                   text-gray-400 hover:border-black/30 hover:text-black transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
        </svg>
        Add a form type
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-black/[0.08] p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[14px] font-semibold text-black">Add a form type</p>
        <button onClick={() => setOpen(false)} className="text-gray-300 hover:text-gray-600 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      {error && <p className="text-[12px] text-red-500 font-medium mb-3">{error}</p>}

      {available.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          {available.map(g => (
            <button
              key={g.key}
              onClick={() => addGroup(g.key, g.label)}
              disabled={submitting !== null}
              className="text-left rounded-xl border border-black/[0.08] px-3.5 py-3
                         hover:border-black/25 transition-colors disabled:opacity-50"
            >
              <p className="text-[12.5px] font-semibold text-black">{g.label}</p>
              <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{g.description}</p>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-3 border-t border-black/[0.06]">
        <input
          value={customName}
          onChange={e => setCustomName(e.target.value)}
          placeholder="Or type a custom form type…"
          className="flex-1 px-3 py-2 rounded-lg border border-black/[0.12] text-[13px]
                     outline-none focus:border-black/40"
        />
        <button
          onClick={() => addGroup(undefined, customName)}
          disabled={!customName.trim() || submitting !== null}
          className="text-[12px] font-semibold px-4 py-2 rounded-full bg-black text-white
                     hover:bg-gray-800 transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {submitting === customName ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const { orgId, orgName, subscribedProducts, formGroups, loading, refetch } = useOrg()

  const [states, setStates] = useState<Record<string, GroupState>>({})

  function getState(group: string): GroupState {
    return states[group] ?? { phase: 'idle', progress: 0, error: '' }
  }

  function setState(group: string, patch: Partial<GroupState>) {
    setStates(prev => ({
      ...prev,
      [group]: { ...getState(group), ...patch },
    }))
  }

  // Poll for pipeline status on every group whose upload finished but hasn't
  // resolved server-side yet — without this, "done" just sits on a static
  // "Analysing template…" label forever regardless of what actually happens.
  useEffect(() => {
    const pending = Object.entries(states)
      .filter(([, s]) => s.phase === 'done' && s.serverStatus !== 'READY' && s.serverStatus !== 'ERROR')
      .map(([group]) => group)

    if (pending.length === 0) return

    let cancelled = false
    const checkAll = async () => {
      for (const group of pending) {
        try {
          const res = await fetch(`/api/forms/${group}/versions`)
          if (!res.ok || cancelled) continue
          const data = await res.json() as { versions: Array<{
            status: 'ANALYZING' | 'READY' | 'ERROR'
            processingStage: string | null
            errorMessage: string | null
            fieldCount: number
          }> }
          const latest = data.versions[0]
          if (!latest || cancelled) continue
          setState(group, {
            serverStatus:     latest.status,
            serverStage:      latest.processingStage,
            serverError:      latest.errorMessage,
            serverFieldCount: latest.fieldCount,
          })
        } catch {
          // transient — next 5s tick retries
        }
      }
    }

    checkAll()
    const t = setInterval(checkAll, 5000)
    return () => { cancelled = true; clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states])

  function handleFileSelect(group: string, file: File) {
    const err = validate(file)
    if (err) {
      setState(group, { phase: 'error', file, error: err })
    } else {
      setState(group, { phase: 'ready', file, error: '' })
    }
  }

  async function handleUpload(group: string) {
    const st = getState(group)
    if (!st.file) return
    const fg = formGroups.find(g => g.group === group)
    if (!fg) return

    setState(group, { phase: 'uploading', progress: 0, error: '' })

    try {
      // 1. Get presigned URL
      const res = await fetch('/api/templates/presign', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          group:         fg.group,
          groupLabel:    fg.groupLabel,
          filename:      st.file.name,
          contentType:   st.file.type || 'application/octet-stream',
          contentLength: st.file.size,
        }),
      })

      if (!res.ok) {
        const msg = res.status === 403 ? 'Forge subscription required.'
                  : res.status === 415 ? 'Unsupported file type.'
                  : res.status === 413 ? `File too large. Max ${MAX_MB} MB.`
                  : 'Something went wrong — please try again.'
        setState(group, { phase: 'error', error: msg })
        return
      }

      const { uploadUrl } = await res.json() as { uploadUrl: string; key: string }

      // 2. PUT directly to S3 with progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            setState(group, { progress: Math.round((e.loaded / e.total) * 100) })
        }
        xhr.onload = () => {
          xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed.'))
        }
        xhr.onerror   = () => reject(new Error('No internet connection.'))
        xhr.ontimeout = () => reject(new Error('Upload timed out.'))
        xhr.timeout   = 120_000
        xhr.open('PUT', uploadUrl)
        xhr.setRequestHeader('Content-Type', st.file!.type || 'application/octet-stream')
        xhr.send(st.file)
      })

      setState(group, { phase: 'done', progress: 100, error: '' })

    } catch (err) {
      setState(group, {
        phase: 'error',
        error: err instanceof Error ? err.message : 'Upload failed — please try again.',
      })
    }
  }

  function handleRetry(group: string) {
    setState(group, { phase: 'idle', file: undefined, progress: 0, error: '' })
  }

  const doneCount = formGroups.filter(fg => getState(fg.group).phase === 'done').length

  // Forge access guard
  if (!loading && !subscribedProducts.includes('forge')) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-[15px] font-semibold text-black mb-1">Access restricted</p>
        <p className="text-[13px] text-gray-400 mb-6 max-w-xs">
          Template upload requires a TheoFlow Forge subscription. Contact your administrator.
        </p>
        <Link href="/dashboard"
              className="px-6 py-2.5 bg-black text-white text-[13px] font-medium
                         rounded-full hover:bg-gray-900 transition-colors">
          Back to dashboard
        </Link>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-[140px] rounded-2xl border border-black/[0.06] animate-pulse bg-gray-50"/>
        ))}
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 mb-1">
          {orgName} · TheoFlow Forge
        </p>
        <h1 className="font-display text-[2.1rem] leading-tight text-black">Blank templates</h1>
        <p className="text-[13px] text-gray-400 mt-1">
          Upload a blank PDF for each form group. Once analysed, a shareable digital form appears on your Forms page.
        </p>
      </div>

      {/* Progress banner when some are done */}
      {doneCount > 0 && doneCount < formGroups.length && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-5 py-3.5 mb-6
                        flex items-center gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0"/>
          <p className="text-[13px] text-amber-800">
            {doneCount} of {formGroups.length} templates uploaded and being analysed.
            Upload the remaining templates or{' '}
            <Link href="/forms" className="font-semibold underline underline-offset-2">
              view your forms
            </Link>.
          </p>
        </div>
      )}

      {/* All done banner */}
      {doneCount === formGroups.length && formGroups.length > 0 && (
        <div className="rounded-2xl border border-green-100 bg-green-50 px-5 py-3.5 mb-6
                        flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24"
                 stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
            </svg>
            <p className="text-[13px] text-green-800 font-medium">
              All templates uploaded. TheoFlow Forge is analysing them now.
            </p>
          </div>
          <Link href="/forms"
                className="flex-shrink-0 text-[12px] font-semibold px-4 py-2 rounded-full
                           bg-black text-white hover:bg-gray-800 transition-colors">
            View forms →
          </Link>
        </div>
      )}

      {/* No form groups yet -- can add one directly now, no admin needed */}
      {formGroups.length === 0 && (
        <div className="rounded-2xl border border-black/[0.06] py-16 text-center mb-6">
          <p className="text-[15px] font-semibold text-black mb-1">No form types yet</p>
          <p className="text-[13px] text-gray-400">Add one below to start uploading templates.</p>
        </div>
      )}

      {/* Group cards */}
      {formGroups.length > 0 && (
        <div className="space-y-3 mb-3">
          {formGroups.map(fg => (
            <GroupCard
              key={fg.group}
              fg={fg}
              state={getState(fg.group)}
              onFileSelect={handleFileSelect}
              onUpload={handleUpload}
              onRetry={handleRetry}
            />
          ))}
        </div>
      )}

      <AddGroupCard existingGroups={formGroups.map(fg => fg.group)} onAdded={refetch}/>
    </div>
  )
}
