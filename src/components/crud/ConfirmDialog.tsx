'use client'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

interface ConfirmDialogProps {
  open:          boolean
  onOpenChange:  (open: boolean) => void
  title:         string
  description:   string
  confirmLabel:  string
  // Red confirm button for irreversible actions (permanent delete).
  destructive?:  boolean
  busy?:         boolean
  onConfirm:     () => void
}

// Explicit classes rather than ui/button variants: the theme's --primary is
// green, which would clash with the portal's black/white pills.
export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel, destructive, busy, onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <button type="button" onClick={() => onOpenChange(false)} disabled={busy}
            className="rounded-full border border-black/[0.12] px-5 py-2 text-[13px] font-medium text-gray-700
                       transition-colors hover:border-black/30 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
            className={`rounded-full px-5 py-2 text-[13px] font-medium text-white transition-colors disabled:opacity-50 ${
              destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-black hover:bg-gray-900'
            }`}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
