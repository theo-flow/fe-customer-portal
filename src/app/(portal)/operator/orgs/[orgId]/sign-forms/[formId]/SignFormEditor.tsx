'use client'
import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import {
  FIELD_TYPES, FIELD_TYPE_LABELS, DATE_FORMATS, DATE_FORMAT_LABELS, DEFAULT_INSTRUCTIONS,
  MAX_INSTRUCTION_CHARS, MAX_ROLES, MAX_ANCHORS, MAX_ANCHOR_CHARS, isReadType,
  clampBox, newField, repeatOnAllPages, removeRole, renameRole, describeField, fieldsByPage, validateLayout,
  type FieldType, type DateFormat, type FormField, type FormAnchor, type RoleDefault,
} from '@/lib/sign-form'
import { mergeAnchors, suggestAnchors } from '@/lib/pdf-text'

// Must be set in this same module (react-pdf's requirement), same as
// DocumentPreview.tsx.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export interface EditorInitial {
  version:   number
  valid:     boolean
  sampleUrl: string
  layout: {
    name:        string
    page_count:  number
    page_width:  number
    page_height: number
    roles:       string[]
    fields:      FormField[]
    anchors?:    FormAnchor[]
    role_defaults?: RoleDefault[]
    standard_document?: boolean
  }
}

const PAGE_PX = 640
const ROLE_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#0ea5e9', '#8b5cf6', '#ef4444', '#14b8a6']

interface Drag {
  id: string
  mode: 'move' | 'resize'
  startX: number
  startY: number
  rect: DOMRect
  orig: { x: number; y: number; width: number; height: number }
}

interface Notice { kind: 'ok' | 'error'; text: string; warnings?: string[] }

const inputCls = 'w-full rounded-lg border border-black/[0.12] px-3 py-2 text-[13px] focus:outline-none focus:border-black/40'
const labelCls = 'block text-[11px] font-medium text-gray-500 mb-1'

export default function SignFormEditor({ orgId, formId, initial }: { orgId: string; formId: string; initial: EditorInitial }) {
  const { page_count: pageCount, page_width: pageWidth, page_height: pageHeight } = initial.layout

  const [name, setName]         = useState(initial.layout.name)
  const [roles, setRoles]       = useState(initial.layout.roles)
  const [fields, setFields]     = useState<FormField[]>(initial.layout.fields)
  const [anchors, setAnchors]   = useState<FormAnchor[]>(initial.layout.anchors ?? [])
  const [standardDocument, setStandardDocument] = useState(initial.layout.standard_document === true)
  const [suggesting, setSuggesting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [roleDefaults, setRoleDefaults] = useState<RoleDefault[]>(initial.layout.role_defaults ?? [])
  const [version, setVersion]   = useState(initial.version)
  const [valid, setValid]       = useState(initial.valid)
  const [dirty, setDirty]       = useState(false)
  const [saving, setSaving]     = useState(false)
  const [notice, setNotice]     = useState<Notice | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loadError, setLoadError]   = useState(false)

  const [placing, setPlacing]       = useState(false)
  const [addType, setAddType]       = useState<FieldType>('signature')
  const [addRole, setAddRole]       = useState(initial.layout.roles[0] ?? '')
  const [addDateFormat, setAddDateFormat] = useState<DateFormat>('day_month')
  const [newRole, setNewRole]       = useState('')

  const drag = useRef<Drag | null>(null)
  const selected = fields.find(f => f.field_id === selectedId) ?? null
  const colorOf = (role: string) => ROLE_COLORS[Math.max(0, roles.indexOf(role)) % ROLE_COLORS.length]

  // Keep the "add a box for" role valid as roles change.
  useEffect(() => {
    if (!roles.includes(addRole)) setAddRole(roles[0] ?? '')
  }, [roles, addRole])

  // Unsaved changes: warn before the tab closes.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Keyboard: Escape cancels, Delete removes the selected box, arrows nudge it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if (e.key === 'Escape') { setPlacing(false); setSelectedId(null); return }
      if (typing || !selectedId) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        setFields(fs => fs.filter(f => f.field_id !== selectedId))
        setSelectedId(null)
        setDirty(true)
        return
      }
      const step = e.shiftKey ? 0.01 : 0.002
      const move: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
      }
      const m = move[e.key]
      if (m) {
        e.preventDefault()
        setFields(fs => fs.map(f => (f.field_id === selectedId ? clampBox({ ...f, x: f.x + m[0], y: f.y + m[1] }) : f)))
        setDirty(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId])

  function patchField(id: string, patch: Partial<FormField>) {
    setFields(fs => fs.map(f => (f.field_id === id ? clampBox({ ...f, ...patch }) : f)))
    setDirty(true)
  }

  function changeType(field: FormField, type: FieldType) {
    const next: Partial<FormField> = { field_type: type }
    // Keep a hand-written instruction; swap a default for the new type's default.
    if (field.instruction === DEFAULT_INSTRUCTIONS[field.field_type]) next.instruction = DEFAULT_INSTRUCTIONS[type]
    if (type === 'date') next.date_format = field.date_format ?? 'iso'
    setFields(fs => fs.map(f => {
      if (f.field_id !== field.field_id) return f
      const merged = { ...f, ...next }
      if (type !== 'date') delete merged.date_format
      return merged
    }))
    setDirty(true)
  }

  function deleteField(id: string) {
    setFields(fs => fs.filter(f => f.field_id !== id))
    setSelectedId(null)
    setDirty(true)
  }

  // ---- roles ----
  function commitRoleName(role: string, raw: string) {
    const to = raw.replace(/\s+/g, ' ').trim()
    if (!to || to === role) return
    if (roles.some(r => r.toLowerCase() === to.toLowerCase() && r !== role)) {
      setNotice({ kind: 'error', text: `There is already a role called "${to}".` })
      return
    }
    const next = renameRole({ roles, fields }, role, to)
    setRoles(next.roles); setFields(next.fields)
    setRoleDefaults(ds => ds.map(d => (d.role === role ? { ...d, role: to } : d)))
    setDirty(true)
  }

  function addNewRole() {
    const to = newRole.replace(/\s+/g, ' ').trim()
    if (!to) return
    if (roles.length >= MAX_ROLES) { setNotice({ kind: 'error', text: `A form can have at most ${MAX_ROLES} roles.` }); return }
    if (roles.some(r => r.toLowerCase() === to.toLowerCase())) { setNotice({ kind: 'error', text: `There is already a role called "${to}".` }); return }
    setRoles(rs => [...rs, to]); setNewRole(''); setDirty(true)
  }

  function deleteRole(role: string) {
    const count = fields.filter(f => f.role === role).length
    if (count > 0 && !window.confirm(`Remove "${role}"? Its ${count} box${count !== 1 ? 'es' : ''} will be removed too.`)) return
    const next = removeRole({ roles, fields }, role)
    setRoles(next.roles); setFields(next.fields); setSelectedId(null)
    setRoleDefaults(ds => ds.filter(d => d.role !== role))
    setDirty(true)
  }

  // ---- placing and dragging boxes ----
  function onOverlayPointerDown(e: React.PointerEvent<HTMLDivElement>, page: number) {
    if (!placing) { setSelectedId(null); return }
    if (!addRole) { setNotice({ kind: 'error', text: 'Add a role first, then place the box.' }); return }
    const rect = e.currentTarget.getBoundingClientRect()
    const box = newField(addType, addRole, page, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, addDateFormat)
    setFields(fs => [...fs, box])
    setSelectedId(box.field_id)
    setPlacing(false)
    setDirty(true)
  }

  function startDrag(e: React.PointerEvent<HTMLElement>, field: FormField, mode: Drag['mode']) {
    e.stopPropagation()
    e.preventDefault()
    const overlay = e.currentTarget.closest('[data-overlay]') as HTMLElement | null
    if (!overlay) return
    drag.current = {
      id: field.field_id, mode, startX: e.clientX, startY: e.clientY,
      rect: overlay.getBoundingClientRect(),
      orig: { x: field.x, y: field.y, width: field.width, height: field.height },
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    setSelectedId(field.field_id)
  }

  function onDragMove(e: React.PointerEvent<HTMLElement>) {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.startX) / d.rect.width
    const dy = (e.clientY - d.startY) / d.rect.height
    const patch = d.mode === 'move'
      ? { x: d.orig.x + dx, y: d.orig.y + dy }
      : { width: d.orig.width + dx, height: d.orig.height + dy }
    setFields(fs => fs.map(f => (f.field_id === d.id ? clampBox({ ...f, ...patch }) : f)))
    setDirty(true)
  }

  function endDrag(e: React.PointerEvent<HTMLElement>) {
    drag.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
  }

  // ---- recognition phrases ----
  async function suggestPhrases() {
    setSuggesting(true)
    setNotice(null)
    try {
      const { readSampleLines } = await import('./sample-text')
      const found = suggestAnchors(await readSampleLines(initial.sampleUrl), fields)
      if (found.length === 0) {
        setNotice({ kind: 'error', text: 'No fixed wording could be found automatically. Add phrases by hand.' })
        return
      }
      setAnchors(prev => mergeAnchors(prev, found))
      setDirty(true)
    } catch {
      setNotice({ kind: 'error', text: 'The sample could not be read. Add phrases by hand.' })
    } finally {
      setSuggesting(false)
    }
  }

  // ---- delete the whole form ----
  async function deleteForm() {
    if (!window.confirm('Permanently delete this form, its sample document and every saved version? This cannot be undone. Documents already sent from it are not affected.')) return
    setDeleting(true)
    setNotice(null)
    try {
      const res = await fetch(`/api/operator/orgs/${orgId}/sign-forms/${formId}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setNotice({ kind: 'error', text: data.error ?? 'Could not delete the form.' }); return }
      setDirty(false)
      window.location.assign(`/operator/orgs/${orgId}/sign-forms`)
    } catch {
      setNotice({ kind: 'error', text: 'Could not delete the form. Please try again.' })
    } finally {
      setDeleting(false)
    }
  }

  function setDefault(role: string, patch: Partial<RoleDefault>) {
    setRoleDefaults(ds => {
      const existing = ds.find(d => d.role === role)
      return existing
        ? ds.map(d => (d.role === role ? { ...d, ...patch } : d))
        : [...ds, { role, name: '', email: '', ...patch }]
    })
    setDirty(true)
  }

  function updateAnchor(index: number, patch: Partial<FormAnchor>) {
    setAnchors(as => as.map((a, i) => (i === index ? { ...a, ...patch } : a)))
    setDirty(true)
  }

  // ---- save ----
  async function save() {
    setNotice(null)
    const payload = { name, page_count: pageCount, page_width: pageWidth, page_height: pageHeight, roles, fields, anchors, role_defaults: roleDefaults.filter(d => d.name.trim() || d.email.trim()), standard_document: standardDocument }
    const checked = validateLayout(payload)
    if (!checked.ok) { setNotice({ kind: 'error', text: checked.errors[0], warnings: checked.errors.slice(1) }); return }

    setSaving(true)
    try {
      const res = await fetch(`/api/operator/orgs/${orgId}/sign-forms/${formId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseVersion: version, layout: payload }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setNotice({ kind: 'error', text: data.error ?? 'Could not save.' }); return }
      setVersion(data.version)
      setValid(!!data.valid)
      setDirty(false)
      setNotice({ kind: 'ok', text: `Saved as version ${data.version}.`, warnings: data.warnings })
    } catch {
      setNotice({ kind: 'error', text: 'Could not save. Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  const perPage = fieldsByPage(fields, pageCount)

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      {/* ---- the pages ---- */}
      <div className="flex-1 min-w-0 overflow-x-auto">
        {placing && (
          <div className="mb-3 px-4 py-2.5 rounded-xl bg-indigo-50 text-indigo-700 text-[13px]" role="status">
            Click on the page where the {FIELD_TYPE_LABELS[addType].toLowerCase()} for {addRole || 'this role'} should go. Press Escape to cancel.
          </div>
        )}
        {loadError ? (
          <div role="alert" className="px-4 py-3 rounded-xl text-red-600 text-[13px] bg-red-50 border border-red-200">
            The sample document could not be loaded. Reload the page to try again.
          </div>
        ) : (
          <Document
            file={initial.sampleUrl}
            onLoadError={() => setLoadError(true)}
            loading={<div className="h-96 rounded-xl bg-gray-50 animate-pulse" style={{ width: PAGE_PX }} />}
          >
            {Array.from({ length: pageCount }, (_, i) => i + 1).map(pageNum => (
              <div key={pageNum} id={`sf-page-${pageNum}`} className="mb-6">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400 mb-1.5">Page {pageNum}</p>
                <div className="relative border border-black/[0.1] rounded-lg overflow-hidden bg-white" style={{ width: PAGE_PX }}>
                  <Page pageNumber={pageNum} width={PAGE_PX} renderTextLayer={false} renderAnnotationLayer={false} />
                  <div
                    data-overlay
                    className="absolute inset-0"
                    style={{ cursor: placing ? 'crosshair' : 'default', touchAction: 'none' }}
                    onPointerDown={e => onOverlayPointerDown(e, pageNum)}
                  >
                    {fields.filter(f => f.page === pageNum).map(f => {
                      const color = colorOf(f.role)
                      const isSel = f.field_id === selectedId
                      return (
                        <div
                          key={f.field_id}
                          role="button"
                          tabIndex={0}
                          aria-label={describeField(f)}
                          onPointerDown={e => startDrag(e, f, 'move')}
                          onPointerMove={onDragMove}
                          onPointerUp={endDrag}
                          onPointerCancel={endDrag}
                          className="absolute rounded-sm"
                          style={{
                            left: `${f.x * 100}%`, top: `${f.y * 100}%`,
                            width: `${f.width * 100}%`, height: `${f.height * 100}%`,
                            border: `2px solid ${color}`, background: `${color}${isSel ? '40' : '22'}`,
                            boxShadow: isSel ? `0 0 0 2px #fff, 0 0 0 4px ${color}` : undefined,
                            cursor: 'move', touchAction: 'none',
                          }}
                        >
                          <span className="absolute -top-[18px] left-[-2px] text-[10px] font-semibold text-white px-1.5 py-0.5 rounded whitespace-nowrap pointer-events-none"
                                style={{ background: color }}>
                            {describeField(f)}
                          </span>
                          {isSel && (
                            <span
                              onPointerDown={e => startDrag(e, f, 'resize')}
                              onPointerMove={onDragMove}
                              onPointerUp={endDrag}
                              onPointerCancel={endDrag}
                              aria-label="Resize box"
                              className="absolute -right-1.5 -bottom-1.5 w-3 h-3 rounded-full bg-white border-2"
                              style={{ borderColor: color, cursor: 'nwse-resize', touchAction: 'none' }}
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            ))}
          </Document>
        )}
      </div>

      {/* ---- the side panel ---- */}
      <aside className="w-full lg:w-[360px] flex-shrink-0 space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto pr-1">
        <section className="rounded-2xl border border-black/[0.08] px-4 py-4">
          <label className={labelCls} htmlFor="sf-name">Form name</label>
          <input id="sf-name" className={inputCls} value={name} maxLength={80}
                 onChange={e => { setName(e.target.value); setDirty(true) }} />
          <label className="flex items-start gap-2 mt-3 text-[12px] text-gray-600 cursor-pointer">
            <input type="checkbox" checked={standardDocument} className="mt-0.5"
                   onChange={e => { setStandardDocument(e.target.checked); setDirty(true) }} />
            <span>Same document for everyone. Nothing is uploaded when it is sent (a consent or an acknowledgement).</span>
          </label>
          <div className="flex items-center justify-between gap-3 mt-3">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ${
              valid && !dirty ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
              {dirty ? 'Unsaved changes' : valid ? 'Ready to send' : 'Needs work'} · v{version}
            </span>
            <button type="button" onClick={save} disabled={!dirty || saving}
                    className="rounded-full bg-black text-white text-[13px] font-semibold px-5 py-2 disabled:opacity-40">
              {saving ? 'Saving…' : 'Save version'}
            </button>
          </div>
          {notice && (
            <div role={notice.kind === 'error' ? 'alert' : 'status'}
                 className={`mt-3 px-3 py-2.5 rounded-lg text-[12px] ${
                   notice.kind === 'error' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
              <p>{notice.text}</p>
              {notice.warnings && notice.warnings.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-amber-700">
                  {notice.warnings.map(w => <li key={w}>{w}</li>)}
                </ul>
              )}
            </div>
          )}
          <button type="button" onClick={deleteForm} disabled={deleting}
                  className="mt-3 text-[12px] font-medium text-red-500 hover:text-red-700 disabled:opacity-50">
            {deleting ? 'Deleting…' : 'Delete this form'}
          </button>
        </section>

        <section className="rounded-2xl border border-black/[0.08] px-4 py-4">
          <h2 className="text-[13px] font-semibold text-black mb-0.5">Who signs</h2>
          <p className="text-[11px] text-gray-400 mb-3">
            One role for each person who has to do something on this form. When the customer sends it they will type a name and email for each role.
          </p>
          <ul className="space-y-2 mb-3">
            {roles.map(role => (
              <li key={role} className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: colorOf(role) }} />
                <input key={role} defaultValue={role} maxLength={40} aria-label={`Role name: ${role}`}
                       className={inputCls}
                       onBlur={e => commitRoleName(role, e.target.value)}
                       onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                <button type="button" onClick={() => deleteRole(role)} aria-label={`Remove ${role}`}
                        className="text-[12px] text-gray-400 hover:text-red-600 px-1">Remove</button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input className={inputCls} value={newRole} maxLength={40} placeholder="Add a role, for example Witness"
                   aria-label="New role name"
                   onChange={e => setNewRole(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter') addNewRole() }} />
            <button type="button" onClick={addNewRole}
                    className="rounded-lg border border-black/[0.15] text-[12px] font-medium px-3 whitespace-nowrap">Add</button>
          </div>
        </section>

        <section className="rounded-2xl border border-black/[0.08] px-4 py-4">
          <h2 className="text-[13px] font-semibold text-black mb-0.5">People who are always the same</h2>
          <p className="text-[11px] text-gray-400 mb-3">
            For a role that is always the same person, for example the bank's representative who signs as Seller.
            They are filled in on the send screen, and the agent can still change them. Leave blank for a role that changes every time.
          </p>
          <ul className="space-y-3">
            {roles.map(role => {
              const d = roleDefaults.find(x => x.role === role)
              return (
                <li key={role}>
                  <p className="text-[12px] font-medium text-gray-500 mb-1">{role}</p>
                  <div className="flex gap-2">
                    <input aria-label={`Usual name for ${role}`} className={inputCls} placeholder="Name" maxLength={100}
                           value={d?.name ?? ''} onChange={e => setDefault(role, { name: e.target.value })} />
                    <input aria-label={`Usual email for ${role}`} className={inputCls} placeholder="Email" maxLength={120}
                           value={d?.email ?? ''} onChange={e => setDefault(role, { email: e.target.value })} />
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="rounded-2xl border border-black/[0.08] px-4 py-4">
          <h2 className="text-[13px] font-semibold text-black mb-3">Add a box</h2>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <label className={labelCls} htmlFor="sf-add-type">What is needed</label>
              <select id="sf-add-type" className={inputCls} value={addType} onChange={e => setAddType(e.target.value as FieldType)}>
                {FIELD_TYPES.map(t => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="sf-add-role">From whom</label>
              <select id="sf-add-role" className={inputCls} value={addRole} onChange={e => setAddRole(e.target.value)}>
                {roles.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          {addType === 'date' && (
            <div className="mb-2">
              <label className={labelCls} htmlFor="sf-add-datefmt">How the date is written</label>
              <select id="sf-add-datefmt" className={inputCls} value={addDateFormat} onChange={e => setAddDateFormat(e.target.value as DateFormat)}>
                {DATE_FORMATS.map(d => <option key={d} value={d}>{DATE_FORMAT_LABELS[d]}</option>)}
              </select>
            </div>
          )}
          <button type="button" onClick={() => setPlacing(p => !p)} disabled={roles.length === 0}
                  className={`w-full rounded-lg text-[13px] font-semibold py-2.5 transition-colors ${
                    placing ? 'bg-indigo-600 text-white' : 'border border-black/[0.15] text-black hover:border-black/40'} disabled:opacity-40`}>
            {placing ? 'Click on the page…' : 'Place on the page'}
          </button>
        </section>

        {selected && (
          <section className="rounded-2xl border-2 px-4 py-4" style={{ borderColor: colorOf(selected.role) }}>
            <h2 className="text-[13px] font-semibold text-black mb-3">Selected box</h2>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className={labelCls} htmlFor="sf-sel-type">What is needed</label>
                <select id="sf-sel-type" className={inputCls} value={selected.field_type}
                        onChange={e => changeType(selected, e.target.value as FieldType)}>
                  {FIELD_TYPES.map(t => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="sf-sel-role">From whom</label>
                <select id="sf-sel-role" className={inputCls} value={selected.role}
                        onChange={e => patchField(selected.field_id, { role: e.target.value })}>
                  {roles.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            {selected.field_type === 'date' && (
              <div className="mb-2">
                <label className={labelCls} htmlFor="sf-sel-datefmt">How the date is written</label>
                <select id="sf-sel-datefmt" className={inputCls} value={selected.date_format ?? 'iso'}
                        onChange={e => patchField(selected.field_id, { date_format: e.target.value as DateFormat })}>
                  {DATE_FORMATS.map(d => <option key={d} value={d}>{DATE_FORMAT_LABELS[d]}</option>)}
                </select>
              </div>
            )}
            {isReadType(selected.field_type) ? (
              <p className="text-[12px] text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                The signer never sees this box. When someone uploads a copy of this form, the text inside the box is read
                and used to fill in who it is for. Cover only the {selected.field_type === 'read_name' ? 'name' : 'email address'} itself,
                not the label next to it.
              </p>
            ) : (
              <>
                <label className={labelCls} htmlFor="sf-sel-instruction">What the signer is told</label>
                <input id="sf-sel-instruction" className={inputCls} value={selected.instruction} maxLength={MAX_INSTRUCTION_CHARS}
                       onChange={e => patchField(selected.field_id, { instruction: e.target.value })} />
                <label className="flex items-center gap-2 mt-3 text-[12px] text-gray-600">
                  <input type="checkbox" checked={selected.required}
                         onChange={e => patchField(selected.field_id, { required: e.target.checked })} />
                  The signer must complete this
                </label>
              </>
            )}
            <div className="flex flex-wrap gap-2 mt-4">
              {pageCount > 1 && (
                <button type="button"
                        onClick={() => { setFields(fs => repeatOnAllPages(fs, selected.field_id, pageCount)); setDirty(true) }}
                        className="rounded-lg border border-black/[0.15] text-[12px] font-medium px-3 py-2">
                  Repeat on every page
                </button>
              )}
              <button type="button" onClick={() => deleteField(selected.field_id)}
                      className="rounded-lg border border-red-200 text-red-600 text-[12px] font-medium px-3 py-2">
                Delete box
              </button>
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-black/[0.08] px-4 py-4">
          <h2 className="text-[13px] font-semibold text-black mb-0.5">How the system recognises this form</h2>
          <p className="text-[11px] text-gray-400 mb-3">
            Fixed wording that is on every copy of this form, such as the heading or the words beside a signature line.
            Never a name or an amount. When someone uploads a document, these are used to suggest this form.
          </p>
          {anchors.length === 0 ? (
            <p className="text-[12px] text-gray-300 mb-3">No phrases yet, so this form can only be picked from the list.</p>
          ) : (
            <ul className="space-y-2 mb-3">
              {anchors.map((a, i) => (
                <li key={i} className="flex items-center gap-2">
                  <select aria-label={`Page for phrase ${i + 1}`} value={a.page}
                          onChange={e => updateAnchor(i, { page: Number(e.target.value) })}
                          className="rounded-lg border border-black/[0.12] px-2 py-2 text-[12px]">
                    {Array.from({ length: pageCount }, (_, n) => n + 1).map(n => <option key={n} value={n}>Page {n}</option>)}
                  </select>
                  <input aria-label={`Phrase ${i + 1}`} className={inputCls} value={a.text} maxLength={MAX_ANCHOR_CHARS}
                         onChange={e => updateAnchor(i, { text: e.target.value })} />
                  <button type="button" aria-label={`Remove phrase ${i + 1}`}
                          onClick={() => { setAnchors(as => as.filter((_, n) => n !== i)); setDirty(true) }}
                          className="text-[12px] text-gray-400 hover:text-red-600 px-1">Remove</button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={suggestPhrases} disabled={suggesting || anchors.length >= MAX_ANCHORS}
                    className="rounded-lg border border-black/[0.15] text-[12px] font-medium px-3 py-2 disabled:opacity-40">
              {suggesting ? 'Reading the sample…' : 'Suggest from the sample'}
            </button>
            <button type="button" disabled={anchors.length >= MAX_ANCHORS}
                    onClick={() => { setAnchors(as => [...as, { page: 1, text: '' }]); setDirty(true) }}
                    className="rounded-lg border border-black/[0.15] text-[12px] font-medium px-3 py-2 disabled:opacity-40">
              Add a phrase
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-black/[0.08] px-4 py-4">
          <h2 className="text-[13px] font-semibold text-black mb-0.5">What the signer will be asked</h2>
          <p className="text-[11px] text-gray-400 mb-3">Page by page, as it is set up now.</p>
          <div className="space-y-3">
            {perPage.map(({ page, fields: pf }) => (
              <div key={page}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-400 mb-1">Page {page}</p>
                {pf.length === 0 ? (
                  <p className="text-[12px] text-gray-300">Nothing to do on this page.</p>
                ) : (
                  <ul className="space-y-1">
                    {pf.map(f => (
                      <li key={f.field_id}>
                        <button type="button"
                                onClick={() => { setSelectedId(f.field_id); document.getElementById(`sf-page-${f.page}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
                                className={`w-full text-left rounded-lg px-2.5 py-1.5 text-[12px] transition-colors ${
                                  f.field_id === selectedId ? 'bg-black/[0.06]' : 'hover:bg-black/[0.03]'}`}>
                          <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: colorOf(f.role) }} />
                          <span className="font-medium text-black">{describeField(f)}</span>
                          <span className="block text-gray-400 pl-4 truncate">{f.instruction}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  )
}
