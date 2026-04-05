import { CheckCircle2, Clock3, Building2, ListChecks, Loader2 } from 'lucide-react'

function formatSeconds(seconds) {
  const safe = Math.max(0, Number(seconds) || 0)
  const mins = Math.floor(safe / 60)
  const secs = safe % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export default function MCQQuestionPanel({
  question,
  questionIndex,
  totalQuestions,
  selectedOptionIndex,
  onSelect,
  disabled = false,
  status = 'idle',
  timeLeft = 0,
}) {
  const progress = totalQuestions > 0 ? ((questionIndex + 1) / totalQuestions) * 100 : 0
  const options = question?.options || []
  const timeColor = timeLeft <= 15 ? '#f87171' : timeLeft <= 30 ? '#facc15' : '#f59e0b'

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(245,158,11,0.16)', border: '1px solid rgba(245,158,11,0.3)' }}
          >
            <ListChecks size={18} style={{ color: '#f59e0b' }} />
          </div>
          <div>
            <p className="text-xs text-muted">Company MCQ Practice</p>
            <p className="font-bold leading-none">
              {questionIndex + 1}
              <span className="text-muted font-normal text-sm"> / {totalQuestions}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {question?.source_signal && (
            <span
              className="text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(34,211,238,0.12)', color: '#22d3ee', border: '1px solid rgba(34,211,238,0.22)' }}
            >
              <Building2 size={12} className="inline mr-1" />
              Company-calibrated
            </span>
          )}
          <span
            className="text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ background: `${timeColor}18`, color: timeColor, border: `1px solid ${timeColor}33` }}
          >
            <Clock3 size={12} className="inline mr-1" />
            {formatSeconds(timeLeft)}
          </span>
        </div>
      </div>

      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${progress}%`,
            background: 'linear-gradient(90deg, #f59e0b, #fb7185)',
          }}
        />
      </div>

      <div className="glass p-5">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {question?.category && (
            <span className="inline-block text-xs text-muted border border-current opacity-60 px-2 py-0.5 rounded-md">
              {question.category}
            </span>
          )}
          <span
            className="inline-block text-xs px-2 py-0.5 rounded-md"
            style={{ background: 'rgba(245,158,11,0.1)', color: '#fbbf24' }}
          >
            Single correct answer
          </span>
        </div>

        <p style={{ fontSize: '18px', lineHeight: '1.7', fontWeight: 500 }}>
          {question?.question_text || 'Loading question...'}
        </p>
      </div>

      <div className="grid gap-3">
        {options.map((option, index) => {
          const isSelected = selectedOptionIndex === index
          const optionLabel = String.fromCharCode(65 + index)
          return (
            <button
              key={`${optionLabel}-${option}`}
              onClick={() => onSelect?.(index, option)}
              disabled={disabled}
              className="glass p-4 rounded-2xl text-left transition-all duration-200 border"
              style={{
                borderColor: isSelected ? 'rgba(245,158,11,0.45)' : 'rgba(255,255,255,0.08)',
                background: isSelected ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.03)',
                boxShadow: isSelected ? '0 0 18px rgba(245,158,11,0.16)' : 'none',
                opacity: disabled && !isSelected ? 0.82 : 1,
              }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{
                    background: isSelected ? 'rgba(245,158,11,0.18)' : 'rgba(255,255,255,0.06)',
                    color: isSelected ? '#fbbf24' : 'var(--color-muted)',
                  }}
                >
                  {isSelected ? <CheckCircle2 size={16} /> : optionLabel}
                </div>
                <div className="flex-1">
                  <p className="text-sm leading-relaxed">{option}</p>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)' }}
      >
        {status === 'evaluating' && <Loader2 size={14} className="animate-spin text-amber-300" />}
        <p style={{ color: status === 'evaluating' ? '#fbbf24' : 'var(--color-muted)' }}>
          {status === 'evaluating'
            ? 'Checking your answer and preparing the next company-style question...'
            : 'Choose the best answer before the question timer expires.'}
        </p>
      </div>
    </div>
  )
}
