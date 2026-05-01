/**
 * DSAProblemPanel — left pane of the coding interface.
 * Renders problem statement, examples, constraints, topics, and sample tests.
 * Theme-aware via var(--color-*) tokens.
 */
import { Code2, ListChecks, FileText, Hash } from 'lucide-react'

const DIFFICULTY_COLORS = {
  easy:   { bg: 'rgba(34,197,94,0.12)',  fg: '#16a34a', border: 'rgba(34,197,94,0.3)' },
  medium: { bg: 'rgba(234,179,8,0.12)',  fg: '#ca8a04', border: 'rgba(234,179,8,0.3)' },
  hard:   { bg: 'rgba(239,68,68,0.12)',  fg: '#dc2626', border: 'rgba(239,68,68,0.3)' },
}

// Tiny inline markdown renderer — handles **bold**, `code`, line breaks.
function renderInline(text) {
  if (!text) return null
  const parts = []
  let remaining = text
  let key = 0
  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*([^*]+)\*\*/)
    const codeMatch = remaining.match(/`([^`]+)`/)
    const next = [boldMatch, codeMatch].filter(Boolean).sort((a, b) => a.index - b.index)[0]
    if (!next) {
      parts.push(<span key={key++}>{remaining}</span>)
      break
    }
    if (next.index > 0) parts.push(<span key={key++}>{remaining.slice(0, next.index)}</span>)
    if (next === boldMatch) {
      parts.push(<strong key={key++} style={{ color: 'var(--color-text)' }}>{next[1]}</strong>)
    } else {
      parts.push(
        <code key={key++} style={{
          background: 'var(--color-surface-2, rgba(124,58,237,0.08))',
          padding: '1px 6px', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.9em', color: '#7c3aed', border: '1px solid var(--color-border)',
        }}>{next[1]}</code>
      )
    }
    remaining = remaining.slice(next.index + next[0].length)
  }
  return parts
}

function MarkdownBlock({ md }) {
  if (!md) return null
  const blocks = md.split(/\n\n+/)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n')
        const isList = lines.every(l => l.trim().startsWith('- ') || l.trim().startsWith('* ') || l.trim() === '')
        if (isList && lines.some(l => l.trim().startsWith('-') || l.trim().startsWith('*'))) {
          return (
            <ul key={bi} style={{ margin: 0, paddingLeft: 22, listStyle: 'disc', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {lines.filter(l => l.trim()).map((l, li) => (
                <li key={li} style={{ color: 'var(--color-text-muted, #64748b)', lineHeight: 1.6 }}>
                  {renderInline(l.replace(/^[\s-*]+/, ''))}
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={bi} style={{ margin: 0, color: 'var(--color-text)', lineHeight: 1.7 }}>
            {renderInline(block)}
          </p>
        )
      })}
    </div>
  )
}

export default function DSAProblemPanel({ problem, problemIndex, totalProblems }) {
  if (!problem) return null
  const diff = (problem.difficulty || 'easy').toLowerCase()
  const palette = DIFFICULTY_COLORS[diff] || DIFFICULTY_COLORS.easy

  return (
    <div style={{
      height: '100%', overflowY: 'auto',
      padding: '24px 28px',
      background: 'var(--color-surface)',
      color: 'var(--color-text)',
    }}>
      {/* Header: title + difficulty + topic chips */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: 'var(--color-text-muted, #64748b)' }}>
          <Code2 size={14} />
          <span>Problem {problemIndex + 1}{totalProblems ? ` of ${totalProblems}` : ''}</span>
        </div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--color-text)' }}>
          {problem.title}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 999,
            background: palette.bg, color: palette.fg,
            border: `1px solid ${palette.border}`,
            fontSize: 12, fontWeight: 600, textTransform: 'capitalize',
          }}>
            {diff}
          </span>
          {(problem.topics || []).map(t => (
            <span key={t} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 999,
              background: 'var(--color-surface-2, rgba(124,58,237,0.06))',
              color: 'var(--color-text-muted, #64748b)',
              border: '1px solid var(--color-border)',
              fontSize: 11,
            }}>
              <Hash size={10} />{t}
            </span>
          ))}
        </div>
      </div>

      {/* Statement */}
      <Section icon={<FileText size={14} />} label="Description">
        <MarkdownBlock md={problem.statement_md} />
      </Section>

      {/* Examples */}
      {(problem.examples || []).length > 0 && (
        <Section icon={<ListChecks size={14} />} label="Examples">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(problem.examples || []).map((ex, i) => (
              <div key={i} style={{
                padding: 14, borderRadius: 10,
                background: 'var(--color-surface-2, rgba(124,58,237,0.04))',
                border: '1px solid var(--color-border)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
                  textTransform: 'uppercase', color: 'var(--color-text-muted, #94a3b8)', marginBottom: 8 }}>
                  Example {i + 1}
                </div>
                <Row label="Input"  value={ex.input}  mono />
                <Row label="Output" value={ex.output} mono />
                {ex.explanation && <Row label="Explanation" value={ex.explanation} />}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Constraints */}
      {problem.constraints_md && (
        <Section label="Constraints">
          <MarkdownBlock md={problem.constraints_md} />
        </Section>
      )}
    </div>
  )
}

function Section({ icon, label, children }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
        fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
        color: 'var(--color-text-muted, #64748b)',
      }}>
        {icon}<span>{label}</span>
      </div>
      {children}
    </section>
  )
}

function Row({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'baseline' }}>
      <span style={{ minWidth: 90, fontSize: 12, color: 'var(--color-text-muted, #64748b)', fontWeight: 600 }}>
        {label}:
      </span>
      <span style={{
        fontSize: 13, color: 'var(--color-text)',
        fontFamily: mono ? "'JetBrains Mono', monospace" : 'inherit',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {value}
      </span>
    </div>
  )
}
