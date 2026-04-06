<<<<<<< Updated upstream
/**
 * NotesSection — per-session notes editor with tags + AI insights accordion.
 * Props: { sessions }
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { StickyNote, Tag, X, ChevronDown, ChevronUp, Clock, Loader2 } from 'lucide-react'
import { getSessionNote, saveSessionNote } from '../../lib/api'
import toast from 'react-hot-toast'

const ROUND_COLORS = {
  technical:     '#7c3aed',
  hr:            '#ec4899',
  dsa:           '#06b6d4',
  mcq_practice: '#f59e0b',
  system_design: '#94a3b8',
}
const ROUND_LABELS = {
  technical: 'Technical', hr: 'HR', dsa: 'DSA', mcq_practice: 'MCQ Practice', system_design: 'Legacy System Design',
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function NoteEditor({ session }) {
  const [content, setContent]       = useState('')
  const [tags, setTags]             = useState([])
  const [tagInput, setTagInput]     = useState('')
  const [saving, setSaving]         = useState(false)
  const [loading, setLoading]       = useState(true)
  const [insightsOpen, setInsightsOpen] = useState(false)
  const saveTimer = useRef(null)

  // Load existing note
  useEffect(() => {
    if (!session?.session_id) return
    setLoading(true)
    getSessionNote(session.session_id)
      .then(res => {
        if (res?.data) {
          setContent(res.data.content || '')
          setTags(res.data.tags || [])
        } else {
          setContent('')
          setTags([])
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [session?.session_id])

  const persistNote = useCallback(async (newContent, newTags) => {
    if (!session?.session_id) return
    setSaving(true)
    try {
      await saveSessionNote(session.session_id, { content: newContent, tags: newTags })
    } catch {
      toast.error('Failed to save note.')
    } finally {
      setSaving(false)
    }
  }, [session?.session_id])

  const handleContentChange = (e) => {
    const val = e.target.value
    setContent(val)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persistNote(val, tags), 1000)
  }

  const handleBlur = () => {
    clearTimeout(saveTimer.current)
    persistNote(content, tags)
  }

  const addTag = () => {
    const t = tagInput.trim()
    if (!t || tags.includes(t)) return
    const newTags = [...tags, t]
    setTags(newTags)
    setTagInput('')
    persistNote(content, newTags)
  }

  const removeTag = (tag) => {
    const newTags = tags.filter(t => t !== tag)
    setTags(newTags)
    persistNote(content, newTags)
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 size={20} className="animate-spin text-muted" />
    </div>
  )

  // Get insights from the session's report (already loaded, no extra API call)
  const summary = session?.summary
  const weakParts = session?.weak_parts || []

  return (
    <div className="flex flex-col gap-4 flex-1">
      {/* Text area */}
      <div className="glass p-4 flex-1">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-muted uppercase tracking-widest">Personal Notes</p>
          {saving && (
            <span className="text-xs text-muted flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" /> Saving…
            </span>
          )}
        </div>
        <textarea
          value={content}
          onChange={handleContentChange}
          onBlur={handleBlur}
          placeholder="Write your thoughts, what to review, what went well…"
          rows={8}
          className="w-full bg-transparent outline-none resize-none text-sm leading-relaxed"
          style={{ color: 'var(--color-text)' }}
        />
      </div>

      {/* Tags */}
      <div className="glass p-4">
        <p className="text-xs text-muted uppercase tracking-widest mb-3 flex items-center gap-1.5">
          <Tag size={11} /> Tags
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {tags.map(tag => (
            <span key={tag}
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ background: 'rgba(124,58,237,0.2)', color: '#7c3aed' }}>
              {tag}
              <button onClick={() => removeTag(tag)} className="hover:text-red-400 transition-colors">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
            placeholder="Type tag + Enter"
            className="flex-1 bg-transparent outline-none text-sm border-b pb-1"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
          <button
            onClick={addTag}
            className="text-xs px-3 py-1 rounded-lg font-medium transition-all"
            style={{ background: 'rgba(124,58,237,0.2)', color: '#7c3aed' }}
          >
            Add
          </button>
        </div>
      </div>

      {/* AI Insights accordion */}
      {(summary || weakParts.length > 0) && (
        <div className="glass overflow-hidden">
          <button
            onClick={() => setInsightsOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium"
          >
            <span className="flex items-center gap-2" style={{ color: '#f59e0b' }}>
              ✦ AI Insights from this Interview
            </span>
            {insightsOpen ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
          </button>
          {insightsOpen && (
            <div className="px-4 pb-4 space-y-3"
              style={{ borderTop: '1px solid var(--color-border)' }}>
              {summary && (
                <p className="text-sm text-muted leading-relaxed pt-3">{summary}</p>
              )}
              {weakParts.length > 0 && (
                <div>
                  <p className="text-xs text-muted uppercase tracking-widest mb-1.5">Weak Areas</p>
                  <div className="flex flex-wrap gap-1.5">
                    {weakParts.map(p => (
                      <span key={p} className="text-xs px-2 py-0.5 rounded"
                        style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function NotesSection({ sessions }) {
  const [selectedIdx, setSelectedIdx] = useState(0)
  const selected = sessions?.[selectedIdx]

  if (!sessions?.length) {
    return (
      <div className="glass p-12 text-center animate-fade-in-up">
        <StickyNote size={40} className="text-muted mx-auto mb-4" />
        <p className="text-muted">No completed sessions yet. Finish an interview to add notes.</p>
      </div>
    )
  }

  return (
    <div className="flex gap-5 animate-fade-in-up" style={{ minHeight: '520px' }}>

      {/* ── Left: session list ───────────────────────────────────────────── */}
      <div className="w-64 flex-shrink-0 space-y-2 overflow-y-auto" style={{ maxHeight: '560px' }}>
        {sessions.map((s, i) => {
          const color = ROUND_COLORS[s.round_type] || '#7c3aed'
          const isSelected = i === selectedIdx
          return (
            <button
              key={s.session_id}
              onClick={() => setSelectedIdx(i)}
              className="w-full text-left p-3 rounded-xl transition-all duration-200"
              style={isSelected
                ? { background: `${color}20`, border: `1px solid ${color}50` }
                : { background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)' }}
            >
              <p className="text-xs font-semibold" style={{ color: isSelected ? color : 'var(--color-text)' }}>
                {ROUND_LABELS[s.round_type] || s.round_type}
              </p>
              <div className="flex items-center gap-1 mt-1 text-xs text-muted">
                <Clock size={10} />
                {formatDate(s.session_date)}
              </div>
              {s.overall_score != null && (
                <p className="text-xs mt-1 font-bold" style={{ color }}>
                  {Number(s.overall_score).toFixed(1)}/100
                </p>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Right: note editor ───────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col">
        {selected && (
          <div className="flex items-center gap-3 mb-4">
            <span className="w-2 h-2 rounded-full"
              style={{ background: ROUND_COLORS[selected.round_type] || '#7c3aed' }} />
            <span className="font-semibold">
              {ROUND_LABELS[selected.round_type]} · {formatDate(selected.session_date)}
            </span>
            {selected.overall_score != null && (
              <span className="ml-auto text-sm font-bold"
                style={{ color: selected.overall_score >= 70 ? '#4ade80' : '#f87171' }}>
                {Number(selected.overall_score).toFixed(1)}/100
              </span>
            )}
          </div>
        )}
        <NoteEditor key={selected?.session_id} session={selected} />
      </div>
    </div>
  )
}
=======
/**
 * NotesSection — per-session notes editor with tags + AI insights accordion.
 * Props: { sessions }
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { StickyNote, Tag, X, ChevronDown, ChevronUp, Clock, Loader2 } from 'lucide-react'
import { getSessionNote, saveSessionNote } from '../../lib/api'
import toast from 'react-hot-toast'

const ROUND_COLORS = {
  technical:     '#7c3aed',
  hr:            '#ec4899',
  dsa:           '#06b6d4',
  mcq_practice: '#f59e0b',
  system_design: '#94a3b8',
}
const ROUND_LABELS = {
  technical: 'Technical', hr: 'HR', dsa: 'DSA', mcq_practice: 'MCQ Practice', system_design: 'Legacy System Design',
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function NoteEditor({ session }) {
  const [content, setContent]       = useState('')
  const [tags, setTags]             = useState([])
  const [tagInput, setTagInput]     = useState('')
  const [saving, setSaving]         = useState(false)
  const [loading, setLoading]       = useState(true)
  const [insightsOpen, setInsightsOpen] = useState(false)
  const saveTimer = useRef(null)

  // Load existing note
  useEffect(() => {
    if (!session?.session_id) return
    setLoading(true)
    getSessionNote(session.session_id)
      .then(res => {
        if (res?.data) {
          setContent(res.data.content || '')
          setTags(res.data.tags || [])
        } else {
          setContent('')
          setTags([])
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [session?.session_id])

  const persistNote = useCallback(async (newContent, newTags) => {
    if (!session?.session_id) return
    setSaving(true)
    try {
      await saveSessionNote(session.session_id, { content: newContent, tags: newTags })
    } catch {
      toast.error('Failed to save note.')
    } finally {
      setSaving(false)
    }
  }, [session?.session_id])

  const handleContentChange = (e) => {
    const val = e.target.value
    setContent(val)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persistNote(val, tags), 1000)
  }

  const handleBlur = () => {
    clearTimeout(saveTimer.current)
    persistNote(content, tags)
  }

  const addTag = () => {
    const t = tagInput.trim()
    if (!t || tags.includes(t)) return
    const newTags = [...tags, t]
    setTags(newTags)
    setTagInput('')
    persistNote(content, newTags)
  }

  const removeTag = (tag) => {
    const newTags = tags.filter(t => t !== tag)
    setTags(newTags)
    persistNote(content, newTags)
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 size={20} className="animate-spin text-muted" />
    </div>
  )

  // Get insights from the session's report (already loaded, no extra API call)
  const summary = session?.summary
  const weakParts = session?.weak_parts || []

  return (
    <div className="flex flex-col gap-4 flex-1">
      {/* Text area */}
      <div className="glass p-4 flex-1">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-muted uppercase tracking-widest">Personal Notes</p>
          {saving && (
            <span className="text-xs text-muted flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" /> Saving…
            </span>
          )}
        </div>
        <textarea
          value={content}
          onChange={handleContentChange}
          onBlur={handleBlur}
          placeholder="Write your thoughts, what to review, what went well…"
          rows={8}
          className="w-full bg-transparent outline-none resize-none text-sm leading-relaxed"
          style={{ color: 'var(--color-text)' }}
        />
      </div>

      {/* Tags */}
      <div className="glass p-4">
        <p className="text-xs text-muted uppercase tracking-widest mb-3 flex items-center gap-1.5">
          <Tag size={11} /> Tags
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {tags.map(tag => (
            <span key={tag}
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ background: 'rgba(124,58,237,0.2)', color: '#7c3aed' }}>
              {tag}
              <button onClick={() => removeTag(tag)} className="hover:text-red-400 transition-colors">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
            placeholder="Type tag + Enter"
            className="flex-1 bg-transparent outline-none text-sm border-b pb-1"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
          <button
            onClick={addTag}
            className="text-xs px-3 py-1 rounded-lg font-medium transition-all"
            style={{ background: 'rgba(124,58,237,0.2)', color: '#7c3aed' }}
          >
            Add
          </button>
        </div>
      </div>

      {/* AI Insights accordion */}
      {(summary || weakParts.length > 0) && (
        <div className="glass overflow-hidden">
          <button
            onClick={() => setInsightsOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium"
          >
            <span className="flex items-center gap-2" style={{ color: '#f59e0b' }}>
              ✦ AI Insights from this Interview
            </span>
            {insightsOpen ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
          </button>
          {insightsOpen && (
            <div className="px-4 pb-4 space-y-3"
              style={{ borderTop: '1px solid var(--color-border)' }}>
              {summary && (
                <p className="text-sm text-muted leading-relaxed pt-3">{summary}</p>
              )}
              {weakParts.length > 0 && (
                <div>
                  <p className="text-xs text-muted uppercase tracking-widest mb-1.5">Weak Areas</p>
                  <div className="flex flex-wrap gap-1.5">
                    {weakParts.map(p => (
                      <span key={p} className="text-xs px-2 py-0.5 rounded"
                        style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function NotesSection({ sessions }) {
  const [selectedIdx, setSelectedIdx] = useState(0)
  const selected = sessions?.[selectedIdx]

  if (!sessions?.length) {
    return (
      <div className="glass p-12 text-center animate-fade-in-up">
        <StickyNote size={40} className="text-muted mx-auto mb-4" />
        <p className="text-muted">No completed sessions yet. Finish an interview to add notes.</p>
      </div>
    )
  }

  return (
    <div className="flex gap-5 animate-fade-in-up" style={{ minHeight: '520px' }}>

      {/* ── Left: session list ───────────────────────────────────────────── */}
      <div className="w-64 flex-shrink-0 space-y-2 overflow-y-auto" style={{ maxHeight: '560px' }}>
        {sessions.map((s, i) => {
          const color = ROUND_COLORS[s.round_type] || '#7c3aed'
          const isSelected = i === selectedIdx
          return (
            <button
              key={s.session_id}
              onClick={() => setSelectedIdx(i)}
              className="w-full text-left p-3 rounded-xl transition-all duration-200"
              style={isSelected
                ? { background: `${color}20`, border: `1px solid ${color}50` }
                : { background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)' }}
            >
              <p className="text-xs font-semibold" style={{ color: isSelected ? color : 'var(--color-text)' }}>
                {ROUND_LABELS[s.round_type] || s.round_type}
              </p>
              <div className="flex items-center gap-1 mt-1 text-xs text-muted">
                <Clock size={10} />
                {formatDate(s.session_date)}
              </div>
              {s.overall_score != null && (
                <p className="text-xs mt-1 font-bold" style={{ color }}>
                  {Number(s.overall_score).toFixed(1)}/100
                </p>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Right: note editor ───────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col">
        {selected && (
          <div className="flex items-center gap-3 mb-4">
            <span className="w-2 h-2 rounded-full"
              style={{ background: ROUND_COLORS[selected.round_type] || '#7c3aed' }} />
            <span className="font-semibold">
              {ROUND_LABELS[selected.round_type]} · {formatDate(selected.session_date)}
            </span>
            {selected.overall_score != null && (
              <span className="ml-auto text-sm font-bold"
                style={{ color: selected.overall_score >= 70 ? '#4ade80' : '#f87171' }}>
                {Number(selected.overall_score).toFixed(1)}/100
              </span>
            )}
          </div>
        )}
        <NoteEditor key={selected?.session_id} session={selected} />
      </div>
    </div>
  )
}
>>>>>>> Stashed changes
