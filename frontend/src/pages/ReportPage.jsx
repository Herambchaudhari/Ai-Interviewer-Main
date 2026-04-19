/**
 * ReportPage — Full post-interview Ultra-Report with SSE streaming.
 * Route: /report/:sessionId
 *
 * Sections (in render order):
 *  1. SSE Loading State  (while generating)
 *  2. What Went Wrong callout
 *  3. Score Header + Improvement Delta
 *  4. Repeated Offenders alert
 *  5. 6-Axis Communication Radar + Delivery Consistency
 *  6. Filler & Hesitation Heatmap
 *  7. Per-Question Deep Dive
 *  8. Root Cause Pattern Groups + B.S. Detector
 *  9. Company Fit Calibration (if target_company set)
 * 10. SWOT Analysis
 * 11. Skill Decay Alerts
 * 12. CV Audit
 * 13. Skills to Work On
 * 14. 30-Day Sprint Plan
 * 15. Follow-Up Questions
 * 16. Next Interview Blueprint CTA
 * 17. Study Recommendations (legacy)
 */
import './print.css'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid,
} from 'recharts'
import { getReportWithSSE, getCachedReportOnly, generateShareLink, getUserChecklists, toggleChecklistItem } from '../lib/api'
import {
  Trophy, TrendingUp, TrendingDown, BookOpen, ChevronRight,
  Star, RotateCcw, Home, CheckCircle, XCircle, AlertTriangle,
  Target, Zap, Brain, ArrowUp, ArrowDown, Minus, Shield,
  MessageSquare, BarChart2, Compass, Clock, Flame, Eye,
  Share2, Download, Play, Pause, Volume2, X, Copy, Check, Users,
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

function ScoreRing({ score, size = 120, max = 100 }) {
  const R   = (size / 2) - 10
  const C   = 2 * Math.PI * R
  const pct = Math.min(100, Math.max(0, score)) / max
  const off = C * (1 - pct)
  const col = scoreColor(score)
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg style={{ transform: 'rotate(-90deg)' }} width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={8}/>
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
          background: playing ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.06)',
          border: `1px solid ${playing ? 'rgba(124,58,237,0.5)' : 'rgba(255,255,255,0.1)'}`,
          color: playing ? '#a78bfa' : 'var(--color-muted)',
        }}>
        {playing ? <Pause size={11} /> : <Play size={11} />}
        <Volume2 size={10} />
        {label || 'Review the Tape'}
      </button>
      {playing && (
        <div className="flex-1 max-w-[120px] h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
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
          <p className="text-xs text-muted pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
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
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'var(--color-text)',
                }}
              />
              <button
                onClick={copyShareUrl}
                className="flex items-center gap-1.5 text-xs py-2 px-3 rounded-lg transition-all"
                style={{
                  background: urlCopied ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.07)',
                  border: `1px solid ${urlCopied ? '#4ade80' : 'rgba(255,255,255,0.12)'}`,
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
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
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
          <div className="h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.07)' }}>
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
            <div key={s.key} className={`flex items-center gap-2 text-xs transition-all ${
              progress >= s.pct ? 'text-white' : 'text-muted'
            }`}>
              {progress >= s.pct
                ? <CheckCircle size={12} style={{ color: '#4ade80' }} />
                : <div className="w-3 h-3 rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }} />
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

function QTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload || {}
  return (
    <div className="glass p-3 text-xs max-w-xs" style={{ border: '1px solid rgba(124,58,237,0.4)' }}>
      <p className="font-semibold mb-1 text-white text-sm">{d.label}</p>
      <p className="text-muted">{d.question_text}</p>
      <p className="mt-1" style={{ color: scoreColor(d.score * 10) }}>Score: {d.score}/10</p>
    </div>
  )
}

function FillerTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload || {}
  return (
    <div className="glass p-3 text-xs max-w-xs" style={{ border: '1px solid rgba(251,146,60,0.4)' }}>
      <p className="font-semibold text-white mb-1">{d.question_id}</p>
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

  useEffect(() => {
    if (!sessionId) return

    const cacheKey = `report_${sessionId}`

    function applyReport(reportData) {
      setReport(reportData)
      if (reportData?.checklist?.length > 0) setChecklistItems(reportData.checklist)
      try { sessionStorage.setItem(cacheKey, JSON.stringify(reportData)) } catch (_) {}
      setLoading(false)
    }

    function startSSE() {
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
          setProgress(evt.progress || 10)
          setStageLabel(evt.label || 'Processing…')
        },
        applyReport,
        (errMsg) => {
          setError(errMsg || 'Failed to load report.')
          setLoading(false)
        },
      )
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
          setChecklistItems(prev => prev ?? match.items)
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
        <button onClick={() => navigate('/dashboard')} className="btn-primary">Back to Dashboard</button>
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

  const qaData = (per_question_analysis?.length ? per_question_analysis : question_scores).map((q, i) => ({
    label: `Q${i + 1}`, question_text: q.question_text || q.question || '',
    score: q.score || 0,
  }))

  const fillerData = filler_heatmap.map(f => ({
    question_id: f.question_id, filler_count: f.filler_count || 0,
    confidence_score: f.confidence_score || 0, filler_words: f.filler_words || [],
  }))

  const deliveryArc = (delivery_consistency?.arc_plot || []).map((v, i) => ({
    q: `Q${i + 1}`, confidence: v,
  }))

  // MCQ category breakdown chart data — always an array from backend now
  const mcqCategoryData = (Array.isArray(category_breakdown) ? category_breakdown : []).map(d => ({
    category: d.category || 'Uncategorized',
    accuracy: d.accuracy ?? 0,
    correct:  d.correct  ?? 0,
    total:    d.total    ?? 1,
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

        {/* ── Nav ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold gradient-text mb-1">Interview Report</h1>
            {session_label && (
              <p className="text-sm font-semibold text-white/90 mb-1">{session_label}</p>
            )}
            <p className="text-muted text-sm">
              {ROUND_LABELS[round_type]} · {difficulty} · {num_questions} Qs · {timer_mins}m
              {target_company && <> · <span className="text-purple-400">{target_company}</span></>}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
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
                  <Chip key={i} label={`${r.issue} ×${r.count_across_sessions}`} color="#f59e0b" />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Hero Score Card ─────────────────────────────────────────────── */}
        {interview_integrity && (
          <SectionCard icon={<Shield size={16}/>} title="Interview Integrity" color="#22d3ee">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Status', value: interview_integrity.status, color: interview_integrity.status === 'Clear' ? '#4ade80' : interview_integrity.status === 'Minor Concerns' ? '#facc15' : '#f87171' },
                { label: 'Integrity Score', value: `${interview_integrity.score}/100`, color: scoreColor(interview_integrity.score) },
                { label: 'Flagged Events', value: interview_integrity.total_incidents, color: '#f97316' },
                { label: 'Camera Uptime', value: `${Math.round((proctoring_summary?.camera_uptime_ratio || 0) * 100)}%`, color: '#22d3ee' },
              ].map(card => (
                <div key={card.label} className="rounded-xl p-4"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)' }}>
                  <p className="text-xs text-muted uppercase tracking-wider mb-1">{card.label}</p>
                  <p className="text-lg font-bold" style={{ color: card.color }}>{card.value}</p>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted leading-relaxed mb-4">{interview_integrity.summary}</p>
            {proctoring_summary?.counts && (
              <div className="flex flex-wrap gap-2 mb-4">
                {Object.entries(proctoring_summary.counts).map(([key, value]) => (
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
              { label: 'Answered',  val: qaData.filter(q => q.score > 0).length },
              { label: 'Score',     val: `${overall}` },
              { label: 'Grade',     val: grade || '—' },
            ].map(({ label, val }) => (
              <div key={label} className="text-center p-3 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)' }}>
                <p className="font-bold text-lg leading-none">{val}</p>
                <p className="text-xs text-muted mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── 6-Axis Communication Radar + Delivery Consistency ───────────── */}
        {(radarData.length > 0 || deliveryArc.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {radarData.length > 0 && (
              <SectionCard icon={<MessageSquare size={16}/>} title="Communication (6-Axis)" color="#22d3ee">
                <ResponsiveContainer width="100%" height={260}>
                  <RadarChart data={radarData} margin={{ top: 0, right: 30, bottom: 0, left: 30 }}>
                    <PolarGrid stroke="rgba(255,255,255,0.08)" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                    <Radar name="Score" dataKey="A" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.2}
                      dot={{ r: 3, fill: '#67e8f9' }} />
                  </RadarChart>
                </ResponsiveContainer>
                {communication_breakdown && Object.keys(communication_breakdown).length > 0 && (
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    {Object.entries(communication_breakdown).map(([k, v]) => (
                      <div key={k} className="flex justify-between items-center text-xs">
                        <span className="text-muted truncate mr-2">{k}</span>
                        <span className="font-semibold flex-shrink-0" style={{ color: scoreColor(v) }}>{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            )}

            {deliveryArc.length > 0 && (
              <SectionCard icon={<TrendingUp size={16}/>} title="Delivery Consistency" color="#a78bfa">
                {delivery_consistency?.verdict && (
                  <p className="text-sm text-muted mb-3">
                    <span className="font-semibold text-white">{delivery_consistency.verdict}</span>
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
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${v}%`}
                />
                <YAxis
                  type="category"
                  dataKey="category"
                  width={90}
                  tick={{ fill: '#e2e8f0', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(245,158,11,0.08)' }}
                  contentStyle={{ background: '#1e1e2e', border: '1px solid #f59e0b40', borderRadius: 8, fontSize: 12 }}
                  formatter={(value, name, props) => [
                    `${value}%  (${props.payload.correct}/${props.payload.total} correct)`,
                    'Accuracy',
                  ]}
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

        {/* ── Filler & Hesitation Heatmap ─────────────────────────────────── */}
        {fillerData.length > 0 && (
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

        {/* ── Per-Question Scores Chart ────────────────────────────────────── */}
        {qaData.length > 0 && (
          <SectionCard icon={<TrendingUp size={16}/>} title="Per-Question Scores" color="#4ade80">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={qaData} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 10]} tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<QTooltip />} cursor={{ fill: 'rgba(124,58,237,0.08)' }} />
                <Bar dataKey="score" radius={[6, 6, 0, 0]}>
                  {qaData.map((e, i) => <Cell key={i} fill={scoreColor10(e.score)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>
        )}

        {/* ── Strong & Weak Areas ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <SectionCard icon={<CheckCircle size={16}/>} title="Strong Areas" color="#4ade80">
            {strong_areas.length === 0 ? <p className="text-muted text-sm">—</p>
              : strong_areas.map((a, i) => {
                const { area, evidence, score } = normArea(a)
                return (
                  <div key={i} className="flex items-start gap-2 mb-3">
                    <CheckCircle size={14} className="text-green-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">{area || a}</p>
                      {evidence && <p className="text-xs text-muted mt-0.5">"{evidence}"</p>}
                      {score && <Chip label={`${score}/100`} color="#4ade80" size="xs" />}
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

        {/* ── Root Cause Pattern Groups ────────────────────────────────────── */}
        {pattern_groups?.length > 0 && (
          <SectionCard icon={<Brain size={16}/>} title="Root Cause Analysis" color="#e879f9">
            <div className="space-y-4">
              {pattern_groups.map((p, i) => (
                <div key={i} className="p-4 rounded-xl"
                  style={{ background: `rgba(232,121,249,0.06)`, border: '1px solid rgba(232,121,249,0.2)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Chip label={p.severity || 'medium'} color={p.severity === 'critical' ? '#f87171' : p.severity === 'high' ? '#fb923c' : '#facc15'} />
                    <p className="font-semibold text-sm">{p.pattern}</p>
                  </div>
                  {p.questions_affected?.length > 0 && (
                    <p className="text-xs text-muted mb-1">Affects: {p.questions_affected.join(', ')}</p>
                  )}
                  <p className="text-sm text-muted"><span className="text-white">Root cause:</span> {p.core_gap}</p>
                  {p.evidence && <p className="text-xs text-muted mt-1 italic">"{p.evidence}"</p>}
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* ── B.S. Detector ───────────────────────────────────────────────── */}
        {bs_flag?.length > 0 && (
          <div className="rounded-2xl p-5"
            style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <h2 className="font-bold mb-3 flex items-center gap-2 text-red-400">
              <Shield size={16} /> Evasion Detected
            </h2>
            <p className="text-xs text-muted mb-3">Questions where you rambled without giving a real answer:</p>
            <div className="space-y-3">
              {bs_flag.map((f, i) => (
                <div key={i} className="flex gap-3">
                  <Chip label={f.question_id} color="#f87171" />
                  <div>
                    <p className="text-sm">{f.flag_reason}</p>
                    <p className="text-xs text-muted">Detection confidence: {f.confidence}%</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Code Quality Analysis (DSA rounds only) ─────────────────────── */}
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
              const perQ = code_quality_metrics.per_question || []
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
                      <PolarGrid stroke="rgba(255,255,255,0.1)"/>
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
              {(code_quality_metrics.per_question || []).map((q, i) => (
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

        {/* ── Peer Comparison ──────────────────────────────────────────────── */}
        {peer_comparison && (
          <SectionCard icon={<Users size={16}/>} title="Peer Comparison" color="#06b6d4">
            {peer_comparison.sample_size > 0 ? (
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
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="axis" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} />
                        <Tooltip
                          contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }}
                          formatter={(v, name) => [v, name === 'user_score' ? 'You' : 'Peer Avg']}
                        />
                        <Bar dataKey="user_score" name="you" fill="#06b6d4" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="peer_avg"   name="peer_avg" fill="rgba(148,163,184,0.4)" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Grade distribution */}
                {Object.keys(peer_comparison.grade_distribution || {}).length > 0 && (
                  <div>
                    <p className="text-xs text-muted uppercase tracking-widest mb-2">Grade Distribution (peers)</p>
                    <div className="flex gap-2 flex-wrap">
                      {Object.entries(peer_comparison.grade_distribution).map(([g, pct]) => {
                        const isUser = g === peer_comparison.user_grade
                        return (
                          <div key={g}
                            className="flex flex-col items-center px-3 py-2 rounded-xl text-xs"
                            style={{
                              background: isUser ? 'rgba(6,182,212,0.15)' : 'rgba(255,255,255,0.04)',
                              border: isUser ? '1px solid rgba(6,182,212,0.5)' : '1px solid rgba(255,255,255,0.08)',
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
                    <p className="text-2xl font-bold" style={{ color: scoreColor(overall) }}>{peer_comparison.user_grade}</p>
                    <p className="text-xs text-muted mt-0.5">Your Grade</p>
                  </div>
                  <p className="text-sm text-muted flex-1">{peer_comparison.insight || 'Not enough peer data yet to compute percentile — check back after more users complete this round.'}</p>
                </div>
              </div>
            )}
          </SectionCard>
        )}

        {/* ── Company Fit ─────────────────────────────────────────────────── */}
        {company_fit && (
          <SectionCard icon={<Target size={16}/>} title={`${company_fit.target_company || 'Company'} Fit Calibration`} color="#22d3ee">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              {[
                { label: 'Your Score', val: `${company_fit.your_score}`, color: scoreColor(company_fit.your_score) },
                { label: 'Bar Required', val: `${company_fit.bar_score_required}`, color: '#94a3b8' },
                { label: 'Pass Probability', val: `${company_fit.pass_probability}%`, color: scoreColor(company_fit.pass_probability) },
              ].map(({ label, val, color }) => (
                <div key={label} className="text-center p-4 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)' }}>
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

        {/* ── SWOT Grid ───────────────────────────────────────────────────── */}
        {swot && Object.keys(swot).length > 0 && (
          <SectionCard icon={<Compass size={16}/>} title="SWOT Analysis" color="#7c3aed">
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: 'strengths',     label: 'Strengths',     color: '#4ade80', icon: '↑' },
                { key: 'weaknesses',    label: 'Weaknesses',    color: '#f87171', icon: '↓' },
                { key: 'opportunities', label: 'Opportunities', color: '#22d3ee', icon: '→' },
                { key: 'threats',       label: 'Threats',       color: '#fb923c', icon: '⚠' },
              ].map(({ key, label, color, icon }) => (
                <div key={key} className="p-4 rounded-xl"
                  style={{ background: `${color}08`, border: `1px solid ${color}25` }}>
                  <p className="text-xs font-bold mb-2" style={{ color }}>{icon} {label}</p>
                  <ul className="space-y-1">
                    {(swot[key] || []).map((item, i) => (
                      <li key={i} className="text-xs text-muted">• {item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

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
        {cv_audit?.items?.length > 0 && (
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

        {/* ── 30-Day Sprint Plan ──────────────────────────────────────────── */}
        {thirty_day_plan && Object.keys(thirty_day_plan).some(k => thirty_day_plan[k]?.length > 0) && (
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
                          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)' }}>
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
        {follow_up_questions?.length > 0 && (
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

        {/* ── Per-Question Deep Dive ───────────────────────────────────────── */}
        {(per_question_analysis?.length > 0 || question_scores?.length > 0) && (
          <div>
            <h2 className="font-bold mb-4 flex items-center gap-2">
              <ChevronRight size={16} className="text-purple-400" /> Question-by-Question Feedback
            </h2>
            <div className="space-y-3">
              {(per_question_analysis?.length ? per_question_analysis : question_scores).map((q, i) => (
                <details key={i} className="glass group">
                  <summary className="flex items-center gap-3 p-4 cursor-pointer select-none list-none">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-lg flex-shrink-0"
                      style={{ background: `${scoreColor10(q.score)}20`, color: scoreColor10(q.score) }}>
                      Q{i + 1} · {q.score}/10
                    </span>
                    <p className="text-sm flex-1 line-clamp-1">{q.question_text || q.question || ''}</p>
                    <Chip label={q.category || q.topic || 'General'} size="xs" color="#22d3ee" />
                    {q.verdict && <Chip label={q.verdict} size="xs" color={scoreColor10(q.score)} />}
                    <ChevronRight size={14} className="text-muted group-open:rotate-90 transition-transform" />
                  </summary>
                  <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="mt-3">
                      <p className="text-xs text-muted uppercase tracking-wider mb-1">Category</p>
                      <div>
                        <Chip label={q.category || q.topic || 'General'} color="#22d3ee" size="xs" />
                      </div>
                    </div>
                    {q.answer_summary && (
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
                    {/* "Review the Tape" — audio playback if URL stored */}
                    <AudioClipPlayer
                      audioUrl={q.audio_url}
                      startSec={q.audio_start_sec}
                      label={`Review Q${i + 1} Audio`}
                    />
                  </div>
                </details>
              ))}
            </div>
          </div>
        )}

        {/* ── Adaptive Study Schedule ─────────────────────────────────────── */}
        {study_schedule != null && (
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
                          style={{ background: 'rgba(255,255,255,0.05)', minWidth: 80 }}>
                          <p className="font-medium text-white">{r.session_type}</p>
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
                      style={{ background: 'rgba(255,255,255,0.03)', opacity: item.checked ? 0.5 : 1 }}>
                      <div className="w-4 h-4 rounded mt-0.5 flex-shrink-0 flex items-center justify-center"
                        style={{ background: item.checked ? '#4ade80' : 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}>
                        {item.checked && <Check size={12} style={{ color: '#0f172a' }} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white" style={{ textDecoration: item.checked ? 'line-through' : 'none' }}>{item.title}</p>
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

        {/* ── Study Recommendations (legacy) ──────────────────────────────── */}
        {study_recommendations?.length > 0 && (
          <SectionCard icon={<BookOpen size={16}/>} title="Study Recommendations" color="#f59e0b">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {study_recommendations.map((r, i) => {
                const topic = typeof r === 'string' ? r : r.topic
                const priority = r.priority
                const reason = r.reason
                return (
                  <div key={i} className="p-3 rounded-xl"
                    style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)' }}>
                    <div className="flex items-start gap-2 mb-1">
                      <span className="text-amber-400 font-bold text-sm flex-shrink-0">{i + 1}.</span>
                      <div>
                        <p className="text-sm font-medium leading-snug">{topic}</p>
                        {priority && <Chip label={priority} size="xs" color={priority === 'High' ? '#f87171' : '#facc15'} />}
                        {reason && <p className="text-xs text-muted mt-1">{reason}</p>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </SectionCard>
        )}

        {/* ── Next Interview Blueprint CTA ─────────────────────────────────── */}
        {next_interview_blueprint && (
          <div className="rounded-2xl p-6 text-center"
            style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.15), rgba(34,211,238,0.1))', border: '1px solid rgba(124,58,237,0.3)' }}>
            <Star size={24} className="text-purple-400 mx-auto mb-3" />
            <h3 className="font-bold text-lg mb-1">Your Next Interview</h3>
            <p className="text-muted text-sm mb-4">{next_interview_blueprint.reason}</p>
            <div className="flex flex-wrap justify-center gap-2 mb-4">
              <Chip label={ROUND_LABELS[next_interview_blueprint.round_type] || next_interview_blueprint.round_type} color="#7c3aed" />
              <Chip label={next_interview_blueprint.difficulty} color="#22d3ee" />
              <Chip label={`${next_interview_blueprint.timer_mins}m`} color="#a78bfa" />
              {next_interview_blueprint.focus_topics?.map((t, i) => (
                <Chip key={i} label={t} color="#4ade80" size="xs" />
              ))}
            </div>
            <button onClick={() => navigate('/')} className="btn-primary">
              <RotateCcw size={16} /> Start This Session
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
