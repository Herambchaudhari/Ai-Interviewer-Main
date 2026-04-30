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

import InterviewCamera    from '../components/InterviewCamera'
import QuestionPanel      from '../components/QuestionPanel'
import TranscriptDisplay  from '../components/TranscriptDisplay'
import LoadingSpinner     from '../components/LoadingSpinner'
import DSACodeEditor      from '../components/DSACodeEditor'
import DSAQuestionPanel   from '../components/DSAQuestionPanel'
import MCQQuestionPanel   from '../components/MCQQuestionPanel'
import { useAudioRecorder }         from '../hooks/useAudioRecorder'
import { useInterviewGuard }        from '../hooks/useInterviewGuard'
import { useTimer }                  from '../hooks/useTimer'
import { useProctoringMonitor }      from '../hooks/useProctoringMonitor'
import { submitAnswerStreaming }      from '../hooks/useSSE'
import tts                           from '../services/tts'
import {
  transcribeSession, submitSessionAnswer,
  skipQuestion as apiSkip, endSession as apiEnd, generateReport,
  checkpointSession,
} from '../lib/api'
import { getReportRoute } from '../lib/routes'

import {
  Mic, MicOff, Send, SkipForward,
  ChevronRight, Loader2, AlertCircle, Flag, Star, Maximize
} from 'lucide-react'

const LIVE_FLAG_LABELS = {
  camera_blocked: 'Camera blocked',
  multiple_faces: 'Multiple faces',
  phone_detected: 'Phone detected',
  looking_away: 'Looking away',
  poor_posture: 'Posture drift',
}

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
  const [endingSession,    setEndingSession]    = useState(false)
  const [showEndConfirm,   setShowEndConfirm]   = useState(false)
  const endInterviewRef = useRef(null)
  const webcamVideoRef = useRef(null)
  const lastProctorToastRef = useRef('')
  const mcqAutoSubmitRef = useRef('')

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
  const [selectedOptionIndex, setSelectedOptionIndex] = useState(null)
  const [selectedOptionText, setSelectedOptionText] = useState('')
  const [mcqTimeLeft, setMcqTimeLeft] = useState(0)

  // ── Streaming feedback (Phase 3) ──────────────────────────────────────────
  const [streamingFeedback, setStreamingFeedback] = useState('')
  const [showFeedback,      setShowFeedback]      = useState(false)

  // ── Audio/delivery metadata for scoring (Phase 4) ────────────────────────
  const [scoringMeta,    setScoringMeta]    = useState(null)
  const [recordStartMs,  setRecordStartMs]  = useState(0)
  // ── Audio clip reference for report playback ─────────────────────────────
  const [audioClipData,  setAudioClipData]  = useState(null) // {audio_url, audio_path}

  // ── Time tracking for DSA hints ──────────────────────────────────────────
  const [qStartTime,  setQStartTime] = useState(Date.now())
  const [timeElapsed, setTimeElapsed] = useState(0)

  // ── Hooks ─────────────────────────────────────────────────────────────────
  const { isRecording, startRecording, stopRecording, resetRecording } = useAudioRecorder(120)

  // Read timer duration synchronously so useTimer initialises with the correct value.
  // session state is null at mount (loaded via useEffect), so we can't rely on it here.
  const totalSecs = (() => {
    try {
      const raw = sessionStorage.getItem(`session_${sessionId}`)
      if (raw) {
        const s = JSON.parse(raw)
        const mins = s.timer_minutes || s.timer_mins || 30
        return Math.max(300, mins * 60)   // minimum 5 minutes
      }
    } catch {}
    return 1800  // 30-min fallback
  })()
  const storageKey = sessionId ? `timer_${sessionId}` : null

  const handleWarning = useCallback(() => {
    toast('⚠️ 5 minutes remaining!', { icon: '⏳', duration: 4000 })
    tts.speak('Warning: only 5 minutes remaining.')
  }, [])

  const { formattedTime, timeLeft, colorState, isRunning, start: startTimer, pause: pauseTimer } =
    useTimer(totalSecs, { onTick: handleWarning, onExpire: () => { toast.error('Time is up!'); endInterview('timeout') }, storageKey })

  const {
    exitAttempts,
    fullscreenSupported,
    maxAttempts,
    remainingAttempts,
    requiresFullscreen,
    handleResumeFullscreen,
    handleManualEndAttempt,
    releaseGuard,
  } = useInterviewGuard({
    enabled: !loading && !loadError && Boolean(session) && status !== 'done',
    maxAttempts: 3,
    onLimitReached: async () => {
      await endInterviewRef.current?.('fullscreen_exit_limit', {
        successMessage: 'Exit limit reached. Ending the interview and opening your report…',
        toastType: 'error',
      })
    },
  })

  const {
    modelError: proctoringModelError,
    liveFlags,
    recentIncidents,
    summary: proctoringSummary,
  } = useProctoringMonitor({
    enabled: !loading && !loadError && Boolean(session) && status !== 'done',
    videoRef: webcamVideoRef,
  })

  // ── Computed ──────────────────────────────────────────────────────────────
  const isDSA       = roundType === 'dsa'
  const isMCQ       = roundType === 'mcq_practice'
  const answerReady = isDSA ? code.trim().length > 10 : isMCQ ? selectedOptionIndex !== null : transcript.length > 3
  const sessionLabel = session?.session_label || `${roundType.replace('_', ' ')} interview`
  const attentionPct = Math.round(proctoringSummary.average_attention_score ?? 100)
  const activeIntegrityAlerts = liveFlags.map(flag => LIVE_FLAG_LABELS[flag] || flag)

  // ── Elapsed timer for hint unlock ─────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeElapsed(Math.floor((Date.now() - qStartTime) / 1000))
    }, 5000)
    return () => clearInterval(interval)
  }, [qStartTime])

  // ── Auto-checkpoint every 60 s (best-effort, never blocks the UI) ─────────
  useEffect(() => {
    if (!sessionId || status === 'done') return
    const interval = setInterval(() => {
      checkpointSession(sessionId, {
        current_question_index: qIndex,
        scores,
        timer_remaining_secs: timeLeft ?? undefined,
      })
    }, 60_000)
    return () => clearInterval(interval)
  }, [sessionId, qIndex, scores, timeLeft, status])

  // ── Load session from sessionStorage ──────────────────────────────────────
  useEffect(() => {
    const raw = sessionStorage.getItem(`session_${sessionId}`)
    if (raw) {
      try {
        const s = JSON.parse(raw)
        setSession(s)
        setTotal(s.num_questions || s.questions?.length || 0)
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

  useEffect(() => {
    const latest = recentIncidents?.[0]
    if (!latest || latest.id === lastProctorToastRef.current) return

    lastProctorToastRef.current = latest.id
    const notifier = latest.severity === 'high' ? toast.error : toast
    notifier(`Integrity alert: ${latest.label}`, { duration: latest.severity === 'high' ? 3600 : 2200 })
  }, [recentIncidents])

  // ── Speak question on change (voice rounds only) ───────────────────────────
  useEffect(() => {
    if (!currentQ) return
    setTranscript('')
    setCode('# Write your solution here\n')
    setSelectedOptionIndex(null)
    setSelectedOptionText('')
    setMcqTimeLeft(currentQ.time_limit_secs || 90)
    mcqAutoSubmitRef.current = ''
    resetRecording()
    setAudioClipData(null)
    setQStartTime(Date.now())
    setTimeElapsed(0)

    if (!isDSA && !isMCQ) {
      setStatus('speaking')
      const text = currentQ.question_text || currentQ.text || ''
      tts.speak(text, () => setStatus('idle'))
    } else {
      setStatus('idle')
    }
    if (qIndex === 0 && !isRunning) startTimer()
  }, [currentQ?.id]) // eslint-disable-line

  useEffect(() => {
    if (!isMCQ || !currentQ) return undefined
    const interval = setInterval(() => {
      setMcqTimeLeft(prev => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(interval)
  }, [isMCQ, currentQ?.id])

  useEffect(() => {
    if (!isMCQ || !currentQ || mcqTimeLeft > 0 || status === 'evaluating' || status === 'done') return
    if (mcqAutoSubmitRef.current === currentQ.id) return
    // Guard: only auto-submit if not already being submitted manually
    if (status === 'processing') return
    mcqAutoSubmitRef.current = currentQ.id
    toast('Question timed out. Submitting current selection...', { icon: '⏱️', duration: 2200 })
    handleSubmit(false, null, { timedOut: true })
  }, [isMCQ, currentQ, mcqTimeLeft, status]) // eslint-disable-line

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
        // Store audio clip reference for report playback
        setAudioClipData({
          audio_url:  res.data?.audio_url  || null,
          audio_path: res.data?.audio_path || null,
        })
        // Store delivery metadata for scoring context (Phase 4)
        setScoringMeta({
          ...meta,
          time_limit_secs:  currentQ?.time_limit_secs || 180,
          time_used_ratio:  meta.duration_secs ? meta.duration_secs / (currentQ?.time_limit_secs || 180) : 0.5,
          response_latency_ms: Date.now() - responseLatencyStart,
          question_difficulty: difficulty,
          round_type:          roundType,
          is_follow_up:        currentQ?.is_follow_up || false,
          candidate_year:      JSON.parse(localStorage.getItem('student_meta') || '{}')?.year || null,
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
  const endInterview = useCallback(async (
    reason = 'completed',
    {
      successMessage = 'Interview complete! Generating your report…',
      toastType = 'success',
    } = {}
  ) => {
    if (endingSession) return
    setEndingSession(true)
    setStatus('done')
    tts.stop()
    pauseTimer()
    if (storageKey) localStorage.removeItem(storageKey)
    await releaseGuard()
    try {
      await apiEnd({ session_id: sessionId, reason, proctoring_summary: proctoringSummary })
    } catch {
      // Non-fatal — try Report page generation directly
      try { await generateReport(sessionId) } catch { /* fallback: report page handles it */ }
    }
    const notify = toastType === 'error' ? toast.error : toast.success
    notify(successMessage, { duration: 3500 })
    setTimeout(() => navigate(getReportRoute(sessionId)), 1500)
  }, [endingSession, sessionId, navigate, pauseTimer, storageKey, releaseGuard, proctoringSummary])

  useEffect(() => {
    endInterviewRef.current = endInterview
  }, [endInterview])

  const applyNextQuestion = useCallback((next) => {
    if (!next) {
      endInterview()
      return
    }
    setCurrentQ({
      ...next,
      question_text: next.question_text || next.text || '',
      text: next.text || next.question_text || '',
    })
    setQIndex(i => i + 1)
    setCode('# Write your solution here\n')
    setSelectedOptionIndex(null)
    setSelectedOptionText('')
    setStreamingFeedback('')
    setShowFeedback(false)
    setStatus('idle')
    startTimer()
  }, [endInterview, startTimer])

  // ── Submit answer ─────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (skip = false, overrideCode = null, submitMeta = {}) => {
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
        const next = inner?.next_question
        if (next) {
          applyNextQuestion(next)
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

    const answerText = isDSA
      ? (overrideCode ?? code)
      : isMCQ
        ? (selectedOptionText || '[No option selected]')
        : (transcript || '[No answer]')

    const submitPayload = {
      session_id:       sessionId,
      question_id:      currentQ?.id || '',
      transcript:       answerText,
      language:         isDSA ? codeLang : undefined,
      selected_option:  isMCQ ? (selectedOptionText || null) : undefined,
      selected_option_index: isMCQ ? selectedOptionIndex : undefined,
      time_taken_secs:  Math.floor((Date.now() - qStartTime) / 1000),
      current_question: currentQ,
      is_last_question: isLast,
      scoring_context:  (!isDSA && !isMCQ && scoringMeta) ? scoringMeta : null,
      // Audio playback — set by handleRecordToggle after transcription
      audio_url:        audioClipData?.audio_url  || null,
      audio_path:       audioClipData?.audio_path || null,
    }

    // DSA and MCQ rounds use blocking calls; voice rounds stream
    if (isDSA || isMCQ) {
      try {
        const payload = await submitSessionAnswer(submitPayload)
        const inner   = payload?.data ?? payload
        const eval_   = inner?.evaluation || {}
        setScores(prev => [...prev, { ...eval_, score: eval_.score, question: currentQ?.question_text || `Q${qIndex + 1}` }])
        if (isMCQ) {
          setStreamingFeedback(eval_?.feedback || '')
          setShowFeedback(true)
        }
        if (inner?.session_complete) {
          if (isMCQ) {
            setTimeout(() => endInterview(), 1600)
          } else {
            endInterview()
          }
          return
        }
        const next = inner?.next_question
        if (next) {
          if (isMCQ) {
            setTimeout(() => applyNextQuestion(next), submitMeta.timedOut ? 900 : 1600)
          } else {
            applyNextQuestion(next)
          }
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
      onFeedbackChunk: (chunk) => {
        const trimmed = String(chunk || '').trim()
        if (!trimmed) return
        const looksLikeRawJson = (
          trimmed.startsWith('{') ||
          trimmed.startsWith('}') ||
          trimmed.startsWith('"') ||
          trimmed.includes('"score"') ||
          trimmed.includes('"dimension_scores"') ||
          trimmed.includes('"feedback"') ||
          trimmed.includes('"follow_up_question"')
        )
        if (!looksLikeRawJson) {
          setStreamingFeedback(prev => prev + chunk)
        }
      },
      onEvalComplete: (eval_) => {
        setStreamingFeedback(eval_?.feedback || '')
        setScores(prev => [...prev, { ...eval_, score: eval_.score, question: currentQ?.question_text || `Q${qIndex + 1}` }])
      },
      onNextQuestion: (next) => {
        // Small delay so user can read the streamed feedback
        setTimeout(() => {
          applyNextQuestion(next)
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
              applyNextQuestion(next)
            } else {
              endInterview()
            }
          })
          .catch(() => { toast.error('Submission failed — try again.'); setStatus('idle'); startTimer() })
      },
    })
  }, [isRecording, isDSA, isMCQ, code, transcript, selectedOptionIndex, selectedOptionText, sessionId, currentQ, qIndex, total, session, stopRecording, pauseTimer, startTimer, endInterview, codeLang, qStartTime, scoringMeta, applyNextQuestion]) // eslint-disable-line

  // ── Code submit handler (from CodeEditor component) ─────────────────────
  const handleCodeSubmit = useCallback((submittedCode, lang) => {
    setCode(submittedCode)
    setCodeLang(lang)
    // Pass the code directly to avoid React state closure timing issues
    handleSubmit(false, submittedCode)
  }, [handleSubmit])

  const handleMcqSelect = useCallback((index, option) => {
    if (status === 'evaluating') return
    setSelectedOptionIndex(index)
    setSelectedOptionText(option)
  }, [status])

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
        <p className="text-lg font-semibold gradient-text">Generating your report...</p>
        <p className="text-muted text-sm mt-2">This may take a few seconds</p>
      </div>
    </div>
  )

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen pt-16 flex flex-col" style={{ background: 'var(--color-bg)' }}>
      {isDSA && (
        <InterviewCamera
          videoRef={webcamVideoRef}
          captureOnly
          hideControls
        />
      )}
      {requiresFullscreen && fullscreenSupported && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6"
          style={{ background: 'rgba(6, 8, 18, 0.92)', backdropFilter: 'blur(16px)' }}>
          <div className="glass max-w-lg w-full p-8 text-center border"
            style={{ borderColor: 'rgba(124,58,237,0.35)' }}>
            <div className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.28), rgba(34,211,238,0.18))' }}>
              <Maximize size={28} className="text-purple-300" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Return To Fullscreen</h2>
            <p className="text-muted text-sm leading-relaxed mb-5">
              This interview must stay in fullscreen mode. Leaving fullscreen or trying to end the session counts as an attempt.
            </p>
            <p className="text-sm font-semibold mb-6" style={{ color: '#fca5a5' }}>
              Attempts used: {exitAttempts}/{maxAttempts}. {remainingAttempts} {remainingAttempts === 1 ? 'attempt' : 'attempts'} remaining.
            </p>
            <button onClick={handleResumeFullscreen} className="btn-primary w-full py-3.5 text-sm">
              <Maximize size={16} /> Re-enter Fullscreen
            </button>
          </div>
        </div>
      )}

      {/* ── End Interview Confirmation Modal ─────────────────────────────── */}
      {showEndConfirm && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}>
          <div className="glass max-w-sm w-full p-7 text-center"
            style={{ border: '1px solid rgba(239,68,68,0.35)' }}>
            <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
              style={{ background: 'rgba(239,68,68,0.15)' }}>
              <Flag size={24} className="text-red-400" />
            </div>
            <h2 className="text-xl font-bold mb-2">End Interview?</h2>
            <p className="text-muted text-sm leading-relaxed mb-6">
              You have answered <strong>{qIndex}</strong> of <strong>{total}</strong> questions.
              Ending now will generate your report based on answers submitted so far.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowEndConfirm(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all hover:bg-white/5"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                Keep Going
              </button>
              <button
                onClick={() => { setShowEndConfirm(false); endInterview('manual') }}
                disabled={endingSession}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.45)', color: '#f87171' }}>
                {endingSession ? 'Ending…' : 'End & Get Report'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted mb-1">Session</p>
            <p className="font-semibold leading-tight">{sessionLabel}</p>
          </div>
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
          {fullscreenSupported && (
            <span className="text-xs px-2.5 py-1 rounded-lg font-semibold"
              style={{ background: 'rgba(239,68,68,0.12)', color: '#fca5a5' }}>
              Exit Attempts: {exitAttempts}/{maxAttempts}
            </span>
          )}
          <span className="text-xs px-2.5 py-1 rounded-lg font-semibold"
            style={{
              background: attentionPct >= 80 ? 'rgba(74,222,128,0.12)' : attentionPct >= 60 ? 'rgba(250,204,21,0.12)' : 'rgba(248,113,113,0.12)',
              color: attentionPct >= 80 ? '#86efac' : attentionPct >= 60 ? '#fde68a' : '#fca5a5',
            }}>
            Attention: {attentionPct}%
          </span>
        </div>
        <div className="flex items-center gap-4">
          <TimerDisplay timeLeft={timeLeft} formattedTime={formattedTime}
            colorState={colorState} totalSeconds={totalSecs} />
          <button id="end-interview-btn"
            onClick={() => setShowEndConfirm(true)}
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
            <DSACodeEditor
              question={currentQ}
              onSubmit={handleCodeSubmit}
              onLanguageChange={lang => setCodeLang(lang)}
              disabled={status === 'evaluating'}
            />
          ) : (
            <>
              <InterviewCamera
                videoRef={webcamVideoRef}
                overlay={liveFlags.length > 0 ? (
                  <div className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-2">
                    {liveFlags.map(flag => (
                      <span
                        key={flag}
                        className="text-xs px-2.5 py-1 rounded-full font-semibold"
                        style={{ background: 'rgba(248,113,113,0.16)', color: '#fecaca', border: '1px solid rgba(248,113,113,0.25)' }}
                      >
                        {LIVE_FLAG_LABELS[flag] || flag}
                      </span>
                    ))}
                  </div>
                ) : null}
              />
            </>
          )}
        </div>

        {/* RIGHT — Question + controls */}
        <div className={`${isDSA ? 'lg:w-2/5' : 'w-full lg:w-[45%]'} flex flex-col p-5 gap-4 overflow-y-auto`}>

          {/* Question display — DSA uses DSAQuestionPanel, others use QuestionPanel */}
          {isDSA ? (
            <>
              {(proctoringModelError || activeIntegrityAlerts.length > 0) && (
                <div
                  className="glass rounded-2xl border p-4"
                  style={{
                    borderColor: proctoringModelError || activeIntegrityAlerts.length > 0
                      ? 'rgba(248,113,113,0.3)'
                      : 'rgba(124,58,237,0.2)',
                    background: 'rgba(18, 20, 35, 0.88)',
                  }}
                >
                  <div className="flex items-start gap-3">
                    <AlertCircle size={18} className="text-red-300 mt-0.5 flex-shrink-0" />
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-white">Attention warning</p>
                      {proctoringModelError ? (
                        <p className="text-sm text-red-200">{proctoringModelError}</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {activeIntegrityAlerts.map(label => (
                            <span
                              key={label}
                              className="text-xs px-2.5 py-1 rounded-full font-semibold"
                              style={{ background: 'rgba(248,113,113,0.16)', color: '#fecaca', border: '1px solid rgba(248,113,113,0.25)' }}
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <DSAQuestionPanel
                question={currentQ}
                timeElapsed={timeElapsed}
                difficulty={difficulty}
              />
            </>
          ) : isMCQ ? (
            <MCQQuestionPanel
              question={currentQ}
              questionIndex={qIndex}
              totalQuestions={total}
              selectedOptionIndex={selectedOptionIndex}
              onSelect={handleMcqSelect}
              disabled={status === 'evaluating'}
              status={status}
              timeLeft={mcqTimeLeft}
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
            {!isDSA && !isMCQ && (
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
            {!isDSA && !isMCQ && (
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

            {isMCQ && (
              <div className="flex gap-3">
                <button
                  id="submit-answer-btn-mcq"
                  onClick={() => handleSubmit(false)}
                  disabled={status === 'evaluating' || !answerReady}
                  className="btn-primary flex-1 py-3.5 text-sm"
                >
                  {status === 'evaluating' ? (
                    <><Loader2 size={18} className="animate-spin" /> Checking Answer...</>
                  ) : qIndex + 1 >= total ? (
                    <><Send size={18} /> Submit & Finish Practice</>
                  ) : (
                    <><ChevronRight size={18} /> Submit & Next Question</>
                  )}
                </button>
                <button
                  id="skip-btn-mcq"
                  onClick={() => handleSubmit(true)}
                  disabled={status === 'evaluating'}
                  className="py-3 px-4 rounded-xl text-sm font-medium transition-all duration-200"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                >
                  <SkipForward size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
