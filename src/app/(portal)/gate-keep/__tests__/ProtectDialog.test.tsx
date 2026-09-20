import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProtectDialog } from '../ProtectDialog'

const DAY = 86_400_000
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString()
const onProtect = vi.fn()

const show = (files: { id: string; name: string; retainUntil?: string | null }[]) =>
  render(<ProtectDialog open onOpenChange={() => {}} files={files} onProtect={onProtect}/>)

describe('ProtectDialog', () => {
  beforeEach(() => { onProtect.mockReset() })

  it('offers 1, 3, 5, 7 and 10 years, and the ten-year one is genuinely available', () => {
    show([{ id: 'f', name: 'a.pdf' }])
    for (const y of ['1 year', '3 years', '5 years', '7 years', '10 years']) {
      expect(screen.getByRole('radio', { name: y })).toBeEnabled()
    }
  })

  it('states exactly what will happen, and that it cannot be undone', () => {
    show([{ id: 'f', name: 'a.pdf' }])
    expect(screen.getByText(/"a\.pdf" cannot be deleted by anyone: not you, and not TheoFlow/)).toBeInTheDocument()
    expect(screen.getByText(/extend the date later but never shorten or remove it/)).toBeInTheDocument()
  })

  it('shows the resulting date, and sends it only once confirmed', async () => {
    const user = userEvent.setup()
    show([{ id: 'f', name: 'a.pdf' }])
    await user.click(screen.getByRole('radio', { name: '3 years' }))
    expect(screen.getByText(/Protected until/)).toBeInTheDocument()

    const go = screen.getByRole('button', { name: 'Protect' })
    expect(go).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    await user.click(go)

    expect(onProtect).toHaveBeenCalledTimes(1)
    const years = (new Date(onProtect.mock.calls[0][0]).getTime() - Date.now()) / (365.25 * DAY)
    expect(years).toBeGreaterThan(2.9)
    expect(years).toBeLessThan(3.1)
  })

  it('does not offer a date that would shorten existing protection', () => {
    show([{ id: 'f', name: 'a.pdf', retainUntil: inDays(4 * 365) }])
    expect(screen.getByText('Extend protection?')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '1 year' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: '3 years' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: '5 years' })).toBeEnabled()
  })

  it('for several files it does not second-guess: the server refuses per file and reports it', () => {
    show([{ id: 'a', name: 'a' }, { id: 'b', name: 'b', retainUntil: inDays(6 * 365) }])
    expect(screen.getByText(/2 files cannot be deleted by anyone/)).toBeInTheDocument()
    for (const y of ['1 year', '3 years', '5 years', '7 years', '10 years']) {
      expect(screen.getByRole('radio', { name: y })).toBeEnabled()
    }
  })

  it('an already-expired protection is treated as none', () => {
    show([{ id: 'f', name: 'a.pdf', retainUntil: inDays(-30) }])
    expect(screen.getByText('Protect from deletion?')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '1 year' })).toBeEnabled()
  })

  it('a custom date must be at least a day away and at most ten years away', async () => {
    const user = userEvent.setup()
    show([{ id: 'f', name: 'a.pdf' }])
    await user.click(screen.getByRole('radio', { name: 'Pick a date' }))
    await user.click(screen.getByRole('checkbox'))
    const go = screen.getByRole('button', { name: 'Protect' })
    const input = screen.getByLabelText(/Protected until/) as HTMLInputElement
    expect(go).toBeDisabled()                                            // no date chosen yet

    const setDate = async (d: string) => { await user.clear(input); await user.type(input, d) }
    await setDate(new Date(Date.now() - 5 * DAY).toISOString().slice(0, 10))
    expect(go).toBeDisabled()                                            // in the past
    await setDate(new Date(Date.now() + 4000 * DAY).toISOString().slice(0, 10))
    expect(go).toBeDisabled()                                            // beyond ten years
    await setDate(new Date(Date.now() + 400 * DAY).toISOString().slice(0, 10))
    expect(go).toBeEnabled()
    await user.click(go)
    expect(onProtect).toHaveBeenCalledTimes(1)
    expect(within(screen.getByRole('dialog')).getByText(/At most 10 years from today/)).toBeInTheDocument()
  })
})
