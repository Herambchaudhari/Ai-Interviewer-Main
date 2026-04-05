/**
 * AreaTimeline.jsx — Score progression across interview questions.
 * Shows whether the candidate improved (warmed up) or declined over time.
 */
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'

function TimelineTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload || {}
  const col = d.score >= 70 ? '#10b981' : d.score >= 50 ? '#f59e0b' : '#ef4444'
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 12,
      padding: '10px 14px',
      fontSize: 12,
      maxWidth: 220,
    }}>
      <p style={{ fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>{d.name}</p>
      {d.category && (
        <p style={{ color: 'var(--color-muted)', marginBottom: 2, fontSize: 11 }}>{d.category}</p>
      )}
      <p style={{ color: col, fontWeight: 600 }}>Score: {d.score}/100</p>
      {d.verdict && (
        <p style={{ color: 'var(--color-muted)', fontSize: 11, marginTop: 2 }}>{d.verdict}</p>
      )}
    </div>
  )
}

export default function AreaTimeline({ perQuestionAnalysis = [] }) {
  if (!perQuestionAnalysis.length) return null

  const data = perQuestionAnalysis.map((q, i) => ({
    name:     `Q${i + 1}`,
    score:    Math.round((q.score ?? 0) * 10),   // 0-10 → 0-100
    category: q.category || '',
    verdict:  q.verdict || '',
  }))

  // Detect trend: compare first-half avg vs second-half avg
  const mid       = Math.floor(data.length / 2)
  const firstAvg  = data.slice(0, mid || 1).reduce((a, d) => a + d.score, 0) / (mid || 1)
  const secondAvg = data.slice(mid).reduce((a, d) => a + d.score, 0) / (data.length - mid || 1)
  const improving = secondAvg >= firstAvg
  const lineColor = improving ? '#10b981' : '#f97316'
  const fillId    = improving ? 'greenFill' : 'orangeFill'

  return (
    <div>
      <p style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        {improving
          ? <span>📈 <strong style={{ color: '#10b981' }}>Warming up</strong> — you got stronger as the interview progressed</span>
          : <span>📉 <strong style={{ color: '#f97316' }}>Fatigue detected</strong> — performance declined toward the end</span>
        }
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="greenFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#10b981" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0}   />
            </linearGradient>
            <linearGradient id="orangeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#f97316" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#f97316" stopOpacity={0}   />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: 'var(--color-muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fill: 'var(--color-muted)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <ReferenceLine
            y={70}
            stroke="rgba(16,185,129,0.25)"
            strokeDasharray="4 4"
            label={{ value: 'Pass', fill: '#6b7280', fontSize: 10, position: 'right' }}
          />
          <Tooltip content={<TimelineTooltip />} cursor={{ stroke: lineColor, strokeWidth: 1, strokeDasharray: '4 4' }} />
          <Area
            type="monotone"
            dataKey="score"
            stroke={lineColor}
            strokeWidth={2.5}
            fill={`url(#${fillId})`}
            dot={{ r: 4, fill: lineColor, strokeWidth: 0 }}
            activeDot={{ r: 6, fill: lineColor, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
