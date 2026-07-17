'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { NotificationStatus } from '@/lib/notifications'

const POLL_INTERVAL_MS = 30_000

interface Notification {
  notificationId: string
  submissionId:   string
  group:          string
  groupLabel:     string
  message:        string
  status:         NotificationStatus
  read:           boolean
  createdAt:      string
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins   = Math.round(diffMs / 60_000)
  if (mins < 1)   return 'Just now'
  if (mins < 60)  return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export default function NotificationBell() {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount]     = useState(0)
  const [open, setOpen]                   = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  function load() {
    fetch('/api/notifications')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return
        setNotifications(d.notifications ?? [])
        setUnreadCount(d.unreadCount ?? 0)
      })
      .catch(() => {})
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, POLL_INTERVAL_MS)

    function handleVisibility() {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  function openNotification(n: Notification) {
    setOpen(false)
    if (!n.read) {
      setNotifications(prev => prev.map(x => x.notificationId === n.notificationId ? { ...x, read: true } : x))
      setUnreadCount(prev => Math.max(0, prev - 1))
      fetch(`/api/notifications/${n.notificationId}/read`, { method: 'POST' }).catch(() => {})
    }
    router.push(`/submissions/${n.submissionId}`)
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(prev => !prev)}
        title="Notifications"
        className="relative w-8 h-8 rounded-full flex items-center justify-center
                   cursor-pointer hover:bg-gray-50 transition-colors flex-shrink-0">
        <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24"
             stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round"
                d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0
                   006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714
                   0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"/>
        </svg>
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full
                           bg-red-500 text-white text-[9px] font-semibold
                           flex items-center justify-center leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-80 max-w-[90vw] bg-white rounded-2xl shadow-lg
                        border border-black/[0.08] py-1 z-50 max-h-96 overflow-y-auto">
          <div className="px-4 py-2.5 border-b border-black/[0.06]">
            <p className="text-[13px] font-semibold text-black">Submissions</p>
          </div>
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-[13px] text-gray-400 text-center">No submissions yet</p>
          ) : (
            <div className="p-1">
              {notifications.map(n => (
                <button
                  key={n.notificationId}
                  onClick={() => openNotification(n)}
                  className="w-full text-left flex items-start gap-2.5 px-3 py-2.5 rounded-xl
                             hover:bg-gray-50 transition-colors">
                  <span
                    className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      n.status === 'ERROR' ? 'bg-red-500' : !n.read ? 'bg-blue-500' : 'bg-transparent'
                    }`}
                  />
                  <span className="min-w-0">
                    <p className={`text-[13px] leading-snug ${n.read ? 'text-gray-500' : 'text-black font-medium'}`}>
                      {n.status === 'ERROR' ? 'Notification failed for a new submission' : n.message}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{relativeTime(n.createdAt)}</p>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
