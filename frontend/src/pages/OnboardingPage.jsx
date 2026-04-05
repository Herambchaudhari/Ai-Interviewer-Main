/**
 * OnboardingPage — 2-step wizard after first resume upload.
 *
 * Step 1: Academic Details (name, year, branch, CGPA)
 * Step 2: Target Companies (sector + individual company selection)
 *
 * On completion saves to localStorage['student_meta'] and calls
 * PATCH /api/v1/resume/profile/:id to persist in Supabase.
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { updateProfile } from '../lib/api'
import { COMPANY_SECTORS } from '../constants/companies'
import {
  User, GraduationCap, Star, ChevronRight,
  ChevronDown, ChevronUp, CheckCircle2, Loader2, Building2,
} from 'lucide-react'
import toast from 'react-hot-toast'

const YEARS = ['1st', '2nd', '3rd', '4th']

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

// ─── Step indicator ────────────────────────────────────────────────────────────
function StepDots({ current }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {[1, 2].map(n => (
        <div key={n} className="flex items-center gap-2">
          <div
            className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-all duration-300"
            style={n === current
              ? { background: 'linear-gradient(135deg,#5b5ef6,#06b6d4)', color: '#fff', boxShadow: '0 0 14px rgba(91,94,246,0.4)' }
              : n < current
                ? { background: 'var(--color-success)', color: '#fff' }
                : { background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1.5px solid var(--color-border)' }}
          >
            {n < current ? <CheckCircle2 size={13} /> : n}
          </div>
          {n < 2 && (
            <div className="w-10 h-0.5 rounded-full"
              style={{ background: n < current ? 'var(--color-success)' : 'var(--color-border)' }} />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Step 1: Academic Details ─────────────────────────────────────────────────
function AcademicStep({ data, onChange, onNext }) {
  const [errors, setErrors] = useState({})

  const validate = () => {
    const e = {}
    if (!data.name?.trim())   e.name   = 'Name is required'
    if (!data.year)            e.year   = 'Select your year'
    if (!data.branch)          e.branch = 'Select your branch'
    if (data.cgpa !== '' && (isNaN(Number(data.cgpa)) || Number(data.cgpa) < 0 || Number(data.cgpa) > 10))
      e.cgpa = 'CGPA must be between 0 and 10'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleNext = () => { if (validate()) onNext() }

  return (
    <div className="animate-fade-in-up">
      <div className="text-center mb-7">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-3"
          style={{ background: 'linear-gradient(135deg,#5b5ef6,#06b6d4)' }}>
          <GraduationCap size={24} className="text-white" />
        </div>
        <h2 className="text-2xl font-bold mb-1">Tell us about yourself</h2>
        <p className="text-muted text-sm">We'll personalise your interviews based on this</p>
      </div>

      <div className="space-y-5">
        {/* Name */}
        <div>
          <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text-2)' }}>
            <span className="flex items-center gap-1.5"><User size={13} /> Full Name</span>
          </label>
          <input
            className="input-field"
            placeholder="e.g. Heramb Chaudhari"
            value={data.name}
            onChange={e => onChange('name', e.target.value)}
          />
          {errors.name && <p className="text-xs mt-1" style={{ color: 'var(--color-error)' }}>{errors.name}</p>}
        </div>

        {/* Year */}
        <div>
          <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--color-text-2)' }}>
            Year of Engineering
          </label>
          <div className="grid grid-cols-4 gap-2">
            {YEARS.map(y => (
              <button
                key={y}
                type="button"
                onClick={() => onChange('year', y)}
                className="py-2.5 rounded-xl text-sm font-bold transition-all duration-200 border"
                style={data.year === y
                  ? { borderColor: '#5b5ef6', background: 'rgba(91,94,246,0.1)', color: '#5b5ef6' }
                  : { borderColor: 'var(--color-border)', background: 'transparent', color: 'var(--color-muted)' }}
              >
                {y}
              </button>
            ))}
          </div>
          {errors.year && <p className="text-xs mt-1" style={{ color: 'var(--color-error)' }}>{errors.year}</p>}
        </div>

        {/* Branch */}
        <div>
          <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text-2)' }}>
            Branch / Discipline
          </label>
          <select
            className="input-field"
            value={data.branch}
            onChange={e => onChange('branch', e.target.value)}
            style={{ cursor: 'pointer' }}
          >
            <option value="">Select your branch…</option>
            {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          {errors.branch && <p className="text-xs mt-1" style={{ color: 'var(--color-error)' }}>{errors.branch}</p>}
        </div>

        {/* CGPA */}
        <div>
          <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text-2)' }}>
            <span className="flex items-center gap-1.5"><Star size={13} /> Current CGPA <span className="text-xs font-normal text-muted ml-1">(optional)</span></span>
          </label>
          <input
            className="input-field"
            type="number"
            min="0"
            max="10"
            step="0.1"
            placeholder="e.g. 8.4"
            value={data.cgpa}
            onChange={e => onChange('cgpa', e.target.value)}
          />
          {errors.cgpa && <p className="text-xs mt-1" style={{ color: 'var(--color-error)' }}>{errors.cgpa}</p>}
        </div>
      </div>

      <button onClick={handleNext} className="btn-primary w-full mt-8 py-3 text-base">
        Next: Target Companies <ChevronRight size={17} />
      </button>
    </div>
  )
}

// ─── Step 2: Target Companies ─────────────────────────────────────────────────
function CompanyStep({ selectedSectors, selectedCompanies, onToggleSector, onToggleCompany, onBack, onFinish, saving }) {
  const [expanded, setExpanded] = useState({})

  const toggleExpand = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }))

  const isSectorFull = (sector) =>
    sector.companies.every(c => selectedCompanies.includes(c))

  const isSectorPartial = (sector) =>
    !isSectorFull(sector) && sector.companies.some(c => selectedCompanies.includes(c))

  const totalSelected = selectedCompanies.length

  return (
    <div className="animate-fade-in-up">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-3"
          style={{ background: 'linear-gradient(135deg,#5b5ef6,#06b6d4)' }}>
          <Building2 size={24} className="text-white" />
        </div>
        <h2 className="text-2xl font-bold mb-1">Which companies are you targeting?</h2>
        <p className="text-muted text-sm">Select sectors or individual companies — your interviews will be tailored accordingly</p>
      </div>

      {totalSelected > 0 && (
        <div className="mb-4 px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 animate-scale-in"
          style={{ background: 'rgba(91,94,246,0.08)', color: '#5b5ef6', border: '1px solid rgba(91,94,246,0.2)' }}>
          <CheckCircle2 size={13} />
          {totalSelected} {totalSelected === 1 ? 'company' : 'companies'} selected
        </div>
      )}

      <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
        {COMPANY_SECTORS.map(sector => {
          const full    = isSectorFull(sector)
          const partial = isSectorPartial(sector)
          const isOpen  = expanded[sector.id]

          return (
            <div key={sector.id}
              className="rounded-2xl border transition-all duration-200"
              style={{
                borderColor: full || partial ? sector.colorBorder : 'var(--color-border)',
                background: full || partial ? sector.colorLight : 'var(--color-surface)',
                boxShadow: full ? `0 2px 12px ${sector.colorBorder}` : 'var(--shadow-sm)',
              }}>

              {/* Sector header row */}
              <div className="flex items-center gap-3 p-3.5 cursor-pointer"
                onClick={() => onToggleSector(sector)}>

                {/* Checkbox visual */}
                <div className="flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all"
                  style={{
                    borderColor: full ? sector.color : partial ? sector.color : 'var(--color-border)',
                    background: full ? sector.color : partial ? `${sector.color}30` : 'transparent',
                  }}>
                  {full    && <CheckCircle2 size={11} className="text-white" />}
                  {partial && <div className="w-2 h-2 rounded-sm" style={{ background: sector.color }} />}
                </div>

                <span className="text-lg leading-none">{sector.icon}</span>

                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm" style={{ color: full || partial ? sector.color : 'var(--color-text)' }}>
                    {sector.label}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{sector.description}</p>
                </div>

                {/* Expand toggle */}
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); toggleExpand(sector.id) }}
                  className="p-1 rounded-lg transition-colors hover:bg-black/5 flex-shrink-0"
                  style={{ color: 'var(--color-muted)' }}>
                  {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </button>
              </div>

              {/* Individual companies (expandable) */}
              {isOpen && (
                <div className="px-4 pb-4 pt-1 border-t animate-slide-down"
                  style={{ borderColor: 'var(--color-border)' }}>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {sector.companies.map(company => {
                      const selected = selectedCompanies.includes(company)
                      return (
                        <button
                          key={company}
                          type="button"
                          onClick={() => onToggleCompany(company)}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all duration-150"
                          style={selected
                            ? { borderColor: sector.color, background: sector.colorLight, color: sector.color }
                            : { borderColor: 'var(--color-border)', background: 'transparent', color: 'var(--color-muted)' }}
                        >
                          {selected && '✓ '}{company}
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

      <div className="flex gap-3 mt-6">
        <button onClick={onBack} className="btn-secondary py-3 px-5">
          ← Back
        </button>
        <button
          onClick={onFinish}
          disabled={saving || totalSelected === 0}
          className="btn-primary flex-1 py-3 text-base"
        >
          {saving
            ? <><Loader2 size={17} className="animate-spin" /> Saving…</>
            : <><CheckCircle2 size={17} /> Finish Setup</>}
        </button>
      </div>
      {totalSelected === 0 && (
        <p className="text-center text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
          Select at least one company to continue
        </p>
      )}
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function OnboardingPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)

  // Step 1 state
  const [academic, setAcademic] = useState({
    name:   '',
    year:   '',
    branch: '',
    cgpa:   '',
  })

  // Step 2 state
  const [selectedSectors,   setSelectedSectors]   = useState([])
  const [selectedCompanies, setSelectedCompanies] = useState([])

  // Pre-fill name from parsed_profile
  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('parsed_profile') || '{}')
      if (parsed.name) setAcademic(prev => ({ ...prev, name: parsed.name }))
    } catch {}
  }, [])

  // If already onboarded and navigated here, skip to dashboard
  useEffect(() => {
    const existing = localStorage.getItem('student_meta')
    if (existing) {
      // Already onboarded — only reach here if they clicked "Re-setup"
      // Don't auto-redirect; let them redo it if they want
    }
  }, [])

  const updateAcademic = (key, value) =>
    setAcademic(prev => ({ ...prev, [key]: value }))

  // Toggle whole sector (select all / deselect all its companies)
  const toggleSector = (sector) => {
    const allSelected = sector.companies.every(c => selectedCompanies.includes(c))
    if (allSelected) {
      // Deselect all companies in this sector
      setSelectedCompanies(prev => prev.filter(c => !sector.companies.includes(c)))
      setSelectedSectors(prev => prev.filter(id => id !== sector.id))
    } else {
      // Select all companies in this sector
      setSelectedCompanies(prev => [...new Set([...prev, ...sector.companies])])
      setSelectedSectors(prev => [...new Set([...prev, sector.id])])
    }
  }

  // Toggle individual company
  const toggleCompany = (company) => {
    setSelectedCompanies(prev => {
      const next = prev.includes(company)
        ? prev.filter(c => c !== company)
        : [...prev, company]

      // Update sectors: a sector is "selected" if ALL its companies are selected
      const newSectors = COMPANY_SECTORS
        .filter(s => s.companies.every(c => next.includes(c)))
        .map(s => s.id)
      setSelectedSectors(newSectors)

      return next
    })
  }

  const handleFinish = async () => {
    setSaving(true)
    const profileId = localStorage.getItem('profile_id')

    const studentMeta = {
      name:               academic.name.trim(),
      year:               academic.year,
      branch:             academic.branch,
      cgpa:               academic.cgpa !== '' ? parseFloat(academic.cgpa) : null,
      target_sectors:     selectedSectors,
      target_companies:   selectedCompanies,
    }

    // Save to localStorage immediately
    localStorage.setItem('student_meta', JSON.stringify(studentMeta))

    // Persist to backend (non-blocking on failure)
    if (profileId) {
      try {
        await updateProfile(profileId, studentMeta)
      } catch {
        // Non-fatal — localStorage is source of truth for now
      }
    }

    setSaving(false)
    toast.success('Profile set up! Welcome aboard.')
    navigate('/dashboard')
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 pt-20 animated-bg">
      {/* Background orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-80 h-80 rounded-full opacity-15 animate-pulse-slow"
          style={{ background: 'radial-gradient(circle, #5b5ef6, transparent)' }} />
        <div className="absolute -bottom-32 -left-32 w-72 h-72 rounded-full opacity-10 animate-pulse-slow"
          style={{ background: 'radial-gradient(circle, #06b6d4, transparent)', animationDelay: '2s' }} />
      </div>

      <div className="w-full max-w-lg relative z-10">
        <StepDots current={step} />

        <div className="glass p-7 shadow-lg" style={{ borderColor: 'var(--color-border)' }}>
          {/* Step label */}
          <p className="text-xs font-semibold uppercase tracking-widest mb-5"
            style={{ color: 'var(--color-muted)' }}>
            Step {step} of 2
          </p>

          {step === 1 && (
            <AcademicStep
              data={academic}
              onChange={updateAcademic}
              onNext={() => setStep(2)}
            />
          )}

          {step === 2 && (
            <CompanyStep
              selectedSectors={selectedSectors}
              selectedCompanies={selectedCompanies}
              onToggleSector={toggleSector}
              onToggleCompany={toggleCompany}
              onBack={() => setStep(1)}
              onFinish={handleFinish}
              saving={saving}
            />
          )}
        </div>

        <p className="text-center text-xs mt-4" style={{ color: 'var(--color-muted)' }}>
          You can change all of this later in Settings
        </p>
      </div>
    </div>
  )
}
