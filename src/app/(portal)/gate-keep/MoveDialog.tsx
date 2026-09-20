'use client'
import { useEffect, useState } from 'react'
import { Folder } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { flattenTree } from '@/lib/gate-keep-view'
import type { TreeNode } from './api'

interface MoveDialogProps {
  open:            boolean
  onOpenChange:    (open: boolean) => void
  title:           string
  tree:            TreeNode[]
  // A folder being moved can't go into itself or anything under it.
  excludeFolderId?: string
  currentParentId: string
  busy?:           boolean
  onMove:          (targetId: string) => void
}

export function MoveDialog({ open, onOpenChange, title, tree, excludeFolderId, currentParentId, busy, onMove }: MoveDialogProps) {
  const [target, setTarget] = useState(currentParentId)
  useEffect(() => { if (open) setTarget(currentParentId) }, [open, currentParentId])

  const rows = flattenTree(tree, excludeFolderId)
  const choices = [{ id: 'root', name: 'Home (top level)', depth: 0 }, ...rows]

  return (
    <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Choose where it should go.</DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="Destination folder"
          className="max-h-72 overflow-y-auto rounded-xl border border-black/[0.08] p-1">
          {choices.map(c => (
            <button key={c.id} type="button" role="radio" aria-checked={target === c.id}
              onClick={() => setTarget(c.id)}
              style={{ paddingLeft: 12 + c.depth * 18 }}
              className={`flex w-full items-center gap-2 rounded-lg py-2 pr-3 text-left text-[13px] transition-colors ${
                target === c.id ? 'bg-gray-100 font-medium text-black' : 'text-gray-700 hover:bg-gray-50'
              }`}>
              <Folder className="h-4 w-4 flex-shrink-0 text-gray-400"/>
              <span className="truncate">{c.name}</span>
            </button>
          ))}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <button type="button" onClick={() => onOpenChange(false)} disabled={busy}
            className="rounded-full border border-black/[0.12] px-5 py-2 text-[13px] font-medium text-gray-700
                       transition-colors hover:border-black/30 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={() => onMove(target)} disabled={busy || target === currentParentId}
            className="rounded-full bg-black px-5 py-2 text-[13px] font-medium text-white
                       transition-colors hover:bg-gray-900 disabled:opacity-50">
            {busy ? 'Moving…' : 'Move here'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
