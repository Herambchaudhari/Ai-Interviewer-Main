import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  formatRelativeDays,
  computeStreak,
  getActiveMilestone,
  getNudgeVariant,
} from '../lib/dashboardUtils'

// ── formatRelativeDays ────────────────────────────────────────────────────────
describe('formatRelativeDays', () => {
  it('returns "today" for an ISO string from the current moment', () => {
    expect(formatRelativeDays(new Date().toISOString())).toBe('today')
  })

  it('returns "yesterday" for ~24h ago', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeDays(yesterday)).toBe('yesterday')
  })

  it('returns "N days ago" for older dates', () => {
    const ago = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeDays(ago)).toBe('5 days ago')
  })

  it('returns "—" for null input', () => {
    expect(formatRelativeDays(null)).toBe('—')
  })

  it('returns "—" for undefined input', () => {
    expect(formatRelativeDays(undefined)).toBe('—')
  })
})

// ── computeStreak ─────────────────────────────────────────────────────────────
describe('computeStreak', () => {
  const daysAgo = (n) => {
    const d = new Date()
    d.setDate(d.getDate() - n)
    d.setHours(10, 0, 0, 0)
    return d.toISOString()
  }

  it('returns 0 for empty reports', () => {
    expect(computeStreak([])).toBe(0)
  })

  it('returns 0 for null/undefined', () => {
    expect(computeStreak(null)).toBe(0)
    expect(computeStreak(undefined)).toBe(0)
  })

  it('returns 1 for a single session today', () => {
    expect(computeStreak([{ created_at: daysAgo(0) }])).toBe(1)
  })

  it('returns 1 for a single session yesterday', () => {
    expect(computeStreak([{ created_at: daysAgo(1) }])).toBe(1)
  })

  it('returns 0 when last session was 2+ days ago', () => {
    expect(computeStreak([{ created_at: daysAgo(2) }])).toBe(0)
  })

  it('counts consecutive days backward from most recent session', () => {
    const reports = [
      { created_at: daysAgo(0) },
      { created_at: daysAgo(1) },
      { created_at: daysAgo(2) },
    ]
    expect(computeStreak(reports)).toBe(3)
  })

  it('stops at a gap', () => {
    const reports = [
      { created_at: daysAgo(0) },
      { created_at: daysAgo(1) },
      // day 2 missing — streak breaks
      { created_at: daysAgo(3) },
    ]
    expect(computeStreak(reports)).toBe(2)
  })

  it('deduplicates multiple sessions on the same day', () => {
    const reports = [
      { created_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString() }, // today, 1h ago
      { created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() }, // today, 3h ago
      { created_at: daysAgo(1) },
    ]
    expect(computeStreak(reports)).toBe(2) // today + yesterday = 2 unique days
  })

  it('returns 1 when consecutive days start from yesterday (none today)', () => {
    const reports = [
      { created_at: daysAgo(1) },
      { created_at: daysAgo(2) },
      { created_at: daysAgo(3) },
    ]
    expect(computeStreak(reports)).toBe(3)
  })
})

// ── getActiveMilestone ────────────────────────────────────────────────────────
describe('getActiveMilestone', () => {
  it('returns null for 0 sessions', () => {
    expect(getActiveMilestone(0, [])).toBeNull()
  })

  it('returns null below first threshold', () => {
    expect(getActiveMilestone(4, [])).toBeNull()
  })

  it('returns 5 when exactly 5 sessions, none seen', () => {
    expect(getActiveMilestone(5, [])).toBe(5)
  })

  it('returns null when milestone 5 already seen', () => {
    expect(getActiveMilestone(5, [5])).toBeNull()
  })

  it('returns 10 when 12 sessions and 5 already seen', () => {
    expect(getActiveMilestone(12, [5])).toBe(10)
  })

  it('returns null when all milestones up to count are seen', () => {
    expect(getActiveMilestone(12, [5, 10])).toBeNull()
  })

  it('returns lowest unseen milestone (5) when 100 sessions, none seen', () => {
    expect(getActiveMilestone(100, [])).toBe(5)
  })

  it('returns null when all milestones seen', () => {
    expect(getActiveMilestone(100, [5, 10, 25, 50, 100])).toBeNull()
  })
})

// ── getNudgeVariant ───────────────────────────────────────────────────────────
describe('getNudgeVariant', () => {
  const reportDaysAgo = (n, score = 7) => ({
    created_at: new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString(),
    overall_score: score,
  })

  it('returns zero_sessions for empty reports', () => {
    expect(getNudgeVariant([])).toEqual({ type: 'zero_sessions' })
  })

  it('returns zero_sessions for null', () => {
    expect(getNudgeVariant(null)).toEqual({ type: 'zero_sessions' })
  })

  it('returns long_gap when last session > 7 days ago', () => {
    const result = getNudgeVariant([reportDaysAgo(10)])
    expect(result.type).toBe('long_gap')
    expect(result.daysSinceLast).toBe(10)
  })

  it('returns low_score when last score < 5', () => {
    expect(getNudgeVariant([reportDaysAgo(0, 3)])).toMatchObject({ type: 'low_score', score: 3 })
  })

  it('returns high_score when last score >= 8', () => {
    expect(getNudgeVariant([reportDaysAgo(0, 9)])).toMatchObject({ type: 'high_score', score: 9 })
  })

  it('returns default for score between 5–7.9', () => {
    expect(getNudgeVariant([reportDaysAgo(0, 6)])).toEqual({ type: 'default' })
  })

  it('returns default when score is null', () => {
    expect(getNudgeVariant([{ created_at: new Date().toISOString(), overall_score: null }])).toEqual({ type: 'default' })
  })

  it('long_gap takes priority over high_score (8 days ago, score 9)', () => {
    expect(getNudgeVariant([reportDaysAgo(8, 9)])).toMatchObject({ type: 'long_gap' })
  })

  it('7-days-ago is NOT long_gap (boundary: must be > 7)', () => {
    expect(getNudgeVariant([reportDaysAgo(7, 5)])).toEqual({ type: 'default' })
  })
})
