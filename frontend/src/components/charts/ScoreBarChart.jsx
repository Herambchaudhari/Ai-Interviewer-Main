/**
 * ScoreBarChart.jsx — Per-question score bar chart using Recharts.
 *
 * Props:
 *   perQuestionData  Array<{ question_id, question_text, score, verdict }>
 */
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'

const getColor = (score) => {
  if (score >= 8) return '#4ade80'   // green
  if (score >= 5) return '#facc15'   // yellow
  return '#f87171'                   // red
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div className="rounded-xl px-4 py-3 max-w-xs"
      style={{ background: '#1a1a2e', border: '1px solid rgba(139,92,246,0.3)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
      <p className="font-semibold text-sm mb-1" style={{ color: '#e2e8f0' }}>{label}</p>
      <p className="text-xs mb-2 leading-relaxed" style={{ color: '#94a3b8' }}>
        {(d?.question_text || '').slice(0, 100)}{d?.question_text?.length > 100 ? '…' : ''}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold" style={{ color: getColor(d?.score) }}>
          {d?.score ?? 0} / 10
        </span>
        {d?.verdict && (
          <span className="text-xs px-2 py-0.5 rounded"
            style={{ background: 'rgba(255,255,255,0.07)', color: '#94a3b8' }}>
            {d.verdict}
          </span>
        )}
      </div>
    </div>
  )
}

export default function ScoreBarChart({ perQuestionData = [] }) {
  const data = perQuestionData.map((q, i) => ({
    name:          `Q${i + 1}`,
    score:         q.score ?? 0,
    question_text: q.question_text || q.question || '',
    verdict:       q.verdict || '',
  }))

  const avg = data.length
    ? (data.reduce((s, d) => s + d.score, 0) / data.length).toFixed(1)
    : 0

  return (
    <div className="w-full" style={{ minHeight: 260 }}>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 0 }} barSize={36}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255,255,255,0.06)"
            vertical={false}
          />
          <XAxis
            dataKey="name"
            tick={{ fill: '#64748b', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, 10]}
            ticks={[0, 2, 4, 6, 8, 10]}
            tick={{ fill: '#64748b', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(139,92,246,0.06)' }} />
          <ReferenceLine
            y={parseFloat(avg)}
            stroke="rgba(139,92,246,0.5)"
            strokeDasharray="5 5"
            strokeWidth={1.5}
            label={{
              value: `Avg ${avg}`,
              position: 'right',
              fill: '#8b5cf6',
              fontSize: 11,
            }}
          />
          <Bar dataKey="score" radius={[6, 6, 0, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={getColor(entry.score)} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center justify-center gap-5 mt-2">
        {[['#4ade80', 'Strong (8-10)'], ['#facc15', 'Moderate (5-7)'], ['#f87171', 'Weak (0-4)']].map(([color, label]) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: color }} />
            <span className="text-xs" style={{ color: '#64748b' }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
