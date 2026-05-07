import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MilestoneBanner from '../components/dashboard/MilestoneBanner'

describe('MilestoneBanner', () => {
  it('renders nothing when milestone is null', () => {
    const { container } = render(<MilestoneBanner milestone={null} onDismiss={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders milestone 5 copy', () => {
    render(<MilestoneBanner milestone={5} onDismiss={() => {}} />)
    // Match unique body phrase, not the title which also contains "5 sessions"
    expect(screen.getByText(/building a real habit/i)).toBeInTheDocument()
  })

  it('renders milestone 10 copy', () => {
    render(<MilestoneBanner milestone={10} onDismiss={() => {}} />)
    expect(screen.getByText(/top tier/i)).toBeInTheDocument()
  })

  it('renders milestone 100 copy', () => {
    render(<MilestoneBanner milestone={100} onDismiss={() => {}} />)
    expect(screen.getByText(/You are elite/i)).toBeInTheDocument()
  })

  it('calls onDismiss when X button is clicked', () => {
    const onDismiss = vi.fn()
    render(<MilestoneBanner milestone={5} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByLabelText('Dismiss milestone'))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('renders a fallback string for unknown milestones', () => {
    render(<MilestoneBanner milestone={999} onDismiss={() => {}} />)
    // Both title and body contain "999 sessions" — check at least one exists
    expect(screen.getAllByText(/999 sessions/i).length).toBeGreaterThanOrEqual(1)
  })
})
