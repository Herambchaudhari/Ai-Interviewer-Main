/**
 * ProgressSection — 6-panel progress dashboard.
 *   1. Achievement Badges
 *   2. Readiness Projection Chart
 *   3. Per-Round Multi-line Timeline
 *   4. Before/After Radar Overlay  +  Skill Level Ladder
 *   5. Skill Velocity Grid         +  Persistent Gaps
 *   6. AI Action Plan
 *   7. Strongest Skills
 */
import { useState, useEffect } from 'react'
import {
  ResponsiveContainer,
  AreaChart, Area,
  LineChart, Line,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle,
  Star, Loader2, Activity, BarChart2, Award,
  Lock, CheckCircle2, Target, Zap, ChevronRight,
} from 'lucide-react'
import { getUserProgress } from '../../lib/api'

// ── Palettes ───────────────────────────────────────────────────────────────────
const ROUND_COLORS = {
  technical:     '#7c3aed',
  hr:            '#ec4899',
  dsa:           '#06b6d4',
  mcq_practice:  '#f59e0b',
  system_design: '#94a3b8',
}

const SEVERITY_COLORS = {
  critical: { bg: 'rgba(248,113,113,0.12)', text: '#f87171', border: 'rgba(248,113,113,0.3)' },
  high:     { bg: 'rgba(251,191,36,0.12)',  text: '#fbbf24', border: 'rgba(251,191,36,0.3)' },
  medium:   { bg: 'rgba(148,163,184,0.12)', text: '#94a3b8', border: 'rgba(148,163,184,0.3)' },
}

const TIER_CONFIG = [
  { label: 'Beginner',    min: 0,  max: 39,  color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
  { label: 'Developing',  min: 40, max: 59,  color: '#fbbf24', bg: 'rgba(251,191,36,0.15)'  },
  { label: 'Competent',   min: 60, max: 74,  color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
  { label: 'Proficient',  min: 75, max: 89,  color: '#4ade80', bg: 'rgba(74,222,128,0.15)'  },
  { label: 'Expert',      min: 90, max: 100, color: '#7c3aed', bg: 'rgba(124,58,237,0.15)'  },
]

const ACHIEVEMENT_ICONS = {
  first_70:    '🎯',
  first_80:    '🔥',
  first_90:    '⭐',
  five_streak: '⚡',
  gap_conquered:'🧠',
  consistent:  '💎',
  all_rounder: '🏆',
  ten_sessions:'🚀',
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

function getTier(score) {
  return TIER_CONFIG.find(t => score >= t.min && score <= t.max) || TIER_CONFIG[0]
}

// ── Skeleton ───────────────────────────────────────────────────────────────────
export function SkeletonProgress() {
  const bar = (h) => (
    <div className="glass rounded-xl animate-pulse" style={{ height: h }} />
  )
  return (
    <div className="space-y-5">
      {bar('96px')}
      {bar('80px')}
      {bar('220px')}
      {bar('200px')}
      <div className="grid grid-cols-2 gap-5">{bar('260px')}{bar('260px')}</div>
      <div className="grid grid-cols-2 gap-5">{bar('200px')}{bar('200px')}</div>
      {bar('140px')}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 6 — Achievement Badges
// ══════════════════════════════════════════════════════════════════════════════
function AchievementBadges({ achievements }) {
  if (!achievements?.length) return null

  const earned   = achievements.filter(a => a.earned)
  const unearned = achievements.filter(a => !a.earned)
  const sorted   = [...earned, ...unearned]

  return (
    <div className="glass p-5">
      <div className="flex items-center gap-2 mb-4">
        <Award size={13} style={{ color: '#f59e0b' }} />
        <p className="text-xs text-muted uppercase tracking-widest">Achievements</p>
        <span className="ml-auto text-xs font-semibold"
          style={{ color: '#f59e0b' }}>
          {earned.length} / {achievements.length} earned
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {sorted.map(a => (
          <div key={a.id}
            className="flex flex-col items-center gap-1.5 p-3 rounded-xl text-center transition-all"
            style={{
              background: a.earned ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${a.earned ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.06)'}`,
              opacity: a.earned ? 1 : 0.5,
            }}>
            <span className="text-2xl" style={{ filter: a.earned ? 'none' : 'grayscale(1)' }}>
              {ACHIEVEMENT_ICONS[a.id] || '🏅'}
            </span>
            <p className="text-xs font-semibold text-white leading-tight">{a.label}</p>
            <p className="text-xs text-muted leading-tight">{a.description}</p>
            {a.earned && a.earned_date ? (
              <p className="text-xs mt-0.5" style={{ color: '#f59e0b' }}>
                {formatDate(a.earned_date)}
              </p>
            ) : !a.earned ? (
              <Lock size={11} className="text-muted mt-0.5" />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 3 — Readiness Projection Chart
// ══════════════════════════════════════════════════════════════════════════════
function ReadinessProjectionChart({ timeline, projection }) {
  if (!timeline?.length) return null

  // Combine historical + projected into one dataset
  const historical = timeline.map((t, i) => ({
    label:      formatDate(t.date),
    actual:     t.overall_score,
    projected:  null,
    idx:        i,
  }))

  const lastIdx = historical.length - 1
  const projectedPoints = projection?.projected_points || []
  const projectedData = projectedPoints.map((p, i) => ({
    label:     `+${p.session_offset}`,
    actual:    null,
    projected: p.score,
    idx:       lastIdx + i + 1,
  }))

  // Bridge: duplicate the last actual point as start of projection line
  if (projectedData.length > 0 && historical.length > 0) {
    const last = historical[historical.length - 1]
    projectedData.unshift({ ...last, projected: last.actual, actual: null })
  }

  const chartData = [...historical, ...projectedData.slice(1)]

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const d = payload[0]?.payload
    return (
      <div className="glass px-3 py-2 text-xs space-y-0.5" style={{ minWidth: 110 }}>
        <p className="font-semibold" style={{ color: '#7c3aed' }}>{d?.label}</p>
        {d?.actual != null && <p>Score: <span className="font-bold text-white">{d.actual}</span></p>}
        {d?.projected != null && <p>Projected: <span className="font-bold" style={{ color: '#f59e0b' }}>{d.projected}</span></p>}
      </div>
    )
  }

  // Pill label
  let pill = null
  if (projection?.already_at_target) {
    pill = { text: 'At target already 🎉', color: '#4ade80' }
  } else if (projection?.on_track && projection?.sessions_needed != null) {
    pill = { text: `On track · ~${projection.sessions_needed} sessions to ${projection.target}`, color: '#f59e0b' }
  } else if (projection && !projection.on_track) {
    pill = { text: 'Keep practising to build momentum', color: '#94a3b8' }
  }

  return (
    <div className="glass p-5">
      <div className="flex items-center gap-2 mb-1">
        <Target size={13} style={{ color: '#7c3aed' }} />
        <p className="text-xs text-muted uppercase tracking-widest">Score Timeline & Projection</p>
        {pill && (
          <span className="ml-auto text-xs font-semibold px-2.5 py-0.5 rounded-full"
            style={{ background: `${pill.color}20`, color: pill.color, border: `1px solid ${pill.color}40` }}>
            {pill.text}
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#7c3aed" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} />
          <Tooltip content={<CustomTooltip />} />
          {projection?.target && (
            <ReferenceLine y={projection.target} stroke="#f59e0b" strokeDasharray="4 4"
              label={{ value: `Target ${projection.target}`, fill: '#f59e0b', fontSize: 10, position: 'right' }} />
          )}
          <Line
            type="monotone" dataKey="actual"
            stroke="#7c3aed" strokeWidth={2}
            dot={{ fill: '#7c3aed', r: 3, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            connectNulls={false}
            name="Actual"
          />
          {projectedPoints.length > 0 && (
            <Line
              type="monotone" dataKey="projected"
              stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 4"
              dot={{ fill: '#f59e0b', r: 3, strokeWidth: 0 }}
              connectNulls={false}
              name="Projected"
            />
          )}
          {projectedPoints.length > 0 && <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 2 — Per-Round Multi-line Timeline
// ══════════════════════════════════════════════════════════════════════════════
function MultiLineTimeline({ roundTimeline }) {
  const tracks = Object.keys(roundTimeline || {})
  if (!tracks.length) return null

  // Build a unified date-indexed dataset
  const allDates = [...new Set(
    tracks.flatMap(rt => roundTimeline[rt].map(p => p.date))
  )].sort()

  const chartData = allDates.map(date => {
    const row = { date: formatDate(date) }
    tracks.forEach(rt => {
      const pt = roundTimeline[rt].find(p => p.date === date)
      row[rt] = pt ? pt.score : null
    })
    return row
  })

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (
      <div className="glass px-3 py-2 text-xs space-y-0.5" style={{ minWidth: 130 }}>
        <p className="font-semibold text-white mb-1">{label}</p>
        {payload.map(p => p.value != null && (
          <p key={p.dataKey} style={{ color: ROUND_COLORS[p.dataKey] || '#94a3b8' }}>
            <span className="capitalize">{p.dataKey.replace('_', ' ')}</span>: <span className="font-bold">{p.value}</span>
          </p>
        ))}
      </div>
    )
  }

  return (
    <div className="glass p-5">
      <p className="text-xs text-muted uppercase tracking-widest mb-4 flex items-center gap-1.5">
        <Activity size={11} /> Score by Round Type
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 5, right: 12, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} />
          <Tooltip content={<CustomTooltip />} />
          {tracks.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} formatter={v => v.replace('_', ' ')} />}
          {tracks.map(rt => (
            <Line
              key={rt}
              type="monotone"
              dataKey={rt}
              stroke={ROUND_COLORS[rt] || '#94a3b8'}
              strokeWidth={2}
              dot={{ fill: ROUND_COLORS[rt] || '#94a3b8', r: 3, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 1 — Before / After Radar Overlay
// ══════════════════════════════════════════════════════════════════════════════
function BeforeAfterRadar({ data }) {
  if (!data) {
    return (
      <div className="glass p-5 flex flex-col items-center justify-center text-center gap-3" style={{ minHeight: 260 }}>
        <Activity size={28} className="text-muted" />
        <p className="text-sm text-muted">Complete at least 2 sessions to unlock skill growth view.</p>
      </div>
    )
  }

  const { before, after, dimensions, delta_avg, sessions_compared } = data

  const chartData = dimensions.map(d => ({
    skill:  d,
    before: before[d],
    after:  after[d],
  }))

  const deltaPositive = delta_avg >= 0

  return (
    <div className="glass p-5">
      <div className="flex items-center gap-2 mb-1">
        <Zap size={13} style={{ color: '#7c3aed' }} />
        <p className="text-xs text-muted uppercase tracking-widest">Skill Growth</p>
        <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{
            background: deltaPositive ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
            color: deltaPositive ? '#4ade80' : '#f87171',
          }}>
          {deltaPositive ? '+' : ''}{delta_avg} avg
        </span>
      </div>
      <p className="text-xs text-muted mb-3">
        First {sessions_compared} vs latest {sessions_compared} sessions
      </p>

      <ResponsiveContainer width="100%" height={220}>
        <RadarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
          <PolarGrid stroke="rgba(255,255,255,0.08)" />
          <PolarAngleAxis dataKey="skill" tick={{ fill: '#94a3b8', fontSize: 10 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar name="Before" dataKey="before"
            stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3"
            fill="#94a3b8" fillOpacity={0.1} />
          <Radar name="After" dataKey="after"
            stroke="#7c3aed" strokeWidth={2}
            fill="#7c3aed" fillOpacity={0.25} />
          <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
          <Tooltip
            formatter={(val, name) => [`${val}`, name === 'before' ? 'First sessions' : 'Recent sessions']}
            contentStyle={{ background: 'rgba(15,15,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 4 — Skill Level Ladder
// ══════════════════════════════════════════════════════════════════════════════
function SkillLevelLadder({ velocity, strongest }) {
  // Build skill → avg_score map from velocity data
  const skillMap = {}
  ;(velocity || []).forEach(item => {
    const avg = (item.first_score + item.last_score) / 2
    skillMap[item.skill] = Math.round(avg * 10) / 10
  })
  ;(strongest || []).forEach(item => {
    skillMap[item.skill] = item.avg_score
  })

  const skills = Object.entries(skillMap)
    .map(([skill, score]) => ({ skill, score }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 8)

  if (!skills.length) {
    return (
      <div className="glass p-5 flex flex-col items-center justify-center text-center gap-3" style={{ minHeight: 260 }}>
        <BarChart2 size={28} className="text-muted" />
        <p className="text-sm text-muted">Complete more sessions to see your skill levels.</p>
      </div>
    )
  }

  return (
    <div className="glass p-5">
      <p className="text-xs text-muted uppercase tracking-widest mb-4 flex items-center gap-1.5">
        <TrendingUp size={11} /> Skill Levels
      </p>
      <div className="space-y-3">
        {skills.map(({ skill, score }) => {
          const tier     = getTier(score)
          const tierIdx  = TIER_CONFIG.indexOf(tier)
          return (
            <div key={skill} className="flex items-center gap-3">
              {/* Skill name */}
              <span className="text-xs text-white/80 truncate w-28 flex-shrink-0" title={skill}>{skill}</span>

              {/* 5 level dots */}
              <div className="flex gap-1 flex-shrink-0">
                {TIER_CONFIG.map((t, i) => (
                  <div key={i} className="rounded-full transition-all"
                    style={{
                      width: 8, height: 8,
                      background: i <= tierIdx ? tier.color : 'rgba(255,255,255,0.1)',
                      boxShadow: i === tierIdx ? `0 0 6px ${tier.color}` : 'none',
                    }} />
                ))}
              </div>

              {/* Tier badge */}
              <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                style={{ background: tier.bg, color: tier.color }}>
                {tier.label}
              </span>

              {/* Score */}
              <span className="text-xs font-bold ml-auto flex-shrink-0" style={{ color: tier.color }}>
                {score}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 5 — AI Action Plan (frontend-computed, no LLM call)
// ══════════════════════════════════════════════════════════════════════════════
function AIActionPlan({ gaps, velocity, roundTimeline }) {
  const actions = []

  // Focus area: top 2 persistent gaps that aren't improving
  const focusGaps = (gaps || [])
    .filter(g => g.improvement_trend !== 'improving')
    .slice(0, 2)
  focusGaps.forEach(g => {
    actions.push({
      type:       'focus',
      icon:       AlertTriangle,
      color:      '#f87171',
      bg:         'rgba(248,113,113,0.08)',
      border:     'rgba(248,113,113,0.2)',
      title:      `Address "${g.area}"`,
      suggestion: `This gap has appeared in ${g.occurrences} sessions and is ${g.improvement_trend}. Dedicate your next session to specifically targeting this area.`,
    })
  })

  // Slipping skill: top velocity item going down
  const slipping = (velocity || []).find(v => v.direction === 'down')
  if (slipping) {
    actions.push({
      type:       'warning',
      icon:       TrendingDown,
      color:      '#fbbf24',
      bg:         'rgba(251,191,36,0.08)',
      border:     'rgba(251,191,36,0.2)',
      title:      `"${slipping.skill}" is slipping`,
      suggestion: `Dropped from ${slipping.first_score} → ${slipping.last_score} over recent sessions. Revisit this skill before it becomes a persistent gap.`,
    })
  }

  // Strength to keep: best-performing round type
  const roundTracks = Object.keys(roundTimeline || {})
  if (roundTracks.length > 0) {
    const roundAvgs = roundTracks.map(rt => {
      const pts = roundTimeline[rt]
      const avg = Math.round(pts.reduce((s, p) => s + p.score, 0) / pts.length * 10) / 10
      return { rt, avg }
    })
    const best = roundAvgs.sort((a, b) => b.avg - a.avg)[0]
    if (best) {
      actions.push({
        type:       'strength',
        icon:       Star,
        color:      '#4ade80',
        bg:         'rgba(74,222,128,0.08)',
        border:     'rgba(74,222,128,0.2)',
        title:      `Keep up ${best.rt.replace('_', ' ')} rounds`,
        suggestion: `Your best format with an average of ${best.avg}. Continue practising to consolidate this strength.`,
      })
    }
  }

  if (!actions.length) {
    return (
      <div className="glass p-5 text-center">
        <p className="text-sm text-muted">Complete more sessions for personalised recommendations.</p>
      </div>
    )
  }

  return (
    <div className="glass p-5">
      <p className="text-xs text-muted uppercase tracking-widest mb-4 flex items-center gap-1.5">
        <ChevronRight size={11} /> AI Action Plan
      </p>
      <div className="space-y-3">
        {actions.map((a, i) => {
          const Icon = a.icon
          return (
            <div key={i} className="flex items-start gap-3 p-3 rounded-xl"
              style={{ background: a.bg, border: `1px solid ${a.border}` }}>
              <div className="mt-0.5 flex-shrink-0 p-1.5 rounded-lg" style={{ background: `${a.color}20` }}>
                <Icon size={13} style={{ color: a.color }} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold mb-0.5" style={{ color: a.color }}>{a.title}</p>
                <p className="text-xs text-muted leading-relaxed">{a.suggestion}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Existing sub-components (unchanged)
// ══════════════════════════════════════════════════════════════════════════════

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
            <span className="text-xs text-muted">{item.first_score} → {item.last_score}</span>
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
                    style={{ background: c.bg, color: c.text }}>{g.severity}</span>
                </div>
                <p className="text-xs text-muted">
                  Appeared in <span className="font-bold text-white">{g.occurrences}</span> sessions
                  {g.first_seen ? ` · since ${formatDate(g.first_seen)}` : ''}
                </p>
              </div>
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
            {s.trend === 'up'   && <TrendingUp  size={10} style={{ color: '#4ade80' }} />}
            {s.trend === 'down' && <TrendingDown size={10} style={{ color: '#f87171' }} />}
          </div>
        ))}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Main Export
// ══════════════════════════════════════════════════════════════════════════════
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

  if (loading) return <SkeletonProgress />

  if (error || !data) {
    return (
      <div className="glass p-12 text-center animate-fade-in-up">
        <BarChart2 size={40} className="text-muted mx-auto mb-4" />
        <p className="text-muted">{error || 'No data available. Complete more interviews to see your progress.'}</p>
      </div>
    )
  }

  const {
    skill_velocity, progress_timeline, persistent_gaps, strongest_skills,
    session_count,
    round_timeline, before_after_radar, readiness_projection, achievements,
  } = data

  if (!session_count) {
    return (
      <div className="glass p-12 text-center animate-fade-in-up">
        <BarChart2 size={40} className="text-muted mx-auto mb-4" />
        <p className="text-muted">No completed sessions yet. Finish an interview to track your progress.</p>
      </div>
    )
  }

  const hasRoundTimeline = round_timeline && Object.keys(round_timeline).length > 0
  const hasAchievements  = achievements?.length > 0
  const earnedCount      = achievements?.filter(a => a.earned).length ?? 0

  return (
    <div className="space-y-5 animate-fade-in-up">

      {/* ── Summary strip ───────────────────────────────────────────────── */}
      <div className="glass p-4 flex items-center gap-6 flex-wrap">
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
        {hasAchievements && (
          <div className="text-center ml-auto">
            <p className="text-2xl font-bold" style={{ color: '#f59e0b' }}>
              {earnedCount}<span className="text-base text-muted">/{achievements.length}</span>
            </p>
            <p className="text-xs text-muted mt-0.5">Achievements</p>
          </div>
        )}
      </div>

      {/* ── 1. Achievement Badges ──────────────────────────────────────── */}
      {hasAchievements && <AchievementBadges achievements={achievements} />}

      {/* ── 2. Readiness Projection (full width) ──────────────────────── */}
      <ReadinessProjectionChart timeline={progress_timeline} projection={readiness_projection} />

      {/* ── 3. Per-Round Multi-line Timeline (full width) ─────────────── */}
      {hasRoundTimeline && <MultiLineTimeline roundTimeline={round_timeline} />}

      {/* ── 4+4. Before/After Radar  +  Skill Level Ladder ───────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <BeforeAfterRadar data={before_after_radar} />
        <SkillLevelLadder velocity={skill_velocity} strongest={strongest_skills} />
      </div>

      {/* ── Velocity  +  Persistent Gaps ──────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <SkillVelocityGrid velocity={skill_velocity} />
        <PersistentGapsAlert gaps={persistent_gaps} />
      </div>

      {/* ── 5. AI Action Plan (full width) ────────────────────────────── */}
      <AIActionPlan
        gaps={persistent_gaps}
        velocity={skill_velocity}
        roundTimeline={round_timeline}
      />

      {/* ── Strongest Skills ──────────────────────────────────────────── */}
      <StrongestSkillsBadges skills={strongest_skills} />

    </div>
  )
}
