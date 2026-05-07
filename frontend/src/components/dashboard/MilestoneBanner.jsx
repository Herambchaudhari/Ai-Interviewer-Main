import { Trophy, X } from 'lucide-react'

const MILESTONE_COPY = {
  5:   "You've completed 5 sessions — you're building a real habit!",
  10:  "10 sessions in. You're in the top tier of consistent practice.",
  25:  "25 sessions! Serious work. Most candidates never get here.",
  50:  "50 sessions. That's a level of dedication few candidates match.",
  100: "100 sessions. You are elite. The interviewers don't stand a chance.",
}

export default function MilestoneBanner({ milestone, onDismiss }) {
  if (!milestone) return null

  const copy = MILESTONE_COPY[milestone] ?? `You've reached ${milestone} sessions!`

  return (
    <div
      className="flex items-start justify-between gap-4 px-5 py-4 rounded-xl mb-6 animate-fade-in-up"
      style={{
        background: 'rgba(16,185,129,0.08)',
        border: '1px solid rgba(16,185,129,0.3)',
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="p-2 rounded-lg flex-shrink-0"
          style={{ background: 'rgba(16,185,129,0.15)' }}
        >
          <Trophy size={16} style={{ color: '#10b981' }} />
        </div>
        <div>
          <p className="text-sm font-bold" style={{ color: '#10b981' }}>
            Milestone unlocked — {milestone} sessions!
          </p>
          <p className="text-sm text-muted mt-0.5">{copy}</p>
        </div>
      </div>
      <button
        onClick={onDismiss}
        className="flex-shrink-0 p-1 rounded-lg transition-colors hover:bg-white/10"
        style={{ color: 'var(--color-muted)' }}
        aria-label="Dismiss milestone"
      >
        <X size={15} />
      </button>
    </div>
  )
}
