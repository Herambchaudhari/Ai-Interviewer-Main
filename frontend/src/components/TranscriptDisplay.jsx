/**
 * TranscriptDisplay — shows live/final transcript with shimmer loading,
 * no-speech warning, and inline edit mode.
 *
 * Props:
 *   transcript      {string}  - current transcript text ('' while recording/not yet)
 *   isTranscribing  {boolean} - show shimmer skeleton while true
 *   onChange        {(text: string) => void} - called when user edits the transcript
 */
import { useState, useEffect, useRef } from 'react'
import { Pencil, Check, AlertTriangle, RefreshCcw } from 'lucide-react'

export default function TranscriptDisplay({ transcript = '', isTranscribing = false, onChange }) {
  const [editMode, setEditMode] = useState(false)
  const [edited,   setEdited]   = useState(transcript)
  const textareaRef = useRef(null)

  useEffect(() => { setEdited(transcript) }, [transcript])
  useEffect(() => { if (editMode) textareaRef.current?.focus() }, [editMode])

  const saveEdit = () => {
    onChange?.(edited)
    setEditMode(false)
  }

  const noSpeech = transcript === '[No speech detected]'

  // ── Shimmer skeleton (transcribing) ─────────────────────────────────────
  if (isTranscribing) {
    return (
      <div className="glass p-4 animate-scale-in">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-purple-400 animate-ping" />
          <span className="text-xs text-muted">Transcribing with Whisper…</span>
        </div>
        <div className="space-y-2">
          <div className="shimmer h-3 rounded-full w-full" />
          <div className="shimmer h-3 rounded-full w-4/5" />
          <div className="shimmer h-3 rounded-full w-3/5" />
        </div>
      </div>
    )
  }

  // ── Empty / not yet recorded state ───────────────────────────────────────
  if (!transcript) return null

  // ── No-speech warning ────────────────────────────────────────────────────
  if (noSpeech) {
    return (
      <div className="glass p-4 flex items-start gap-3 animate-scale-in"
        style={{ border: '1px solid rgba(234,179,8,0.35)', background: 'rgba(234,179,8,0.06)' }}>
        <AlertTriangle size={18} className="text-yellow-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-yellow-300 font-semibold text-sm">No speech detected</p>
          <p className="text-yellow-200/60 text-xs mt-0.5">
            Please check your microphone and try recording again.
          </p>
        </div>
        <button onClick={() => onChange?.('')}
          className="flex items-center gap-1 text-xs text-yellow-400 hover:text-yellow-300 transition-colors">
          <RefreshCcw size={13} /> Retry
        </button>
      </div>
    )
  }

  // ── Normal transcript ─────────────────────────────────────────────────────
  return (
    <div className="glass p-4 animate-scale-in">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted uppercase tracking-wider">Your answer (transcript)</p>
        {!editMode ? (
          <button
            id="edit-transcript-btn"
            onClick={() => setEditMode(true)}
            title="Edit transcript"
            className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors"
          >
            <Pencil size={12} /> Edit
          </button>
        ) : (
          <button
            onClick={saveEdit}
            className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
          >
            <Check size={12} /> Save
          </button>
        )}
      </div>

      {editMode ? (
        <textarea
          ref={textareaRef}
          value={edited}
          onChange={e => setEdited(e.target.value)}
          rows={4}
          className="input-field resize-none text-sm leading-relaxed w-full"
          style={{ maxHeight: 150 }}
        />
      ) : (
        <div
          className="overflow-y-auto text-sm leading-relaxed"
          style={{ maxHeight: 120, color: 'var(--color-text)' }}
        >
          {transcript}
        </div>
      )}
    </div>
  )
}
