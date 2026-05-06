/**
 * SharedReportPage — public view of a shared interview report.
 * Route: /share/:token  (no auth required)
 *
 * Displays a read-only summary card:
 *  - Score ring + grade + hire recommendation
 *  - Round / difficulty / company metadata
 *  - Strong & weak areas
 *  - Study recommendations
 *  - CTA to try the platform
 */
import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getSharedReport } from '../lib/api'
import {
  Brain, Trophy, CheckCircle, XCircle, BookOpen,
  BarChart2, AlertTriangle, ExternalLink, Award,
} from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────
function scoreColor(s) {
  const n = +s
  if (n >= 80) return '#4ade80'
  if (n >= 60) return '#facc15'
  if (n >= 40) return '#fb923c'
  return '#f87171'
}

function ScoreRing({ score, size = 110 }) {
  const R   = (size / 2) - 10
  const C   = 2 * Math.PI * R
  const pct = Math.min(100, Math.max(0, score)) / 100
  const off = C * (1 - pct)
  const col = scoreColor(score)
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg style={{ transform: 'rotate(-90deg)' }} width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={8} />
        <circle cx={size/2} cy={size/2} r={R} fill="none"
          stroke={col} strokeWidth={8} strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={off}
          style={{ transition: 'stroke-dashoffset 1.2s ease' }}
        />
      </svg>
      <div className="absolute text-center">
        <p className="font-bold leading-none" style={{ color: col, fontSize: size * 0.22 }}>{score}</p>
        <p style={{ fontSize: 10 }} className="text-muted">/100</p>
      </div>
    </div>
  )
}

const ROUND_LABELS = {
  technical: 'Technical', hr: 'HR / Behavioural',
  dsa: 'DSA / Coding', mcq_practice: 'MCQ Practice',
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function SharedReportPage() {
  const { token } = useParams()
  const [report, setReport]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!token) return
    getSharedReport(token)
      .then(res => {
        setReport(res?.data ?? null)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message || 'Could not load report.')
        setLoading(false)
      })
  }, [token])

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <div className="w-10 h-10 border-4 rounded-full animate-spin"
        style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-accent)' }} />
      <p className="text-muted text-sm">Loading shared report…</p>
    </div>
  )

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error || !report) return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="glass p-8 max-w-md text-center space-y-4">
        <AlertTriangle size={40} className="mx-auto" style={{ color: 'var(--color-warning)' }} />
        <h2 className="text-xl font-bold">Link Not Available</h2>
        <p className="text-muted text-sm">{error || 'This report link is invalid or has been revoked.'}</p>
        <Link to="/" className="btn-primary inline-flex items-center gap-2">
          <Brain size={16} /> Try AI Interviewer
        </Link>
      </div>
    </div>
  )

  // ── Data extraction ──────────────────────────────────────────────────────────
  const {
    overall_score = 0, grade, hire_recommendation,
    round_type = 'technical', difficulty = '',
    strong_areas = [], weak_areas = [],
    study_recommendations = [], summary = '',
    target_company = '', candidate_name = '',
    // HR Phase 1 fields
    key_signals = [], competency_scorecard = [],
    hire_confidence = '', job_role = '',
  } = report

  // report_data JSONB may contain richer data
  const reportData = typeof report.report_data === 'object' ? (report.report_data || {}) : {}

  const overall      = +Number(overall_score).toFixed(1)
  const col          = scoreColor(overall)
  const strongList   = (strong_areas || []).slice(0, 4).map(a => (typeof a === 'string' ? a : a?.area)).filter(Boolean)
  const weakList     = (weak_areas   || []).slice(0, 4).map(a => (typeof a === 'string' ? a : a?.area)).filter(Boolean)
  const studyList    = (study_recommendations || []).slice(0, 4)
  const hireColor    = hire_recommendation?.includes('Strong') ? '#4ade80'
    : hire_recommendation === 'Yes' ? '#a3e635'
    : hire_recommendation === 'Maybe' ? '#facc15'
    : '#f87171'

  return (
    <div className="min-h-screen pb-16" style={{ background: 'var(--color-bg)' }}>

      {/* ── Branded top bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-3"
        style={{
          background: 'var(--navbar-bg)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--color-border)',
        }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#5b5ef6,#06b6d4)' }}>
            <Brain size={16} className="text-white" />
          </div>
          <span className="font-bold text-sm gradient-text">AI Interviewer</span>
        </div>
        <Link to="/" className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5">
          <ExternalLink size={12} /> Try It Free
        </Link>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-10 space-y-6">

        {/* ── Header ──────────────────────────────────────────────────────────── */}
        <div className="glass p-6 flex flex-col sm:flex-row gap-6 items-center sm:items-start">
          <ScoreRing score={overall} />
          <div className="flex-1 text-center sm:text-left space-y-2">
            <h1 className="text-2xl font-bold gradient-text">Interview Report</h1>
            {candidate_name && (
              <p className="font-semibold text-sm" style={{ color: 'var(--color-text-2)' }}>
                {candidate_name}
              </p>
            )}
            <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                style={{ background: 'rgba(91,94,246,0.15)', color: 'var(--color-accent)' }}>
                {ROUND_LABELS[round_type] || round_type}
              </span>
              {difficulty && (
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold capitalize"
                  style={{ background: 'rgba(6,182,212,0.12)', color: '#06b6d4' }}>
                  {difficulty}
                </span>
              )}
              {grade && (
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                  style={{ background: `${col}20`, color: col }}>
                  Grade {grade}
                </span>
              )}
              {target_company && (
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                  style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>
                  {target_company}
                </span>
              )}
            </div>
            {hire_recommendation && (
              <p className="text-xs font-semibold" style={{ color: hireColor }}>
                Hire Recommendation: {hire_recommendation}
              </p>
            )}
            {summary && (
              <p className="text-sm" style={{ color: 'var(--color-muted)', lineHeight: 1.6 }}>
                {summary}
              </p>
            )}
          </div>
        </div>

        {/* ── HR: Key Signals ──────────────────────────────────────────────────── */}
        {round_type === 'hr' && key_signals?.length > 0 && (
          <div className="glass p-5 space-y-3"
            style={{ border: '1px solid rgba(236,72,153,0.3)' }}>
            <h2 className="font-bold text-sm flex items-center gap-2" style={{ color: '#ec4899' }}>
              <Award size={16} /> Key Hiring Signals
            </h2>
            <div className="space-y-3">
              {key_signals.map((s, i) => {
                const vc = s.valence === 'positive' ? '#4ade80' : s.valence === 'negative' ? '#f87171' : '#f59e0b'
                return (
                  <div key={i} className="rounded-lg p-3"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <div className="flex items-start gap-2 mb-1">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5" style={{ background: vc }} />
                      <p className="text-sm font-semibold leading-snug flex-1">{s.signal}</p>
                      <span className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 font-semibold"
                        style={{ background: `${vc}15`, color: vc, border: `1px solid ${vc}40` }}>
                        {s.valence}
                      </span>
                    </div>
                    {s.evidence && (
                      <p className="text-xs ml-3.5 italic" style={{ color: 'rgba(255,255,255,0.45)' }}>
                        "{s.evidence}"
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── HR: Competency Scorecard summary (no verbatim quotes in public view) ── */}
        {round_type === 'hr' && competency_scorecard?.length > 0 && (
          <div className="glass p-5 space-y-3"
            style={{ border: '1px solid rgba(236,72,153,0.3)' }}>
            <h2 className="font-bold text-sm flex items-center gap-2" style={{ color: '#ec4899' }}>
              <BarChart2 size={16} /> Competency Ratings
            </h2>
            {hire_confidence && (
              <p className="text-xs text-muted">
                Assessment confidence: <span className="font-semibold"
                  style={{ color: hire_confidence === 'High' ? '#4ade80' : hire_confidence === 'Medium' ? '#f59e0b' : '#f87171' }}>
                  {hire_confidence}
                </span>
              </p>
            )}
            <div className="space-y-2">
              {competency_scorecard.map((entry, i) => {
                const ANCHOR_COLORS = { 'Exceptional': '#4ade80', 'Exceeds Bar': '#a3e635', 'Meets Bar': '#facc15', 'Below Bar': '#fb923c', 'Significantly Below Bar': '#f87171', 'Poor': '#ef4444', 'No Evidence': '#6b7280' }
                const color = ANCHOR_COLORS[entry.anchor_label] || '#94a3b8'
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-muted flex-1 truncate">{entry.axis}</span>
                    <span className="text-xs font-bold w-8 text-right flex-shrink-0" style={{ color }}>
                      {entry.rating_1_7}/7
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 hidden sm:inline"
                      style={{ background: `${color}15`, color, border: `1px solid ${color}40` }}>
                      {entry.anchor_label}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Strong & Weak ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {strongList.length > 0 && (
            <div className="glass p-5 space-y-3">
              <h2 className="font-bold text-sm flex items-center gap-2" style={{ color: '#4ade80' }}>
                <CheckCircle size={16} /> Strong Areas
              </h2>
              <ul className="space-y-1.5">
                {strongList.map((a, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-2)' }}>
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#4ade80' }} />
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {weakList.length > 0 && (
            <div className="glass p-5 space-y-3">
              <h2 className="font-bold text-sm flex items-center gap-2" style={{ color: '#f87171' }}>
                <XCircle size={16} /> Areas to Improve
              </h2>
              <ul className="space-y-1.5">
                {weakList.map((a, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-2)' }}>
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#f87171' }} />
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ── Study Recommendations ─────────────────────────────────────────────── */}
        {studyList.length > 0 && (
          <div className="glass p-5 space-y-3">
            <h2 className="font-bold text-sm flex items-center gap-2" style={{ color: 'var(--color-accent)' }}>
              <BookOpen size={16} /> Study Recommendations
            </h2>
            <ul className="space-y-2">
              {studyList.map((r, i) => {
                const topic    = typeof r === 'string' ? r : (r?.topic || r?.area || '')
                const resource = typeof r === 'string' ? '' : (r?.resource || r?.reason || '')
                return (
                  <li key={i} className="text-sm" style={{ color: 'var(--color-text-2)' }}>
                    <span className="font-semibold">{topic}</span>
                    {resource && <span className="text-muted"> — {resource}</span>}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* ── CTA ──────────────────────────────────────────────────────────────── */}
        <div className="glass p-6 text-center space-y-3"
          style={{ borderColor: 'rgba(91,94,246,0.3)' }}>
          <BarChart2 size={28} className="mx-auto" style={{ color: 'var(--color-accent)' }} />
          <h3 className="font-bold text-lg">Get Your Own AI Interview Report</h3>
          <p className="text-muted text-sm max-w-sm mx-auto">
            Practice with 50+ question types, get instant AI feedback, and track your growth over time.
          </p>
          <Link to="/" className="btn-primary inline-flex items-center gap-2 mt-2">
            <Brain size={16} /> Start Free Practice
          </Link>
          <p className="text-xs text-muted pt-1">No credit card required</p>
        </div>

      </div>
    </div>
  )
}
