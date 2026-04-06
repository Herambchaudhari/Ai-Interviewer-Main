/**
 * RadarChart.jsx — Dynamic radar chart that accepts any radar_scores object
 * from the backend (keys = skill names, values = 0-100).
 */
import {
  RadarChart as _RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from 'recharts'

const TARGET = 80

export default function RadarChartComponent({ radarScores = {} }) {
  const entries = Object.entries(radarScores)
  if (!entries.length) return (
    <div className="flex items-center justify-center h-40 text-sm" style={{ color: 'var(--color-muted)' }}>
      No radar data available
    </div>
  )

  const data = entries.map(([key, val]) => ({
    dimension: key,
    score:     Math.round(typeof val === 'number' ? val : 60),
    target:    TARGET,
  }))

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const you = payload.find(p => p.dataKey === 'score')
    const gap = you ? TARGET - you.value : null
    return (
      <div className="rounded-xl px-4 py-3 text-sm"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' }}>
        <p className="font-semibold mb-1" style={{ color: 'var(--color-text)' }}>{label}</p>
        <p style={{ color: 'var(--color-accent)' }}>Score: <strong>{you?.value}</strong>/100</p>
        {gap !== null && gap > 0 && (
          <p className="mt-1 text-xs" style={{ color: 'var(--color-error)' }}>Gap to target: -{gap} pts</p>
        )}
        {gap !== null && gap <= 0 && (
          <p className="mt-1 text-xs" style={{ color: 'var(--color-success)' }}>✓ Above target!</p>
        )}
      </div>
    )
  }

  return (
    <div className="w-full" style={{ minHeight: 300 }}>
      <ResponsiveContainer width="100%" height={320}>
        <_RadarChart data={data} margin={{ top: 10, right: 40, bottom: 10, left: 40 }}>
          <PolarGrid stroke="rgba(91,94,246,0.12)" gridType="polygon" />
          <PolarAngleAxis
            dataKey="dimension"
            tick={{ fill: 'var(--color-text-2)', fontSize: 11, fontWeight: 500 }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={{ fill: 'var(--color-muted-light)', fontSize: 10 }}
            tickCount={5}
          />
          {/* Target reference */}
          <Radar
            name="Target (80)"
            dataKey="target"
            stroke="rgba(100,116,139,0.4)"
            fill="rgba(100,116,139,0.05)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
          />
          {/* Candidate score */}
          <Radar
            name="Your Score"
            dataKey="score"
            stroke="#5b5ef6"
            fill="rgba(91,94,246,0.18)"
            strokeWidth={2.5}
            dot={{ fill: '#5b5ef6', r: 4, strokeWidth: 0 }}
            activeDot={{ r: 6, fill: '#818cf8', strokeWidth: 0 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            iconType="circle"
            iconSize={10}
            formatter={(value) => (
              <span style={{ color: value === 'Your Score' ? '#5b5ef6' : 'var(--color-muted)', fontSize: 12 }}>
                {value}
              </span>
            )}
          />
        </_RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
