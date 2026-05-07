/**
 * AnalyticsSection — full performance analytics dashboard.
 * Sections (in render order):
 *  1. Stat cards (total, avg score + velocity, best round, win rate, streak, longest streak)
 *  2. Score trend line chart (multi-round)
 *  3. Avg score by round type + by difficulty (bar charts)
 *  4. Per-round dimension radar grid
 *  5. Recurring weak areas (ranked bars) + grade distribution (donut)
 *  6. Streak / activity calendar heatmap
 *  7. MCQ topic accuracy bars + time-per-question trend
 */
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, BarChart, Bar, Cell, Legend,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  PieChart, Pie,
} from 'recharts'
import {
  TrendingUp, Award, Target, Percent, BarChart2,
  Flame, Zap, Clock, BookOpen, ChevronRight,
} from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────

const ROUND_COLORS = {
  technical:     '#7c3aed',
  hr:            '#ec4899',
  dsa:           '#06b6d4',
  mcq_practice:  '#f59e0b',
  system_design: '#94a3b8',
}
const ROUND_LABELS = {
  technical:     'Technical',
  hr:            'HR',
  dsa:           'DSA',
  mcq_practice:  'MCQ Practice',
  system_design: 'System Design',
}
const DIFF_COLORS  = { easy: '#4ade80', medium: '#f59e0b', hard: '#f87171' }
const GRADE_COLORS = {
  'A+': '#10b981', A: '#10b981', 'A-': '#34d399',
  'B+': '#06b6d4', B: '#06b6d4', 'B-': '#22d3ee',
  'C+': '#f59e0b', C: '#f59e0b', 'C-': '#fbbf24',
  D:    '#f97316', F: '#f87171', 'N/A': '#94a3b8',
}
const RADAR_DIM_LABELS = {
  technical_accuracy:    'Tech Accuracy',
  depth_completeness:    'Depth',
  communication_clarity: 'Communication',
  confidence_delivery:   'Confidence',
  relevance:             'Relevance',
  example_quality:       'Examples',
  structure:             'Structure',
}
const ALL_DIMS = Object.keys(RADAR_DIM_LABELS)

const TOOLTIP_STYLE = {
  background:   'var(--color-surface)',
  border:       '1px solid var(--color-border)',
  borderRadius: '8px',
  fontSize:     '12px',
  color:        'var(--color-text)',
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function SectionHeader({ title, badge }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <h3 className="text-xs font-semibold uppercase tracking-widest"
        style={{ color: 'var(--color-muted)' }}>
        {title}
      </h3>
      {badge}
    </div>
  )
}

function StatCard({ label, value, sub, icon: Icon, color, velocity }) {
  return (
    <div className="glass p-5 flex items-start gap-4 animate-fade-in-up">
      <div className="p-3 rounded-xl flex-shrink-0" style={{ background: `${color}20` }}>
        <Icon size={20} style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-2xl font-bold truncate" style={{ color }}>{value}</p>
        <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--color-text)' }}>{label}</p>
        {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{sub}</p>}
        {velocity !== null && velocity !== undefined && (
          <span
            className="inline-flex items-center gap-1 mt-1.5 text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: velocity >= 0 ? 'rgba(16,185,129,0.12)' : 'rgba(248,113,113,0.12)',
              color:      velocity >= 0 ? '#10b981' : '#f87171',
            }}
          >
            {velocity >= 0 ? '↑' : '↓'} {Math.abs(velocity)} pts (last 5)
          </span>
        )}
      </div>
    </div>
  )
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass p-3 text-xs">
      <p className="mb-1" style={{ color: 'var(--color-muted)' }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {ROUND_LABELS[p.dataKey] || p.dataKey}: <strong>{p.value}</strong>
        </p>
      ))}
    </div>
  )
}

// ── Empty / skeleton states ────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="glass p-16 text-center">
      <BarChart2 size={44} className="mx-auto mb-4" style={{ color: 'var(--color-muted)' }} />
      <p className="text-lg font-semibold mb-2">No interview data yet</p>
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
        Complete at least one interview to see your analytics here.
      </p>
    </div>
  )
}

export function SkeletonAnalytics() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="glass h-24 rounded-2xl"
            style={{ background: 'var(--color-surface-2)' }} />
        ))}
      </div>
      <div className="glass h-36 rounded-2xl" style={{ background: 'var(--color-surface-2)' }} />
      <div className="glass h-56 rounded-2xl" style={{ background: 'var(--color-surface-2)' }} />
      <div className="glass h-48 rounded-2xl" style={{ background: 'var(--color-surface-2)' }} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass h-48 rounded-2xl"
            style={{ background: 'var(--color-surface-2)' }} />
        ))}
      </div>
      <div className="glass h-40 rounded-2xl" style={{ background: 'var(--color-surface-2)' }} />
    </div>
  )
}

// ── Feature 2: Per-round radar ─────────────────────────────────────────────────

function RoundRadarChart({ roundType, dimScores, color }) {
  const data = ALL_DIMS.map(dim => ({
    subject:  RADAR_DIM_LABELS[dim],
    value:    dimScores[dim] ?? 0,
    fullMark: 100,
  }))
  const hasSomeData = data.some(d => d.value > 0)
  if (!hasSomeData) return (
    <div className="flex items-center justify-center h-48 text-xs"
      style={{ color: 'var(--color-muted)' }}>
      No dimension data
    </div>
  )
  return (
    <ResponsiveContainer width="100%" height={200}>
      <RadarChart cx="50%" cy="50%" outerRadius="72%" data={data}>
        <PolarGrid stroke="var(--color-border)" />
        <PolarAngleAxis dataKey="subject"
          tick={{ fill: 'var(--color-muted)', fontSize: 9 }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Radar
          name={ROUND_LABELS[roundType] || roundType}
          dataKey="value"
          stroke={color}
          fill={color}
          fillOpacity={0.18}
          strokeWidth={2}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
      </RadarChart>
    </ResponsiveContainer>
  )
}

// ── Feature 4: Grade donut ─────────────────────────────────────────────────────

function GradeDonut({ data }) {
  if (!data.length) return (
    <p className="text-xs py-8 text-center" style={{ color: 'var(--color-muted)' }}>
      No grade data yet
    </p>
  )
  const total = data.reduce((s, d) => s + d.count, 0)
  return (
    <div className="flex flex-col items-center">
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%"
            innerRadius={48} outerRadius={78}
            dataKey="count" nameKey="grade" paddingAngle={3}>
            {data.map(entry => (
              <Cell key={entry.grade} fill={GRADE_COLORS[entry.grade] || '#7c3aed'} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v) => [`${v} session${v !== 1 ? 's' : ''}`, '']}
            contentStyle={TOOLTIP_STYLE}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap justify-center gap-3 mt-1">
        {data.map(entry => (
          <div key={entry.grade} className="flex items-center gap-1.5 text-xs">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: GRADE_COLORS[entry.grade] || '#7c3aed' }} />
            <span style={{ color: 'var(--color-muted)' }}>
              {entry.grade}{' '}
              <strong style={{ color: 'var(--color-text)' }}>
                {Math.round(entry.count / total * 100)}%
              </strong>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Feature 1: Weak areas ranked bars ─────────────────────────────────────────

function WeakAreasChart({ data }) {
  if (!data.length) return (
    <p className="text-xs py-6" style={{ color: 'var(--color-muted)' }}>
      No recurring weak areas yet — keep practicing!
    </p>
  )
  const top = data.slice(0, 10)
  const maxCount = Math.max(...top.map(d => d.count))

  const chartData = top.map(d => ({
    name:  d.area.length > 20 ? d.area.slice(0, 18) + '…' : d.area,
    count: d.count,
  }))

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 36)}>
      <BarChart data={chartData} layout="vertical"
        margin={{ top: 0, right: 30, bottom: 0, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis type="number" domain={[0, maxCount + 1]}
          allowDecimals={false}
          tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
        <YAxis type="category" dataKey="name" width={120}
          tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
        <Tooltip
          formatter={(v) => [`${v} session${v !== 1 ? 's' : ''}`, 'Appearances']}
          contentStyle={TOOLTIP_STYLE}
        />
        <Bar dataKey="count" radius={[0, 6, 6, 0]}>
          {chartData.map((entry, i) => {
            // purple → red as frequency increases
            const ratio = maxCount > 1 ? entry.count / maxCount : 0.5
            const r = Math.round(248 * ratio + 124 * (1 - ratio))
            const g = Math.round(113 * ratio + 58  * (1 - ratio))
            const b = Math.round(113 * ratio + 237 * (1 - ratio))
            return <Cell key={i} fill={`rgb(${r},${g},${b})`} />
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Feature 5: Streak calendar heatmap ────────────────────────────────────────

function StreakCalendar({ activityMap = {}, totalActiveDays = 0, currentStreak = 0, longestStreak = 0 }) {
  // Build last 52 weeks (364 days)
  const today = new Date()
  const cells = []
  for (let i = 363; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    cells.push({ date: key, count: activityMap[key] || 0 })
  }

  // Group into columns of 7 days
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }

  const cellColor = (count) => {
    if (count === 0) return 'var(--color-surface-2)'
    if (count === 1) return 'rgba(124,58,237,0.35)'
    if (count === 2) return 'rgba(124,58,237,0.62)'
    return 'rgba(124,58,237,0.90)'
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 mb-4 text-xs"
        style={{ color: 'var(--color-muted)' }}>
        <span>
          <strong style={{ color: currentStreak > 0 ? '#f59e0b' : 'var(--color-text)' }}>
            {currentStreak}
          </strong>{' '}day streak
        </span>
        <span>Best: <strong style={{ color: 'var(--color-text)' }}>{longestStreak}</strong></span>
        <span>
          <strong style={{ color: 'var(--color-text)' }}>{totalActiveDays}</strong> active days
        </span>
        <div className="flex items-center gap-1.5 ml-auto">
          <span>Less</span>
          {[0, 1, 2, 3].map(v => (
            <div key={v} style={{
              width: '11px', height: '11px', borderRadius: '3px',
              background: cellColor(v),
              border: '1px solid rgba(255,255,255,0.06)',
            }} />
          ))}
          <span>More</span>
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        <div style={{ display: 'flex', gap: '3px', minWidth: 'max-content' }}>
          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {week.map(cell => (
                <div
                  key={cell.date}
                  title={`${cell.date} — ${cell.count} session${cell.count !== 1 ? 's' : ''}`}
                  style={{
                    width:        '12px',
                    height:       '12px',
                    borderRadius: '3px',
                    background:   cellColor(cell.count),
                    border:       '1px solid rgba(255,255,255,0.06)',
                    cursor:       cell.count > 0 ? 'pointer' : 'default',
                    transition:   'opacity 0.15s',
                  }}
                  onMouseEnter={e => { if (cell.count > 0) e.target.style.opacity = '0.75' }}
                  onMouseLeave={e => { e.target.style.opacity = '1' }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Feature 6: MCQ topic accuracy ─────────────────────────────────────────────

function MCQTopicChart({ data }) {
  if (!data.length) return (
    <p className="text-xs py-6" style={{ color: 'var(--color-muted)' }}>
      Complete MCQ Practice sessions to see topic-level accuracy.
    </p>
  )
  const chartData = data.map(d => ({
    name:     d.topic.length > 18 ? d.topic.slice(0, 16) + '…' : d.topic,
    accuracy: d.accuracy,
    correct:  d.correct,
    total:    d.total,
  }))
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 36)}>
      <BarChart data={chartData} layout="vertical"
        margin={{ top: 0, right: 40, bottom: 0, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis type="number" domain={[0, 100]}
          tick={{ fill: 'var(--color-muted)', fontSize: 11 }}
          tickFormatter={v => `${v}%`} />
        <YAxis type="category" dataKey="name" width={110}
          tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
        <Tooltip
          formatter={(v, n, p) => [
            `${v}% (${p.payload.correct}/${p.payload.total})`, 'Accuracy',
          ]}
          contentStyle={TOOLTIP_STYLE}
        />
        <Bar dataKey="accuracy" radius={[0, 6, 6, 0]}>
          {chartData.map((entry, i) => (
            <Cell
              key={i}
              fill={entry.accuracy >= 80 ? '#10b981' : entry.accuracy >= 50 ? '#f59e0b' : '#f87171'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Feature 7: Time-per-question trend ────────────────────────────────────────

function TimePerQuestionTrend({ data }) {
  if (!data.length) return null

  const avg = arr => arr.reduce((s, d) => s + d.avg_time_secs, 0) / arr.length
  const half = Math.ceil(data.length / 2)
  const firstHalf  = data.slice(0, half)
  const secondHalf = data.slice(half)
  const timeDelta = secondHalf.length && firstHalf.length
    ? Math.round((1 - avg(secondHalf) / avg(firstHalf)) * 100)
    : null

  const roundTypes = [...new Set(data.map(d => d.round_type))]
  const trendByDate = {}
  data.forEach(({ date, avg_time_secs, round_type }) => {
    if (!trendByDate[date]) trendByDate[date] = { date }
    trendByDate[date][round_type] = avg_time_secs
  })
  const chartData = Object.values(trendByDate)

  return (
    <div className="glass p-6 animate-fade-in-up" style={{ animationDelay: '320ms' }}>
      <SectionHeader
        title="Avg Time per Question (secs)"
        badge={timeDelta !== null ? (
          <span
            className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
            style={{
              background: timeDelta > 0 ? 'rgba(16,185,129,0.12)' : 'rgba(248,113,113,0.12)',
              color:      timeDelta > 0 ? '#10b981' : '#f87171',
            }}
          >
            {timeDelta > 0 ? `${timeDelta}% faster` : `${Math.abs(timeDelta)}% slower`}
          </span>
        ) : null}
      />
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="date" tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
          <YAxis tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
          <Tooltip content={<CustomTooltip />} />
          <Legend formatter={v => ROUND_LABELS[v] || v}
            wrapperStyle={{ fontSize: '12px', color: 'var(--color-muted)' }} />
          {roundTypes.map(rt => (
            <Line key={rt} type="monotone" dataKey={rt}
              stroke={ROUND_COLORS[rt] || '#7c3aed'} strokeWidth={2}
              dot={{ r: 4, fill: ROUND_COLORS[rt] || '#7c3aed' }}
              connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── New Feature A: Personal Best vs. Latest ───────────────────────────────────

function BestVsLatestChart({ data }) {
  const entries = Object.entries(data || {})
  if (!entries.length) return (
    <p className="text-xs py-6 text-center" style={{ color: 'var(--color-muted)' }}>
      Complete at least 2 sessions per round type to see comparisons.
    </p>
  )
  const chartData = entries.map(([rt, v]) => ({
    name:   ROUND_LABELS[rt] || rt,
    best:   v.best,
    latest: v.latest,
    delta:  v.delta,
    rt,
  }))
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey="name" tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
        <YAxis domain={[0, 100]} tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(v, name, props) => {
            const delta = props?.payload?.delta
            if (name === 'Latest' && delta !== undefined) {
              const sign = delta >= 0 ? '+' : ''
              return [`${v} (${sign}${delta} vs best)`, name]
            }
            return [v, name]
          }}
        />
        <Legend wrapperStyle={{ fontSize: '12px', color: 'var(--color-muted)' }} />
        <Bar dataKey="best" name="All-Time Best" fill="#f59e0b" radius={[4, 4, 0, 0]} />
        <Bar dataKey="latest" name="Latest" radius={[4, 4, 0, 0]}>
          {chartData.map((entry, i) => (
            <Cell key={i} fill={entry.delta < 0 ? '#f87171' : '#3b82f6'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── New Feature B: Readiness Gauge ────────────────────────────────────────────

function ReadinessGauge({ data }) {
  const { score = 0, label = 'Needs Practice', breakdown = {} } = data || {}
  const color = score >= 85 ? '#10b981' : score >= 65 ? '#7c3aed' : score >= 40 ? '#f59e0b' : '#f87171'
  const circumference = 2 * Math.PI * 50
  const dashLen = (score / 100) * circumference

  const components = [
    { key: 'avg_score',   label: 'Avg Score',   max: 30 },
    { key: 'trend',       label: 'Trend',       max: 25 },
    { key: 'consistency', label: 'Consistency', max: 20 },
    { key: 'breadth',     label: 'Breadth',     max: 15 },
    { key: 'streak',      label: 'Streak',      max: 10 },
  ]

  return (
    <div className="flex flex-col sm:flex-row items-center gap-8">
      {/* Ring */}
      <div style={{ position: 'relative', width: 140, height: 140, flexShrink: 0 }}>
        <svg viewBox="0 0 120 120" width={140} height={140} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="60" cy="60" r="50" fill="none"
            stroke="var(--color-border)" strokeWidth="9" />
          <circle cx="60" cy="60" r="50" fill="none"
            stroke={color} strokeWidth="9"
            strokeDasharray={`${dashLen} ${circumference - dashLen}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 1s ease' }} />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: '30px', fontWeight: 'bold', color, lineHeight: 1 }}>{score}</span>
          <span style={{ fontSize: '10px', color: 'var(--color-muted)' }}>/100</span>
        </div>
      </div>
      {/* Breakdown */}
      <div style={{ flex: 1, width: '100%' }}>
        <p style={{ color, fontWeight: '700', fontSize: '15px', marginBottom: '14px' }}>{label}</p>
        {components.map(({ key, label: l, max }) => {
          const val = breakdown[key] || 0
          const pct = Math.round((val / max) * 100)
          return (
            <div key={key} style={{ marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '3px' }}>
                <span style={{ color: 'var(--color-muted)' }}>{l}</span>
                <span style={{ color: 'var(--color-text)', fontWeight: '600' }}>
                  {Math.round(val)}<span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>/{max}</span>
                </span>
              </div>
              <div style={{ height: '5px', borderRadius: '3px', background: 'var(--color-border)' }}>
                <div style={{
                  height: '100%', borderRadius: '3px', background: color,
                  width: `${pct}%`, transition: 'width 0.8s ease',
                }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── New Feature C: Frequency vs. Score panel ──────────────────────────────────

function FrequencyVsScorePanel({ data }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1].gap - a[1].gap)
  if (!entries.length) return (
    <p className="text-xs py-6" style={{ color: 'var(--color-muted)' }}>
      Complete interviews to see your frequency breakdown.
    </p>
  )
  const maxCount = Math.max(...entries.map(([, v]) => v.count), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {entries.map(([rt, v]) => {
        const color  = ROUND_COLORS[rt] || '#7c3aed'
        const isNeglected = v.gap > 20
        const isBest  = v.gap === 0
        const scoreColor = v.avg_score >= 70 ? '#10b981' : v.avg_score >= 50 ? '#f59e0b' : '#f87171'
        return (
          <div key={rt} className="p-3 rounded-xl animate-fade-in-up"
            style={{ background: 'var(--color-surface-2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ color, fontWeight: '600', fontSize: '13px' }}>
                {ROUND_LABELS[rt] || rt}
              </span>
              {isNeglected && (
                <span style={{ fontSize: '11px', fontWeight: '600', color: '#f59e0b',
                  background: 'rgba(245,158,11,0.12)', padding: '2px 8px', borderRadius: '999px' }}>
                  Neglected ⚠
                </span>
              )}
              {isBest && (
                <span style={{ fontSize: '11px', fontWeight: '600', color: '#10b981',
                  background: 'rgba(16,185,129,0.12)', padding: '2px 8px', borderRadius: '999px' }}>
                  Strongest ✓
                </span>
              )}
            </div>
            <div style={{ marginBottom: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px',
                color: 'var(--color-muted)', marginBottom: '3px' }}>
                <span>Sessions practiced</span><span>{v.count}</span>
              </div>
              <div style={{ height: '5px', borderRadius: '3px', background: 'var(--color-border)' }}>
                <div style={{ height: '100%', width: `${(v.count / maxCount) * 100}%`,
                  borderRadius: '3px', background: color, opacity: 0.65 }} />
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px',
                color: 'var(--color-muted)', marginBottom: '3px' }}>
                <span>Avg score</span><span style={{ color: scoreColor, fontWeight: '600' }}>{v.avg_score}</span>
              </div>
              <div style={{ height: '5px', borderRadius: '3px', background: 'var(--color-border)' }}>
                <div style={{ height: '100%', width: `${v.avg_score}%`,
                  borderRadius: '3px', background: scoreColor }} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── New Feature D: Hours Milestone card ───────────────────────────────────────

function HoursMilestoneCard({ data }) {
  const {
    total_hours = 0, total_minutes = 0,
    milestone, next_milestone, progress_pct = 0,
    achieved_milestones = [],
  } = data || {}

  const minsToNext = next_milestone
    ? Math.max(0, Math.round((parseFloat(next_milestone) - total_hours) * 60))
    : null

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '44px', fontWeight: 'bold', color: '#f59e0b', lineHeight: 1 }}>
        {total_hours.toFixed(1)}
        <span style={{ fontSize: '18px', color: 'var(--color-muted)', fontWeight: 400 }}>h</span>
      </div>
      <p style={{ color: 'var(--color-muted)', fontSize: '13px', marginTop: '4px' }}>
        practiced ({Math.round(total_minutes)} min total)
      </p>

      {next_milestone ? (
        <div style={{ marginTop: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px',
            color: 'var(--color-muted)', marginBottom: '4px' }}>
            <span>{milestone || '0h'}</span>
            <span>{next_milestone}</span>
          </div>
          <div style={{ height: '7px', borderRadius: '4px', background: 'var(--color-border)' }}>
            <div style={{ height: '100%', borderRadius: '4px', background: '#f59e0b',
              width: `${progress_pct}%`, transition: 'width 0.8s ease' }} />
          </div>
          {minsToNext !== null && (
            <p style={{ marginTop: '6px', fontSize: '11px', color: 'var(--color-muted)' }}>
              {minsToNext} min to {next_milestone} milestone
            </p>
          )}
        </div>
      ) : (
        <p style={{ marginTop: '12px', fontSize: '12px', color: '#10b981', fontWeight: '600' }}>
          All milestones achieved! 🏆
        </p>
      )}

      {achieved_milestones.length > 0 && (
        <div style={{ marginTop: '14px', display: 'flex', flexWrap: 'wrap',
          gap: '6px', justifyContent: 'center' }}>
          {achieved_milestones.map(m => (
            <span key={m} style={{ fontSize: '11px', fontWeight: '600', color: '#10b981',
              background: 'rgba(16,185,129,0.12)', padding: '2px 10px', borderRadius: '999px' }}>
              {m} ✓
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── New Feature E: Per-question category breakdown ────────────────────────────

function CategoryBreakdownChart({ data }) {
  if (!data.length) return (
    <p className="text-xs py-6" style={{ color: 'var(--color-muted)' }}>
      Answer more questions to see category breakdown.
    </p>
  )
  const top = data.slice(0, 12)
  const chartData = top.map(d => ({
    name:  d.category.length > 18 ? d.category.slice(0, 16) + '…' : d.category,
    score: d.avg_score,
    count: d.count,
    full:  d.category,
  }))
  const worst3 = data.slice(0, 3)
  const best3  = data.slice(-3).reverse()

  return (
    <div>
      <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 36)}>
        <BarChart data={chartData} layout="vertical"
          margin={{ top: 0, right: 40, bottom: 0, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis type="number" domain={[0, 100]}
            tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={110}
            tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
          <Tooltip
            formatter={(v, n, p) => [`${v} avg (${p.payload.count} questions)`, 'Score']}
            contentStyle={TOOLTIP_STYLE}
          />
          <Bar dataKey="score" radius={[0, 6, 6, 0]}>
            {chartData.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.score >= 75 ? '#4ade80' : entry.score >= 50 ? '#fbbf24' : '#f87171'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {(worst3.length > 0 || best3.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '16px' }}>
          <div style={{ background: 'rgba(248,113,113,0.08)', borderRadius: '10px', padding: '12px' }}>
            <p style={{ fontSize: '11px', fontWeight: '700', color: '#f87171', marginBottom: '6px' }}>
              Needs Work
            </p>
            {worst3.map(d => (
              <div key={d.category} style={{ display: 'flex', justifyContent: 'space-between',
                fontSize: '11px', color: 'var(--color-muted)', marginBottom: '3px' }}>
                <span>{d.category}</span>
                <span style={{ color: '#f87171', fontWeight: '600' }}>{d.avg_score}</span>
              </div>
            ))}
          </div>
          <div style={{ background: 'rgba(74,222,128,0.08)', borderRadius: '10px', padding: '12px' }}>
            <p style={{ fontSize: '11px', fontWeight: '700', color: '#4ade80', marginBottom: '6px' }}>
              Strongest
            </p>
            {best3.map(d => (
              <div key={d.category} style={{ display: 'flex', justifyContent: 'space-between',
                fontSize: '11px', color: 'var(--color-muted)', marginBottom: '3px' }}>
                <span>{d.category}</span>
                <span style={{ color: '#4ade80', fontWeight: '600' }}>{d.avg_score}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function AnalyticsSection({ analytics }) {
  const {
    total_interviews    = 0,
    average_score       = 0,
    best_round_type     = null,
    win_rate            = 0,
    score_trend         = [],
    by_round_type       = {},
    by_difficulty       = {},
    weak_areas_ranked   = [],
    radar_by_round      = {},
    grade_distribution  = [],
    streak              = {},
    mcq_topic_accuracy  = [],
    time_trend          = [],
    best_vs_latest      = {},
    readiness           = {},
    round_freq_vs_score = {},
    hours_practiced     = {},
    category_breakdown  = [],
  } = analytics || {}

  if (!total_interviews) return <EmptyState />

  // ── Feature 3: Score velocity (pure frontend) ────────────────────────────
  const computeVelocity = (entries, roundType, n = 5) => {
    const filtered = entries.filter(e => e.round_type === roundType).slice(-n)
    if (filtered.length < 2) return null
    return Math.round(filtered[filtered.length - 1].score - filtered[0].score)
  }
  const overallVelocity = computeVelocity(score_trend, best_round_type)

  // Score trend line chart data
  const trendByDate = {}
  score_trend.forEach(({ date, score, round_type }) => {
    if (!trendByDate[date]) trendByDate[date] = { date }
    trendByDate[date][round_type] = score
  })
  const trendData  = Object.values(trendByDate)
  const roundTypes = [...new Set(score_trend.map(d => d.round_type))]

  // Round type bar data
  const roundData = Object.entries(by_round_type).map(([rt, v]) => ({
    name:  ROUND_LABELS[rt] || rt,
    avg:   v.avg_score,
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

  const streakData       = streak || {}
  const hasRadar         = Object.keys(radar_by_round).length > 0
  const hasMCQ           = mcq_topic_accuracy.length > 0
  const hasTime          = time_trend.length > 0
  const hasWeak          = weak_areas_ranked.length > 0
  const hasGrades        = grade_distribution.length > 0
  const hasBestVsLatest  = Object.keys(best_vs_latest).length > 0
  const hasFreqScore     = Object.keys(round_freq_vs_score).length > 0
  const hasHours         = (hours_practiced?.total_minutes || 0) > 0
  const hasCategoryBreak = category_breakdown.length > 0

  return (
    <div className="space-y-6">

      {/* ── 1. Stat cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
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
          velocity={overallVelocity}
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
        <StatCard
          label="Current Streak"
          value={`${streakData.current_streak ?? 0}d`}
          sub={streakData.current_streak > 0 ? 'keep it going!' : 'start a streak today'}
          icon={Flame}
          color={streakData.current_streak > 0 ? '#f59e0b' : '#94a3b8'}
        />
        <StatCard
          label="Longest Streak"
          value={`${streakData.longest_streak ?? 0}d`}
          sub={`${streakData.total_active_days ?? 0} active days total`}
          icon={Zap}
          color="#a78bfa"
        />
      </div>

      {/* ── NEW: Readiness Gauge ─────────────────────────────────────────── */}
      <div className="glass p-6 animate-fade-in-up" style={{ animationDelay: '20ms' }}>
        <SectionHeader
          title="Interview Readiness Score"
          badge={
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold"
              style={{
                background: readiness.score >= 65 ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
                color:      readiness.score >= 65 ? '#10b981' : '#f59e0b',
              }}>
              {readiness.label}
            </span>
          }
        />
        <ReadinessGauge data={readiness} />
      </div>

      {/* ── 2. Score trend ──────────────────────────────────────────────── */}
      {trendData.length > 0 && (
        <div className="glass p-6 animate-fade-in-up" style={{ animationDelay: '40ms' }}>
          <SectionHeader title="Score Trend Over Time" />
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend formatter={v => ROUND_LABELS[v] || v}
                wrapperStyle={{ fontSize: '12px', color: 'var(--color-muted)' }} />
              {roundTypes.map(rt => (
                <Line key={rt} type="monotone" dataKey={rt}
                  stroke={ROUND_COLORS[rt] || '#7c3aed'} strokeWidth={2}
                  dot={{ r: 4, fill: ROUND_COLORS[rt] || '#7c3aed' }}
                  connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── NEW: Personal Best vs. Latest ───────────────────────────────── */}
      {hasBestVsLatest && (
        <div className="glass p-6 animate-fade-in-up" style={{ animationDelay: '60ms' }}>
          <SectionHeader
            title="Personal Best vs. Latest Score"
            badge={
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Gold = best ever · Blue = latest · Red = regression
              </span>
            }
          />
          <BestVsLatestChart data={best_vs_latest} />
        </div>
      )}

      {/* ── 3. Round type + Difficulty bars ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {roundData.length > 0 && (
          <div className="glass p-6 animate-fade-in-up" style={{ animationDelay: '80ms' }}>
            <SectionHeader title="Avg Score by Round Type" />
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={roundData} layout="vertical"
                margin={{ top: 0, right: 20, bottom: 0, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis type="number" domain={[0, 100]}
                  tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={90}
                  tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
                <Tooltip
                  formatter={(v, n, p) => [`${v} (${p.payload.count} sessions)`, 'Avg Score']}
                  contentStyle={TOOLTIP_STYLE}
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
          <div className="glass p-6 animate-fade-in-up" style={{ animationDelay: '120ms' }}>
            <SectionHeader title="Avg Score by Difficulty" />
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={diffData} margin={{ top: 0, right: 20, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="name" tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
                <Tooltip
                  formatter={(v, n, p) => [`${v} (${p.payload.count} sessions)`, 'Avg Score']}
                  contentStyle={TOOLTIP_STYLE}
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

      {/* ── NEW: Frequency vs. Score + Hours Milestone ──────────────────── */}
      {(hasFreqScore || hasHours) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {hasFreqScore && (
            <div className="glass p-6 animate-fade-in-up" style={{ animationDelay: '140ms' }}>
              <SectionHeader
                title="Practice Frequency vs. Score"
                badge={
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    sorted by performance gap
                  </span>
                }
              />
              <FrequencyVsScorePanel data={round_freq_vs_score} />
            </div>
          )}
          {hasHours && (
            <div className="glass p-6 animate-fade-in-up" style={{ animationDelay: '160ms' }}>
              <SectionHeader title="Estimated Hours Practiced" />
              <HoursMilestoneCard data={hours_practiced} />
            </div>
          )}
        </div>
      )}

      {/* ── 4. Per-round dimension radar ────────────────────────────────── */}
      {hasRadar && (
        <div className="glass p-6 animate-fade-in-up" style={{ animationDelay: '180ms' }}>
          <SectionHeader title="Performance Dimensions by Round Type" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {Object.entries(radar_by_round).map(([rt, dims]) => (
              <div key={rt}>
                <p className="text-xs font-semibold text-center mb-1"
                  style={{ color: ROUND_COLORS[rt] || '#7c3aed' }}>
                  {ROUND_LABELS[rt] || rt}
                </p>
                <RoundRadarChart roundType={rt} dimScores={dims}
                  color={ROUND_COLORS[rt] || '#7c3aed'} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 5. Weak areas + Grade donut ─────────────────────────────────── */}
      {(hasWeak || hasGrades) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {hasWeak && (
            <div className="glass p-6 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
              <SectionHeader title="Recurring Weak Areas" />
              <WeakAreasChart data={weak_areas_ranked} />
            </div>
          )}
          {hasGrades && (
            <div className="glass p-6 animate-fade-in-up" style={{ animationDelay: '240ms' }}>
              <SectionHeader title="Grade Distribution" />
              <GradeDonut data={grade_distribution} />
            </div>
          )}
        </div>
      )}

      {/* ── NEW: Per-question category breakdown ────────────────────────── */}
      {hasCategoryBreak && (
        <div className="glass p-6 animate-fade-in-up" style={{ animationDelay: '260ms' }}>
          <SectionHeader
            title="Score by Question Category"
            badge={
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                worst first · all round types
              </span>
            }
          />
          <CategoryBreakdownChart data={category_breakdown} />
        </div>
      )}

      {/* ── 6. Activity calendar ────────────────────────────────────────── */}
      <div className="glass p-6 animate-fade-in-up" style={{ animationDelay: '280ms' }}>
        <SectionHeader
          title="Activity — Last 52 Weeks"
          badge={
            streakData.current_streak > 0 ? (
              <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full"
                style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
                <Flame size={11} /> {streakData.current_streak} day streak
              </span>
            ) : null
          }
        />
        <StreakCalendar
          activityMap={streakData.activity_map || {}}
          totalActiveDays={streakData.total_active_days || 0}
          currentStreak={streakData.current_streak || 0}
          longestStreak={streakData.longest_streak || 0}
        />
      </div>

      {/* ── 7. MCQ topic accuracy + Time trend ──────────────────────────── */}
      {(hasMCQ || hasTime) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {hasMCQ && (
            <div className="glass p-6 animate-fade-in-up" style={{ animationDelay: '320ms' }}>
              <SectionHeader
                title="MCQ Topic Accuracy"
                badge={
                  <span className="flex items-center gap-1 text-xs"
                    style={{ color: 'var(--color-muted)' }}>
                    <BookOpen size={11} /> MCQ Practice only
                  </span>
                }
              />
              <MCQTopicChart data={mcq_topic_accuracy} />
            </div>
          )}
          {hasTime && (
            <TimePerQuestionTrend data={time_trend} />
          )}
        </div>
      )}

    </div>
  )
}
