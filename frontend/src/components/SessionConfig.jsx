/**
 * SessionConfig — difficulty selector, timer slider, question count picker.
 * Props: { roundType, onStart, onBack }
 */
import { useState, useEffect } from 'react'
import { ChevronLeft, Zap, Clock, HelpCircle, Loader2, Play, Sparkles, Building2, Briefcase, Repeat } from 'lucide-react'
import { startSession } from '../lib/api'
import { requestAppFullscreen } from '../lib/fullscreen'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'

/** Map engineering year → suggested difficulty id */
const YEAR_TO_DIFFICULTY = {
  '1st':  'fresher',
  '2nd':  'fresher',
  '3rd':  'mid-level',
  '4th':  'mid-level',
}

const ROUND_LABELS = {
  technical:     'Technical Interview',
  hr:            'HR / Behavioural Interview',
  dsa:           'DSA / Coding Interview',
  mcq_practice:  'Company MCQ Practice',
}

const ROUND_COLORS = {
  technical:     { accent: '#7c3aed', glow: 'rgba(124,58,237,0.3)' },
  hr:            { accent: '#ec4899', glow: 'rgba(236,72,153,0.3)' },
  dsa:           { accent: '#06b6d4', glow: 'rgba(6,182,212,0.3)' },
  mcq_practice:  { accent: '#f59e0b', glow: 'rgba(245,158,11,0.3)' },
}

const DIFFICULTIES = [
  { id: 'fresher',   label: 'Fresher',   sub: '0–1 yr exp', color: 'text-green-400',  border: 'rgba(74,222,128,0.5)' },
  { id: 'mid-level', label: 'Mid-Level', sub: '1–3 yrs exp', color: 'text-yellow-400', border: 'rgba(250,204,21,0.5)' },
  { id: 'senior',    label: 'Senior',    sub: '3+ yrs exp', color: 'text-red-400',    border: 'rgba(248,113,113,0.5)' },
]

const QUESTION_OPTIONS = [5, 8, 10, 12, 15]

export default function SessionConfig({ roundType, onStart, onBack }) {
  const navigate = useNavigate()

  const [difficulty,       setDifficulty]       = useState('mid-level')
  const [timerMins,        setTimerMins]        = useState(30)
  const [numQuestions,     setNumQuestions]     = useState(8)
  const [starting,         setStarting]         = useState(false)
  const [suggestedDiff,    setSuggestedDiff]    = useState(null)
  const [targetCompany,    setTargetCompany]    = useState('')
  const [jobRole,          setJobRole]          = useState('')
  const [isFullLoop,       setIsFullLoop]       = useState(false)
  const [availableComps,   setAvailableComps]   = useState([])

  // Auto-suggest difficulty from student_meta year
  useEffect(() => {
    try {
      const meta = JSON.parse(localStorage.getItem('student_meta') || '{}')
      if (meta.year) {
        let suggested = YEAR_TO_DIFFICULTY[meta.year] || 'mid-level'
        // Bump to senior if 4th year with high CGPA (>= 8.5)
        if (meta.year === '4th' && meta.cgpa >= 8.5) suggested = 'senior'
        setDifficulty(suggested)
        setSuggestedDiff(suggested)
      }
      if (meta.target_companies?.length > 0) {
        setAvailableComps(meta.target_companies.slice(0, 5))
      }
    } catch {}
  }, [])

  const { accent, glow } = ROUND_COLORS[roundType] || ROUND_COLORS.technical

  const handleStart = async () => {
    const profileId = localStorage.getItem('profile_id')
    if (!profileId) {
      toast.error('No resume found. Please upload your resume first.')
      return
    }
    if (roundType === 'mcq_practice' && !targetCompany.trim()) {
      toast.error('Enter a target company to start the MCQ practice round.')
      return
    }
    setStarting(true)
    try {
      await requestAppFullscreen()

      // Forward student_meta from localStorage so the backend prompt is enriched
      // even if the Supabase PATCH hasn't propagated yet.
      let studentMeta = null
      try {
        const raw = localStorage.getItem('student_meta')
        if (raw) studentMeta = JSON.parse(raw)
      } catch {}

      const payload = {
        profile_id:    profileId,
        round_type:    roundType,
        difficulty,
        timer_mins:    timerMins,
        num_questions: roundType === 'mcq_practice'
          ? Math.max(10, Math.floor(timerMins / 2.5))
          : Math.max(5, Math.floor(timerMins / 3)), // Ensure enough questions for the time
        student_meta:  studentMeta,
      }
      if (targetCompany.trim()) payload.target_company = targetCompany.trim();
      if (jobRole.trim())       payload.job_role       = jobRole.trim();
      if (isFullLoop)           payload.is_full_loop   = true;

      const res = await startSession(payload)

      // API returns { success, data: { session_id, first_question, questions, … } }
      const { session_id, questions, timer_mins, round_type, first_question, session_label } = res.data

      // Store full session so InterviewPage / CodingPage can read it
      sessionStorage.setItem(`session_${session_id}`, JSON.stringify({
        session_id,
        questions,
        timer_minutes: timer_mins,
        round_type,
        difficulty,
        num_questions: numQuestions,
        session_label,
      }))
      localStorage.setItem('session_id', session_id)

      if (onStart) onStart(res.data)

      // Navigate based on round type
      if (roundType === 'dsa') {
        navigate(`/coding/${session_id}`)
      } else {
        navigate(`/interview/${session_id}`)
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to start session. Please try again.')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="glass p-8 w-full max-w-lg animate-scale-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-7">
        <button onClick={onBack}
          className="p-2 rounded-lg transition-all hover:bg-white/10 text-muted hover:text-white">
          <ChevronLeft size={20} />
        </button>
        <div>
          <p className="text-xs text-muted uppercase tracking-widest mb-0.5">Selected Round</p>
          <h2 className="font-bold text-lg" style={{ color: accent }}>
            {ROUND_LABELS[roundType]}
          </h2>
        </div>
      </div>

      {/* ── Context Targets ─────────────────────────────────────────────── */}
      <div className="mb-7 grid gap-4">
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-muted mb-2">
            <Building2 size={14} /> Target Company (Optional)
          </label>
          <input 
            type="text" 
            placeholder="e.g. Google, Stripe, etc." 
            value={targetCompany}
            onChange={(e) => setTargetCompany(e.target.value)}
            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-purple-500/50 transition-colors"
          />
          {availableComps.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {availableComps.map(c => (
                <button key={c} onClick={() => setTargetCompany(c)}
                  className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-muted hover:bg-white/10 hover:text-white transition-colors">
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-muted mb-2">
            <Briefcase size={14} /> Job Role (Optional)
          </label>
          <input 
            type="text" 
            placeholder="e.g. Frontend Developer, SRE" 
            value={jobRole}
            onChange={(e) => setJobRole(e.target.value)}
            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-purple-500/50 transition-colors"
          />
        </div>
      </div>

      {/* ── Difficulty ──────────────────────────────────────────────────── */}
      <div className="mb-7">
        <label className="flex items-center gap-1.5 text-sm font-medium text-muted mb-3">
          <Zap size={14} /> Experience Level
        </label>
        <div className="grid grid-cols-3 gap-2">
          {DIFFICULTIES.map(({ id, label, sub, color, border }) => (
            <button
              key={id}
              id={`diff-${id}`}
              onClick={() => setDifficulty(id)}
              className="py-3 px-2 rounded-xl text-center transition-all duration-200 border relative"
              style={difficulty === id
                ? { borderColor: border, background: `${border.replace('0.5', '0.1')}`, }
                : { borderColor: 'var(--color-border)', background: 'transparent' }}
            >
              <p className={`font-bold text-sm ${difficulty === id ? color : 'text-muted'}`}>{label}</p>
              <p className="text-xs text-muted mt-0.5">{sub}</p>
              {suggestedDiff === id && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                  style={{ background: 'linear-gradient(135deg,#5b5ef6,#06b6d4)', color: '#fff' }}>
                  <Sparkles size={9} /> Suggested
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Timer slider ─────────────────────────────────────────────────── */}
      <div className="mb-7">
        <div className="flex items-center justify-between mb-3">
          <label className="flex items-center gap-1.5 text-sm font-medium text-muted">
            <Clock size={14} /> Interview Duration
          </label>
          <span className="font-bold text-2xl" style={{ color: accent }}>{timerMins}
            <span className="text-sm font-normal text-muted ml-1">min</span>
          </span>
        </div>
        <div className="relative">
          <input
            id="timer-slider"
            type="range" min={10} max={90} step={5}
            value={timerMins}
            onChange={e => setTimerMins(+e.target.value)}
            className="w-full h-2 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, ${accent} 0%, ${accent} ${((timerMins - 10) / 80) * 100}%, rgba(42,42,74,0.8) ${((timerMins - 10) / 80) * 100}%, rgba(42,42,74,0.8) 100%)`,
            }}
          />
          <div className="flex justify-between text-xs text-muted mt-1.5 px-0.5">
            <span>10 min</span><span>90 min</span>
          </div>
        </div>
      </div>

      {/* ── Question count (Temporarily disabled for realism) ───────────────── */}
      {/* 
      <div className="mb-8">
        <label className="flex items-center gap-1.5 text-sm font-medium text-muted mb-3">
          <HelpCircle size={14} /> Number of Questions
        </label>
        <div className="flex gap-2 mb-5">
          {QUESTION_OPTIONS.map(n => (
            <button
              key={n}
              id={`q-count-${n}`}
              onClick={() => setNumQuestions(n)}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 border"
              style={numQuestions === n
                ? { borderColor: accent, background: `${accent}20`, color: accent }
                : { borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      */}
      <div className="mb-8">
        <label className="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors hover:bg-white/5"
            style={{ borderColor: isFullLoop ? accent : 'var(--color-border)' }}>
          <div className="flex-1 flex flex-col">
             <span className="text-sm font-semibold flex items-center gap-2" style={{ color: isFullLoop ? accent : 'var(--color-text)' }}>
                 <Repeat size={14} /> Full Loop (Gauntlet Mode)
             </span>
             <span className="text-xs text-muted mt-0.5">Automatically link HR, DSA, and MCQ practice rounds into one long-form gauntlet.</span>
          </div>
          <div className={`w-10 h-6 rounded-full p-1 transition-colors ${isFullLoop ? 'bg-purple-500' : 'bg-gray-700'}`}>
             <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${isFullLoop ? 'translate-x-4' : 'translate-x-0'}`} />
          </div>
          <input type="checkbox" className="hidden" checked={isFullLoop} onChange={(e) => setIsFullLoop(e.target.checked)} />
        </label>
      </div>

      {/* ── Summary chips ────────────────────────────────────────────────── */}
      <div className="flex gap-2 mb-6">
        {[
          { label: DIFFICULTIES.find(d => d.id === difficulty)?.label },
          { label: `${timerMins} mins` },
        ].map(({ label }) => (
          <span key={label} className="badge-purple text-xs">{label}</span>
        ))}
      </div>

      {/* ── Start button ─────────────────────────────────────────────────── */}
      <button
        id="start-session-btn"
        onClick={handleStart}
        disabled={starting}
        className="w-full py-4 rounded-xl font-bold text-base text-white flex items-center justify-center gap-2 transition-all duration-300"
        style={{
          background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
          boxShadow: starting ? 'none' : `0 4px 20px ${glow}`,
          opacity: starting ? 0.7 : 1,
        }}
      >
        {starting
          ? <><Loader2 size={20} className="animate-spin" /> Starting…</>
          : <><Play size={20} /> Start Interview</>}
      </button>
    </div>
  )
}
