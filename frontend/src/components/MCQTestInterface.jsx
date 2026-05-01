/**
 * MCQTestInterface — Professional MCQ assessment UI.
 *
 * Behaviour (assessment-grade, like LeetCode contest / Google SWE):
 *   1. User navigates freely between questions; can change any selection any time.
 *   2. Selections are tracked in local React state (`selections`) — single source of truth.
 *   3. NO per-question lock. The user clicks "Submit Test" once at the end, which then
 *      iterates through every question and POSTs each answer to the backend in order.
 *   4. Unanswered questions are submitted as skips, so the backend transcript is complete.
 *
 * Theme: uses var(--color-*) tokens — auto-adapts to the app's light/dark mode.
 */
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  ChevronLeft, ChevronRight, Flag, Bookmark, BookmarkCheck,
  Loader2, Send, BookOpen, Clock, AlertCircle, CheckCircle2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { submitSessionAnswer, skipQuestion } from '../lib/api'

// ── Constants ────────────────────────────────────────────────────────────────
const LABELS = ['A', 'B', 'C', 'D', 'E']

const DIFF_STYLE = {
  easy:   { bg: 'rgba(16,185,129,0.10)',  border: 'rgba(16,185,129,0.30)', text: '#059669' },
  medium: { bg: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.30)', text: '#b45309' },
  hard:   { bg: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.30)',  text: '#b91c1c' },
}

const Q_STATE = {
  current:     { bg: 'rgba(91,94,246,0.18)',  border: 'var(--color-accent)',   text: 'var(--color-accent-dark)', fw: '700' },
  answered:    { bg: 'rgba(16,185,129,0.14)', border: 'rgba(16,185,129,0.45)', text: '#059669',                  fw: '600' },
  flagged:     { bg: 'rgba(245,158,11,0.16)', border: 'rgba(245,158,11,0.45)', text: '#b45309',                  fw: '600' },
  unattempted: { bg: 'var(--color-surface-2)',border: 'var(--color-border)',   text: 'var(--color-muted)',       fw: '500' },
}

// ── Global Timer Ring ─────────────────────────────────────────────────────────
const RING_R = 20, RING_C = 2 * Math.PI * RING_R

function TimerRing({ timeLeft, totalSecs, colorState }) {
  const frac  = totalSecs > 0 ? Math.max(0, timeLeft / totalSecs) : 1
  const color = colorState === 'red' ? '#ef4444' : colorState === 'amber' ? '#f59e0b' : 'var(--color-accent)'
  const m = String(Math.floor(timeLeft / 60)).padStart(2, '0')
  const s = String(timeLeft % 60).padStart(2, '0')
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <div className="relative w-10 h-10">
        <svg className="absolute inset-0 -rotate-90" width="40" height="40" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r={RING_R} fill="none" stroke="var(--color-border)" strokeWidth="2.5" />
          <circle cx="20" cy="20" r={RING_R} fill="none"
            stroke={color} strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - frac)}
            style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.4s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <Clock size={11} style={{ color }} />
        </div>
      </div>
      <span className="font-mono font-bold text-sm tabular-nums" style={{ color }}>{m}:{s}</span>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function MCQTestInterface({
  questions = [],
  sessionId,
  sessionLabel = 'MCQ Practice',
  timeLeft = 0,
  colorState = 'green',
  totalSecs = 1800,
  onComplete,
}) {
  // ── State (selections is the SINGLE SOURCE OF TRUTH) ────────────────────────
  const [currentIdx,   setCurrentIdx]   = useState(0)
  const [selections,   setSelections]   = useState({})       // { qIdx: optionIdx }
  const [flagged,      setFlagged]      = useState(new Set())
  const [showEndModal, setShowEndModal] = useState(false)
  const [ending,       setEnding]       = useState(false)
  const [submitProgress, setSubmitProgress] = useState({ done: 0, total: 0 })

  const qStartRef    = useRef(Date.now())
  const qTimesRef    = useRef({})  // { qIdx: secondsSpent } accumulated time per Q
  const mountedAtRef = useRef(Date.now())

  const totalQ   = questions.length
  const currentQ = questions[currentIdx] || null

  // Track time per question — accumulate when leaving a question
  useEffect(() => {
    return () => {
      const elapsed = Math.floor((Date.now() - qStartRef.current) / 1000)
      qTimesRef.current[currentIdx] = (qTimesRef.current[currentIdx] || 0) + elapsed
    }
    // eslint-disable-next-line
  }, [currentIdx])

  useEffect(() => { qStartRef.current = Date.now() }, [currentIdx])

  // ── Derived ───────────────────────────────────────────────────────────────
  const answeredIdxs = useMemo(() => Object.keys(selections).map(Number), [selections])
  const answeredCnt  = answeredIdxs.length
  const pendingCnt   = totalQ - answeredCnt
  const flaggedArr   = useMemo(() => [...flagged].sort((a, b) => a - b), [flagged])
  const progress     = totalQ > 0 ? (answeredCnt / totalQ) * 100 : 0
  const diffStyle    = DIFF_STYLE[(currentQ?.difficulty || '').toLowerCase()] || DIFF_STYLE.medium
  const isFlagged    = flagged.has(currentIdx)
  const hasSelection = selections[currentIdx] !== undefined

  const getQState = (idx) =>
    idx === currentIdx       ? 'current'
    : selections[idx] !== undefined ? 'answered'
    : flagged.has(idx)        ? 'flagged'
    : 'unattempted'

  // ── Navigation ───────────────────────────────────────────────────────────
  const goPrev = useCallback(() => setCurrentIdx(i => Math.max(0, i - 1)), [])
  const goNext = useCallback(() => setCurrentIdx(i => Math.min(totalQ - 1, i + 1)), [totalQ])

  const toggleFlag = useCallback(() => {
    setFlagged(prev => {
      const n = new Set(prev)
      n.has(currentIdx) ? n.delete(currentIdx) : n.add(currentIdx)
      return n
    })
  }, [currentIdx])

  const selectOpt = useCallback((idx) => {
    setSelections(prev => ({ ...prev, [currentIdx]: idx }))
  }, [currentIdx])

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      // Ignore Enter for first 600ms — prevents stray Enter from previous screen.
      if (e.key === 'Enter' && Date.now() - mountedAtRef.current < 600) return

      const k = e.key.toUpperCase()
      if      (k === 'A' || e.key === '1') selectOpt(0)
      else if (k === 'B' || e.key === '2') selectOpt(1)
      else if (k === 'C' || e.key === '3') selectOpt(2)
      else if (k === 'D' || e.key === '4') selectOpt(3)
      else if (e.key === 'ArrowLeft')      goPrev()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') goNext()
      else if (k === 'F')                  toggleFlag()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectOpt, goPrev, goNext, toggleFlag])

  // ── Final batched submit ──────────────────────────────────────────────────
  const handleFinalSubmit = useCallback(async () => {
    if (ending) return
    setEnding(true)
    setSubmitProgress({ done: 0, total: totalQ })

    // Capture time on the question we're currently on before submitting
    const liveElapsed = Math.floor((Date.now() - qStartRef.current) / 1000)
    qTimesRef.current[currentIdx] = (qTimesRef.current[currentIdx] || 0) + liveElapsed

    const lastIdx = totalQ - 1
    let failedAny = false

    for (let i = 0; i < totalQ; i++) {
      const q   = questions[i]
      const sel = selections[i]
      const isLast = i === lastIdx
      const tSpent = qTimesRef.current[i] || 0

      try {
        if (sel !== undefined) {
          await submitSessionAnswer({
            session_id:            sessionId,
            question_id:           q.id,
            transcript:            q.options?.[sel] ?? '',
            selected_option:       q.options?.[sel] ?? '',
            selected_option_index: sel,
            time_taken_secs:       tSpent,
            current_question:      q,
            is_last_question:      isLast,
          })
        } else {
          await skipQuestion({
            session_id:       sessionId,
            question_id:      q.id,
            current_question: q,
            is_last_question: isLast,
          })
        }
      } catch (err) {
        console.error(`[MCQ] submit failed for Q${i + 1}:`, err)
        failedAny = true
      }

      setSubmitProgress({ done: i + 1, total: totalQ })
    }

    if (failedAny) toast.error('Some answers may not have saved. Generating report anyway…')
    onComplete?.('completed')
  }, [ending, totalQ, currentIdx, questions, selections, sessionId, onComplete])

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: 'var(--color-bg)', color: 'var(--color-text)', zIndex: 100 }}>

      {/* ── End Test Modal ─────────────────────────────────────────────────── */}
      {showEndModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(8px)' }}>
          <div className="w-full max-w-md rounded-2xl p-7"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' }}>

            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--color-accent-light)' }}>
                <Flag size={18} style={{ color: 'var(--color-accent)' }} />
              </div>
              <div>
                <h2 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Submit Assessment?</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Review your progress before final submission.</p>
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-2.5 mb-4">
              {[
                { label: 'Answered', val: answeredCnt,        color: '#059669', bg: 'rgba(16,185,129,0.10)', br: 'rgba(16,185,129,0.30)' },
                { label: 'Pending',  val: pendingCnt,         color: pendingCnt  > 0 ? '#b91c1c' : '#059669', bg: pendingCnt  > 0 ? 'rgba(239,68,68,0.10)' : 'rgba(16,185,129,0.10)', br: pendingCnt  > 0 ? 'rgba(239,68,68,0.30)' : 'rgba(16,185,129,0.30)' },
                { label: 'Flagged',  val: flaggedArr.length,  color: flaggedArr.length > 0 ? '#b45309' : '#059669', bg: flaggedArr.length > 0 ? 'rgba(245,158,11,0.10)' : 'rgba(16,185,129,0.10)', br: flaggedArr.length > 0 ? 'rgba(245,158,11,0.30)' : 'rgba(16,185,129,0.30)' },
              ].map(({ label, val, color, bg, br }) => (
                <div key={label} className="rounded-xl p-3 text-center" style={{ background: bg, border: `1px solid ${br}` }}>
                  <p className="text-2xl font-bold tabular-nums" style={{ color }}>{val}</p>
                  <p className="text-[10px] font-semibold mt-0.5 uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>{label}</p>
                </div>
              ))}
            </div>

            {/* Submission progress */}
            {ending && (
              <div className="mb-4 p-3 rounded-xl" style={{ background: 'var(--color-accent-light)', border: '1px solid var(--color-accent)' }}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold" style={{ color: 'var(--color-accent-dark)' }}>Submitting answers…</span>
                  <span className="text-xs font-mono" style={{ color: 'var(--color-accent-dark)' }}>{submitProgress.done}/{submitProgress.total}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(91,94,246,0.18)' }}>
                  <div className="h-full transition-all duration-200"
                    style={{ width: `${submitProgress.total ? (submitProgress.done / submitProgress.total) * 100 : 0}%`, background: 'var(--color-accent)' }} />
                </div>
              </div>
            )}

            {/* Flagged list */}
            {!ending && flaggedArr.length > 0 && (
              <div className="mb-4 p-3 rounded-xl" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
                <p className="text-xs font-semibold mb-2" style={{ color: '#b45309' }}>Marked for review:</p>
                <div className="flex flex-wrap gap-1.5">
                  {flaggedArr.map(idx => (
                    <button key={idx} onClick={() => { setShowEndModal(false); setCurrentIdx(idx) }}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all hover:opacity-75"
                      style={{ background: 'rgba(245,158,11,0.14)', color: '#b45309', border: '1px solid rgba(245,158,11,0.35)' }}>
                      Q{idx + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Pending warning */}
            {!ending && pendingCnt > 0 && (
              <div className="mb-5 flex items-start gap-2 p-3 rounded-xl" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)' }}>
                <AlertCircle size={13} className="flex-shrink-0 mt-0.5" style={{ color: '#ef4444' }} />
                <p className="text-xs leading-relaxed" style={{ color: '#b91c1c' }}>
                  <strong>{pendingCnt}</strong> unanswered question{pendingCnt > 1 ? 's' : ''} will be counted as skipped.
                </p>
              </div>
            )}

            {/* Buttons */}
            {!ending && (
              <div className="flex flex-col gap-2.5">
                {flaggedArr.length > 0 && (
                  <button onClick={() => { setShowEndModal(false); setCurrentIdx(flaggedArr[0]) }}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 hover:opacity-90"
                    style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.40)', color: '#b45309' }}>
                    <Bookmark size={14} /> Review Flagged ({flaggedArr.length})
                  </button>
                )}
                <div className="flex gap-2.5">
                  <button onClick={() => setShowEndModal(false)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
                    style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text-2)' }}>
                    Continue Test
                  </button>
                  <button onClick={handleFinalSubmit}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 text-white"
                    style={{ background: 'linear-gradient(135deg,#5b5ef6,#4338ca)', boxShadow: 'var(--shadow-accent)' }}>
                    <Send size={14} /> Submit Test
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 flex items-center gap-4 px-5 py-0 border-b"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minHeight: '60px' }}>

        {/* Brand */}
        <div className="flex items-center gap-2.5 min-w-0 flex-shrink-0">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#5b5ef6,#4338ca)', flexShrink: 0 }}>
            <BookOpen size={13} className="text-white" />
          </div>
          <div className="hidden sm:block min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-accent)' }}>MCQ Assessment</p>
            <p className="text-xs font-semibold truncate" style={{ color: 'var(--color-text)', maxWidth: '180px' }}>{sessionLabel}</p>
          </div>
        </div>

        {/* Progress — center */}
        <div className="flex-1 flex flex-col gap-1 max-w-xs mx-auto">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold" style={{ color: 'var(--color-text-2)' }}>
              {answeredCnt} <span style={{ color: 'var(--color-muted)' }}>/ {totalQ} answered</span>
            </span>
            <span className="text-xs font-semibold" style={{ color: 'var(--color-accent)' }}>Q{currentIdx + 1}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, background: 'linear-gradient(90deg,#5b5ef6,#7c3aed)' }} />
          </div>
        </div>

        {/* Global timer + Submit */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <TimerRing timeLeft={timeLeft} totalSecs={totalSecs} colorState={colorState} />
          <button onClick={() => setShowEndModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all hover:opacity-90 text-white"
            style={{ background: 'linear-gradient(135deg,#5b5ef6,#4338ca)', boxShadow: 'var(--shadow-accent)' }}>
            <Send size={11} /><span className="hidden sm:inline">Submit Test</span>
          </button>
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Sidebar */}
        <aside className="flex-shrink-0 hidden lg:flex flex-col py-5 px-3 gap-4 overflow-y-auto"
          style={{ width: '184px', borderRight: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>

          <p className="text-[9px] font-bold uppercase tracking-widest px-1" style={{ color: 'var(--color-muted)' }}>Questions</p>

          <div className="grid grid-cols-4 gap-1.5">
            {questions.map((_, idx) => {
              const s = Q_STATE[getQState(idx)]
              return (
                <button key={idx} onClick={() => setCurrentIdx(idx)}
                  className="rounded-lg text-[11px] flex items-center justify-center transition-all hover:scale-105"
                  style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.text, fontWeight: s.fw, aspectRatio: '1' }}>
                  {idx + 1}
                </button>
              )
            })}
          </div>

          <div className="flex flex-col gap-1.5 px-1 text-[11px]">
            <div className="flex justify-between"><span style={{ color: 'var(--color-muted)' }}>Answered</span><span style={{ color: '#059669', fontWeight: 600 }}>{answeredCnt}</span></div>
            <div className="flex justify-between"><span style={{ color: 'var(--color-muted)' }}>Remaining</span><span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{pendingCnt}</span></div>
            {flaggedArr.length > 0 && <div className="flex justify-between"><span style={{ color: 'var(--color-muted)' }}>Flagged</span><span style={{ color: '#b45309', fontWeight: 600 }}>{flaggedArr.length}</span></div>}
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-y-auto" style={{ background: 'var(--color-bg)' }}>

          {/* ── Top Nav Toolbar (sticky, professional) ─────────────────────── */}
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-6 py-3 border-b"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>

            <button onClick={goPrev} disabled={currentIdx === 0}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold transition-all"
              style={{
                background: currentIdx === 0 ? 'transparent' : 'var(--color-surface-2)',
                border: '1px solid var(--color-border)',
                color: currentIdx === 0 ? 'var(--color-muted-light)' : 'var(--color-text-2)',
                cursor: currentIdx === 0 ? 'not-allowed' : 'pointer',
                opacity: currentIdx === 0 ? 0.5 : 1,
              }}>
              <ChevronLeft size={15} /><span className="hidden sm:inline">Previous</span>
            </button>

            {/* Center: Q indicator + flag toggle */}
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-bold tabular-nums px-3 py-1.5 rounded-lg"
                style={{ background: 'var(--color-accent-light)', color: 'var(--color-accent-dark)', border: '1px solid rgba(91,94,246,0.30)' }}>
                Question {currentIdx + 1} <span style={{ opacity: 0.6 }}>/ {totalQ}</span>
              </span>
              <button onClick={toggleFlag}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={
                  isFlagged
                    ? { background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.45)', color: '#b45309' }
                    : { background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text-2)' }
                }>
                {isFlagged ? <BookmarkCheck size={12} /> : <Bookmark size={12} />}
                <span className="hidden md:inline">{isFlagged ? 'Marked for Review' : 'Mark for Review'}</span>
              </button>
            </div>

            <button onClick={goNext} disabled={currentIdx >= totalQ - 1}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold transition-all"
              style={{
                background: currentIdx >= totalQ - 1 ? 'transparent' : 'var(--color-surface-2)',
                border: '1px solid var(--color-border)',
                color: currentIdx >= totalQ - 1 ? 'var(--color-muted-light)' : 'var(--color-text-2)',
                cursor: currentIdx >= totalQ - 1 ? 'not-allowed' : 'pointer',
                opacity: currentIdx >= totalQ - 1 ? 0.5 : 1,
              }}>
              <span className="hidden sm:inline">Next</span><ChevronRight size={15} />
            </button>
          </div>

          {/* Mobile Q strip */}
          <div className="flex items-center gap-1 mt-3 px-4 overflow-x-auto pb-1 lg:hidden">
            {questions.map((_, idx) => {
              const s = Q_STATE[getQState(idx)]
              return (
                <button key={idx} onClick={() => setCurrentIdx(idx)}
                  className="rounded-md text-[10px] flex-shrink-0 flex items-center justify-center"
                  style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.text, fontWeight: s.fw, width: '28px', height: '28px' }}>
                  {idx + 1}
                </button>
              )
            })}
          </div>

          {/* ── Centered Content ────────────────────────────────────────────── */}
          {currentQ && (
            <div className="mx-auto" style={{ maxWidth: '760px', padding: '40px 32px 80px' }}>

              {/* Meta row — centered */}
              <div className="flex items-center justify-center gap-2 flex-wrap mb-6">
                {currentQ.topic && (
                  <span className="text-[11px] px-2.5 py-1 rounded-lg"
                    style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-2)', border: '1px solid var(--color-border)' }}>
                    {currentQ.topic}
                  </span>
                )}
                {currentQ.difficulty && (
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg"
                    style={{ background: diffStyle.bg, color: diffStyle.text, border: `1px solid ${diffStyle.border}` }}>
                    {currentQ.difficulty.charAt(0).toUpperCase() + currentQ.difficulty.slice(1)}
                  </span>
                )}
                {hasSelection && (
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1"
                    style={{ background: 'rgba(16,185,129,0.10)', color: '#059669', border: '1px solid rgba(16,185,129,0.30)' }}>
                    <CheckCircle2 size={10} /> Answered
                  </span>
                )}
              </div>

              {/* Question card — centered, generous spacing */}
              <div className="rounded-2xl p-7 mb-7"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
                <p style={{ fontSize: '17px', lineHeight: '1.75', color: 'var(--color-text)', fontWeight: 500, textAlign: 'center' }}>
                  {currentQ.question_text || currentQ.text || ''}
                </p>
              </div>

              {/* Options — centered list */}
              <div className="flex flex-col gap-3">
                {(currentQ.options || []).map((opt, idx) => {
                  const isSel = selections[currentIdx] === idx
                  const bg     = isSel ? 'var(--color-accent-light)' : 'var(--color-surface)'
                  const border = isSel ? 'var(--color-accent)'       : 'var(--color-border)'
                  const txt    = isSel ? 'var(--color-accent-dark)'  : 'var(--color-text)'
                  const lblBg  = isSel ? 'rgba(91,94,246,0.18)'      : 'var(--color-surface-2)'
                  const lblClr = isSel ? 'var(--color-accent-dark)'  : 'var(--color-text-2)'

                  return (
                    <button key={`${idx}-${opt}`} onClick={() => selectOpt(idx)}
                      className="w-full rounded-xl p-4 text-left transition-all duration-150 hover:opacity-95"
                      style={{
                        background: bg,
                        border: `1.5px solid ${border}`,
                        boxShadow: isSel ? 'var(--shadow-focus)' : 'none',
                        cursor: 'pointer',
                      }}>
                      <div className="flex items-center gap-3.5">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ background: lblBg }}>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: lblClr }}>{LABELS[idx]}</span>
                        </div>
                        <span style={{ fontSize: '14.5px', lineHeight: '1.55', color: txt, flex: 1 }}>{opt}</span>
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Keyboard hint */}
              <p className="mt-7 hidden lg:block text-center" style={{ fontSize: '10px', color: 'var(--color-muted-light)' }}>
                {[['A–D','select'],['← →','navigate'],['Enter','next'],['F','flag']].map(([k,l]) => (
                  <span key={k}>
                    <kbd style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', borderRadius:3, padding:'1px 5px', fontFamily:'monospace', fontSize:9, color:'var(--color-text-2)' }}>{k}</kbd>
                    {' '}{l}{' '}·{' '}
                  </span>
                ))}
              </p>

              {/* Final-question CTA */}
              {currentIdx === totalQ - 1 && (
                <div className="mt-8 flex justify-center">
                  <button onClick={() => setShowEndModal(true)}
                    className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg,#5b5ef6,#4338ca)', boxShadow: 'var(--shadow-accent)' }}>
                    <Send size={14} /> Review &amp; Submit Test
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
