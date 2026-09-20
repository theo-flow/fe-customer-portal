'use client'
import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'

export interface RowMenuItem {
  label:    string
  onSelect: () => void
  icon?:    React.ReactNode
  danger?:  boolean
}

// The "..." action menu on a list row. Closes on outside click, Escape, or
// after an item is chosen.
export function RowMenu({ items, label }: { items: RowMenuItem[]; label: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
        <MoreHorizontal className="h-4 w-4"/>
      </button>
      {open && (
        <div role="menu"
          className="absolute right-0 top-9 z-30 w-48 rounded-xl border border-black/[0.08] bg-white p-1 shadow-lg">
          {items.map(item => (
            <button key={item.label} type="button" role="menuitem"
              onClick={() => { setOpen(false); item.onSelect() }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                item.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'
              }`}>
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
