/**
 * HireSignalRadar.jsx — 5-dimension hire-readiness spiderweb.
 * Supports both technical and HR round types via separate key maps.
 * Technical: Technical Depth, Communication, Problem Solving, Cultural Fit, Growth Potential
 * HR:        Leadership & Ownership, Communication, Emotional Maturity, Culture Fit, Growth Potential
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
      maxWidth: 220,
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

const TECH_KEY_MAP = {
  technical_depth:  'Technical Depth',
  communication:    'Communication',
  problem_solving:  'Problem Solving',
  cultural_fit:     'Cultural Fit',
  growth_potential: 'Growth Potential',
}

const HR_KEY_MAP = {
  leadership_potential: 'Leadership & Ownership',
  communication:        'Communication',
  emotional_maturity:   'Emotional Maturity',
  culture_fit:          'Culture Fit',
  growth_potential:     'Growth Potential',
}

const DIMENSION_ICONS = {
  'Technical Depth':        '⚙',
  'Communication':          '💬',
  'Problem Solving':        '🧩',
  'Cultural Fit':           '🤝',
  'Growth Potential':       '🚀',
  'Leadership & Ownership': '🎯',
  'Emotional Maturity':     '🧠',
}

export default function HireSignalRadar({ hireSignal = {}, roundType = 'technical' }) {
  if (!hireSignal || !Object.keys(hireSignal).length) return null

  const keyMap     = roundType === 'hr' ? HR_KEY_MAP : TECH_KEY_MAP
  const accent     = roundType === 'hr' ? '#ec4899' : '#f59e0b'
  const accentFill = roundType === 'hr' ? 'rgba(236,72,153,0.15)' : 'rgba(245,158,11,0.15)'

  const data = Object.entries(keyMap).map(([key, label]) => ({
    subject:   label,
    value:     hireSignal[key]?.score ?? 5,
    rationale: hireSignal[key]?.rationale || '',
    fullMark:  10,
  }))

  const avg      = Math.round(data.reduce((a, d) => a + d.value, 0) / data.length)
  const avgColor = avg >= 7 ? '#10b981' : avg >= 5 ? '#f59e0b' : '#ef4444'
  const avgLabel = avg >= 7 ? 'Strong candidate' : avg >= 5 ? 'Borderline — develop key areas' : 'Needs significant development'

  return (
    <div>
      {/* Score cards — one per dimension with rationale */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {data.map(d => {
          const c = d.value >= 7 ? '#10b981' : d.value >= 5 ? '#f59e0b' : '#ef4444'
          const barPct = Math.round(d.value / 10 * 100)
          return (
            <div key={d.subject} style={{
              padding: '10px 14px',
              borderRadius: 10,
              background: `${c}0d`,
              border: `1px solid ${c}28`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>
                  {DIMENSION_ICONS[d.subject]} {d.subject}
                </span>
                <span style={{ fontSize: 14, fontWeight: 700, color: c, flexShrink: 0 }}>{d.value}/10</span>
              </div>
              {/* Score bar */}
              <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 99, marginBottom: d.rationale ? 6 : 0 }}>
                <div style={{ height: 4, width: `${barPct}%`, background: c, borderRadius: 99, transition: 'width 0.6s ease' }} />
              </div>
              {d.rationale && (
                <p style={{ fontSize: 11, color: 'var(--color-muted)', lineHeight: 1.45, margin: 0 }}>
                  {d.rationale}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* Spider chart */}
      <ResponsiveContainer width="100%" height={230}>
        <RadarChart data={data} margin={{ top: 4, right: 32, bottom: 4, left: 32 }}>
          <PolarGrid stroke={`${accent}18`} gridType="polygon" />
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
            name="Signal"
            dataKey="value"
            stroke={accent}
            fill={accent}
            fillOpacity={0.18}
            strokeWidth={2.5}
            dot={{ fill: accent, r: 4, strokeWidth: 0 }}
            activeDot={{ r: 6, fill: accent, strokeWidth: 0 }}
          />
          <Tooltip content={<HireTooltip />} />
        </RadarChart>
      </ResponsiveContainer>

      <p style={{ fontSize: 11, textAlign: 'center', color: avgColor, fontWeight: 600, marginTop: 6 }}>
        Avg Signal: {avg}/10 — {avgLabel}
      </p>
    </div>
  )
}
