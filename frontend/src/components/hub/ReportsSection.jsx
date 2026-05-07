/**
 * ReportsSection — Phase 7: enhanced spreadsheet + analytics hub for interview reports.
 * Self-contained: fetches data via getHubReportsPaginated + getHubReportsSummary.
 * Renders: summary banner, filter bar, paginated table, expandable rows with:
 *   6-axis mini-radar, delivery arc, SWOT, company fit, 30-day plan, CSV export.
 */
import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  ResponsiveContainer, AreaChart, Area, Tooltip, XAxis,
  LineChart, Line, BarChart, Bar, Cell,
} from 'recharts'
import {
  ChevronRight, ChevronDown, ChevronUp, Clock, ArrowUpDown,
  SlidersHorizontal, AlertTriangle, TrendingUp, TrendingDown,
  Activity, Download, Target, Zap, Brain, ArrowUp, ArrowDown,
  Calendar, Filter, BarChart2, Repeat, Award,
} from 'lucide-react'
import { getHubReportsPaginated, getHubReportsSummary, triggerUserBackfill } from '../../lib/api'
import { getReportRoute } from '../../lib/routes'

// ── Constants ─────────────────────────────────────────────────────────────────

const ROUND_LABELS = {
  technical:     'Technical',
  hr:            'HR / Behavioural',
  dsa:           'DSA / Coding',
  mcq_practice:  'MCQ Practice',
  system_design: 'Legacy System Design',
}

const ROUND_COLORS = {
  technical:     { bg: 'rgba(124,58,237,0.15)', text: '#7c3aed' },
  hr:            { bg: 'rgba(236,72,153,0.15)', text: '#ec4899' },
  dsa:           { bg: 'rgba(6,182,212,0.15)',  text: '#06b6d4' },
  mcq_practice:  { bg: 'rgba(245,158,11,0.15)', text: '#f59e0b' },
  system_design: { bg: 'rgba(148,163,184,0.15)', text: '#94a3b8' },
}

const DIFF_COLORS = {
  fresher:     { bg: 'rgba(74,222,128,0.1)',  text: '#4ade80' },
  'mid-level': { bg: 'rgba(250,204,21,0.1)',  text: '#facc15' },
  senior:      { bg: 'rgba(248,113,113,0.1)', text: '#f87171' },
  easy:        { bg: 'rgba(74,222,128,0.1)',  text: '#4ade80' },
  medium:      { bg: 'rgba(250,204,21,0.1)',  text: '#facc15' },
  hard:        { bg: 'rgba(248,113,113,0.1)', text: '#f87171' },
}

const PRIORITY_COLORS = {
  High:   { bg: 'rgba(248,113,113,0.12)', text: '#f87171', border: 'rgba(248,113,113,0.3)' },
  Medium: { bg: 'rgba(250,204,21,0.12)',  text: '#facc15', border: 'rgba(250,204,21,0.3)' },
  Low:    { bg: 'rgba(74,222,128,0.12)',  text: '#4ade80', border: 'rgba(74,222,128,0.3)' },
}

const SWOT_CONFIG = {
  strengths:     { label: 'Strengths',     color: '#4ade80', bg: 'rgba(74,222,128,0.07)' },
  weaknesses:    { label: 'Weaknesses',    color: '#f87171', bg: 'rgba(248,113,113,0.07)' },
  opportunities: { label: 'Opportunities', color: '#06b6d4', bg: 'rgba(6,182,212,0.07)' },
  threats:       { label: 'Threats',       color: '#f59e0b', bg: 'rgba(245,158,11,0.07)' },
}

// ── Utility Helpers ───────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function scoreColor(s) {
  if (s == null) return '#6b7280'
  return s >= 80 ? '#4ade80' : s >= 60 ? '#7c3aed' : '#f87171'
}

function trendColor(dir) {
  if (dir === 'improving')  return '#4ade80'
  if (dir === 'declining')  return '#f87171'
  return '#facc15'
}

// ── Atomic Badge Components ───────────────────────────────────────────────────

function RoundBadge({ round }) {
  if (!round) return null
  const c = ROUND_COLORS[round] || ROUND_COLORS.technical
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap"
      style={{ background: c.bg, color: c.text }}>
      {ROUND_LABELS[round] || round}
    </span>
  )
}

function DiffBadge({ diff }) {
  if (!diff) return null
  const c = DIFF_COLORS[diff] || DIFF_COLORS.medium
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold capitalize"
      style={{ background: c.bg, color: c.text }}>
      {diff}
    </span>
  )
}

function ScoreDisplay({ score, delta }) {
  if (score == null) return <span className="text-muted">—</span>
  const color = scoreColor(score)
  return (
    <div className="flex flex-col items-start">
      <span className="font-bold text-base" style={{ color }}>
        {Number(score).toFixed(1)}
        <span className="text-xs font-normal text-muted">/100</span>
      </span>
      {delta != null && delta !== 0 && (
        <span className="text-xs flex items-center gap-0.5 mt-0.5"
          style={{ color: delta > 0 ? '#4ade80' : '#f87171' }}>
          {delta > 0 ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
          {Math.abs(delta).toFixed(1)} vs last
        </span>
      )}
    </div>
  )
}

// ── Mini 6-Axis Radar ─────────────────────────────────────────────────────────

// Maps backend six_axis_radar keys → short display labels.
// Keyed lookup prevents the positional mismatch that Object.values() causes.
const RADAR_AXIS_MAP = {
  'Communication Clarity': 'Clarity',
  'Confidence':            'Confidence',
  'Answer Structure':      'Structure',
  'Pacing':                'Pacing',
  'Relevance':             'Relevance',
  'Example Quality':       'Examples',
}

function MiniRadar({ data }) {
  if (!data) return <span className="text-xs text-muted">No radar data</span>
  const chartData = Object.entries(RADAR_AXIS_MAP).map(([backendKey, label]) => ({
    axis:  label,
    value: data[backendKey] ?? 0,
  }))
  return (
    <ResponsiveContainer width="100%" height={160}>
      <RadarChart data={chartData} outerRadius={55}>
        <PolarGrid stroke="rgba(255,255,255,0.1)" />
        <PolarAngleAxis
          dataKey="axis"
          tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.5)' }}
        />
        <Radar dataKey="value" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.2} dot={false} />
      </RadarChart>
    </ResponsiveContainer>
  )
}

// ── Mini Delivery Consistency Arc ─────────────────────────────────────────────

function MiniDeliveryArc({ data }) {
  if (!data?.arc_plot?.length) return <span className="text-xs text-muted">No delivery data</span>
  const chartData = data.arc_plot.map((v, i) => ({ q: `Q${i + 1}`, c: v }))
  return (
    <ResponsiveContainer width="100%" height={80}>
      <LineChart data={chartData}>
        <XAxis dataKey="q" tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 10 }}
          formatter={v => [`${v}%`, 'Confidence']}
        />
        <Line type="monotone" dataKey="c" stroke="#a78bfa" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ── Mini Filler Heatmap ───────────────────────────────────────────────────────

function MiniFillerHeatmap({ data }) {
  if (!data?.length) return <span className="text-xs text-muted">No filler data</span>
  return (
    <ResponsiveContainer width="100%" height={80}>
      <BarChart data={data} barSize={12}>
        <XAxis dataKey="question_label" tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 10 }}
          formatter={v => [v, 'Fillers']}
        />
        <Bar dataKey="filler_count" radius={2}>
          {data.map((_, i) => (
            <Cell key={i} fill={`rgba(248,113,113,${0.3 + (i / data.length) * 0.5})`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── SWOT Grid ─────────────────────────────────────────────────────────────────

function SwotGrid({ swot }) {
  if (!swot) return null
  return (
    <div className="grid grid-cols-2 gap-2">
      {Object.entries(SWOT_CONFIG).map(([key, cfg]) => (
        <div key={key} className="rounded-lg p-2.5"
          style={{ background: cfg.bg, border: `1px solid ${cfg.color}22` }}>
          <p className="text-xs font-bold mb-1" style={{ color: cfg.color }}>{cfg.label}</p>
          {(swot[key] || []).map((item, i) => (
            <p key={i} className="text-xs text-muted leading-snug">• {item}</p>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Company Fit Panel ─────────────────────────────────────────────────────────

function CompanyFitPanel({ data }) {
  if (!data) return null
  const prob = data.pass_probability ?? 0
  const probColor = prob >= 60 ? '#4ade80' : prob >= 30 ? '#facc15' : '#f87171'
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-sm">{data.target_company || 'Company'}</span>
        <span className="text-xs px-2 py-0.5 rounded-full font-bold"
          style={{ background: `${probColor}20`, color: probColor }}>
          {prob}% pass probability
        </span>
      </div>
      {/* Probability bar */}
      <div className="h-1.5 rounded-full w-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <div className="h-1.5 rounded-full transition-all duration-700"
          style={{ width: `${prob}%`, background: probColor }} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: 'Required', val: data.bar_score_required, color: '#f59e0b' },
          { label: 'Your Score', val: data.your_score, color: scoreColor(data.your_score) },
          { label: 'Gap', val: data.gap_to_clear != null ? (data.gap_to_clear > 0 ? `+${data.gap_to_clear}` : data.gap_to_clear) : null, color: data.gap_to_clear > 0 ? '#4ade80' : '#f87171' },
        ].map(({ label, val, color }) => (
          <div key={label} className="rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <p className="text-xs text-muted">{label}</p>
            <p className="font-bold text-sm" style={{ color }}>{val ?? '—'}</p>
          </div>
        ))}
      </div>
      {data.culture_gaps?.length > 0 && (
        <div>
          <p className="text-xs text-muted mb-1">Culture gaps</p>
          <div className="flex flex-wrap gap-1">
            {data.culture_gaps.slice(0, 3).map((g, i) => (
              <span key={i} className="text-xs px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
                {typeof g === 'object' ? g.gap || g.trait || JSON.stringify(g) : g}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Skills to Work On ─────────────────────────────────────────────────────────

function SkillCards({ skills }) {
  if (!skills?.length) return null
  return (
    <div className="space-y-2">
      {skills.slice(0, 4).map((s, i) => {
        const cfg = PRIORITY_COLORS[s.priority] || PRIORITY_COLORS.Medium
        return (
          <div key={i} className="rounded-lg p-2.5 flex gap-2"
            style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-xs">{s.skill}</span>
                <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                  style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}>
                  {s.priority}
                </span>
              </div>
              {s.reason && <p className="text-xs text-muted mt-0.5">{s.reason}</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── 30-Day Plan Accordion ─────────────────────────────────────────────────────

function RoadmapAccordion({ plan }) {
  const [openWeek, setOpenWeek] = useState(null)
  if (!plan) return null
  const weeks = ['week_1', 'week_2', 'week_3', 'week_4']
  const weekLabels = ['Week 1 — Critical Gaps', 'Week 2 — Deepen', 'Week 3 — Apply', 'Week 4 — Mock Practice']
  return (
    <div className="space-y-1">
      {weeks.map((wk, wi) => {
        const tasks = plan[wk] || []
        if (!tasks.length) return null
        const isOpen = openWeek === wk
        return (
          <div key={wk} className="rounded-lg overflow-hidden"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
            <button
              onClick={() => setOpenWeek(isOpen ? null : wk)}
              className="w-full flex items-center justify-between px-3 py-2 text-left transition-colors"
              style={{ background: isOpen ? 'rgba(124,58,237,0.1)' : 'rgba(255,255,255,0.03)' }}>
              <span className="text-xs font-semibold" style={{ color: isOpen ? '#7c3aed' : 'var(--color-text)' }}>
                {weekLabels[wi]}
              </span>
              {isOpen ? <ChevronUp size={12} className="text-muted" /> : <ChevronDown size={12} className="text-muted" />}
            </button>
            {isOpen && (
              <div className="px-3 py-2 space-y-2" style={{ background: 'rgba(255,255,255,0.02)' }}>
                {tasks.map((t, ti) => (
                  <div key={ti} className="text-xs space-y-0.5">
                    <p className="font-semibold">{t.topic}</p>
                    {t.goal && <p className="text-muted">{t.goal}</p>}
                    {t.task && <p style={{ color: '#a78bfa' }}>→ {t.task}</p>}
                    <div className="flex items-center gap-3 text-muted pt-0.5">
                      {t.resource && <span>📚 {t.resource}</span>}
                      {t.hours && <span>⏱ {t.hours}h</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Expanded Row Content ──────────────────────────────────────────────────────

function ExpandedRow({ row }) {
  const [section, setSection] = useState('overview')
  const radar    = row.six_axis_radar
  const delivery = row.delivery_consistency
  const heatmap  = row.filler_heatmap
  const swot     = row.swot
  const cFit     = row.company_fit
  const skills   = row.skills_to_work_on
  const plan     = row.thirty_day_plan
  const patterns = row.pattern_groups
  const bsFlag   = row.bs_flag

  const tabs = [
    { id: 'overview',  label: 'Overview' },
    { id: 'voice',     label: 'Voice Analysis' },
    { id: 'company',   label: 'Company Fit' },
    { id: 'playbook',  label: '30-Day Plan' },
  ]

  return (
    <div className="px-4 pb-4 pt-2 space-y-3 animate-fade-in-up">
      {/* Sub-tab bar */}
      <div className="flex gap-1 p-0.5 rounded-lg w-fit"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        {tabs.map(t => (
          <button key={t.id}
            onClick={() => setSection(t.id)}
            className="px-3 py-1 rounded-md text-xs font-medium transition-all duration-150"
            style={section === t.id
              ? { background: 'rgba(124,58,237,0.3)', color: '#a78bfa' }
              : { color: 'var(--color-muted)' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {section === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 6-axis radar */}
          <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              6-Axis Communication Radar
            </p>
            <MiniRadar data={radar} />
          </div>

          {/* SWOT */}
          <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">SWOT</p>
            {swot ? <SwotGrid swot={swot} /> : <p className="text-xs text-muted">No SWOT data</p>}
          </div>

          {/* Root cause patterns */}
          {patterns?.length > 0 && (
            <div className="md:col-span-2">
              <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Root Cause Patterns</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {patterns.slice(0, 4).map((p, i) => (
                  <div key={i} className="rounded-lg p-2.5"
                    style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                    <p className="text-xs font-semibold" style={{ color: '#f59e0b' }}>{p.pattern}</p>
                    {p.core_gap && <p className="text-xs text-muted mt-0.5">Gap: {p.core_gap}</p>}
                    {p.severity && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full mt-1 inline-block"
                        style={{
                          background: p.severity === 'high' ? 'rgba(248,113,113,0.15)' : 'rgba(250,204,21,0.15)',
                          color: p.severity === 'high' ? '#f87171' : '#facc15',
                        }}>
                        {p.severity}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* BS flag */}
          {bsFlag?.detected && (
            <div className="md:col-span-2 rounded-lg p-3"
              style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
              <p className="text-xs font-bold text-red-400 flex items-center gap-1">
                <AlertTriangle size={12} /> Evasion / Rambling Detected
              </p>
              {bsFlag.questions?.length > 0 && (
                <p className="text-xs text-muted mt-1">
                  Questions: {bsFlag.questions.join(', ')}
                </p>
              )}
              {bsFlag.summary && <p className="text-xs text-muted mt-1">{bsFlag.summary}</p>}
            </div>
          )}
        </div>
      )}

      {/* ── Voice Analysis tab ── */}
      {section === 'voice' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Delivery Consistency Arc
            </p>
            {delivery ? <MiniDeliveryArc data={delivery} /> : <p className="text-xs text-muted">No delivery data</p>}
            {delivery?.verdict && (
              <p className="text-xs mt-1" style={{ color: delivery.verdict === 'Strong' ? '#4ade80' : delivery.verdict === 'Average' ? '#facc15' : '#f87171' }}>
                {delivery.verdict} — Stamina score {delivery.stamina_score ?? '—'}%
              </p>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Filler Word Heatmap
            </p>
            {heatmap?.length > 0 ? <MiniFillerHeatmap data={heatmap} /> : <p className="text-xs text-muted">No filler data</p>}
          </div>
          {/* Skills to work on */}
          {skills?.length > 0 && (
            <div className="md:col-span-2">
              <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Skills to Work On</p>
              <SkillCards skills={skills} />
            </div>
          )}
        </div>
      )}

      {/* ── Company Fit tab ── */}
      {section === 'company' && (
        <div>
          {cFit ? (
            <div className="space-y-4">
              <CompanyFitPanel data={cFit} />
              {cFit.next_round_vulnerabilities?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                    Next-Round Vulnerabilities
                  </p>
                  <div className="space-y-1">
                    {cFit.next_round_vulnerabilities.map((v, i) => (
                      <div key={i} className="rounded p-2 text-xs"
                        style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.15)' }}>
                        {typeof v === 'object' ? v.topic || v.vulnerability || JSON.stringify(v) : v}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {cFit.company_specific_prep?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Company Prep Tips</p>
                  <div className="space-y-1">
                    {cFit.company_specific_prep.slice(0, 4).map((t, i) => (
                      <p key={i} className="text-xs text-muted">• {typeof t === 'object' ? t.tip || JSON.stringify(t) : t}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted">No company fit analysis available. Set a target company in your profile to unlock this.</p>
          )}
        </div>
      )}

      {/* ── 30-Day Plan tab ── */}
      {section === 'playbook' && (
        <div className="space-y-4">
          {plan ? (
            <RoadmapAccordion plan={plan} />
          ) : (
            <p className="text-xs text-muted">No 30-day plan generated yet.</p>
          )}
          {/* Follow-up questions preview */}
          {row.follow_up_questions?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                Likely Follow-Up Questions
              </p>
              <div className="space-y-2">
                {row.follow_up_questions.slice(0, 3).map((q, i) => (
                  <div key={i} className="rounded-lg p-2.5"
                    style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)' }}>
                    <p className="text-xs font-semibold">{q.question}</p>
                    {q.why_asked && <p className="text-xs text-muted mt-0.5">{q.why_asked}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {row.next_interview_blueprint && (
            <div className="rounded-lg p-3"
              style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)' }}>
              <p className="text-xs font-semibold text-cyan-400 mb-1">Recommended Next Session</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-0.5 rounded-full" style={{ background: 'rgba(6,182,212,0.15)', color: '#06b6d4' }}>
                  {row.next_interview_blueprint.round_type}
                </span>
                <span className="px-2 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>
                  {row.next_interview_blueprint.difficulty}
                </span>
                <span className="px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--color-muted)' }}>
                  {row.next_interview_blueprint.timer_mins}min
                </span>
              </div>
              {row.next_interview_blueprint.reason && (
                <p className="text-xs text-muted mt-1">{row.next_interview_blueprint.reason}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Quick-link to full report */}
      <div className="pt-1 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <Link to={getReportRoute(row.session_id)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold transition-colors"
          style={{ color: '#7c3aed' }}>
          Open Full Report <ChevronRight size={12} />
        </Link>
      </div>
    </div>
  )
}

// ── Summary Banner ────────────────────────────────────────────────────────────

function SummaryBanner({ summary }) {
  if (!summary) return null
  const {
    total_sessions = 0,
    avg_score = 0,
    best_score = 0,
    most_recent_grade,
    score_trend = [],
    skill_decay_alerts = [],
    repeated_offenders = [],
    growth_trajectory,
  } = summary

  const trendData = score_trend.map((s, i) => ({ i, s }))

  return (
    <div className="rounded-xl mb-6 p-4 space-y-4"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>

      {/* Top stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Sessions', value: total_sessions, icon: Activity, color: '#7c3aed' },
          { label: 'Avg Score',      value: avg_score ? `${Number(avg_score).toFixed(1)}/100` : '—', icon: BarChart2, color: '#06b6d4' },
          { label: 'Best Score',     value: best_score ? `${Number(best_score).toFixed(1)}/100` : '—', icon: Award,   color: '#4ade80' },
          {
            label: 'Trajectory',
            value: growth_trajectory?.trend_direction || '—',
            icon: growth_trajectory?.trend_direction === 'improving' ? TrendingUp : TrendingDown,
            color: trendColor(growth_trajectory?.trend_direction),
          },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-lg p-3 flex items-center gap-2.5"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="p-2 rounded-lg flex-shrink-0" style={{ background: `${color}15` }}>
              <Icon size={14} style={{ color }} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted">{label}</p>
              <p className="text-sm font-bold capitalize">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Score trend sparkline */}
      {trendData.length > 1 && (
        <div>
          <p className="text-xs text-muted mb-1.5">Score Trend</p>
          <ResponsiveContainer width="100%" height={50}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 10 }}
                formatter={v => [`${v}`, 'Score']}
                labelFormatter={() => ''}
              />
              <Area type="monotone" dataKey="s" stroke="#7c3aed" fill="url(#trendGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Alerts row */}
      {(skill_decay_alerts.length > 0 || repeated_offenders.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {skill_decay_alerts.slice(0, 3).map((a, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg"
              style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', color: '#f87171' }}>
              <TrendingDown size={11} />
              Decay: {typeof a === 'object' ? a.axis || a.skill || JSON.stringify(a) : a}
            </div>
          ))}
          {repeated_offenders.slice(0, 3).map((o, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg"
              style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b' }}>
              <Repeat size={11} />
              Recurring: {typeof o === 'object' ? o.area || o.skill || JSON.stringify(o) : o}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── CSV Export ────────────────────────────────────────────────────────────────

function exportCSV(rows) {
  const headers = ['Date', 'Round', 'Difficulty', 'Score', 'Pass Probability', 'What Went Wrong', 'Weak Parts', 'Company', 'Role', 'Session Length']
  const lines = [
    headers.join(','),
    ...rows.map(r => [
      formatDate(r.date),
      ROUND_LABELS[r.round_type] || r.round_type || '',
      r.difficulty || '',
      r.overall_score != null ? Number(r.overall_score).toFixed(1) : '',
      r.company_fit?.pass_probability ?? '',
      (r.what_went_wrong || '').replace(/,/g, ';'),
      (r.weak_parts || []).join('; '),
      r.target_company || '—',
      r.target_role || '—',
      r.timer_minutes ? `${r.timer_minutes} min` : '—',
    ].map(v => `"${v}"`).join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `interview-reports-${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Main Component ────────────────────────────────────────────────────────────

const PAGE_LIMIT = 15

export default function ReportsSection() {
  const [rows,    setRows]    = useState([])
  const [total,   setTotal]   = useState(0)
  const [page,    setPage]    = useState(1)
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState(null)
  const [expanded, setExpanded] = useState(new Set())
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState({
    roundType: '',
    difficulty: '',
    sortBy: 'date',
    sortDir: 'desc',
    dateFrom: '',
    dateTo: '',
    minScore: '',
    maxScore: '',
  })

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT))

  // Fetch summary + silently trigger backfill for old sessions on mount
  useEffect(() => {
    getHubReportsSummary()
      .then(res => setSummary(res?.data ?? null))
      .catch(() => {})

    // Kick off background report generation for any session that was completed
    // before the caching fix.  Fire-and-forget — errors are swallowed inside
    // triggerUserBackfill so this never breaks the hub.
    triggerUserBackfill()
  }, [])

  // Fetch rows whenever filters or page change
  const fetchRows = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getHubReportsPaginated({
        roundType:  filters.roundType  || undefined,
        difficulty: filters.difficulty || undefined,
        sortBy:     filters.sortBy,
        sortDir:    filters.sortDir,
        page,
        limit:      PAGE_LIMIT,
        dateFrom:   filters.dateFrom   || undefined,
        dateTo:     filters.dateTo     || undefined,
        minScore:   filters.minScore !== '' ? Number(filters.minScore) : undefined,
        maxScore:   filters.maxScore !== '' ? Number(filters.maxScore) : undefined,
      })
      const d = res?.data
      setRows(d?.rows ?? [])
      setTotal(d?.total ?? 0)
    } catch (_) {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [filters, page])

  useEffect(() => { fetchRows() }, [fetchRows])

  const setFilter = (key, val) => {
    setPage(1)
    setFilters(prev => ({ ...prev, [key]: val }))
  }

  const toggleExpand = (id) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const ROUND_TABS = [
    { id: '',              label: 'All' },
    { id: 'technical',     label: 'Technical' },
    { id: 'hr',            label: 'HR' },
    { id: 'dsa',           label: 'DSA' },
    { id: 'mcq_practice',  label: 'MCQ Practice' },
  ]

  return (
    <div className="animate-fade-in-up">

      {/* Summary Banner */}
      <SummaryBanner summary={summary} />

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="mb-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Round type tabs */}
          <div className="flex gap-1 p-1 rounded-xl overflow-x-auto"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)' }}>
            {ROUND_TABS.map(tab => (
              <button key={tab.id}
                onClick={() => setFilter('roundType', tab.id)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all duration-150"
                style={filters.roundType === tab.id
                  ? { background: '#7c3aed', color: '#fff' }
                  : { color: 'var(--color-muted)' }}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Sort toggle */}
          <button
            onClick={() => setFilter('sortDir', filters.sortDir === 'desc' ? 'asc' : 'desc')}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg transition-all duration-150"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
            <ArrowUpDown size={12} />
            {filters.sortDir === 'desc' ? 'Newest First' : 'Oldest First'}
          </button>

          {/* Advanced filters toggle */}
          <button
            onClick={() => setShowFilters(v => !v)}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg transition-all duration-150"
            style={{
              background: showFilters ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${showFilters ? 'rgba(124,58,237,0.4)' : 'var(--color-border)'}`,
              color: showFilters ? '#7c3aed' : 'var(--color-muted)',
            }}>
            <Filter size={12} />
            Filters
          </button>

          {/* Export CSV */}
          <button
            onClick={() => exportCSV(rows)}
            disabled={rows.length === 0}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg transition-all duration-150 ml-auto disabled:opacity-40"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
            <Download size={12} />
            Export CSV
          </button>

          <span className="text-xs text-muted">{total} report{total !== 1 ? 's' : ''}</span>
        </div>

        {/* Advanced filters panel */}
        {showFilters && (
          <div className="flex flex-wrap gap-3 p-3 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)' }}>
            <select value={filters.difficulty}
              onChange={e => setFilter('difficulty', e.target.value)}
              className="text-xs rounded-lg px-3 py-2 font-medium outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              <option value="">All Difficulties</option>
              <option value="fresher">Fresher</option>
              <option value="mid-level">Mid-Level</option>
              <option value="senior">Senior</option>
            </select>
            <input type="date" value={filters.dateFrom}
              onChange={e => setFilter('dateFrom', e.target.value)}
              className="text-xs rounded-lg px-3 py-2 outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              placeholder="From date" />
            <input type="date" value={filters.dateTo}
              onChange={e => setFilter('dateTo', e.target.value)}
              className="text-xs rounded-lg px-3 py-2 outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              placeholder="To date" />
            <input type="number" value={filters.minScore} min="0" max="100"
              onChange={e => setFilter('minScore', e.target.value)}
              className="text-xs rounded-lg px-3 py-2 w-24 outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              placeholder="Min score" />
            <input type="number" value={filters.maxScore} min="0" max="100"
              onChange={e => setFilter('maxScore', e.target.value)}
              className="text-xs rounded-lg px-3 py-2 w-24 outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              placeholder="Max score" />
            <button onClick={() => {
              setPage(1)
              setFilters({ roundType: '', difficulty: '', sortBy: 'date', sortDir: 'desc', dateFrom: '', dateTo: '', minScore: '', maxScore: '' })
            }}
              className="text-xs px-3 py-2 rounded-lg"
              style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)' }}>
              Clear
            </button>
          </div>
        )}
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="glass p-12 text-center">
          <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-muted text-sm">Loading reports…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="glass p-12 text-center">
          <SlidersHorizontal size={32} className="text-muted mx-auto mb-3" />
          <p className="text-muted">No reports found. Complete an interview to see results here.</p>
        </div>
      ) : (
        <div className="glass overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th className="w-8" />
                  {['Date', 'Round', 'Difficulty', 'Score', 'Radar', 'Company Fit', 'What Went Wrong', 'Company', 'Role', 'Session Length', ''].map(h => (
                    <th key={h}
                      className="text-left text-xs text-muted uppercase tracking-wider px-4 py-3 font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isOpen = expanded.has(row.session_id)
                  const radar  = row.six_axis_radar
                  const cFit   = row.company_fit
                  const skillDecay = row.skill_decay
                  return (
                    <>
                      <tr key={row.session_id}
                        className="hover:bg-white/[0.02] transition-colors cursor-pointer"
                        style={{ borderBottom: '1px solid var(--color-border)' }}
                        onClick={() => toggleExpand(row.session_id)}>

                        {/* Expand icon */}
                        <td className="pl-3 py-3.5">
                          {isOpen
                            ? <ChevronUp size={14} className="text-muted" />
                            : <ChevronDown size={14} className="text-muted" />}
                        </td>

                        {/* Date */}
                        <td className="px-4 py-3.5 text-muted whitespace-nowrap">
                          <div className="flex items-center gap-1.5 text-xs">
                            <Clock size={11} />
                            {formatDate(row.date)}
                          </div>
                        </td>

                        {/* Round */}
                        <td className="px-4 py-3.5">
                          <RoundBadge round={row.round_type} />
                        </td>

                        {/* Difficulty */}
                        <td className="px-4 py-3.5">
                          <DiffBadge diff={row.difficulty} />
                        </td>

                        {/* Score + delta */}
                        <td className="px-4 py-3.5">
                          {row.overall_score == null ? (
                            <span
                              title="Report is being generated in the background. Click 'Generate' to create it now."
                              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
                              style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}>
                              ⏳ Pending
                            </span>
                          ) : (
                            <ScoreDisplay score={row.overall_score} delta={row.improvement_vs_last?.delta} />
                          )}
                        </td>

                        {/* Mini radar snapshot — show first 3 axes using canonical key order */}
                        <td className="px-4 py-3.5">
                          {radar ? (
                            <div className="flex gap-1 flex-wrap max-w-[140px]">
                              {Object.entries(RADAR_AXIS_MAP).slice(0, 3).map(([backendKey, label]) => {
                                const v = radar[backendKey] ?? 0
                                return (
                                  <span key={label} className="text-xs px-1.5 py-0.5 rounded"
                                    style={{
                                      background: v >= 75 ? 'rgba(74,222,128,0.1)' : v >= 55 ? 'rgba(250,204,21,0.1)' : 'rgba(248,113,113,0.1)',
                                      color:      v >= 75 ? '#4ade80' : v >= 55 ? '#facc15' : '#f87171',
                                    }}>
                                    {v}
                                  </span>
                                )
                              })}
                            </div>
                          ) : (
                            <span className="text-muted text-xs">—</span>
                          )}
                        </td>

                        {/* Company fit pass probability */}
                        <td className="px-4 py-3.5">
                          {cFit?.pass_probability != null ? (
                            <div className="space-y-1">
                              <span className="text-xs font-semibold"
                                style={{ color: cFit.pass_probability >= 60 ? '#4ade80' : cFit.pass_probability >= 30 ? '#facc15' : '#f87171' }}>
                                {cFit.pass_probability}%
                              </span>
                              <p className="text-xs text-muted">{cFit.target_company}</p>
                            </div>
                          ) : (
                            <span className="text-muted text-xs">—</span>
                          )}
                        </td>

                        {/* What went wrong */}
                        <td className="px-4 py-3.5 text-muted max-w-[200px]">
                          {row.what_went_wrong ? (
                            <span className="line-clamp-2 text-xs">
                              {row.what_went_wrong.slice(0, 80)}{row.what_went_wrong.length > 80 ? '…' : ''}
                            </span>
                          ) : <span className="text-xs">—</span>}
                        </td>

                        {/* Company */}
                        <td className="px-4 py-3.5 text-xs whitespace-nowrap max-w-[130px]">
                          <span className="truncate block" title={row.target_company || ''}>
                            {row.target_company || <span className="text-muted">—</span>}
                          </span>
                        </td>

                        {/* Role */}
                        <td className="px-4 py-3.5 text-xs whitespace-nowrap max-w-[150px]">
                          <span className="truncate block" title={row.target_role || ''}>
                            {row.target_role || <span className="text-muted">—</span>}
                          </span>
                        </td>

                        {/* Session Length */}
                        <td className="px-4 py-3.5 text-xs text-muted whitespace-nowrap text-center">
                          {row.timer_minutes ? `${row.timer_minutes} min` : '—'}
                        </td>

                        {/* Action — stop propagation so row click doesn't fire */}
                        <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                          {row.overall_score != null ? (
                            <Link to={getReportRoute(row.session_id)}
                              className="flex items-center gap-0.5 text-xs font-semibold whitespace-nowrap transition-colors"
                              style={{ color: '#7c3aed' }}>
                              Report <ChevronRight size={12} />
                            </Link>
                          ) : (
                            <Link to={getReportRoute(row.session_id)}
                              title="Click to generate this report now (one-time, ~45 seconds)"
                              className="flex items-center gap-0.5 text-xs font-semibold whitespace-nowrap transition-colors"
                              style={{ color: '#f59e0b' }}>
                              Generate <ChevronRight size={12} />
                            </Link>
                          )}
                        </td>
                      </tr>

                      {/* Expanded row */}
                      {isOpen && (
                        <tr key={`${row.session_id}-expanded`}
                          style={{ borderBottom: '1px solid var(--color-border)', background: 'rgba(124,58,237,0.04)' }}>
                          <td colSpan={10}>
                            <ExpandedRow row={row} />
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3"
              style={{ borderTop: '1px solid var(--color-border)' }}>
              <span className="text-xs text-muted">
                Page {page} of {totalPages} · {total} total
              </span>
              <div className="flex gap-1">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-30 transition-all"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                  Previous
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const pg = totalPages <= 5 ? i + 1 : Math.max(1, page - 2) + i
                  if (pg > totalPages) return null
                  return (
                    <button key={pg}
                      onClick={() => setPage(pg)}
                      className="px-3 py-1.5 rounded-lg text-xs transition-all"
                      style={pg === page
                        ? { background: '#7c3aed', color: '#fff' }
                        : { background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                      {pg}
                    </button>
                  )
                })}
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-30 transition-all"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
