/**
 * ApplicationsSection — company application tracker.
 * Table view + Kanban view. Props: { applications, sessions, onChange }
 */
import { useState } from 'react'
import { Briefcase, Plus, Trash2, LayoutList, Columns, X, ExternalLink } from 'lucide-react'
import { createApplication, updateApplication, deleteApplication } from '../../lib/api'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'

const STATUSES = [
  { id: 'applied',    label: 'Applied',    color: '#3b82f6' },
  { id: 'screening',  label: 'Screening',  color: '#f59e0b' },
  { id: 'technical',  label: 'Technical',  color: '#7c3aed' },
  { id: 'final',      label: 'Final',      color: '#06b6d4' },
  { id: 'offer',      label: 'Offer',      color: '#4ade80' },
  { id: 'rejected',   label: 'Rejected',   color: '#f87171' },
]

function statusMeta(id) {
  return STATUSES.find(s => s.id === id) || STATUSES[0]
}

// ── Add Application Modal ────────────────────────────────────────────────────
function AddModal({ onClose, onAdded }) {
  const [form, setForm] = useState({
    company_name: '', role: '', date_applied: '', status: 'applied', notes: '',
  })
  const [saving, setSaving] = useState(false)

  const handle = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.company_name.trim() || !form.role.trim()) {
      toast.error('Company name and role are required.')
      return
    }
    setSaving(true)
    try {
      await createApplication(form)
      toast.success('Application added.')
      onAdded()
      onClose()
    } catch {
      toast.error('Failed to add application.')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = "w-full bg-transparent outline-none text-sm px-3 py-2 rounded-lg"
  const inputStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div className="glass p-6 w-full max-w-md animate-scale-in">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-lg">Add Application</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg transition-all">
            <X size={16} className="text-muted" />
          </button>
        </div>

        <div className="space-y-3">
          <input className={inputCls} style={inputStyle} placeholder="Company Name *"
            value={form.company_name} onChange={e => handle('company_name', e.target.value)} />
          <input className={inputCls} style={inputStyle} placeholder="Role / Position *"
            value={form.role} onChange={e => handle('role', e.target.value)} />
          <input type="date" className={inputCls} style={inputStyle}
            value={form.date_applied} onChange={e => handle('date_applied', e.target.value)} />
          <select className={inputCls} style={inputStyle}
            value={form.status} onChange={e => handle('status', e.target.value)}>
            {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <textarea className={inputCls} style={inputStyle} placeholder="Notes (optional)"
            rows={3} value={form.notes} onChange={e => handle('notes', e.target.value)} />
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#06b6d4)', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Adding…' : 'Add Application'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Table View ───────────────────────────────────────────────────────────────
function TableView({ apps, onStatusChange, onDelete }) {
  return (
    <div className="glass overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              {['Company', 'Role', 'Date Applied', 'Status', 'Notes', ''].map(h => (
                <th key={h} className="text-left text-xs text-muted uppercase tracking-wider px-4 py-3 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {apps.map((app, i) => {
              const sm = statusMeta(app.status)
              return (
                <tr key={app.id}
                  className="hover:bg-white/[0.02] transition-colors"
                  style={{ borderBottom: i < apps.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                  <td className="px-4 py-3.5 font-medium">{app.company_name}</td>
                  <td className="px-4 py-3.5 text-muted">{app.role}</td>
                  <td className="px-4 py-3.5 text-muted text-xs">{app.date_applied || '—'}</td>
                  <td className="px-4 py-3.5">
                    <select
                      value={app.status}
                      onChange={e => onStatusChange(app.id, e.target.value)}
                      className="text-xs font-semibold px-2 py-1 rounded-full outline-none cursor-pointer"
                      style={{ background: `${sm.color}20`, color: sm.color, border: `1px solid ${sm.color}40` }}
                    >
                      {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3.5 text-muted text-xs max-w-[180px]">
                    <span className="line-clamp-1">{app.notes || '—'}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <button onClick={() => onDelete(app.id)}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted hover:text-red-400 transition-all">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Kanban View ──────────────────────────────────────────────────────────────
function KanbanCard({ app, onMove, onDelete }) {
  const sm = statusMeta(app.status)
  return (
    <div className="glass p-3 mb-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{app.company_name}</p>
          <p className="text-xs text-muted truncate">{app.role}</p>
        </div>
        <button onClick={() => onDelete(app.id)}
          className="p-1 hover:bg-red-500/10 rounded text-muted hover:text-red-400 transition-all flex-shrink-0">
          <Trash2 size={11} />
        </button>
      </div>
      {app.date_applied && (
        <p className="text-xs text-muted mt-1.5">{app.date_applied}</p>
      )}
      <div className="mt-2">
        <select
          value={app.status}
          onChange={e => onMove(app.id, e.target.value)}
          className="w-full text-xs font-semibold px-2 py-1 rounded-lg outline-none cursor-pointer"
          style={{ background: `${sm.color}15`, color: sm.color, border: `1px solid ${sm.color}30` }}
        >
          {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
    </div>
  )
}

function KanbanView({ apps, onStatusChange, onDelete }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {STATUSES.map(col => {
        const colApps = apps.filter(a => a.status === col.id)
        return (
          <div key={col.id} className="flex-shrink-0 w-52">
            <div className="flex items-center gap-2 mb-3 px-1">
              <span className="w-2 h-2 rounded-full" style={{ background: col.color }} />
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: col.color }}>
                {col.label}
              </span>
              <span className="ml-auto text-xs text-muted">
                {colApps.length}
              </span>
            </div>
            <div className="min-h-[80px]">
              {colApps.map(app => (
                <KanbanCard key={app.id} app={app} onMove={onStatusChange} onDelete={onDelete} />
              ))}
              {colApps.length === 0 && (
                <div className="h-16 rounded-xl border border-dashed flex items-center justify-center"
                  style={{ borderColor: 'var(--color-border)' }}>
                  <span className="text-xs text-muted">Empty</span>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function ApplicationsSection({ applications, onChange }) {
  const [view, setView]       = useState('table') // 'table' | 'kanban'
  const [showModal, setShowModal] = useState(false)
  const [apps, setApps]       = useState(applications)

  // Sync prop changes (after refetch from parent)
  if (applications !== apps && applications.length !== apps.length) {
    setApps(applications)
  }

  const handleStatusChange = async (appId, newStatus) => {
    setApps(prev => prev.map(a => a.id === appId ? { ...a, status: newStatus } : a))
    try {
      await updateApplication(appId, { status: newStatus })
    } catch {
      toast.error('Failed to update status.')
      onChange()
    }
  }

  const handleDelete = async (appId) => {
    setApps(prev => prev.filter(a => a.id !== appId))
    try {
      await deleteApplication(appId)
      toast.success('Application removed.')
    } catch {
      toast.error('Failed to delete application.')
      onChange()
    }
  }

  return (
    <div className="animate-fade-in-up">
      {/* ── Header bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-5">
        <p className="text-sm text-muted">
          {apps.length} application{apps.length !== 1 ? 's' : ''}
        </p>

        <div className="flex gap-1 p-1 rounded-lg ml-auto"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)' }}>
          <button onClick={() => setView('table')}
            className="p-2 rounded-md transition-all"
            style={view === 'table' ? { background: 'rgba(124,58,237,0.2)', color: '#7c3aed' } : { color: 'var(--color-muted)' }}>
            <LayoutList size={14} />
          </button>
          <button onClick={() => setView('kanban')}
            className="p-2 rounded-md transition-all"
            style={view === 'kanban' ? { background: 'rgba(124,58,237,0.2)', color: '#7c3aed' } : { color: 'var(--color-muted)' }}>
            <Columns size={14} />
          </button>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl text-white transition-all"
          style={{ background: 'linear-gradient(135deg,#7c3aed,#3b82f6)' }}
        >
          <Plus size={15} /> Add Application
        </button>
      </div>

      {/* ── Views ───────────────────────────────────────────────────────── */}
      {apps.length === 0 ? (
        <div className="glass p-12 text-center">
          <Briefcase size={40} className="text-muted mx-auto mb-4" />
          <p className="text-muted mb-4">No applications tracked yet.</p>
          <button onClick={() => setShowModal(true)}
            className="btn-primary text-sm py-2.5 px-5">
            + Add Your First Application
          </button>
        </div>
      ) : view === 'table' ? (
        <TableView apps={apps} onStatusChange={handleStatusChange} onDelete={handleDelete} />
      ) : (
        <KanbanView apps={apps} onStatusChange={handleStatusChange} onDelete={handleDelete} />
      )}

      {showModal && (
        <AddModal
          onClose={() => setShowModal(false)}
          onAdded={() => { onChange(); setShowModal(false) }}
        />
      )}
    </div>
  )
}
