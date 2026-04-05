/**
 * AnalyticsSection — performance stats, trend chart, round/difficulty breakdowns.
 * Props: { analytics }
 */
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, BarChart, Bar, Cell, Legend,
} from 'recharts'
import { TrendingUp, Award, Target, Percent, BarChart2 } from 'lucide-react'

const ROUND_COLORS = {
  technical:     '#7c3aed',
  hr:            '#ec4899',
  dsa:           '#06b6d4',
  system_design: '#f59e0b',
}
const ROUND_LABELS = {
  technical: 'Technical', hr: 'HR', dsa: 'DSA', system_design: 'System Design',
}
const DIFF_COLORS = { easy: '#4ade80', medium: '#f59e0b', hard: '#f87171' }

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, color }) {
  return (
    <div className="glass p-5 flex items-start gap-4">
      <div className="p-3 rounded-xl flex-shrink-0" style={{ background: `${color}20` }}>
        <Icon size={20} style={{ color }} />
      </div>
      <div>
        <p className="text-2xl font-bold" style={{ color }}>{value}</p>
        <p className="text-sm font-medium text-white/80 mt-0.5">{label}</p>
        {sub && <p className="text-xs text-muted mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass p-3 text-xs">
      <p className="text-muted mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {ROUND_LABELS[p.dataKey] || p.dataKey}: <strong>{p.value}</strong>
        </p>
      ))}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="glass p-12 text-center">
      <BarChart2 size={40} className="text-muted mx-auto mb-4" />
      <p className="text-lg font-semibold mb-2">No interview data yet</p>
      <p className="text-muted text-sm">Complete at least one interview to see your analytics here.</p>
    </div>
  )
}

export default function AnalyticsSection({ analytics }) {
  const {
    total_interviews = 0,
    average_score    = 0,
    best_round_type  = null,
    win_rate         = 0,
    score_trend      = [],
    by_round_type    = {},
    by_difficulty    = {},
  } = analytics

  if (!total_interviews) return <EmptyState />

  // Build line chart data — group by date, pivot by round_type
  const trendByDate = {}
  score_trend.forEach(({ date, score, round_type }) => {
    if (!trendByDate[date]) trendByDate[date] = { date }
    trendByDate[date][round_type] = score
  })
  const trendData = Object.values(trendByDate)

  // Round type bar data
  const roundData = Object.entries(by_round_type).map(([rt, v]) => ({
    name: ROUND_LABELS[rt] || rt,
    avg:  v.avg_score,
    count: v.count,
    color: ROUND_COLORS[rt] || '#7c3aed',
  }))

  // Difficulty bar data
  const diffData = Object.entries(by_difficulty).map(([d, v]) => ({
    name:  d.charAt(0).toUpperCase() + d.slice(1),
    avg:   v.avg_score,
    count: v.count,
    color: DIFF_COLORS[d] || '#7c3aed',
  }))

  const roundTypes = [...new Set(score_trend.map(d => d.round_type))]

  return (
    <div className="space-y-6 animate-fade-in-up">

      {/* ── Stat cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Interviews"
          value={total_interviews}
          sub="completed sessions"
          icon={TrendingUp}
          color="#7c3aed"
        />
        <StatCard
          label="Average Score"
          value={`${average_score}`}
          sub="out of 100"
          icon={Target}
          color="#06b6d4"
        />
        <StatCard
          label="Best Round"
          value={ROUND_LABELS[best_round_type] || best_round_type || '—'}
          sub="highest avg score"
          icon={Award}
          color="#10b981"
        />
        <StatCard
          label="Win Rate"
          value={`${Math.round(win_rate * 100)}%`}
          sub="sessions scored ≥ 70"
          icon={Percent}
          color="#f59e0b"
        />
      </div>

      {/* ── Score trend ───────────────────────────────────────────────────── */}
      {trendData.length > 0 && (
        <div className="glass p-6">
          <h3 className="text-sm font-semibold text-muted uppercase tracking-widest mb-5">
            Score Trend Over Time
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend formatter={v => ROUND_LABELS[v] || v}
                wrapperStyle={{ fontSize: '12px', color: 'var(--color-muted)' }} />
              {roundTypes.map(rt => (
                <Line
                  key={rt}
                  type="monotone"
                  dataKey={rt}
                  stroke={ROUND_COLORS[rt] || '#7c3aed'}
                  strokeWidth={2}
                  dot={{ r: 4, fill: ROUND_COLORS[rt] || '#7c3aed' }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Round type + Difficulty charts ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {roundData.length > 0 && (
          <div className="glass p-6">
            <h3 className="text-sm font-semibold text-muted uppercase tracking-widest mb-5">
              Avg Score by Round Type
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={roundData} layout="vertical"
                margin={{ top: 0, right: 20, bottom: 0, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" domain={[0, 100]}
                  tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={90}
                  tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
                <Tooltip
                  formatter={(v, n, p) => [`${v} (${p.payload.count} sessions)`, 'Avg Score']}
                  contentStyle={{ background: '#1e1b4b', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '8px' }}
                />
                <Bar dataKey="avg" radius={[0, 6, 6, 0]}>
                  {roundData.map(entry => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {diffData.length > 0 && (
          <div className="glass p-6">
            <h3 className="text-sm font-semibold text-muted uppercase tracking-widest mb-5">
              Avg Score by Difficulty
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={diffData} margin={{ top: 0, right: 20, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
                <Tooltip
                  formatter={(v, n, p) => [`${v} (${p.payload.count} sessions)`, 'Avg Score']}
                  contentStyle={{ background: '#1e1b4b', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '8px' }}
                />
                <Bar dataKey="avg" radius={[6, 6, 0, 0]}>
                  {diffData.map(entry => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}
