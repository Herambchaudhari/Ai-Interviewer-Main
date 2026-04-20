import React from 'react'

/**
 * Shown in place of a report section that failed to generate.
 * Displays an amber warning card with a "Regenerate Section" button.
 */
export default function SectionRetryCard({ sectionLabel, onRetry, isRetrying, retrySuccess }) {
  if (retrySuccess) {
    return (
      <div style={{
        padding: '12px 16px',
        borderRadius: 8,
        background: 'rgba(16,185,129,0.1)',
        border: '1px solid rgba(16,185,129,0.3)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 14,
        color: '#10b981',
      }}>
        <span>✓</span>
        <span>{sectionLabel} successfully regenerated.</span>
      </div>
    )
  }

  return (
    <div style={{
      padding: '16px 20px',
      borderRadius: 8,
      background: 'rgba(245,158,11,0.08)',
      border: '1px solid rgba(245,158,11,0.3)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 18 }}>⚠</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#f59e0b' }}>
            {sectionLabel} unavailable
          </div>
          <div style={{ fontSize: 13, color: 'rgba(245,158,11,0.8)', marginTop: 2 }}>
            Our AI service was temporarily unavailable when this section was generated.
          </div>
        </div>
      </div>
      <button
        onClick={onRetry}
        disabled={isRetrying}
        style={{
          flexShrink: 0,
          padding: '7px 16px',
          borderRadius: 6,
          border: '1px solid rgba(245,158,11,0.5)',
          background: isRetrying ? 'rgba(245,158,11,0.05)' : 'rgba(245,158,11,0.15)',
          color: '#f59e0b',
          fontSize: 13,
          fontWeight: 600,
          cursor: isRetrying ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          transition: 'background 0.15s',
        }}
      >
        {isRetrying ? (
          <>
            <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>↻</span>
            Regenerating…
          </>
        ) : (
          'Regenerate Section'
        )}
      </button>
    </div>
  )
}
