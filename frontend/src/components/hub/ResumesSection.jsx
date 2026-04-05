/**
 * ResumesSection — manage resume versions, set active, view parsed data.
 * Props: { resumes, onActivated, onUploaded }
 */
import { useState, useRef } from 'react'
import { CheckCircle, ChevronDown, ChevronUp, Upload, Star, FileText, Plus } from 'lucide-react'
import { uploadResume } from '../../lib/api'
import { activateResume } from '../../lib/api'
import toast from 'react-hot-toast'

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function SkillsChips({ skills }) {
  if (!skills?.length) return <span className="text-muted text-xs">No skills extracted</span>
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {skills.slice(0, 12).map(s => (
        <span key={s} className="badge-purple text-xs">{s}</span>
      ))}
      {skills.length > 12 && (
        <span className="badge-cyan text-xs">+{skills.length - 12} more</span>
      )}
    </div>
  )
}

function ResumeCard({ resume, onActivate }) {
  const [expanded, setExpanded] = useState(false)
  const [activating, setActivating] = useState(false)

  const handleActivate = async () => {
    setActivating(true)
    try {
      await activateResume(resume.profile_id)
      onActivate(resume.profile_id)
      toast.success('Resume activated. Future interviews will use this version.')
    } catch {
      toast.error('Failed to activate resume.')
    } finally {
      setActivating(false)
    }
  }

  const { parsed_summary: ps } = resume

  return (
    <div className="glass p-5 transition-all duration-200"
      style={resume.is_active ? { border: '1px solid rgba(124,58,237,0.5)', boxShadow: '0 0 20px rgba(124,58,237,0.1)' } : {}}>

      {/* ── Card header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="p-2.5 rounded-xl flex-shrink-0"
            style={{ background: resume.is_active ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.05)' }}>
            <FileText size={18} style={{ color: resume.is_active ? '#7c3aed' : 'var(--color-muted)' }} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm truncate">{resume.label}</h3>
              {resume.is_active && (
                <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(124,58,237,0.2)', color: '#7c3aed' }}>
                  <CheckCircle size={10} /> Active
                </span>
              )}
            </div>
            <p className="text-xs text-muted mt-0.5">
              Uploaded {formatDate(resume.created_at)}
              {resume.file_name && ` · ${resume.file_name}`}
            </p>
            <div className="flex gap-4 mt-2 text-xs text-muted">
              <span><strong className="text-white/70">{ps?.skills_count || 0}</strong> skills</span>
              <span><strong className="text-white/70">{ps?.experience_count || 0}</strong> experience</span>
              <span><strong className="text-white/70">{ps?.education_count || 0}</strong> education</span>
              <span><strong className="text-white/70">{ps?.projects_count || 0}</strong> projects</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!resume.is_active && (
            <button
              onClick={handleActivate}
              disabled={activating}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-all duration-200"
              style={{ background: 'rgba(124,58,237,0.15)', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.3)' }}
            >
              <Star size={12} /> {activating ? 'Activating…' : 'Set Active'}
            </button>
          )}
          <button
            onClick={() => setExpanded(e => !e)}
            className="p-2 rounded-lg transition-all hover:bg-white/10 text-muted"
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* ── Expanded parsed data ─────────────────────────────────────────── */}
      {expanded && (
        <div className="mt-4 pt-4 space-y-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          {ps?.name && (
            <div>
              <p className="text-xs text-muted uppercase tracking-widest mb-1">Name</p>
              <p className="font-medium">{ps.name}</p>
            </div>
          )}

          {ps?.skills?.length > 0 && (
            <div>
              <p className="text-xs text-muted uppercase tracking-widest mb-1">Skills</p>
              <SkillsChips skills={ps.skills} />
            </div>
          )}

          {ps?.education?.length > 0 && (
            <div>
              <p className="text-xs text-muted uppercase tracking-widest mb-1">Education</p>
              {ps.education.slice(0, 3).map((e, i) => (
                <p key={i} className="text-sm text-white/80">
                  {e.degree}{e.institution ? ` — ${e.institution}` : ''}{e.year ? ` (${e.year})` : ''}
                </p>
              ))}
            </div>
          )}

          {ps?.experience?.length > 0 && (
            <div>
              <p className="text-xs text-muted uppercase tracking-widest mb-1">Experience</p>
              {ps.experience.slice(0, 3).map((ex, i) => (
                <p key={i} className="text-sm text-white/80">
                  {ex.role}{ex.company ? ` @ ${ex.company}` : ''}{ex.duration ? ` · ${ex.duration}` : ''}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ResumesSection({ resumes, onActivated, onUploaded }) {
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const res = await uploadResume(file)
      if (res?.data?.profile_id) {
        localStorage.setItem('profile_id', res.data.profile_id)
      }
      toast.success('Resume uploaded successfully.')
      onUploaded()
    } catch {
      toast.error('Failed to upload resume.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div className="animate-fade-in-up">
      {/* ── Upload button ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5">
        <p className="text-sm text-muted">
          {resumes.length} version{resumes.length !== 1 ? 's' : ''} uploaded
        </p>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl transition-all duration-200"
          style={{ background: 'linear-gradient(135deg,#7c3aed,#06b6d4)', color: '#fff' }}
        >
          {uploading ? <Upload size={15} className="animate-bounce" /> : <Plus size={15} />}
          {uploading ? 'Uploading…' : 'Upload New Version'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* ── Resume cards ───────────────────────────────────────────────── */}
      {resumes.length === 0 ? (
        <div className="glass p-12 text-center">
          <FileText size={40} className="text-muted mx-auto mb-4" />
          <p className="text-muted">No resumes uploaded yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {resumes.map(r => (
            <ResumeCard key={r.profile_id} resume={r} onActivate={onActivated} />
          ))}
        </div>
      )}
    </div>
  )
}
