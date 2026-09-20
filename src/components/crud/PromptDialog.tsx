'use client'
import { useEffect, useState } from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

interface PromptDialogProps {
  open:          boolean
  onOpenChange:  (open: boolean) => void
  title:         string
  description?:  string
  label:         string
  initialValue:  string
  submitLabel:   string
  busy?:         boolean
  onSubmit:      (value: string) => void
}

// A one-field text prompt (rename). Submit is disabled until the value is
// non-blank and actually different from where it started.
export function PromptDialog({
  open, onOpenChange, title, description, label, initialValue, submitLabel, busy, onSubmit,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue)

  // Reset every time the dialog is opened for a (possibly different) item.
  useEffect(() => { if (open) setValue(initialValue) }, [open, initialValue])

  const trimmed  = value.trim()
  const canSubmit = trimmed.length > 0 && trimmed !== initialValue && !busy

  return (
    <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next) }}>
      <DialogContent className="max-w-md">
        <form onSubmit={e => { e.preventDefault(); if (canSubmit) onSubmit(trimmed) }} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className={description ? undefined : 'sr-only'}>
              {description ?? title}
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-gray-400">
            {label}
            <input
              autoFocus
              value={value}
              onChange={e => setValue(e.target.value)}
              maxLength={200}
              className="rounded-xl border border-black/[0.14] bg-white px-4 py-3 text-[14px] font-normal normal-case tracking-normal text-black
                         outline-none transition-colors focus:border-black focus:ring-2 focus:ring-black/10"
            />
          </label>
          <DialogFooter className="gap-2 sm:gap-2">
            <button type="button" onClick={() => onOpenChange(false)} disabled={busy}
              className="rounded-full border border-black/[0.12] px-5 py-2 text-[13px] font-medium text-gray-700
                         transition-colors hover:border-black/30 disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={!canSubmit}
              className="rounded-full bg-black px-5 py-2 text-[13px] font-medium text-white
                         transition-colors hover:bg-gray-900 disabled:opacity-50">
              {busy ? 'Saving…' : submitLabel}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
