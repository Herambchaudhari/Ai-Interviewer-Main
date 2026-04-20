import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Shield, Users, ClipboardList, FileText, Search, X,
  LogOut, Loader2, AlertCircle, Eye,
  TrendingUp, RefreshCw, User, BookOpen, Briefcase,
  GraduationCap, Wrench, ScrollText, Moon, Sun, BarChart2,
  CheckCircle, XCircle, Target, Star, Pencil, Check,
  Layers, Calendar
} from 'lucide-react'
import toast from 'react-hot-toast'
import axios from 'axios'
import { useTheme } from '../context/ThemeContext'

const API = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api/v1`
  : '/api/v1'

function adminHeaders() {
  return { 'x-admin-token': sessionStorage.getItem('admin_token') || '' }
}

const TABS = [
  { id: 'registered', label: 'Registered Students', icon: Users },
  { id: 'assessments', label: 'Assessment Activity',  icon: ClipboardList },
  { id: 'resumes',    label: 'Resume Uploads',        icon: FileText },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
function scoreColor(pct) {
  if (pct >= 80) return '#4ade80'
  if (pct >= 60) return '#facc15'
  if (pct >= 40) return '#fb923c'
  return '#f87171'
}

function fmt(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function gradeColor(grade) {
  if (!grade) return 'text-[var(--color-muted)]'
  if (grade.startsWith('A')) return 'text-emerald-400'
  if (grade.startsWith('B')) return 'text-violet-400'
  if (grade.startsWith('C')) return 'text-yellow-400'
  return 'text-red-400'
}

function getActivityStatus(user, sessionsByUser, onlineIds) {
  if (onlineIds.includes(user.id)) return { label: 'Active Now', color: '#4ade80', dot: '#4ade80', pulse: true }

  const userSessions = sessionsByUser[user.id] || []
  const timestamps = [
    user.last_sign_in_at ? new Date(user.last_sign_in_at) : null,
    userSessions[0]?.created_at ? new Date(userSessions[0].created_at) : null,
  ].filter(Boolean)
  if (!timestamps.length) return { label: 'Inactive', color: '#6b7280', dot: '#6b7280', pulse: false }
  const latest = new Date(Math.max(...timestamps))
  const hoursAgo = (Date.now() - latest) / 36e5
  if (hoursAgo < 24)  return { label: 'Active Today',      color: '#a78bfa', dot: '#a78bfa', pulse: false }
  if (hoursAgo < 168) return { label: 'Active This Week',  color: '#facc15', dot: '#facc15', pulse: false }
  return { label: 'Inactive', color: '#6b7280', dot: '#6b7280', pulse: false }
}

function hireColor(hr) {
  if (!hr) return 'text-[var(--color-muted)]'
  if (hr === 'Strong Yes') return 'text-emerald-400'
  if (hr === 'Yes')        return 'text-green-400'
  if (hr === 'Maybe')      return 'text-yellow-400'
  return 'text-red-400'
}

// ── Resume Viewer ─────────────────────────────────────────────────────────────
function ResumeViewer({ profile }) {
  const [view, setView] = useState('parsed') // 'parsed' | 'raw'

  const skillStr = (s) => typeof s === 'string' ? s : s?.name || s?.skill || JSON.stringify(s)

  const parsed = profile.parsed_data || {}
  const education = profile.education || parsed.education || []
  const experience = profile.experience || parsed.experience || []
  const skills = profile.skills || parsed.skills || []
  const projects = parsed.projects || []
  const certifications = parsed.certifications || []
  const summary = parsed.summary || parsed.objective || ''

  return (
    <div className="flex flex-col h-full">
      {/* Tab switcher */}
      <div className="flex gap-1 bg-[var(--color-surface-2)] rounded-xl p-1 mb-4 w-fit">
        <button
          onClick={() => setView('parsed')}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
            view === 'parsed' ? 'bg-violet-500 text-white' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          Structured View
        </button>
        <button
          onClick={() => setView('raw')}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
            view === 'raw' ? 'bg-violet-500 text-white' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          <ScrollText className="w-3.5 h-3.5" />
          Raw Text
        </button>
      </div>

      {view === 'raw' ? (
        <pre className="bg-black/30 border border-[var(--color-border)] rounded-xl p-4 text-xs text-[var(--color-text-2)] font-mono overflow-y-auto max-h-96 whitespace-pre-wrap leading-relaxed">
          {profile.raw_text || 'No raw text available.'}
        </pre>
      ) : (
        <div className="space-y-4 overflow-y-auto max-h-96 pr-1">
          {/* Summary */}
          {summary && (
            <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl p-4">
              <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider mb-2">Summary</p>
              <p className="text-[var(--color-text-2)] text-sm leading-relaxed">{summary}</p>
            </div>
          )}

          {/* Skills */}
          {skills.length > 0 && (
            <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wrench className="w-4 h-4 text-violet-400" />
                <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Skills</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {skills.map((s, i) => (
                  <span key={i} className="px-2 py-1 text-xs rounded-lg bg-violet-500/20 text-violet-300 border border-violet-500/30">
                    {skillStr(s)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Experience */}
          {experience.length > 0 && (
            <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Briefcase className="w-4 h-4 text-blue-400" />
                <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Experience</p>
              </div>
              <div className="space-y-3">
                {experience.map((e, i) => (
                  <div key={i} className="border-l-2 border-blue-500/40 pl-3">
                    <p className="text-[var(--color-text)] text-sm font-medium">{e.title || e.role || e.position || '—'}</p>
                    <p className="text-[var(--color-muted)] text-xs">{e.company || e.organization || ''}{e.duration || e.period || e.dates ? ` · ${e.duration || e.period || e.dates}` : ''}</p>
                    {e.description && <p className="text-[var(--color-muted-light)] text-xs mt-1 leading-relaxed">{e.description}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Education */}
          {education.length > 0 && (
            <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <GraduationCap className="w-4 h-4 text-emerald-400" />
                <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Education</p>
              </div>
              <div className="space-y-3">
                {education.map((e, i) => (
                  <div key={i} className="border-l-2 border-emerald-500/40 pl-3">
                    <p className="text-[var(--color-text)] text-sm font-medium">{e.degree || e.qualification || '—'}</p>
                    <p className="text-[var(--color-muted)] text-xs">{e.institution || e.school || e.college || ''}{e.year || e.graduation_year ? ` · ${e.year || e.graduation_year}` : ''}</p>
                    {e.gpa || e.cgpa ? <p className="text-[var(--color-muted-light)] text-xs">CGPA: {e.gpa || e.cgpa}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Projects */}
          {projects.length > 0 && (
            <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl p-4">
              <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider mb-3">Projects</p>
              <div className="space-y-2">
                {projects.map((p, i) => (
                  <div key={i} className="border-l-2 border-yellow-500/40 pl-3">
                    <p className="text-[var(--color-text)] text-sm font-medium">{p.name || p.title || '—'}</p>
                    {p.description && <p className="text-[var(--color-muted-light)] text-xs mt-0.5">{p.description}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Certifications */}
          {certifications.length > 0 && (
            <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl p-4">
              <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider mb-3">Certifications</p>
              <div className="space-y-1">
                {certifications.map((c, i) => (
                  <p key={i} className="text-[var(--color-text-2)] text-sm">• {typeof c === 'string' ? c : c.name || JSON.stringify(c)}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Student Detail Modal ──────────────────────────────────────────────────────
const MODAL_YEARS    = ['1st', '2nd', '3rd', '4th']
const MODAL_BRANCHES = [
  'Computer Science (CS)',
  'Information Technology (IT)',
  'Electronics & TC (ENTC)',
  'Mechanical',
  'Civil',
  'Electrical',
  'Chemical',
  'Other',
]

function StudentDetailModal({ userId, onClose, defaultTab = 'overview', visibleTabs = ['overview', 'resume', 'sessions'] }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [activeTab, setActiveTab] = useState(defaultTab)

  // Inline meta editing state
  const [editingMeta, setEditingMeta] = useState(false)
  const [metaDraft, setMetaDraft]     = useState({})
  const [savingMeta, setSavingMeta]   = useState(false)

  const startMetaEdit = (meta) => {
    setMetaDraft({
      name:   meta.name   || '',
      year:   meta.year   || '',
      branch: meta.branch || '',
      cgpa:   meta.cgpa   != null ? String(meta.cgpa) : '',
    })
    setEditingMeta(true)
  }

  const cancelMetaEdit = () => {
    setEditingMeta(false)
    setMetaDraft({})
  }

  const saveMeta = async () => {
    setSavingMeta(true)
    try {
      const payload = {
        name:   metaDraft.name   || undefined,
        year:   metaDraft.year   || undefined,
        branch: metaDraft.branch || undefined,
        cgpa:   metaDraft.cgpa !== '' && metaDraft.cgpa != null ? parseFloat(metaDraft.cgpa) : undefined,
      }
      // Remove undefined keys
      Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k])

      await axios.patch(`${API}/admin/user/${userId}/meta`, payload, { headers: adminHeaders() })
      if (metaDraft.name) {
        await axios.patch(`${API}/admin/user/${userId}/name`, { name: metaDraft.name }, { headers: adminHeaders() })
      }
      toast.success('Profile updated.')
      setEditingMeta(false)
      // Re-fetch to get fresh data
      const { data: res } = await axios.get(`${API}/admin/student/${userId}`, { headers: adminHeaders() })
      setData(res)
    } catch {
      toast.error('Failed to update.')
    } finally {
      setSavingMeta(false)
    }
  }

  useEffect(() => {
    async function load() {
      try {
        const { data: res } = await axios.get(`${API}/admin/student/${userId}`, { headers: adminHeaders() })
        setData(res)
      } catch {
        setError('Failed to load student data.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [userId])

  const ALL_TABS = [
    { id: 'overview', label: 'Overview', icon: User },
    { id: 'resume',   label: 'Resume',   icon: ScrollText },
    { id: 'sessions', label: 'Sessions', icon: ClipboardList },
  ]
  const tabs = ALL_TABS.filter(t => visibleTabs.includes(t.id))
  const showTabBar = tabs.length > 1

  // Tab label for single-tab header subtitle
  const singleTabLabel = !showTabBar ? tabs[0]?.label : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--color-border)] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-violet-500/20 border border-violet-500/30">
              <User className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text)] leading-none">
                {data?.user?.name || data?.user?.email || 'Student Detail'}
              </h2>
              <p className="text-[var(--color-muted-light)] text-xs mt-0.5">
                {data?.user?.name ? data.user.email : ''}
                {singleTabLabel && <span className="ml-1 text-violet-400">· {singleTabLabel}</span>}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs — only shown when multiple tabs are visible */}
        {data && !loading && showTabBar && (
          <div className="flex gap-1 px-6 pt-4 border-b border-[var(--color-border)] pb-0 flex-shrink-0">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all -mb-px ${
                  activeTab === t.id
                    ? 'border-violet-400 text-violet-300'
                    : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                <t.icon className="w-4 h-4" />
                {t.label}
                {t.id === 'resume' && !data.profile && <span className="text-xs text-slate-600">(none)</span>}
                {t.id === 'sessions' && <span className="text-xs text-[var(--color-muted-light)] ml-1">{data.sessions.length}</span>}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {data && !loading && (
            <>
              {/* Overview Tab */}
              {activeTab === 'overview' && (() => {
                const meta = data.student_meta || {}
                return (
                  <div className="space-y-4">
                    {/* Account */}
                    <div className="glass-card rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Account</h3>
                        {!editingMeta && (
                          <button
                            onClick={() => startMetaEdit(meta)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-300 text-xs font-medium transition-all"
                          >
                            <Pencil className="w-3 h-3" />
                            Edit Profile
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-[var(--color-muted-light)]">Name</p>
                          <p className="text-[var(--color-text)] font-medium">{data.user.name || '—'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-[var(--color-muted-light)]">Email</p>
                          <p className="text-[var(--color-text)] font-medium">{data.user.email}</p>
                        </div>
                        <div>
                          <p className="text-xs text-[var(--color-muted-light)]">Joined</p>
                          <p className="text-[var(--color-text)] font-medium">{fmt(data.user.created_at)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-[var(--color-muted-light)]">Total Sessions</p>
                          <p className="text-[var(--color-text)] font-medium">{data.sessions.length}</p>
                        </div>
                      </div>
                    </div>

                    {/* Personal / Academic Info — editable */}
                    <div className="glass-card rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <GraduationCap className="w-4 h-4 text-emerald-400" />
                        <h3 className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Academic Details</h3>
                        {editingMeta && (
                          <div className="ml-auto flex items-center gap-1.5">
                            <button
                              onClick={saveMeta}
                              disabled={savingMeta}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 text-xs font-medium disabled:opacity-50 transition-all"
                            >
                              {savingMeta ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                              Save
                            </button>
                            <button
                              onClick={cancelMetaEdit}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 text-xs font-medium transition-all"
                            >
                              <X className="w-3 h-3" />
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>

                      {editingMeta ? (
                        <div className="space-y-3">
                          {/* Name */}
                          <div>
                            <label className="block text-xs text-[var(--color-muted-light)] mb-1">Full Name</label>
                            <input
                              className="input-field text-sm py-1.5 px-2.5 w-full"
                              value={metaDraft.name}
                              onChange={e => setMetaDraft(p => ({ ...p, name: e.target.value }))}
                              placeholder="Full name…"
                            />
                          </div>
                          {/* Year */}
                          <div>
                            <label className="block text-xs text-[var(--color-muted-light)] mb-1">Year of Engineering</label>
                            <div className="flex gap-2">
                              {MODAL_YEARS.map(y => (
                                <button
                                  key={y}
                                  type="button"
                                  onClick={() => setMetaDraft(p => ({ ...p, year: y }))}
                                  className="flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all"
                                  style={metaDraft.year === y
                                    ? { borderColor: '#5b5ef6', background: 'rgba(91,94,246,0.15)', color: '#818cf8' }
                                    : { borderColor: 'var(--color-border)', background: 'transparent', color: 'var(--color-muted)' }}
                                >
                                  {y}
                                </button>
                              ))}
                            </div>
                          </div>
                          {/* Branch */}
                          <div>
                            <label className="block text-xs text-[var(--color-muted-light)] mb-1">Branch</label>
                            <select
                              className="input-field text-sm py-1.5 px-2.5 w-full"
                              value={metaDraft.branch}
                              onChange={e => setMetaDraft(p => ({ ...p, branch: e.target.value }))}
                            >
                              <option value="">Select branch…</option>
                              {MODAL_BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                          </div>
                          {/* CGPA */}
                          <div>
                            <label className="block text-xs text-[var(--color-muted-light)] mb-1">CGPA (optional)</label>
                            <input
                              type="number" min="0" max="10" step="0.1"
                              className="input-field text-sm py-1.5 px-2.5 w-full"
                              value={metaDraft.cgpa}
                              onChange={e => setMetaDraft(p => ({ ...p, cgpa: e.target.value }))}
                              placeholder="e.g. 8.4"
                            />
                          </div>
                        </div>
                      ) : (
                        (meta.year || meta.branch || meta.cgpa != null || meta.name)
                          ? (
                            <div className="grid grid-cols-2 gap-4">
                              {meta.name && (
                                <div>
                                  <p className="text-xs text-[var(--color-muted-light)]">Name</p>
                                  <p className="text-[var(--color-text)] font-medium">{meta.name}</p>
                                </div>
                              )}
                              {meta.year && (
                                <div>
                                  <p className="text-xs text-[var(--color-muted-light)]">Year of Engineering</p>
                                  <p className="text-[var(--color-text)] font-medium">{meta.year} Year</p>
                                </div>
                              )}
                              {meta.branch && (
                                <div>
                                  <p className="text-xs text-[var(--color-muted-light)]">Branch</p>
                                  <p className="text-[var(--color-text)] font-medium">{meta.branch}</p>
                                </div>
                              )}
                              {meta.cgpa != null && (
                                <div>
                                  <p className="text-xs text-[var(--color-muted-light)]">CGPA</p>
                                  <p className="text-[var(--color-text)] font-medium">{meta.cgpa} / 10</p>
                                </div>
                              )}
                            </div>
                          )
                          : <p className="text-xs text-[var(--color-muted-light)]">No academic details on file. Click "Edit Profile" to add.</p>
                      )}
                    </div>

                    {/* Target Companies */}
                    {meta.target_companies?.length > 0 && (
                      <div className="glass-card rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Briefcase className="w-4 h-4 text-blue-400" />
                          <h3 className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Target Companies</h3>
                          <span className="ml-auto text-xs text-[var(--color-muted-light)]">{meta.target_companies.length} selected</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {meta.target_companies.map((c, i) => (
                            <span key={i} className="px-2 py-1 text-xs rounded-lg bg-blue-500/15 text-blue-300 border border-blue-500/25">
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Performance Summary */}
                    {data.reports.length > 0 && (() => {
                      const scored = data.reports.filter(r => r.overall_score)
                      const avg = scored.length ? (scored.reduce((s, r) => s + r.overall_score, 0) / scored.length).toFixed(1) : '—'
                      const best = scored.length ? Math.max(...scored.map(r => r.overall_score)).toFixed(1) : '—'
                      return (
                        <div className="glass-card rounded-xl p-4">
                          <h3 className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider mb-3">Performance Summary</h3>
                          <div className="grid grid-cols-3 gap-4">
                            <div>
                              <p className="text-xs text-[var(--color-muted-light)]">Reports</p>
                              <p className="text-[var(--color-text)] font-bold text-xl">{data.reports.length}</p>
                            </div>
                            <div>
                              <p className="text-xs text-[var(--color-muted-light)]">Avg Score</p>
                              <p className="text-violet-300 font-bold text-xl">{avg}</p>
                            </div>
                            <div>
                              <p className="text-xs text-[var(--color-muted-light)]">Best Score</p>
                              <p className="text-emerald-300 font-bold text-xl">{best}</p>
                            </div>
                          </div>
                        </div>
                      )
                    })()}

                    {!(meta.year || meta.branch || meta.target_companies?.length) && data.reports.length === 0 && (
                      <p className="text-[var(--color-muted-light)] text-sm text-center py-6">
                        Student hasn't filled in their profile details yet.
                      </p>
                    )}
                  </div>
                )
              })()}


              {/* Resume Tab */}
              {activeTab === 'resume' && (
                data.profile
                  ? <ResumeViewer profile={data.profile} />
                  : <p className="text-[var(--color-muted-light)] text-sm text-center py-12">No resume uploaded yet.</p>
              )}

              {/* Sessions Tab */}
              {activeTab === 'sessions' && (
                data.sessions.length === 0
                  ? <p className="text-[var(--color-muted-light)] text-sm text-center py-12">No sessions yet.</p>
                  : (
                    <div className="space-y-3">
                      {data.sessions.map(s => {
                        const report = data.reports.find(r => r.session_id === s.id)
                        return (
                          <div key={s.id} className="flex items-center justify-between p-3 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)]">
                            <div className="flex flex-col">
                              <span className="text-[var(--color-text)] text-sm font-medium capitalize">{s.round_type || 'Technical'}</span>
                              <span className="text-[var(--color-muted-light)] text-xs">{fmt(s.created_at)} · {s.difficulty || 'medium'}</span>
                            </div>
                            <div className="text-right">
                              {report ? (
                                <>
                                  <p className={`text-sm font-bold ${gradeColor(report.grade)}`}>{report.grade || '—'}</p>
                                  <p className="text-xs text-[var(--color-muted-light)]">{report.overall_score ? `${Math.round(report.overall_score * 10) / 10}/10` : ''}</p>
                                  <p className={`text-xs ${hireColor(report.hire_recommendation)}`}>{report.hire_recommendation || ''}</p>
                                </>
                              ) : (
                                <span className="text-xs text-[var(--color-muted-light)] capitalize">{s.status}</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Assessment Activity Tab ───────────────────────────────────────────────────
function AssessmentActivityTab({ students, sessionsByUser, onViewReport, onViewStudent }) {
  const [expandedUser, setExpandedUser] = useState(null)

  if (students.length === 0) {
    return <p className="text-center py-12 text-[var(--color-muted-light)]">No assessment activity found.</p>
  }

  return (
    <div className="divide-y divide-white/5">
      {students.map(u => {
        const userSessions = sessionsByUser[u.id] || []
        const latest = userSessions[0]
        const isExpanded = expandedUser === u.id

        return (
          <div key={u.id}>
            {/* Student row */}
            <div className="flex items-center justify-between px-4 py-3 hover:bg-[var(--color-surface-2)] transition-colors">
              <div className="flex items-center gap-3 flex-1">
                <div className="w-8 h-8 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-violet-300 text-xs font-bold uppercase">
                    {(u.name || u.email || '?')[0]}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[var(--color-text)] text-sm font-medium truncate">{u.name || <span className="text-[var(--color-muted-light)] italic">No name</span>}</p>
                  <p className="text-[var(--color-muted-light)] text-xs truncate">{u.email}</p>
                </div>
                <div className="hidden sm:flex items-center gap-6 text-sm">
                  <div className="text-center">
                    <p className="text-[var(--color-text)] font-medium">{userSessions.length}</p>
                    <p className="text-[var(--color-muted-light)] text-xs">Sessions</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[var(--color-muted)]">{fmt(latest?.created_at)}</p>
                    <p className="text-[var(--color-muted-light)] text-xs">Last Session</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <button
                  onClick={() => setExpandedUser(isExpanded ? null : u.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 text-blue-300 text-xs font-medium transition-all"
                >
                  <BarChart2 className="w-3.5 h-3.5" />
                  {isExpanded ? 'Hide' : 'Sessions'}
                </button>
                <button
                  onClick={() => onViewStudent(u.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/30 text-violet-300 text-xs font-medium transition-all"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Show
                </button>
              </div>
            </div>

            {/* Expanded sessions list */}
            {isExpanded && (
              <div className="border-t border-[var(--color-border)] px-4 py-3" style={{ background: 'var(--color-surface-2)' }}>
                <div className="space-y-2 pl-11">
                  {userSessions.map(s => (
                    <div key={s.id} className="flex items-center justify-between p-3 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)]">
                      <div>
                        <p className="text-[var(--color-text)] text-sm font-medium capitalize">{s.round_type || 'Technical'} · {s.difficulty || 'medium'}</p>
                        <p className="text-[var(--color-muted-light)] text-xs">{fmt(s.created_at)} · <span className={`capitalize ${s.status === 'completed' ? 'text-emerald-400' : 'text-[var(--color-muted)]'}`}>{s.status}</span></p>
                      </div>
                      {s.has_report ? (
                        <button
                          onClick={() => onViewReport(s.id, u.email)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 text-xs font-medium transition-all"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          View Report
                        </button>
                      ) : (
                        <span className="text-xs text-slate-600 italic">No report</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Admin Report Modal ────────────────────────────────────────────────────────
function AdminReportModal({ sessionId, userEmail, onClose }) {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const { data } = await axios.get(`${API}/admin/report/${sessionId}`, { headers: adminHeaders() })
        setReport(data.report)
      } catch (err) {
        setError(err.response?.status === 404 ? 'Report not generated yet for this session.' : 'Failed to load report.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [sessionId])

  const r = report || {}

  // Normalise radar entries — handles six_axis_radar (0-100), skill_ratings list, or radar_scores dict (0-10)
  const six_axis_radar = r.six_axis_radar || {}
  const skill_ratings  = r.skill_ratings  || []
  const radar_scores   = r.radar_scores   || {}
  const radarEntries = Object.keys(six_axis_radar).length > 0
    ? Object.entries(six_axis_radar).map(([k, v]) => ({ label: k, score: +v }))
    : skill_ratings.length > 0
    ? skill_ratings.map(s => ({ label: s.skill, score: +s.score * 10 }))
    : Object.entries(radar_scores).map(([k, v]) => ({ label: k, score: +v * 10 }))

  const strongAreas  = r.strong_areas          || []
  const weakAreas    = r.weak_areas            || []
  const perQ         = r.per_question_analysis || []
  const studyRecs    = r.study_recommendations || []
  const swot         = r.swot                  || null
  const companyFit   = r.company_fit           || null
  const thirtyDay    = r.thirty_day_plan       || null
  const whatWentWrong = r.what_went_wrong      || null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--color-border)] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/20 border border-emerald-500/30">
              <FileText className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text)] leading-none">Interview Report</h2>
              <p className="text-[var(--color-muted-light)] text-xs mt-0.5">{userEmail}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {report && !loading && (
            <>
              {/* Score Header */}
              <div className="glass-card rounded-xl p-5 flex flex-wrap gap-6 items-center">
                <div className="text-center">
                  <p className={`text-5xl font-black ${gradeColor(r.grade)}`}>{r.grade || '—'}</p>
                  <p className="text-[var(--color-muted)] text-xs mt-1">Grade</p>
                </div>
                <div className="text-center">
                  <p className="text-4xl font-bold text-[var(--color-text)]">
                    {r.overall_score ? `${Math.round(r.overall_score * 10) / 10}` : '—'}
                    <span className="text-[var(--color-muted-light)] text-lg">/10</span>
                  </p>
                  <p className="text-[var(--color-muted)] text-xs mt-1">Overall Score</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[var(--color-muted-light)] mb-1">Hire Recommendation</p>
                  <p className={`text-lg font-semibold ${hireColor(r.hire_recommendation)}`}>{r.hire_recommendation || '—'}</p>
                  {r.compared_to_level && <p className="text-[var(--color-muted)] text-xs mt-1">Level: {r.compared_to_level}</p>}
                  {r.round_type && <p className="text-[var(--color-muted-light)] text-xs capitalize">{r.round_type} round</p>}
                </div>
              </div>

              {/* Performance Radar */}
              {radarEntries.length > 0 && (
                <div className="glass-card rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider mb-3">Performance Dimensions</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {radarEntries.map(({ label, score }) => {
                      const pct = Math.min(100, Math.round(score))
                      return (
                        <div key={label} className="bg-[var(--color-surface-2)] rounded-xl p-3">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-[var(--color-muted)] text-xs capitalize">{String(label).replace(/_/g, ' ')}</p>
                            <p className="text-[var(--color-text)] text-xs font-bold">{pct}</p>
                          </div>
                          <div className="h-1.5 bg-[var(--color-surface-3)] rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: scoreColor(pct) }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* What Went Wrong */}
              {whatWentWrong && (
                <div className="glass-card rounded-xl p-4 border border-orange-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="w-4 h-4 text-orange-400" />
                    <h3 className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">What Went Wrong</h3>
                  </div>
                  <p className="text-[var(--color-text-2)] text-sm leading-relaxed">{whatWentWrong}</p>
                </div>
              )}

              {/* Strong & Weak Areas */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {strongAreas.length > 0 && (
                  <div className="glass-card rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                      <h3 className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Strong Areas</h3>
                    </div>
                    <div className="space-y-2">
                      {strongAreas.map((a, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <Star className="w-3 h-3 text-emerald-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-[var(--color-text)] text-xs font-medium">{a.area || a.title || a}</p>
                            {a.evidence && <p className="text-[var(--color-muted-light)] text-xs mt-0.5">{a.evidence}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {weakAreas.length > 0 && (
                  <div className="glass-card rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <XCircle className="w-4 h-4 text-red-400" />
                      <h3 className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Areas to Improve</h3>
                    </div>
                    <div className="space-y-2">
                      {weakAreas.map((a, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <Target className="w-3 h-3 text-red-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-[var(--color-text)] text-xs font-medium">{a.area || a.title || a}</p>
                            {(a.what_was_missed || a.how_to_improve) && (
                              <p className="text-[var(--color-muted-light)] text-xs mt-0.5">{a.what_was_missed || a.how_to_improve}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* SWOT Analysis */}
              {swot && (
                <div className="glass-card rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Layers className="w-4 h-4 text-violet-400" />
                    <h3 className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">SWOT Analysis</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { key: 'strengths',     label: 'Strengths',     color: 'text-emerald-400', border: 'border-emerald-500/20' },
                      { key: 'weaknesses',    label: 'Weaknesses',    color: 'text-red-400',     border: 'border-red-500/20' },
                      { key: 'opportunities', label: 'Opportunities', color: 'text-blue-400',    border: 'border-blue-500/20' },
                      { key: 'threats',       label: 'Threats',       color: 'text-orange-400',  border: 'border-orange-500/20' },
                    ].map(({ key, label, color, border }) => {
                      const items = Array.isArray(swot[key]) ? swot[key] : (swot[key] ? [swot[key]] : [])
                      return (
                        <div key={key} className={`bg-[var(--color-surface-2)] rounded-xl p-3 border ${border}`}>
                          <p className={`text-xs font-semibold ${color} mb-2`}>{label}</p>
                          <ul className="space-y-1">
                            {items.map((item, i) => (
                              <li key={i} className="text-[var(--color-text-2)] text-xs flex items-start gap-1">
                                <span className="mt-0.5 flex-shrink-0">•</span>
                                <span>{typeof item === 'string' ? item : JSON.stringify(item)}</span>
                              </li>
                            ))}
                            {items.length === 0 && <li className="text-[var(--color-muted-light)] text-xs italic">—</li>}
                          </ul>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Company Fit */}
              {companyFit && (
                <div className="glass-card rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Briefcase className="w-4 h-4 text-blue-400" />
                    <h3 className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Company Fit</h3>
                    {companyFit.target_company && (
                      <span className="ml-auto text-xs text-blue-300 font-medium">{companyFit.target_company}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                    {companyFit.your_score != null && (
                      <div className="bg-[var(--color-surface-2)] rounded-xl p-3 text-center">
                        <p className="text-[var(--color-muted-light)] text-xs mb-1">Your Score</p>
                        <p className="text-[var(--color-text)] font-bold text-lg">{companyFit.your_score}</p>
                      </div>
                    )}
                    {companyFit.bar_score_required != null && (
                      <div className="bg-[var(--color-surface-2)] rounded-xl p-3 text-center">
                        <p className="text-[var(--color-muted-light)] text-xs mb-1">Bar Required</p>
                        <p className="text-[var(--color-text)] font-bold text-lg">{companyFit.bar_score_required}</p>
                      </div>
                    )}
                    {companyFit.pass_probability != null && (
                      <div className="bg-[var(--color-surface-2)] rounded-xl p-3 text-center">
                        <p className="text-[var(--color-muted-light)] text-xs mb-1">Pass Probability</p>
                        <p className="font-bold text-lg" style={{ color: scoreColor(+companyFit.pass_probability) }}>
                          {companyFit.pass_probability}%
                        </p>
                      </div>
                    )}
                  </div>
                  {companyFit.gap_breakdown && (
                    <div>
                      <p className="text-xs text-[var(--color-muted)] mb-1.5">Gap Breakdown</p>
                      <div className="space-y-1.5">
                        {Object.entries(companyFit.gap_breakdown).map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between text-xs">
                            <span className="text-[var(--color-muted)] capitalize">{k.replace(/_/g, ' ')}</span>
                            <span className="text-[var(--color-text-2)] font-medium">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Per-question breakdown */}
              {perQ.length > 0 && (
                <div className="glass-card rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider mb-3">Per-Question Breakdown ({perQ.length})</h3>
                  <div className="space-y-3">
                    {perQ.map((q, i) => {
                      const score = q.score ?? q.scores?.overall ?? null
                      return (
                        <div key={i} className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-[var(--color-text-2)] text-xs font-medium leading-relaxed">
                                {q.question_text || q.question || `Question ${i + 1}`}
                              </p>
                              {q.feedback && <p className="text-[var(--color-muted-light)] text-xs mt-1 leading-relaxed">{q.feedback}</p>}
                            </div>
                            <div className="text-right flex-shrink-0">
                              {score !== null && score !== undefined && (
                                <p className="text-sm font-bold" style={{ color: scoreColor(+score * 10) }}>{score}/10</p>
                              )}
                              {q.verdict && <p className="text-xs text-[var(--color-muted-light)] capitalize">{q.verdict}</p>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 30-Day Sprint Plan */}
              {thirtyDay && (
                <div className="glass-card rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Calendar className="w-4 h-4 text-cyan-400" />
                    <h3 className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">30-Day Sprint Plan</h3>
                  </div>
                  <div className="space-y-3">
                    {Object.entries(thirtyDay).map(([week, content]) => (
                      <div key={week} className="bg-[var(--color-surface-2)] rounded-xl p-3">
                        <p className="text-xs font-semibold text-cyan-400 capitalize mb-1.5">{week.replace(/_/g, ' ')}</p>
                        {Array.isArray(content) ? (
                          <ul className="space-y-1">
                            {content.map((item, i) => (
                              <li key={i} className="text-[var(--color-text-2)] text-xs flex items-start gap-1">
                                <span className="flex-shrink-0 mt-0.5">•</span>
                                <span>{typeof item === 'string' ? item : JSON.stringify(item)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-[var(--color-text-2)] text-xs">{typeof content === 'string' ? content : JSON.stringify(content)}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Study Recommendations */}
              {studyRecs.length > 0 && (
                <div className="glass-card rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider mb-3">Study Recommendations</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {studyRecs.map((rec, i) => (
                      <div key={i} className="flex items-start gap-2 p-2 bg-[var(--color-surface-2)] rounded-lg">
                        <BookOpen className="w-3.5 h-3.5 text-violet-400 mt-0.5 flex-shrink-0" />
                        <p className="text-[var(--color-text-2)] text-xs">{typeof rec === 'string' ? rec : rec.topic || rec.title || JSON.stringify(rec)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Summary */}
              {r.summary && (
                <div className="glass-card rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider mb-2">Overall Summary</h3>
                  <p className="text-[var(--color-text-2)] text-sm leading-relaxed">{r.summary}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function AdminDashboardPage() {
  const navigate = useNavigate()

  const [activeTab, setActiveTab] = useState('registered')
  const [search, setSearch]       = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)

  // Data
  const [users, setUsers]         = useState([])
  const [sessions, setSessions]   = useState([])
  const [profiles, setProfiles]   = useState([])
  const [onlineIds, setOnlineIds] = useState([])

  // Modals
  const [selectedUser, setSelectedUser]       = useState(null)
  const [selectedSession, setSelectedSession] = useState(null) // { id, userEmail }


  // Auth guard
  useEffect(() => {
    if (!sessionStorage.getItem('admin_token')) {
      navigate('/admin', { replace: true })
    }
  }, [navigate])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const headers = adminHeaders()
      const [usersRes, sessionsRes, profilesRes] = await Promise.all([
        axios.get(`${API}/admin/users`, { headers }),
        axios.get(`${API}/admin/sessions`, { headers }),
        axios.get(`${API}/admin/profiles`, { headers }),
      ])
      setUsers(usersRes.data.users || [])
      setSessions(sessionsRes.data.sessions || [])
      setProfiles(profilesRes.data.profiles || [])
    } catch (err) {
      if (err.response?.status === 403) {
        sessionStorage.removeItem('admin_token')
        navigate('/admin', { replace: true })
      } else {
        setError('Failed to load data. Check backend connection.')
      }
    } finally {
      setLoading(false)
    }
  }, [navigate])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    const fetchPresence = async () => {
      try {
        const { data } = await axios.get(`${API}/admin/presence`, { headers: adminHeaders() })
        console.log('[presence]', data.online)
        setOnlineIds(data.online || [])
      } catch (e) {
        console.error('[presence error]', e.response?.status, e.message)
      }
    }
    fetchPresence()
    const interval = setInterval(fetchPresence, 10000)
    return () => clearInterval(interval)
  }, [])

  const { isDark, toggleTheme } = useTheme()

  const handleLogout = () => {
    sessionStorage.removeItem('admin_token')
    navigate('/admin')
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  const sessionsByUser = sessions.reduce((acc, s) => {
    if (!acc[s.user_id]) acc[s.user_id] = []
    acc[s.user_id].push(s)
    return acc
  }, {})

  const profilesByUser = profiles.reduce((acc, p) => {
    if (!acc[p.user_id]) acc[p.user_id] = []
    acc[p.user_id].push(p)
    return acc
  }, {})

  // Name from user_metadata (updated by Settings page via supabase.auth.updateUser)
  const displayName = (user) => user.name || ''

  // ── Search filter ─────────────────────────────────────────────────────────
  const q = search.toLowerCase().trim()

  const filteredUsers = users.filter(u =>
    !q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)
  )

  // Students who have sessions
  const activeStudents = users.filter(u => sessionsByUser[u.id]?.length > 0)
  const filteredActive = activeStudents.filter(u =>
    !q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)
  )

  // Students who uploaded resumes
  const resumeStudents = users.filter(u => profilesByUser[u.id]?.length > 0)
  const filteredResumes = resumeStudents.filter(u =>
    !q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)
  )

  // ── Stat cards ────────────────────────────────────────────────────────────
  const stats = [
    { label: 'Registered Students', value: users.length,           icon: Users,         color: 'text-violet-400', bg: 'bg-violet-500/20 border-violet-500/30' },
    { label: 'Total Sessions',      value: sessions.length,        icon: ClipboardList, color: 'text-blue-400',   bg: 'bg-blue-500/20 border-blue-500/30' },
    { label: 'Resume Uploads',      value: profiles.length,        icon: FileText,      color: 'text-emerald-400', bg: 'bg-emerald-500/20 border-emerald-500/30' },
    { label: 'Active Students',     value: activeStudents.length,  icon: TrendingUp,    color: 'text-yellow-400', bg: 'bg-yellow-500/20 border-yellow-500/30' },
  ]

  // ── Row components ─────────────────────────────────────────────────────────
  const StudentRow = ({ user, extra, openTab = 'overview' }) => (
    <tr className="border-t border-white/5 hover:bg-[var(--color-surface-2)] transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
            <span className="text-violet-300 text-xs font-bold uppercase">
              {(user.name || user.email || '?')[0]}
            </span>
          </div>
          <div>
            <p className="text-[var(--color-text)] text-sm font-medium">{user.name || <span className="text-[var(--color-muted-light)] italic">No name</span>}</p>
            <p className="text-[var(--color-muted-light)] text-xs">{user.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-[var(--color-muted)] text-sm">{fmt(user.created_at)}</td>
      {extra}
      <td className="px-4 py-3">
        <button
          onClick={() => setSelectedUser({ id: user.id, tab: openTab, visibleTabs: [openTab] })}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/30 text-violet-300 text-xs font-medium transition-all"
        >
          <Eye className="w-3.5 h-3.5" />
          Show
        </button>
      </td>
    </tr>
  )

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>
      {/* Navbar */}
      <header className="border-b border-[var(--color-border)] backdrop-blur-sm sticky top-0 z-30" style={{ background: 'var(--color-surface)' }}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-violet-500/20 border border-violet-500/30">
              <Shield className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-[var(--color-text)] font-bold text-lg leading-none">Admin Panel</h1>
              <p className="text-[var(--color-muted-light)] text-xs">InterviewDeck</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={loadData} disabled={loading} className="flex items-center gap-2 px-3 py-2 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-3)] transition-all text-sm">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={toggleTheme}
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              className="flex items-center justify-center w-9 h-9 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-3)] transition-all border border-[var(--color-border)]"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 text-sm font-medium transition-all">
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map(s => (
            <div key={s.label} className="glass-card rounded-xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className={`p-2 rounded-xl border ${s.bg}`}>
                  <s.icon className={`w-4 h-4 ${s.color}`} />
                </div>
              </div>
              <p className={`text-2xl font-bold ${s.color}`}>{loading ? '—' : s.value}</p>
              <p className="text-[var(--color-muted)] text-xs mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Search + Tabs */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-[var(--color-border)]">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              {/* Tabs */}
              <div className="flex gap-1 bg-[var(--color-surface-2)] rounded-xl p-1">
                {TABS.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      activeTab === t.id
                        ? 'bg-violet-500 text-[var(--color-text)]shadow-lg shadow-violet-500/25'
                        : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                    }`}
                  >
                    <t.icon className="w-4 h-4" />
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-muted-light)]" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by name or email…"
                  className="input-field pl-9 pr-9 w-64 text-sm"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-muted-light)] hover:text-[var(--color-text-2)]">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
              </div>
            ) : (
              <>
                {/* Registered Students */}
                {activeTab === 'registered' && (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--color-border)]">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Student</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Joined</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Sessions</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Last Active</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.length === 0 ? (
                        <tr><td colSpan={5} className="text-center py-12 text-[var(--color-muted-light)]">No students found.</td></tr>
                      ) : filteredUsers.map(u => {
                        const activity = getActivityStatus(u, sessionsByUser, onlineIds)
                        return (
                          <tr key={u.id} className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-2)] transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
                                  <span className="text-violet-300 text-xs font-bold uppercase">
                                    {(displayName(u) || u.email || '?')[0]}
                                  </span>
                                </div>
                                <div className="min-w-0">
                                  <p className="text-[var(--color-text)] text-sm font-medium">
                                    {displayName(u) || <span className="text-[var(--color-muted-light)] italic">No name</span>}
                                  </p>
                                  <p className="text-[var(--color-muted-light)] text-xs">{u.email}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-[var(--color-muted)] text-sm">{fmt(u.created_at)}</td>
                            <td className="px-4 py-3 text-[var(--color-text-2)] text-sm">{sessionsByUser[u.id]?.length || 0}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2" title={activity.label}>
                                <span className="relative flex h-2.5 w-2.5">
                                  {activity.pulse && (
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: activity.dot }} />
                                  )}
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ backgroundColor: activity.dot }} />
                                </span>
                                <span className="text-xs" style={{ color: activity.color }}>{activity.label}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => setSelectedUser({ id: u.id, tab: 'overview', visibleTabs: ['overview', 'resume', 'sessions'] })}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/30 text-violet-300 text-xs font-medium transition-all"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                Show
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}

                {/* Assessment Activity */}
                {activeTab === 'assessments' && (
                  <AssessmentActivityTab
                    students={filteredActive}
                    sessionsByUser={sessionsByUser}
                    reportsBySession={sessions.reduce((acc, s) => acc, {})}
                    onViewReport={(sessionId, userEmail) => setSelectedSession({ id: sessionId, userEmail })}
                    onViewStudent={(userId) => setSelectedUser({ id: userId, tab: 'sessions', visibleTabs: ['sessions'] })}
                  />
                )}

                {/* Resume Uploads */}
                {activeTab === 'resumes' && (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--color-border)]">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Student</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Joined</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Resumes Uploaded</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">First Upload</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredResumes.length === 0 ? (
                        <tr><td colSpan={5} className="text-center py-12 text-[var(--color-muted-light)]">No resume uploads found.</td></tr>
                      ) : filteredResumes.map(u => {
                        const userProfiles = profilesByUser[u.id] || []
                        return (
                          <StudentRow key={u.id} user={u} openTab="resume" extra={
                            <>
                              <td className="px-4 py-3 text-[var(--color-text-2)] text-sm">{userProfiles.length}</td>
                              <td className="px-4 py-3 text-[var(--color-muted)] text-sm">{fmt(userProfiles[userProfiles.length - 1]?.created_at)}</td>
                            </>
                          } />
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      {/* Student Detail Modal */}
      {selectedUser && (
        <StudentDetailModal
          userId={selectedUser.id}
          defaultTab={selectedUser.tab}
          visibleTabs={selectedUser.visibleTabs}
          onClose={() => setSelectedUser(null)}
        />
      )}

      {/* Full Report Modal */}
      {selectedSession && (
        <AdminReportModal
          sessionId={selectedSession.id}
          userEmail={selectedSession.userEmail}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </div>
  )
}
