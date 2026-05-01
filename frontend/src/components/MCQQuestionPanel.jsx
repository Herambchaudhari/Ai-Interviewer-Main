import { CheckCircle2, XCircle, Clock3, Lightbulb, BookOpen } from 'lucide-react'

function formatSeconds(seconds) {
  const safe = Math.max(0, Number(seconds) || 0)
  const mins = Math.floor(safe / 60)
  const secs = safe % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

const DIFF_STYLE = {
  easy:   { bg: 'rgba(74,222,128,0.10)',  border: 'rgba(74,222,128,0.28)',  color: '#86efac' },
  medium: { bg: 'rgba(250,204,21,0.10)',  border: 'rgba(250,204,21,0.28)',  color: '#fde68a' },
  hard:   { bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.28)', color: '#fca5a5' },
}

/**
 * MCQQuestionPanel — professional two-column layout for MCQ practice.
 *
 * Desktop: left = question + metadata | right = options + reveal
 * Mobile:  stacked vertically
 *
 * Props:
 *   question            – current question object
 *   questionIndex       – 0-based index
 *   totalQuestions      – total questions in session
 *   selectedOptionIndex – null or index of chosen option
 *   onSelect            – (index, optionText) => void
 *   disabled            – lock options (while evaluating or after reveal)
 *   status              – 'idle' | 'evaluating'
 *   timeLeft            – seconds remaining
 *   reveal              – null | { isCorrect, correctIndex, explanation }
 *   correctCount        – running correct answers count
 */
export default function MCQQuestionPanel({
  question,
  questionIndex,
  totalQuestions,
  selectedOptionIndex,
  onSelect,
  disabled = false,
  status = 'idle',
  timeLeft = 0,
  reveal = null,
  correctCount = 0,
}) {
  const options  = question?.options || []
  const diff     = question?.difficulty || 'medium'
  const diffStyle = DIFF_STYLE[diff] || DIFF_STYLE.medium
  const progress = totalQuestions > 0 ? ((questionIndex + 1) / totalQuestions) * 100 : 0
  const timeColor = timeLeft <= 15 ? '#f87171' : timeLeft <= 30 ? '#facc15' : '#4ade80'

  const optionStyle = (index) => {
    if (reveal) {
      if (index === reveal.correctIndex)
        return { border: '1.5px solid rgba(74,222,128,0.7)', background: 'rgba(74,222,128,0.10)', color: '#4ade80' }
      if (index === selectedOptionIndex && !reveal.isCorrect)
        return { border: '1.5px solid rgba(248,113,113,0.6)', background: 'rgba(248,113,113,0.10)', color: '#fca5a5' }
      return { border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)', color: 'var(--color-muted)', opacity: 0.5 }
    }
    if (selectedOptionIndex === index)
      return { border: '1.5px solid rgba(245,158,11,0.6)', background: 'rgba(245,158,11,0.10)', color: '#fbbf24' }
    return { border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', color: 'var(--color-text)' }
  }

  const optionIcon = (index) => {
    const label = String.fromCharCode(65 + index)
    if (reveal) {
      if (index === reveal.correctIndex)   return <CheckCircle2 size={15} style={{ color: '#4ade80' }} />
      if (index === selectedOptionIndex && !reveal.isCorrect) return <XCircle size={15} style={{ color: '#f87171' }} />
    }
    if (selectedOptionIndex === index)     return <CheckCircle2 size={15} style={{ color: '#fbbf24' }} />
    return <span className="text-xs font-bold">{label}</span>
  }

  return (
    <div className="flex flex-col gap-5 w-full max-w-5xl mx-auto">

      {/* ── Top bar: progress + meta ─────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        {/* Question count + score + timer row */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold tabular-nums" style={{ color: '#f59e0b' }}>
              {questionIndex + 1}
              <span className="text-base font-normal text-muted"> / {totalQuestions}</span>
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              {question?.topic && (
                <span className="text-xs font-medium px-2.5 py-1 rounded-full"
                  style={{ background: 'rgba(245,158,11,0.10)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.25)' }}>
                  {question.topic}
                </span>
              )}
              {diff && (
                <span className="text-xs font-medium px-2.5 py-1 rounded-full"
                  style={{ background: diffStyle.bg, color: diffStyle.color, border: `1px solid ${diffStyle.border}` }}>
                  {diff.charAt(0).toUpperCase() + diff.slice(1)}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Running score */}
            <div className="flex items-center gap-1.5 text-sm"
              style={{ color: correctCount > 0 ? '#4ade80' : 'var(--color-muted)' }}>
              <CheckCircle2 size={14} />
              <span className="font-semibold tabular-nums">{correctCount}</span>
              <span className="text-muted font-normal">correct</span>
            </div>

            {/* Timer — hide when revealed */}
            {!reveal && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono font-bold text-sm"
                style={{
                  background: `${timeColor}12`,
                  border: `1px solid ${timeColor}30`,
                  color: timeColor,
                }}>
                <Clock3 size={13} />
                {formatSeconds(timeLeft)}
              </div>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${progress}%`,
              background: reveal
                ? reveal.isCorrect ? 'linear-gradient(90deg,#4ade80,#22c55e)' : 'linear-gradient(90deg,#f59e0b,#f87171)'
                : 'linear-gradient(90deg,#f59e0b,#fb923c)',
            }}
          />
        </div>
      </div>

      {/* ── Two-column body ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

        {/* LEFT — Question text + reveal card */}
        <div className="flex flex-col gap-4">
          <div className="glass rounded-2xl p-7"
            style={{ border: '1px solid rgba(245,158,11,0.18)', minHeight: '180px' }}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: 'rgba(245,158,11,0.16)', border: '1px solid rgba(245,158,11,0.3)' }}>
                <BookOpen size={15} style={{ color: '#f59e0b' }} />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mt-2">Question</p>
            </div>
            <p className="text-lg leading-relaxed font-medium" style={{ lineHeight: '1.75' }}>
              {question?.question_text || 'Loading question…'}
            </p>
          </div>

          {/* Reveal feedback card */}
          {reveal && (
            <div className="rounded-2xl p-5 border"
              style={{
                background: reveal.isCorrect ? 'rgba(74,222,128,0.07)' : 'rgba(248,113,113,0.07)',
                borderColor: reveal.isCorrect ? 'rgba(74,222,128,0.35)' : 'rgba(248,113,113,0.35)',
              }}>
              <div className="flex items-center gap-2 mb-3">
                {reveal.isCorrect
                  ? <CheckCircle2 size={18} style={{ color: '#4ade80' }} />
                  : <XCircle size={18} style={{ color: '#f87171' }} />}
                <span className="font-bold" style={{ color: reveal.isCorrect ? '#4ade80' : '#f87171' }}>
                  {reveal.isCorrect ? 'Correct!' : 'Incorrect'}
                </span>
                {!reveal.isCorrect && (
                  <span className="text-xs text-muted ml-1">
                    · Correct: <strong style={{ color: '#4ade80' }}>{String.fromCharCode(65 + reveal.correctIndex)}</strong>
                  </span>
                )}
              </div>
              {reveal.explanation && (
                <div className="flex items-start gap-2">
                  <Lightbulb size={13} className="text-amber-300 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-muted leading-relaxed">{reveal.explanation}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT — Options */}
        <div className="flex flex-col gap-3">
          {options.map((option, index) => {
            const style = optionStyle(index)
            return (
              <button
                key={`${index}-${option}`}
                onClick={() => onSelect?.(index, option)}
                disabled={disabled || !!reveal}
                className="w-full rounded-2xl p-4 text-left transition-all duration-200"
                style={{
                  ...style,
                  cursor: disabled || reveal ? 'default' : 'pointer',
                }}
              >
                <div className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{
                      background: reveal
                        ? index === reveal.correctIndex ? 'rgba(74,222,128,0.18)'
                          : index === selectedOptionIndex && !reveal.isCorrect ? 'rgba(248,113,113,0.18)'
                          : 'rgba(255,255,255,0.05)'
                        : selectedOptionIndex === index ? 'rgba(245,158,11,0.18)' : 'rgba(255,255,255,0.07)',
                      color: style.color,
                    }}>
                    {optionIcon(index)}
                  </div>
                  <span className="text-sm leading-relaxed" style={{ color: style.color }}>
                    {option}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
