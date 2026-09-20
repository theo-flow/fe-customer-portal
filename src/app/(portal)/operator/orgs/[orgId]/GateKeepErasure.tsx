'use client'
import { useCallback, useEffect, useState } from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { formatFileSize } from '@/lib/gate-keep-view'
import type { ErasureLogEntry, ErasureResult, Inventory } from '@/lib/gate-keep-erasure'

// Operator-only. Erases every Gate-Keep file and folder of one workspace, for a
// verified POPIA request or an account closure. Irreversible, so it asks for the
// workspace id to be typed back and a reason, and every run is recorded.

const MIN_REASON = 10
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const when = (iso: string) => new Date(iso).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })

export function GateKeepErasure({ orgId }: { orgId: string }) {
  const [inv, setInv]         = useState<Inventory | null>(null)
  const [history, setHistory] = useState<ErasureLogEntry[]>([])
  const [loadError, setLoadError] = useState('')

  const [open, setOpen]       = useState(false)
  const [typed, setTyped]     = useState('')
  const [reason, setReason]   = useState('')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')
  const [result, setResult]   = useState<ErasureResult | null>(null)

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const res = await fetch(`/api/operator/orgs/${orgId}/gate-keep`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.message ?? 'Could not read the Gate-Keep data.')
      setInv(body.inventory)
      setHistory(body.history ?? [])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not read the Gate-Keep data.')
    }
  }, [orgId])

  useEffect(() => { load() }, [load])

  const ready = typed === orgId && reason.trim().length >= MIN_REASON && !busy

  async function erase() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/operator/orgs/${orgId}/gate-keep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmOrgId: typed, reason }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.message ?? 'The erasure did not finish.')
      setResult(body.result)
      setOpen(false)
      setTyped('')
      setReason('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The erasure did not finish.')
    } finally {
      setBusy(false)
    }
  }

  const nothing = inv !== null && inv.objectVersions === 0 && inv.deleteMarkers === 0 && inv.files === 0 && inv.folders === 0

  return (
    <section aria-labelledby="gk-erase-title" className="mt-12 rounded-2xl border border-red-200 p-5">
      <h2 id="gk-erase-title" className="text-[15px] font-semibold text-black">Erase Gate-Keep data</h2>
      <p className="mt-1 text-[12px] text-gray-500">
        For a verified data-erasure request or an account closure. Permanently removes every file and folder this
        workspace stores in Gate-Keep. It cannot be undone. Files under a retention lock are left in place.
      </p>

      {loadError && <p role="alert" className="mt-3 text-[13px] text-red-600">{loadError}</p>}

      {inv && (
        <p className="mt-4 text-[13px] text-gray-700">
          {nothing
            ? 'This workspace has no Gate-Keep data.'
            : `${plural(inv.files, 'file')}, ${plural(inv.folders, 'folder')}, ${formatFileSize(inv.bytes)} stored (${plural(inv.objectVersions, 'stored version')}).`}
        </p>
      )}

      {result && (
        <div role="status" className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-[13px] text-gray-700">
          {result.complete ? 'Erasure complete. ' : 'Not finished yet: run it again to continue. '}
          {plural(result.versionsDeleted, 'stored version')} erased ({formatFileSize(result.bytesDeleted)}).
          {result.locked > 0 && ` ${plural(result.locked, 'version')} left in place because of a retention lock.`}
        </div>
      )}

      <button type="button" onClick={() => { setError(''); setOpen(true) }} disabled={!inv || nothing}
        className="mt-4 rounded-full bg-red-600 px-5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-40">
        Erase Gate-Keep data
      </button>

      {history.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Erasure log</p>
          <ul className="space-y-1.5">
            {history.map(h => (
              <li key={`${h.at}-${h.phase}`} className="text-[12px] text-gray-500">
                {when(h.at)}: {h.phase.toLowerCase()} by {h.operatorEmail}. Reason: {h.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Erase all Gate-Keep data?</DialogTitle>
            <DialogDescription>
              This permanently deletes {inv ? plural(inv.files, 'file') : 'every file'} and every folder for workspace{' '}
              <span className="font-mono">{orgId}</span>. It cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <label className="block text-[12px] font-medium text-gray-700">
            Type the workspace id to confirm
            <input value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" spellCheck={false}
              className="mt-1 w-full rounded-lg border border-black/[0.12] px-3 py-2 font-mono text-[13px] outline-none focus:border-black/40"/>
          </label>

          <label className="block text-[12px] font-medium text-gray-700">
            Reason (request or ticket reference)
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
              className="mt-1 w-full rounded-lg border border-black/[0.12] px-3 py-2 text-[13px] outline-none focus:border-black/40"/>
          </label>

          {error && <p role="alert" className="text-[13px] text-red-600">{error}</p>}

          <DialogFooter className="gap-2 sm:gap-2">
            <button type="button" onClick={() => setOpen(false)} disabled={busy}
              className="rounded-full border border-black/[0.12] px-5 py-2 text-[13px] font-medium text-gray-700 transition-colors hover:border-black/30 disabled:opacity-50">
              Cancel
            </button>
            <button type="button" onClick={erase} disabled={!ready}
              className="rounded-full bg-red-600 px-5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-40">
              {busy ? 'Erasing…' : 'Erase permanently'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
