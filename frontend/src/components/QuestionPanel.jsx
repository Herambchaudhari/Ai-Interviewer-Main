/**
 * QuestionPanel — displays current interview question with status and AI avatar.
 * Props: { question, questionIndex, totalQuestions, roundType, status }
 * status: 'idle' | 'speaking' | 'listening' | 'processing' | 'evaluating'
 */
import { Mic, Cpu, Users, Code2, Layers, Loader2, Bot } from 'lucide-react'

const ROUND_META = {
  technical:     { label: 'Technical',     Icon: Cpu,    color: '#7c3aed' },
  hr:            { label: 'HR / Behav.',   Icon: Users,  color: '#ec4899' },
  dsa:           { label: 'DSA / Coding',  Icon: Code2,  color: '#06b6d4' },
  system_design: { label: 'System Design', Icon: Layers, color: '#f59e0b' },
}

const STATUS_LABELS = {
  idle:       { text: 'Ready — click Record to answer',  color: 'var(--color-muted)' },
  speaking:   { text: 'AI is speaking the question…',   color: '#a78bfa' },
  listening:  { text: '🔴  Recording your answer…',     color: '#f87171' },
  processing: { text: '⏳  Transcribing audio…',        color: '#fbbf24' },
  evaluating: { text: '🤖  Evaluating your answer…',    color: '#34d399' },
}

export default function QuestionPanel({ question, questionIndex, totalQuestions, roundType, status = 'idle' }) {
  const meta    = ROUND_META[roundType] || ROUND_META.technical
  const statusInfo = STATUS_LABELS[status] || STATUS_LABELS.idle
  const progress   = totalQuestions > 0 ? ((questionIndex) / totalQuestions) * 100 : 0

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* ── Header row ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* AI avatar */}
          <div className="w-9 h-9 rounded-xl flex items-center justify-center relative"
            style={{ background: `${meta.color}22`, border: `1px solid ${meta.color}44` }}>
            <Bot size={18} style={{ color: meta.color }} />
            {status === 'speaking' && (
              <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full animate-ping"
                style={{ background: meta.color }} />
            )}
          </div>
          <div>
            <p className="text-xs text-muted">Question</p>
            <p className="font-bold leading-none">
              {questionIndex + 1}
              <span className="text-muted font-normal text-sm"> / {totalQuestions}</span>
            </p>
          </div>
        </div>

        {/* Round badge */}
        <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full"
          style={{ background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}35` }}>
          <meta.Icon size={12} />{meta.label}
        </span>
      </div>

      {/* ── Progress bar ─────────────────────────────────────────────────── */}
      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${progress}%`,
            background: `linear-gradient(90deg, ${meta.color}, ${meta.color}99)`,
          }}
        />
      </div>

      {/* ── Question text ─────────────────────────────────────────────────── */}
      <div
        className="glass p-5 flex-1"
        style={{ minHeight: '140px', position: 'relative' }}
      >
        {/* Category chip */}
        {question?.category && (
          <span className="inline-block text-xs text-muted border border-current opacity-60 px-2 py-0.5 rounded-md mb-3">
            {question.category}
          </span>
        )}

        <p style={{ fontSize: '18px', lineHeight: '1.7', fontWeight: 500 }}>
          {question?.question_text || question?.text || 'Loading question…'}
        </p>

        {/* For DSA: constraints and examples */}
        {roundType === 'dsa' && question?.expected_points?.length > 0 && (
          <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Key Points to Cover</p>
            <ul className="space-y-1">
              {question.expected_points.map((pt, i) => (
                <li key={i} className="text-sm text-muted flex items-start gap-2">
                  <span style={{ color: meta.color }} className="mt-0.5 flex-shrink-0">▸</span>
                  {pt}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── Status bar ───────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)' }}
      >
        {(status === 'processing' || status === 'evaluating') && (
          <Loader2 size={14} className="animate-spin flex-shrink-0" style={{ color: statusInfo.color }} />
        )}
        {status === 'listening' && (
          <div className="flex items-end gap-0.5 flex-shrink-0 h-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="waveform-bar" style={{ height: `${8 + (i % 3) * 4}px`, animationDelay: `${i * 0.1}s` }} />
            ))}
          </div>
        )}
        {status === 'speaking' && (
          <Mic size={14} className="flex-shrink-0" style={{ color: statusInfo.color }} />
        )}
        <p style={{ color: statusInfo.color }} className="transition-all duration-300">
          {statusInfo.text}
        </p>
      </div>
    </div>
  )
}
