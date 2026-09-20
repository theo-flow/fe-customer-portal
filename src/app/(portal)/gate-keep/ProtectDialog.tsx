'use client'
import { useEffect, useMemo, useState } from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { MAX_RETENTION_DAYS, MAX_RETENTION_YEARS, MIN_RETENTION_DAYS } from '@/lib/gate-keep-catalog'

// Choose how long a file (or several) is protected from deletion. Irreversible by design:
// nobody can delete before the date, and it can only be extended. So it asks for a
// deliberate confirmation, and shows exactly what date will apply.

const DAY_MS = 24 * 3600 * 1000
const YEARS = [1, 3, 5, 7, 10] as const
const CUSTOM = 'custom'

const addYears = (from: Date, n: number) => { const d = new Date(from); d.setUTCFullYear(d.getUTCFullYear() + n); return d }
const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const nice = (d: Date) => d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

interface ProtectDialogProps {
  open:         boolean
  onOpenChange: (open: boolean) => void
  files:        { id: string; name: string; retainUntil?: string | null }[]
  busy?:        boolean
  onProtect:    (untilIso: string) => void
}

export function ProtectDialog({ open, onOpenChange, files, busy, onProtect }: ProtectDialogProps) {
  const [choice, setChoice]   = useState<string>('5')
  const [custom, setCustom]   = useState('')
  const [agreed, setAgreed]   = useState(false)
  useEffect(() => { if (open) { setChoice('5'); setCustom(''); setAgreed(false) } }, [open])

  const now = useMemo(() => new Date(), [open])                                   // eslint-disable-line react-hooks/exhaustive-deps
  // Protection can only be extended, so for ONE file a date at or before its current one is not
  // offered. For several files the server decides per file and reports any it had to refuse, so
  // one long-protected file does not stop the others from being protected.
  const latest = files.length === 1 && files[0].retainUntil ? new Date(files[0].retainUntil).getTime() : 0
  const earliest = new Date(now.getTime() + MIN_RETENTION_DAYS * DAY_MS)
  const latestAllowed = new Date(now.getTime() + (MAX_RETENTION_DAYS - 1) * DAY_MS)

  const presetDate = (y: number) => addYears(now, y)
  const presetOk = (y: number) => presetDate(y).getTime() > latest && presetDate(y) <= latestAllowed

  // Custom dates are whole days, taken as the end of that day (UTC).
  const customDate = custom ? new Date(`${custom}T23:59:59.000Z`) : null
  const customOk = !!customDate && customDate >= earliest && customDate <= latestAllowed && customDate.getTime() > latest

  const until = choice === CUSTOM ? (customOk ? customDate : null) : (presetOk(Number(choice)) ? presetDate(Number(choice)) : null)
  const plural = files.length === 1 ? `"${files[0]?.name ?? ''}"` : `${files.length} files`
  const anyProtected = files.some(f => f.retainUntil && new Date(f.retainUntil) > now)

  return (
    <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{anyProtected ? 'Extend protection?' : 'Protect from deletion?'}</DialogTitle>
          <DialogDescription>
            Until the date you choose, {plural} cannot be deleted by anyone: not you, and not TheoFlow. You can
            extend the date later but never shorten or remove it.
          </DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="Protect for" className="grid grid-cols-3 gap-2">
          {YEARS.map(y => (
            <button key={y} type="button" role="radio" aria-checked={choice === String(y)} disabled={!presetOk(y)}
              onClick={() => setChoice(String(y))}
              className={`rounded-xl border px-3 py-2 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                choice === String(y) ? 'border-black bg-gray-100 font-medium text-black' : 'border-black/[0.12] text-gray-700 hover:border-black/30'
              }`}>
              {y} {y === 1 ? 'year' : 'years'}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={choice === CUSTOM} onClick={() => setChoice(CUSTOM)}
            className={`rounded-xl border px-3 py-2 text-[13px] transition-colors ${
              choice === CUSTOM ? 'border-black bg-gray-100 font-medium text-black' : 'border-black/[0.12] text-gray-700 hover:border-black/30'
            }`}>
            Pick a date
          </button>
        </div>

        {choice === CUSTOM && (
          <label className="block text-[12px] font-medium text-gray-700">
            Protected until
            <input type="date" value={custom} onChange={e => setCustom(e.target.value)}
              min={isoDay(earliest)} max={isoDay(latestAllowed)}
              className="mt-1 w-full rounded-lg border border-black/[0.12] px-3 py-2 text-[13px] outline-none focus:border-black/40"/>
            <span className="mt-1 block font-normal text-gray-500">At most {MAX_RETENTION_YEARS} years from today.</span>
          </label>
        )}

        <p aria-live="polite" className="text-[13px] text-gray-700">
          {until ? <>Protected until <strong>{nice(until)}</strong>.</> : 'Choose how long to protect it.'}
        </p>

        <label className="flex items-start gap-2 text-[12px] text-gray-700">
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-black"/>
          I understand this cannot be undone before that date.
        </label>

        <DialogFooter className="gap-2 sm:gap-2">
          <button type="button" onClick={() => onOpenChange(false)} disabled={busy}
            className="rounded-full border border-black/[0.12] px-5 py-2 text-[13px] font-medium text-gray-700 transition-colors hover:border-black/30 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={() => until && onProtect(until.toISOString())} disabled={busy || !until || !agreed}
            className="rounded-full bg-black px-5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-gray-900 disabled:opacity-40">
            {busy ? 'Protecting…' : 'Protect'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
