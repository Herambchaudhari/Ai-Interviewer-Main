import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { submitAnswer, transcribeAudio } from '../lib/api'
import { Mic, MicOff, Send, SkipForward, Brain, Timer, ChevronRight, Volume2, Loader2, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import LoadingSpinner from '../components/LoadingSpinner'
import { getReportRoute } from '../lib/routes'

const ROUND_LABELS = { technical: 'Technical', hr: 'HR Round', dsa: 'DSA', mcq_practice: 'MCQ Practice', system_design: 'Legacy System Design' }
const DIFF_COLORS  = { easy: 'badge-green', medium: 'badge-yellow', hard: 'badge-red' }

export default function InterviewPage() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const [session, setSession] = useState(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [evaluation, setEvaluation] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [recording, setRecording] = useState(false)
  const [timeLeft, setTimeLeft] = useState(null)
  const [finished, setFinished] = useState(false)
  const [answers, setAnswers] = useState([]) // { question_id, answer_text, score }

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const startTimeRef = useRef(null)

  // Load session from sessionStorage
  useEffect(() => {
    const raw = sessionStorage.getItem(`session_${sessionId}`)
    if (raw) {
      const s = JSON.parse(raw)
      setSession(s)
      setTimeLeft(s.timer_minutes * 60)
    } else {
      toast.error('Session not found. Please start again.')
      navigate('/dashboard')
    }
  }, [sessionId, navigate])

  // Countdown timer
  useEffect(() => {
    if (!session || finished) return
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current)
          toast('Time is up! Submitting interview...')
          handleFinish()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [session, finished])

  // TTS — speak question
  const speakQuestion = useCallback((text) => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    utt.rate = 0.95
    utt.pitch = 1
    utt.volume = 1
    window.speechSynthesis.speak(utt)
  }, [])

  // Auto-read new question
  useEffect(() => {
    if (!session) return
    const q = session.questions[currentIndex]
    if (q) speakQuestion(q.question_text)
  }, [session, currentIndex, speakQuestion])

  const formatTime = (s) => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`

  // ── Recording ────────────────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []
      mr.ondataavailable = e => chunksRef.current.push(e.data)
      mr.start(250)
      mediaRecorderRef.current = mr
      startTimeRef.current = Date.now()
      setRecording(true)
      setTranscript('')
      setEvaluation(null)
    } catch {
      toast.error('Microphone access denied. Please allow mic access.')
    }
  }

  const stopRecording = () => {
    return new Promise(resolve => {
      const mr = mediaRecorderRef.current
      if (!mr) return resolve(null)
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop())
        resolve(blob)
      }
      mr.stop()
      setRecording(false)
    })
  }

  const handleMicToggle = async () => {
    if (recording) {
      const blob = await stopRecording()
      if (!blob || blob.size < 1000) { toast.error('Recording too short'); return }
      toast.loading('Transcribing...', { id: 'transcribe' })
      try {
        const result = await transcribeAudio(blob)
        setTranscript(result.text)
        toast.success('Transcribed!', { id: 'transcribe' })
      } catch {
        toast.error('Transcription failed. Please type your answer.', { id: 'transcribe' })
      }
    } else {
      startRecording()
    }
  }

  // ── Submit Answer ─────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!transcript.trim()) { toast.error('Please record or type your answer'); return }
    const question = session.questions[currentIndex]
    setSubmitting(true)
    try {
      const eval_ = await submitAnswer({
        session_id: sessionId,
        question_id: question.id,
        answer_text: transcript,
        time_taken_seconds: startTimeRef.current ? Math.round((Date.now() - startTimeRef.current) / 1000) : null,
      })
      setEvaluation(eval_)
      setAnswers(prev => [...prev, { question_id: question.id, answer_text: transcript, score: eval_.score }])
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Next Question ─────────────────────────────────────────────────────────
  const handleNext = () => {
    if (currentIndex >= session.questions.length - 1) {
      handleFinish()
    } else {
      setCurrentIndex(i => i + 1)
      setTranscript('')
      setEvaluation(null)
    }
  }

  const handleFinish = () => {
    clearInterval(timerRef.current)
    window.speechSynthesis?.cancel()
    setFinished(true)
    navigate(getReportRoute(sessionId))
  }

  if (!session) return <LoadingSpinner fullScreen />

  const question = session.questions[currentIndex]
  const progress = ((currentIndex) / session.questions.length) * 100
  const isLast = currentIndex === session.questions.length - 1

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg)' }}>
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-surface"
        style={{ background: 'rgba(15,15,26,0.9)', backdropFilter: 'blur(20px)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #22d3ee)' }}>
            <Brain size={18} className="text-white" />
          </div>
          <span className="font-bold gradient-text">AI Interviewer</span>
          <span className={`badge ${DIFF_COLORS[session.difficulty]}`}>{session.difficulty}</span>
          <span className="badge-purple">{ROUND_LABELS[session.round_type]}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-muted text-sm">Q {currentIndex + 1} / {session.num_questions}</span>
          <div className={`flex items-center gap-2 font-mono text-lg font-bold ${
            timeLeft < 120 ? 'text-red-400' : 'text-white'
          }`}>
            <Timer size={18} />
            {formatTime(timeLeft || 0)}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1" style={{ background: 'var(--color-surface)' }}>
        <div className="h-full transition-all duration-500"
          style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #7c3aed, #22d3ee)' }} />
      </div>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-0 overflow-hidden">
        {/* Left — Question Panel */}
        <div className="flex flex-col p-8 border-r border-surface">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #22d3ee)' }}>
              {currentIndex + 1}
            </div>
            <span className="text-muted text-sm uppercase tracking-widest">Question</span>
            <span className="text-muted text-xs ml-auto">{question.category}</span>
          </div>

          <div className="glass p-6 flex-1 flex flex-col">
            <p className="text-xl font-medium leading-relaxed mb-6 animate-fade-in">
              {question.question_text}
            </p>

            {question.expected_points?.length > 0 && (
              <div className="mt-auto">
                <p className="text-xs text-muted mb-2 uppercase tracking-wider">Key areas to cover:</p>
                <ul className="space-y-1">
                  {question.expected_points.map((pt, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-muted">
                      <span className="w-1 h-1 rounded-full bg-purple-400 flex-shrink-0" />
                      {pt}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* TTS button */}
          <button onClick={() => speakQuestion(question.question_text)}
            className="btn-secondary mt-4 text-sm py-2.5">
            <Volume2 size={16} /> Re-read Question
          </button>
        </div>

        {/* Right — Answer Panel */}
        <div className="flex flex-col p-8 gap-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-muted text-sm uppercase tracking-widest">Your Answer</span>
          </div>

          {/* Transcript area */}
          <div className="glass flex-1 p-5 relative min-h-[200px]">
            {recording && (
              <div className="absolute top-3 right-3 flex items-center gap-1.5">
                {[...Array(7)].map((_, i) => (
                  <div key={i} className="waveform-bar h-6" style={{ animationDelay: `${i * 0.1}s` }} />
                ))}
                <span className="text-red-400 text-xs font-semibold ml-1 animate-pulse">REC</span>
              </div>
            )}
            <textarea
              id="answer-textarea"
              value={transcript}
              onChange={e => setTranscript(e.target.value)}
              placeholder={recording ? 'Recording… speak clearly' : 'Click the mic to record, or type your answer here…'}
              className="w-full h-full bg-transparent text-sm text-white placeholder-slate-600 outline-none resize-none leading-relaxed"
              rows={8}
            />
          </div>

          {/* Evaluation result */}
          {evaluation && (
            <div className="glass p-4 border border-purple-500/30 animate-scale-in">
              <div className="flex items-center justify-between mb-3">
                <span className="font-semibold text-sm flex items-center gap-2">
                  <CheckCircle size={16} className="text-green-400" /> Evaluation
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold gradient-text">{evaluation.score}</span>
                  <span className="text-muted text-sm">/10</span>
                </div>
              </div>
              <p className="text-sm text-muted mb-3">{evaluation.feedback}</p>
              {evaluation.strengths?.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-xs text-green-400 mb-1">✓ Strengths</p>
                    {evaluation.strengths.map((s,i) => <p key={i} className="text-xs text-muted">• {s}</p>)}
                  </div>
                  <div>
                    <p className="text-xs text-amber-400 mb-1">↑ Improve</p>
                    {evaluation.improvements?.map((s,i) => <p key={i} className="text-xs text-muted">• {s}</p>)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Controls */}
          <div className="flex gap-3">
            <button
              id="mic-button"
              onClick={handleMicToggle}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-all duration-300 ${
                recording ? 'bg-red-500 text-white animate-pulse' : 'btn-secondary'
              }`}
            >
              {recording ? <><MicOff size={18} /> Stop Recording</> : <><Mic size={18} /> Start Recording</>}
            </button>

            {!evaluation ? (
              <button id="submit-answer-btn" onClick={handleSubmit}
                disabled={submitting || !transcript.trim()}
                className="btn-primary px-6">
                {submitting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                {submitting ? '' : 'Submit'}
              </button>
            ) : (
              <button id="next-question-btn" onClick={handleNext}
                className="btn-primary px-6">
                {isLast ? <><CheckCircle size={18} /> Finish</> : <><ChevronRight size={18} /> Next</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
