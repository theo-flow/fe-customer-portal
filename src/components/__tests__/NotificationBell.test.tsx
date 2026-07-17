import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

import NotificationBell from '../NotificationBell'

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response
}

const listPayload = {
  notifications: [
    {
      notificationId: 'n1', submissionId: 's1', group: 'claim', groupLabel: 'Motor Car Claim',
      message: 'New submission received for Motor Car Claim', status: 'DONE', read: false,
      createdAt: new Date().toISOString(),
    },
    {
      notificationId: 'n2', submissionId: 's2', group: 'claim', groupLabel: 'Motor Car Claim',
      message: 'New submission received for Motor Car Claim', status: 'ERROR', read: false,
      createdAt: new Date().toISOString(),
    },
  ],
  unreadCount: 2,
}

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    mockPush.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows no badge when there are no unread notifications', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ notifications: [], unreadCount: 0 }))
    render(<NotificationBell />)

    await screen.findByTitle('Notifications')
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('shows the unread badge count and lists notifications when opened', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(listPayload))
    render(<NotificationBell />)

    expect(await screen.findByText('2')).toBeInTheDocument()

    await userEvent.click(screen.getByTitle('Notifications'))

    expect(await screen.findByText('New submission received for Motor Car Claim')).toBeInTheDocument()
    // The ERROR-status item gets distinct copy so a failed notification isn't silently invisible.
    expect(screen.getByText('Notification failed for a new submission')).toBeInTheDocument()
  })

  it('marks a notification read and navigates to its submission on click', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(listPayload))
    render(<NotificationBell />)

    await screen.findByText('2')
    await userEvent.click(screen.getByTitle('Notifications'))

    const item = await screen.findByText('New submission received for Motor Car Claim')
    await userEvent.click(item)

    expect(mockPush).toHaveBeenCalledWith('/submissions/s1')
    expect(fetch).toHaveBeenCalledWith('/api/notifications/n1/read', { method: 'POST' })
  })
})
