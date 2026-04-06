import { AlertTriangle, Shield } from 'lucide-react'

const FLAG_LABELS = {
  camera_blocked: 'Camera blocked',
  multiple_faces: 'Multiple faces',
  phone_detected: 'Phone detected',
  looking_away: 'Looking away',
  poor_posture: 'Posture drift',
}

function statusColor(status) {
  if (status === 'clear') return '#4ade80'
  if (status === 'alert') return '#f87171'
  if (status === 'loading') return '#a78bfa'
  return '#94a3b8'
}

export default function InterviewIntegrityPanel({
  modelState,
  modelError,
  liveFlags = [],
  summary = {},
  compact = false,
}) {
  const counts = summary.counts || {}
  const attention = Math.round(summary.average_attention_score || 0)
  const liveAlertCount = liveFlags.length

  return (
    <div
      className={`glass border rounded-2xl ${compact ? 'p-3' : 'p-4'}`}
      style={{ borderColor: 'rgba(124,58,237,0.22)', background: 'rgba(15, 16, 30, 0.82)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-muted mb-1">Interview Integrity</p>
          <h3 className="font-semibold flex items-center gap-2">
            <Shield size={16} style={{ color: statusColor(summary.monitoring_status) }} />
            {modelState === 'ready' ? 'Camera monitoring active' : modelState === 'error' ? 'Monitoring unavailable' : 'Preparing monitor'}
          </h3>
        </div>
        {liveAlertCount > 0 && (
          <span
            className="text-xs px-2.5 py-1 rounded-full font-semibold"
            style={{ background: 'rgba(248,113,113,0.12)', color: '#fca5a5' }}
          >
            {liveAlertCount} live alert{liveAlertCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div
        className={`mt-3 rounded-xl ${compact ? 'px-3 py-2.5' : 'px-4 py-3'}`}
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted uppercase tracking-[0.22em]">Attention</p>
          <p
            className="font-bold text-lg"
            style={{ color: attention >= 80 ? '#4ade80' : attention >= 60 ? '#facc15' : '#f87171' }}
          >
            {attention}%
          </p>
        </div>
        <p className="text-xs text-muted mt-1">
          Live alerts stay visible on the camera feed and are included in the final report.
        </p>
      </div>

      {modelError && (
        <div
          className="rounded-xl p-3 text-sm mt-3"
          style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.22)', color: '#fecaca' }}
        >
          {modelError}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-3">
        {Object.entries(FLAG_LABELS).map(([key, label]) => {
          const active = liveFlags.includes(key)
          const count = counts[key] || 0
          return (
            <span
              key={key}
              className="text-xs px-2.5 py-1 rounded-full border"
              style={{
                color: active ? '#fecaca' : '#94a3b8',
                background: active ? 'rgba(248,113,113,0.14)' : 'rgba(255,255,255,0.02)',
                borderColor: active ? 'rgba(248,113,113,0.35)' : 'rgba(255,255,255,0.08)',
              }}
            >
              {label}{count ? ` (${count})` : ''}
            </span>
          )
        })}
      </div>

      {summary.recent_incidents?.length > 0 && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="text-xs uppercase tracking-[0.22em] text-muted mb-2">Recent Flags</p>
          <div className="space-y-2">
            {summary.recent_incidents.slice(0, compact ? 2 : 3).map(item => (
              <div key={item.id} className="flex items-start gap-2 text-sm">
                <AlertTriangle size={14} className="text-red-300 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">{item.label}</p>
                  <p className="text-muted text-xs">{new Date(item.created_at).toLocaleTimeString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
