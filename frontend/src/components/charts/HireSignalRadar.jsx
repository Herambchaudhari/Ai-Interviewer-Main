/**
 * HireSignalRadar.jsx — 5-dimension hire-readiness spiderweb.
 * Dimensions: Technical Depth, Communication, Problem Solving, Cultural Fit, Growth Potential.
 * Uses amber/gold color scheme to visually distinguish from the blue skills radar.
 */
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, ResponsiveContainer, Tooltip,
} from 'recharts'

function HireTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value ?? 0
  const rationale = payload[0]?.payload?.rationale || ''
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid rgba(245,158,11,0.3)',
      borderRadius: 12,
      padding: '10px 14px',
      fontSize: 12,
      maxWidth: 200,
    }}>
      <p style={{ fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>{label}</p>
      <p style={{ color: '#f59e0b', fontWeight: 600 }}>Score: {val}/10</p>
      {rationale && (
        <p style={{ color: 'var(--color-muted)', fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>
          {rationale}
        </p>
      )}
    </div>
  )
}

const DIMENSION_ICONS = {
  'Technical Depth':   '🔧',
  'Communication':     '💬',
  'Problem Solving':   '🧩',
  'Cultural Fit':      '🤝',
  'Growth Potential':  '🚀',
}

export default function HireSignalRadar({ hireSignal = {} }) {
  if (!hireSignal || !Object.keys(hireSignal).length) return null

  const keyMap = {
    technical_depth:  'Technical Depth',
    communication:    'Communication',
    problem_solving:  'Problem Solving',
    cultural_fit:     'Cultural Fit',
    growth_potential: 'Growth Potential',
  }

  const data = Object.entries(keyMap).map(([key, label]) => ({
    subject:   label,
    value:     (hireSignal[key]?.score ?? 5),
    rationale: hireSignal[key]?.rationale || '',
    fullMark:  10,
  }))

  // Average hire signal score
  const avg = Math.round(data.reduce((a, d) => a + d.value, 0) / data.length)
  const avgColor = avg >= 7 ? '#10b981' : avg >= 5 ? '#f59e0b' : '#ef4444'

  return (
    <div>
      {/* Dimension score pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {data.map(d => {
          const c = d.value >= 7 ? '#10b981' : d.value >= 5 ? '#f59e0b' : '#ef4444'
          return (
            <span key={d.subject} style={{
              fontSize: 11, fontWeight: 600,
              padding: '2px 8px', borderRadius: 20,
              background: `${c}15`, color: c,
              border: `1px solid ${c}35`,
            }}>
              {DIMENSION_ICONS[d.subject]} {d.subject}: {d.value}/10
            </span>
          )
        })}
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <RadarChart data={data} margin={{ top: 0, right: 30, bottom: 0, left: 30 }}>
          <PolarGrid stroke="rgba(245,158,11,0.12)" gridType="polygon" />
          <PolarAngleAxis
            dataKey="subject"
            tick={{ fill: 'var(--color-text-2)', fontSize: 10, fontWeight: 500 }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 10]}
            tick={{ fill: 'var(--color-muted-light)', fontSize: 9 }}
            tickCount={4}
          />
          <Radar
            name="Hire Signal"
            dataKey="value"
            stroke="#f59e0b"
            fill="rgba(245,158,11,0.18)"
            strokeWidth={2.5}
            dot={{ fill: '#f59e0b', r: 4, strokeWidth: 0 }}
            activeDot={{ r: 6, fill: '#fbbf24', strokeWidth: 0 }}
          />
          <Tooltip content={<HireTooltip />} />
        </RadarChart>
      </ResponsiveContainer>

      <p style={{ fontSize: 11, textAlign: 'center', color: avgColor, fontWeight: 600, marginTop: 4 }}>
        Avg Hire Signal: {avg}/10 — {avg >= 7 ? '🟢 Strong candidate' : avg >= 5 ? '🟡 Borderline' : '🔴 Not ready'}
      </p>
    </div>
  )
}
