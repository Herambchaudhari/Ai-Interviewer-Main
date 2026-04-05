/**
 * DSAQuestionPanel — displays a coding/DSA question with examples,
 * constraints, difficulty badge, and a togglable hint after 10 minutes.
 *
 * Props:
 *   question    {object}  - question object from session
 *   timeElapsed {number}  - seconds elapsed since question loaded (for hint reveal)
 *   difficulty  {string}  - 'Easy' | 'Medium' | 'Hard'
 */
import { useState } from 'react'
import { Lightbulb, ChevronDown, ChevronUp, Tag, Clock } from 'lucide-react'

const DIFF_COLORS = {
  Easy:   { bg: 'rgba(74,222,128,0.12)',  text: '#4ade80',  border: 'rgba(74,222,128,0.3)'  },
  Medium: { bg: 'rgba(250,204,21,0.12)',  text: '#facc15',  border: 'rgba(250,204,21,0.3)'  },
  Hard:   { bg: 'rgba(248,113,113,0.12)', text: '#f87171',  border: 'rgba(248,113,113,0.3)' },
}

export default function DSAQuestionPanel({ question = {}, timeElapsed = 0, difficulty = 'Medium' }) {
  const [showHint, setShowHint] = useState(false)
  const hintUnlocked = timeElapsed >= 600   // 10 minutes

  const diff   = question.difficulty || difficulty
  const colors = DIFF_COLORS[diff] || DIFF_COLORS.Medium

  const title       = question.title       || question.question_text || 'Question'
  const description = question.description || question.question_text || ''
  const examples    = question.examples    || []
  const constraints = question.constraints || []
  const topic       = question.topic       || question.category      || ''
  const hint        = question.hint        || ''
  const time_limit  = question.time_limit_mins || 15

  return (
    <div className="h-full overflow-y-auto space-y-4 pr-1">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-start gap-2 flex-wrap mb-2">
          {/* Difficulty badge */}
          <span className="text-xs font-bold px-2.5 py-1 rounded-lg flex-shrink-0"
            style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}>
            {diff}
          </span>
          {topic && (
            <span className="text-xs px-2.5 py-1 rounded-lg flex-shrink-0 flex items-center gap-1"
              style={{ background: 'rgba(124,58,237,0.12)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.25)' }}>
              <Tag size={10} /> {topic}
            </span>
          )}
          <span className="text-xs px-2.5 py-1 rounded-lg flex-shrink-0 flex items-center gap-1 ml-auto"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
            <Clock size={10} /> {time_limit} min
          </span>
        </div>
        <h2 className="text-lg font-bold leading-snug">{title}</h2>
      </div>

      {/* ── Description ────────────────────────────────────────────────── */}
      <div className="text-sm leading-relaxed space-y-2" style={{ color: 'var(--color-text)' }}>
        {description.split('\n').filter(Boolean).map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>

      {/* ── Examples ───────────────────────────────────────────────────── */}
      {examples.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider">Examples</p>
          {examples.map((ex, i) => (
            <div key={i} className="rounded-xl p-3 text-xs font-mono"
              style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid var(--color-border)' }}>
              <p><span className="text-cyan-400 font-semibold">Input:</span>  {ex.input}</p>
              <p><span className="text-green-400 font-semibold">Output:</span> {ex.output}</p>
              {ex.explanation && (
                <p className="mt-1 not-italic" style={{ color: 'var(--color-muted)' }}>
                  <span className="text-purple-400 font-semibold">Explanation:</span> {ex.explanation}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Constraints ────────────────────────────────────────────────── */}
      {constraints.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Constraints</p>
          <ul className="space-y-1">
            {constraints.map((c, i) => (
              <li key={i} className="text-xs font-mono flex items-start gap-1.5"
                style={{ color: 'var(--color-muted)' }}>
                <span className="text-purple-400 mt-px">•</span> {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Hint (unlocks after 10 min) ─────────────────────────────────── */}
      {hint && (
        <div className="rounded-xl overflow-hidden"
          style={{ border: `1px solid ${hintUnlocked ? 'rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.08)'}` }}>
          <button
            id="hint-toggle-btn"
            onClick={() => hintUnlocked && setShowHint(h => !h)}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all"
            style={{
              background: hintUnlocked ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.03)',
              color:      hintUnlocked ? '#fbbf24' : 'var(--color-muted)',
              cursor:     hintUnlocked ? 'pointer' : 'not-allowed',
            }}
          >
            <Lightbulb size={14} />
            {hintUnlocked
              ? (showHint ? 'Hide Hint' : '💡 Show Hint')
              : `Hint unlocks after 10 minutes (${Math.max(0, Math.ceil((600 - timeElapsed) / 60))} min remaining)`}
            {hintUnlocked && (showHint ? <ChevronUp size={13} className="ml-auto" /> : <ChevronDown size={13} className="ml-auto" />)}
          </button>
          {showHint && hintUnlocked && (
            <div className="px-4 py-3 text-sm animate-scale-in"
              style={{ color: '#fde68a', borderTop: '1px solid rgba(245,158,11,0.2)' }}>
              {hint}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
