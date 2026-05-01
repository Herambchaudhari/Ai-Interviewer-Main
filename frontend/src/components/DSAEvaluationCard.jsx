/**
 * DSAEvaluationCard — surfaces the LLM verdict after Submit:
 * complexity, code quality, strengths, improvements, bugs.
 */
import { Sparkles, Cpu, MemoryStick, Award, AlertCircle, ThumbsUp, Wrench } from 'lucide-react'

const VERDICT_PALETTE = {
  excellent:    { bg: 'rgba(34,197,94,0.12)',  fg: '#15803d', label: 'Excellent' },
  strong:       { bg: 'rgba(34,197,94,0.10)',  fg: '#16a34a', label: 'Strong' },
  acceptable:   { bg: 'rgba(234,179,8,0.12)',  fg: '#a16207', label: 'Acceptable' },
  needs_work:   { bg: 'rgba(249,115,22,0.12)', fg: '#c2410c', label: 'Needs Work' },
  incorrect:    { bg: 'rgba(239,68,68,0.12)',  fg: '#dc2626', label: 'Incorrect' },
}

export default function DSAEvaluationCard({ evaluation }) {
  if (!evaluation) return null
  const v = VERDICT_PALETTE[evaluation.verdict] || VERDICT_PALETTE.acceptable

  return (
    <div style={{
      borderRadius: 12,
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      padding: 18,
      boxShadow: 'var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.04))',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={16} style={{ color: '#7c3aed' }} />
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em',
            textTransform: 'uppercase', color: 'var(--color-text-muted, #64748b)' }}>
            AI Evaluation
          </span>
        </div>
        <span style={{
          padding: '4px 12px', borderRadius: 999,
          background: v.bg, color: v.fg, fontSize: 12, fontWeight: 700,
        }}>
          {v.label}
        </span>
      </div>

      {/* Score grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10,
        marginBottom: 14,
      }}>
        <Stat label="Correctness" value={`${evaluation.correctness_score}/10`} accent="#16a34a" />
        <Stat label="Code Quality" value={`${evaluation.code_quality_score}/10`} />
        <Stat label="Readability"  value={`${evaluation.readability_score}/10`} />
        <Stat label="Edge Cases"   value={`${evaluation.edge_cases_handled}/10`} />
      </div>

      {/* Complexity row */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14,
      }}>
        <ComplexityBox icon={<Cpu size={13} />} label="Time Complexity" value={evaluation.time_complexity} match={evaluation.tc_match_expected} />
        <ComplexityBox icon={<MemoryStick size={13} />} label="Space Complexity" value={evaluation.space_complexity} />
      </div>

      {/* Approach summary */}
      {evaluation.approach_summary && (
        <div style={{
          padding: 12, borderRadius: 8,
          background: 'var(--color-surface-2, rgba(124,58,237,0.04))',
          border: '1px solid var(--color-border)',
          marginBottom: 14,
          fontSize: 13, color: 'var(--color-text)', lineHeight: 1.6,
        }}>
          <span style={{ fontWeight: 600, color: 'var(--color-text-muted, #64748b)', fontSize: 11,
            textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>
            Approach
          </span>
          {evaluation.approach_summary}
        </div>
      )}

      <BulletList icon={<ThumbsUp size={13} />} label="Strengths"
        items={evaluation.strengths} color="#16a34a" />
      <BulletList icon={<Wrench size={13} />} label="Improvements"
        items={evaluation.improvements} color="#ca8a04" />
      <BulletList icon={<AlertCircle size={13} />} label="Bugs / Smells"
        items={evaluation.bugs_or_smells} color="#dc2626" />

      {/* Run stats footer */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', gap: 8,
        padding: '10px 12px', marginTop: 12, borderRadius: 8,
        background: 'var(--color-surface-2, rgba(0,0,0,0.025))',
        fontSize: 11, color: 'var(--color-text-muted, #64748b)',
      }}>
        <span>{evaluation.tests_passed}/{evaluation.tests_total} tests</span>
        <span>{evaluation.avg_runtime_ms} ms avg</span>
        <span>{(evaluation.avg_memory_kb / 1024).toFixed(1)} MB avg</span>
      </div>
    </div>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8,
      background: 'var(--color-surface-2, rgba(0,0,0,0.025))',
      border: '1px solid var(--color-border)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
        textTransform: 'uppercase', color: 'var(--color-text-muted, #64748b)' }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent || 'var(--color-text)', marginTop: 2 }}>
        {value}
      </div>
    </div>
  )
}

function ComplexityBox({ icon, label, value, match }) {
  return (
    <div style={{
      padding: 10, borderRadius: 8,
      background: 'var(--color-surface-2, rgba(124,58,237,0.04))',
      border: '1px solid var(--color-border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700,
        letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-muted, #64748b)' }}>
        {icon}{label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, color: 'var(--color-text)' }}>
          {value || '—'}
        </span>
        {match === true && (
          <span style={{ fontSize: 10, color: '#16a34a' }}>✓ optimal</span>
        )}
        {match === false && (
          <span style={{ fontSize: 10, color: '#ca8a04' }}>can be optimized</span>
        )}
      </div>
    </div>
  )
}

function BulletList({ icon, label, items, color }) {
  if (!items || items.length === 0) return null
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
        fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
        color: color || 'var(--color-text-muted)' }}>
        {icon}{label}
      </div>
      <ul style={{ margin: 0, paddingLeft: 22, listStyle: 'disc' }}>
        {items.map((item, i) => (
          <li key={i} style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--color-text)', marginTop: 2 }}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}
