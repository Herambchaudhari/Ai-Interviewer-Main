/**
 * CodingPage — Hackerrank/LeetCode-style DSA assessment.
 *
 * Layout (3-pane, theme-aware via var(--color-*) tokens):
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Header: title • language • timer • Run • Submit • Next        │
 *   ├──────────────────┬───────────────────────────────────────────┤
 *   │ Problem panel    │ Editor (Monaco)                            │
 *   │ (left, 40%)      ├───────────────────────────────────────────┤
 *   │                  │ Console: [Sample Tests] [Result] [AI Eval] │
 *   └──────────────────┴───────────────────────────────────────────┘
 *
 * Proctoring/camera disabled — DSA assessments don't run face tracking.
 *
 * Two entry modes:
 *  - /coding/practice/:slug          → single-problem practice
 *  - /coding/:sessionId              → multi-problem assessment session
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Editor from '@monaco-editor/react'
import toast from 'react-hot-toast'
import {
  Code2, Play, Send, ChevronRight, Timer, Loader2,
  Brain, ChevronLeft, AlertCircle,
} from 'lucide-react'

import LoadingSpinner       from '../components/LoadingSpinner'
import DSAProblemPanel      from '../components/DSAProblemPanel'
import DSATestResults       from '../components/DSATestResults'
import DSAEvaluationCard    from '../components/DSAEvaluationCard'
import {
  getDsaProblem, runDsaCode, submitDsaCode, listDsaProblems, endSession,
} from '../lib/api'
import { getReportRoute } from '../lib/routes'

// Stable client-side fallback id when sessionStorage is empty. Mirrors the
// backend's UUID5(_DSA_NAMESPACE, `${session_id}:${slug}`) — both ends derive
// the same id so the persist replaces cleanly on resubmit.
function uuidFromString(s) {
  // Lightweight FNV-1a → UUIDv4-shaped hex. Good enough for stable client ids.
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  const hex = h.toString(16).padStart(8, '0')
  return `${hex}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-${hex.slice(0, 4)}-${hex.repeat(2).slice(0, 12)}`
}

const LANGUAGES = [
  { id: 'python',     label: 'Python 3'   },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'cpp',        label: 'C++'        },
  { id: 'java',       label: 'Java'       },
]

const DEFAULT_STARTERS = {
  python:     'class Solution:\n    def solve(self):\n        pass\n',
  javascript: 'var solve = function() {\n};\n',
  cpp:        'class Solution {\npublic:\n};\n',
  java:       'class Solution {\n}\n',
}

export default function CodingPage() {
  const { sessionId, slug: routeSlug } = useParams()
  const navigate = useNavigate()
  const isPractice = !!routeSlug

  // ── Session/problem list state ───────────────────────────────────────────
  const [session,   setSession]   = useState(null)   // assessment-mode only
  const [problems,  setProblems]  = useState([])     // [{slug, title, difficulty, …}]
  const [pIndex,    setPIndex]    = useState(0)
  const [problem,   setProblem]   = useState(null)   // full current problem
  const [loading,   setLoading]   = useState(true)

  // ── Editor state ─────────────────────────────────────────────────────────
  const [language,  setLanguage]  = useState('python')
  const [code,      setCode]      = useState(DEFAULT_STARTERS.python)
  const codeBySlugLang = useRef({})  // { [`${slug}:${lang}`]: code } — preserves work across nav

  // ── Run/submit state ─────────────────────────────────────────────────────
  const [runState, setRunState] = useState('idle')   // idle|running|done|error
  const [runMode,  setRunMode]  = useState('run')    // 'run' | 'submit'
  const [results,  setResults]  = useState(null)
  const [evaluation, setEvaluation] = useState(null)
  const [activeTab,  setActiveTab]  = useState('console')   // console | result | eval

  // ── Timer (assessment-mode only) ─────────────────────────────────────────
  const [timeLeft, setTimeLeft] = useState(null)
  const timerRef = useRef(null)

  // ── Load problem(s) on mount ─────────────────────────────────────────────
  useEffect(() => {
    let alive = true
    async function init() {
      try {
        if (isPractice) {
          const r = await getDsaProblem(routeSlug)
          if (!r?.success) throw new Error(r?.error || 'Failed to load problem')
          if (!alive) return
          setProblems([{ slug: r.data.slug, title: r.data.title, difficulty: r.data.difficulty }])
          setProblem(r.data)
          applyStarter(r.data, language)
        } else {
          // Assessment mode — try sessionStorage first
          const raw = sessionStorage.getItem(`session_${sessionId}`)
          let s = raw ? JSON.parse(raw) : null
          if (s?.timer_mins) setTimeLeft(s.timer_mins * 60)

          // Use session.questions if they're DSA bank refs, else fall back to easy bank.
          let slugs = (s?.questions || [])
            .map(q => q?.problem_slug || q?.slug)
            .filter(Boolean)

          let usedFallback = false
          if (slugs.length === 0) {
            // Fallback: pull a small set from the bank so the page works without session config.
            const lst = await listDsaProblems({ difficulty: 'easy', limit: 3 })
            slugs = (lst?.data?.problems || []).map(p => p.slug)
            usedFallback = true
          }
          if (slugs.length === 0) throw new Error('No problems available.')

          // Fetch metadata for the navigator strip + first problem in full
          const metas = await Promise.all(slugs.map(sl => getDsaProblem(sl)))
          if (!alive) return
          const ok = metas.filter(m => m?.success).map(m => m.data)
          setProblems(ok)
          setProblem(ok[0])
          applyStarter(ok[0], language)

          // ── Critical: ensure session.questions[i].id always exists. ──
          // The submit handler reads session.questions[pIndex].id to send a
          // questionId to the backend. If we silently lose that, the backend
          // can't persist the submission and the report shows "0 solved".
          // Build a synthetic questions array if the fallback path was taken
          // OR if existing entries are missing IDs.
          let synthQuestions = s?.questions || []
          if (usedFallback || synthQuestions.length === 0
              || synthQuestions.some(q => !q?.id)) {
            synthQuestions = ok.map(p => ({
              id:           uuidFromString(`${sessionId}:${p.slug}`),
              problem_slug: p.slug,
              title:        p.title,
              difficulty:   p.difficulty,
              type:         'dsa',
            }))
          }
          const merged = { ...(s || {}), session_id: sessionId, questions: synthQuestions }
          setSession(merged)
          try {
            sessionStorage.setItem(`session_${sessionId}`, JSON.stringify(merged))
          } catch (_) {}
        }
      } catch (e) {
        toast.error(e.message || 'Failed to load problem')
        if (!isPractice) navigate('/dashboard')
      } finally {
        if (alive) setLoading(false)
      }
    }
    init()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, routeSlug, isPractice])

  // ── Timer (assessment mode) ──────────────────────────────────────────────
  useEffect(() => {
    if (timeLeft == null) return
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current); finishAssessment(); return 0 }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft != null])

  // ── Helpers ──────────────────────────────────────────────────────────────
  const applyStarter = (prob, lang) => {
    if (!prob) return
    const cacheKey = `${prob.slug}:${lang}`
    const cached = codeBySlugLang.current[cacheKey]
    if (cached !== undefined) {
      setCode(cached)
      return
    }
    const starter =
      prob.starter_code?.[lang] ||
      DEFAULT_STARTERS[lang] || ''
    setCode(starter)
  }

  const handleLanguageChange = (newLang) => {
    if (problem) codeBySlugLang.current[`${problem.slug}:${language}`] = code
    setLanguage(newLang)
    applyStarter(problem, newLang)
    setRunState('idle'); setResults(null); setEvaluation(null)
  }

  const navigateProblem = async (toIdx) => {
    if (toIdx < 0 || toIdx >= problems.length || toIdx === pIndex) return
    if (problem) codeBySlugLang.current[`${problem.slug}:${language}`] = code
    setLoading(true)
    try {
      const r = await getDsaProblem(problems[toIdx].slug)
      if (!r?.success) throw new Error(r?.error || 'Failed')
      setProblem(r.data)
      setPIndex(toIdx)
      applyStarter(r.data, language)
      setRunState('idle'); setResults(null); setEvaluation(null)
      setActiveTab('console')
    } catch (e) {
      toast.error('Failed to load next problem')
    } finally {
      setLoading(false)
    }
  }

  const handleRun = useCallback(async () => {
    if (!problem) return
    if (!code.trim()) { toast.error('Write some code first'); return }
    setRunState('running'); setRunMode('run'); setActiveTab('console')
    try {
      const r = await runDsaCode({ slug: problem.slug, language, code })
      if (!r?.success) throw new Error(r?.error || 'Run failed')
      setResults(r.data.results)
      setRunState('done')
    } catch (e) {
      toast.error(e.message || 'Run failed')
      setRunState('error')
    }
  }, [problem, language, code])

  const handleSubmit = useCallback(async () => {
    if (!problem) return
    if (!code.trim()) { toast.error('Write some code first'); return }
    setRunState('running'); setRunMode('submit'); setActiveTab('console')
    try {
      // questionId resolution: prefer the id stored on session.questions, then
      // fall back to a deterministic id derived from (sessionId, slug). The
      // backend mirrors this fallback, so resubmits replace cleanly.
      const resolvedQid = isPractice
        ? null
        : (session?.questions?.[pIndex]?.id
           || (sessionId ? uuidFromString(`${sessionId}:${problem.slug}`) : null))

      const r = await submitDsaCode({
        slug: problem.slug, language, code,
        sessionId: isPractice ? null : sessionId,
        questionId: resolvedQid,
      })
      if (!r?.success) throw new Error(r?.error || 'Submit failed')
      setResults(r.data.results)
      setEvaluation(r.data.evaluation)
      setRunState('done')
      setActiveTab('eval')

      // If the backend echoed a different question_id (e.g. it found a
      // matching entry by slug), patch session.questions so subsequent
      // submits agree with the persisted row.
      const echoedQid = r.data.question_id
      if (echoedQid && session && Array.isArray(session.questions)) {
        const next = session.questions.map((q, i) =>
          i === pIndex ? { ...q, id: echoedQid } : q
        )
        const merged = { ...session, questions: next }
        setSession(merged)
        try { sessionStorage.setItem(`session_${sessionId}`, JSON.stringify(merged)) } catch (_) {}
      }

      toast.success(`Scored ${r.data.evaluation.correctness_score}/10`)
      if (r.data.persisted === false && !isPractice) {
        toast.error(
          'Saved evaluation but failed to record it for the report. ' +
          (r.data.persist_error ? `(${r.data.persist_error})` : ''),
          { duration: 6000 }
        )
      }
    } catch (e) {
      toast.error(e.message || 'Submit failed')
      setRunState('error')
    }
  }, [problem, language, code, isPractice, sessionId, session, pIndex])

  const finishAssessment = useCallback(async () => {
    clearInterval(timerRef.current)
    if (!sessionId) {
      navigate('/dashboard')
      return
    }
    // Mark the session terminated so the report router can flip status,
    // and so the dashboard stops showing it as in_progress. Best-effort —
    // the report endpoint will still generate even if this call fails.
    try {
      await endSession({ session_id: sessionId, reason: 'completed' })
    } catch (e) {
      console.warn('[CodingPage] endSession failed:', e?.message || e)
    }
    navigate(getReportRoute(sessionId))
  }, [sessionId, navigate])

  const fmtTime = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  if (loading || !problem) return <LoadingSpinner fullScreen />

  const isLast = pIndex === problems.length - 1

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: 'var(--color-bg)', color: 'var(--color-text)',
    }}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 20px',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg, #7c3aed, #22d3ee)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Brain size={16} color="white" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>AI Interviewer</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted, #64748b)' }}>DSA / Coding Round</div>
          </div>
        </div>

        {/* Problem navigator chips */}
        {problems.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {problems.map((p, i) => (
              <button key={p.slug} onClick={() => navigateProblem(i)}
                style={{
                  width: 30, height: 30, borderRadius: 6,
                  border: '1px solid var(--color-border)',
                  background: i === pIndex ? '#7c3aed' : 'transparent',
                  color: i === pIndex ? 'white' : 'var(--color-text-muted, #64748b)',
                  fontWeight: 700, fontSize: 12, cursor: 'pointer',
                }}>
                {i + 1}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {timeLeft != null && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 8,
              background: timeLeft < 120 ? 'rgba(239,68,68,0.12)' : 'var(--color-surface-2, rgba(124,58,237,0.06))',
              color: timeLeft < 120 ? '#dc2626' : 'var(--color-text)',
              fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 14,
              border: '1px solid var(--color-border)',
            }}>
              <Timer size={14} />{fmtTime(timeLeft)}
            </div>
          )}

          {/* Language picker */}
          <select value={language} onChange={e => handleLanguageChange(e.target.value)}
            style={{
              padding: '6px 10px', borderRadius: 8,
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)', color: 'var(--color-text)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>
            {LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>

          {/* Run */}
          <button onClick={handleRun} disabled={runState === 'running'}
            style={btnSecondary(runState === 'running')}>
            {runState === 'running' && runMode === 'run'
              ? <Loader2 size={14} className="animate-spin" />
              : <Play size={14} />}
            <span>Run</span>
          </button>

          {/* Submit */}
          <button onClick={handleSubmit} disabled={runState === 'running'}
            style={btnPrimary(runState === 'running')}>
            {runState === 'running' && runMode === 'submit'
              ? <Loader2 size={14} className="animate-spin" />
              : <Send size={14} />}
            <span>Submit</span>
          </button>

          {/* Next problem (assessment mode) */}
          {!isPractice && (
            <button onClick={() => isLast ? finishAssessment() : navigateProblem(pIndex + 1)}
              style={btnGhost()}>
              {isLast ? 'Finish' : <>Next <ChevronRight size={14} /></>}
            </button>
          )}
        </div>
      </header>

      {/* ── Body: 3-pane ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: problem */}
        <div style={{ width: '40%', minWidth: 360, borderRight: '1px solid var(--color-border)' }}>
          <DSAProblemPanel problem={problem} problemIndex={pIndex} totalProblems={problems.length} />
        </div>

        {/* Right: editor + console */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Editor */}
          <div style={{ flex: '1 1 60%', minHeight: 0, borderBottom: '1px solid var(--color-border)' }}>
            <Editor
              height="100%"
              language={language === 'cpp' ? 'cpp' : language}
              value={code}
              onChange={val => setCode(val || '')}
              theme="vs-dark"
              options={{
                fontSize: 14,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                minimap: { enabled: false },
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                padding: { top: 14, bottom: 14 },
                bracketPairColorization: { enabled: true },
                automaticLayout: true,
              }}
            />
          </div>

          {/* Console (tabs) */}
          <div style={{ flex: '1 1 40%', minHeight: 220, display: 'flex', flexDirection: 'column' }}>
            <div style={{
              display: 'flex', borderBottom: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
            }}>
              <ConsoleTab active={activeTab === 'console'} onClick={() => setActiveTab('console')}
                label={runMode === 'submit' ? 'Test Results' : 'Sample Tests'} />
              {evaluation && (
                <ConsoleTab active={activeTab === 'eval'} onClick={() => setActiveTab('eval')}
                  label="AI Evaluation" badge="new" />
              )}
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              {activeTab === 'console' && (
                <DSATestResults
                  runState={runState}
                  results={results}
                  mode={runMode}
                  summary={evaluation
                    ? { tests_passed: evaluation.tests_passed, tests_total: evaluation.tests_total }
                    : null}
                />
              )}
              {activeTab === 'eval' && (
                <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
                  <DSAEvaluationCard evaluation={evaluation} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Button styles (theme-aware via CSS variables) ──────────────────────────
function btnPrimary(disabled) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '7px 14px', borderRadius: 8,
    background: disabled ? 'rgba(124,58,237,0.5)' : 'linear-gradient(135deg,#7c3aed,#6366f1)',
    color: 'white', border: 'none', fontWeight: 700, fontSize: 13,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all 0.15s ease',
  }
}
function btnSecondary(disabled) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '7px 14px', borderRadius: 8,
    background: 'var(--color-surface)',
    color: 'var(--color-text)',
    border: '1px solid var(--color-border)',
    fontWeight: 600, fontSize: 13,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}
function btnGhost() {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '7px 14px', borderRadius: 8,
    background: 'transparent', color: 'var(--color-text-muted, #64748b)',
    border: '1px solid var(--color-border)',
    fontWeight: 600, fontSize: 13, cursor: 'pointer',
  }
}

function ConsoleTab({ active, onClick, label, badge }) {
  return (
    <button onClick={onClick} style={{
      padding: '10px 18px', border: 'none', cursor: 'pointer',
      background: active ? 'var(--color-bg)' : 'transparent',
      color: active ? 'var(--color-text)' : 'var(--color-text-muted, #64748b)',
      fontWeight: 600, fontSize: 12,
      borderBottom: active ? '2px solid #7c3aed' : '2px solid transparent',
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      <Code2 size={13} />{label}
      {badge && (
        <span style={{
          padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700,
          background: '#7c3aed', color: 'white', textTransform: 'uppercase',
        }}>{badge}</span>
      )}
    </button>
  )
}
