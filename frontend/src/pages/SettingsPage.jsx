/**
 * SettingsPage — lets users edit their academic details and target companies
 * at any time after initial onboarding.
 *
 * Sections:
 *  1. Academic Info (name, year, branch, CGPA)
 *  2. Target Companies (same sector/company picker)
 *  3. Resume — button to re-upload
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { updateProfile } from '../lib/api'
import { supabase } from '../lib/supabase'
import { COMPANY_SECTORS } from '../constants/companies'
import {
  Settings, GraduationCap, Building2, FileText,
  Save, Loader2, ChevronDown, ChevronUp, CheckCircle2, User, Star,
} from 'lucide-react'
import toast from 'react-hot-toast'

const YEARS    = ['1st', '2nd', '3rd', '4th']
const BRANCHES = [
  'Computer Science (CS)',
  'Information Technology (IT)',
  'Electronics & TC (ENTC)',
  'Mechanical',
  'Civil',
  'Electrical',
  'Chemical',
  'Other',
]

export default function SettingsPage() {
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)

  // Academic state
  const [academic, setAcademic] = useState({ name: '', year: '', branch: '', cgpa: '' })

  // Company state
  const [selectedSectors,   setSelectedSectors]   = useState([])
  const [selectedCompanies, setSelectedCompanies] = useState([])
  const [expanded, setExpanded] = useState({})

  // Load existing student_meta on mount
  useEffect(() => {
    try {
      const meta = JSON.parse(localStorage.getItem('student_meta') || '{}')
      setAcademic({
        name:   meta.name   || '',
        year:   meta.year   || '',
        branch: meta.branch || '',
        cgpa:   meta.cgpa   != null ? String(meta.cgpa) : '',
      })
      setSelectedSectors(meta.target_sectors   || [])
      setSelectedCompanies(meta.target_companies || [])
    } catch {}
  }, [])

  const updateAcademic = (key, val) => setAcademic(prev => ({ ...prev, [key]: val }))

  const toggleExpand = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }))

  const isSectorFull    = (s) => s.companies.every(c => selectedCompanies.includes(c))
  const isSectorPartial = (s) => !isSectorFull(s) && s.companies.some(c => selectedCompanies.includes(c))

  const toggleSector = (sector) => {
    const allSelected = sector.companies.every(c => selectedCompanies.includes(c))
    if (allSelected) {
      setSelectedCompanies(prev => prev.filter(c => !sector.companies.includes(c)))
      setSelectedSectors(prev => prev.filter(id => id !== sector.id))
    } else {
      setSelectedCompanies(prev => [...new Set([...prev, ...sector.companies])])
      setSelectedSectors(prev => [...new Set([...prev, sector.id])])
    }
  }

  const toggleCompany = (company) => {
    setSelectedCompanies(prev => {
      const next = prev.includes(company)
        ? prev.filter(c => c !== company)
        : [...prev, company]
      const newSectors = COMPANY_SECTORS
        .filter(s => s.companies.every(c => next.includes(c)))
        .map(s => s.id)
      setSelectedSectors(newSectors)
      return next
    })
  }

  const handleSave = async () => {
    if (!academic.name.trim()) { toast.error('Name is required'); return }
    if (!academic.year)         { toast.error('Select your year'); return }
    if (!academic.branch)       { toast.error('Select your branch'); return }
    if (selectedCompanies.length === 0) { toast.error('Select at least one target company'); return }

    setSaving(true)
    const profileId = localStorage.getItem('profile_id')

    const studentMeta = {
      name:             academic.name.trim(),
      year:             academic.year,
      branch:           academic.branch,
      cgpa:             academic.cgpa !== '' ? parseFloat(academic.cgpa) : null,
      target_sectors:   selectedSectors,
      target_companies: selectedCompanies,
    }

    localStorage.setItem('student_meta', JSON.stringify(studentMeta))

    // Save to Supabase user_metadata so admin can always see it
    await supabase.auth.updateUser({
      data: {
        name:             studentMeta.name,
        full_name:        studentMeta.name,   // keep in sync with signup metadata key
        year:             studentMeta.year,
        branch:           studentMeta.branch,
        cgpa:             studentMeta.cgpa,
        target_sectors:   studentMeta.target_sectors,
        target_companies: studentMeta.target_companies,
      }
    })

    if (profileId) {
      try { await updateProfile(profileId, studentMeta) } catch {}
    }

    setSaving(false)
    toast.success('Settings saved!')
  }

  return (
    <div className="min-h-screen pt-24 pb-16 px-4">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-8 animate-fade-in-up">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#5b5ef6,#06b6d4)' }}>
            <Settings size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-muted text-sm">Update your academic profile and target companies</p>
          </div>
        </div>

        {/* ── Section 1: Academic Details ────────────────────────────────── */}
        <div className="glass p-6 mb-5 animate-fade-in-up delay-100">
          <h2 className="flex items-center gap-2 font-bold text-base mb-5">
            <GraduationCap size={17} className="text-purple-500" /> Academic Details
          </h2>
          <div className="space-y-4">

            {/* Name */}
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text-2)' }}>
                <span className="flex items-center gap-1.5"><User size={13} /> Full Name</span>
              </label>
              <input className="input-field" placeholder="Your full name"
                value={academic.name} onChange={e => updateAcademic('name', e.target.value)} />
            </div>

            {/* Year */}
            <div>
              <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--color-text-2)' }}>
                Year of Engineering
              </label>
              <div className="grid grid-cols-4 gap-2">
                {YEARS.map(y => (
                  <button key={y} type="button" onClick={() => updateAcademic('year', y)}
                    className="py-2.5 rounded-xl text-sm font-bold border transition-all duration-200"
                    style={academic.year === y
                      ? { borderColor: '#5b5ef6', background: 'rgba(91,94,246,0.1)', color: '#5b5ef6' }
                      : { borderColor: 'var(--color-border)', background: 'transparent', color: 'var(--color-muted)' }}>
                    {y}
                  </button>
                ))}
              </div>
            </div>

            {/* Branch */}
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text-2)' }}>
                Branch / Discipline
              </label>
              <select className="input-field" value={academic.branch}
                onChange={e => updateAcademic('branch', e.target.value)} style={{ cursor: 'pointer' }}>
                <option value="">Select your branch…</option>
                {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>

            {/* CGPA */}
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text-2)' }}>
                <span className="flex items-center gap-1.5"><Star size={13} /> CGPA <span className="text-xs font-normal text-muted ml-1">(optional)</span></span>
              </label>
              <input className="input-field" type="number" min="0" max="10" step="0.1"
                placeholder="e.g. 8.4" value={academic.cgpa}
                onChange={e => updateAcademic('cgpa', e.target.value)} />
            </div>
          </div>
        </div>

        {/* ── Section 2: Target Companies ────────────────────────────────── */}
        <div className="glass p-6 mb-5 animate-fade-in-up delay-200">
          <div className="flex items-center justify-between mb-5">
            <h2 className="flex items-center gap-2 font-bold text-base">
              <Building2 size={17} className="text-cyan-500" /> Target Companies
            </h2>
            {selectedCompanies.length > 0 && (
              <span className="badge-purple text-xs">{selectedCompanies.length} selected</span>
            )}
          </div>

          <div className="space-y-2.5">
            {COMPANY_SECTORS.map(sector => {
              const full    = isSectorFull(sector)
              const partial = isSectorPartial(sector)
              const isOpen  = expanded[sector.id]

              return (
                <div key={sector.id} className="rounded-xl border transition-all duration-200"
                  style={{
                    borderColor: full || partial ? sector.colorBorder : 'var(--color-border)',
                    background: full || partial ? sector.colorLight : 'var(--color-surface)',
                  }}>

                  <div className="flex items-center gap-3 p-3 cursor-pointer"
                    onClick={() => toggleSector(sector)}>
                    <div className="flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all"
                      style={{
                        borderColor: full ? sector.color : partial ? sector.color : 'var(--color-border)',
                        background: full ? sector.color : partial ? `${sector.color}30` : 'transparent',
                      }}>
                      {full    && <CheckCircle2 size={11} className="text-white" />}
                      {partial && <div className="w-2 h-2 rounded-sm" style={{ background: sector.color }} />}
                    </div>
                    <span className="text-base leading-none">{sector.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm" style={{ color: full || partial ? sector.color : 'var(--color-text)' }}>
                        {sector.label}
                      </p>
                    </div>
                    <button type="button" onClick={e => { e.stopPropagation(); toggleExpand(sector.id) }}
                      className="p-1 rounded-lg hover:bg-black/5 transition-colors"
                      style={{ color: 'var(--color-muted)' }}>
                      {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="px-4 pb-3 pt-1 border-t animate-slide-down"
                      style={{ borderColor: 'var(--color-border)' }}>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {sector.companies.map(company => {
                          const sel = selectedCompanies.includes(company)
                          return (
                            <button key={company} type="button" onClick={() => toggleCompany(company)}
                              className="px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all duration-150"
                              style={sel
                                ? { borderColor: sector.color, background: sector.colorLight, color: sector.color }
                                : { borderColor: 'var(--color-border)', background: 'transparent', color: 'var(--color-muted)' }}>
                              {sel && '✓ '}{company}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Section 3: Resume ─────────────────────────────────────────── */}
        <div className="glass p-6 mb-8 animate-fade-in-up delay-300">
          <h2 className="flex items-center gap-2 font-bold text-base mb-3">
            <FileText size={17} className="text-amber-500" /> Resume
          </h2>
          <p className="text-sm text-muted mb-4">
            Upload a new resume to update your skill profile. This will re-parse your resume and update all interview questions.
          </p>
          <button onClick={() => navigate('/')} className="btn-secondary text-sm py-2.5 px-5">
            <FileText size={14} /> Re-upload Resume
          </button>
        </div>

        {/* Save button */}
        <button onClick={handleSave} disabled={saving} className="btn-primary w-full py-3.5 text-base animate-fade-in-up delay-400">
          {saving
            ? <><Loader2 size={17} className="animate-spin" /> Saving…</>
            : <><Save size={17} /> Save Changes</>}
        </button>
      </div>
    </div>
  )
}
