/**
 * Report.jsx — Ultra-Report: The platform's flagship post-interview report.
 *
 * Sections (in order):
 *  1. Header             — round, company, difficulty, date, grade badge
 *  2. Score Hero         — score ring, hire rec, stat strip, summary
 *  3. Charts Row         — Skills Radar | Score Timeline | Hire Signal Spider
 *  4. CV Honesty         — speedometer gauge + per-claim audit table
 *  5. Market Intelligence— live company news & hiring signals
 *  6. Failure Patterns   — systemic gap analysis (warning orange)
 *  7. Strong / Weak Areas
 *  8. Per-Question Accordion
 *  9. 4-Week Study Roadmap
 * 10. Mock-Ready chips
 * 11. Interview Tips
 * 12. Footer             — PDF + New Interview
 */

import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate }       from 'react-router-dom'
import toast                            from 'react-hot-toast'
import './print.css'

import RadarChartComponent from '../components/charts/RadarChart'
import AreaTimeline        from '../components/charts/AreaTimeline'
import HireSignalRadar     from '../components/charts/HireSignalRadar'
import CVHonestyGauge     from '../components/charts/CVHonestyGauge'
import LoadingSpinner      from '../components/LoadingSpinner'
import { COMPANY_SECTORS, SECTOR_CGPA_WEIGHT } from '../constants/companies'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts'

// ── Auth helper ───────────────────────────────────────────────────────────────
function getToken() {
  try {
    const raw = localStorage.getItem('sb-session') || localStorage.getItem('access_token') || ''
    if (raw.startsWith('{')) return JSON.parse(raw)?.access_token || ''
    return raw
  } catch { return '' }
}
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'
async function apiFetch(path, opts = {}) {
  const token = getToken()
  const res   = await fetch(`${BASE}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...opts,
  })
  return res.json()
}

// ── Colour palettes ───────────────────────────────────────────────────────────
const GRADE_COLORS = {
  'A+': { bg: '#dcfce7', text: '#15803d', border: '#86efac' },
  'A':  { bg: '#dcfce7', text: '#16a34a', border: '#86efac' },
  'B+': { bg: '#dbeafe', text: '#1d4ed8', border: '#93c5fd' },
  'B':  { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' },
  'C+': { bg: '#fefce8', text: '#a16207', border: '#fde68a' },
  'C':  { bg: '#fefce8', text: '#b45309', border: '#fde68a' },
  'D':  { bg: '#fef2f2', text: '#dc2626', border: '#fca5a5' },
}
const HIRE_COLORS = {
  'Strong Yes': '#10b981',
  'Yes':        '#3b82f6',
  'Maybe':      '#f59e0b',
  'No':         '#ef4444',
}
const VERDICT_COL = {
  Excellent:           '#10b981',
  Good:                '#3b82f6',
  Satisfactory:        '#f59e0b',
  'Needs Improvement': '#f97316',
  Poor:                '#ef4444',
}
const PRIORITY_STYLE = {
  High:   { bg: '#fef2f2', text: '#dc2626', border: '#fca5a5' },
  Medium: { bg: '#fffbeb', text: '#d97706', border: '#fde68a' },
  Low:    { bg: '#f0fdf4', text: '#16a34a', border: '#86efac' },
}
const DEMO_LEVEL_COL = {
  'Expert':           '#10b981',
  'Intermediate':     '#3b82f6',
  'Beginner':         '#f59e0b',
  'Not Demonstrated': '#ef4444',
  'Not Tested':       '#6b7280',
}
const ROUND_LABELS = { technical: 'Technical', hr: 'HR / Behavioural', dsa: 'DSA / Coding', mcq_practice: 'MCQ Practice', system_design: 'Legacy System Design' }

function scoreColor(s) {
  if (s >= 80) return '#10b981'
  if (s >= 60) return '#3b82f6'
  if (s >= 40) return '#f59e0b'
  return '#ef4444'
}

// ── Reusable sub-components ──────────────────────────────────────────────────

function GradeBadge({ grade }) {
  const c = GRADE_COLORS[grade] || GRADE_COLORS['C']
  return (
    <span className="text-3xl font-black px-5 py-2 rounded-2xl flex-shrink-0"
      style={{ background: c.bg, color: c.text, border: `2px solid ${c.border}` }}>
      {grade}
    </span>
  )
}

function ScoreRing({ score }) {
  const r    = 68
  const circ = 2 * Math.PI * r
  const pct  = Math.min(100, Math.max(0, score))
  const col  = scoreColor(pct)
  return (
    <svg width="180" height="180" viewBox="0 0 180 180">
      <circle cx="90" cy="90" r={r} fill="none" stroke="var(--color-border)" strokeWidth="12" />
      <circle cx="90" cy="90" r={r} fill="none"
        stroke={col} strokeWidth="12"
        strokeDasharray={`${circ * pct / 100} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 90 90)"
        style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(.4,2,.6,1)' }}
      />
      <text x="90" y="82" textAnchor="middle" fill={col} fontSize="34" fontWeight="800">{score}</text>
      <text x="90" y="104" textAnchor="middle" fill="var(--color-muted-light)" fontSize="13">/100</text>
    </svg>
  )
}

function SectionCard({ title, icon, children, id }) {
  return (
    <section id={id} className="glass p-6 animate-fade-in-up">
      <h2 className="text-lg font-bold mb-5 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
        {icon && <span>{icon}</span>} {title}
      </h2>
      {children}
    </section>
  )
}

function CategoryBar({ item }) {
  const col = scoreColor(item.score)
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{item.category}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: `${col}18`, color: col, border: `1px solid ${col}40` }}>
            {item.verdict}
          </span>
          <span className="text-sm font-bold tabular-nums" style={{ color: col }}>{item.score}</span>
        </div>
      </div>
      <div className="rounded-full h-2.5 overflow-hidden" style={{ background: 'var(--color-surface-3)' }}>
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${item.score}%`, background: col }} />
      </div>
      {item.comment && <p className="text-xs mt-1.5" style={{ color: 'var(--color-muted)' }}>{item.comment}</p>}
    </div>
  )
}

function QAccordion({ item, index }) {
  const [open, setOpen] = useState(false)
  const score  = item.score ?? 0
  const pct    = (score / 10) * 100
  const col    = scoreColor(pct)
  const vColor = VERDICT_COL[item.verdict] || '#64748b'
  return (
    <div className="rounded-xl overflow-hidden transition-all mb-2" style={{ border: '1px solid var(--color-border)' }}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
        style={{ background: open ? 'var(--color-accent-light)' : 'var(--color-surface)' }}>
        <span className="text-xs font-bold w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--color-accent-light)', color: 'var(--color-accent)' }}>
          Q{index + 1}
        </span>
        {item.category && (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
            style={{ background: 'rgba(91,94,246,0.08)', color: 'var(--color-accent)', border: '1px solid rgba(91,94,246,0.2)' }}>
            {item.category}
          </span>
        )}
        <span className="flex-1 text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
          {item.question_text || `Question ${index + 1}`}
        </span>
        <span className="text-xs px-2.5 py-1 rounded-lg font-semibold flex-shrink-0"
          style={{ color: vColor, background: `${vColor}15`, border: `1px solid ${vColor}35` }}>
          {item.verdict || '—'}
        </span>
        <span className="font-bold text-sm flex-shrink-0 tabular-nums" style={{ color: col, minWidth: 36, textAlign: 'right' }}>
          {score}/10
        </span>
        <span style={{ color: 'var(--color-muted-light)', fontSize: 16, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▾</span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-3 space-y-3" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
          <div>
            <div className="flex justify-between text-xs mb-1.5" style={{ color: 'var(--color-muted)' }}>
              <span>Score</span><span style={{ color: col, fontWeight: 700 }}>{pct.toFixed(0)}%</span>
            </div>
            <div className="rounded-full h-2" style={{ background: 'var(--color-surface-3)' }}>
              <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: col }} />
            </div>
          </div>
          {item.answer_summary && (
            <div className="rounded-xl p-3 text-sm italic"
              style={{ background: 'rgba(91,94,246,0.04)', border: '1px solid rgba(91,94,246,0.1)', color: 'var(--color-muted)' }}>
              <span className="not-italic font-semibold text-xs block mb-1" style={{ color: 'var(--color-accent)' }}>Your Answer Summary</span>
              "{item.answer_summary}"
            </div>
          )}
          {item.key_insight && (
            <div className="rounded-xl p-3 text-sm"
              style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.15)', color: '#065f46' }}>
              <span className="font-semibold text-xs block mb-1" style={{ color: '#059669' }}>💡 Key Insight</span>
              {item.key_insight}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CVAuditRow({ item, index }) {
  const [open, setOpen] = useState(false)
  const levelColor = DEMO_LEVEL_COL[item.demonstrated_level] || '#6b7280'
  const hasGap = item.gap || item.what_to_study

  return (
    <div className="rounded-xl overflow-hidden mb-2" style={{ border: '1px solid var(--color-border)' }}>
      <button onClick={() => hasGap && setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        style={{ background: 'var(--color-surface)', cursor: hasGap ? 'pointer' : 'default' }}>
        {/* Type badge */}
        <span className="text-xs px-2 py-0.5 rounded font-medium flex-shrink-0"
          style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
          {item.type}
        </span>
        {/* Claim name */}
        <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          {item.claim}
        </span>
        {/* Asked? */}
        <span className="text-xs flex-shrink-0" style={{ color: item.asked ? '#10b981' : '#6b7280' }}>
          {item.asked ? '✓ Asked' : '— Not Asked'}
        </span>
        {/* Level badge */}
        <span className="text-xs px-2.5 py-1 rounded-lg font-semibold flex-shrink-0"
          style={{ color: levelColor, background: `${levelColor}15`, border: `1px solid ${levelColor}35` }}>
          {item.demonstrated_level || 'Not Tested'}
        </span>
        {hasGap && (
          <span style={{ color: 'var(--color-muted-light)', fontSize: 14, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▾</span>
        )}
      </button>
      {open && hasGap && (
        <div className="px-4 pb-4 pt-3 space-y-2" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
          {item.gap && (
            <div className="rounded-lg p-3 text-sm" style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)' }}>
              <span className="text-xs font-semibold block mb-1" style={{ color: '#ef4444' }}>🔍 Gap Identified</span>
              <p style={{ color: '#991b1b' }}>{item.gap}</p>
            </div>
          )}
          {item.what_to_study && (
            <div className="rounded-lg p-3 text-sm" style={{ background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.15)' }}>
              <span className="text-xs font-semibold block mb-1" style={{ color: '#3b82f6' }}>📖 What to Study</span>
              <p style={{ color: '#1e40af' }}>{item.what_to_study}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FailurePatternCard({ pattern }) {
  return (
    <div className="rounded-xl p-4 space-y-2"
      style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.25)' }}>
      <div className="flex items-start gap-3">
        <span className="text-lg flex-shrink-0">⚡</span>
        <div className="flex-1">
          <p className="font-bold text-sm" style={{ color: '#ea580c' }}>{pattern.pattern}</p>
          {pattern.affected_questions?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {pattern.affected_questions.map(q => (
                <span key={q} className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(249,115,22,0.1)', color: '#ea580c', border: '1px solid rgba(249,115,22,0.25)' }}>
                  Q{q}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {pattern.root_cause && (
        <div className="rounded-lg px-3 py-2 text-sm" style={{ background: 'rgba(249,115,22,0.04)' }}>
          <span className="text-xs font-semibold block mb-0.5" style={{ color: '#c2410c' }}>Root Cause</span>
          <p style={{ color: '#9a3412' }}>{pattern.root_cause}</p>
        </div>
      )}
      {pattern.fix && (
        <div className="rounded-lg px-3 py-2 text-sm" style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.1)' }}>
          <span className="text-xs font-semibold block mb-0.5" style={{ color: '#059669' }}>✅ How to Fix</span>
          <p style={{ color: '#065f46' }}>{pattern.fix}</p>
        </div>
      )}
    </div>
  )
}

function RoadmapWeek({ weekKey, items, weekNum }) {
  const weekColors = ['#5b5ef6', '#10b981', '#f59e0b', '#ec4899']
  const col = weekColors[weekNum - 1] || '#5b5ef6'
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${col}30`, minWidth: 220 }}>
      <div className="px-4 py-3 font-bold text-sm" style={{ background: `${col}15`, color: col }}>
        📅 Week {weekNum}
      </div>
      <div className="p-3 space-y-3">
        {items.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No tasks planned.</p>
        )}
        {items.map((item, i) => (
          <div key={i} className="rounded-lg p-3 text-sm space-y-1"
            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
            <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{item.topic}</p>
            {item.goal && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{item.goal}</p>}
            {item.resource && (
              <span className="inline-block text-xs px-2 py-0.5 rounded-full"
                style={{ background: `${col}15`, color: col, border: `1px solid ${col}30` }}>
                📚 {item.resource}
              </span>
            )}
            {item.hours && (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>⏱ ~{item.hours}h</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function BarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value ?? 0
  return (
    <div className="rounded-xl px-3 py-2.5 text-xs shadow-lg"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <p className="font-semibold mb-0.5" style={{ color: 'var(--color-text)' }}>{label}</p>
      <p style={{ color: scoreColor(val) }}>Score: <strong>{val}/10</strong></p>
    </div>
  )
}

// ── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function Report() {
  const { sessionId } = useParams()
  const navigate      = useNavigate()
  const reportRef     = useRef(null)

  const [report,       setReport]       = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)
  const [printing,     setPrinting]     = useState(false)
  const [attemptCount, setAttemptCount] = useState(0)
  const [studentMeta,  setStudentMeta]  = useState(null)
  // CV Audit: toggle between table and gauge view
  const [auditView,    setAuditView]    = useState('table')  // 'table' | 'chart'

  useEffect(() => {
    try {
      const raw = localStorage.getItem('student_meta')
      if (raw) setStudentMeta(JSON.parse(raw))
    } catch {}
  }, [])

  // ── Fetch with polling ────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) { setError('No session ID.'); setLoading(false); return }
    let cancelled = false, attempts = 0
    const MAX = 10

    const load = async () => {
      setLoading(true)
      while (attempts < MAX && !cancelled) {
        attempts++
        if (!cancelled) setAttemptCount(attempts)
        try {
          const res = await apiFetch(`/report/${sessionId}`)
          if (res.success && res.data) {
            const d = res.data
            if (!cancelled) {
              setReport({
                ...d,
                overall_score:       d.overall_score ?? 0,
                grade:               d.grade || _grade(d.overall_score ?? 0),
                hire_recommendation: d.hire_recommendation || _hire(d.overall_score ?? 0),
                radar_scores:        d.radar_scores || {},
                category_breakdown:  d.category_breakdown || [],
                strong_areas:        d.strong_areas || [],
                weak_areas:          d.weak_areas || [],
                red_flags:           d.red_flags || [],
                failure_patterns:    d.failure_patterns || [],
                hire_signal:         d.hire_signal || {},
                cv_audit:            d.cv_audit || { overall_cv_honesty_score: 0, items: [] },
                study_roadmap:       d.study_roadmap || { week_1: [], week_2: [], week_3: [], week_4: [] },
                mock_ready_topics:   d.mock_ready_topics || [],
                not_ready_topics:    d.not_ready_topics || [],
                per_question_analysis: d.per_question_analysis || d.question_scores || [],
                study_recommendations: d.study_recommendations || [],
                interview_tips:      d.interview_tips || [],
                market_intelligence: d.market_intelligence || null,
              })
              setLoading(false)
            }
            return
          }
          if (attempts < MAX) await _wait(2500)
        } catch { await _wait(2500) }
      }
      if (!cancelled) { setError('Report could not be generated.'); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [sessionId])

  function _grade(s) { return s >= 90 ? 'A+' : s >= 80 ? 'A' : s >= 70 ? 'B+' : s >= 60 ? 'B' : s >= 50 ? 'C+' : s >= 40 ? 'C' : 'D' }
  function _hire(s)  { return s >= 85 ? 'Strong Yes' : s >= 70 ? 'Yes' : s >= 50 ? 'Maybe' : 'No' }
  const _wait = ms => new Promise(r => setTimeout(r, ms))

  const handleDownload = () => {
    setPrinting(true)
    toast('📄 Use "Save as PDF" in the print dialog', { duration: 4000, icon: '🖨️' })
    setTimeout(() => { window.print(); setPrinting(false) }, 300)
  }

  // ── Guards ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 pt-20"
      style={{ background: 'var(--color-bg)' }}>
      <LoadingSpinner message="Generating your AI Ultra-Report…" />
      <div className="text-center">
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          {attemptCount > 1 ? `AI is analysing CV + interview… (${attemptCount}/10)` : 'Running 2-stage AI analysis…'}
        </p>
        <div className="flex gap-1.5 justify-center mt-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="w-2 h-2 rounded-full transition-all duration-300"
              style={{ background: i < attemptCount ? 'var(--color-accent)' : 'var(--color-border)' }} />
          ))}
        </div>
      </div>
    </div>
  )

  if (error) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-4 pt-20"
      style={{ background: 'var(--color-bg)' }}>
      <p className="text-5xl">😕</p>
      <p className="text-xl font-bold" style={{ color: 'var(--color-error)' }}>Report Unavailable</p>
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{error}</p>
      <button onClick={() => navigate('/dashboard')} className="btn-primary">Back to Dashboard</button>
    </div>
  )

  if (!report) return null

  const {
    overall_score = 0, grade = 'C', summary = '',
    hire_recommendation = 'Maybe', compared_to_level = '',
    radar_scores = {}, category_breakdown = [],
    strong_areas = [], weak_areas = [], red_flags = [],
    failure_patterns = [], hire_signal = {},
    cv_audit = {}, study_roadmap = {},
    mock_ready_topics = [], not_ready_topics = [],
    per_question_analysis = [], study_recommendations = [],
    interview_tips = [], round_type = 'technical', difficulty = 'medium',
    market_intelligence = null, target_company = '', candidate_name = '',
  } = report

  const roundLabel    = ROUND_LABELS[round_type] || round_type
  const hireCol       = HIRE_COLORS[hire_recommendation] || '#64748b'
  const gc            = GRADE_COLORS[grade] || GRADE_COLORS['C']
  const sessionDate   = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  const barData       = per_question_analysis.map((q, i) => ({ name: `Q${i + 1}`, score: q.score ?? 0 }))
  const cvItems       = cv_audit?.items || []
  const cvScore       = cv_audit?.overall_cv_honesty_score ?? 0
  const cvNote        = cv_audit?.note || ''
  const defended      = cvItems.filter(i => i.answered_well === true).length
  const asked         = cvItems.filter(i => i.asked).length
  const hasCV         = cvItems.length > 0

  return (
    <div ref={reportRef} className="min-h-screen pt-20 pb-12 px-4" style={{ background: 'var(--color-bg)' }}>
      <div className="max-w-5xl mx-auto space-y-6">

        {/* ── 1. HEADER ─────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 no-print animate-fade-in-up">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="badge-purple">{roundLabel}</span>
              <span className="badge-yellow">{difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}</span>
              {target_company && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: 'rgba(16,185,129,0.1)', color: '#059669', border: '1px solid rgba(16,185,129,0.2)' }}>
                  🎯 {target_company}
                </span>
              )}
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{sessionDate}</span>
            </div>
            <h1 className="text-2xl font-black" style={{ color: 'var(--color-text)' }}>
              Interview Performance Report
            </h1>
            {compared_to_level && (
              <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>{compared_to_level}</p>
            )}
          </div>
          <GradeBadge grade={grade} />
        </div>

        {/* ── 2. SCORE HERO ─────────────────────────────────────────────── */}
        <div className="glass p-6 animate-fade-in-up delay-100" style={{ borderTop: `4px solid ${gc.border}` }}>
          <div className="flex flex-col sm:flex-row items-center gap-8">
            <ScoreRing score={overall_score} />
            <div className="flex-1 space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>Overall Score</p>
                <p className="text-5xl font-black tabular-nums" style={{ color: scoreColor(overall_score) }}>
                  {overall_score}<span className="text-2xl font-normal" style={{ color: 'var(--color-muted)' }}>/100</span>
                </p>
              </div>
              {/* Hire Recommendation */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-semibold" style={{ color: 'var(--color-muted)' }}>Hire Recommendation:</span>
                <span className="font-bold text-sm px-3 py-1.5 rounded-xl"
                  style={{ color: hireCol, background: `${hireCol}15`, border: `1px solid ${hireCol}35` }}>
                  {hire_recommendation}
                </span>
              </div>
              {summary && <p className="text-sm leading-relaxed prose-saas">{summary}</p>}
            </div>
          </div>
          {/* Stat strip */}
          <div className="grid grid-cols-4 gap-4 mt-6 pt-5" style={{ borderTop: '1px solid var(--color-border)' }}>
            {[
              { label: 'Questions',  value: per_question_analysis.length || '—' },
              { label: 'Avg Score',  value: per_question_analysis.length
                  ? (per_question_analysis.reduce((a, q) => a + (q.score || 0), 0) / per_question_analysis.length).toFixed(1) + '/10'
                  : '—' },
              { label: 'Grade',      value: grade },
              { label: 'CV Claims',  value: hasCV ? `${defended}/${asked} defended` : 'No CV' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <p className="text-xl font-black" style={{ color: 'var(--color-text)' }}>{s.value}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── 3. CHARTS ROW ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Skills Radar */}
          {Object.keys(radar_scores).length > 0 && (
            <div className="glass p-5 lg:col-span-1">
              <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--color-text)' }}>🎯 Skills Radar</h3>
              <RadarChartComponent radarScores={radar_scores} />
            </div>
          )}

          {/* Score Timeline */}
          {per_question_analysis.length > 1 && (
            <div className="glass p-5 lg:col-span-1">
              <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--color-text)' }}>📈 Score Timeline</h3>
              <AreaTimeline perQuestionAnalysis={per_question_analysis} />
            </div>
          )}

          {/* Hire Signal Spider */}
          {Object.keys(hire_signal).length > 0 && (
            <div className="glass p-5 lg:col-span-1">
              <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--color-text)' }}>🏅 Hire Signal</h3>
              <HireSignalRadar hireSignal={hire_signal} />
            </div>
          )}
        </div>

        {/* ── 4. CV REALISM AUDIT ────────────────────────────────────────── */}
        {hasCV && (
          <SectionCard title="CV Realism Audit" icon="📋" id="cv-audit">
            {/* Gauge + summary row */}
            <div className="flex flex-col sm:flex-row items-center gap-6 mb-6 p-4 rounded-xl"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
              <CVHonestyGauge score={cvScore} />
              <div className="flex-1 space-y-2">
                <p className="text-base font-bold" style={{ color: 'var(--color-text)' }}>
                  You confidently defended{' '}
                  <span style={{ color: scoreColor(cvScore) }}>{defended} of {asked} tested claims</span>
                  {' '}from your CV
                </p>
                {cvNote && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{cvNote}</p>}
                <div className="flex flex-wrap gap-2 mt-2">
                  {['Expert', 'Intermediate', 'Beginner', 'Not Demonstrated', 'Not Tested'].map(level => {
                    const count = cvItems.filter(i => i.demonstrated_level === level).length
                    if (!count) return null
                    const c = DEMO_LEVEL_COL[level] || '#6b7280'
                    return (
                      <span key={level} className="text-xs px-2.5 py-1 rounded-full font-semibold"
                        style={{ background: `${c}15`, color: c, border: `1px solid ${c}30` }}>
                        {level}: {count}
                      </span>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Claim-by-claim table */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-muted)' }}>
                Per-Claim Analysis — click a row with a gap to see what to study
              </p>
              {cvItems.map((item, i) => <CVAuditRow key={i} item={item} index={i} />)}
            </div>
          </SectionCard>
        )}

        {/* ── 5. MARKET INTELLIGENCE ────────────────────────────────────── */}
        {market_intelligence && (market_intelligence.raw_context || market_intelligence.insight) && (
          <SectionCard title={`🌐 ${target_company} Market Intelligence`} icon="" id="market">
            <div className="rounded-xl p-4 space-y-3"
              style={{ background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.15)' }}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
                  style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)' }}>
                  📡 Live Data
                </span>
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  Current hiring landscape for {target_company}
                </span>
              </div>
              {market_intelligence.insight && (
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
                  {market_intelligence.insight}
                </p>
              )}
              {market_intelligence.raw_context && !market_intelligence.insight && (
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                  {market_intelligence.raw_context.slice(0, 600)}…
                </p>
              )}
              {market_intelligence.articles?.map((a, i) => (
                <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs hover:underline"
                  style={{ color: 'var(--color-accent)' }}>
                  🔗 {a.title}
                  {a.source && <span style={{ color: 'var(--color-muted)' }}>— {a.source}</span>}
                </a>
              ))}
            </div>
          </SectionCard>
        )}

        {/* ── 6. FAILURE PATTERNS ──────────────────────────────────────── */}
        {failure_patterns.length > 0 && (
          <SectionCard title="⚡ Failure Pattern Analysis" icon="" id="failure-patterns">
            <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
              These are systemic gaps — not just individual misses, but patterns that show recurring weaknesses.
            </p>
            <div className="space-y-3">
              {failure_patterns.map((p, i) => <FailurePatternCard key={i} pattern={p} />)}
            </div>
          </SectionCard>
        )}

        {/* ── 7. CATEGORY BREAKDOWN ─────────────────────────────────────── */}
        {category_breakdown.length > 0 && (
          <SectionCard title="Category Breakdown" icon="📊" id="categories">
            <div className="grid sm:grid-cols-2 gap-x-8">
              {category_breakdown.map((item, i) => <CategoryBar key={i} item={item} />)}
            </div>
          </SectionCard>
        )}

        {/* ── 8. STRONG AREAS ──────────────────────────────────────────── */}
        {(strong_areas.length > 0 || weak_areas.length > 0) && (
          <div className="grid sm:grid-cols-2 gap-5">
            {strong_areas.length > 0 && (
              <SectionCard title="Your Strong Areas ✅" icon="" id="strengths">
                <div className="space-y-3">
                  {strong_areas.map((a, i) => {
                    const area = typeof a === 'object' ? a.area : a
                    const ev   = typeof a === 'object' ? a.evidence : ''
                    const sc   = typeof a === 'object' ? a.score : null
                    return (
                      <div key={i} className="rounded-xl p-4 space-y-1.5"
                        style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)' }}>
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm" style={{ color: '#059669' }}>✓ {area}</span>
                          {sc != null && <span className="text-xs font-bold px-2 py-0.5 rounded"
                            style={{ background: 'rgba(16,185,129,0.12)', color: '#059669' }}>{sc}/100</span>}
                        </div>
                        {ev && <p className="text-xs italic leading-relaxed" style={{ color: '#065f46' }}>"{ev}"</p>}
                      </div>
                    )
                  })}
                </div>
              </SectionCard>
            )}

            {/* ── WEAK AREAS */}
            {weak_areas.length > 0 && (
              <SectionCard title="Areas to Improve ⚠️" icon="" id="weaknesses">
                <div className="space-y-3">
                  {weak_areas.map((a, i) => {
                    const area    = typeof a === 'object' ? a.area : a
                    const missed  = typeof a === 'object' ? a.what_was_missed : ''
                    const improve = typeof a === 'object' ? a.how_to_improve : ''
                    const sc      = typeof a === 'object' ? a.score : null
                    return (
                      <div key={i} className="rounded-xl p-4 space-y-2"
                        style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.15)' }}>
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <span className="font-semibold text-sm" style={{ color: '#dc2626' }}>⚠ {area}</span>
                          {sc != null && <span className="text-xs font-bold px-2 py-0.5 rounded"
                            style={{ background: 'rgba(239,68,68,0.1)', color: '#dc2626' }}>{sc}/100</span>}
                        </div>
                        {missed && <p className="text-xs" style={{ color: '#991b1b' }}>
                          <strong>Missed: </strong>{missed}
                        </p>}
                        {improve && <div className="mt-1 rounded-lg px-3 py-2 text-xs"
                          style={{ background: 'rgba(239,68,68,0.06)', color: '#b91c1c' }}>
                          <strong>How to improve: </strong>{improve}
                        </div>}
                      </div>
                    )
                  })}
                </div>
              </SectionCard>
            )}
          </div>
        )}

        {/* ── RED FLAGS ──────────────────────────────────────────────────── */}
        {red_flags.length > 0 && (
          <SectionCard title="🚨 Red Flags Detected" icon="" id="red-flags">
            <div className="space-y-2">
              {red_flags.map((rf, i) => (
                <div key={i} className="rounded-xl p-3 font-semibold text-sm"
                  style={{ background: 'rgba(220,38,38,0.1)', border: '2px solid rgba(220,38,38,0.4)', color: '#b91c1c' }}>
                  🚩 {rf}
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* ── 9. PER-QUESTION ACCORDION ─────────────────────────────────── */}
        {per_question_analysis.length > 0 && (
          <SectionCard title="Per-Question Analysis" icon="📋" id="questions">
            {/* Bar chart above accordion */}
            {barData.length > 0 && (
              <div style={{ height: Math.max(180, barData.length * 36) }} className="mb-5">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 40, left: 8, bottom: 0 }}>
                    <CartesianGrid horizontal={false} stroke="var(--color-border)" strokeDasharray="3 3" />
                    <XAxis type="number" domain={[0, 10]} tick={{ fontSize: 11, fill: 'var(--color-muted)' }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: 'var(--color-text-2)' }} width={32} />
                    <RTooltip content={<BarTooltip />} />
                    <Bar dataKey="score" radius={[0, 6, 6, 0]} maxBarSize={18}>
                      {barData.map((entry, i) => (
                        <Cell key={i} fill={scoreColor((entry.score / 10) * 100)} />
                      ))}
                      <LabelList dataKey="score" position="right"
                        style={{ fontSize: 11, fontWeight: 700, fill: 'var(--color-text)' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {per_question_analysis.map((item, i) => (
              <QAccordion key={item.question_id || i} item={item} index={i} />
            ))}
          </SectionCard>
        )}

        {/* ── 10. 4-WEEK STUDY ROADMAP ──────────────────────────────────── */}
        {(study_roadmap.week_1?.length > 0 || study_roadmap.week_2?.length > 0) && (
          <SectionCard title="📅 Your 4-Week Study Roadmap" icon="" id="roadmap">
            <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
              A priority-ordered plan built from your specific gaps in this interview.
            </p>
            <div className="flex gap-4 overflow-x-auto pb-2">
              {['week_1', 'week_2', 'week_3', 'week_4'].map((key, idx) => (
                <RoadmapWeek key={key} weekKey={key} items={study_roadmap[key] || []} weekNum={idx + 1} />
              ))}
            </div>
          </SectionCard>
        )}

        {/* ── 11. MOCK-READY / NOT-READY CHIPS ─────────────────────────── */}
        {(mock_ready_topics.length > 0 || not_ready_topics.length > 0) && (
          <SectionCard title="🎯 Interview Readiness" icon="" id="readiness">
            <div className="space-y-4">
              {mock_ready_topics.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: '#10b981' }}>
                    ✅ Topics you can confidently answer NOW
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {mock_ready_topics.map((t, i) => (
                      <span key={i} className="text-xs px-3 py-1.5 rounded-full font-medium"
                        style={{ background: 'rgba(16,185,129,0.1)', color: '#059669', border: '1px solid rgba(16,185,129,0.25)' }}>
                        ✓ {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {not_ready_topics.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: '#ef4444' }}>
                    ❌ Need more prep before your next interview
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {not_ready_topics.map((t, i) => (
                      <span key={i} className="text-xs px-3 py-1.5 rounded-full font-medium"
                        style={{ background: 'rgba(239,68,68,0.08)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.2)' }}>
                        ✗ {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </SectionCard>
        )}

        {/* ── 12. STUDY RECOMMENDATIONS ─────────────────────────────────── */}
        {study_recommendations.length > 0 && (
          <SectionCard title="Study Recommendations" icon="📚" id="recommendations">
            <div className="space-y-3">
              {study_recommendations.map((r, i) => {
                const topic  = typeof r === 'object' ? r.topic : r
                const prio   = typeof r === 'object' ? r.priority : 'Medium'
                const reason = typeof r === 'object' ? r.reason : ''
                const res    = typeof r === 'object' ? (r.resources || []) : []
                const pc     = PRIORITY_STYLE[prio] || PRIORITY_STYLE['Medium']
                return (
                  <div key={i} className="flex gap-4 items-start p-4 rounded-xl"
                    style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 mt-0.5"
                      style={{ background: pc.bg, color: pc.text, border: `1px solid ${pc.border}` }}>
                      {prio}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{topic}</p>
                      {reason && <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{reason}</p>}
                      {res.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {res.map((r2, j) => (
                            <span key={j} className="text-xs px-2 py-0.5 rounded"
                              style={{ background: 'var(--color-accent-light)', color: 'var(--color-accent)', border: '1px solid rgba(91,94,246,0.2)' }}>
                              {r2}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </SectionCard>
        )}

        {/* ── 13. INTERVIEW TIPS ────────────────────────────────────────── */}
        {interview_tips.length > 0 && (
          <SectionCard title="Interview Tips for Next Time" icon="💡" id="tips">
            <div className="space-y-2">
              {interview_tips.map((tip, i) => (
                <div key={i} className="flex gap-3 items-start p-3 rounded-xl"
                  style={{ background: 'var(--color-accent-light)', border: '1px solid rgba(91,94,246,0.15)' }}>
                  <span className="text-sm font-bold flex-shrink-0 mt-0.5" style={{ color: 'var(--color-accent)' }}>{i + 1}.</span>
                  <p className="text-sm" style={{ color: 'var(--color-text-2)' }}>{tip}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* ── 14. FOOTER ───────────────────────────────────────────────── */}
        <div className="no-print flex flex-col sm:flex-row items-center gap-3 pt-2 pb-10">
          <button id="download-btn" onClick={handleDownload} disabled={printing}
            className="btn-secondary w-full sm:w-auto">
            🖨️ {printing ? 'Opening print…' : 'Download as PDF'}
          </button>
          <button id="start-new-btn" onClick={() => navigate('/dashboard')}
            className="btn-primary w-full sm:w-auto">
            🚀 Start New Interview
          </button>
        </div>

      </div>
    </div>
  )
}
