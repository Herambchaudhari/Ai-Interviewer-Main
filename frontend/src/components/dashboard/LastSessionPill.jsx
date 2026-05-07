import { Clock } from 'lucide-react'
import { ROUND_LABELS, formatRelativeDays } from '../../lib/dashboardUtils'

export default function LastSessionPill({ reports = [] }) {
  if (reports.length === 0) return null

  const last = reports[0]
  const score = last.overall_score != null
    ? `${Number(last.overall_score).toFixed(1)}/10`
    : '—/10'
  const round = ROUND_LABELS[last.round_type] || last.round_type || 'Session'
  const when = formatRelativeDays(last.created_at)

  return (
    <div className="flex items-center gap-2 mt-3">
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-muted)',
        }}
      >
        <Clock size={11} style={{ flexShrink: 0 }} />
        <span>
          Last session:{' '}
          <span className="font-semibold" style={{ color: 'var(--color-text-2)' }}>
            {score}
          </span>
          {' · '}
          {round}
          {' · '}
          {when}
        </span>
      </div>
    </div>
  )
}
