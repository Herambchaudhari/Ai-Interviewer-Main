import { BarChart2, Calendar, Trophy } from 'lucide-react'

export default function MiniStatsRow({ reports = [] }) {
  const totalSessions = reports.length

  const thisWeek = reports.filter(r => {
    return (Date.now() - new Date(r.created_at)) <= 7 * 24 * 60 * 60 * 1000
  }).length

  const scored = reports.filter(r => r.overall_score != null)
  const bestScore = scored.length > 0
    ? Math.max(...scored.map(r => r.overall_score))
    : null

  const chips = [
    {
      icon: BarChart2,
      value: totalSessions,
      label: 'Total Sessions',
      color: '#7c3aed',
      bg: 'rgba(124,58,237,0.1)',
      border: 'rgba(124,58,237,0.25)',
    },
    {
      icon: Calendar,
      value: thisWeek,
      label: 'This Week',
      color: '#06b6d4',
      bg: 'rgba(6,182,212,0.1)',
      border: 'rgba(6,182,212,0.25)',
    },
    {
      icon: Trophy,
      value: bestScore != null ? `${Number(bestScore).toFixed(1)}/10` : '—',
      label: 'Best Score',
      color: '#f59e0b',
      bg: 'rgba(245,158,11,0.1)',
      border: 'rgba(245,158,11,0.25)',
    },
  ]

  return (
    <div className="flex flex-wrap gap-3 mt-4">
      {chips.map(({ icon: Icon, value, label, color, bg, border }) => (
        <div
          key={label}
          className="flex items-center gap-3 px-4 py-3 rounded-xl"
          style={{ background: bg, border: `1px solid ${border}` }}
        >
          <Icon size={16} style={{ color, flexShrink: 0 }} />
          <div>
            <p className="text-base font-bold leading-none" style={{ color }}>
              {value}
            </p>
            <p className="text-xs text-muted mt-0.5">{label}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
