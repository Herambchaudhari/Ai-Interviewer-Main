/**
 * DSATestResults — bottom-pane test runner output (LeetCode-style).
 * Shows per-test status, runtime, expected vs actual diff for sample tests,
 * and a header summary (X / Y passed).
 */
import { useState } from 'react'
import { CheckCircle2, XCircle, Clock, ChevronDown, ChevronRight, Lock } from 'lucide-react'

const STATUS_LABELS = {
  accepted:             'Accepted',
  wrong_answer:         'Wrong Answer',
  time_limit_exceeded:  'Time Limit Exceeded',
  compilation_error:    'Compilation Error',
  runtime_error:        'Runtime Error',
  internal_error:       'Internal Error',
  config_error:         'Configuration Error',
  judge0_error:         'Judge Error',
}

export default function DSATestResults({ runState, results, summary, mode = 'run' }) {
  // runState: 'idle' | 'running' | 'done' | 'error'

  if (runState === 'idle') {
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--color-text-muted, #64748b)', fontSize: 13, padding: 24, textAlign: 'center',
      }}>
        <div>
          <p style={{ margin: 0, fontWeight: 600, color: 'var(--color-text)' }}>No tests run yet</p>
          <p style={{ margin: '6px 0 0', fontSize: 12 }}>
            Click <strong>Run</strong> to test your code on the sample tests, or <strong>Submit</strong> to run all hidden tests.
          </p>
        </div>
      </div>
    )
  }

  if (runState === 'running') {
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 10,
      }}>
        <div className="animate-pulse" style={{ fontSize: 13, color: 'var(--color-text-muted, #64748b)' }}>
          {mode === 'submit' ? 'Running all tests on Judge0…' : 'Executing on Judge0…'}
        </div>
        <div style={{
          width: 160, height: 4, borderRadius: 2,
          background: 'var(--color-border)', overflow: 'hidden', position: 'relative',
        }}>
          <div style={{
            position: 'absolute', inset: 0, width: '40%',
            background: 'linear-gradient(90deg, transparent, #7c3aed, transparent)',
            animation: 'sweep 1.4s ease-in-out infinite',
          }} />
        </div>
        <style>{`@keyframes sweep { 0% { transform: translateX(-100%);} 100% { transform: translateX(400%);} }`}</style>
      </div>
    )
  }

  const passed = summary?.tests_passed ?? results?.filter(r => r.passed).length ?? 0
  const total  = summary?.tests_total  ?? results?.length ?? 0
  const allPassed = passed === total && total > 0

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '12px 16px' }}>
      {/* Header summary */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderRadius: 8, marginBottom: 12,
        background: allPassed ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.08)',
        border: `1px solid ${allPassed ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.25)'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {allPassed
            ? <CheckCircle2 size={18} style={{ color: '#16a34a' }} />
            : <XCircle      size={18} style={{ color: '#dc2626' }} />}
          <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>
            {allPassed ? 'All tests passed' : `${total - passed} test${total - passed === 1 ? '' : 's'} failed`}
          </span>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted, #64748b)' }}>
          {passed} / {total} passed
        </span>
      </div>

      {/* Per-test rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(results || []).map((r, i) => <TestRow key={i} result={r} index={i} />)}
      </div>
    </div>
  )
}

function TestRow({ result, index }) {
  const [open, setOpen] = useState(!result.passed && index < 2)
  const isHidden = result.kind === 'hidden'
  const statusLabel = STATUS_LABELS[result.status] || result.status

  return (
    <div style={{
      borderRadius: 8,
      border: '1px solid var(--color-border)',
      background: 'var(--color-surface)',
      overflow: 'hidden',
    }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer',
        color: 'var(--color-text)', fontSize: 13,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {result.passed
            ? <CheckCircle2 size={15} style={{ color: '#16a34a' }} />
            : <XCircle      size={15} style={{ color: '#dc2626' }} />}
          <span style={{ fontWeight: 500 }}>
            Test {index + 1}{isHidden ? ' (hidden)' : ''}
          </span>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted, #64748b)' }}>
            {statusLabel}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--color-text-muted, #64748b)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Clock size={11} />{result.runtime_ms} ms
          </span>
          {isHidden && <Lock size={11} />}
        </div>
      </button>

      {open && (
        <div style={{
          padding: '10px 14px 12px 36px',
          borderTop: '1px solid var(--color-border)',
          background: 'var(--color-surface-2, rgba(0,0,0,0.02))',
          fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
        }}>
          {result.error && (
            <Field label="Error" value={result.error} color="#dc2626" />
          )}
          {!isHidden && (
            <>
              <Field label="Stdout"   value={result.stdout || '(empty)'} />
              <Field label="Expected" value={result.expected || '(none)'} />
            </>
          )}
          {isHidden && (
            <>
              <Field label="Your output" value={result.stdout || '(no output captured for hidden test)'} />
              <p style={{ margin: '6px 0 0', fontStyle: 'italic', color: 'var(--color-text-muted, #94a3b8)' }}>
                Hidden test inputs/outputs aren't shown.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, value, color }) {
  return (
    <div style={{ marginTop: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted, #64748b)', display: 'block', marginBottom: 2 }}>
        {label}
      </span>
      <div style={{
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        color: color || 'var(--color-text)',
      }}>
        {value}
      </div>
    </div>
  )
}
