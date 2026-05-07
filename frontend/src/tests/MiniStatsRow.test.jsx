import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import MiniStatsRow from '../components/dashboard/MiniStatsRow'

const daysAgoISO = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

describe('MiniStatsRow', () => {
  it('shows zeros and dash for empty reports', () => {
    render(<MiniStatsRow reports={[]} />)
    // Total Sessions and This Week both show 0
    const zeros = screen.getAllByText('0')
    expect(zeros.length).toBeGreaterThanOrEqual(2)
    // Best Score shows —
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('shows correct total session count', () => {
    const reports = [
      { created_at: daysAgoISO(10), overall_score: 7 },
      { created_at: daysAgoISO(15), overall_score: 8 },
      { created_at: daysAgoISO(20), overall_score: 6 },
    ]
    render(<MiniStatsRow reports={reports} />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('counts only sessions within last 7 days for This Week', () => {
    const reports = [
      { created_at: daysAgoISO(1), overall_score: 7 },
      { created_at: daysAgoISO(3), overall_score: 6 },
      { created_at: daysAgoISO(10), overall_score: 8 }, // outside 7d
    ]
    render(<MiniStatsRow reports={reports} />)
    expect(screen.getByText('2')).toBeInTheDocument() // This Week = 2
  })

  it('shows best score formatted to 1 decimal', () => {
    const reports = [
      { created_at: daysAgoISO(1), overall_score: 7.5 },
      { created_at: daysAgoISO(2), overall_score: 9.2 },
      { created_at: daysAgoISO(3), overall_score: 6.0 },
    ]
    render(<MiniStatsRow reports={reports} />)
    expect(screen.getByText('9.2/10')).toBeInTheDocument()
  })

  it('shows — for best score when all scores are null', () => {
    const reports = [
      { created_at: daysAgoISO(1), overall_score: null },
      { created_at: daysAgoISO(2), overall_score: null },
    ]
    render(<MiniStatsRow reports={reports} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('uses only scored reports for best score calculation', () => {
    const reports = [
      { created_at: daysAgoISO(1), overall_score: null },
      { created_at: daysAgoISO(2), overall_score: 8.5 },
    ]
    render(<MiniStatsRow reports={reports} />)
    expect(screen.getByText('8.5/10')).toBeInTheDocument()
  })
})
