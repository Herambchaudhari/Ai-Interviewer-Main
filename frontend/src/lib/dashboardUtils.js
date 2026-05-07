// ── Shared constants ─────────────────────────────────────────────────────────

export const ROUND_LABELS = {
  technical:     'Technical',
  hr:            'HR / Behavioural',
  dsa:           'DSA / Coding',
  mcq_practice:  'MCQ Practice',
  system_design: 'Legacy System Design',
}

// ── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Returns "today" | "yesterday" | "N days ago"
 * Safe against null/undefined input.
 */
export function formatRelativeDays(isoString) {
  if (!isoString) return '—'
  const days = Math.floor((Date.now() - new Date(isoString)) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

// ── Streak ───────────────────────────────────────────────────────────────────

/**
 * Counts consecutive calendar days (user's local timezone) with at least
 * one session, walking backward from the most recent session.
 *
 * A streak is alive if the last session was today OR yesterday.
 * Multiple sessions on the same day count as a single streak day.
 */
export function computeStreak(reports) {
  if (!reports || reports.length === 0) return 0

  // Unique local calendar dates (en-CA gives YYYY-MM-DD reliably)
  const uniqueDays = [...new Set(
    reports.map(r => new Date(r.created_at).toLocaleDateString('en-CA'))
  )]
    .map(d => new Date(d))
    .sort((a, b) => b - a) // descending

  const today = new Date(new Date().toLocaleDateString('en-CA'))
  const mostRecentDiff = Math.round((today - uniqueDays[0]) / 86_400_000)

  // Streak is already broken if last session was more than 1 day ago
  if (mostRecentDiff > 1) return 0

  let streak = 0
  let cursor = uniqueDays[0] // start from most recent session day

  for (const day of uniqueDays) {
    const diff = Math.round((cursor - day) / 86_400_000)
    if (diff === 0) {
      streak += 1
      // Move cursor back one day
      cursor = new Date(day.getTime() - 86_400_000)
    } else {
      break // gap found — streak ends
    }
  }

  return streak
}

// ── Milestones ───────────────────────────────────────────────────────────────

export const MILESTONES = [5, 10, 25, 50, 100]

const MILESTONE_KEY = 'seen_milestones'

export function getSeenMilestones() {
  try {
    return JSON.parse(localStorage.getItem(MILESTONE_KEY) || '[]')
  } catch {
    return []
  }
}

export function markMilestoneSeen(n) {
  const seen = getSeenMilestones()
  if (!seen.includes(n)) {
    localStorage.setItem(MILESTONE_KEY, JSON.stringify([...seen, n]))
  }
}

/**
 * Returns the lowest unseen milestone the user has crossed, or null.
 * Shows milestones sequentially — catching up gracefully for existing users.
 */
export function getActiveMilestone(totalSessions, seenMilestones) {
  return MILESTONES.find(m => m <= totalSessions && !seenMilestones.includes(m)) ?? null
}

// ── Nudge variants ───────────────────────────────────────────────────────────

/**
 * Returns a nudge variant object describing what message to show the user.
 * Priority: zero_sessions → long_gap → low_score → high_score → default
 */
export function getNudgeVariant(reports) {
  if (!reports || reports.length === 0) {
    return { type: 'zero_sessions' }
  }

  const last = reports[0] // API returns newest-first
  const daysSinceLast = Math.floor((Date.now() - new Date(last.created_at)) / 86_400_000)

  if (daysSinceLast > 7) {
    return { type: 'long_gap', daysSinceLast }
  }

  if (last.overall_score != null && last.overall_score < 5) {
    return { type: 'low_score', score: last.overall_score }
  }

  if (last.overall_score != null && last.overall_score >= 8) {
    return { type: 'high_score', score: last.overall_score }
  }

  return { type: 'default' }
}
