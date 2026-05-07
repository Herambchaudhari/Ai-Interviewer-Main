/**
 * ReportPage — Full post-interview Ultra-Report with SSE streaming.
 * Route: /report/:sessionId
 *
 * Sections (in render order):
 *  1. SSE Loading State  (while generating)
 *  2. What Went Wrong callout
 *  3. Repeated Offenders (deferred — only when data exists across sessions)
 *  4. Score Header + Improvement Delta
 *  5. Failure Patterns (promoted — root causes of low-scoring answers)
 *  6. Two-Radar Grid: Technical Knowledge Breakdown + Hire Signal Radar
 *  7. 6-Axis Communication Radar + Delivery Consistency
 *  8. MCQ Category Breakdown (mcq_practice only)
 *  9. Filler & Hesitation Heatmap
 * 10. Per-Question Scores
 * 11. Verbal Category Breakdown (non-mcq rounds, deterministic)
 * 12. Strong & Weak Areas
 * 13. Code Quality (DSA only)
 * 14. Company Fit (if target_company set)
 * 15. Skill Decay (deferred — only when cross-session data exists)
 * 16. CV Audit
 * 17. Skills to Work On
 * 18. 30-Day Sprint Plan
 * 19. Follow-Up Questions
 * 20. Per-Question Deep Dive
 * 21. Preparation Checklist
 * 22. Interview Integrity (proctoring — at bottom)
 * 23. Next Interview Blueprint CTA
 */
import './print.css'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  BarChart, Bar, LineChart, Line,
  ScatterChart, Scatter, ZAxis, ReferenceLine,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid,
} from 'recharts'
import { getReportWithSSE, getCachedReportOnly, generateShareLink, getUserChecklists, toggleChecklistItem, retrySaveReport, retryStages } from '../lib/api'
import SectionErrorBoundary from '../components/SectionErrorBoundary'
import SectionRetryCard from '../components/SectionRetryCard'
import HireSignalRadar from '../components/charts/HireSignalRadar'
import {
  Trophy, TrendingUp, TrendingDown, BookOpen, ChevronRight,
  Star, RotateCcw, Home, CheckCircle, XCircle, AlertTriangle,
  Target, Zap, Brain, ArrowUp, ArrowDown, Minus, Shield,
  MessageSquare, BarChart2, Clock, Flame, Eye,
  Share2, Download, Play, Pause, Volume2, X, Copy, Check, Users,
  Activity, Layers, Timer, Code2, Briefcase, FileText, Award,
  ShieldAlert, Info, Smile, Sliders,
  TrendingUp as TrendingUpIcon, GitBranch, ClipboardCheck, BarChart2 as BarChart2Icon,
} from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────
const ROUND_LABELS = {
  technical: 'Technical', hr: 'HR / Behavioural',
  dsa: 'DSA / Coding', mcq_practice: 'MCQ Practice', system_design: 'Legacy System Design',
}

const SSE_STAGES = [
  { key: 'core_analysis',       label: 'Scoring your answers…',           pct: 25 },
  { key: 'behavioral_analysis', label: 'Analyzing your delivery…',         pct: 50 },
  { key: 'company_fit',         label: 'Calibrating against hiring bar…',  pct: 70 },
  { key: 'playbook_generation', label: 'Building your 30-day plan…',       pct: 85 },
  { key: 'complete',            label: 'Finalizing report…',               pct: 100 },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
function scoreColor(s) {
  const n = +s
  if (n >= 80) return '#4ade80'
  if (n >= 60) return '#facc15'
  if (n >= 40) return '#fb923c'
  return '#f87171'
}

function scoreColor10(s) { return scoreColor(s * 10) }

function gradeColor(g) {
  if (!g) return '#94a3b8'
  if (g.startsWith('A')) return '#4ade80'
  if (g.startsWith('B')) return '#facc15'
  if (g.startsWith('C')) return '#fb923c'
  return '#f87171'
}

function hireColor(h) {
  if (!h) return '#94a3b8'
  if (h.includes('Strong')) return '#4ade80'
  if (h === 'Yes') return '#a3e635'
  if (h === 'Maybe') return '#facc15'
  return '#f87171'
}

function normArea(a) {
  if (typeof a === 'string') return { area: a }
  return a || {}
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 120, max = 100, trackColor = 'var(--hr-header-ring-bg)' }) {
  const R   = (size / 2) - 10
  const C   = 2 * Math.PI * R
  const pct = Math.min(100, Math.max(0, score)) / max
  const off = C * (1 - pct)
  const col = scoreColor(score)
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg style={{ transform: 'rotate(-90deg)' }} width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={R} fill="none" stroke={trackColor} strokeWidth={8}/>
        <circle cx={size/2} cy={size/2} r={R} fill="none"
          stroke={col} strokeWidth={8} strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={off}
          style={{ transition: 'stroke-dashoffset 1.4s ease' }}
        />
      </svg>
      <div className="absolute text-center">
        <p className="font-bold leading-none" style={{ color: col, fontSize: size * 0.22 }}>{score}</p>
        <p className="text-xs text-muted">/{max}</p>
      </div>
    </div>
  )
}

function SectionCard({ icon, title, color = '#7c3aed', children, className = '' }) {
  const ref     = useRef(null)
  const [vis, setVis] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVis(true); obs.disconnect() } },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return (
    <div ref={ref} className={`glass p-6 ${className}`}
      style={{
        opacity: vis ? 1 : 0,
        transform: vis ? 'translateY(0)' : 'translateY(20px)',
        transition: 'opacity 0.55s ease, transform 0.55s ease',
      }}>
      <h2 className="font-bold mb-4 flex items-center gap-2" style={{ color }}>
        {icon} {title}
      </h2>
      {children}
    </div>
  )
}

function Chip({ label, color = '#7c3aed', size = 'sm' }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-lg font-medium text-${size}`}
      style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}>
      {label}
    </span>
  )
}

// ── HR Phase 1: Professional Document Header ──────────────────────────────────
function HRDocumentHeader({ candidateName, jobRole, difficulty, interviewDatetime, sessionId, overallScore, grade, hireRecommendation, numQuestions, timerMins }) {
  const dateStr = interviewDatetime
    ? new Date(interviewDatetime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Date not recorded'
  const shortId = sessionId ? (sessionId.slice(0, 8).toUpperCase() + '…') : '—'
  const confColor = hireRecommendation?.includes('Strong') ? '#4ade80'
    : hireRecommendation === 'Yes' ? '#a3e635'
    : hireRecommendation === 'Maybe' ? '#facc15'
    : '#f87171'

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{
        background: 'var(--hr-header-bg)',
        border: '1px solid var(--hr-header-border)',
        color: 'var(--hr-header-text)',
        boxShadow: 'var(--shadow-md)',
      }}>
      {/* Confidential strip */}
      <div className="px-6 py-2 flex items-center justify-between"
        style={{ background: 'var(--hr-header-strip-bg)', borderBottom: '1px solid var(--hr-header-strip-border)' }}>
        <span className="text-[10px] font-bold tracking-[0.3em] uppercase"
          style={{ color: '#ec4899' }}>Confidential — AI Interviewer Assessment</span>
        <span className="text-[10px] tracking-wider" style={{ color: 'var(--hr-header-muted)' }}>HR / Behavioural Round</span>
      </div>

      <div className="px-6 pt-5 pb-2">
        {/* Row 1: Name + badges */}
        <div className="flex flex-wrap items-start gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold truncate" style={{ color: 'var(--hr-header-text)' }}>{candidateName || 'Candidate'}</h1>
            {jobRole && <p className="text-sm mt-0.5" style={{ color: 'var(--hr-header-muted)' }}>{jobRole}</p>}
          </div>
          <div className="flex flex-wrap gap-2 flex-shrink-0">
            <Chip label={`${difficulty?.toUpperCase() || 'MEDIUM'} Difficulty`} color="#ec4899" size="xs" />
            <Chip label="HR / Behavioural" color="#a78bfa" size="xs" />
          </div>
        </div>

        {/* Row 2: metadata */}
        <div className="flex flex-wrap gap-4 text-[11px] mb-5 pb-5"
          style={{ borderBottom: '1px solid var(--hr-header-divider)', color: 'var(--hr-header-text-2)' }}>
          <span><span style={{ color: 'var(--hr-header-muted)' }}>Date · </span>{dateStr}</span>
          <span><span style={{ color: 'var(--hr-header-muted)' }}>Session · </span>{shortId}</span>
          <span><span style={{ color: 'var(--hr-header-muted)' }}>Questions · </span>{numQuestions || '—'}</span>
          <span><span style={{ color: 'var(--hr-header-muted)' }}>Duration · </span>{timerMins ? `${timerMins}m` : '—'}</span>
        </div>

        {/* Hero row: score + grade + recommendation */}
        <div className="flex flex-wrap items-center gap-6 pb-6">
          <ScoreRing score={overallScore} size={110} />
          <div className="flex flex-col gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: 'var(--hr-header-muted)' }}>Overall Grade</p>
              <p className="text-5xl font-black leading-none" style={{ color: gradeColor(grade) }}>{grade || '—'}</p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: 'var(--hr-header-muted)' }}>Hiring Recommendation</p>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: confColor }} />
                <p className="text-xl font-bold" style={{ color: confColor }}>{hireRecommendation || '—'}</p>
              </div>
            </div>
          </div>
          <div className="ml-auto text-right hidden sm:block">
            <p className="text-[10px]" style={{ color: 'var(--hr-header-muted)' }}>Generated by</p>
            <p className="text-xs font-semibold" style={{ color: '#ec4899' }}>AI Interviewer</p>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--hr-header-muted)' }}>{new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' })}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── HR Phase 1: Executive Summary Panel ──────────────────────────────────────
function HRExecutiveSummary({ hireRecommendation, hireConfidence, summary, grade, comparedToLevel, keySignals }) {
  const confColor = hireConfidence === 'High' ? '#4ade80'
    : hireConfidence === 'Medium' ? '#f59e0b'
    : '#f87171'
  const valenceColor = v => v === 'positive' ? '#4ade80' : v === 'negative' ? '#f87171' : '#f59e0b'

  return (
    <SectionCard icon={<FileText size={16}/>} title="Hiring Committee Briefing Note" color="#ec4899">
      {/* Confidence + recommendation badge */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {hireConfidence && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold"
            style={{ background: `${confColor}15`, border: `1px solid ${confColor}40`, color: confColor }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: confColor }} />
            {hireConfidence} Confidence
          </span>
        )}
        {hireRecommendation && (
          <Chip label={hireRecommendation} color={hireRecommendation?.includes('Strong') ? '#4ade80' : hireRecommendation === 'Yes' ? '#a3e635' : hireRecommendation === 'Maybe' ? '#facc15' : '#f87171'} />
        )}
        {grade && <Chip label={`Grade: ${grade}`} color={gradeColor(grade)} />}
      </div>

      {/* Summary paragraph — formal block-quote */}
      {summary && (
        <div className="mb-5 pl-4 py-1"
          style={{ borderLeft: '3px solid rgba(236,72,153,0.5)' }}>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{summary}</p>
          {comparedToLevel && (
            <p className="text-xs text-muted mt-2 italic">{comparedToLevel}</p>
          )}
        </div>
      )}

      {/* Key Signals */}
      {keySignals?.length > 0 && (
        <>
          <p className="text-[10px] text-muted uppercase tracking-wider mb-3">Key Hiring Signals</p>
          <div className="space-y-3">
            {keySignals.map((s, i) => (
              <div key={i} className="rounded-xl p-3.5"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                <div className="flex items-start gap-2 mb-1.5">
                  <Award size={13} className="flex-shrink-0 mt-0.5" style={{ color: valenceColor(s.valence) }} />
                  <p className="text-sm font-semibold leading-snug">{s.signal}</p>
                  <Chip label={s.valence || 'mixed'} color={valenceColor(s.valence)} size="xs" />
                </div>
                {s.evidence && (
                  <p className="text-xs leading-relaxed ml-5"
                    style={{ color: 'var(--color-muted)', fontStyle: 'italic' }}>
                    "{s.evidence}"
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </SectionCard>
  )
}

// ── HR Phase 1: Competency Scorecard ─────────────────────────────────────────
function HRCompetencyScorecard({ competencyScorecard, axisPercentiles = {}, onRetry, isRetrying }) {
  const ANCHOR_COLORS = {
    'Exceptional':              '#4ade80',
    'Exceeds Bar':              '#a3e635',
    'Meets Bar':                '#facc15',
    'Below Bar':                '#fb923c',
    'Significantly Below Bar':  '#f87171',
    'Poor':                     '#ef4444',
    'No Evidence':              '#6b7280',
  }

  if (!competencyScorecard || competencyScorecard.length === 0) {
    return (
      <SectionCard icon={<BarChart2 size={16}/>} title="Competency Scorecard" color="#ec4899">
        <div className="text-center py-6">
          <p className="text-sm text-muted mb-3">Scorecard data not available for this session.</p>
          {onRetry && (
            <button onClick={onRetry} disabled={isRetrying}
              className="text-xs font-semibold px-4 py-2 rounded-lg transition-all"
              style={{ background: 'rgba(236,72,153,0.15)', border: '1px solid rgba(236,72,153,0.4)', color: '#ec4899', opacity: isRetrying ? 0.6 : 1 }}>
              {isRetrying ? 'Regenerating…' : 'Regenerate Section'}
            </button>
          )}
        </div>
      </SectionCard>
    )
  }

  const avg = (competencyScorecard.reduce((s, c) => s + (c.rating_1_7 || 0), 0) / competencyScorecard.length).toFixed(1)
  const avgAnchor = avg >= 6.5 ? 'Exceptional' : avg >= 5.5 ? 'Exceeds Bar' : avg >= 4.5 ? 'Meets Bar'
    : avg >= 3.5 ? 'Below Bar' : avg >= 2.5 ? 'Significantly Below Bar' : avg >= 1.5 ? 'Poor' : 'No Evidence'
  const avgColor = ANCHOR_COLORS[avgAnchor] || '#94a3b8'

  return (
    <SectionCard icon={<BarChart2 size={16}/>} title="Competency Scorecard" color="#ec4899">
      {/* Overall average */}
      <div className="flex items-center justify-between mb-5 px-4 py-3 rounded-xl"
        style={{ background: 'rgba(236,72,153,0.08)', border: '1px solid rgba(236,72,153,0.2)' }}>
        <div>
          <p className="text-[10px] text-muted uppercase tracking-wider">Overall Scorecard Average</p>
          <p className="text-lg font-bold mt-0.5" style={{ color: avgColor }}>{avg} / 7</p>
        </div>
        <Chip label={avgAnchor} color={avgColor} />
      </div>

      {/* Per-axis rows */}
      <div className="space-y-4">
        {competencyScorecard.map((entry, i) => {
          const color = ANCHOR_COLORS[entry.anchor_label] || '#94a3b8'
          return (
            <div key={i} className="rounded-xl overflow-hidden"
              style={{ border: '1px solid var(--color-border)' }}>
              {/* Header row */}
              <div className="flex items-center gap-3 px-4 py-3"
                style={{ background: 'var(--color-surface-2)' }}>
                <span className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black flex-shrink-0"
                  style={{ background: `${color}20`, color }}>
                  {entry.rating_1_7 || '—'}
                </span>
                <span className="flex-1 text-sm font-semibold truncate">{entry.axis}</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs font-bold" style={{ color }}>{entry.rating_1_7}/7</span>
                  <Chip label={entry.anchor_label || '—'} color={color} size="xs" />
                  {axisPercentiles[entry.axis] != null && (
                    <span className="text-[10px] font-semibold flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                      {axisPercentiles[entry.axis]}th pct
                    </span>
                  )}
                </div>
              </div>
              {/* Verbatim quote */}
              {entry.verbatim_quote && entry.verbatim_quote !== 'No response provided.' && (
                <div className="px-4 py-2.5 ml-10"
                  style={{ borderLeft: '3px solid rgba(236,72,153,0.35)', background: 'var(--color-surface-2)' }}>
                  <p className="text-[11px] leading-relaxed"
                    style={{ color: 'var(--color-muted)', fontStyle: 'italic' }}>
                    "{entry.verbatim_quote}"
                  </p>
                </div>
              )}
              {/* Rationale */}
              {entry.rationale && (
                <div className="px-4 py-2 ml-10">
                  <p className="text-[11px] text-muted leading-relaxed">{entry.rationale}</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}

// ── HR Phase 3: Coachability Index ───────────────────────────────────────────

function CoachabilityCard({ data }) {
  if (!data || typeof data.score !== 'number') return null

  const score = data.score
  const label = data.label || ''
  const posSignals = data.positive_signals || []
  const negSignals = data.negative_signals || []

  const color = score >= 75 ? '#22c55e' : score >= 55 ? '#eab308' : score >= 35 ? '#f97316' : '#ef4444'
  const trackColor = score >= 75 ? '#166534' : score >= 55 ? '#713f12' : score >= 35 ? '#7c2d12' : '#7f1d1d'
  const bgColor   = score >= 75 ? 'rgba(34,197,94,0.08)' : score >= 55 ? 'rgba(234,179,8,0.08)' : score >= 35 ? 'rgba(249,115,22,0.08)' : 'rgba(239,68,68,0.08)'

  return (
    <SectionCard icon={<Smile size={16}/>} title="Coachability Index" color={color}>
      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Gauge */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '100px' }}>
          <div style={{
            width: '88px', height: '88px', borderRadius: '50%',
            background: `conic-gradient(${color} ${score * 3.6}deg, #1e293b ${score * 3.6}deg)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative',
          }}>
            <div style={{
              width: '68px', height: '68px', borderRadius: '50%',
              background: '#0f172a', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: '20px', fontWeight: 700, color }}>{score}</span>
              <span style={{ fontSize: '9px', color: '#64748b' }}>/100</span>
            </div>
          </div>
          <span style={{
            marginTop: '8px', fontSize: '11px', fontWeight: 600,
            color, background: bgColor,
            padding: '2px 8px', borderRadius: '12px', textAlign: 'center',
          }}>{label}</span>
        </div>

        {/* Signals */}
        <div style={{ flex: 1, minWidth: '200px' }}>
          {posSignals.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <p style={{ fontSize: '11px', fontWeight: 600, color: '#22c55e', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Positive Signals</p>
              {posSignals.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '4px', alignItems: 'flex-start' }}>
                  <CheckCircle size={13} style={{ color: '#22c55e', marginTop: '2px', flexShrink: 0 }} />
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>{s}</span>
                </div>
              ))}
            </div>
          )}
          {negSignals.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <p style={{ fontSize: '11px', fontWeight: 600, color: '#f87171', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Resistance Signals</p>
              {negSignals.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '4px', alignItems: 'flex-start' }}>
                  <XCircle size={13} style={{ color: '#f87171', marginTop: '2px', flexShrink: 0 }} />
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>{s}</span>
                </div>
              ))}
            </div>
          )}
          {data.summary && (
            <p style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic', borderLeft: '3px solid ' + color, paddingLeft: '10px', margin: 0 }}>
              {data.summary}
            </p>
          )}
        </div>
      </div>
    </SectionCard>
  )
}

// ── HR Phase 3: Leadership vs IC Fit ─────────────────────────────────────────

function LeadershipICFitBar({ data }) {
  if (!data || typeof data.spectrum_position !== 'number') return null

  const pos = data.spectrum_position  // 1-10
  const pct = ((pos - 1) / 9) * 100
  const label = data.label || ''
  const track = data.recommended_track || ''

  const trackColors = {
    'Individual Contributor': '#60a5fa',
    'Tech Lead': '#a78bfa',
    'Hybrid IC-Lead': '#818cf8',
    'People Manager': '#c084fc',
  }
  const trackColor = trackColors[track] || '#a78bfa'

  return (
    <SectionCard icon={<GitBranch size={16}/>} title="Leadership vs IC Fit" color="#a78bfa">
      {/* Spectrum bar */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', color: '#60a5fa', fontWeight: 600 }}>Individual Contributor</span>
          <span style={{ fontSize: '11px', color: '#c084fc', fontWeight: 600 }}>People Manager</span>
        </div>
        <div style={{ position: 'relative', height: '10px', borderRadius: '8px', background: 'linear-gradient(to right, #1e3a5f, #3b1f5e)', overflow: 'visible' }}>
          <div style={{
            position: 'absolute',
            left: `calc(${pct}% - 8px)`,
            top: '-5px',
            width: '20px', height: '20px',
            borderRadius: '50%',
            background: '#a78bfa',
            boxShadow: '0 0 10px 3px rgba(167,139,250,0.5)',
            border: '2px solid #1e1b4b',
            zIndex: 2,
          }} />
        </div>
        {/* Tick labels */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
          {['Strong IC', 'IC-Lean', 'Hybrid', 'Leader-Lean', 'Strong Leader'].map((t, i) => (
            <span key={i} style={{ fontSize: '9px', color: '#475569', textAlign: 'center', width: '20%' }}>{t}</span>
          ))}
        </div>
      </div>

      {/* Track badge + evidence */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <p style={{ fontSize: '10px', color: '#64748b', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recommended Track</p>
          <span style={{
            fontSize: '13px', fontWeight: 700, color: trackColor,
            background: `${trackColor}18`, border: `1px solid ${trackColor}40`,
            padding: '4px 12px', borderRadius: '20px',
          }}>{track}</span>
        </div>
        <div style={{ flex: 1, minWidth: '180px' }}>
          {data.evidence && (
            <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>
              <span style={{ color: '#cbd5e1', fontWeight: 600 }}>Evidence: </span>{data.evidence}
            </p>
          )}
          {data.reasoning && (
            <p style={{ fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>{data.reasoning}</p>
          )}
        </div>
      </div>
    </SectionCard>
  )
}

// ── HR Phase 3: Reference Check Triggers ─────────────────────────────────────

function ReferenceCheckPanel({ triggers }) {
  if (!triggers || triggers.length === 0) return null

  const priorityOrder = { High: 0, Medium: 1, Low: 2 }
  const sorted = [...triggers].sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3))

  const priorityStyle = {
    High:   { border: '#ef4444', bg: 'rgba(239,68,68,0.06)',   text: '#ef4444',  icon: <ShieldAlert size={14} style={{ color: '#ef4444' }} /> },
    Medium: { border: '#f59e0b', bg: 'rgba(245,158,11,0.06)',  text: '#f59e0b',  icon: <AlertTriangle size={14} style={{ color: '#f59e0b' }} /> },
    Low:    { border: '#64748b', bg: 'rgba(100,116,139,0.06)', text: '#94a3b8',  icon: <Info size={14} style={{ color: '#94a3b8' }} /> },
  }

  return (
    <SectionCard icon={<ClipboardCheck size={16}/>} title="Reference Check Triggers" color="#f59e0b">
      <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '14px' }}>
        Topics that warrant verification with a reference before extending an offer.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {sorted.map((t, i) => {
          const s = priorityStyle[t.priority] || priorityStyle.Low
          return (
            <div key={i} style={{
              background: s.bg,
              borderLeft: `3px solid ${s.border}`,
              borderRadius: '6px',
              padding: '10px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                {s.icon}
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0' }}>{t.topic}</span>
                <span style={{
                  marginLeft: 'auto', fontSize: '10px', fontWeight: 600,
                  color: s.text, background: `${s.border}18`,
                  padding: '1px 7px', borderRadius: '10px',
                }}>{t.priority}</span>
              </div>
              {t.suggested_question && (
                <p style={{
                  fontSize: '12px', color: '#a78bfa', fontStyle: 'italic',
                  background: 'rgba(167,139,250,0.06)', padding: '6px 10px',
                  borderRadius: '4px', marginBottom: '4px',
                }}>
                  "{t.suggested_question}"
                </p>
              )}
              {t.reason && (
                <p style={{ fontSize: '11px', color: '#64748b', margin: 0 }}>{t.reason}</p>
              )}
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}

// ── HR Phase 3: Assessment Confidence ────────────────────────────────────────

function AssessmentConfidenceCard({ data }) {
  if (!data || typeof data.score !== 'number') return null

  const score = data.score
  const label = data.label || ''
  const limiters = data.limiting_factors || []

  const color = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444'

  return (
    <SectionCard icon={<BarChart2Icon size={16}/>} title="Assessment Confidence" color={color}>
      <div style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>AI Confidence in Hire Recommendation</span>
          <span style={{ fontSize: '13px', fontWeight: 700, color }}>{score}/100</span>
        </div>
        {/* Bar: red → yellow → green gradient */}
        <div style={{ position: 'relative', height: '8px', borderRadius: '6px', background: 'linear-gradient(to right, #ef4444, #f59e0b, #22c55e)', overflow: 'visible' }}>
          <div style={{
            position: 'absolute',
            left: `calc(${score}% - 7px)`,
            top: '-5px',
            width: '18px', height: '18px',
            borderRadius: '50%',
            background: color,
            boxShadow: `0 0 8px 2px ${color}60`,
            border: '2px solid #0f172a',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
          <span style={{ fontSize: '9px', color: '#ef4444' }}>Low Confidence</span>
          <span style={{ fontSize: '11px', fontWeight: 600, color }}>{label}</span>
          <span style={{ fontSize: '9px', color: '#22c55e' }}>High Confidence</span>
        </div>
      </div>

      {limiters.length > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <p style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Limiting Factors</p>
          {limiters.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '4px', alignItems: 'flex-start' }}>
              <Minus size={12} style={{ color: '#f59e0b', marginTop: '3px', flexShrink: 0 }} />
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>{f}</span>
            </div>
          ))}
        </div>
      )}

      {data.what_would_change_it && (
        <blockquote style={{
          margin: 0, padding: '8px 12px',
          borderLeft: '3px solid ' + color,
          background: 'var(--color-surface-2)',
          borderRadius: '4px',
        }}>
          <p style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, marginBottom: '2px' }}>What would change this</p>
          <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>{data.what_would_change_it}</p>
        </blockquote>
      )}
    </SectionCard>
  )
}

// ── HR Phase 2: Culture Fit Map ───────────────────────────────────────────────

function CultureFitMap({ dimensions }) {
  if (!dimensions || dimensions.length === 0) return null

  return (
    <SectionCard icon={<Sliders size={16}/>} title="Culture Fit Profile" color="#ec4899">
      <p className="text-xs text-muted mb-4">
        Where this candidate sits on 5 key work-style spectrums, inferred from their behavioral stories.
      </p>
      <div className="space-y-5">
        {dimensions.map((dim, i) => {
          const pos = Math.max(1, Math.min(5, dim.candidate_position || 3))
          const pct = ((pos - 1) / 4) * 100
          const col = pos <= 2 ? '#a78bfa' : pos === 3 ? '#94a3b8' : '#38bdf8'
          return (
            <div key={i}>
              {/* Pole labels */}
              <div className="flex justify-between mb-1.5">
                <span className="text-[11px] font-semibold" style={{ color: '#a78bfa' }}>{dim.pole_left}</span>
                <span className="text-[11px] font-semibold" style={{ color: '#38bdf8' }}>{dim.pole_right}</span>
              </div>
              {/* Spectrum bar with marker */}
              <div className="relative h-2.5 rounded-full mb-2"
                style={{ background: 'linear-gradient(to right, rgba(167,139,250,0.25), rgba(148,163,184,0.15), rgba(56,189,248,0.25))' }}>
                <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 shadow-lg transition-all duration-700"
                  style={{ left: `calc(${pct}% - 8px)`, background: col, borderColor: 'var(--color-bg)', boxShadow: `0 0 8px ${col}60` }} />
              </div>
              {/* Rationale */}
              {dim.rationale && (
                <p className="text-[11px] text-muted leading-relaxed">{dim.rationale}</p>
              )}
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}

// ── HR Phase 2: EQ Profile Card ───────────────────────────────────────────────

function EQProfileCard({ eqProfile }) {
  if (!eqProfile || Object.keys(eqProfile).length === 0) return null

  const EQ_DIMS = [
    { key: 'self_awareness',      label: 'Self-Awareness',       color: '#a78bfa' },
    { key: 'self_regulation',     label: 'Self-Regulation',      color: '#38bdf8' },
    { key: 'empathy',             label: 'Empathy',              color: '#f472b6' },
    { key: 'social_skills',       label: 'Social Skills',        color: '#4ade80' },
    { key: 'intrinsic_motivation',label: 'Intrinsic Motivation', color: '#fb923c' },
  ]

  const labelColor = eqProfile.eq_overall_label === 'High EQ' ? '#4ade80'
    : eqProfile.eq_overall_label === 'Moderate EQ' ? '#facc15'
    : '#f87171'

  const avg = Math.round(
    EQ_DIMS.reduce((s, d) => s + (eqProfile[d.key] || 0), 0) / EQ_DIMS.length
  )

  return (
    <SectionCard icon={<Smile size={16}/>} title="Emotional Intelligence Profile" color="#ec4899">
      {/* Header: label + avg */}
      <div className="flex items-center justify-between mb-5 px-4 py-3 rounded-xl"
        style={{ background: 'rgba(236,72,153,0.07)', border: '1px solid rgba(236,72,153,0.18)' }}>
        <div>
          <p className="text-[10px] text-muted uppercase tracking-wider">EQ Assessment</p>
          <p className="text-lg font-bold mt-0.5" style={{ color: labelColor }}>{eqProfile.eq_overall_label || '—'}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-muted uppercase tracking-wider">Avg Score</p>
          <p className="text-2xl font-black" style={{ color: labelColor }}>{avg}</p>
        </div>
      </div>

      {/* 5-dimension bars */}
      <div className="space-y-3 mb-4">
        {EQ_DIMS.map(({ key, label, color }) => {
          const val = eqProfile[key] || 0
          return (
            <div key={key} className="flex items-center gap-3">
              <span className="text-xs text-muted w-36 flex-shrink-0">{label}</span>
              <div className="flex-1 rounded-full h-2.5" style={{ background: 'var(--color-surface-3)' }}>
                <div className="h-2.5 rounded-full transition-all duration-700"
                  style={{ width: `${val}%`, background: color }} />
              </div>
              <span className="text-xs font-bold w-10 text-right flex-shrink-0" style={{ color }}>{val}</span>
            </div>
          )
        })}
      </div>

      {/* Summary */}
      {eqProfile.eq_summary && (
        <div className="rounded-lg px-4 py-3"
          style={{ background: 'rgba(236,72,153,0.05)', borderLeft: '3px solid rgba(236,72,153,0.4)' }}>
          <p className="text-sm text-muted leading-relaxed italic">{eqProfile.eq_summary}</p>
        </div>
      )}
    </SectionCard>
  )
}

// ── Audio Clip Player ─────────────────────────────────────────────────────────

function AudioClipPlayer({ audioUrl, startSec, label }) {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)

  if (!audioUrl) return (
    <div className="flex items-center gap-1.5 mt-2 text-xs"
      style={{ color: 'var(--color-muted)', opacity: 0.5 }}>
      <Volume2 size={11} />
      <span>Audio not recorded for this session</span>
    </div>
  )

  const toggle = () => {
    const el = audioRef.current
    if (!el) return
    if (playing) {
      el.pause()
    } else {
      if (startSec != null && el.currentTime === 0) el.currentTime = startSec
      el.play()
    }
  }

  return (
    <div className="flex items-center gap-2 mt-2">
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-all"
        style={{
          background: playing ? 'rgba(124,58,237,0.2)' : 'var(--color-surface-2)',
          border: `1px solid ${playing ? 'rgba(124,58,237,0.5)' : 'var(--color-border)'}`,
          color: playing ? '#a78bfa' : 'var(--color-muted)',
        }}>
        {playing ? <Pause size={11} /> : <Play size={11} />}
        <Volume2 size={10} />
        {label || 'Review the Tape'}
      </button>
      {playing && (
        <div className="flex-1 max-w-[120px] h-1 rounded-full" style={{ background: 'var(--color-surface-3)' }}>
          <div className="h-full rounded-full transition-all duration-300"
            style={{ width: `${progress}%`, background: '#7c3aed' }} />
        </div>
      )}
      <audio
        ref={audioRef}
        src={audioUrl}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0) }}
        onTimeUpdate={() => {
          const el = audioRef.current
          if (!el || !el.duration) return
          setProgress((el.currentTime / el.duration) * 100)
        }}
      />
    </div>
  )
}

// ── Share / PDF Modal ─────────────────────────────────────────────────────────

function ShareModal({ report, sessionId, onClose }) {
  const [copied,        setCopied]        = useState(false)
  const [shareUrl,      setShareUrl]      = useState('')
  const [shareLoading,  setShareLoading]  = useState(false)
  const [shareError,    setShareError]    = useState('')
  const [urlCopied,     setUrlCopied]     = useState(false)
  const cardRef = useRef(null)

  const {
    overall_score = 0, grade, round_type = 'technical', difficulty,
    strong_areas = [], target_company, hire_recommendation,
  } = report

  const scoreCol = scoreColor(+overall_score)
  const ROUND_LABELS_SHORT = { technical: 'Technical', hr: 'HR', dsa: 'DSA', mcq_practice: 'MCQ', system_design: 'Legacy SD' }

  // Generate a backend share link
  const handleGenerateLink = async () => {
    if (!sessionId) return
    setShareLoading(true)
    setShareError('')
    try {
      const res = await generateShareLink(sessionId)
      if (res?.data?.share_url) {
        setShareUrl(res.data.share_url)
      } else {
        setShareError('Could not generate link. Try again.')
      }
    } catch (e) {
      setShareError(e?.response?.data?.detail || 'Failed to generate share link.')
    } finally {
      setShareLoading(false)
    }
  }

  const copyShareUrl = async () => {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl)
    setUrlCopied(true)
    setTimeout(() => setUrlCopied(false), 2000)
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const [exporting, setExporting] = useState(false)

  const printCard = async () => {
    const el = cardRef.current
    if (!el) return
    setExporting(true)
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ])
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#0a0014' })
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const pdfW = pdf.internal.pageSize.getWidth()
      const pdfH = (canvas.height * pdfW) / canvas.width
      pdf.addImage(imgData, 'PNG', 0, 0, pdfW, pdfH)
      const name = report.candidate_name ? report.candidate_name.replace(/\s+/g, '_') : 'Candidate'
      pdf.save(`AI_Interview_Report_${name}.pdf`)
    } catch (e) {
      console.error('PDF export failed:', e)
      window.print()
    } finally {
      setExporting(false)
    }
  }

  const strongList = strong_areas.slice(0, 3).map(a => {
    const { area } = typeof a === 'string' ? { area: a } : (a || {})
    return area
  }).filter(Boolean)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}>
      <div className="glass max-w-lg w-full p-6 space-y-5" style={{ border: '1px solid rgba(124,58,237,0.4)' }}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg">Share Report</h3>
          <button onClick={onClose} className="text-muted hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Shareable card preview */}
        <div ref={cardRef} className="rounded-2xl p-6 space-y-4"
          style={{ background: 'linear-gradient(135deg, #1a0a2e 0%, #0d1a2e 100%)', border: '1px solid rgba(124,58,237,0.4)' }}>
          {/* Top row */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted">AI Mock Interview</p>
              <p className="font-bold text-xl gradient-text">Interview Report</p>
            </div>
            <div className="text-right">
              <p className="text-4xl font-black" style={{ color: scoreCol }}>{+Number(overall_score).toFixed(0)}</p>
              <p className="text-xs text-muted">/ 100</p>
            </div>
          </div>
          {/* Meta */}
          <div className="flex flex-wrap gap-2">
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ background: 'rgba(124,58,237,0.2)', color: '#a78bfa' }}>
              {ROUND_LABELS_SHORT[round_type] || round_type}
            </span>
            {difficulty && (
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold capitalize"
                style={{ background: 'rgba(6,182,212,0.15)', color: '#06b6d4' }}>
                {difficulty}
              </span>
            )}
            {grade && (
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                style={{ background: `${scoreColor(+overall_score)}20`, color: scoreColor(+overall_score) }}>
                Grade {grade}
              </span>
            )}
            {hire_recommendation && (
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                style={{ background: 'rgba(74,222,128,0.15)', color: '#4ade80' }}>
                {hire_recommendation}
              </span>
            )}
          </div>
          {/* Strengths */}
          {strongList.length > 0 && (
            <div>
              <p className="text-xs text-muted mb-1.5">Key Strengths</p>
              <div className="space-y-1">
                {strongList.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <CheckCircle size={11} style={{ color: '#4ade80' }} />
                    <span>{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Footer */}
          {target_company && (
            <p className="text-xs text-muted">Target: <span className="text-cyan-400">{target_company}</span></p>
          )}
          <p className="text-xs text-muted pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
            Generated by AI Interviewer Platform
          </p>
        </div>

        {/* ── Public Shareable Link ───────────────────────────────────────── */}
        <div className="rounded-xl p-4 space-y-3"
          style={{ background: 'rgba(91,94,246,0.08)', border: '1px solid rgba(91,94,246,0.2)' }}>
          <p className="text-xs font-semibold text-muted uppercase tracking-wide flex items-center gap-1.5">
            <Users size={12} /> Public Share Link
          </p>
          {!shareUrl ? (
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted flex-1">
                Anyone with the link can view a summary of this report — no login needed.
              </p>
              <button
                onClick={handleGenerateLink}
                disabled={shareLoading}
                className="btn-primary text-xs py-1.5 px-3 flex-shrink-0 flex items-center gap-1.5"
                style={{ opacity: shareLoading ? 0.7 : 1 }}>
                {shareLoading ? 'Generating…' : 'Generate Link'}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={shareUrl}
                className="flex-1 text-xs px-3 py-2 rounded-lg font-mono truncate"
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                }}
              />
              <button
                onClick={copyShareUrl}
                className="flex items-center gap-1.5 text-xs py-2 px-3 rounded-lg transition-all"
                style={{
                  background: urlCopied ? 'rgba(74,222,128,0.15)' : 'var(--color-surface-2)',
                  border: `1px solid ${urlCopied ? '#4ade80' : 'var(--color-border)'}`,
                  color: urlCopied ? '#4ade80' : 'var(--color-muted)',
                }}>
                {urlCopied ? <Check size={13} /> : <Copy size={13} />}
                {urlCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          )}
          {shareError && <p className="text-xs" style={{ color: 'var(--color-error)' }}>{shareError}</p>}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button onClick={copyLink}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
            {copied ? <Check size={14} style={{ color: '#4ade80' }} /> : <Copy size={14} />}
            {copied ? 'Copied!' : 'Copy Page URL'}
          </button>
          <button onClick={printCard} disabled={exporting}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all btn-primary"
            style={{ opacity: exporting ? 0.7 : 1 }}>
            <Download size={14} />
            {exporting ? 'Exporting…' : 'Export PDF'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Loading State (SSE Progress) ──────────────────────────────────────────────

function ReportLoading({ stage, progress, label, isFirstGeneration }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="glass p-10 max-w-md w-full text-center space-y-6">
        <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #22d3ee)' }}>
          <Brain size={32} className="text-white" style={{ animation: 'pulse 1.5s infinite' }} />
        </div>
        <div>
          <h2 className="text-xl font-bold gradient-text mb-2">Generating Your Report</h2>
          <p className="text-muted text-sm">{label || 'Analyzing your session…'}</p>
          {isFirstGeneration && (
            <p className="mt-3 text-xs px-3 py-2 rounded-lg"
              style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)' }}>
              ⏳ First-time generation for this report (~45 seconds).
              Future visits will be instant.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted">
            <span>{label}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 rounded-full" style={{ background: 'var(--color-surface-3)' }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${progress}%`,
                background: 'linear-gradient(90deg, #7c3aed, #22d3ee)',
              }}
            />
          </div>
        </div>
        <div className="space-y-1">
          {SSE_STAGES.map((s) => (
            <div key={s.key} className="flex items-center gap-2 text-xs transition-all"
              style={{ color: progress >= s.pct ? 'var(--color-text)' : 'var(--color-muted)' }}>
              {progress >= s.pct
                ? <CheckCircle size={12} style={{ color: '#4ade80' }} />
                : <div className="w-3 h-3 rounded-full" style={{ background: 'var(--color-surface-3)' }} />
              }
              {s.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Custom Tooltips ───────────────────────────────────────────────────────────

// Theme-aware tooltip — uses CSS variables so it auto-adapts to light/dark mode.
// Used by MCQ charts where the legacy dark-only contentStyle was unreadable on light.
function ThemeTooltip({ active, payload, label, valueFormatter, labelFormatter }) {
  if (!active || !payload?.length) return null
  const formattedLabel = labelFormatter ? labelFormatter(label, payload) : label
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 8,
      padding: '8px 12px',
      boxShadow: 'var(--shadow-md)',
      fontSize: 12,
      color: 'var(--color-text)',
    }}>
      {formattedLabel != null && formattedLabel !== '' && (
        <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>{formattedLabel}</p>
      )}
      {payload.map((p, i) => {
        const formatted = valueFormatter ? valueFormatter(p.value, p.name, p.payload) : [`${p.value}`, p.name]
        const [val, name] = Array.isArray(formatted) ? formatted : [formatted, p.name]
        return (
          <p key={i} style={{ margin: 0, color: 'var(--color-muted)' }}>
            {name && <span>{name}: </span>}
            <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{val}</span>
          </p>
        )
      })}
    </div>
  )
}

function QTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload || {}
  return (
    <div className="glass p-3 text-xs max-w-xs" style={{ border: '1px solid rgba(124,58,237,0.4)' }}>
      <p className="font-semibold mb-1 text-sm" style={{ color: 'var(--color-text)' }}>{d.label}</p>
      <p className="text-muted">{d.question_text}</p>
      {d.skipped || d.score == null
        ? <p className="mt-1 text-yellow-400">Skipped</p>
        : <p className="mt-1" style={{ color: scoreColor(d.score * 10) }}>Score: {d.score}/10</p>
      }
    </div>
  )
}

function FillerTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload || {}
  return (
    <div className="glass p-3 text-xs max-w-xs" style={{ border: '1px solid rgba(251,146,60,0.4)' }}>
      <p className="font-semibold mb-1" style={{ color: 'var(--color-text)' }}>{d.question_id}</p>
      <p className="text-muted">Fillers: <span className="text-orange-400 font-bold">{d.filler_count}</span></p>
      {d.filler_words?.length > 0 && (
        <p className="text-muted mt-1">Words: {d.filler_words.slice(0, 5).join(', ')}</p>
      )}
      <p className="text-muted mt-1">Confidence: {d.confidence_score}/100</p>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ReportPage() {
  const { sessionId } = useParams()
  const navigate      = useNavigate()

  const [report,            setReport]            = useState(null)
  const [loading,           setLoading]           = useState(true)
  const [error,             setError]             = useState(null)
  const [stage,             setStage]             = useState('core_analysis')
  const [progress,          setProgress]          = useState(10)
  const [stageLabel,        setStageLabel]        = useState('Scoring your answers…')
  const [shareOpen,         setShareOpen]         = useState(false)
  const [checklistItems,    setChecklistItems]    = useState(null)
  const [checklistId,       setChecklistId]       = useState(null)
  // True when backend is generating via SSE (first time); false when returning cached JSON instantly.
  const [isFirstGeneration, setIsFirstGeneration] = useState(false)
  const [persistFailed,     setPersistFailed]     = useState(false)
  const [retryingSave,      setRetryingSave]      = useState(false)
  const [retrySaveSuccess,  setRetrySaveSuccess]  = useState(false)
  // Report quality tracking (Bug #3)
  const [reportQuality,     setReportQuality]     = useState('full')   // 'full' | 'partial' | 'degraded'
  const [failedSections,    setFailedSections]    = useState([])       // list of section names that failed
  const [retryingStage,     setRetryingStage]     = useState(null)     // stage key currently retrying
  const [stageRetrySuccess, setStageRetrySuccess] = useState({})       // { stageKey: true } on success
  const [hrAudience,        setHrAudience]        = useState('candidate') // 'candidate' | 'committee'
  const rawReportRef    = useRef(null)  // holds report payload for retry without re-render
  const startSSERef     = useRef(null)  // ref to startSSE so the error-screen "Try Again" can call it
  const sseWatchdogRef  = useRef(null)  // client-side 6-min watchdog for the SSE stream

  const handleRetrySave = useCallback(async () => {
    const payload = rawReportRef.current
    if (!payload || retryingSave) return
    setRetryingSave(true)
    try {
      const res = await retrySaveReport(sessionId, payload)
      if (res?.data?.saved) {
        setPersistFailed(false)
        setRetrySaveSuccess(true)
        const cacheKey = `report_${sessionId}`
        try { sessionStorage.setItem(cacheKey, JSON.stringify(payload)) } catch (_) {}
      }
    } catch (_) {
      // banner stays visible; user can click "Try Again" manually
    } finally {
      setRetryingSave(false)
    }
  }, [sessionId, retryingSave])

  const handleRetryStage = useCallback(async (stageKey) => {
    if (retryingStage) return
    setRetryingStage(stageKey)
    try {
      const res = await retryStages(sessionId, [stageKey])
      if (res?.data?.report) {
        const merged = res.data.report
        rawReportRef.current = merged
        setReport(merged)
        setReportQuality(res.data.report_quality ?? 'full')
        setFailedSections(res.data.failed_sections ?? [])
        setStageRetrySuccess(prev => ({ ...prev, [stageKey]: true }))
        // Update sessionStorage with merged payload
        try { sessionStorage.setItem(`report_${sessionId}`, JSON.stringify(merged)) } catch (_) {}
      }
    } catch (_) {
      // retry card stays visible; user can try again
    } finally {
      setRetryingStage(null)
    }
  }, [sessionId, retryingStage])

  useEffect(() => {
    if (!sessionId) return

    const cacheKey = `report_${sessionId}`

    function applyReport(reportData, persistStatus = 'saved') {
      rawReportRef.current = reportData
      setReport(reportData)
      if (reportData?.checklist?.length > 0) setChecklistItems(reportData.checklist)
      // Sync quality metadata so UI can show retry cards / degraded state
      setReportQuality(reportData?.report_quality ?? 'full')
      setFailedSections(reportData?.failed_sections ?? [])

      if (persistStatus === 'saved') {
        // Only cache locally when the DB save succeeded — otherwise a refresh
        // would serve stale sessionStorage instead of triggering a real re-fetch.
        try { sessionStorage.setItem(cacheKey, JSON.stringify(reportData)) } catch (_) {}
      } else {
        setPersistFailed(true)
        // Auto-retry once after 4 seconds to handle transient DB hiccups.
        setTimeout(() => {
          setRetryingSave(prev => {
            if (prev) return prev  // already retrying
            retrySaveReport(sessionId, reportData)
              .then(res => {
                if (res?.data?.saved) {
                  setPersistFailed(false)
                  setRetrySaveSuccess(true)
                  try { sessionStorage.setItem(cacheKey, JSON.stringify(reportData)) } catch (_) {}
                }
              })
              .catch(() => {})  // banner stays; user can click manually
              .finally(() => setRetryingSave(false))
            return true  // mark as retrying
          })
        }, 4000)
      }

      setLoading(false)
    }

    function startSSE() {
      // 6-minute client-side watchdog — defence-in-depth on top of the 5-min AbortController
      // in api.js (C1 fix). Fires only if neither onComplete nor onError was called first.
      clearTimeout(sseWatchdogRef.current)
      sseWatchdogRef.current = setTimeout(() => {
        setError('Report generation is taking too long. Click "Try Again" to retry.')
        setLoading(false)
      }, 6 * 60 * 1000)

      // Detect first-time generation: SSE sends progress events; cached JSON never does.
      let receivedProgressEvent = false
      getReportWithSSE(
        sessionId,
        (evt) => {
          if (!receivedProgressEvent) {
            receivedProgressEvent = true
            setIsFirstGeneration(true)
          }
          setStage(evt.stage)
          setProgress(Math.max(0, evt.progress || 10))
          setStageLabel(evt.label || 'Processing…')
        },
        (reportData, persistStatus) => {
          clearTimeout(sseWatchdogRef.current)
          applyReport(reportData, persistStatus)
        },
        (errMsg) => {
          clearTimeout(sseWatchdogRef.current)
          setError(errMsg || 'Failed to load report.')
          setLoading(false)
        },
      )
    }

    // Store reference so the error-screen "Try Again" button can re-invoke SSE.
    startSSERef.current = startSSE

    // Mock route: /report/mock-hr or /report/mock-technical — no auth needed
    if (sessionId.startsWith('mock-')) {
      const roundType = sessionId.replace('mock-', '')
      fetch(`/api/v1/report/${sessionId}?round_type=${roundType}`)
        .then(r => r.json())
        .then(json => {
          if (json?.data) applyReport(json.data)
          else setError('Mock report failed to load.')
        })
        .catch(() => setError('Could not reach backend. Is it running on port 8000?'))
      return
    }

    // Layer 1: sessionStorage — instant, no network needed
    try {
      const stored = sessionStorage.getItem(cacheKey)
      if (stored) {
        applyReport(JSON.parse(stored))
        return
      }
    } catch (_) {}

    // Layer 2: cached-only endpoint — fast DB read, never triggers SSE generation
    getCachedReportOnly(sessionId)
      .then((reportData) => {
        if (reportData) {
          applyReport(reportData)
          // If the report row exists but save_report succeeded while status updates
          // failed (race condition fix), silently repair the status columns now.
          if (reportData.report_status === 'persist_failed') {
            retrySaveReport(sessionId, reportData).catch(() => {})
          }
        } else {
          // Layer 3: SSE — report not yet cached, stream the full 4-stage pipeline
          startSSE()
        }
      })
      .catch(() => startSSE())
  }, [sessionId])

  // Fetch checklist_id for this session so we can call toggle API
  useEffect(() => {
    if (!sessionId) return
    getUserChecklists(10, sessionId).then(res => {
      const match = res?.data?.checklists?.find(c => c.session_id === sessionId)
      if (match) {
        setChecklistId(match.id)
        // Fallback: if SSE/cache didn't carry items, use the DB copy.
        // Functional updater reads CURRENT state to avoid stale-closure overwrite.
        if (match.items?.length > 0) {
          // C3 fix: use DB items if state is null OR empty [] — prev?.length > 0 is the
          // correct guard because applyReport may set [] from an SSE payload with no
          // checklist yet, and `prev ?? match.items` would wrongly keep the empty array.
          setChecklistItems(prev => (prev?.length > 0 ? prev : match.items))
        }
      }
    }).catch(() => {})
  }, [sessionId])

  if (loading) return <ReportLoading stage={stage} progress={progress} label={stageLabel} isFirstGeneration={isFirstGeneration} />
  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="glass p-8 max-w-md text-center">
        <XCircle size={40} className="text-red-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold mb-2">Report Error</h2>
        <p className="text-muted mb-6 text-sm">{error}</p>
        <div className="flex gap-3 justify-center flex-wrap">
          {startSSERef.current && (
            <button
              onClick={() => {
                setError(null)
                setLoading(true)
                setProgress(10)
                setStage('core_analysis')
                setStageLabel('Scoring your answers…')
                startSSERef.current()
              }}
              className="btn-primary"
            >
              Try Again
            </button>
          )}
          <button onClick={() => navigate('/dashboard')} className="btn-secondary">Back to Dashboard</button>
        </div>
      </div>
    </div>
  )

  const {
    overall_score = 0, round_type = 'technical', difficulty = '',
    num_questions = 0, timer_mins = 0, grade, hire_recommendation,
    summary = '', compared_to_level = '',
    session_label = '',

    // Core
    skill_ratings = [], question_scores = [], per_question_analysis = [],
    strong_areas = [], weak_areas = [], red_flags = [],
    hire_signal = {}, failure_patterns = [], study_recommendations = [],
    interview_tips = [], cv_audit = {}, study_roadmap = {},
    mock_ready_topics = [], not_ready_topics = [],
    target_company = '', candidate_name = '',

    // New fields
    what_went_wrong, improvement_vs_last, repeated_offenders = [],
    communication_breakdown = {}, six_axis_radar = {},
    delivery_consistency = {}, filler_heatmap = [],
    pattern_groups = [], blind_spots = [], bs_flag = [],
    company_fit, skill_decay = [],
    swot = {}, skills_to_work_on = [], thirty_day_plan = {},
    auto_resources = [], follow_up_questions = [],
    proctoring_summary = {}, interview_integrity = null,
    next_interview_blueprint,
    // Phase 2: Code quality
    code_quality_metrics = null,
    // Phase 4: Peer comparison
    peer_comparison = null,
    // Phase 5: Adaptive study schedule
    study_schedule = null,
    // Phase 6: Preparation checklist
    checklist: reportChecklist = [],
    // Phase 2 MCQ: per-category accuracy breakdown (always an array)
    category_breakdown = [],
    // HR-specific behavioral fields
    star_story_matrix = [],
    behavioral_category_coverage = [],
    communication_pattern = '',
    culture_fit_narrative = '',
    behavioral_red_flags = [],
    // HR Phase 1 — Professional Report Fields
    key_signals = [],
    competency_scorecard = [],
    hire_confidence = '',
    interview_datetime = '',
    job_role = '',
    // HR Phase 2 — Visual Enhancement Fields
    culture_fit_dimensions = [],
    eq_profile = {},
    // HR Phase 3 — Coaching & Confidence Fields
    coachability_index = {},
    leadership_ic_fit = {},
    reference_check_triggers = [],
    assessment_confidence = {},
    // HR Report Enhancement — Group A
    explicit_red_flags = [],
    seniority_calibration = {},
    answer_depth_progression = {},
    // HR Report Enhancement — Group B
    peer_benchmarking = {},
    role_gap_analysis = {},
    story_uniqueness = {},
    model_answer_comparison = [],
    // HR Report Enhancement — Group C
    pipeline_followup_questions = [],
    hr_improvement_plan = {},
    executive_brief = {},
    // Debug mode flag — set by backend when GROQ_API_KEY is missing
    _debug_mock = false,
  } = report

  const overall = +Number(overall_score).toFixed(1)

  // Recharts datasets
  const radarData = Object.entries(six_axis_radar || {}).map(([k, v]) => ({
    subject: k, A: +Number(v).toFixed(1), fullMark: 100,
  }))
  const legacyRadarData = (skill_ratings || []).map(s => ({
    subject: s.skill, A: +Number(s.score).toFixed(1), fullMark: 10,
  }))

  // C2 fix: pick the best source array, then normalise every field so chart code
  // never receives string-"null", NaN, or undefined values.
  const _qaSource = per_question_analysis?.length
    ? per_question_analysis
    : question_scores?.length
      ? question_scores
      : []
  const qaData = _qaSource.map((q, i) => {
    const isSkipped  = q.skipped || false
    const rawScore   = q.score == null ? null : Number(q.score)
    const safeScore  = (isSkipped || rawScore == null || isNaN(rawScore)) ? null : rawScore
    return {
      label:         `Q${i + 1}`,
      question_text: (q.question_text || q.question || `Question ${i + 1}`).trim(),
      score:         safeScore,
      skipped:       isSkipped,
      verdict:       q.verdict  || '',
      feedback:      q.feedback || '',
    }
  })

  const fillerData = (filler_heatmap ?? []).map(f => ({
    question_id: f.question_id, filler_count: f.filler_count || 0,
    confidence_score: f.confidence_score || 0, filler_words: f.filler_words || [],
  }))

  const deliveryArc = ((delivery_consistency ?? {}).arc_plot ?? []).map((v, i) => ({
    q: `Q${i + 1}`, confidence: v,
  }))

  // MCQ category breakdown — filter out zero-total entries to prevent NaN accuracy (C2 fix)
  const mcqCategoryData = (Array.isArray(category_breakdown) ? category_breakdown : [])
    .filter(d => (d.total ?? 0) > 0)
    .map(d => ({
      category: d.category || 'Uncategorized',
      accuracy: d.accuracy ?? 0,
      correct:  d.correct  ?? 0,
      total:    d.total,
    }))

  return (
    <div className="min-h-screen pt-20 pb-16 px-4">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* ── Debug Mode Banner ───────────────────────────────────────────── */}
        {_debug_mock && (
          <div className="rounded-2xl p-4 flex items-start gap-3"
            style={{ background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.4)' }}>
            <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" style={{ color: '#eab308' }} />
            <div>
              <p className="font-semibold text-sm" style={{ color: '#eab308' }}>
                DEBUG MODE — Simulated Report
              </p>
              <p className="text-xs text-muted mt-0.5">
                This is fake data. Connect a <code className="text-yellow-400">GROQ_API_KEY</code> in your backend
                environment to generate real AI-powered reports.
              </p>
            </div>
          </div>
        )}

        {/* ── Persist-Failed Warning Banner ───────────────────────────────── */}
        {persistFailed && !retrySaveSuccess && (
          <div className="rounded-xl px-4 py-3 flex items-center justify-between gap-4"
            style={{
              background: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.35)',
            }}>
            <div className="flex items-center gap-2 text-sm" style={{ color: '#f59e0b' }}>
              <AlertTriangle size={16} className="flex-shrink-0" />
              <span>
                <strong>Report not saved.</strong> Your results are shown but weren't stored —
                refreshing this page may lose them.
              </span>
            </div>
            <button
              onClick={handleRetrySave}
              disabled={retryingSave}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg flex-shrink-0 transition-all"
              style={{
                background: retryingSave ? 'rgba(245,158,11,0.15)' : 'rgba(245,158,11,0.25)',
                border: '1px solid rgba(245,158,11,0.5)',
                color: '#f59e0b',
                opacity: retryingSave ? 0.7 : 1,
                cursor: retryingSave ? 'not-allowed' : 'pointer',
              }}>
              {retryingSave ? 'Saving…' : 'Try Again'}
            </button>
          </div>
        )}

        {/* ── Persist-Success Confirmation Banner ─────────────────────────── */}
        {retrySaveSuccess && (
          <div className="rounded-xl px-4 py-3 flex items-center gap-2 text-sm"
            style={{
              background: 'rgba(74,222,128,0.1)',
              border: '1px solid rgba(74,222,128,0.3)',
              color: '#4ade80',
            }}>
            <CheckCircle size={16} className="flex-shrink-0" />
            <span>Report saved successfully. This page is now permanent.</span>
          </div>
        )}

        {/* ── Partial Report Banner (some sections failed) ─────────────────── */}
        {reportQuality === 'partial' && failedSections.length > 0 && (
          <div className="rounded-xl px-4 py-3 flex items-center gap-3 text-sm"
            style={{
              background: 'rgba(245,158,11,0.08)',
              border: '1px solid rgba(245,158,11,0.3)',
              color: '#f59e0b',
            }}>
            <AlertTriangle size={16} className="flex-shrink-0" />
            <span>
              <strong>Some sections of this report are incomplete.</strong>{' '}
              Our AI service was temporarily unavailable for certain stages.
              Use the <strong>Regenerate Section</strong> buttons below to fill them in.
            </span>
          </div>
        )}

        {/* ── Degraded Report State (core analysis failed) ─────────────────── */}
        {reportQuality === 'degraded' && (
          <div className="rounded-xl p-6 text-center"
            style={{
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.3)',
            }}>
            <div style={{ fontSize: 36 }}>⚠</div>
            <h3 className="text-lg font-bold mt-3" style={{ color: '#f87171' }}>
              Report generation was interrupted
            </h3>
            <p className="text-sm text-muted mt-2 max-w-md mx-auto">
              The core analysis stage failed — your scores and radar chart couldn't be computed.
              This usually happens when our AI service is temporarily overloaded.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-5 py-2 rounded-lg text-sm font-semibold"
              style={{
                background: 'rgba(239,68,68,0.2)',
                border: '1px solid rgba(239,68,68,0.4)',
                color: '#f87171',
                cursor: 'pointer',
              }}>
              Regenerate Full Report
            </button>
          </div>
        )}

        {/* ── HR Phase 1: Professional Document Header ────────────────────── */}
        {round_type === 'hr' && (
          <HRDocumentHeader
            candidateName={candidate_name}
            jobRole={job_role}
            difficulty={difficulty}
            interviewDatetime={interview_datetime}
            sessionId={sessionId}
            overallScore={overall}
            grade={grade}
            hireRecommendation={hire_recommendation}
            numQuestions={num_questions}
            timerMins={timer_mins}
          />
        )}

        {/* ── Nav ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold gradient-text mb-1">Interview Report</h1>
            {session_label && (
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-2)' }}>{session_label}</p>
            )}
            <p className="text-muted text-sm">
              {ROUND_LABELS[round_type]} · {difficulty} · {num_questions} Qs · {timer_mins}m
              {target_company && <> · <span className="text-purple-400">{target_company}</span></>}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap no-print">
            <button onClick={() => window.print()}
              className="flex items-center gap-1.5 btn-secondary text-sm py-2 px-4">
              <Download size={14} /> Download PDF
            </button>
            <button onClick={() => setShareOpen(true)}
              className="flex items-center gap-1.5 btn-secondary text-sm py-2 px-4">
              <Share2 size={14} /> Share
            </button>
            <button onClick={() => navigate('/dashboard')} className="btn-secondary text-sm py-2 px-4">
              <Home size={14} /> Dashboard
            </button>
            <button onClick={() => navigate('/')} className="btn-primary text-sm py-2 px-4">
              <RotateCcw size={14} /> New Interview
            </button>
          </div>
        </div>

        {/* Share Modal */}
        {shareOpen && report && (
          <ShareModal report={report} sessionId={sessionId} onClose={() => setShareOpen(false)} />
        )}

        {/* ── What Went Wrong callout ─────────────────────────────────────── */}
        {what_went_wrong && (
          <div className="rounded-2xl p-5 flex gap-4 animate-fade-in-up"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-400 text-sm mb-1">What Went Wrong</p>
              <p className="text-sm leading-relaxed">{what_went_wrong}</p>
            </div>
          </div>
        )}

        {/* ── HR Phase 1: Executive Summary Panel ─────────────────────────── */}
        {round_type === 'hr' && (
          <SectionErrorBoundary>
            <HRExecutiveSummary
              hireRecommendation={hire_recommendation}
              hireConfidence={hire_confidence}
              summary={summary}
              grade={grade}
              comparedToLevel={compared_to_level}
              keySignals={key_signals}
            />
          </SectionErrorBoundary>
        )}

        {/* ── Repeated Offenders alert ────────────────────────────────────── */}
        {repeated_offenders?.length > 0 && (
          <div className="rounded-2xl p-4 flex gap-3"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
            <Flame size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-400 text-sm mb-1">
                Recurring Issues ({repeated_offenders.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {repeated_offenders.map((r, i) => (
                  <Chip key={i} label={`${r?.issue ?? 'Unknown'} ×${r?.count_across_sessions ?? 0}`} color="#f59e0b" />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Hero Score Card ─────────────────────────────────────────────── */}
        <div className="glass p-8 flex flex-col sm:flex-row items-center gap-8">
          <ScoreRing score={overall} size={140} max={100} />
          <div className="flex-1 text-center sm:text-left">
            <div className="flex items-center gap-3 justify-center sm:justify-start mb-2 flex-wrap">
              <Trophy size={22} style={{ color: gradeColor(grade) }} />
              <span className="text-4xl font-bold" style={{ color: gradeColor(grade) }}>
                {grade || 'N/A'}
              </span>
              {hire_recommendation && (
                <span className="text-sm px-3 py-1 rounded-full font-semibold"
                  style={{ background: `${hireColor(hire_recommendation)}20`, color: hireColor(hire_recommendation) }}>
                  {hire_recommendation}
                </span>
              )}
            </div>
            {/* Improvement delta */}
            {improvement_vs_last && (
              <div className="flex items-center gap-2 mb-2">
                {improvement_vs_last.score_delta > 0
                  ? <ArrowUp size={14} className="text-green-400" />
                  : improvement_vs_last.score_delta < 0
                    ? <ArrowDown size={14} className="text-red-400" />
                    : <Minus size={14} className="text-muted" />
                }
                <span className="text-sm font-semibold"
                  style={{ color: improvement_vs_last.score_delta > 0 ? '#4ade80' : improvement_vs_last.score_delta < 0 ? '#f87171' : '#94a3b8' }}>
                  {improvement_vs_last.score_delta > 0 ? '+' : ''}{improvement_vs_last.score_delta} vs last {ROUND_LABELS[round_type]}
                </span>
              </div>
            )}
            <p className="text-muted text-sm leading-relaxed max-w-xl">{summary}</p>
            {compared_to_level && (
              <p className="text-xs text-purple-400 mt-2 italic">{compared_to_level}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 flex-shrink-0">
            {[
              { label: 'Total Qs',  val: num_questions },
              { label: 'Answered',  val: qaData.filter(q => !q.skipped && q.score != null).length },
              { label: 'Score',     val: `${overall}` },
              { label: 'Grade',     val: grade || '—' },
            ].map(({ label, val }) => (
              <div key={label} className="text-center p-3 rounded-xl"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                <p className="font-bold text-lg leading-none">{val}</p>
                <p className="text-xs text-muted mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            MCQ PRACTICE — In-depth analytics (mcq_practice only)
           ══════════════════════════════════════════════════════════════════ */}
        {round_type === 'mcq_practice' && (() => {
          // question_scores has raw MCQ fields (is_correct, selected_option, etc.)
          const mcqAnswers  = (question_scores?.length ? question_scores : per_question_analysis) || []
          const totalQ      = mcqAnswers.length || num_questions
          const correctQ    = mcqAnswers.filter(q => q.is_correct === true).length
          const incorrectQ  = mcqAnswers.filter(q => q.is_correct === false && !q.skipped).length
          const skippedQ    = mcqAnswers.filter(q => q.skipped).length
          const accuracyPct = totalQ > 0 ? Math.round((correctQ / totalQ) * 100) : 0

          // Time analysis (only entries with time data)
          const timedQ    = mcqAnswers.filter(q => (q.time_taken_seconds ?? 0) > 0)
          const avgTime   = timedQ.length > 0
            ? Math.round(timedQ.reduce((s, q) => s + (q.time_taken_seconds || 0), 0) / timedQ.length)
            : null
          const quickCount = timedQ.filter(q => q.time_taken_seconds < 15).length
          const slowCount  = timedQ.filter(q => q.time_taken_seconds > 90).length

          // Difficulty breakdown
          const diffBuckets = {
            easy:   { label: 'Easy',   color: '#4ade80', bg: 'rgba(74,222,128,0.09)',   border: 'rgba(74,222,128,0.25)',   c: 0, t: 0 },
            medium: { label: 'Medium', color: '#facc15', bg: 'rgba(250,204,21,0.09)',   border: 'rgba(250,204,21,0.25)',   c: 0, t: 0 },
            hard:   { label: 'Hard',   color: '#f87171', bg: 'rgba(248,113,113,0.09)',  border: 'rgba(248,113,113,0.25)',  c: 0, t: 0 },
          }
          mcqAnswers.forEach(q => {
            const d = (q.difficulty || '').toLowerCase()
            if (diffBuckets[d]) {
              diffBuckets[d].t++
              if (q.is_correct) diffBuckets[d].c++
            }
          })
          const hasDiffData = Object.values(diffBuckets).some(b => b.t > 0)

          // Topic accuracy (prefer category_breakdown from backend, else build from answers)
          const topicMap = {}
          mcqAnswers.forEach(q => {
            const t = q.topic || q.category || 'General'
            if (!topicMap[t]) topicMap[t] = { correct: 0, total: 0 }
            topicMap[t].total++
            if (q.is_correct) topicMap[t].correct++
          })
          const topicData    = mcqCategoryData.length > 0
            ? mcqCategoryData
            : Object.entries(topicMap).map(([t, v]) => ({
                category: t,
                accuracy: v.total > 0 ? Math.round((v.correct / v.total) * 100) : 0,
                correct: v.correct, total: v.total,
              }))
          const sortedTopics = [...topicData].sort((a, b) => b.total - a.total)
          const weakTopics   = sortedTopics.filter(t => t.accuracy < 60)
          const strongTopics = sortedTopics.filter(t => t.accuracy >= 80)

          // Option label helper
          const optLabel = idx => (idx != null && idx >= 0 && idx < 26)
            ? String.fromCharCode(65 + idx) : '?'
          const timeBadgeColor = secs =>
            secs < 15 ? '#f87171' : secs > 90 ? '#f59e0b' : '#94a3b8'

          return (
            <>
              {/* ── 1: Performance Summary Grid ─────────────────────────────── */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  {
                    label: 'Accuracy',
                    val: `${accuracyPct}%`,
                    sub: accuracyPct >= 80 ? 'Excellent' : accuracyPct >= 60 ? 'Good' : accuracyPct >= 40 ? 'Needs Work' : 'Poor',
                    color: accuracyPct >= 80 ? '#4ade80' : accuracyPct >= 60 ? '#facc15' : accuracyPct >= 40 ? '#fb923c' : '#f87171',
                    icon: <Target size={14} />,
                  },
                  {
                    label: 'Score',
                    val: `${correctQ}/${totalQ}`,
                    sub: `${incorrectQ} wrong · ${skippedQ} skip`,
                    color: '#4ade80',
                    icon: <CheckCircle size={14} />,
                  },
                  {
                    label: 'Avg Time / Q',
                    val: avgTime != null ? `${avgTime}s` : '—',
                    sub: avgTime != null ? (avgTime < 30 ? 'Fast pace' : avgTime > 75 ? 'Careful' : 'Normal pace') : 'No data',
                    color: avgTime != null ? (avgTime < 30 ? '#4ade80' : avgTime > 75 ? '#f59e0b' : '#94a3b8') : '#4b5563',
                    icon: <Timer size={14} />,
                  },
                  {
                    label: 'Grade',
                    val: grade || (accuracyPct >= 90 ? 'A+' : accuracyPct >= 80 ? 'A' : accuracyPct >= 70 ? 'B+' : accuracyPct >= 60 ? 'B' : accuracyPct >= 50 ? 'C' : 'D'),
                    sub: hire_recommendation || (accuracyPct >= 70 ? 'Hire' : 'Needs Prep'),
                    color: accuracyPct >= 80 ? '#4ade80' : accuracyPct >= 60 ? '#facc15' : '#f87171',
                    icon: <Trophy size={14} />,
                  },
                ].map(({ label, val, sub, color, icon }) => (
                  <div key={label} className="glass p-4 rounded-2xl flex flex-col gap-1.5"
                    style={{ border: '1px solid var(--color-border)' }}>
                    <div className="flex items-center gap-1.5 mb-0.5" style={{ color: '#6b7280' }}>
                      {icon}
                      <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
                    </div>
                    <p className="text-2xl font-bold tabular-nums" style={{ color }}>{val}</p>
                    <p className="text-[10.5px]" style={{ color: '#6b7280' }}>{sub}</p>
                  </div>
                ))}
              </div>

              {/* ── 2: Difficulty Breakdown ──────────────────────────────────── */}
              {hasDiffData && (
                <SectionCard icon={<Layers size={16}/>} title="Performance by Difficulty" color="#6366f1">
                  <p className="text-xs text-muted mb-4">How you performed across each difficulty tier.</p>
                  <div className="grid grid-cols-3 gap-3">
                    {Object.entries(diffBuckets).map(([key, d]) => {
                      if (d.t === 0) return null
                      const acc = Math.round((d.c / d.t) * 100)
                      return (
                        <div key={key} className="rounded-xl p-4 text-center flex flex-col gap-2"
                          style={{ background: d.bg, border: `1px solid ${d.border}` }}>
                          <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: d.color }}>{d.label}</p>
                          <p className="text-2xl font-bold tabular-nums" style={{ color: d.color }}>{acc}%</p>
                          <p className="text-[10.5px]" style={{ color: '#6b7280' }}>{d.c} / {d.t} correct</p>
                          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-3)' }}>
                            <div className="h-full rounded-full transition-all duration-1000"
                              style={{ width: `${acc}%`, background: d.color }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </SectionCard>
              )}

              {/* ── 3: Topic Accuracy Breakdown ──────────────────────────────── */}
              {sortedTopics.length > 0 && (
                <SectionCard icon={<BarChart2 size={16}/>} title="Topic Accuracy Breakdown" color="#f59e0b">
                  <p className="text-xs text-muted mb-4">
                    Per-topic accuracy. Topics below 60% are your study focus areas.
                  </p>
                  <div className="space-y-3 mb-5">
                    {sortedTopics.map(({ category: cat, accuracy, correct, total: tot }) => (
                      <div key={cat}>
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-sm font-medium">{cat}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-xs" style={{ color: '#6b7280' }}>{correct}/{tot}</span>
                            <span className="text-sm font-bold tabular-nums w-10 text-right" style={{
                              color: accuracy >= 80 ? '#4ade80' : accuracy >= 60 ? '#facc15' : '#f87171',
                            }}>{accuracy}%</span>
                          </div>
                        </div>
                        <div className="relative h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-3)' }}>
                          {/* 60% threshold marker */}
                          <div className="absolute top-0 bottom-0 w-px" style={{ left: '60%', background: 'var(--color-border-strong)' }} />
                          <div className="h-full rounded-full transition-all duration-1000"
                            style={{
                              width: `${accuracy}%`,
                              background: accuracy >= 80 ? 'linear-gradient(90deg,#4ade80,#22c55e)'
                                : accuracy >= 60 ? 'linear-gradient(90deg,#facc15,#f59e0b)'
                                : 'linear-gradient(90deg,#f59e0b,#f87171)',
                            }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[9.5px] text-muted mb-3">The vertical line at 60% marks the passing threshold.</p>
                  {/* Strong / Weak callout pills */}
                  {(weakTopics.length > 0 || strongTopics.length > 0) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {strongTopics.length > 0 && (
                        <div className="p-3 rounded-xl" style={{ background: 'rgba(74,222,128,0.07)', border: '1px solid rgba(74,222,128,0.22)' }}>
                          <p className="text-xs font-semibold mb-1.5" style={{ color: '#4ade80' }}>✓ Strong Areas</p>
                          <div className="flex flex-wrap gap-1.5">
                            {strongTopics.map(t => (
                              <span key={t.category} className="text-xs px-2 py-0.5 rounded-full"
                                style={{ background: 'rgba(74,222,128,0.12)', color: '#86efac', border: '1px solid rgba(74,222,128,0.28)' }}>
                                {t.category}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {weakTopics.length > 0 && (
                        <div className="p-3 rounded-xl" style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.22)' }}>
                          <p className="text-xs font-semibold mb-1.5" style={{ color: '#f87171' }}>⚑ Focus Areas</p>
                          <div className="flex flex-wrap gap-1.5">
                            {weakTopics.map(t => (
                              <span key={t.category} className="text-xs px-2 py-0.5 rounded-full"
                                style={{ background: 'rgba(248,113,113,0.12)', color: '#fca5a5', border: '1px solid rgba(248,113,113,0.28)' }}>
                                {t.category}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </SectionCard>
              )}

              {/* ── 4: Time Intelligence ─────────────────────────────────────── */}
              {timedQ.length > 0 && (
                <SectionCard icon={<Activity size={16}/>} title="Time Intelligence" color="#6366f1">
                  <p className="text-xs text-muted mb-4">
                    How long you spent per question. Very fast answers (&lt;15s) may indicate guessing; slow answers (&gt;90s) indicate uncertainty.
                  </p>
                  <div className="grid grid-cols-3 gap-3 mb-5">
                    {[
                      { label: 'Avg Time / Q', val: `${avgTime}s`, color: avgTime < 30 ? '#4ade80' : avgTime > 75 ? '#f59e0b' : '#94a3b8' },
                      { label: 'Quick (<15s)', val: quickCount, color: quickCount > 0 ? '#f87171' : '#4ade80', note: quickCount > 0 ? 'Possible guesses' : 'None' },
                      { label: 'Slow (>90s)', val: slowCount,  color: slowCount > 0 ? '#f59e0b' : '#4ade80',  note: slowCount > 0 ? 'Needed more time' : 'None' },
                    ].map(({ label, val, color, note }) => (
                      <div key={label} className="rounded-xl p-3 text-center"
                        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                        <p className="text-xl font-bold tabular-nums" style={{ color }}>{val}</p>
                        <p className="text-[10px] font-semibold mt-0.5" style={{ color: '#6b7280' }}>{label}</p>
                        {note && <p className="text-[9.5px] mt-0.5" style={{ color: '#4b5563' }}>{note}</p>}
                      </div>
                    ))}
                  </div>
                  {/* Per-question time bar chart */}
                  <ResponsiveContainer width="100%" height={90}>
                    <BarChart data={mcqAnswers.map((q, i) => ({
                      q: `Q${i + 1}`, t: q.time_taken_seconds || 0,
                      fill: (q.time_taken_seconds || 0) < 15 ? '#f87171' : (q.time_taken_seconds || 0) > 90 ? '#f59e0b' : '#6366f1',
                    }))} barGap={1} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                      <XAxis dataKey="q" tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        cursor={{ fill: 'rgba(99,102,241,0.08)' }}
                        content={
                          <ThemeTooltip
                            valueFormatter={(v) => [`${v}s`, 'Time']}
                          />
                        }
                      />
                      <Bar dataKey="t" radius={[3, 3, 0, 0]} maxBarSize={18}>
                        {mcqAnswers.map((q, i) => (
                          <Cell key={i} fill={timeBadgeColor(q.time_taken_seconds || 0)} opacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </SectionCard>
              )}

              {/* ── 4b: Answer Sequence Heatmap ─────────────────────────────── */}
              {mcqAnswers.length > 0 && (
                <SectionCard icon={<Activity size={16}/>} title="Answer Sequence" color="#22d3ee">
                  <p className="text-xs text-muted mb-3">
                    Question order vs outcome — useful for spotting fatigue clusters or momentum shifts.
                  </p>
                  <div className="flex items-center gap-4 mb-3 text-[10.5px]" style={{ color: 'var(--color-muted)' }}>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded" style={{ background: '#4ade80' }} />Correct
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded" style={{ background: '#f87171' }} />Incorrect
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded" style={{ background: 'rgba(148,163,184,0.45)' }} />Skipped
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {mcqAnswers.map((q, i) => {
                      const isSkip = q.skipped
                      const bg = isSkip ? 'rgba(148,163,184,0.45)'
                        : q.is_correct ? '#4ade80' : '#f87171'
                      const tipBits = [
                        `Q${i + 1}`,
                        q.topic || q.category || 'General',
                        `${q.time_taken_seconds || 0}s`,
                        isSkip ? 'Skipped' : q.is_correct ? 'Correct' : 'Incorrect',
                      ]
                      return (
                        <div key={i} title={tipBits.join(' · ')}
                          className="rounded transition-transform hover:scale-110 cursor-default"
                          style={{
                            width: 24, height: 24, background: bg,
                            fontSize: 10, color: '#fff', fontWeight: 700,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                          {i + 1}
                        </div>
                      )
                    })}
                  </div>
                  {(() => {
                    let bestRight = 0, bestWrong = 0, curR = 0, curW = 0
                    mcqAnswers.forEach(q => {
                      if (q.skipped) { curR = 0; curW = 0; return }
                      if (q.is_correct) { curR++; curW = 0; bestRight = Math.max(bestRight, curR) }
                      else              { curW++; curR = 0; bestWrong = Math.max(bestWrong, curW) }
                    })
                    return (
                      <div className="grid grid-cols-2 gap-3 mt-4">
                        <div className="rounded-xl p-3 text-center"
                          style={{ background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.25)' }}>
                          <p className="text-xl font-bold tabular-nums" style={{ color: '#4ade80' }}>{bestRight}</p>
                          <p className="text-[10px] font-semibold mt-0.5" style={{ color: 'var(--color-muted)' }}>Longest Hot Streak</p>
                        </div>
                        <div className="rounded-xl p-3 text-center"
                          style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.25)' }}>
                          <p className="text-xl font-bold tabular-nums" style={{ color: '#f87171' }}>{bestWrong}</p>
                          <p className="text-[10px] font-semibold mt-0.5" style={{ color: 'var(--color-muted)' }}>Longest Cold Streak</p>
                        </div>
                      </div>
                    )
                  })()}
                </SectionCard>
              )}

              {/* ── 4c: Time vs Accuracy Quadrant ────────────────────────────── */}
              {timedQ.length >= 3 && (
                <SectionCard icon={<Target size={16}/>} title="Time vs Accuracy Quadrant" color="#06b6d4">
                  <p className="text-xs text-muted mb-4">
                    Each dot is one question. The quadrants tell you <em>why</em> points were lost — not just where.
                  </p>
                  {(() => {
                    const avgT = avgTime || 30
                    const points = mcqAnswers
                      .map((q, i) => ({ q: i + 1, raw: q }))
                      .filter(({ raw }) => (raw.time_taken_seconds ?? 0) > 0 && !raw.skipped)
                      .map(({ q, raw }) => ({
                        q,
                        time: raw.time_taken_seconds,
                        // jitter binary correctness so overlapping dots are visible
                        correct: (raw.is_correct ? 1 : 0) + (((q * 7) % 19) / 100 - 0.09),
                        isCorrect: !!raw.is_correct,
                        topic: raw.topic || raw.category || 'General',
                      }))
                    const correctPts   = points.filter(p => p.isCorrect)
                    const incorrectPts = points.filter(p => !p.isCorrect)
                    const counts = {
                      qr: correctPts.filter(p => p.time <  avgT).length,
                      sr: correctPts.filter(p => p.time >= avgT).length,
                      rw: incorrectPts.filter(p => p.time <  avgT).length,
                      sw: incorrectPts.filter(p => p.time >= avgT).length,
                    }
                    const Quad = ({ bg, label, count, color, hint }) => (
                      <div className="rounded-xl p-3" style={{ background: bg, border: `1px solid ${color}40` }}>
                        <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color }}>{label}</p>
                        <p className="text-xl font-bold tabular-nums mt-0.5" style={{ color }}>{count}</p>
                        <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}>{hint}</p>
                      </div>
                    )
                    return (
                      <>
                        <ResponsiveContainer width="100%" height={230}>
                          <ScatterChart margin={{ top: 10, right: 14, bottom: 28, left: 6 }}>
                            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                            <XAxis type="number" dataKey="time" name="Time"
                              tick={{ fill: '#64748b', fontSize: 10 }}
                              label={{ value: 'Time (sec) →', position: 'insideBottom', offset: -10, fill: '#64748b', fontSize: 10 }} />
                            <YAxis type="number" dataKey="correct" domain={[-0.3, 1.3]}
                              ticks={[0, 1]} tickFormatter={(v) => v === 1 ? 'Correct' : v === 0 ? 'Wrong' : ''}
                              tick={{ fill: '#64748b', fontSize: 10 }} width={60} />
                            <ZAxis range={[60, 60]} />
                            <ReferenceLine x={avgT} stroke="#06b6d4" strokeDasharray="4 3" label={{ value: 'avg', fill: '#06b6d4', fontSize: 9, position: 'top' }} />
                            <ReferenceLine y={0.5} stroke="var(--color-border)" strokeDasharray="4 3" />
                            <Tooltip
                              cursor={{ stroke: '#06b6d4', strokeDasharray: '3 3' }}
                              content={
                                <ThemeTooltip
                                  valueFormatter={(_v, _n, p) => [
                                    `Q${p.q} · ${p.topic} · ${p.time}s · ${p.isCorrect ? 'Correct' : 'Wrong'}`,
                                    'Question',
                                  ]}
                                />
                              }
                            />
                            <Scatter data={correctPts}   fill="#4ade80" />
                            <Scatter data={incorrectPts} fill="#f87171" />
                          </ScatterChart>
                        </ResponsiveContainer>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4">
                          <Quad label="Quick & Right" count={counts.qr} color="#4ade80" bg="rgba(74,222,128,0.08)"  hint="Mastered" />
                          <Quad label="Slow & Right"  count={counts.sr} color="#22d3ee" bg="rgba(34,211,238,0.08)"  hint="Knew, hesitated" />
                          <Quad label="Rushed Wrong"  count={counts.rw} color="#fb923c" bg="rgba(251,146,60,0.08)"  hint="Carelessness" />
                          <Quad label="Stuck Wrong"   count={counts.sw} color="#f87171" bg="rgba(248,113,113,0.08)" hint="Genuine gap" />
                        </div>
                        <p className="text-[11px] mt-3 italic" style={{ color: 'var(--color-muted)' }}>
                          Vertical dashed line marks your average time. Reduce <em>Rushed Wrong</em> by slowing down; tackle <em>Stuck Wrong</em> with focused study.
                        </p>
                      </>
                    )
                  })()}
                </SectionCard>
              )}

              {/* ── 4d: Difficulty Performance Curve ─────────────────────────── */}
              {hasDiffData && (
                <SectionCard icon={<TrendingUp size={16}/>} title="Difficulty Performance Curve" color="#f59e0b">
                  <p className="text-xs text-muted mb-4">
                    How accuracy holds up as questions get harder — reveals your true skill ceiling.
                  </p>
                  {(() => {
                    const curve = ['easy', 'medium', 'hard']
                      .filter(d => diffBuckets[d].t > 0)
                      .map(d => ({
                        difficulty: diffBuckets[d].label,
                        accuracy: Math.round((diffBuckets[d].c / diffBuckets[d].t) * 100),
                        correct: diffBuckets[d].c,
                        count: diffBuckets[d].t,
                      }))
                    const drop = curve.length >= 2 ? curve[0].accuracy - curve[curve.length - 1].accuracy : 0
                    const verdict = drop <= 15 ? { txt: 'Steady — you handle harder questions well.', c: '#4ade80' }
                      : drop <= 35           ? { txt: 'Moderate drop — strengthen advanced concepts.', c: '#f59e0b' }
                      :                        { txt: 'Sharp drop — fundamentals need more depth.', c: '#f87171' }
                    return (
                      <>
                        <ResponsiveContainer width="100%" height={210}>
                          <LineChart data={curve} margin={{ top: 12, right: 20, bottom: 5, left: -10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                            <XAxis dataKey="difficulty" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                            <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`}
                              tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                            <Tooltip
                              cursor={{ stroke: '#f59e0b', strokeDasharray: '3 3' }}
                              content={
                                <ThemeTooltip
                                  valueFormatter={(_v, _n, p) => [`${p.accuracy}%  (${p.correct}/${p.count})`, 'Accuracy']}
                                />
                              }
                            />
                            <Line type="monotone" dataKey="accuracy" stroke="#f59e0b" strokeWidth={3}
                              dot={{ r: 6, fill: '#f59e0b', stroke: 'var(--color-surface)', strokeWidth: 2 }}
                              activeDot={{ r: 8 }} />
                          </LineChart>
                        </ResponsiveContainer>
                        <div className="mt-3 p-3 rounded-xl flex items-start gap-2.5"
                          style={{ background: `${verdict.c}14`, border: `1px solid ${verdict.c}40` }}>
                          <Activity size={13} style={{ color: verdict.c }} className="flex-shrink-0 mt-0.5" />
                          <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-2)' }}>
                            <span className="font-semibold" style={{ color: verdict.c }}>
                              {drop > 0 ? `${drop}-point drop` : 'No drop'}.
                            </span>{' '}
                            {verdict.txt}
                          </p>
                        </div>
                      </>
                    )
                  })()}
                </SectionCard>
              )}

              {/* ── 5: Study Recommendations (LLM-generated) ────────────────── */}
              {study_recommendations?.length > 0 && (
                <SectionCard icon={<Brain size={16}/>} title="AI Study Recommendations" color="#8b5cf6">
                  <p className="text-xs text-muted mb-4">
                    Personalized study plan based on your MCQ performance, generated by AI.
                  </p>
                  <div className="space-y-3">
                    {study_recommendations.slice(0, 8).map((rec, i) => {
                      const topic    = typeof rec === 'string' ? rec : (rec.topic || rec.area || rec.skill || `Topic ${i + 1}`)
                      const reason   = typeof rec === 'object' ? (rec.reason || rec.description || '') : ''
                      const priority = typeof rec === 'object' ? (rec.priority || 'medium') : 'medium'
                      const priColor = priority === 'high' ? '#f87171' : priority === 'low' ? '#4ade80' : '#facc15'
                      const priBg    = priority === 'high' ? 'rgba(248,113,113,0.10)' : priority === 'low' ? 'rgba(74,222,128,0.10)' : 'rgba(250,204,21,0.10)'
                      return (
                        <div key={i} className="flex items-start gap-3 p-3 rounded-xl"
                          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5"
                            style={{ background: priBg, color: priColor, border: `1px solid ${priColor}40` }}>
                            {priority.toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold leading-snug">{topic}</p>
                            {reason && <p className="text-xs text-muted mt-0.5 leading-relaxed">{reason}</p>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {/* Not-ready topics */}
                  {not_ready_topics?.length > 0 && (
                    <div className="mt-4 p-3 rounded-xl" style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)' }}>
                      <p className="text-xs font-semibold mb-2" style={{ color: '#f87171' }}>Not Interview-Ready</p>
                      <div className="flex flex-wrap gap-1.5">
                        {not_ready_topics.slice(0, 10).map((t, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 rounded-full"
                            style={{ background: 'rgba(248,113,113,0.12)', color: '#fca5a5', border: '1px solid rgba(248,113,113,0.28)' }}>
                            {typeof t === 'string' ? t : t.topic || t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </SectionCard>
              )}

              {/* ── 6: Per-Question Deep Review ──────────────────────────────── */}
              {mcqAnswers.length > 0 && (
                <SectionCard icon={<BookOpen size={16}/>} title="Question-by-Question Review" color="#f59e0b">
                  <p className="text-xs text-muted mb-4">
                    Expand any question to see the correct answer, your selection, and the explanation.
                  </p>
                  <div className="space-y-2">
                    {mcqAnswers.map((q, i) => {
                      const correct  = q.is_correct === true
                      const skipped  = q.skipped === true
                      const wrong    = !correct && !skipped
                      const timeSecs = q.time_taken_seconds ?? 0
                      const diff     = (q.difficulty || '').toLowerCase()
                      const diffClr  = diff === 'easy' ? '#86efac' : diff === 'hard' ? '#fca5a5' : '#fde68a'
                      const selIdx   = q.selected_option_index ?? -1
                      const corIdx   = q.correct_option_index  ?? -1

                      return (
                        <details key={i}
                          className="rounded-xl border overflow-hidden"
                          style={{
                            borderColor: correct ? 'rgba(74,222,128,0.28)' : skipped ? 'rgba(245,158,11,0.28)' : 'rgba(248,113,113,0.28)',
                            background:  correct ? 'rgba(74,222,128,0.04)' : skipped ? 'rgba(245,158,11,0.04)' : 'rgba(248,113,113,0.04)',
                          }}
                        >
                          {/* Summary row */}
                          <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer list-none select-none">
                            {/* Q# badge */}
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-[11px] font-bold"
                              style={{ background: 'var(--color-surface-3)' }}>
                              {i + 1}
                            </div>
                            {/* Correctness icon */}
                            {correct
                              ? <CheckCircle size={14} style={{ color: '#4ade80', flexShrink: 0 }} />
                              : skipped
                                ? <AlertTriangle size={14} style={{ color: '#f59e0b', flexShrink: 0 }} />
                                : <XCircle size={14} style={{ color: '#f87171', flexShrink: 0 }} />}
                            {/* Question text */}
                            <p className="text-sm flex-1 leading-snug line-clamp-1 min-w-0">
                              {q.question_text || q.question || `Question ${i + 1}`}
                            </p>
                            {/* Meta badges */}
                            <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                              {diff && (
                                <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded"
                                  style={{ background: `${diffClr}15`, color: diffClr, border: `1px solid ${diffClr}30` }}>
                                  {diff.charAt(0).toUpperCase() + diff.slice(1)}
                                </span>
                              )}
                              {timeSecs > 0 && (
                                <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded flex items-center gap-0.5"
                                  style={{ color: timeBadgeColor(timeSecs), background: `${timeBadgeColor(timeSecs)}12` }}>
                                  {timeSecs}s
                                </span>
                              )}
                              {q.topic && (
                                <span className="text-[9.5px] px-1.5 py-0.5 rounded hidden sm:inline"
                                  style={{ background: 'var(--color-surface-3)', color: 'var(--color-muted)' }}>
                                  {q.topic}
                                </span>
                              )}
                            </div>
                          </summary>

                          {/* Expanded detail */}
                          <div className="px-4 pb-4 pt-3 space-y-2.5 border-t" style={{ borderColor: 'var(--color-border)' }}>
                            {/* Your answer */}
                            <div className="flex items-start gap-2">
                              <span className="text-[10px] font-semibold uppercase tracking-wide flex-shrink-0 w-20 mt-0.5"
                                style={{ color: '#6b7280' }}>Your Answer</span>
                              {skipped
                                ? <span className="text-xs" style={{ color: '#f59e0b' }}>Skipped</span>
                                : selIdx >= 0
                                  ? <span className="text-xs font-semibold flex items-center gap-1.5"
                                      style={{ color: correct ? '#4ade80' : '#f87171' }}>
                                      <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                                        style={{ background: correct ? 'rgba(74,222,128,0.18)' : 'rgba(248,113,113,0.18)' }}>
                                        {optLabel(selIdx)}
                                      </span>
                                      {q.selected_option || ''}
                                    </span>
                                  : <span className="text-xs" style={{ color: '#6b7280' }}>No option selected</span>}
                            </div>
                            {/* Correct answer (only if wrong) */}
                            {wrong && corIdx >= 0 && (
                              <div className="flex items-start gap-2">
                                <span className="text-[10px] font-semibold uppercase tracking-wide flex-shrink-0 w-20 mt-0.5"
                                  style={{ color: '#6b7280' }}>Correct</span>
                                <span className="text-xs font-semibold flex items-center gap-1.5" style={{ color: '#4ade80' }}>
                                  <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                                    style={{ background: 'rgba(74,222,128,0.18)' }}>
                                    {optLabel(corIdx)}
                                  </span>
                                  {q.correct_option || ''}
                                </span>
                              </div>
                            )}
                            {/* Explanation */}
                            {q.explanation && (
                              <div className="flex items-start gap-2 pt-0.5">
                                <Zap size={11} className="flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
                                <p className="text-xs leading-relaxed" style={{ color: '#9ca3af' }}>{q.explanation}</p>
                              </div>
                            )}
                          </div>
                        </details>
                      )
                    })}
                  </div>
                </SectionCard>
              )}
            </>
          )
        })()}
        {/* ══ End MCQ sections ════════════════════════════════════════════════ */}

        {/* ── Failure Patterns ─────────────────────────────────────────────── */}
        {failure_patterns?.length > 0 && (
          <SectionCard icon={<AlertTriangle size={16}/>} title="What Went Wrong — Root Causes" color="#f87171">
            <p className="text-xs text-muted mb-3">These are the core patterns behind your low-scoring answers.</p>
            <div className="space-y-3">
              {failure_patterns.map((p, i) => {
                const text   = typeof p === 'string' ? p : p.pattern || ''
                const desc   = typeof p === 'object' ? (p.description || p.fix || '') : ''
                const affect = typeof p === 'object' ? (p.questions_affected || []) : []
                return (
                  <div key={i} className="p-4 rounded-xl"
                    style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)' }}>
                    <p className="font-semibold text-sm text-red-300 mb-1">{text}</p>
                    {affect.length > 0 && (
                      <p className="text-xs text-muted mb-1">Affected: {affect.join(', ')}</p>
                    )}
                    {desc && <p className="text-sm text-muted">{desc}</p>}
                  </div>
                )
              })}
            </div>
          </SectionCard>
        )}

        {/* ── Two-Radar Grid: Technical Knowledge + Hire Signal ────────────── */}
        {/* Hidden for MCQ — these radars assess verbal communication / hiring readiness.
            Hidden for DSA — DSA Performance Dashboard renders its own topic-mastery radar and hire signal. */}
        <SectionErrorBoundary>
        {round_type !== 'mcq_practice' && round_type !== 'dsa' && (legacyRadarData.length > 0 || Object.keys(hire_signal || {}).length >= 3) && (
          round_type === 'hr' ? (
            /* ── HR: Full-width 7-Axis Competency Radar + Hire Signal below ── */
            <div className="space-y-5">
              {legacyRadarData.length > 0 && (
                <SectionCard icon={<Brain size={16}/>} title="7-Axis Competency Radar" color="#ec4899">
                  <p className="text-xs text-muted mb-3">
                    Behavioral competency scores across all 7 assessment dimensions.
                  </p>
                  <ResponsiveContainer width="100%" height={300}>
                    <RadarChart data={legacyRadarData} margin={{ top: 10, right: 40, bottom: 10, left: 40 }}>
                      <PolarGrid stroke="var(--color-border)" />
                      <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 9 }} />
                      <Radar name="Score" dataKey="A" stroke="#ec4899" fill="#ec4899" fillOpacity={0.18}
                        dot={{ r: 3, fill: '#f472b6' }} />
                      <Tooltip formatter={(v) => [`${v}/100`, 'Score']}
                        contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)' }} />
                    </RadarChart>
                  </ResponsiveContainer>
                  {/* Bar fallback rows for scores */}
                  <div className="space-y-2 mt-3">
                    {legacyRadarData.map(d => (
                      <div key={d.subject} className="flex items-center gap-3">
                        <span className="text-xs text-muted w-44 flex-shrink-0 truncate">{d.subject}</span>
                        <div className="flex-1 rounded-full h-1.5" style={{ background: 'var(--color-surface-3)' }}>
                          <div className="h-1.5 rounded-full transition-all duration-500"
                            style={{ width: `${d.A}%`, background: scoreColor(d.A) }} />
                        </div>
                        <span className="text-xs font-semibold w-10 text-right flex-shrink-0"
                          style={{ color: scoreColor(d.A) }}>{d.A}</span>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}
              {Object.keys(hire_signal || {}).length >= 3 && (
                <SectionCard icon={<Target size={16}/>} title="Candidate Signal" color="#ec4899">
                  <p className="text-xs text-muted mb-3">
                    How a hiring manager would assess this candidate across 5 behavioral dimensions.
                  </p>
                  <HireSignalRadar hireSignal={hire_signal} roundType={round_type} />
                </SectionCard>
              )}
            </div>
          ) : (
            /* ── Technical/non-HR: original two-column grid ── */
            <div className={legacyRadarData.length > 0 ? 'grid grid-cols-1 lg:grid-cols-2 gap-5' : ''}>
              {legacyRadarData.length > 0 && (() => {
                const assessedAxes = legacyRadarData.filter(d => d.A > 0)
                const notAssessed  = legacyRadarData.filter(d => d.A === 0).map(d => d.subject)
                return (
                  <SectionCard icon={<Brain size={16}/>} title="Technical Knowledge Breakdown" color="#7c3aed">
                    <p className="text-xs text-muted mb-3">
                      Scores for CS domains actually covered in this session.
                      {notAssessed.length > 0 && (
                        <span className="text-amber-400"> Not assessed: {notAssessed.join(', ')}.</span>
                      )}
                    </p>
                    {assessedAxes.length >= 2 ? (
                      <ResponsiveContainer width="100%" height={260}>
                        <RadarChart data={assessedAxes} margin={{ top: 0, right: 30, bottom: 0, left: 30 }}>
                          <PolarGrid stroke="var(--color-border)" />
                          <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                          <Radar name="Score" dataKey="A" stroke="#7c3aed" fill="#7c3aed" fillOpacity={0.2}
                            dot={{ r: 3, fill: '#a78bfa' }} />
                          <Tooltip formatter={(v) => [`${v}/10`, 'Score']}
                            contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)' }} />
                        </RadarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="space-y-2">
                        {assessedAxes.map(d => (
                          <div key={d.subject} className="flex items-center gap-3">
                            <span className="text-sm text-muted w-36 flex-shrink-0">{d.subject}</span>
                            <div className="flex-1 rounded-full h-2" style={{ background: 'var(--color-surface-3)' }}>
                              <div className="h-2 rounded-full" style={{
                                width: `${d.A * 10}%`,
                                background: d.A >= 7 ? '#4ade80' : d.A >= 5 ? '#facc15' : '#f87171'
                              }} />
                            </div>
                            <span className="text-xs w-10 text-right" style={{
                              color: d.A >= 7 ? '#4ade80' : d.A >= 5 ? '#facc15' : '#f87171'
                            }}>{d.A}/10</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionCard>
                )
              })()}
              {Object.keys(hire_signal || {}).length >= 3 && (
                <SectionCard icon={<Target size={16}/>} title="Hire Signal" color="#f59e0b">
                  <p className="text-xs text-muted mb-3">
                    How a hiring manager would rate your readiness across 5 dimensions.
                  </p>
                  <HireSignalRadar hireSignal={hire_signal} roundType={round_type} />
                </SectionCard>
              )}
            </div>
          )
        )}
        </SectionErrorBoundary>

        {/* ── 6-Axis Communication Radar + Delivery Consistency ───────────── */}
        {/* Hidden for MCQ — communication axes are derived from spoken answers.
            Hidden for DSA — coding rounds are evaluated on code, not delivery. */}
        <SectionErrorBoundary>
        {round_type === 'mcq_practice' || round_type === 'dsa' ? null : failedSections.includes('communication_breakdown') && !stageRetrySuccess['stage3_communication'] ? (
          <SectionRetryCard
            sectionLabel="Communication Analysis"
            onRetry={() => handleRetryStage('stage3_communication')}
            isRetrying={retryingStage === 'stage3_communication'}
            retrySuccess={!!stageRetrySuccess['stage3_communication']}
          />
        ) : (radarData.length > 0 || deliveryArc.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {radarData.length > 0 && (() => {
              const isHR     = round_type === 'hr'
              const axColor  = isHR ? '#ec4899' : '#22d3ee'
              const axDot    = isHR ? '#f472b6' : '#67e8f9'
              const axTitle  = isHR ? 'Behavioral Competency Profile' : 'Communication (6-Axis)'
              return (
              <SectionCard icon={<MessageSquare size={16}/>} title={axTitle} color={axColor}>
                <ResponsiveContainer width="100%" height={260}>
                  <RadarChart data={radarData} margin={{ top: 0, right: 30, bottom: 0, left: 30 }}>
                    <PolarGrid stroke="var(--color-border)" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                    <Radar name="Score" dataKey="A" stroke={axColor} fill={axColor} fillOpacity={0.2}
                      dot={{ r: 3, fill: axDot }} />
                  </RadarChart>
                </ResponsiveContainer>
                {communication_breakdown && Object.keys(communication_breakdown ?? {}).length > 0 && (
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    {Object.entries(communication_breakdown ?? {}).map(([k, v]) => (
                      <div key={k} className="flex justify-between items-center text-xs">
                        <span className="text-muted truncate mr-2">{k}</span>
                        <span className="font-semibold flex-shrink-0" style={{ color: scoreColor(v) }}>{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            )
            })()}

            {deliveryArc.length > 0 && (
              <SectionCard icon={<TrendingUp size={16}/>} title="Delivery Consistency" color="#a78bfa">
                {delivery_consistency?.verdict && (
                  <p className="text-sm text-muted mb-3">
                    <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{delivery_consistency.verdict}</span>
                    {delivery_consistency.drop != null && (
                      <> — {delivery_consistency.drop > 0 ? `dropped ${delivery_consistency.drop} pts` : `improved ${Math.abs(delivery_consistency.drop)} pts`} by end</>
                    )}
                  </p>
                )}
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={deliveryArc} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                    <XAxis dataKey="q" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => [`${v}/100`, 'Confidence']}
                      contentStyle={{ background: '#1e1e2e', border: '1px solid #7c3aed40', borderRadius: 8 }} />
                    <Line type="monotone" dataKey="confidence" stroke="#a78bfa" strokeWidth={2}
                      dot={{ r: 4, fill: '#7c3aed' }} />
                  </LineChart>
                </ResponsiveContainer>
              </SectionCard>
            )}
          </div>
        )}

        {/* ── MCQ Category Breakdown (mcq_practice rounds only) ───────────── */}
        {round_type === 'mcq_practice' && mcqCategoryData.length > 0 && (
          <SectionCard icon={<BarChart2 size={16}/>} title="MCQ Category Breakdown" color="#f59e0b">
            <p className="text-xs text-muted mb-3">
              Accuracy per topic — highlights which concept areas need the most revision.
            </p>
            <ResponsiveContainer width="100%" height={Math.max(180, mcqCategoryData.length * 42)}>
              <BarChart
                data={mcqCategoryData}
                layout="vertical"
                margin={{ top: 4, right: 40, bottom: 4, left: 8 }}
              >
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${v}%`}
                />
                <YAxis
                  type="category"
                  dataKey="category"
                  width={90}
                  tick={{ fill: '#475569', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(245,158,11,0.08)' }}
                  content={
                    <ThemeTooltip
                      valueFormatter={(value, _name, p) => [
                        `${value}%  (${p.correct}/${p.total} correct)`,
                        'Accuracy',
                      ]}
                    />
                  }
                />
                <Bar dataKey="accuracy" radius={[0, 6, 6, 0]} maxBarSize={22}>
                  {mcqCategoryData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={
                        entry.accuracy >= 80 ? '#4ade80'
                        : entry.accuracy >= 50 ? '#f59e0b'
                        : '#f87171'
                      }
                      opacity={0.85}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {/* Summary row: overall MCQ accuracy */}
            {(() => {
              const totalQ  = mcqCategoryData.reduce((s, d) => s + d.total, 0)
              const totalC  = mcqCategoryData.reduce((s, d) => s + d.correct, 0)
              const overall = totalQ > 0 ? Math.round(totalC / totalQ * 100) : 0
              return (
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/10 text-xs text-muted">
                  <span>Overall MCQ accuracy</span>
                  <span className="font-semibold" style={{ color: overall >= 80 ? '#4ade80' : overall >= 50 ? '#f59e0b' : '#f87171' }}>
                    {totalC}/{totalQ} &nbsp;·&nbsp; {overall}%
                  </span>
                </div>
              )
            })()}
          </SectionCard>
        )}
        </SectionErrorBoundary>

        {/* ── Filler & Hesitation Heatmap ─────────────────────────────────── */}
        {/* Hidden for MCQ — filler counts come from speech transcripts.
            Hidden for DSA — coding rounds have no spoken transcript. */}
        <SectionErrorBoundary>
        {round_type !== 'mcq_practice' && round_type !== 'dsa' && fillerData.length > 0 && (
          <SectionCard icon={<BarChart2 size={16}/>} title="Filler Word Heatmap" color="#fb923c">
            <p className="text-xs text-muted mb-3">
              Higher bars = more filler words per question. Hover for details.
            </p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={fillerData} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                <XAxis dataKey="question_id" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<FillerTooltip />} cursor={{ fill: 'rgba(251,146,60,0.08)' }} />
                <Bar dataKey="filler_count" radius={[4, 4, 0, 0]}>
                  {fillerData.map((_, i) => <Cell key={i} fill="#fb923c" opacity={0.8} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>
        )}
        </SectionErrorBoundary>

        {/* ── Per-Question Scores Chart ────────────────────────────────────── */}
        {/* Hidden for MCQ — the MCQ analytics block above already shows per-question time + correctness.
            Hidden for DSA — DSA Performance Dashboard renders a richer per-problem score chart. */}
        <SectionErrorBoundary>
        {round_type !== 'mcq_practice' && round_type !== 'dsa' && (
          <SectionCard icon={<TrendingUp size={16}/>} title="Per-Question Scores" color="#4ade80">
            {qaData.length === 0
              ? <p className="text-muted text-sm text-center py-4">No question data available for this session.</p>
              : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={qaData} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                    <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 10]} tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<QTooltip />} cursor={{ fill: 'rgba(124,58,237,0.08)' }} />
                    <Bar dataKey="score" radius={[6, 6, 0, 0]}>
                      {qaData.map((e, i) => <Cell key={i} fill={e.skipped || e.score == null ? '#f59e0b' : scoreColor10(e.score)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )
            }
          </SectionCard>
        )}
        </SectionErrorBoundary>

        {/* ── Verbal Category Breakdown (technical only) ───────────────────── */}
        {/* DSA covers this in the Topic Mastery radar inside its dedicated dashboard. */}
        {round_type !== 'mcq_practice' && round_type !== 'hr' && round_type !== 'dsa' && category_breakdown?.length > 0 && (
          <SectionCard icon={<BarChart2 size={16}/>} title="Performance by Topic Category" color="#7c3aed">
            <p className="text-xs text-muted mb-3">
              Average score per CS pillar — shows exactly where preparation is needed.
            </p>
            <div className="space-y-3">
              {category_breakdown.map((cat, i) => {
                const score = cat.avg_score ?? cat.accuracy ?? 0
                const pct   = Math.min(100, Math.max(0, score))
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-sm text-muted w-24 truncate flex-shrink-0">{cat.category}</span>
                    <div className="flex-1 rounded-full h-2" style={{ background: 'var(--color-surface-3)' }}>
                      <div className="h-2 rounded-full transition-all"
                        style={{ width: `${pct}%`, background: scoreColor(pct) }} />
                    </div>
                    <span className="text-xs font-semibold w-10 text-right flex-shrink-0"
                      style={{ color: scoreColor(pct) }}>
                      {pct.toFixed(0)}%
                    </span>
                    {cat.verdict && (
                      <span className="text-xs text-muted flex-shrink-0 w-20 text-right truncate">{cat.verdict}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </SectionCard>
        )}

        {/* ── Strong & Weak Areas ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <SectionCard icon={<CheckCircle size={16}/>} title="Strong Areas" color="#4ade80">
            {strong_areas.length === 0 ? <p className="text-muted text-sm">—</p>
              : strong_areas.map((a, i) => {
                const { area, evidence, score } = normArea(a)
                const isHREnriched = round_type === 'hr' && (a.evidence_quote || a.why_it_landed)
                return (
                  <div key={i} className={`flex items-start gap-2 ${isHREnriched ? 'mb-4' : 'mb-3'}`}>
                    <CheckCircle size={14} className="text-green-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{area || a}</p>
                        {a.exact_moment && <Chip label={a.exact_moment} color="#4ade80" size="xs" />}
                        {score && <Chip label={`${score}/100`} color="#4ade80" size="xs" />}
                      </div>
                      {isHREnriched ? (
                        <>
                          {a.evidence_quote && (
                            <p className="text-xs italic mt-1.5 leading-relaxed px-2 py-1.5 rounded"
                              style={{ color: 'var(--color-muted)', background: 'rgba(74,222,128,0.06)', borderLeft: '2px solid rgba(74,222,128,0.35)' }}>
                              "{a.evidence_quote}"
                            </p>
                          )}
                          {a.why_it_landed && (
                            <p className="text-[11px] mt-1" style={{ color: 'rgba(74,222,128,0.75)' }}>
                              <span className="font-semibold">Why it landed: </span>{a.why_it_landed}
                            </p>
                          )}
                        </>
                      ) : (
                        evidence && <p className="text-xs text-muted mt-0.5">"{evidence}"</p>
                      )}
                    </div>
                  </div>
                )
              })
            }
          </SectionCard>
          <SectionCard icon={<XCircle size={16}/>} title="Areas to Improve" color="#f87171">
            {weak_areas.length === 0 ? <p className="text-muted text-sm">—</p>
              : weak_areas.map((a, i) => {
                const { area, what_was_missed, how_to_improve, score } = normArea(a)
                return (
                  <div key={i} className="mb-3">
                    <div className="flex items-start gap-2">
                      <XCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                      <p className="text-sm font-medium">{area || a}</p>
                      {score && <Chip label={`${score}/100`} color="#f87171" size="xs" />}
                    </div>
                    {what_was_missed && <p className="text-xs text-muted ml-5 mt-0.5">Missed: {what_was_missed}</p>}
                    {how_to_improve && <p className="text-xs text-purple-400 ml-5 mt-0.5">→ {how_to_improve}</p>}
                  </div>
                )
              })
            }
          </SectionCard>
        </div>


        {/* ── HR Phase 1: Competency Scorecard ────────────────────────────── */}
        {round_type === 'hr' && (
          <SectionErrorBoundary>
            <HRCompetencyScorecard
              competencyScorecard={competency_scorecard}
              axisPercentiles={peer_benchmarking?.axis_percentiles || {}}
              onRetry={null}
              isRetrying={false}
            />
          </SectionErrorBoundary>
        )}

        {/* ── HR Enhancement: Seniority Calibration ────────────────────────── */}
        {round_type === 'hr' && seniority_calibration?.level && (() => {
          const levelColors = {
            'Junior':          { color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',  border: 'rgba(96,165,250,0.25)' },
            'Mid-Level':       { color: '#34d399', bg: 'rgba(52,211,153,0.1)',  border: 'rgba(52,211,153,0.25)' },
            'Senior':          { color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.25)' },
            'Staff/Principal': { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.25)' },
          }
          const confColors = { High: '#4ade80', Medium: '#facc15', Low: '#f87171' }
          const lc  = levelColors[seniority_calibration.level] || levelColors['Mid-Level']
          const cc  = confColors[seniority_calibration.confidence] || '#facc15'
          return (
            <SectionCard icon={<Award size={16}/>} title="Seniority Calibration" color="#a78bfa">
              <div className="flex items-start gap-4 flex-wrap">
                {/* Level badge */}
                <div className="flex-shrink-0 rounded-xl px-5 py-3 text-center"
                  style={{ background: lc.bg, border: `1px solid ${lc.border}` }}>
                  <p className="text-[10px] text-muted uppercase tracking-wider mb-1">Behavioral Level</p>
                  <p className="text-xl font-black" style={{ color: lc.color }}>{seniority_calibration.level}</p>
                  {seniority_calibration.confidence && (
                    <p className="text-[10px] mt-1 font-semibold" style={{ color: cc }}>
                      {seniority_calibration.confidence} Confidence
                    </p>
                  )}
                </div>
                {/* Rationale + signals */}
                <div className="flex-1 min-w-[180px]">
                  {seniority_calibration.rationale && (
                    <p className="text-xs leading-relaxed mb-2.5" style={{ color: 'var(--color-muted)' }}>
                      {seniority_calibration.rationale}
                    </p>
                  )}
                  {seniority_calibration.evidence_signals?.length > 0 && (
                    <div className="space-y-1">
                      {seniority_calibration.evidence_signals.map((sig, i) => (
                        <div key={i} className="flex items-start gap-1.5">
                          <span className="text-purple-400 flex-shrink-0 mt-0.5">•</span>
                          <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{sig}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>
          )
        })()}

        {/* ── HR: Story Completeness Analysis ─────────────────────────────── */}
        {round_type === 'hr' && star_story_matrix?.length > 0 && (() => {
          const total       = star_story_matrix.length
          const avgCompletion = Math.round(
            star_story_matrix.reduce((s, q) => s + (q.star_score ?? 0), 0) / total * 10
          )
          const elemCounts = {
            S: star_story_matrix.filter(q => q.situation_present).length,
            T: star_story_matrix.filter(q => q.task_present).length,
            A: star_story_matrix.filter(q => q.action_present).length,
            R: star_story_matrix.filter(q => q.result_present).length,
          }
          const missingMap = star_story_matrix
            .map(q => q.missing_element)
            .filter(m => m && m !== 'None')
            .reduce((acc, m) => ({ ...acc, [m]: (acc[m] || 0) + 1 }), {})
          const topMissing   = Object.entries(missingMap).sort(([,a],[,b]) => b - a)[0]?.[0] || 'None'
          const highSpecCount = star_story_matrix.filter(q => q.specificity_level?.startsWith('High')).length
          const compColor    = avgCompletion >= 75 ? '#4ade80' : avgCompletion >= 50 ? '#facc15' : '#f87171'
          const origMap      = Object.fromEntries(
            (story_uniqueness?.per_question_originality || []).map(o => [o.question_id, o])
          )

          const ELEMS = [
            { key: 'S', label: 'Situation', field: 'situation_present', hint: 'Set the scene with context' },
            { key: 'T', label: 'Task',      field: 'task_present',      hint: 'Defined your responsibility' },
            { key: 'A', label: 'Action',    field: 'action_present',    hint: 'What you specifically did' },
            { key: 'R', label: 'Result',    field: 'result_present',    hint: 'Outcome with evidence' },
          ]

          return (
            <SectionCard icon={<CheckCircle size={16}/>} title="Story Completeness Analysis" color="#ec4899">
              {/* Aggregate stats */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { label: 'Avg Completeness', value: `${avgCompletion}%`, color: compColor, sub: null },
                  { label: 'Most Missed',       value: topMissing,         color: '#f59e0b', sub: 'element' },
                  { label: 'High Specificity',  value: highSpecCount,      color: '#4ade80', sub: `/ ${total} answers` },
                ].map(({ label, value, color, sub }) => (
                  <div key={label} className="rounded-xl p-3 text-center"
                    style={{ background: 'rgba(236,72,153,0.07)', border: '1px solid rgba(236,72,153,0.18)' }}>
                    <p className="text-lg font-bold leading-tight truncate" style={{ color }}>{value}</p>
                    {sub && <p className="text-[10px] text-muted leading-none mt-0.5">{sub}</p>}
                    <p className="text-[10px] text-muted mt-1">{label}</p>
                  </div>
                ))}
              </div>

              {/* Element presence distribution */}
              <p className="text-xs text-muted uppercase tracking-wider mb-2">Element Presence Across All Answers</p>
              <div className="space-y-2 mb-5">
                {ELEMS.map(({ key, label, field }) => {
                  const count = elemCounts[key]
                  const pct   = Math.round(count / total * 100)
                  const c     = pct >= 80 ? '#4ade80' : pct >= 60 ? '#facc15' : '#f87171'
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                        style={{ background: `${c}22`, color: c }}>{key}</span>
                      <span className="text-xs text-muted w-16 flex-shrink-0">{label}</span>
                      <div className="flex-1 rounded-full h-2" style={{ background: 'var(--color-surface-3)' }}>
                        <div className="h-2 rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, background: c }} />
                      </div>
                      <span className="text-xs font-semibold w-20 text-right flex-shrink-0" style={{ color: c }}>
                        {count}/{total} ({pct}%)
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Per-answer full cards */}
              <p className="text-xs text-muted uppercase tracking-wider mb-3">Per-Answer Breakdown</p>
              <div className="space-y-4">
                {star_story_matrix.map((q, i) => {
                  const sc  = q.star_score ?? 0
                  const pct = q.star_completeness_pct ?? Math.round(([q.situation_present, q.task_present, q.action_present, q.result_present].filter(Boolean).length / 4) * 100)
                  const c   = sc >= 8 ? '#4ade80' : sc >= 5 ? '#facc15' : '#f87171'
                  const specColor = q.specificity_level?.startsWith('High') ? '#4ade80'
                    : q.specificity_level?.startsWith('Medium') ? '#facc15' : '#f87171'
                  return (
                    <div key={i} className="rounded-xl overflow-hidden"
                      style={{ border: '1px solid rgba(236,72,153,0.18)', background: 'var(--color-surface-2)' }}>
                      {/* Story header */}
                      <div className="flex items-center gap-3 px-4 py-3"
                        style={{ background: 'rgba(236,72,153,0.06)', borderBottom: '1px solid rgba(236,72,153,0.12)' }}>
                        <span className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black flex-shrink-0"
                          style={{ background: `${c}20`, color: c }}>{q.question_id || `Q${i+1}`}</span>
                        <span className="flex-1 text-sm font-semibold truncate">{q.competency_category}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs font-bold" style={{ color: c }}>{sc}/10</span>
                          <Chip label={q.specificity_level?.split(' ')[0] || '—'} color={specColor} size="xs" />
                          {(() => {
                            const orig = origMap[q.question_id || `Q${i+1}`]
                            if (!orig) return null
                            const isRehearsed = orig.rehearsal_flag || orig.originality_score < 50
                            const chipLabel   = isRehearsed ? 'Scripted' : orig.originality_score >= 70 ? 'Authentic' : 'Mixed'
                            const chipColor   = isRehearsed ? '#f59e0b' : orig.originality_score >= 70 ? '#4ade80' : '#94a3b8'
                            return <Chip label={chipLabel} color={chipColor} size="xs" />
                          })()}
                        </div>
                      </div>
                      {/* STAR element badges + completeness bar */}
                      <div className="px-4 py-3">
                        <div className="flex items-center gap-3 mb-2.5">
                          <div className="flex gap-1.5">
                            {[
                              { k: 'S', v: q.situation_present },
                              { k: 'T', v: q.task_present },
                              { k: 'A', v: q.action_present },
                              { k: 'R', v: q.result_present },
                            ].map(({ k, v }) => (
                              <span key={k} className="w-6 h-6 rounded-md text-[10px] font-bold flex items-center justify-center"
                                style={{
                                  background: v ? 'rgba(74,222,128,0.18)' : 'var(--color-surface-3)',
                                  color: v ? '#4ade80' : 'var(--color-muted)',
                                  border: `1px solid ${v ? 'rgba(74,222,128,0.35)' : 'var(--color-border)'}`,
                                }}>{k}</span>
                            ))}
                          </div>
                          {q.missing_element && q.missing_element !== 'None' && (
                            <span className="text-[10px] text-amber-400">✗ Missing: {q.missing_element}</span>
                          )}
                          <span className="ml-auto text-[11px] font-semibold" style={{ color: c }}>{pct}%</span>
                        </div>
                        {/* Completeness bar */}
                        <div className="rounded-full h-1.5 mb-3" style={{ background: 'var(--color-surface-3)' }}>
                          <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: c }} />
                        </div>
                        {/* Question text */}
                        {q.question_text && (
                          <div className="mb-2 rounded-lg px-3 py-2"
                            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                            <p className="text-[10px] text-muted uppercase tracking-wider mb-0.5">Question Asked</p>
                            <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-2)' }}>{q.question_text}</p>
                          </div>
                        )}
                        {/* Answer summary */}
                        {q.answer_summary && (
                          <div className="mb-2 rounded-lg px-3 py-2"
                            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                            <p className="text-[10px] text-muted uppercase tracking-wider mb-0.5">Answer Summary</p>
                            <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{q.answer_summary}</p>
                          </div>
                        )}
                        {/* Verbatim quote */}
                        {q.best_verbatim_quote && q.best_verbatim_quote !== 'No notable quote.' && (
                          <div className="rounded-lg px-3 py-2.5"
                            style={{ borderLeft: '3px solid rgba(236,72,153,0.5)', background: 'rgba(236,72,153,0.04)' }}>
                            <p className="text-[10px] text-muted uppercase tracking-wider mb-1">In their words</p>
                            <p className="text-xs leading-relaxed italic" style={{ color: 'var(--color-text-2)' }}>
                              "{q.best_verbatim_quote}"
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </SectionCard>
          )
        })()}

        {/* ── HR Enhancement: Answer Depth Progression ─────────────────────── */}
        {round_type === 'hr' && answer_depth_progression?.arc?.length >= 2 && (() => {
          const { arc, trend, peak_question, lowest_question, trend_rationale } = answer_depth_progression
          const trendColors = {
            Improving:    { color: '#4ade80', bg: 'rgba(74,222,128,0.1)',  border: 'rgba(74,222,128,0.25)' },
            Declining:    { color: '#f87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.25)' },
            Consistent:   { color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',  border: 'rgba(96,165,250,0.25)' },
            Inconsistent: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.25)' },
          }
          const tc = trendColors[trend] || trendColors.Consistent
          const chartData = arc.map(pt => ({ name: pt.q, score: pt.score }))
          const minScore  = Math.max(0,  Math.min(...arc.map(p => p.score)) - 10)
          const maxScore  = Math.min(100, Math.max(...arc.map(p => p.score)) + 10)
          return (
            <SectionCard icon={<Activity size={16}/>} title="Answer Depth Progression" color="#60a5fa">
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg flex-shrink-0"
                  style={{ background: tc.bg, border: `1px solid ${tc.border}` }}>
                  {trend === 'Improving' && <TrendingUp size={14} style={{ color: tc.color }} />}
                  {trend === 'Declining' && <TrendingDown size={14} style={{ color: tc.color }} />}
                  {(trend === 'Consistent' || trend === 'Inconsistent') && <Minus size={14} style={{ color: tc.color }} />}
                  <span className="text-xs font-bold" style={{ color: tc.color }}>{trend}</span>
                </div>
                <div className="flex gap-3 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                  {peak_question && <span>Peak: <span className="font-semibold text-green-400">{peak_question}</span></span>}
                  {lowest_question && <span>Lowest: <span className="font-semibold text-red-400">{lowest_question}</span></span>}
                </div>
              </div>
              {trend_rationale && (
                <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>{trend_rationale}</p>
              )}
              <div style={{ height: 140 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.15)" />
                    <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[minScore, maxScore]} tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12, color: 'var(--color-text)' }}
                      labelStyle={{ color: 'var(--color-text-2)' }}
                      formatter={(v) => [`${v}/100`, 'Score']}
                    />
                    <ReferenceLine y={arc.reduce((s, p) => s + p.score, 0) / arc.length} stroke="var(--color-border-strong)" strokeDasharray="4 4" />
                    <Line
                      type="monotone" dataKey="score" stroke={tc.color} strokeWidth={2.5}
                      dot={{ fill: tc.color, r: 4, strokeWidth: 0 }}
                      activeDot={{ r: 6, fill: tc.color }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>
          )
        })()}

        {/* ── HR: Behavioral Competency Coverage ──────────────────────────── */}
        {round_type === 'hr' && behavioral_category_coverage?.length > 0 && (
          <SectionCard icon={<BarChart2 size={16}/>} title="Behavioral Competency Coverage" color="#ec4899">
            <p className="text-xs text-muted mb-3">
              Which competency areas were assessed and how well they were demonstrated.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {behavioral_category_coverage.map((cat, i) => {
                const perfColor = cat.performance === 'Strong'   ? '#4ade80'
                  : cat.performance === 'Adequate' ? '#facc15'
                  : cat.performance === 'Weak'     ? '#f87171'
                  : '#475569'
                const bgColor = cat.covered
                  ? `${perfColor}0d`
                  : 'var(--color-surface-2)'
                return (
                  <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
                    style={{ background: bgColor, border: `1px solid ${cat.covered ? `${perfColor}28` : 'var(--color-border)'}` }}>
                    <span className="flex-1 text-xs truncate"
                      style={{ color: cat.covered ? 'var(--color-text)' : 'var(--color-muted)' }}>
                      {cat.category}
                    </span>
                    <Chip
                      label={cat.covered ? cat.performance : 'Not Asked'}
                      size="xs"
                      color={perfColor}
                    />
                  </div>
                )
              })}
            </div>
          </SectionCard>
        )}

        {/* ── HR: Culture Fit + Communication Pattern ──────────────────────── */}
        {round_type === 'hr' && (culture_fit_narrative || communication_pattern) && (
          <SectionCard icon={<Users size={16}/>} title="Culture Fit & Communication Style" color="#ec4899">
            {communication_pattern && (() => {
              const isStrong = communication_pattern.includes('Anecdote')
              const isWeak   = communication_pattern.includes('Too-brief') || communication_pattern.includes('Rambling')
              const patColor = isStrong ? '#4ade80' : isWeak ? '#f87171' : '#facc15'
              return (
                <div className="mb-4 p-3 rounded-lg" style={{ background: `${patColor}0d`, border: `1px solid ${patColor}28` }}>
                  <p className="text-[10px] text-muted uppercase tracking-wider mb-1">Communication Pattern</p>
                  <p className="text-sm font-semibold" style={{ color: patColor }}>{communication_pattern}</p>
                </div>
              )
            })()}
            {culture_fit_narrative && (
              <div>
                <p className="text-[10px] text-muted uppercase tracking-wider mb-1.5">Environment Fit Narrative</p>
                <p className="text-sm text-muted leading-relaxed">{culture_fit_narrative}</p>
              </div>
            )}
          </SectionCard>
        )}

        {/* ── HR Phase 2: Culture Fit Spectrum Map ─────────────────────────── */}
        {round_type === 'hr' && culture_fit_dimensions?.length > 0 && (
          <SectionErrorBoundary>
            <CultureFitMap dimensions={culture_fit_dimensions} />
          </SectionErrorBoundary>
        )}

        {/* ── HR Phase 2: EQ Profile ────────────────────────────────────────── */}
        {round_type === 'hr' && eq_profile && Object.keys(eq_profile).length > 0 && (
          <SectionErrorBoundary>
            <EQProfileCard eqProfile={eq_profile} />
          </SectionErrorBoundary>
        )}

        {/* ── HR Phase 3: Coachability + Leadership IC (2-column) ──────────── */}
        {round_type === 'hr' && (coachability_index?.score != null || leadership_ic_fit?.spectrum_position != null) && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
            <SectionErrorBoundary>
              <CoachabilityCard data={coachability_index} />
            </SectionErrorBoundary>
            <SectionErrorBoundary>
              <LeadershipICFitBar data={leadership_ic_fit} />
            </SectionErrorBoundary>
          </div>
        )}

        {/* ── HR Phase 3: Reference Check Triggers ─────────────────────────── */}
        {round_type === 'hr' && reference_check_triggers?.length > 0 && (
          <SectionErrorBoundary>
            <ReferenceCheckPanel triggers={reference_check_triggers} />
          </SectionErrorBoundary>
        )}

        {/* ── HR Phase 3: Assessment Confidence ────────────────────────────── */}
        {round_type === 'hr' && assessment_confidence?.score != null && (
          <SectionErrorBoundary>
            <AssessmentConfidenceCard data={assessment_confidence} />
          </SectionErrorBoundary>
        )}

        {/* ── HR Enhancement: Explicit Red Flags (consolidated, severity-ranked) ── */}
        {round_type === 'hr' && explicit_red_flags?.length > 0 && (() => {
          const SEV_RF = {
            High:   { color: '#ef4444', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.3)',   icon: <ShieldAlert size={13} style={{ color: '#ef4444' }} /> },
            Medium: { color: '#f59e0b', bg: 'rgba(245,158,11,0.07)',  border: 'rgba(245,158,11,0.25)', icon: <AlertTriangle size={13} style={{ color: '#f59e0b' }} /> },
            Low:    { color: '#facc15', bg: 'rgba(250,204,21,0.06)',  border: 'rgba(250,204,21,0.22)', icon: <Info size={13} style={{ color: '#facc15' }} /> },
          }
          const sortedFlags = [...explicit_red_flags].sort((a, b) => {
            const order = { High: 0, Medium: 1, Low: 2 }
            return (order[a.severity] ?? 1) - (order[b.severity] ?? 1)
          })
          const highCount = explicit_red_flags.filter(f => f.severity === 'High').length
          return (
            <SectionCard icon={<ShieldAlert size={16}/>} title={`Red Flags${highCount > 0 ? ` · ${highCount} High` : ''}`} color="#ef4444">
              <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
                Consolidated signals that warrant discussion before an offer decision. Sorted by severity.
              </p>
              <div className="space-y-2.5">
                {sortedFlags.map((flag, i) => {
                  const sev   = flag.severity || 'Medium'
                  const style = SEV_RF[sev] || SEV_RF.Medium
                  return (
                    <div key={i} className="rounded-xl overflow-hidden"
                      style={{ background: style.bg, border: `1px solid ${style.border}` }}>
                      <div className="flex items-start gap-2.5 px-3 py-2.5">
                        <span className="flex-shrink-0 mt-0.5">{style.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold flex-shrink-0"
                              style={{ background: `${style.color}20`, color: style.color }}>{sev}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0"
                              style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)' }}>{flag.type}</span>
                            {flag.question_id && (
                              <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>{flag.question_id}</span>
                            )}
                          </div>
                          {flag.signal_meaning && (
                            <p className="text-xs font-medium leading-snug mb-1" style={{ color: style.color }}>
                              {flag.signal_meaning}
                            </p>
                          )}
                          {flag.evidence_quote && flag.evidence_quote !== 'No direct quote available.' && (
                            <p className="text-[11px] italic leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                              "{flag.evidence_quote}"
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </SectionCard>
          )
        })()}

        {/* ── HR: Behavioral Observations (severity-tiered) ────────────────── */}
        {round_type === 'hr' && behavioral_red_flags?.length > 0 && (() => {
          const SEV = {
            Critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.25)', icon: <ShieldAlert size={13} style={{ color: '#ef4444' }} /> },
            Moderate: { color: '#f59e0b', bg: 'rgba(245,158,11,0.07)', border: 'rgba(245,158,11,0.22)', icon: <AlertTriangle size={13} style={{ color: '#f59e0b' }} /> },
            Minor:    { color: '#facc15', bg: 'rgba(250,204,21,0.06)', border: 'rgba(250,204,21,0.2)', icon: <Info size={13} style={{ color: '#facc15' }} /> },
          }
          const sorted = [...behavioral_red_flags].sort((a, b) => {
            const order = { Critical: 0, Moderate: 1, Minor: 2 }
            return (order[a.severity] ?? 1) - (order[b.severity] ?? 1)
          })
          return (
            <SectionCard icon={<AlertTriangle size={16}/>} title="Behavioral Observations" color="#f59e0b">
              <p className="text-xs text-muted mb-3">Patterns worth discussing in a debrief. Sorted by severity.</p>
              <div className="space-y-2.5">
                {sorted.map((item, i) => {
                  const flag    = typeof item === 'string' ? item : item.flag
                  const sev     = typeof item === 'string' ? 'Moderate' : (item.severity || 'Moderate')
                  const evidence = typeof item === 'string' ? '' : (item.evidence || '')
                  const style    = SEV[sev] || SEV.Moderate
                  return (
                    <div key={i} className="rounded-lg overflow-hidden"
                      style={{ background: style.bg, border: `1px solid ${style.border}` }}>
                      <div className="flex items-start gap-2.5 px-3 py-2.5">
                        <span className="flex-shrink-0 mt-0.5">{style.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-xs font-semibold leading-snug" style={{ color: style.color }}>{flag}</p>
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold flex-shrink-0"
                              style={{ background: `${style.color}18`, color: style.color }}>{sev}</span>
                          </div>
                          {evidence && (
                            <p className="text-[11px] italic leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                              "{evidence}"
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </SectionCard>
          )
        })()}

        {/* ── HR Dual-Audience Toggle ──────────────────────────────────────────── */}
        {round_type === 'hr' && (
          peer_benchmarking?.overall_percentile != null ||
          role_gap_analysis?.expected_competencies?.length > 0 ||
          story_uniqueness?.uniqueness_score != null ||
          model_answer_comparison?.length > 0 ||
          pipeline_followup_questions?.length > 0 ||
          hr_improvement_plan?.weekly_sprints?.length > 0 ||
          executive_brief?.hire_verdict
        ) && (
          <div className="flex items-center gap-3 px-1">
            <p className="text-xs font-semibold flex-shrink-0" style={{ color: 'var(--color-muted)' }}>View for:</p>
            <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              {[
                { key: 'candidate',  label: '🎯 Candidate',         title: 'Self-improvement insights' },
                { key: 'committee',  label: '📋 Hiring Committee',  title: 'Decision-making summary' },
              ].map(({ key, label, title }) => (
                <button key={key} title={title}
                  onClick={() => setHrAudience(key)}
                  className="px-3 py-1.5 text-xs font-semibold transition-colors"
                  style={{
                    background: hrAudience === key ? 'rgba(236,72,153,0.18)' : 'transparent',
                    color: hrAudience === key ? '#ec4899' : 'var(--color-muted)',
                    borderRight: key === 'candidate' ? '1px solid var(--color-border)' : 'none',
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── HR Group B: Peer Benchmarking (Phase 2) — Committee view ────────── */}
        {round_type === 'hr' && hrAudience === 'committee' && peer_benchmarking?.overall_percentile != null && (() => {
          const { overall_percentile, percentile_label, score_vs_avg, axis_percentiles, cohort_context } = peer_benchmarking
          const pctColor = overall_percentile >= 75 ? '#4ade80' : overall_percentile >= 50 ? '#facc15' : '#f87171'
          const axisEntries = Object.entries(axis_percentiles || {})
          return (
            <SectionCard icon={<Users size={16}/>} title="Peer Benchmarking" color="#6366f1">
              <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
                {cohort_context || 'Compared to candidates at similar difficulty level.'}
              </p>
              <div className="flex items-center gap-4 mb-5 flex-wrap">
                <div className="flex flex-col items-center justify-center rounded-2xl px-6 py-4"
                  style={{ background: `${pctColor}12`, border: `1.5px solid ${pctColor}35` }}>
                  <span className="text-4xl font-black" style={{ color: pctColor }}>{overall_percentile}th</span>
                  <span className="text-xs font-semibold mt-0.5" style={{ color: pctColor }}>Percentile</span>
                  <span className="text-[10px] mt-1 px-2 py-0.5 rounded-full font-bold"
                    style={{ background: `${pctColor}20`, color: pctColor }}>{percentile_label}</span>
                </div>
                <div className="flex-1 min-w-[160px]">
                  <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>vs. Avg Candidate</p>
                  <div className="flex items-center gap-2">
                    {score_vs_avg > 0
                      ? <><ArrowUp size={14} color="#4ade80"/><span className="text-sm font-bold" style={{ color: '#4ade80' }}>+{score_vs_avg} points above average</span></>
                      : score_vs_avg < 0
                      ? <><ArrowDown size={14} color="#f87171"/><span className="text-sm font-bold" style={{ color: '#f87171' }}>{score_vs_avg} points below average</span></>
                      : <><Minus size={14} color="#94a3b8"/><span className="text-sm font-bold" style={{ color: 'var(--color-muted)' }}>At the average</span></>
                    }
                  </div>
                </div>
              </div>
              {axisEntries.length > 0 && (
                <div className="space-y-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Percentile by Competency</p>
                  {axisEntries.map(([axis, pct]) => {
                    const c = pct >= 75 ? '#4ade80' : pct >= 50 ? '#facc15' : '#f87171'
                    return (
                      <div key={axis}>
                        <div className="flex justify-between items-center mb-0.5">
                          <span className="text-[11px]" style={{ color: 'var(--color-text-2)' }}>{axis}</span>
                          <span className="text-[11px] font-bold" style={{ color: c }}>{pct}th</span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
                          <div className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${pct}%`, background: c }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </SectionCard>
          )
        })()}

        {/* ── HR Group B: Role-Level Gap Analysis (Phase 3) — Candidate view ─── */}
        {round_type === 'hr' && hrAudience === 'candidate' && role_gap_analysis?.expected_competencies?.length > 0 && (() => {
          const { target_role, target_level, expected_competencies, readiness_score, readiness_label, summary } = role_gap_analysis
          const readinessColor = readiness_score >= 75 ? '#4ade80' : readiness_score >= 60 ? '#facc15' : '#f87171'
          const SEV_COLORS = { High: '#ef4444', Medium: '#f59e0b', Low: '#4ade80' }
          return (
            <SectionCard icon={<Target size={16}/>} title={`Role Fit: ${target_role || 'Target Role'}`} color="#8b5cf6">
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <div className="flex flex-col items-center justify-center rounded-2xl px-5 py-3"
                  style={{ background: `${readinessColor}12`, border: `1.5px solid ${readinessColor}35` }}>
                  <span className="text-3xl font-black" style={{ color: readinessColor }}>{readiness_score}</span>
                  <span className="text-[10px] font-semibold mt-0.5" style={{ color: readinessColor }}>Readiness</span>
                </div>
                <div className="flex-1 min-w-[140px]">
                  {readiness_label && (
                    <span className="inline-block text-[11px] px-2.5 py-1 rounded-full font-bold mb-1"
                      style={{ background: `${readinessColor}20`, color: readinessColor }}>{readiness_label}</span>
                  )}
                  {target_level && (
                    <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Target level: {target_level}</p>
                  )}
                </div>
              </div>
              {summary && (
                <p className="text-xs leading-relaxed mb-4 px-3 py-2.5 rounded-lg"
                  style={{ color: 'var(--color-text-2)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                  {summary}
                </p>
              )}
              <div className="space-y-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Competency Gap by Axis</p>
                {expected_competencies.map((item, i) => {
                  const { competency, expected_score, actual_score, gap, gap_severity, gap_narrative } = item
                  const sevColor = SEV_COLORS[gap_severity] || '#94a3b8'
                  const barPct = Math.max(0, Math.min(100, actual_score || 0))
                  const expPct = Math.max(0, Math.min(100, expected_score || 0))
                  return (
                    <div key={i} className="rounded-xl p-3"
                      style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                      <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                        <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text)' }}>{competency}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                            style={{ background: `${sevColor}20`, color: sevColor }}>{gap_severity}</span>
                          <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                            {actual_score} vs {expected_score} expected
                          </span>
                        </div>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden relative mb-1.5" style={{ background: 'var(--color-border)' }}>
                        <div className="h-full rounded-full" style={{ width: `${barPct}%`, background: gap <= 0 ? '#4ade80' : gap < 20 ? '#facc15' : '#f87171' }} />
                        <div className="absolute top-0 h-full w-0.5 rounded-full" style={{ left: `${expPct}%`, background: '#94a3b8', opacity: 0.7 }} />
                      </div>
                      {gap_narrative && (
                        <p className="text-[10px] leading-relaxed" style={{ color: 'var(--color-muted)' }}>{gap_narrative}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </SectionCard>
          )
        })()}

        {/* ── HR Group B: Story Uniqueness & Rehearsal Signal (Phase 6) — Candidate view ─ */}
        {round_type === 'hr' && hrAudience === 'candidate' && story_uniqueness?.uniqueness_score != null && (() => {
          const { uniqueness_score, uniqueness_label, rehearsal_signals, repeated_scenarios, scenario_diversity_score, diversity_feedback, per_question_originality } = story_uniqueness
          const uColor = uniqueness_score >= 80 ? '#4ade80' : uniqueness_score >= 60 ? '#facc15' : '#f87171'
          const dColor = (scenario_diversity_score || 0) >= 70 ? '#4ade80' : (scenario_diversity_score || 0) >= 50 ? '#facc15' : '#f87171'
          return (
            <SectionCard icon={<Layers size={16}/>} title="Story Uniqueness & Rehearsal Signal" color="#f59e0b">
              <div className="flex items-start gap-4 mb-4 flex-wrap">
                <div className="flex flex-col items-center justify-center rounded-2xl px-5 py-3 flex-shrink-0"
                  style={{ background: `${uColor}12`, border: `1.5px solid ${uColor}35` }}>
                  <span className="text-3xl font-black" style={{ color: uColor }}>{uniqueness_score}</span>
                  <span className="text-[10px] font-semibold mt-0.5" style={{ color: uColor }}>Uniqueness</span>
                </div>
                <div className="flex-1 min-w-[140px]">
                  {uniqueness_label && (
                    <span className="inline-block text-[11px] px-2.5 py-1 rounded-full font-bold mb-1"
                      style={{ background: `${uColor}20`, color: uColor }}>{uniqueness_label}</span>
                  )}
                  <div className="mt-1">
                    <div className="flex justify-between mb-0.5">
                      <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>Scenario Diversity</span>
                      <span className="text-[10px] font-bold" style={{ color: dColor }}>{scenario_diversity_score}/100</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
                      <div className="h-full rounded-full" style={{ width: `${scenario_diversity_score || 0}%`, background: dColor }} />
                    </div>
                  </div>
                </div>
              </div>
              {diversity_feedback && (
                <p className="text-xs leading-relaxed mb-3 px-3 py-2 rounded-lg"
                  style={{ color: 'var(--color-text-2)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                  {diversity_feedback}
                </p>
              )}
              {rehearsal_signals?.length > 0 && (
                <div className="mb-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: '#f59e0b' }}>Rehearsal Signals</p>
                  <div className="space-y-1.5">
                    {rehearsal_signals.map((sig, i) => (
                      <div key={i} className="flex items-start gap-2 text-[11px] rounded px-2.5 py-1.5"
                        style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)' }}>
                        <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
                        <span style={{ color: 'var(--color-text-2)' }}>{sig}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {repeated_scenarios?.length > 0 && (
                <div className="mb-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-muted)' }}>Repeated Scenarios</p>
                  <div className="flex flex-wrap gap-1.5">
                    {repeated_scenarios.map((sc, i) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
                        {sc}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {per_question_originality?.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Per-Answer Originality</p>
                  <div className="grid grid-cols-1 gap-2">
                    {per_question_originality.map((q, i) => {
                      const oc = (q.originality_score || 0) >= 70 ? '#4ade80' : (q.originality_score || 0) >= 50 ? '#facc15' : '#f87171'
                      return (
                        <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2"
                          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                          <span className="text-[11px] font-bold w-8 flex-shrink-0" style={{ color: 'var(--color-text)' }}>{q.question_id}</span>
                          <div className="flex-1 min-w-0">
                            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                              <div className="h-full rounded-full" style={{ width: `${q.originality_score || 0}%`, background: oc }} />
                            </div>
                          </div>
                          <span className="text-[10px] font-bold w-6 text-right flex-shrink-0" style={{ color: oc }}>{q.originality_score}</span>
                          {q.rehearsal_flag && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded flex-shrink-0"
                              style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>rehearsed</span>
                          )}
                          {q.signal && (
                            <span className="text-[10px] leading-snug hidden sm:block" style={{ color: 'var(--color-muted)', maxWidth: '200px' }}>
                              {q.signal}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </SectionCard>
          )
        })()}

        {/* ── HR Group B: Model Answer Comparison (Phase 7) — Candidate view ─── */}
        {round_type === 'hr' && hrAudience === 'candidate' && model_answer_comparison?.length > 0 && (() => {
          return (
            <SectionCard icon={<BookOpen size={16}/>} title="Model Answer Comparison" color="#06b6d4">
              <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
                Per-question breakdown of what was missing and what a strong answer would have contained.
              </p>
              <div className="space-y-4">
                {model_answer_comparison.map((item, i) => {
                  const scoreColor10v = item.candidate_score >= 8 ? '#4ade80' : item.candidate_score >= 6 ? '#facc15' : '#f87171'
                  const outlineLines = (item.model_answer_outline || '').split('\n').filter(l => l.trim())
                  return (
                    <div key={i} className="rounded-xl overflow-hidden"
                      style={{ border: '1px solid var(--color-border)' }}>
                      <div className="flex items-center gap-3 px-3 py-2.5"
                        style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded"
                          style={{ background: 'rgba(6,182,212,0.12)', color: '#06b6d4' }}>{item.question_id}</span>
                        <span className="text-xs font-semibold flex-1" style={{ color: 'var(--color-text)' }}>
                          Score: <span style={{ color: scoreColor10v }}>{item.candidate_score}/10</span>
                        </span>
                      </div>
                      <div className="p-3 space-y-3">
                        {item.what_was_missing?.length > 0 && (
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: '#f87171' }}>Missing Elements</p>
                            <div className="flex flex-wrap gap-1.5">
                              {item.what_was_missing.map((m, j) => (
                                <span key={j} className="text-[10px] px-2 py-0.5 rounded-full"
                                  style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
                                  {m}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {outlineLines.length > 0 && (
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: '#06b6d4' }}>Model Answer Structure</p>
                            <ul className="space-y-1">
                              {outlineLines.map((line, j) => (
                                <li key={j} className="flex items-start gap-2 text-[11px] leading-relaxed">
                                  <span className="flex-shrink-0 mt-1 w-1 h-1 rounded-full" style={{ background: '#06b6d4' }} />
                                  <span style={{ color: 'var(--color-text-2)' }}>{line.replace(/^[-•]\s*/, '')}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {item.improvement_instruction && (
                          <div className="rounded-lg px-3 py-2"
                            style={{ background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.18)' }}>
                            <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: '#06b6d4' }}>Practice Tip</p>
                            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-2)' }}>
                              {item.improvement_instruction}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </SectionCard>
          )
        })()}

        {/* ── HR Group C: Pipeline Follow-Up Questions (Phase 4) — Candidate view */}
        {round_type === 'hr' && hrAudience === 'candidate' && pipeline_followup_questions?.length > 0 && (() => {
          const DIFF = {
            High:   { color: '#ef4444', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)' },
            Medium: { color: '#f59e0b', bg: 'rgba(245,158,11,0.07)',  border: 'rgba(245,158,11,0.22)' },
            Low:    { color: '#4ade80', bg: 'rgba(74,222,128,0.07)',  border: 'rgba(74,222,128,0.22)' },
          }
          return (
            <SectionCard icon={<MessageSquare size={16}/>} title="Pipeline Follow-Up Questions" color="#8b5cf6">
              <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
                Questions a hiring committee would probe based on gaps and ambiguities in this interview. Prepare answers for these before your next round.
              </p>
              <div className="space-y-3">
                {pipeline_followup_questions.map((q, i) => {
                  const diff = q.difficulty || 'Medium'
                  const style = DIFF[diff] || DIFF.Medium
                  return (
                    <div key={i} className="rounded-xl overflow-hidden"
                      style={{ border: `1px solid ${style.border}`, background: style.bg }}>
                      <div className="px-3 py-2.5">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                            style={{ background: `${style.color}20`, color: style.color }}>{diff}</span>
                          {q.target_competency && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded"
                              style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)' }}>
                              {q.target_competency}
                            </span>
                          )}
                          {q.question_id_source && q.question_id_source !== 'General' && (
                            <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>{q.question_id_source}</span>
                          )}
                        </div>
                        <p className="text-sm font-semibold leading-snug mb-1.5" style={{ color: 'var(--color-text)' }}>
                          "{q.question}"
                        </p>
                        {q.purpose && (
                          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                            Why they'll ask this: {q.purpose}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </SectionCard>
          )
        })()}

        {/* ── HR Group C: HR Improvement Plan (Phase 8) — Candidate view ───────── */}
        {round_type === 'hr' && hrAudience === 'candidate' && hr_improvement_plan?.weekly_sprints?.length > 0 && (() => {
          const { priority_focus, overall_plan_label, weekly_sprints, quick_wins, curated_resources } = hr_improvement_plan
          const RESOURCE_ICONS = { Book: '📖', Course: '🎓', Article: '📄', Video: '▶', Framework: '🔧' }
          return (
            <SectionCard icon={<TrendingUp size={16}/>} title="HR Improvement Plan" color="#10b981">
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                {overall_plan_label && (
                  <span className="text-[11px] px-2.5 py-1 rounded-full font-bold"
                    style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}>
                    {overall_plan_label}
                  </span>
                )}
                {priority_focus && (
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    Priority focus: <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{priority_focus}</span>
                  </span>
                )}
              </div>

              {/* Weekly Sprints */}
              <div className="space-y-4 mb-5">
                {weekly_sprints.map((sprint, si) => (
                  <div key={si}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}>Week {sprint.week}</span>
                      <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{sprint.theme}</span>
                    </div>
                    <div className="space-y-2">
                      {(sprint.exercises || []).map((ex, ei) => (
                        <div key={ei} className="rounded-xl p-3"
                          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                          <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                            <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text)' }}>{ex.exercise}</span>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>{ex.duration_mins} min</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded"
                                style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>{ex.frequency}</span>
                            </div>
                          </div>
                          {ex.how_to_practice && (
                            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-2)' }}>
                              {ex.how_to_practice}
                            </p>
                          )}
                          {ex.target_competency && (
                            <p className="text-[10px] mt-1.5" style={{ color: 'var(--color-muted)' }}>
                              Targets: {ex.target_competency}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Quick Wins */}
              {quick_wins?.length > 0 && (
                <div className="mb-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: '#10b981' }}>Quick Wins (apply now)</p>
                  <div className="space-y-1.5">
                    {quick_wins.map((tip, i) => (
                      <div key={i} className="flex items-start gap-2 text-[11px] leading-relaxed">
                        <CheckCircle size={12} className="flex-shrink-0 mt-0.5" style={{ color: '#10b981' }} />
                        <span style={{ color: 'var(--color-text-2)' }}>{tip}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Curated Resources */}
              {curated_resources?.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Curated Resources</p>
                  <div className="space-y-2">
                    {curated_resources.map((r, i) => (
                      <div key={i} className="flex items-start gap-2.5 rounded-lg px-3 py-2"
                        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                        <span className="text-sm flex-shrink-0">{RESOURCE_ICONS[r.type] || '📌'}</span>
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold" style={{ color: 'var(--color-text)' }}>{r.title}</p>
                          {r.type && <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>{r.type}</span>}
                          {r.why && <p className="text-[10px] leading-relaxed mt-0.5" style={{ color: 'var(--color-muted)' }}>{r.why}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </SectionCard>
          )
        })()}

        {/* ── HR Group C: Executive Brief (Phase 11) — Committee view ─────────── */}
        {round_type === 'hr' && hrAudience === 'committee' && executive_brief?.hire_verdict && (() => {
          const { hire_verdict, verdict_color, one_liner, evidence_for, evidence_against, key_risk, recommended_action, committee_question } = executive_brief
          const COLOR_MAP = {
            green: { accent: '#4ade80', bg: 'rgba(74,222,128,0.08)',  border: 'rgba(74,222,128,0.3)' },
            amber: { accent: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.3)' },
            red:   { accent: '#ef4444', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.3)' },
          }
          const vc = COLOR_MAP[verdict_color] || COLOR_MAP.amber
          return (
            <SectionCard icon={<Briefcase size={16}/>} title="Executive Brief" color={vc.accent}>
              <p className="text-[10px] uppercase tracking-widest font-bold mb-3" style={{ color: 'var(--color-muted)' }}>
                Hiring Committee Summary · 30-Second Read
              </p>
              {/* Verdict banner */}
              <div className="flex items-center gap-3 rounded-2xl px-4 py-3 mb-4"
                style={{ background: vc.bg, border: `1.5px solid ${vc.border}` }}>
                <span className="text-2xl font-black" style={{ color: vc.accent }}>{hire_verdict}</span>
                {one_liner && (
                  <p className="text-xs leading-relaxed flex-1" style={{ color: 'var(--color-text-2)' }}>
                    {one_liner}
                  </p>
                )}
              </div>

              {/* Evidence for / against */}
              {(evidence_for?.length > 0 || evidence_against?.length > 0) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  {evidence_for?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: '#4ade80' }}>Evidence For</p>
                      <div className="space-y-1.5">
                        {evidence_for.map((s, i) => (
                          <div key={i} className="text-[11px] leading-snug flex items-start gap-1.5 rounded-lg px-2.5 py-1.5"
                            style={{ background: 'rgba(74,222,128,0.07)', border: '1px solid rgba(74,222,128,0.2)' }}>
                            <ArrowUp size={10} className="flex-shrink-0 mt-0.5" style={{ color: '#4ade80' }} />
                            <span style={{ color: 'var(--color-text-2)' }}>{s.signal}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {evidence_against?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: '#f87171' }}>Evidence Against</p>
                      <div className="space-y-1.5">
                        {evidence_against.map((s, i) => (
                          <div key={i} className="text-[11px] leading-snug flex items-start gap-1.5 rounded-lg px-2.5 py-1.5"
                            style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)' }}>
                            <ArrowDown size={10} className="flex-shrink-0 mt-0.5" style={{ color: '#f87171' }} />
                            <span style={{ color: 'var(--color-text-2)' }}>{s.signal}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Key risk */}
              {key_risk && (
                <div className="rounded-xl px-3 py-2.5 mb-3"
                  style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: '#f87171' }}>Key Risk</p>
                  <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-2)' }}>{key_risk}</p>
                </div>
              )}

              {/* Recommended action */}
              {recommended_action && (
                <div className="rounded-xl px-3 py-2.5 mb-3"
                  style={{ background: `${vc.accent}10`, border: `1px solid ${vc.border}` }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: vc.accent }}>Recommended Action</p>
                  <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-2)' }}>{recommended_action}</p>
                </div>
              )}

              {/* Committee question */}
              {committee_question && (
                <div className="rounded-xl px-3 py-2.5"
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-muted)' }}>Committee Question to Ask</p>
                  <p className="text-[11px] italic leading-relaxed" style={{ color: 'var(--color-text-2)' }}>"{committee_question}"</p>
                </div>
              )}
            </SectionCard>
          )
        })()}

        {/* ── DSA Performance Dashboard ─────────────────────────────────────────
            Comprehensive multi-section block: KPIs, charts, complexity, topic
            mastery, hire signal, problem-by-problem performance.
            Driven by question_scores enriched from sessions.scores (problem_slug,
            language, code_excerpt, time/space complexity, tests passed, runtime). */}
        <SectionErrorBoundary>
        {round_type === 'dsa' && Array.isArray(question_scores) && question_scores.some(q => q.problem_slug || q.tests_total != null || q.question_type === 'code') && (() => {
          const dsaQs = question_scores.filter(q => q.problem_slug || q.tests_total != null || q.question_type === 'code')
          const N = dsaQs.length || 1

          // ── Aggregates ──
          const totalTestsPassed = dsaQs.reduce((s, q) => s + (q.tests_passed || 0), 0)
          const totalTests       = dsaQs.reduce((s, q) => s + (q.tests_total  || 0), 0)
          const aggPassRate      = totalTests > 0 ? totalTestsPassed / totalTests : 0
          const fullySolved      = dsaQs.filter(q => q.tests_total > 0 && q.tests_passed === q.tests_total).length
          const solveRate        = fullySolved / N
          const avgRuntime       = Math.round(dsaQs.reduce((s, q) => s + (q.avg_runtime_ms || 0), 0) / N)
          const avgScore         = (dsaQs.reduce((s, q) => s + (q.score || 0), 0) / N).toFixed(1)
          const langs            = [...new Set(dsaQs.map(q => q.language).filter(Boolean))]
          const totalLines       = dsaQs.reduce((s, q) => s + ((q.code_excerpt || '').split('\n').length), 0)

          // Hire signal heuristic: mix of solve rate, score, complexity adherence
          const tcMatchCount = dsaQs.filter(q => {
            const t = (q.time_complexity || '').toLowerCase().replace(/\s/g, '')
            // Heuristic: anything with "n^2" or worse where reference is O(n) flags as mismatch.
            // We treat empty as "unknown" (don't penalise).
            return t && !t.includes('n^3') && !t.includes('n²·')
          }).length
          const hireScore = Math.round((solveRate * 0.45 + (avgScore / 10) * 0.35 + (tcMatchCount / N) * 0.20) * 100)
          const hireBand =
            hireScore >= 80 ? { label: 'Strong Hire',  color: '#22c55e' } :
            hireScore >= 65 ? { label: 'Hire',         color: '#84cc16' } :
            hireScore >= 50 ? { label: 'Lean Hire',    color: '#eab308' } :
            hireScore >= 35 ? { label: 'No Hire (yet)', color: '#f97316' } :
                              { label: 'No Hire',       color: '#ef4444' }

          // ── Verdict distribution ──
          const verdictCounts = dsaQs.reduce((m, q) => {
            const v = q.verdict || (q.tests_passed === q.tests_total ? 'acceptable' : 'incorrect')
            m[v] = (m[v] || 0) + 1; return m
          }, {})
          const verdictPalette = {
            excellent: '#22c55e', strong: '#4ade80', acceptable: '#eab308',
            needs_work: '#f97316', incorrect: '#ef4444',
          }
          const verdictData = Object.entries(verdictCounts).map(([k, v]) => ({
            name: k.replace('_', ' '), value: v, fill: verdictPalette[k] || '#94a3b8',
          }))

          // ── Per-problem bar data ──
          const perProblemBars = dsaQs.map((q, i) => ({
            name:     `Q${i + 1}`,
            label:    q.problem_title || q.question_text || `Problem ${i + 1}`,
            score:    q.score || 0,
            passRate: q.tests_total ? Math.round((q.tests_passed / q.tests_total) * 100) : 0,
            runtime:  q.avg_runtime_ms || 0,
            difficulty: q.difficulty || 'medium',
          }))

          // ── Time vs memory scatter ──
          const scatterData = dsaQs
            .filter(q => q.avg_runtime_ms > 0)
            .map((q, i) => ({
              x: q.avg_runtime_ms,
              y: q.code_excerpt ? q.code_excerpt.split('\n').length : 1,
              z: (q.tests_passed / Math.max(q.tests_total, 1)) * 100,
              name: q.problem_title || `Q${i + 1}`,
            }))

          // ── Topic mastery radar ──
          const topicScores = {}
          dsaQs.forEach(q => {
            const cats = (q.category || q.topic || 'general').split(',').map(t => t.trim())
            cats.forEach(t => {
              if (!t) return
              if (!topicScores[t]) topicScores[t] = { sum: 0, n: 0 }
              topicScores[t].sum += (q.score || 0) * 10
              topicScores[t].n   += 1
            })
          })
          const topicRadar = Object.entries(topicScores).map(([topic, { sum, n }]) => ({
            subject: topic, A: Math.round(sum / n), fullMark: 100,
          })).slice(0, 8)

          // ── Difficulty distribution ──
          const diffCounts = dsaQs.reduce((m, q) => {
            const d = q.difficulty || 'medium'; m[d] = (m[d] || 0) + 1; return m
          }, {})
          const diffPalette = { easy: '#22c55e', medium: '#eab308', hard: '#ef4444' }

          return (
            <SectionCard icon={<Activity size={16}/>} title="DSA Performance Dashboard" color="#a78bfa">
              {/* ── Hero KPIs ──────────────────────────────────────────────── */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
                {[
                  { label: 'Solve Rate',     value: `${Math.round(solveRate * 100)}%`, sub: `${fullySolved}/${N} fully passed`, color: '#a78bfa' },
                  { label: 'Test Pass Rate', value: `${Math.round(aggPassRate * 100)}%`, sub: `${totalTestsPassed}/${totalTests} tests`, color: '#22d3ee' },
                  { label: 'Avg Score',      value: `${avgScore}/10`, sub: 'across problems', color: '#4ade80' },
                  { label: 'Avg Runtime',    value: `${avgRuntime} ms`, sub: 'CPU time', color: '#fb923c' },
                  { label: 'Languages',      value: langs.length || 1, sub: langs.join(', ') || '—', color: '#f472b6' },
                  { label: 'Lines Written',  value: totalLines, sub: `${Math.round(totalLines / N)} avg/problem`, color: '#94a3b8' },
                ].map(({ label, value, sub, color }) => (
                  <div key={label} className="rounded-xl p-4"
                       style={{ background: `${color}10`, border: `1px solid ${color}30` }}>
                    <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color }}>{label}</p>
                    <p className="font-bold text-2xl mt-1" style={{ color }}>{value}</p>
                    <p className="text-xs text-muted mt-0.5">{sub}</p>
                  </div>
                ))}
              </div>

              {/* ── Hire Signal banner ─────────────────────────────────────── */}
              <div className="rounded-xl p-4 mb-6 flex items-center gap-4"
                   style={{ background: `linear-gradient(135deg, ${hireBand.color}18, ${hireBand.color}06)`, border: `1px solid ${hireBand.color}40` }}>
                <div className="w-14 h-14 rounded-full flex items-center justify-center font-bold text-xl"
                     style={{ background: hireBand.color, color: 'white' }}>
                  {hireScore}
                </div>
                <div className="flex-1">
                  <p className="text-xs uppercase tracking-wider text-muted">Hire Signal</p>
                  <p className="font-bold text-lg" style={{ color: hireBand.color }}>{hireBand.label}</p>
                  <p className="text-xs text-muted mt-1">
                    Composite of solve rate ({Math.round(solveRate*100)}%), code quality ({avgScore}/10),
                    and complexity adherence ({tcMatchCount}/{N}).
                  </p>
                </div>
                <div className="hidden sm:flex flex-col gap-1 text-right">
                  <span className="text-[10px] uppercase text-muted">Difficulty Mix</span>
                  <div className="flex gap-1">
                    {Object.entries(diffCounts).map(([d, c]) => (
                      <span key={d} className="text-xs px-2 py-0.5 rounded-full font-semibold"
                            style={{ background: `${diffPalette[d]}20`, color: diffPalette[d] }}>
                        {c} {d}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Charts grid ────────────────────────────────────────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
                {/* Per-problem score + pass rate */}
                <div className="rounded-xl p-4" style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.15)' }}>
                  <p className="text-sm font-semibold mb-3 flex items-center gap-2"><BarChart2 size={14}/> Per-Problem Score</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={perProblemBars}>
                      <CartesianGrid stroke="var(--color-border)" vertical={false}/>
                      <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }}/>
                      <YAxis domain={[0, 10]} tick={{ fill: '#94a3b8', fontSize: 11 }}/>
                      <Tooltip
                        contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)' }}
                        labelFormatter={(_, p) => p[0]?.payload?.label}
                        formatter={(v, name) => [`${v}${name === 'score' ? '/10' : '%'}`, name === 'score' ? 'Score' : 'Tests Passed']}
                      />
                      <Bar dataKey="score" fill="#a78bfa" radius={[6, 6, 0, 0]}>
                        {perProblemBars.map((entry, i) => (
                          <Cell key={i} fill={entry.score >= 8 ? '#22c55e' : entry.score >= 5 ? '#eab308' : '#ef4444'}/>
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Verdict distribution */}
                <div className="rounded-xl p-4" style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.15)' }}>
                  <p className="text-sm font-semibold mb-3 flex items-center gap-2"><Target size={14}/> Verdict Distribution</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={verdictData} layout="vertical">
                      <CartesianGrid stroke="var(--color-border)" horizontal={false}/>
                      <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }}/>
                      <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} width={90}/>
                      <Tooltip contentStyle={{ background: '#1e1e2e', border: '1px solid #a78bfa40', borderRadius: 8 }}/>
                      <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                        {verdictData.map((entry, i) => <Cell key={i} fill={entry.fill}/>)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Time vs Code-size scatter (efficiency) */}
                {scatterData.length > 1 && (
                  <div className="rounded-xl p-4" style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.15)' }}>
                    <p className="text-sm font-semibold mb-3 flex items-center gap-2"><Zap size={14}/> Efficiency Map (Runtime vs Code Length)</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <ScatterChart>
                        <CartesianGrid stroke="var(--color-border)"/>
                        <XAxis type="number" dataKey="x" name="Runtime" unit="ms" tick={{ fill: '#94a3b8', fontSize: 11 }}/>
                        <YAxis type="number" dataKey="y" name="Lines"        tick={{ fill: '#94a3b8', fontSize: 11 }}/>
                        <ZAxis type="number" dataKey="z" range={[60, 240]} name="Pass %"/>
                        <Tooltip
                          cursor={{ strokeDasharray: '3 3' }}
                          contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)' }}
                          formatter={(v, name) => [`${v}${name === 'Runtime' ? ' ms' : name === 'Pass %' ? '%' : ''}`, name]}
                          labelFormatter={(_, p) => p[0]?.payload?.name}
                        />
                        <Scatter data={scatterData} fill="#a78bfa"/>
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Topic mastery radar */}
                {topicRadar.length >= 3 && (
                  <div className="rounded-xl p-4" style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.15)' }}>
                    <p className="text-sm font-semibold mb-3 flex items-center gap-2"><Layers size={14}/> Topic Mastery</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <RadarChart data={topicRadar}>
                        <PolarGrid stroke="var(--color-border)"/>
                        <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 10 }}/>
                        <Radar dataKey="A" stroke="#a78bfa" fill="#a78bfa" fillOpacity={0.3}/>
                        <Tooltip formatter={v => [`${v}/100`]} contentStyle={{ background: '#1e1e2e', border: '1px solid #a78bfa40' }}/>
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* ── Second analytics grid (extended graphical insights) ─────── */}
              {(() => {
                // Complexity rank: maps Big-O string → numeric rank for line chart Y-axis
                const TC_RANK = [
                  { rank: 1, label: 'O(1)',       match: t => t === 'o(1)' },
                  { rank: 2, label: 'O(log n)',    match: t => t.includes('logn') && !t.includes('nlogn') },
                  { rank: 3, label: 'O(n)',        match: t => t === 'o(n)' },
                  { rank: 4, label: 'O(n log n)',  match: t => t.includes('nlogn') || t.includes('nlog') },
                  { rank: 5, label: 'O(n²)',       match: t => t.includes('n^2') || t.includes('n²') || t.includes('n*n') },
                  { rank: 6, label: 'O(n³)',       match: t => t.includes('n^3') || t.includes('n³') },
                  { rank: 7, label: 'O(2ⁿ)',       match: t => t.includes('2^n') },
                  { rank: 8, label: 'O(n!)',       match: t => t.includes('n!') },
                ]
                function complexityRank(raw) {
                  const t = (raw || '').toLowerCase().replace(/\s/g, '')
                  if (!t || t === 'unknown' || t === 'n/a') return null
                  const hit = TC_RANK.find(r => r.match(t))
                  return hit ? hit.rank : 3
                }
                function rankLabel(r) {
                  const hit = TC_RANK.find(x => x.rank === r)
                  return hit ? hit.label : ''
                }

                // Difficulty-tier accuracy
                const diffTiers = ['easy', 'medium', 'hard']
                const diffStats = diffTiers.map(d => {
                  const items = dsaQs.filter(q => (q.difficulty || 'medium') === d)
                  const total = items.length
                  const solved = items.filter(q => q.tests_total > 0 && q.tests_passed === q.tests_total).length
                  const pass  = total ? Math.round((solved / total) * 100) : 0
                  return { tier: d.charAt(0).toUpperCase() + d.slice(1), pass, total, solved, fill: diffPalette[d] }
                }).filter(d => d.total > 0)

                // Score + pass-rate progression per problem (line)
                const progression = dsaQs.map((q, i) => ({
                  step: `Q${i + 1}`,
                  score: q.score || 0,
                  passRate: q.tests_total ? Math.round((q.tests_passed / q.tests_total) * 100) : 0,
                  label: q.problem_title || `Problem ${i + 1}`,
                }))

                // Complexity line data — time and space rank per problem
                const complexityLine = dsaQs.map((q, i) => ({
                  step: `Q${i + 1}`,
                  tc: complexityRank(q.time_complexity),
                  sc: complexityRank(q.space_complexity),
                  tcLabel: q.time_complexity || 'unknown',
                  scLabel: q.space_complexity || 'unknown',
                  label: q.problem_title || `Problem ${i + 1}`,
                }))
                const hasComplexityData = complexityLine.some(c => c.tc !== null || c.sc !== null)

                // Runtime line data per problem
                const runtimeLine = dsaQs.map((q, i) => ({
                  step: `Q${i + 1}`,
                  runtime: q.avg_runtime_ms || 0,
                  label: q.problem_title || `Problem ${i + 1}`,
                }))
                const hasRuntime = runtimeLine.some(r => r.runtime > 0)

                // Stacked test coverage per problem
                const coverage = dsaQs.map((q, i) => ({
                  name: `Q${i + 1}`,
                  passed: q.tests_passed || 0,
                  failed: Math.max(0, (q.tests_total || 0) - (q.tests_passed || 0)),
                  label: q.problem_title || `Problem ${i + 1}`,
                }))

                // Language breakdown (pill style, no chart needed for typically 1–2 languages)
                const langPalette = {
                  python: '#facc15', javascript: '#fbbf24', java: '#fb923c',
                  cpp: '#a78bfa', 'c++': '#a78bfa', c: '#94a3b8', go: '#22d3ee',
                  rust: '#ef4444', typescript: '#3b82f6', unknown: '#64748b',
                }
                const langCount = dsaQs.reduce((m, q) => {
                  const l = q.language || 'unknown'; m[l] = (m[l] || 0) + 1; return m
                }, {})

                return (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">

                    {/* ── Difficulty-Tier Solve Rate (bar — categorical) ────── */}
                    {diffStats.length > 0 && (
                      <div className="rounded-xl p-4" style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.15)' }}>
                        <p className="text-sm font-semibold mb-3 flex items-center gap-2"><Layers size={14}/> Difficulty-Tier Solve Rate</p>
                        <ResponsiveContainer width="100%" height={220}>
                          <BarChart data={diffStats} margin={{ top: 5, right: 10, bottom: 5, left: -15 }}>
                            <CartesianGrid stroke="var(--color-border)" vertical={false}/>
                            <XAxis dataKey="tier" tick={{ fill: '#94a3b8', fontSize: 11 }}/>
                            <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => `${v}%`}/>
                            <Tooltip
                              contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)' }}
                              formatter={(v, _n, p) => [`${v}% (${p.payload.solved}/${p.payload.total})`, 'Solved']}
                            />
                            <Bar dataKey="pass" radius={[6, 6, 0, 0]}>
                              {diffStats.map((d, i) => <Cell key={i} fill={d.fill}/>)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* ── Score & Test Pass-Rate Progression (line) ─────────── */}
                    <div className="rounded-xl p-4" style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.15)' }}>
                      <p className="text-sm font-semibold mb-1 flex items-center gap-2"><TrendingUp size={14}/> Score & Pass-Rate Trend</p>
                      <div className="flex gap-4 mb-3">
                        {[{ color: '#a78bfa', label: 'Score /10' }, { color: '#22d3ee', label: 'Tests %' }].map(l => (
                          <span key={l.label} className="flex items-center gap-1.5 text-xs text-muted">
                            <span className="w-3 h-0.5 rounded-full" style={{ background: l.color, display: 'inline-block' }}/>
                            {l.label}
                          </span>
                        ))}
                      </div>
                      <ResponsiveContainer width="100%" height={205}>
                        <LineChart data={progression} margin={{ top: 5, right: 16, bottom: 5, left: -20 }}>
                          <CartesianGrid stroke="var(--color-border)" vertical={false}/>
                          <XAxis dataKey="step" tick={{ fill: '#94a3b8', fontSize: 11 }}/>
                          <YAxis yAxisId="score" domain={[0, 10]} tick={{ fill: '#94a3b8', fontSize: 10 }} tickFormatter={v => `${v}`}/>
                          <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} tickFormatter={v => `${v}%`}/>
                          <Tooltip
                            contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)' }}
                            labelFormatter={(_, p) => p[0]?.payload?.label}
                            formatter={(v, name) => [name === 'score' ? `${v}/10` : `${v}%`, name === 'score' ? 'Score' : 'Tests passed']}
                          />
                          <ReferenceLine yAxisId="score" y={7} stroke="#4ade8060" strokeDasharray="4 3"/>
                          <Line yAxisId="score"  type="monotone" dataKey="score"    stroke="#a78bfa" strokeWidth={2.5} dot={{ r: 4, fill: '#a78bfa' }} activeDot={{ r: 6 }}/>
                          <Line yAxisId="pct"    type="monotone" dataKey="passRate" stroke="#22d3ee" strokeWidth={2}   dot={{ r: 3, fill: '#22d3ee' }} strokeDasharray="5 3"/>
                        </LineChart>
                      </ResponsiveContainer>
                    </div>

                    {/* ── Time & Space Complexity Profile (line) ────────────── */}
                    {hasComplexityData && (
                      <div className="rounded-xl p-4" style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.15)' }}>
                        <p className="text-sm font-semibold mb-1 flex items-center gap-2"><Brain size={14}/> Complexity Profile</p>
                        <div className="flex gap-4 mb-3">
                          {[{ color: '#f472b6', label: 'Time' }, { color: '#34d399', label: 'Space' }].map(l => (
                            <span key={l.label} className="flex items-center gap-1.5 text-xs text-muted">
                              <span className="w-3 h-0.5 rounded-full" style={{ background: l.color, display: 'inline-block' }}/>
                              {l.label}
                            </span>
                          ))}
                          <span className="text-xs text-muted ml-auto opacity-60">lower = better</span>
                        </div>
                        <ResponsiveContainer width="100%" height={205}>
                          <LineChart data={complexityLine} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                            <CartesianGrid stroke="var(--color-border)" vertical={false}/>
                            <XAxis dataKey="step" tick={{ fill: '#94a3b8', fontSize: 11 }}/>
                            <YAxis domain={[0, 8]} ticks={[1,2,3,4,5,6,7,8]} tick={{ fill: '#94a3b8', fontSize: 9 }} tickFormatter={rankLabel} width={56}/>
                            <Tooltip
                              contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)' }}
                              labelFormatter={(_, p) => p[0]?.payload?.label}
                              formatter={(v, name, props) => {
                                const raw = name === 'tc' ? props.payload.tcLabel : props.payload.scLabel
                                return [raw, name === 'tc' ? 'Time Complexity' : 'Space Complexity']
                              }}
                            />
                            <ReferenceLine y={3} stroke="#4ade8040" strokeDasharray="4 3" label={{ value: 'O(n)', fill: '#4ade8060', fontSize: 9, position: 'right' }}/>
                            <Line type="monotone" dataKey="tc" stroke="#f472b6" strokeWidth={2.5} dot={{ r: 4, fill: '#f472b6' }} connectNulls activeDot={{ r: 6 }}/>
                            <Line type="monotone" dataKey="sc" stroke="#34d399" strokeWidth={2}   dot={{ r: 3, fill: '#34d399' }} connectNulls strokeDasharray="5 3"/>
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* ── Runtime Profile (line) ────────────────────────────── */}
                    {hasRuntime && (
                      <div className="rounded-xl p-4" style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.15)' }}>
                        <p className="text-sm font-semibold mb-1 flex items-center gap-2"><Zap size={14}/> Runtime Profile</p>
                        <div className="flex gap-4 mb-3 items-center">
                          <span className="flex items-center gap-1.5 text-xs text-muted">
                            <span className="w-3 h-0.5 rounded-full" style={{ background: '#fb923c', display: 'inline-block' }}/>Avg runtime (ms)
                          </span>
                          <span className="text-xs text-muted ml-auto opacity-60">
                            <span style={{ color: '#22c55e' }}>●</span> &lt;50ms fast&nbsp;
                            <span style={{ color: '#eab308' }}>●</span> &lt;200ms ok&nbsp;
                            <span style={{ color: '#f87171' }}>●</span> slow
                          </span>
                        </div>
                        <ResponsiveContainer width="100%" height={205}>
                          <LineChart data={runtimeLine} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                            <CartesianGrid stroke="var(--color-border)" vertical={false}/>
                            <XAxis dataKey="step" tick={{ fill: '#94a3b8', fontSize: 11 }}/>
                            <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} tickFormatter={v => `${v}ms`}/>
                            <Tooltip
                              contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)' }}
                              labelFormatter={(_, p) => p[0]?.payload?.label}
                              formatter={v => [`${v} ms`, 'Runtime']}
                            />
                            <ReferenceLine y={50}  stroke="#22c55e40" strokeDasharray="4 3" label={{ value: '50ms', fill: '#22c55e80', fontSize: 9, position: 'right' }}/>
                            <ReferenceLine y={200} stroke="#f8717140" strokeDasharray="4 3" label={{ value: '200ms', fill: '#f8717180', fontSize: 9, position: 'right' }}/>
                            <Line type="monotone" dataKey="runtime" stroke="#fb923c" strokeWidth={2.5}
                              dot={(props) => {
                                const { cx, cy, payload } = props
                                const col = payload.runtime < 50 ? '#22c55e' : payload.runtime < 200 ? '#eab308' : '#f87171'
                                return <circle key={cx} cx={cx} cy={cy} r={5} fill={col} stroke={col}/>
                              }}
                              activeDot={{ r: 7 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* ── Test Coverage per Problem (stacked bar — counts) ────── */}
                    {coverage.some(c => c.passed + c.failed > 0) && (
                      <div className="rounded-xl p-4" style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.15)' }}>
                        <p className="text-sm font-semibold mb-3 flex items-center gap-2"><BarChart2 size={14}/> Test Coverage Per Problem</p>
                        <ResponsiveContainer width="100%" height={220}>
                          <BarChart data={coverage} margin={{ top: 5, right: 10, bottom: 5, left: -15 }}>
                            <CartesianGrid stroke="var(--color-border)" vertical={false}/>
                            <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }}/>
                            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }}/>
                            <Tooltip
                              contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)' }}
                              labelFormatter={(_, p) => p[0]?.payload?.label}
                            />
                            <Bar dataKey="passed" stackId="a" fill="#22c55e" name="Passed"/>
                            <Bar dataKey="failed" stackId="a" fill="#f87171" name="Failed" radius={[4, 4, 0, 0]}/>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* ── Language & Verdict Summary (pill card) ─────────────── */}
                    <div className="rounded-xl p-4" style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.15)' }}>
                      <p className="text-sm font-semibold mb-4 flex items-center gap-2"><Code2 size={14}/> Language & Verdict Breakdown</p>
                      <div className="mb-4">
                        <p className="text-xs text-muted uppercase tracking-wider mb-2">Languages used</p>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(langCount).map(([lang, count]) => (
                            <span key={lang} className="px-3 py-1.5 rounded-full text-xs font-semibold"
                              style={{ background: `${langPalette[lang] || '#94a3b8'}20`, color: langPalette[lang] || '#94a3b8', border: `1px solid ${langPalette[lang] || '#94a3b8'}40` }}>
                              {lang} — {count} problem{count > 1 ? 's' : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-muted uppercase tracking-wider mb-2">Verdict breakdown</p>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(verdictCounts).map(([v, cnt]) => (
                            <span key={v} className="px-3 py-1.5 rounded-full text-xs font-semibold capitalize"
                              style={{ background: `${verdictPalette[v] || '#94a3b8'}20`, color: verdictPalette[v] || '#94a3b8', border: `1px solid ${verdictPalette[v] || '#94a3b8'}40` }}>
                              {v.replace('_', ' ')} ×{cnt}
                            </span>
                          ))}
                        </div>
                      </div>
                      {/* Aggregate complexity summary */}
                      {dsaQs.some(q => q.time_complexity) && (
                        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'rgba(167,139,250,0.15)' }}>
                          <p className="text-xs text-muted uppercase tracking-wider mb-2">Complexity summary</p>
                          <div className="space-y-1.5">
                            {dsaQs.map((q, i) => (
                              <div key={i} className="flex items-center justify-between text-xs">
                                <span className="text-muted truncate max-w-[120px]">{q.problem_title || `Q${i+1}`}</span>
                                <div className="flex gap-2">
                                  {q.time_complexity && (
                                    <span className="px-2 py-0.5 rounded font-mono" style={{ background: 'rgba(244,114,182,0.1)', color: '#f472b6' }}>
                                      T: {q.time_complexity}
                                    </span>
                                  )}
                                  {q.space_complexity && (
                                    <span className="px-2 py-0.5 rounded font-mono" style={{ background: 'rgba(52,211,153,0.1)', color: '#34d399' }}>
                                      S: {q.space_complexity}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                  </div>
                )
              })()}

              {/* ── Complexity Match Table ─────────────────────────────────── */}
              <div className="mb-6">
                <p className="text-sm font-semibold mb-3 flex items-center gap-2"><Brain size={14}/> Complexity Adherence</p>
                <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--color-border)' }}>
                  <table className="w-full text-sm">
                    <thead style={{ background: 'rgba(167,139,250,0.08)' }}>
                      <tr className="text-xs uppercase tracking-wider text-muted">
                        <th className="px-3 py-2 text-left">Problem</th>
                        <th className="px-3 py-2 text-left">Difficulty</th>
                        <th className="px-3 py-2 text-left">Your Time</th>
                        <th className="px-3 py-2 text-left">Your Space</th>
                        <th className="px-3 py-2 text-left">Tests</th>
                        <th className="px-3 py-2 text-left">Verdict</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dsaQs.map((q, i) => {
                        const allPassed = q.tests_total > 0 && q.tests_passed === q.tests_total
                        return (
                          <tr key={i} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                            <td className="px-3 py-2 font-medium">{q.problem_title || q.question_text?.slice(0, 40) || `Problem ${i+1}`}</td>
                            <td className="px-3 py-2">
                              <span className="text-xs px-2 py-0.5 rounded-full font-semibold capitalize"
                                style={{ background: `${diffPalette[q.difficulty || 'medium']}20`, color: diffPalette[q.difficulty || 'medium'] }}>
                                {q.difficulty || 'medium'}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{q.time_complexity || '—'}</td>
                            <td className="px-3 py-2 font-mono text-xs">{q.space_complexity || '—'}</td>
                            <td className="px-3 py-2">
                              <span style={{ color: allPassed ? '#4ade80' : '#f87171' }}>
                                {q.tests_passed ?? 0}/{q.tests_total ?? 0}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span className="text-xs px-2 py-0.5 rounded-full font-semibold capitalize"
                                style={{ background: `${verdictPalette[q.verdict] || '#94a3b8'}20`, color: verdictPalette[q.verdict] || '#94a3b8' }}>
                                {(q.verdict || (allPassed ? 'acceptable' : 'incorrect')).replace('_', ' ')}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── Industry benchmark footer ──────────────────────────────── */}
              <div className="rounded-xl p-3 text-xs flex items-start gap-2"
                   style={{ background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.25)' }}>
                <Users size={14} className="mt-0.5 flex-shrink-0" style={{ color: '#22d3ee' }}/>
                <div>
                  <span className="font-semibold" style={{ color: '#22d3ee' }}>Industry Benchmark · </span>
                  <span className="text-muted">
                    Top FAANG candidates typically solve {N <= 2 ? '2/2' : `${Math.max(2, N - 1)}/${N}`} problems
                    within the time limit with O(n)/O(n log n) solutions. Your current solve rate of <strong className="text-white">{Math.round(solveRate*100)}%</strong>
                    {' '}places you in the
                    {' '}<strong className="text-white">{solveRate >= 0.8 ? 'top quartile' : solveRate >= 0.5 ? 'middle 50%' : 'bottom quartile'}</strong>{' '}
                    of new-grad candidates targeting senior-tier companies.
                  </span>
                </div>
              </div>
            </SectionCard>
          )
        })()}
        </SectionErrorBoundary>

        {/* ── Code Quality Analysis (DSA rounds only) ─────────────────────── */}
        <SectionErrorBoundary>
        {round_type === 'dsa' && code_quality_metrics && (
          <SectionCard icon={<BarChart2 size={16}/>} title="Code Quality Analysis" color="#a78bfa">
            {/* Aggregate stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              {[
                { label: 'Test Pass Rate', value: `${Math.round((code_quality_metrics.test_pass_rate || 0) * 100)}%` },
                { label: 'Avg Exec Time', value: `${code_quality_metrics.execution_time_ms || 0} ms` },
                { label: 'Avg Memory', value: `${code_quality_metrics.memory_kb || 0} KB` },
                { label: 'Naming Score', value: `${code_quality_metrics.variable_naming_score || 0}/100` },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg p-3 text-center" style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)' }}>
                  <p className="text-xs text-muted mb-1">{label}</p>
                  <p className="font-bold text-lg" style={{ color: '#a78bfa' }}>{value}</p>
                </div>
              ))}
            </div>

            {/* Per-question code quality radar */}
            {(() => {
              const perQ = code_quality_metrics?.per_question ?? []
              const firstRadar = perQ[0]?.code_quality_radar
              if (!firstRadar) return null
              // Aggregate radar across all questions
              const axes = Object.keys(firstRadar)
              const avgRadar = axes.map(axis => ({
                subject: axis,
                A: Math.round(perQ.reduce((sum, q) => sum + (q.code_quality_radar?.[axis] || 0), 0) / perQ.length),
                fullMark: 100,
              }))
              return (
                <div className="mb-5">
                  <p className="text-sm text-muted mb-3">Averaged across {perQ.length} question(s)</p>
                  <ResponsiveContainer width="100%" height={240}>
                    <RadarChart data={avgRadar}>
                      <PolarGrid stroke="var(--color-border)"/>
                      <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 11 }}/>
                      <Radar dataKey="A" stroke="#a78bfa" fill="#a78bfa" fillOpacity={0.25}/>
                      <Tooltip formatter={v => [`${v}/100`]} contentStyle={{ background: '#1e1e2e', border: '1px solid #a78bfa40' }}/>
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              )
            })()}

            {/* Per-question expandable cards */}
            <div className="space-y-3">
              {(code_quality_metrics?.per_question ?? []).map((q, i) => (
                <details key={i} className="rounded-lg overflow-hidden" style={{ background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.15)' }}>
                  <summary className="px-4 py-3 cursor-pointer text-sm font-medium flex items-center justify-between">
                    <span>{q.question_text ? q.question_text.slice(0, 60) + '…' : `Question ${i + 1}`}</span>
                    <span className="text-xs" style={{ color: q.test_pass_rate === 1 ? '#4ade80' : '#f87171' }}>
                      {q.test_pass_rate === 1 ? 'Accepted' : q.status || 'Not Accepted'}
                    </span>
                  </summary>
                  <div className="px-4 pb-4">
                    {q.code_review_notes?.length > 0 && (
                      <div className="mb-2">
                        <p className="text-xs font-semibold text-muted mb-1">Review Notes</p>
                        <ul className="list-disc list-inside space-y-1">
                          {q.code_review_notes.map((note, ni) => <li key={ni} className="text-sm">{note}</li>)}
                        </ul>
                      </div>
                    )}
                    {q.optimization_suggestions?.length > 0 && (
                      <div className="mb-2">
                        <p className="text-xs font-semibold text-muted mb-1">Optimizations</p>
                        <ul className="list-disc list-inside space-y-1">
                          {q.optimization_suggestions.map((s, si) => <li key={si} className="text-sm text-yellow-300">{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {q.complexity_analysis && (
                      <div className="flex gap-4 mt-2">
                        <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80' }}>
                          Time: {q.complexity_analysis.time}
                        </span>
                        <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(251,146,60,0.1)', color: '#fb923c' }}>
                          Space: {q.complexity_analysis.space}
                        </span>
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </SectionCard>
        )}

        </SectionErrorBoundary>

        {/* ── Peer Comparison ──────────────────────────────────────────────── */}
        <SectionErrorBoundary>
        {peer_comparison && (
          <SectionCard icon={<Users size={16}/>} title="Peer Comparison" color="#06b6d4">
            {(peer_comparison?.sample_size ?? 0) > 0 ? (
              <>
                {/* Summary strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                  {[
                    { label: 'Your Score',    val: `${overall}`,    color: scoreColor(overall) },
                    { label: 'Peer Avg',      val: peer_comparison.avg_peer_score != null ? `${peer_comparison.avg_peer_score}` : '—', color: '#94a3b8' },
                    { label: 'Percentile',    val: peer_comparison.overall_percentile != null ? `${peer_comparison.overall_percentile}th` : '—', color: '#06b6d4' },
                    { label: 'Peer Hire Rate',val: peer_comparison.hire_rate != null ? `${peer_comparison.hire_rate}%` : '—', color: '#4ade80' },
                  ].map(({ label, val, color }) => (
                    <div key={label} className="glass p-3 text-center rounded-xl">
                      <p className="text-xl font-bold" style={{ color }}>{val}</p>
                      <p className="text-xs text-muted mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>

                {/* Insight */}
                {peer_comparison.insight && (
                  <p className="text-sm text-muted mb-4 italic">{peer_comparison.insight}</p>
                )}

                {/* Radar comparison bar chart */}
                {peer_comparison.radar_comparison?.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs text-muted uppercase tracking-widest mb-2">Axis-by-Axis vs Peers</p>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart
                        data={peer_comparison.radar_comparison}
                        margin={{ top: 5, right: 10, bottom: 5, left: -20 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis dataKey="axis" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} />
                        <Tooltip
                          cursor={{ fill: 'rgba(6,182,212,0.08)' }}
                          content={
                            <ThemeTooltip
                              valueFormatter={(v, name) => [v, name === 'user_score' ? 'You' : 'Peer Avg']}
                            />
                          }
                        />
                        <Bar dataKey="user_score" name="you" fill="#06b6d4" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="peer_avg"   name="peer_avg" fill="rgba(148,163,184,0.4)" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Grade distribution */}
                {Object.keys(peer_comparison?.grade_distribution ?? {}).length > 0 && (
                  <div>
                    <p className="text-xs text-muted uppercase tracking-widest mb-2">Grade Distribution (peers)</p>
                    <div className="flex gap-2 flex-wrap">
                      {Object.entries(peer_comparison?.grade_distribution ?? {}).map(([g, pct]) => {
                        const isUser = g === (peer_comparison?.user_grade ?? '')
                        return (
                          <div key={g}
                            className="flex flex-col items-center px-3 py-2 rounded-xl text-xs"
                            style={{
                              background: isUser ? 'rgba(6,182,212,0.15)' : 'var(--color-surface-2)',
                              border: isUser ? '1px solid rgba(6,182,212,0.5)' : '1px solid var(--color-border)',
                            }}>
                            <span className="font-bold text-base" style={{ color: isUser ? '#06b6d4' : '#94a3b8' }}>{g}</span>
                            <span style={{ color: isUser ? '#06b6d4' : '#64748b' }}>{pct}%</span>
                            {isUser && <span className="text-[10px] text-cyan-400 mt-0.5">you</span>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <div className="glass p-4 rounded-xl text-center min-w-[90px]">
                    <p className="text-2xl font-bold" style={{ color: scoreColor(overall) }}>{peer_comparison?.user_grade ?? 'N/A'}</p>
                    <p className="text-xs text-muted mt-0.5">Your Grade</p>
                  </div>
                  <p className="text-sm text-muted flex-1">{peer_comparison?.insight || 'Not enough peer data yet to compute percentile — check back after more users complete this round.'}</p>
                </div>
              </div>
            )}
          </SectionCard>
        )}

        </SectionErrorBoundary>

        {/* ── Company Fit ─────────────────────────────────────────────────── */}
        <SectionErrorBoundary>
        {company_fit && (
          <SectionCard icon={<Target size={16}/>} title={`${company_fit.target_company || 'Company'} Fit Calibration`} color="#22d3ee">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              {[
                { label: 'Your Score', val: company_fit?.your_score != null ? `${company_fit.your_score}` : '—', color: scoreColor(company_fit?.your_score ?? 0) },
                { label: 'Bar Required', val: company_fit?.bar_score_required != null ? `${company_fit.bar_score_required}` : '—', color: '#94a3b8' },
                { label: 'Pass Probability', val: company_fit?.pass_probability != null ? `${company_fit.pass_probability}%` : '—', color: scoreColor(company_fit?.pass_probability ?? 0) },
              ].map(({ label, val, color }) => (
                <div key={label} className="text-center p-4 rounded-xl"
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                  <p className="text-2xl font-bold" style={{ color }}>{val}</p>
                  <p className="text-xs text-muted mt-1">{label}</p>
                </div>
              ))}
            </div>
            {company_fit.gap_breakdown?.length > 0 && (
              <div className="mb-4">
                <p className="text-xs text-muted uppercase tracking-wider mb-2">Dimension Gaps</p>
                <div className="space-y-2">
                  {company_fit.gap_breakdown.map((g, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <span className="flex-1 text-muted truncate">{g.dimension}</span>
                      <span style={{ color: scoreColor(g.yours) }}>{g.yours}</span>
                      <span className="text-muted">/ {g.required}</span>
                      <span style={{ color: g.delta < 0 ? '#f87171' : '#4ade80' }}>
                        {g.delta > 0 ? '+' : ''}{g.delta}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {company_fit.culture_gaps?.length > 0 && (
              <div className="mb-3">
                <p className="text-xs text-muted uppercase tracking-wider mb-2">Culture Gaps</p>
                {company_fit.culture_gaps.map((g, i) => (
                  <div key={i} className="flex gap-2 mb-1">
                    <span className="text-amber-400 flex-shrink-0">•</span>
                    <p className="text-sm text-muted">{g}</p>
                  </div>
                ))}
              </div>
            )}
            {company_fit.next_round_vulnerabilities?.length > 0 && (
              <div>
                <p className="text-xs text-muted uppercase tracking-wider mb-2">Next-Round Vulnerabilities</p>
                {company_fit.next_round_vulnerabilities.map((v, i) => (
                  <div key={i} className="flex gap-2 mb-1">
                    <AlertTriangle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-muted">{v}</p>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        )}

        </SectionErrorBoundary>

        <SectionErrorBoundary>

        {/* ── Skill Decay Alerts ──────────────────────────────────────────── */}
        {skill_decay?.length > 0 && (
          <div className="rounded-2xl p-5"
            style={{ background: 'rgba(251,146,60,0.07)', border: '1px solid rgba(251,146,60,0.25)' }}>
            <h2 className="font-bold mb-3 flex items-center gap-2 text-orange-400">
              <TrendingDown size={16} /> Skill Decay Detected
            </h2>
            <div className="space-y-2">
              {skill_decay.map((d, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <ArrowDown size={14} className="text-red-400 flex-shrink-0" />
                  <span className="font-medium">{d.skill}</span>
                  <span className="text-muted">{d.prev_score} → {d.curr_score}</span>
                  <Chip label={`${d.delta}`} color="#f87171" size="xs" />
                  <span className="text-xs text-muted flex-1">{d.alert_msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── CV Audit ────────────────────────────────────────────────────── */}
        {/* Hidden for MCQ — CV claims aren't probed in a multiple-choice test.
            Hidden for DSA — coding rounds don't probe resume claims. */}
        {round_type !== 'mcq_practice' && round_type !== 'dsa' && cv_audit?.items?.length > 0 && (
          <SectionCard icon={<Eye size={16}/>} title="CV Honesty Audit" color="#e879f9">
            <div className="flex items-center gap-4 mb-4">
              <ScoreRing score={cv_audit.overall_cv_honesty_score || 0} size={80} max={100} />
              <div>
                <p className="font-semibold">Honesty Score: {cv_audit.overall_cv_honesty_score}%</p>
                {cv_audit.note && <p className="text-sm text-muted mt-1">{cv_audit.note}</p>}
              </div>
            </div>
            <div className="space-y-2">
              {cv_audit.items.slice(0, 8).map((item, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  {item.answered_well === true
                    ? <CheckCircle size={13} className="text-green-400 flex-shrink-0" />
                    : item.answered_well === false
                      ? <XCircle size={13} className="text-red-400 flex-shrink-0" />
                      : <Minus size={13} className="text-muted flex-shrink-0" />
                  }
                  <span className="flex-1 truncate">{item.claim}</span>
                  <Chip label={item.demonstrated_level || 'Not Tested'} size="xs"
                    color={item.answered_well ? '#4ade80' : item.answered_well === false ? '#f87171' : '#94a3b8'} />
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* ── Skills to Work On ───────────────────────────────────────────── */}
        {skills_to_work_on?.length > 0 && (
          <SectionCard icon={<Zap size={16}/>} title="Skills to Work On" color="#facc15">
            <div className="space-y-3">
              {skills_to_work_on.map((s, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl"
                  style={{ background: 'rgba(250,204,21,0.06)', border: '1px solid rgba(250,204,21,0.15)' }}>
                  <Chip label={s.priority || 'Medium'} size="xs"
                    color={s.priority === 'High' ? '#f87171' : s.priority === 'Low' ? '#4ade80' : '#facc15'} />
                  <div>
                    <p className="text-sm font-medium">{s.skill}</p>
                    {s.reason && <p className="text-xs text-muted mt-0.5">{s.reason}</p>}
                    {s.resources?.length > 0 && (
                      <p className="text-xs text-purple-400 mt-1">→ {s.resources.join(' · ')}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        </SectionErrorBoundary>

        {/* ── 30-Day Sprint Plan ──────────────────────────────────────────── */}
        <SectionErrorBoundary>
        {thirty_day_plan && Object.keys(thirty_day_plan ?? {}).some(k => thirty_day_plan[k]?.length > 0) && (
          <SectionCard icon={<Clock size={16}/>} title="30-Day Sprint Plan" color="#22d3ee">
            <div className="space-y-4">
              {['week_1', 'week_2', 'week_3', 'week_4'].map((wk, wi) => {
                const items = thirty_day_plan[wk] || []
                if (!items.length) return null
                return (
                  <details key={wk} className="group">
                    <summary className="flex items-center gap-3 cursor-pointer select-none list-none p-3 rounded-xl"
                      style={{ background: 'rgba(34,211,238,0.06)' }}>
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg, #22d3ee, #7c3aed)' }}>
                        {wi + 1}
                      </div>
                      <span className="font-medium text-sm">Week {wi + 1}</span>
                      <span className="text-xs text-muted ml-auto">{items.length} task{items.length > 1 ? 's' : ''}</span>
                      <ChevronRight size={14} className="text-muted group-open:rotate-90 transition-transform" />
                    </summary>
                    <div className="mt-2 space-y-2 pl-3">
                      {items.map((item, ii) => (
                        <div key={ii} className="p-3 rounded-xl text-sm"
                          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                          <p className="font-medium">{item.topic}</p>
                          {item.goal && <p className="text-xs text-muted mt-0.5">{item.goal}</p>}
                          {item.task && <p className="text-xs text-cyan-400 mt-0.5">→ {item.task}</p>}
                          <div className="flex items-center gap-3 mt-1">
                            {item.resource && <span className="text-xs text-purple-400">{item.resource}</span>}
                            {item.hours && <span className="text-xs text-muted">{item.hours}h</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )
              })}
            </div>
          </SectionCard>
        )}

        {/* ── Follow-Up Questions ─────────────────────────────────────────── */}
        {/* Hidden for MCQ — interviewer follow-up framing doesn't fit a written test.
            Hidden for DSA — verbal follow-up framing doesn't fit a coding submission. */}
        {round_type !== 'mcq_practice' && round_type !== 'dsa' && follow_up_questions?.length > 0 && (
          <SectionCard icon={<MessageSquare size={16}/>} title="A Human Interviewer Would Now Ask…" color="#a78bfa">
            <div className="space-y-3">
              {follow_up_questions.map((q, i) => (
                <details key={i} className="group glass">
                  <summary className="flex items-center gap-3 p-4 cursor-pointer select-none list-none">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-lg flex-shrink-0"
                      style={{ background: 'rgba(167,139,250,0.15)', color: '#a78bfa' }}>
                      Q{i + 1}
                    </span>
                    <p className="text-sm flex-1">{q.question}</p>
                    <ChevronRight size={14} className="text-muted group-open:rotate-90 transition-transform" />
                  </summary>
                  <div className="px-4 pb-4 space-y-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
                    {q.why_asked && (
                      <p className="text-xs text-muted mt-3"><span className="text-amber-400">Why:</span> {q.why_asked}</p>
                    )}
                    {Array.isArray(q.model_answer_hint)
                      ? q.model_answer_hint.map((h, j) => (
                          <p key={j} className="text-xs text-green-400">• {h}</p>
                        ))
                      : q.model_answer_hint && (
                          <p className="text-xs text-green-400">{q.model_answer_hint}</p>
                        )
                    }
                  </div>
                </details>
              ))}
            </div>
          </SectionCard>
        )}

        </SectionErrorBoundary>

        {/* ── Per-Question Deep Dive ───────────────────────────────────────── */}
        {/* Hidden for MCQ — the MCQ analytics block above already shows option-level review */}
        <SectionErrorBoundary>
        {round_type !== 'mcq_practice' && (per_question_analysis?.length > 0 || question_scores?.length > 0) && (
          <div>
            <h2 className="font-bold mb-4 flex items-center gap-2">
              <ChevronRight size={16} className="text-purple-400" /> Question-by-Question Feedback
            </h2>
            <div className="space-y-3">
              {(per_question_analysis?.length ? per_question_analysis : question_scores).map((q, i) => (
                <details key={i} className="glass group">
                  <summary className="flex items-center gap-3 p-4 cursor-pointer select-none list-none">
                    {(q.skipped || q.score == null) ? (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-lg flex-shrink-0 badge badge-yellow">
                        Q{i + 1} · Skipped
                      </span>
                    ) : (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-lg flex-shrink-0"
                        style={{ background: `${scoreColor10(q.score)}20`, color: scoreColor10(q.score) }}>
                        Q{i + 1} · {q.score}/10
                      </span>
                    )}
                    <p className="text-sm flex-1 line-clamp-1">{q.question_text || q.question || ''}</p>
                    <Chip label={q.category || q.topic || 'General'} size="xs" color="#22d3ee" />
                    {q.verdict && q.verdict !== 'skipped' && (
                      <Chip label={q.verdict} size="xs" color={scoreColor10(q.score)} />
                    )}
                    <ChevronRight size={14} className="text-muted group-open:rotate-90 transition-transform" />
                  </summary>
                  <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="mt-3">
                      <p className="text-xs text-muted uppercase tracking-wider mb-1">Category</p>
                      <div>
                        <Chip label={q.category || q.topic || 'General'} color="#22d3ee" size="xs" />
                      </div>
                    </div>
                    {(q.skipped || q.answer_text === '[SKIPPED]') && (
                      <div>
                        <p className="text-xs text-muted uppercase tracking-wider mb-1">Status</p>
                        <p className="text-sm text-yellow-400">Candidate skipped this question.</p>
                      </div>
                    )}
                    {q.answer_summary && !q.skipped && (
                      <div>
                        <p className="text-xs text-muted uppercase tracking-wider mb-1">Summary</p>
                        <p className="text-sm leading-relaxed text-muted">{q.answer_summary}</p>
                      </div>
                    )}
                    {q.key_insight && (
                      <div>
                        <p className="text-xs text-muted uppercase tracking-wider mb-1">Key Insight</p>
                        <p className="text-sm text-purple-300">{q.key_insight}</p>
                      </div>
                    )}
                    {(q.strengths?.length > 0 || q.improvements?.length > 0) && (
                      <div className="grid sm:grid-cols-2 gap-3">
                        {q.strengths?.length > 0 && (
                          <div>
                            <p className="text-xs text-green-400 font-semibold mb-1">✓ Strengths</p>
                            {q.strengths.map((s, j) => <p key={j} className="text-xs text-muted">• {s}</p>)}
                          </div>
                        )}
                        {q.improvements?.length > 0 && (
                          <div>
                            <p className="text-xs text-red-400 font-semibold mb-1">✗ Improve</p>
                            {q.improvements.map((s, j) => <p key={j} className="text-xs text-muted">• {s}</p>)}
                          </div>
                        )}
                      </div>
                    )}
                    {/* DSA-specific: code excerpt + complexity + tests passed */}
                    {round_type === 'dsa' && (q.code_excerpt || q.problem_slug) && (
                      <div className="space-y-3">
                        {(q.tests_passed != null && q.tests_total != null) && (
                          <div className="flex flex-wrap gap-2">
                            <Chip
                              label={`${q.tests_passed}/${q.tests_total} tests`}
                              color={q.tests_passed === q.tests_total ? '#4ade80' : '#f87171'}
                              size="xs"
                            />
                            {q.language && <Chip label={q.language} color="#94a3b8" size="xs" />}
                            {q.time_complexity && <Chip label={`Time: ${q.time_complexity}`} color="#22d3ee" size="xs" />}
                            {q.space_complexity && <Chip label={`Space: ${q.space_complexity}`} color="#fb923c" size="xs" />}
                            {q.avg_runtime_ms != null && <Chip label={`${q.avg_runtime_ms} ms avg`} color="#a78bfa" size="xs" />}
                          </div>
                        )}
                        {q.code_excerpt && (
                          <div>
                            <p className="text-xs text-muted uppercase tracking-wider mb-1">Submitted Code</p>
                            <pre className="text-xs p-3 rounded-lg overflow-x-auto"
                              style={{
                                background: 'rgba(15,23,42,0.6)',
                                border: '1px solid var(--color-border)',
                                color: '#e2e8f0',
                                fontFamily: "'JetBrains Mono','Fira Code',monospace",
                                maxHeight: 320,
                              }}>
                              <code>{q.code_excerpt}</code>
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                    {/* "Review the Tape" — audio playback if URL stored (verbal rounds) */}
                    {round_type !== 'dsa' && (
                      <AudioClipPlayer
                        audioUrl={q.audio_url}
                        startSec={q.audio_start_sec}
                        label={`Review Q${i + 1} Audio`}
                      />
                    )}
                  </div>
                </details>
              ))}
            </div>
          </div>
        )}

        {/* Adaptive Study Schedule — deferred (needs 3+ sessions to be meaningful) */}
        {false && study_schedule != null && (
          <SectionCard icon={<BookOpen size={16}/>} title="Adaptive Study Schedule" color="#4ade80">
            {study_schedule.topics?.length === 0 && (
              <div className="flex items-center gap-3 py-2">
                <CheckCircle size={18} className="text-green-400 shrink-0" />
                <p className="text-sm text-muted">No weak areas identified — solid performance across all topics. Nothing to schedule!</p>
              </div>
            )}
            {study_schedule.topics?.length > 0 && (<>
            <div className="flex flex-wrap gap-4 mb-5 text-sm">
              <span className="text-muted">
                <span className="font-semibold text-white">{study_schedule.topics.length}</span> topics tracked
              </span>
              {study_schedule.days_until_target != null && (
                <span className="text-muted">
                  <span className="font-semibold text-white">{study_schedule.days_until_target}</span> days to interview
                </span>
              )}
              <span className="text-muted">
                <span className="font-semibold text-white">{study_schedule.schedule_horizon}</span>-day horizon
              </span>
            </div>

            {/* Topic cards */}
            <div className="space-y-3">
              {study_schedule.topics.map(t => {
                const pColor = t.priority === 'Critical' ? '#f87171'
                  : t.priority === 'High'     ? '#fb923c'
                  : t.priority === 'Medium'   ? '#facc15'
                  : '#4ade80'
                return (
                  <div key={t.topic}
                    className="glass p-4 rounded-xl"
                    style={{ borderLeft: `3px solid ${pColor}` }}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-semibold text-sm text-white">{t.topic}</p>
                      <div className="flex items-center gap-2">
                        {t.score != null && (
                          <span className="text-xs text-muted">Score: <span className="font-bold text-white">{t.score}</span></span>
                        )}
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: `${pColor}20`, color: pColor }}>
                          {t.priority}
                        </span>
                      </div>
                    </div>
                    {/* Review timeline */}
                    <div className="flex flex-wrap gap-2">
                      {t.reviews.map((r, i) => (
                        <div key={i}
                          className="text-xs px-2.5 py-1 rounded-lg text-center"
                          style={{ background: 'var(--color-surface-2)', minWidth: 80 }}>
                          <p className="font-medium" style={{ color: 'var(--color-text)' }}>{r.session_type}</p>
                          <p className="text-muted">{r.date}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Next 7 days quick view */}
            {(() => {
              const today = new Date()
              const next7 = Object.entries(study_schedule.daily_plan || {})
                .filter(([d]) => {
                  const diff = (new Date(d) - today) / 86400000
                  return diff >= 0 && diff < 7
                })
                .slice(0, 7)
              if (!next7.length) return null
              return (
                <div className="mt-5">
                  <p className="text-xs text-muted uppercase tracking-widest mb-2">Next 7 Days</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {next7.map(([d, topics]) => (
                      <div key={d} className="glass p-2.5 rounded-xl text-xs">
                        <p className="font-semibold text-white mb-1">{new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                        {topics.map(tp => (
                          <p key={tp} className="text-muted truncate">· {tp}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
            </>)}
          </SectionCard>
        )}

        {/* ── Preparation Checklist ──────────────────────────────────────── */}
        {(checklistItems ?? reportChecklist)?.length > 0 && (() => {
          const items = checklistItems ?? reportChecklist
          const CAT_COLOR = {
            'Weak Area Fix':    '#f87171',
            'Practice':         '#06b6d4',
            'Concept Review':   '#7c3aed',
            'Resource':         '#f59e0b',
            'Mock Interview':   '#4ade80',
            'Company Research': '#a78bfa',
          }
          const handleToggle = async (item) => {
            const next = !item.checked
            // Optimistic update
            setChecklistItems(prev =>
              (prev ?? items).map(i => i.id === item.id ? { ...i, checked: next } : i)
            )
            if (checklistId) {
              try { await toggleChecklistItem(checklistId, item.id, next) } catch (_) {}
            }
          }
          return (
            <SectionCard icon={<CheckCircle size={16}/>} title="Preparation Checklist" color="#4ade80">
              <p className="text-xs text-muted mb-4">
                {items.filter(i => i.checked).length} / {items.length} completed
                {!checklistId && <span className="ml-2 opacity-50">(read-only — log in to save progress)</span>}
              </p>
              <div className="space-y-2">
                {items.map((item) => {
                  const catColor = CAT_COLOR[item.category] || '#94a3b8'
                  const priorityColor = item.priority === 'High' ? '#f87171' : item.priority === 'Medium' ? '#facc15' : '#4ade80'
                  return (
                    <button key={item.id}
                      onClick={() => handleToggle(item)}
                      className="w-full flex items-start gap-3 p-3 rounded-xl text-left transition-opacity hover:opacity-80"
                      style={{ background: 'var(--color-surface-2)', opacity: item.checked ? 0.5 : 1 }}>
                      <div className="w-4 h-4 rounded mt-0.5 flex-shrink-0 flex items-center justify-center"
                        style={{ background: item.checked ? '#4ade80' : 'var(--color-surface-3)', border: '1px solid var(--color-border)' }}>
                        {item.checked && <Check size={12} style={{ color: '#0f172a' }} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm" style={{ color: 'var(--color-text)', textDecoration: item.checked ? 'line-through' : 'none' }}>{item.title}</p>
                        {item.details && <p className="text-xs text-muted mt-0.5 truncate">{item.details}</p>}
                      </div>
                      <div className="flex-shrink-0 flex flex-col items-end gap-1">
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: `${catColor}20`, color: catColor }}>{item.category}</span>
                        <span className="text-xs" style={{ color: priorityColor }}>{item.priority}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </SectionCard>
          )
        })()}


        </SectionErrorBoundary>

        {/* ── Interview Integrity (proctoring) — shown at bottom ──────────── */}
        {/* Hidden for MCQ — proctoring is disabled for written tests */}
        {round_type !== 'mcq_practice' && interview_integrity && (
          <SectionCard icon={<Shield size={16}/>} title="Interview Integrity" color="#22d3ee">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Status', value: interview_integrity?.status ?? 'Unknown', color: interview_integrity?.status === 'Clear' ? '#4ade80' : interview_integrity?.status === 'Minor Concerns' ? '#facc15' : '#f87171' },
                { label: 'Integrity Score', value: `${interview_integrity?.score ?? '—'}/100`, color: scoreColor(interview_integrity?.score ?? 0) },
                { label: 'Flagged Events', value: interview_integrity?.total_incidents ?? 0, color: '#f97316' },
                { label: 'Camera Uptime', value: `${Math.round((proctoring_summary?.camera_uptime_ratio || 0) * 100)}%`, color: '#22d3ee' },
              ].map(card => (
                <div key={card.label} className="rounded-xl p-4"
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                  <p className="text-xs text-muted uppercase tracking-wider mb-1">{card.label}</p>
                  <p className="text-lg font-bold" style={{ color: card.color }}>{card.value}</p>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted leading-relaxed mb-4">{interview_integrity?.summary || 'No integrity summary available.'}</p>
            {proctoring_summary?.counts && Object.keys(proctoring_summary.counts).length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {Object.entries(proctoring_summary?.counts ?? {}).map(([key, value]) => (
                  <Chip key={key} label={`${key.replaceAll('_', ' ')}: ${value}`} color={value ? '#f97316' : '#64748b'} size="xs" />
                ))}
              </div>
            )}
            <div className="space-y-2">
              {interview_integrity.highlights?.map((item, index) => (
                <div key={index} className="flex gap-2 text-sm">
                  <AlertTriangle size={14} className="text-amber-300 flex-shrink-0 mt-0.5" />
                  <p className="text-muted">{item}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* ── Next Interview Blueprint CTA ─────────────────────────────────── */}
        <SectionErrorBoundary>
        {next_interview_blueprint && (
          <div className="rounded-2xl p-6 text-center"
            style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.15), rgba(34,211,238,0.1))', border: '1px solid rgba(124,58,237,0.3)' }}>
            <Star size={24} className="text-purple-400 mx-auto mb-3" />
            <h3 className="font-bold text-lg mb-1">Your Next Interview</h3>
            <p className="text-muted text-sm mb-4">{next_interview_blueprint?.reason || 'Personalized recommendation based on your performance.'}</p>
            <div className="flex flex-wrap justify-center gap-2 mb-4">
              <Chip label={ROUND_LABELS[next_interview_blueprint?.round_type] || next_interview_blueprint?.round_type || 'Technical'} color="#7c3aed" />
              <Chip label={next_interview_blueprint?.difficulty || 'Medium'} color="#22d3ee" />
              <Chip label={`${next_interview_blueprint?.timer_mins ?? 30}m`} color="#a78bfa" />
              {next_interview_blueprint.focus_topics?.map((t, i) => (
                <Chip key={i} label={t} color="#4ade80" size="xs" />
              ))}
            </div>
            <button onClick={() => navigate('/')} className="btn-primary">
              <RotateCcw size={16} /> Start This Session
            </button>
          </div>
        )}
        </SectionErrorBoundary>

      </div>
    </div>
  )
}
