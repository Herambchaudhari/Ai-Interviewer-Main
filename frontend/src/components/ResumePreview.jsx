import { useState } from 'react'
import {
  User, Mail, Phone, Briefcase, Code2,
  FolderGit2, CheckCircle, Pencil, X, Plus
} from 'lucide-react'

/**
 * ResumePreview — shows parsed resume data with inline edit for name + skills.
 *
 * Props:
 *   parsedData  {object}  - the parsed profile from Groq
 *   onConfirm   (finalParsed) => void  - called when user confirms
 *   onEdit      () => void             - called to go back to upload
 */
export default function ResumePreview({ parsedData, onConfirm, onEdit }) {
  const [data, setData] = useState(parsedData)
  const [editing, setEditing]   = useState(false)
  const [editName, setEditName] = useState(data.name || '')
  const [editSkills, setEditSkills] = useState((data.skills || []).join(', '))
  const [newSkill, setNewSkill]   = useState('')

  // ── Save edits ──────────────────────────────────────────────────────────
  const saveEdits = () => {
    const updatedSkills = editSkills
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    setData(prev => ({ ...prev, name: editName.trim() || prev.name, skills: updatedSkills }))
    setEditing(false)
  }

  const addSkill = () => {
    const s = newSkill.trim()
    if (!s) return
    const current = editSkills ? editSkills.split(',').map(x => x.trim()).filter(Boolean) : []
    setEditSkills([...current, s].join(', '))
    setNewSkill('')
  }

  const removeSkill = (skill) => {
    const skills = editSkills.split(',').map(s => s.trim()).filter(s => s && s !== skill)
    setEditSkills(skills.join(', '))
  }

  // ── Display skills list ─────────────────────────────────────────────────
  const displaySkills = (data.skills || []).slice(0, 20)

  return (
    <div className="w-full max-w-2xl animate-fade-in-up">
      {/* Card header */}
      <div className="glass p-6 mb-4">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-bold flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #22d3ee)' }}>
              {(data.name || '?')[0].toUpperCase()}
            </div>
            <div>
              <h2 className="text-xl font-bold">{data.name || '—'}</h2>
              <div className="flex items-center gap-4 mt-1">
                {data.email && (
                  <span className="flex items-center gap-1.5 text-muted text-xs">
                    <Mail size={12} />{data.email}
                  </span>
                )}
                {data.phone && (
                  <span className="flex items-center gap-1.5 text-muted text-xs">
                    <Phone size={12} />{data.phone}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Edit toggle */}
          <button onClick={() => { setEditing(e => !e); setEditName(data.name || ''); setEditSkills((data.skills||[]).join(', ')) }}
            className="btn-secondary text-xs py-2 px-3 flex-shrink-0">
            <Pencil size={13} /> {editing ? 'Cancel' : 'Edit'}
          </button>
        </div>

        {/* Summary */}
        {data.summary && (
          <p className="text-sm text-muted leading-relaxed border-l-2 border-purple-500/40 pl-3">
            {data.summary}
          </p>
        )}
      </div>

      {/* Inline edit form */}
      {editing && (
        <div className="glass p-5 mb-4 border border-purple-500/30 animate-scale-in">
          <h3 className="font-semibold mb-4 flex items-center gap-2 text-sm">
            <Pencil size={14} className="text-purple-400" /> Edit Details
          </h3>
          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="text-xs text-muted block mb-1.5">Full Name</label>
              <input value={editName} onChange={e => setEditName(e.target.value)} className="input-field" placeholder="Your full name" />
            </div>

            {/* Skills */}
            <div>
              <label className="text-xs text-muted block mb-1.5">Skills (comma-separated)</label>
              <textarea value={editSkills} onChange={e => setEditSkills(e.target.value)}
                rows={2} className="input-field resize-none" placeholder="React, Python, SQL…" />
            </div>

            {/* Add skill quick-add */}
            <div className="flex gap-2">
              <input value={newSkill} onChange={e => setNewSkill(e.target.value)}
                onKeyDown={e => { if(e.key==='Enter') { e.preventDefault(); addSkill() } }}
                placeholder="Add a skill…" className="input-field flex-1 text-sm py-2" />
              <button onClick={addSkill} className="btn-primary py-2 px-4 text-sm">
                <Plus size={14} /> Add
              </button>
            </div>

            {/* Preview tags */}
            <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
              {editSkills.split(',').map(s => s.trim()).filter(Boolean).map(skill => (
                <span key={skill} className="badge-purple flex items-center gap-1">
                  {skill}
                  <button onClick={() => removeSkill(skill)} className="hover:text-red-400 transition-colors">
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>

            <button onClick={saveEdits} className="btn-primary text-sm py-2.5 w-full">
              <CheckCircle size={15} /> Save Changes
            </button>
          </div>
        </div>
      )}

      {/* Skills */}
      {displaySkills.length > 0 && (
        <div className="glass p-5 mb-4">
          <h3 className="flex items-center gap-2 font-semibold text-sm mb-3">
            <Code2 size={15} className="text-cyan-400" /> Skills
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {displaySkills.map((skill, i) => (
              <span key={i} className={`badge ${i < 5 ? 'badge-purple' : 'badge-cyan'}`}>{skill}</span>
            ))}
            {data.skills?.length > 20 && (
              <span className="badge-purple">+{data.skills.length - 20} more</span>
            )}
          </div>
        </div>
      )}

      {/* Experience */}
      {data.experience?.length > 0 && (
        <div className="glass p-5 mb-4">
          <h3 className="flex items-center gap-2 font-semibold text-sm mb-4">
            <Briefcase size={15} className="text-purple-400" /> Experience
          </h3>
          <div className="space-y-3">
            {data.experience.map((exp, i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="flex flex-col items-center">
                  <div className="w-2 h-2 rounded-full bg-purple-500 mt-1.5 flex-shrink-0" />
                  {i < data.experience.length - 1 && (
                    <div className="w-0.5 flex-1 bg-purple-500/20 mt-1" style={{ minHeight: 20 }} />
                  )}
                </div>
                <div className="pb-3">
                  <p className="font-semibold text-sm">{exp.role || '—'}</p>
                  <p className="text-muted text-xs">{exp.company} · {exp.duration}</p>
                  {exp.points?.slice(0,2).map((pt, j) => (
                    <p key={j} className="text-muted text-xs mt-0.5">• {pt}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Projects */}
      {data.projects?.length > 0 && (
        <div className="glass p-5 mb-6">
          <h3 className="flex items-center gap-2 font-semibold text-sm mb-3">
            <FolderGit2 size={15} className="text-amber-400" /> Projects
          </h3>
          <div className="space-y-3">
            {data.projects.map((proj, i) => (
              <div key={i} className="p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <p className="font-semibold text-sm">{proj.name}</p>
                <p className="text-muted text-xs mt-0.5 leading-relaxed">{proj.description}</p>
                {proj.tech_stack?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {proj.tech_stack.slice(0,5).map(t => (
                      <span key={t} className="badge-cyan text-[10px] py-0.5">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        <button id="edit-resume-btn" onClick={onEdit} className="btn-secondary flex-1">
          ← Re-upload
        </button>
        <button
          id="confirm-resume-btn"
          onClick={() => onConfirm(data)}
          className="btn-primary flex-1"
        >
          <CheckCircle size={17} /> Looks Good, Continue
        </button>
      </div>
    </div>
  )
}
