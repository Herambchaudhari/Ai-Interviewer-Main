import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Editor from '@monaco-editor/react'
import { submitAnswer } from '../lib/api'
import { Code2, Send, ChevronRight, CheckCircle, Timer, Brain, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import LoadingSpinner from '../components/LoadingSpinner'
import { getReportRoute } from '../lib/routes'

const LANGUAGES = [
  { id: 'python',     label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'java',       label: 'Java' },
  { id: 'cpp',        label: 'C++' },
  { id: 'typescript', label: 'TypeScript' },
]

const STARTER_CODE = {
  python:     '# Write your solution here\ndef solution():\n    pass\n',
  javascript: '// Write your solution here\nfunction solution() {\n    \n}\n',
  java:       '// Write your solution here\nclass Solution {\n    public static void main(String[] args) {\n        \n    }\n}\n',
  cpp:        '// Write your solution here\n#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n',
  typescript: '// Write your solution here\nfunction solution(): void {\n    \n}\n',
}

export default function CodingPage() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const [session, setSession] = useState(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [language, setLanguage] = useState('python')
  const [code, setCode] = useState(STARTER_CODE.python)
  const [evaluation, setEvaluation] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [timeLeft, setTimeLeft] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => {
    const raw = sessionStorage.getItem(`session_${sessionId}`)
    if (raw) {
      const s = JSON.parse(raw)
      setSession(s)
      setTimeLeft(s.timer_minutes * 60)
    } else {
      toast.error('Session not found.')
      navigate('/dashboard')
    }
  }, [sessionId, navigate])

  useEffect(() => {
    if (!session) return
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(timerRef.current); handleFinish(); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [session])

  const handleLanguageChange = (lang) => {
    setLanguage(lang)
    setCode(STARTER_CODE[lang] || '')
  }

  const formatTime = (s) => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`

  const handleSubmit = async () => {
    if (!code.trim()) { toast.error('Write some code first!'); return }
    const question = session.questions[currentIndex]
    setSubmitting(true)
    try {
      const eval_ = await submitAnswer({
        session_id: sessionId,
        question_id: question.id,
        answer_text: `[${language.toUpperCase()}]\n${code}`,
      })
      setEvaluation(eval_)
      toast.success(`Scored ${eval_.score}/10`)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  const handleNext = () => {
    if (currentIndex >= session.questions.length - 1) { handleFinish(); return }
    setCurrentIndex(i => i + 1)
    setCode(STARTER_CODE[language])
    setEvaluation(null)
  }

  const handleFinish = () => {
    clearInterval(timerRef.current)
    navigate(getReportRoute(sessionId))
  }

  if (!session) return <LoadingSpinner fullScreen />

  const question = session.questions[currentIndex]
  const isLast = currentIndex === session.questions.length - 1

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0d0d1a' }}>
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b"
        style={{ background: 'rgba(13,13,26,0.95)', borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #22d3ee)' }}>
            <Brain size={18} className="text-white" />
          </div>
          <span className="font-bold gradient-text">AI Interviewer</span>
          <span className="badge-cyan">DSA / Coding</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-muted text-sm">Problem {currentIndex + 1} / {session.num_questions}</span>
          <div className={`flex items-center gap-2 font-mono text-lg font-bold ${timeLeft < 120 ? 'text-red-400' : 'text-white'}`}>
            <Timer size={16} />{formatTime(timeLeft || 0)}
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Problem */}
        <div className="w-2/5 flex flex-col border-r" style={{ borderColor: 'var(--color-border)', background: '#0f0f1a' }}>
          <div className="p-6 flex-1 overflow-y-auto">
            <div className="flex items-center gap-2 mb-4">
              <Code2 size={18} className="text-cyan-400" />
              <span className="text-muted text-sm uppercase tracking-wider">Problem Statement</span>
            </div>
            <p className="font-semibold text-lg mb-4 leading-relaxed">{question.question_text}</p>

            {question.expected_points?.length > 0 && (
              <div className="glass p-4 mt-4">
                <p className="text-xs text-muted uppercase tracking-wider mb-2">Constraints / Hints</p>
                <ul className="space-y-1">
                  {question.expected_points.map((pt, i) => (
                    <li key={i} className="text-sm text-muted flex items-start gap-2">
                      <span className="text-cyan-400 mt-0.5">•</span> {pt}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Evaluation */}
          {evaluation && (
            <div className="p-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
              <div className="glass p-4 border border-purple-500/30 animate-scale-in">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-semibold text-sm flex items-center gap-2">
                    <CheckCircle size={14} className="text-green-400" /> Result
                  </span>
                  <span className="font-bold gradient-text text-xl">{evaluation.score}/10</span>
                </div>
                <p className="text-muted text-xs leading-relaxed">{evaluation.feedback}</p>
              </div>
            </div>
          )}
        </div>

        {/* Right: Editor */}
        <div className="flex-1 flex flex-col">
          {/* Editor toolbar */}
          <div className="flex items-center gap-3 px-4 py-2 border-b"
            style={{ background: '#1a1a2e', borderColor: 'var(--color-border)' }}>
            <div className="flex gap-2">
              {LANGUAGES.map(l => (
                <button key={l.id} id={`lang-${l.id}`}
                  onClick={() => handleLanguageChange(l.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    language === l.id
                      ? 'text-white'
                      : 'text-muted hover:text-white'
                  }`}
                  style={language === l.id ? { background: 'rgba(124,58,237,0.3)', border: '1px solid rgba(124,58,237,0.5)' } : {}}
                >{l.label}</button>
              ))}
            </div>

            {/* Action buttons */}
            <div className="ml-auto flex gap-2">
              {!evaluation ? (
                <button id="submit-code-btn" onClick={handleSubmit}
                  disabled={submitting} className="btn-primary text-sm py-2 px-4">
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  {submitting ? 'Evaluating…' : 'Submit Code'}
                </button>
              ) : (
                <button id="next-problem-btn" onClick={handleNext} className="btn-primary text-sm py-2 px-4">
                  {isLast ? <><CheckCircle size={16} /> Finish</> : <><ChevronRight size={16} /> Next Problem</>}
                </button>
              )}
            </div>
          </div>

          {/* Monaco Editor */}
          <div className="flex-1">
            <Editor
              height="100%"
              language={language}
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
                padding: { top: 16, bottom: 16 },
                renderWhitespace: 'selection',
                cursorBlinking: 'smooth',
                smoothScrolling: true,
                bracketPairColorization: { enabled: true },
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
