/**
 * ProgressSection — skill velocity, timeline, persistent gaps, strongest skills.
 * Props: { userId }
 *
 * Fetches from GET /api/v1/progress/:userId and renders four sub-sections:
 *   1. Progress Timeline   — line chart of overall scores over time
 *   2. Skill Velocity Grid — rate-of-change per skill with direction badge
 *   3. Persistent Gaps     — recurring weak areas with severity + trend
 *   4. Strongest Skills    — consistently high-scoring skills as badges
 */
import { useState, useEffect } from 'react'
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle,
  Star, Loader2, Activity, BarChart2,
} from 'lucide-react'
import { getUserProgress } from '../../lib/api'

// ── Colour palette ─────────────────────────────────────────────────────────────
const ROUND_COLORS = {
  technical:     '#7c3aed',
  hr:            '#ec4899',
  dsa:           '#06b6d4',
  mcq_practice: '#f59e0b',
  system_design: '#94a3b8',
}
const SEVERITY_COLORS = {
  critical: { bg: 'rgba(248,113,113,0.12)', text: '#f87171', border: 'rgba(248,113,113,0.3)' },
  high:     { bg: 'rgba(251,191,36,0.12)',  text: '#fbbf24', border: 'rgba(251,191,36,0.3)' },
  medium:   { bg: 'rgba(148,163,184,0.12)', text: '#94a3b8', border: 'rgba(148,163,184,0.3)' },
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function directionIcon(dir) {
  if (dir === 'up')   return <TrendingUp  size={14} style={{ color: '#4ade80' }} />
  if (dir === 'down') return <TrendingDown size={14} style={{ color: '#f87171' }} />
  return <Minus size={14} style={{ color: '#94a3b8' }} />
}

function velocityColor(v) {
  if (v >= 2)    return '#4ade80'
  if (v >= 0.5)  return '#86efac'
  if (v <= -2)   return '#f87171'
  if (v <= -0.5) return '#fca5a5'
  return '#94a3b8'
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short',
  })
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ProgressTimeline({ timeline }) {
  if (!timeline?.length) return null

  const data = timeline.map(t => ({
    date:  formatDate(t.date),
    score: t.overall_score,
    round: t.round_type,
    grade: t.grade,
  }))

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return (
      <div className="glass px-3 py-2 text-xs space-y-0.5" style={{ minWidth: 120 }}>
        <p className="font-semibold" style={{ color: '#7c3aed' }}>{d.date}</p>
        <p>Score: <span className="font-bold text-white">{d.score}</span></p>
        <p>Grade: <span className="font-bold text-white">{d.grade || '—'}</span></p>
      </div>
    )
  }

  return (
    <div className="glass p-5">
      <p className="text-xs text-muted uppercase tracking-widest mb-4 flex items-center gap-1.5">
        <Activity size={11} /> Progress Timeline
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="pgGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#7c3aed" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="score"
            stroke="#7c3aed"
            strokeWidth={2}
            fill="url(#pgGradient)"
            dot={{ fill: '#7c3aed', r: 3, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}


function SkillVelocityGrid({ velocity }) {
  if (!velocity?.length) return null

  return (
    <div className="glass p-5">
      <p className="text-xs text-muted uppercase tracking-widest mb-4 flex items-center gap-1.5">
        <TrendingUp size={11} /> Skill Velocity
        <span className="ml-auto text-muted font-normal normal-case">pts / session</span>
      </p>
      <div className="grid grid-cols-1 gap-2.5">
        {velocity.map(item => (
          <div key={item.skill}
            className="flex items-center gap-3 p-2.5 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.03)' }}>
            {directionIcon(item.direction)}
            <span className="flex-1 text-sm truncate" title={item.skill}>{item.skill}</span>
            <span className="text-xs text-muted">
              {item.first_score} → {item.last_score}
            </span>
            <span className="text-xs font-bold w-12 text-right"
              style={{ color: velocityColor(item.velocity) }}>
              {item.velocity > 0 ? '+' : ''}{item.velocity}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}


function PersistentGapsAlert({ gaps }) {
  if (!gaps?.length) return null

  return (
    <div className="glass p-5">
      <p className="text-xs text-muted uppercase tracking-widest mb-4 flex items-center gap-1.5">
        <AlertTriangle size={11} style={{ color: '#f87171' }} /> Persistent Gaps
      </p>
      <div className="space-y-2.5">
        {gaps.map(g => {
          const c = SEVERITY_COLORS[g.severity] || SEVERITY_COLORS.medium
          return (
            <div key={g.area}
              className="p-3 rounded-xl flex items-start gap-3"
              style={{ background: c.bg, border: `1px solid ${c.border}` }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-semibold" style={{ color: c.text }}>{g.area}</p>
                  <span className="text-xs px-1.5 py-0.5 rounded font-medium capitalize"
                    style={{ background: c.bg, color: c.text }}>
                    {g.severity}
                  </span>
                </div>
                <p className="text-xs text-muted">
                  Appeared in <span className="font-bold text-white">{g.occurrences}</span> sessions
                  {g.first_seen ? ` · since ${formatDate(g.first_seen)}` : ''}
                </p>
              </div>
              {/* Trend badge */}
              <span className="text-xs flex-shrink-0 mt-0.5"
                style={{
                  color: g.improvement_trend === 'improving' ? '#4ade80'
                    : g.improvement_trend === 'worsening' ? '#f87171'
                    : '#94a3b8'
                }}>
                {g.improvement_trend === 'improving' ? '↑ Improving'
                  : g.improvement_trend === 'worsening' ? '↓ Worsening'
                  : '→ Stuck'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}


function StrongestSkillsBadges({ skills }) {
  if (!skills?.length) return null

  return (
    <div className="glass p-5">
      <p className="text-xs text-muted uppercase tracking-widest mb-4 flex items-center gap-1.5">
        <Star size={11} style={{ color: '#f59e0b' }} /> Strongest Skills
      </p>
      <div className="flex flex-wrap gap-2">
        {skills.map(s => (
          <div key={s.skill}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
            style={{ background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.25)' }}>
            <span style={{ color: '#4ade80' }}>{s.skill}</span>
            <span className="text-white/60">·</span>
            <span className="font-bold" style={{ color: '#4ade80' }}>{s.avg_score}</span>
            {s.trend === 'up' && <TrendingUp size={10} style={{ color: '#4ade80' }} />}
            {s.trend === 'down' && <TrendingDown size={10} style={{ color: '#f87171' }} />}
          </div>
        ))}
      </div>
    </div>
  )
}


// ── Main export ────────────────────────────────────────────────────────────────

export default function ProgressSection({ userId }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!userId) return
    setLoading(true)
    getUserProgress(userId)
      .then(res => {
        if (res?.data) setData(res.data)
        else setError('No progress data available yet.')
      })
      .catch(() => setError('Failed to load progress data.'))
      .finally(() => setLoading(false))
  }, [userId])

  if (loading) {
    return (
      <div className="glass p-12 text-center animate-fade-in-up">
        <Loader2 size={28} className="animate-spin text-muted mx-auto mb-3" />
        <p className="text-muted text-sm">Loading your progress…</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="glass p-12 text-center animate-fade-in-up">
        <BarChart2 size={40} className="text-muted mx-auto mb-4" />
        <p className="text-muted">{error || 'No data available. Complete more interviews to see your progress.'}</p>
      </div>
    )
  }

  const { skill_velocity, progress_timeline, persistent_gaps, strongest_skills, session_count } = data

  if (!session_count) {
    return (
      <div className="glass p-12 text-center animate-fade-in-up">
        <BarChart2 size={40} className="text-muted mx-auto mb-4" />
        <p className="text-muted">No completed sessions yet. Finish an interview to track your progress.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in-up">
      {/* Summary strip */}
      <div className="glass p-4 flex items-center gap-6">
        <div className="text-center">
          <p className="text-2xl font-bold text-white">{session_count}</p>
          <p className="text-xs text-muted mt-0.5">Sessions Analysed</p>
        </div>
        {progress_timeline?.length >= 2 && (() => {
          const last  = progress_timeline[progress_timeline.length - 1]?.overall_score
          const first = progress_timeline[0]?.overall_score
          const delta = (last - first).toFixed(1)
          const up    = delta >= 0
          return (
            <div className="text-center">
              <p className="text-2xl font-bold" style={{ color: up ? '#4ade80' : '#f87171' }}>
                {up ? '+' : ''}{delta}
              </p>
              <p className="text-xs text-muted mt-0.5">Overall Δ Score</p>
            </div>
          )
        })()}
        {strongest_skills?.length > 0 && (
          <div className="text-center">
            <p className="text-2xl font-bold" style={{ color: '#f59e0b' }}>{strongest_skills.length}</p>
            <p className="text-xs text-muted mt-0.5">Strong Skills</p>
          </div>
        )}
        {persistent_gaps?.length > 0 && (
          <div className="text-center">
            <p className="text-2xl font-bold" style={{ color: '#f87171' }}>{persistent_gaps.length}</p>
            <p className="text-xs text-muted mt-0.5">Persistent Gaps</p>
          </div>
        )}
      </div>

      {/* Timeline (full width) */}
      <ProgressTimeline timeline={progress_timeline} />

      {/* Two-column: velocity + gaps */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <SkillVelocityGrid velocity={skill_velocity} />
        <PersistentGapsAlert gaps={persistent_gaps} />
      </div>

      {/* Strongest skills (full width) */}
      <StrongestSkillsBadges skills={strongest_skills} />
    </div>
  )
}
