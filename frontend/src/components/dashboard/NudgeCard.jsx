import { Rocket, Clock, RefreshCcw, TrendingUp, Zap } from 'lucide-react'
import { getNudgeVariant } from '../../lib/dashboardUtils'

const VARIANT_CONFIG = {
  zero_sessions: {
    icon: Rocket,
    color: '#7c3aed',
    bg: 'rgba(124,58,237,0.08)',
    border: 'rgba(124,58,237,0.25)',
    title: 'Ready to begin?',
    body: 'Start your first practice session and take the first step toward your dream job.',
    cta: 'Start First Session',
  },
  long_gap: {
    icon: Clock,
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.25)',
    title: null, // built dynamically
    body: "Consistency beats intensity. Even a quick 10-minute session keeps your edge sharp.",
    cta: 'Get Back on Track',
  },
  low_score: {
    icon: RefreshCcw,
    color: '#ef4444',
    bg: 'rgba(239,68,68,0.08)',
    border: 'rgba(239,68,68,0.25)',
    title: 'Tough one last time.',
    body: "Every expert was once a beginner. Struggle is part of the process — try again and watch yourself improve.",
    cta: 'Try Again',
  },
  high_score: {
    icon: TrendingUp,
    color: '#10b981',
    bg: 'rgba(16,185,129,0.08)',
    border: 'rgba(16,185,129,0.25)',
    title: null, // built dynamically
    body: "You're in the zone. This is exactly when consistent practice locks in real mastery.",
    cta: 'Keep the Momentum',
  },
  default: {
    icon: Zap,
    color: '#7c3aed',
    bg: 'rgba(124,58,237,0.08)',
    border: 'rgba(124,58,237,0.25)',
    title: 'Ready for your next session?',
    body: "Consistency is what separates great candidates from average ones. One more session today?",
    cta: 'Start a Session',
  },
}

export default function NudgeCard({ reports = [], onStartSession }) {
  const variant = getNudgeVariant(reports)
  const cfg = VARIANT_CONFIG[variant.type]
  const Icon = cfg.icon

  // Dynamic titles
  let title = cfg.title
  if (variant.type === 'long_gap') {
    title = `Miss you! It's been ${variant.daysSinceLast} day${variant.daysSinceLast !== 1 ? 's' : ''} since your last session.`
  } else if (variant.type === 'high_score') {
    title = `You're on a roll! Last score: ${Number(variant.score).toFixed(1)}/10`
  }

  return (
    <div
      className="flex items-start justify-between gap-4 px-5 py-4 rounded-xl mb-6 animate-fade-in-up"
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderLeft: `3px solid ${cfg.color}`,
      }}
    >
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div
          className="p-2 rounded-lg flex-shrink-0 mt-0.5"
          style={{ background: `${cfg.color}20` }}
        >
          <Icon size={15} style={{ color: cfg.color }} />
        </div>
        <div className="min-w-0">
          {title && (
            <p className="text-sm font-semibold mb-0.5" style={{ color: cfg.color }}>
              {title}
            </p>
          )}
          <p className="text-sm text-muted leading-relaxed">{cfg.body}</p>
        </div>
      </div>
      {onStartSession && (
        <button
          onClick={onStartSession}
          className="flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:opacity-90 whitespace-nowrap self-center"
          style={{ background: cfg.color, color: '#fff' }}
        >
          {cfg.cta}
        </button>
      )}
    </div>
  )
}
