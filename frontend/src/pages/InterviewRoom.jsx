/**
 * InterviewRoom — Phase 07/08 full interview room with STT, code editor, and DSA support.
 * Route: /interview/:sessionId  AND  /coding/:sessionId
 *
 * Voice flow: Start Rec → Stop Rec → /session/transcribe → TranscriptDisplay →
 *             /session/answer (Groq eval) → next Q or report
 * Code flow:  Write in CodeEditor → Submit → /session/answer → next Q or report
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'

import WebcamFeed         from '../components/WebcamFeed'
import QuestionPanel      from '../components/QuestionPanel'
import TranscriptDisplay  from '../components/TranscriptDisplay'
import LoadingSpinner     from '../components/LoadingSpinner'
import CodeEditor         from '../components/CodeEditor'
import DSAQuestionPanel   from '../components/DSAQuestionPanel'
import { useAudioRecorder }         from '../hooks/useAudioRecorder'
import { useTimer }                  from '../hooks/useTimer'
import { submitAnswerStreaming }      from '../hooks/useSSE'
import tts                           from '../services/tts'
import {
  transcribeSession, submitSessionAnswer,
  skipQuestion as apiSkip, endSession as apiEnd, generateReport
} from '../lib/api'
import { getReportRoute } from '../lib/routes'

import {
  Mic, MicOff, Send, SkipForward,
  ChevronRight, Loader2, AlertCircle, Flag, Star
} from 'lucide-react'

// ── SVG Timer Ring ──────────────────────────────────────────────────────────
const RING_R = 44
const RING_C = 2 * Math.PI * RING_R

function TimerDisplay({ timeLeft, formattedTime, colorState, totalSeconds }) {
  const fraction = totalSeconds > 0 ? Math.max(0, timeLeft / totalSeconds) : 1
  const stroke = colorState === 'red' ? '#ef4444' : colorState === 'amber' ? '#f59e0b' : '#7c3aed'

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-28 h-28">
        <svg className="absolute inset-0 -rotate-90" width="112" height="112" viewBox="0 0 112 112">
          <circle cx="56" cy="56" r={RING_R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
          <circle cx="56" cy="56" r={RING_R} fill="none"
            stroke={stroke} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - fraction)}
            style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.5s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono font-bold text-xl leading-none transition-colors duration-500"
            style={{ color: stroke }}>
            {formattedTime}
          </span>
        </div>
      </div>
      <p className="text-muted text-xs mt-1">Time remaining</p>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function InterviewRoom() {
  const { sessionId } = useParams()
  const navigate      = useNavigate()

  // ── Session data ──────────────────────────────────────────────────────────
  const [session,   setSession]   = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(null)

  // ── Interview progress state ───────────────────────────────────────────────
  const [currentQ,   setCurrentQ]   = useState(null)
  const [qIndex,     setQIndex]     = useState(0)
  const [total,      setTotal]      = useState(0)
  const [roundType,  setRoundType]  = useState('technical')
  const [difficulty, setDifficulty] = useState('medium')
  const [scores,     setScores]     = useState([])

  // status: idle | speaking | listening | processing | evaluating | done
  const [status, setStatus] = useState('idle')

  // ── Transcript state ──────────────────────────────────────────────────────
  const [transcript,    setTranscript]    = useState('')
  const [isTranscribing,setIsTranscribing]= useState(false)
  const [code,          setCode]          = useState('# Write your solution here\n')
  const [codeLang,      setCodeLang]      = useState('python')

  // ── Streaming feedback (Phase 3) ──────────────────────────────────────────
  const [streamingFeedback, setStreamingFeedback] = useState('')
  const [showFeedback,      setShowFeedback]      = useState(false)

  // ── Audio/delivery metadata for scoring (Phase 4) ────────────────────────
  const [scoringMeta,    setScoringMeta]    = useState(null)
  const [recordStartMs,  setRecordStartMs]  = useState(0)

  // ── Time tracking for DSA hints ──────────────────────────────────────────
  const [qStartTime,  setQStartTime] = useState(Date.now())
  const [timeElapsed, setTimeElapsed] = useState(0)

  // ── Hooks ─────────────────────────────────────────────────────────────────
  const { isRecording, startRecording, stopRecording, resetRecording } = useAudioRecorder(120)

  const totalSecs  = session ? (session.timer_minutes || 30) * 60 : 1800
  const storageKey = sessionId ? `timer_${sessionId}` : null

  const handleWarning = useCallback(() => {
    toast('⚠️ 5 minutes remaining!', { icon: '⏳', duration: 4000 })
    tts.speak('Warning: only 5 minutes remaining.')
  }, [])

  const { formattedTime, timeLeft, colorState, isRunning, start: startTimer, pause: pauseTimer } =
    useTimer(totalSecs, { onTick: handleWarning, onExpire: () => { toast.error('Time is up!'); endInterview('timeout') }, storageKey })

  // ── Computed ──────────────────────────────────────────────────────────────
  const isDSA       = roundType === 'dsa'
  const answerReady = isDSA ? code.trim().length > 10 : transcript.length > 3

  // ── Elapsed timer for hint unlock ─────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeElapsed(Math.floor((Date.now() - qStartTime) / 1000))
    }, 5000)
    return () => clearInterval(interval)
  }, [qStartTime])

  // ── Load session from sessionStorage ──────────────────────────────────────
  useEffect(() => {
    const raw = sessionStorage.getItem(`session_${sessionId}`)
    if (raw) {
      try {
        const s = JSON.parse(raw)
        setSession(s)
        setTotal(s.questions?.length || 0)
        setRoundType(s.round_type || 'technical')
        setDifficulty(s.difficulty || 'medium')
        const first = s.questions?.[0] || null
        setCurrentQ(first)
        setQIndex(0)
        setLoading(false)
        return
      } catch { /* fall through */ }
    }
    setLoadError('Session not found. Please go back to the dashboard and start a new interview.')
    setLoading(false)
  }, [sessionId])

  // ── Speak question on change (voice rounds only) ───────────────────────────
  useEffect(() => {
    if (!currentQ) return
    setTranscript('')
    setCode('# Write your solution here\n')
    resetRecording()
    setQStartTime(Date.now())
    setTimeElapsed(0)

    if (!isDSA) {
      setStatus('speaking')
      const text = currentQ.question_text || currentQ.text || ''
      tts.speak(text, () => setStatus('idle'))
    } else {
      setStatus('idle')
    }
    if (qIndex === 0 && !isRunning) startTimer()
  }, [currentQ?.id]) // eslint-disable-line

  // ── Recording toggle ──────────────────────────────────────────────────────
  const handleRecordToggle = async () => {
    if (isRecording) {
      const recStopMs = Date.now()
      setStatus('processing')
      setIsTranscribing(true)
      tts.stop()
      const blob = await stopRecording()
      if (!blob) { setStatus('idle'); setIsTranscribing(false); return }

      const responseLatencyStart = Date.now()
      try {
        const res = await transcribeSession(blob, sessionId, currentQ?.id || '')
        const text = res.data?.transcript || res.transcript || ''
        const meta = res.data?.meta || {}
        setTranscript(text)
        // Store delivery metadata for scoring context (Phase 4)
        setScoringMeta({
          ...meta,
          time_limit_secs:  currentQ?.time_limit_secs || 180,
          time_used_ratio:  meta.duration_secs ? meta.duration_secs / (currentQ?.time_limit_secs || 180) : 0.5,
          response_latency_ms: Date.now() - responseLatencyStart,
          question_difficulty: difficulty,
          round_type:          roundType,
          is_follow_up:        currentQ?.is_follow_up || false,
          candidate_year:      JSON.parse(sessionStorage.getItem('student_meta') || '{}')?.year || null,
        })
        setStatus('idle')
      } catch {
        toast.error('Transcription failed — please try again.')
        setTranscript('')
        setStatus('idle')
      } finally {
        setIsTranscribing(false)
      }
    } else {
      tts.stop()
      setStatus('listening')
      setTranscript('')
      setScoringMeta(null)
      setRecordStartMs(Date.now()) // used for latency calc in scoring_meta
      await startRecording()
    }
  }

  // ── End interview (Hoisted above handleSubmit) ────────────────────────────
  const endInterview = useCallback(async (reason = 'completed') => {
    setStatus('done')
    tts.stop()
    pauseTimer()
    if (storageKey) localStorage.removeItem(storageKey)
    try {
      await apiEnd({ session_id: sessionId, reason })
    } catch {
      // Non-fatal — try Report page generation directly
      try { await generateReport(sessionId) } catch { /* fallback: report page handles it */ }
    }
    toast.success('Interview complete! Generating your report…', { duration: 3000 })
    setTimeout(() => navigate(getReportRoute(sessionId)), 1500)
  }, [sessionId, navigate, pauseTimer, storageKey])

  // ── Submit answer ─────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (skip = false, overrideCode = null) => {
    if (isRecording) await stopRecording()
    tts.stop()
    pauseTimer()
    setStatus('evaluating')

    const isLast = qIndex + 1 >= total

    if (skip) {
      try {
        const payload = await apiSkip({
          session_id:       sessionId,
          question_id:      currentQ?.id || '',
          current_question: currentQ,
          is_last_question: isLast,
        })
        const inner = payload?.data ?? payload

        if (inner?.session_complete) {
          endInterview()
          return
        }
        const next = inner?.next_question || session?.questions?.[qIndex + 1]
        if (next) {
          setCurrentQ({
            ...next,
            question_text: next.question_text || next.text || '',
            text:          next.text || next.question_text || '',
          })
          setQIndex(i => i + 1)
          startTimer()
        }
        setStatus('idle')
        toast('Question skipped', { icon: '⏭️' })
      } catch {
        toast.error('Skip failed — please try again.')
        startTimer()
        setStatus('idle')
      }
      return
    }

    const answerText = isDSA ? (overrideCode ?? code) : (transcript || '[No answer]')

    const submitPayload = {
      session_id:       sessionId,
      question_id:      currentQ?.id || '',
      transcript:       answerText,
      time_taken_secs:  Math.floor((Date.now() - qStartTime) / 1000),
      current_question: currentQ,
      is_last_question: isLast,
      scoring_context:  (!isDSA && scoringMeta) ? scoringMeta : null,
    }

    // DSA (code) rounds use blocking call; voice rounds stream
    if (isDSA) {
      try {
        const payload = await submitSessionAnswer(submitPayload)
        const inner   = payload?.data ?? payload
        const eval_   = inner?.evaluation || {}
        setScores(prev => [...prev, { ...eval_, score: eval_.score, question: currentQ?.question_text || `Q${qIndex + 1}` }])
        if (inner?.session_complete) { endInterview(); return }
        const next = inner?.next_question
        if (next) {
          setCurrentQ({ ...next, question_text: next.question_text || next.text || '', text: next.text || next.question_text || '' })
          setQIndex(i => i + 1)
          setCode('# Write your solution here\n')
          startTimer()
          setStatus('idle')
        } else {
          endInterview()
        }
      } catch (err) {
        toast.error(err.response?.data?.error || 'Submission failed — try again.')
        setStatus('idle')
        startTimer()
      }
      return
    }

    // Voice rounds — stream feedback token by token
    setStreamingFeedback('')
    setShowFeedback(true)

    await submitAnswerStreaming(submitPayload, {
      onStart: () => setStatus('evaluating'),
      onFeedbackChunk: (chunk) => setStreamingFeedback(prev => prev + chunk),
      onEvalComplete: (eval_) => {
        setScores(prev => [...prev, { ...eval_, score: eval_.score, question: currentQ?.question_text || `Q${qIndex + 1}` }])
      },
      onNextQuestion: (next) => {
        // Small delay so user can read the streamed feedback
        setTimeout(() => {
          setShowFeedback(false)
          setStreamingFeedback('')
          setCurrentQ({ ...next, question_text: next.question_text || next.text || '', text: next.text || next.question_text || '' })
          setQIndex(i => i + 1)
          setCode('# Write your solution here\n')
          startTimer()
          setStatus('idle')
        }, 2500)
      },
      onSessionComplete: () => {
        setTimeout(() => endInterview(), 2500)
      },
      onError: (err) => {
        console.error('[InterviewRoom] SSE error, falling back to blocking:', err)
        setShowFeedback(false)
        // Fallback to blocking submit
        submitSessionAnswer(submitPayload)
          .then(payload => {
            const inner = payload?.data ?? payload
            if (inner?.session_complete) { endInterview(); return }
            const next = inner?.next_question
            if (next) {
              setCurrentQ({ ...next, question_text: next.question_text || next.text || '', text: next.text || next.question_text || '' })
              setQIndex(i => i + 1)
              startTimer()
              setStatus('idle')
            } else {
              endInterview()
            }
          })
          .catch(() => { toast.error('Submission failed — try again.'); setStatus('idle'); startTimer() })
      },
    })
  }, [isRecording, isDSA, code, transcript, sessionId, currentQ, qIndex, total, session, stopRecording, pauseTimer, startTimer, endInterview]) // eslint-disable-line

  // ── Code submit handler (from CodeEditor component) ─────────────────────
  const handleCodeSubmit = useCallback((submittedCode, lang) => {
    setCode(submittedCode)
    setCodeLang(lang)
    // Pass the code directly to avoid React state closure timing issues
    handleSubmit(false, submittedCode)
  }, [handleSubmit])

  // ── Render guards ─────────────────────────────────────────────────────────
  if (loading)    return <LoadingSpinner fullScreen message="Loading interview session…" />
  if (loadError)  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="glass p-8 max-w-md text-center">
        <AlertCircle size={40} className="text-red-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold mb-2">Session Error</h2>
        <p className="text-muted mb-6 text-sm">{loadError}</p>
        <button onClick={() => navigate('/dashboard')} className="btn-primary">Back to Dashboard</button>
      </div>
    </div>
  )
  if (status === 'done') return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <Loader2 size={40} className="animate-spin text-purple-400 mx-auto mb-4" />
        <p className="text-lg font-semibold gradient-text">Generating your report…</p>
        <p className="text-muted text-sm mt-2">This may take a few seconds</p>
      </div>
    </div>
  )

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen pt-16 flex flex-col" style={{ background: 'var(--color-bg)' }}>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">Question</span>
          <span className="font-bold tabular-nums">{qIndex + 1} / {total}</span>
          <div className="w-32 h-1.5 rounded-full overflow-hidden hidden sm:block"
            style={{ background: 'var(--color-border)' }}>
            <div className="h-full rounded-full bg-purple-500 transition-all duration-700"
              style={{ width: `${((qIndex + 1) / (total || 1)) * 100}%` }} />
          </div>
          {isDSA && (
            <span className="text-xs px-2.5 py-1 rounded-lg font-semibold"
              style={{
                background: difficulty === 'hard' ? 'rgba(248,113,113,0.12)' : difficulty === 'easy' ? 'rgba(74,222,128,0.12)' : 'rgba(250,204,21,0.12)',
                color: difficulty === 'hard' ? '#f87171' : difficulty === 'easy' ? '#4ade80' : '#facc15',
              }}>
              {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <TimerDisplay timeLeft={timeLeft} formattedTime={formattedTime}
            colorState={colorState} totalSeconds={totalSecs} />
          <button id="end-interview-btn"
            onClick={() => { if (window.confirm('End interview early and go to report?')) endInterview('manual') }}
            className="btn-secondary text-xs py-2 px-3">
            <Flag size={13} /> End
          </button>
        </div>
      </div>

      {/* ── Main split ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">

        {/* LEFT — Webcam or CodeEditor */}
        <div
          className={`${isDSA ? 'lg:w-3/5 flex' : 'hidden lg:flex lg:w-[55%]'} flex-col p-4 gap-3`}
          style={{ borderRight: '1px solid var(--color-border)' }}
        >
          {isDSA ? (
            <CodeEditor
              question={currentQ}
              onSubmit={handleCodeSubmit}
              onLanguageChange={lang => setCodeLang(lang)}
              disabled={status === 'evaluating'}
            />
          ) : (
            <WebcamFeed />
          )}
        </div>

        {/* RIGHT — Question + controls */}
        <div className={`${isDSA ? 'lg:w-2/5' : 'w-full lg:w-[45%]'} flex flex-col p-5 gap-4 overflow-y-auto`}>

          {/* Question display — DSA uses DSAQuestionPanel, others use QuestionPanel */}
          {isDSA ? (
            <DSAQuestionPanel
              question={currentQ}
              timeElapsed={timeElapsed}
              difficulty={difficulty}
            />
          ) : (
            <>
              <QuestionPanel
                question={currentQ}
                questionIndex={qIndex}
                totalQuestions={total}
                roundType={roundType}
                status={status}
              />

              {/* Transcript display (voice rounds) */}
              <TranscriptDisplay
                transcript={transcript}
                isTranscribing={isTranscribing}
                onChange={setTranscript}
              />
            </>
          )}

          {/* ── Streaming Feedback Panel (Phase 3) ───────────────────────── */}
          {showFeedback && streamingFeedback && (
            <div className="glass rounded-xl p-4 border"
              style={{ borderColor: 'rgba(124,58,237,0.3)', background: 'rgba(124,58,237,0.06)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Star size={13} className="text-purple-400" />
                <span className="text-xs font-semibold text-purple-300 uppercase tracking-wider">Alex's Feedback</span>
                {status === 'evaluating' && (
                  <span className="ml-auto inline-block w-1.5 h-4 bg-purple-400 animate-pulse rounded-sm" />
                )}
              </div>
              <p className="text-sm text-muted leading-relaxed whitespace-pre-wrap">{streamingFeedback}</p>
            </div>
          )}

          {/* ── Controls ─────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-3 mt-auto">

            {/* Voice controls (non-DSA) */}
            {!isDSA && (
              <div className="flex gap-3">
                <button
                  id="record-toggle-btn"
                  onClick={handleRecordToggle}
                  disabled={status === 'evaluating' || isTranscribing}
                  className="flex-1 py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-300 text-white"
                  style={isRecording ? {
                    background: 'linear-gradient(135deg,#ef4444,#dc2626)',
                    boxShadow: '0 0 22px rgba(239,68,68,0.55)',
                  } : {
                    background: 'linear-gradient(135deg,#7c3aed,#6d28d9)',
                    boxShadow: '0 4px 16px rgba(124,58,237,0.4)',
                  }}
                >
                  {isRecording ? (
                    <><span className="w-2.5 h-2.5 rounded-full bg-white animate-ping" />
                      <MicOff size={16} /> Stop & Transcribe</>
                  ) : (
                    <><Mic size={16} /> Start Recording</>
                  )}
                </button>

                {/* Skip */}
                <button id="skip-btn"
                  onClick={() => handleSubmit(true)}
                  disabled={isRecording || status === 'evaluating' || isTranscribing}
                  title="Skip this question"
                  className="py-3 px-4 rounded-xl text-sm font-medium transition-all duration-200"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                  <SkipForward size={16} />
                </button>
              </div>
            )}

            {/* Submit button (voice rounds only — code rounds submit is in CodeEditor) */}
            {!isDSA && (
              <button
                id="submit-answer-btn"
                onClick={() => handleSubmit(false)}
                disabled={isRecording || status === 'evaluating' || isTranscribing || !answerReady}
                className="btn-primary w-full py-3.5 text-sm"
              >
                {status === 'evaluating' ? (
                  <><Loader2 size={18} className="animate-spin" /> Evaluating with AI…</>
                ) : qIndex + 1 >= total ? (
                  <><Send size={18} /> Submit & Finish Interview</>
                ) : (
                  <><ChevronRight size={18} /> Submit & Next Question</>
                )}
              </button>
            )}

            {/* DSA skip button */}
            {isDSA && (
              <button id="skip-btn-dsa"
                onClick={() => handleSubmit(true)}
                disabled={status === 'evaluating'}
                className="py-2.5 rounded-xl text-xs font-medium transition-all"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                <SkipForward size={14} className="inline mr-1" /> Skip Question
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
