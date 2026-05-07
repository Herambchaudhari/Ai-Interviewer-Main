import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import WelcomeGreeting from '../components/dashboard/WelcomeGreeting'

function setHour(hour) {
  const date = new Date()
  date.setHours(hour, 0, 0, 0)
  vi.setSystemTime(date)
}

describe('WelcomeGreeting', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('shows "Good morning" between 5–11', () => {
    setHour(8)
    render(<WelcomeGreeting name="Alice" today="Wednesday, 7 May 2025" />)
    expect(screen.getByText(/Good morning/)).toBeInTheDocument()
  })

  it('shows "Good afternoon" between 12–16', () => {
    setHour(14)
    render(<WelcomeGreeting name="Alice" today="Wednesday, 7 May 2025" />)
    expect(screen.getByText(/Good afternoon/)).toBeInTheDocument()
  })

  it('shows "Good evening" between 17–20', () => {
    setHour(19)
    render(<WelcomeGreeting name="Alice" today="Wednesday, 7 May 2025" />)
    expect(screen.getByText(/Good evening/)).toBeInTheDocument()
  })

  it('shows "Good evening" for midnight-hour (2am)', () => {
    setHour(2)
    render(<WelcomeGreeting name="Alice" today="Wednesday, 7 May 2025" />)
    expect(screen.getByText(/Good evening/)).toBeInTheDocument()
  })

  it('renders the name in the heading', () => {
    setHour(9)
    render(<WelcomeGreeting name="Heramb" today="Wednesday, 7 May 2025" />)
    expect(screen.getByText('Heramb')).toBeInTheDocument()
  })

  it('falls back to "there" when name is undefined', () => {
    setHour(9)
    render(<WelcomeGreeting today="Wednesday, 7 May 2025" />)
    expect(screen.getByText('there')).toBeInTheDocument()
  })

  it('renders the today date string', () => {
    setHour(9)
    render(<WelcomeGreeting name="Alice" today="Wednesday, 7 May 2025" />)
    expect(screen.getByText('Wednesday, 7 May 2025')).toBeInTheDocument()
  })
})
