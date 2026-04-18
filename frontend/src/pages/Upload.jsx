import { useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { uploadResume } from '../lib/api'
import ResumePreview from '../components/ResumePreview'
import {
  Upload, FileText, AlertCircle, Loader2,
  CheckCircle2, Brain, Sparkles
} from 'lucide-react'
import toast from 'react-hot-toast'

const MAX_SIZE_MB = 5

export default function UploadPage() {
  const navigate = useNavigate()

  const [file, setFile]           = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [parsed, setParsed]       = useState(null)  // after parse: show preview
  const [profileId, setProfileId] = useState(null)

  const inputRef = useRef(null)

  // ── File validation ────────────────────────────────────────────────────────
  const validateFile = (f) => {
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are accepted.')
      return false
    }
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`File is too large (${(f.size / 1048576).toFixed(1)} MB). Maximum is ${MAX_SIZE_MB} MB.`)
      return false
    }
    setError(null)
    return true
  }

  const pickFile = (f) => {
    if (f && validateFile(f)) setFile(f)
  }

  // ── Drag & drop handlers ──────────────────────────────────────────────────
  const onDragOver  = (e) => { e.preventDefault(); setIsDragging(true)  }
  const onDragLeave = ()  => setIsDragging(false)
  const onDrop      = (e) => {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) pickFile(f)
  }

  // ── Upload & parse ─────────────────────────────────────────────────────────
  const handleParse = useCallback(async () => {
    if (!file) { setError('Please select a PDF first.'); return }
    setLoading(true)
    setError(null)

    try {
      const res = await uploadResume(file)
      // uploadResume returns { success, data: { profile_id, parsed }, error } (axios response.data)
      const data = res.data
      if (!data?.profile_id) throw new Error('Invalid response from server.')
      setProfileId(data.profile_id)
      setParsed(data.parsed)
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Upload failed. Please try again.'
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [file])

  // ── After preview confirmed ────────────────────────────────────────────────
  const handleConfirm = (finalParsed) => {
    localStorage.setItem('profile_id', profileId)
    localStorage.setItem('parsed_profile', JSON.stringify(finalParsed))
    // Go to onboarding to capture academic details + target companies.
    // If student_meta already exists (re-upload), go straight to dashboard.
    const hasOnboarded = Boolean(localStorage.getItem('student_meta'))
    navigate(hasOnboarded ? '/dashboard' : '/onboarding')
  }

  // ─────────────────────────────────────────────────────────────────────────
  // If parse succeeded → show preview
  if (parsed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 pt-24">
        <ResumePreview
          parsedData={parsed}
          onConfirm={handleConfirm}
          onEdit={() => { setParsed(null); setFile(null) }}
        />
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Upload UI
  return (
    <div className="min-h-screen flex items-center justify-center p-4 animated-bg">
      {/* Background orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full opacity-20 animate-pulse-slow"
          style={{ background: 'radial-gradient(circle, #7c3aed, transparent)' }} />
        <div className="absolute -bottom-40 -right-40 w-80 h-80 rounded-full opacity-10 animate-pulse-slow"
          style={{ background: 'radial-gradient(circle, #22d3ee, transparent)', animationDelay: '2s' }} />
      </div>

      <div className="w-full max-w-xl animate-fade-in-up relative z-10">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #22d3ee)' }}>
            <Brain size={28} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold mb-1">
            Upload your <span className="gradient-text">Resume</span>
          </h1>
          <p className="text-muted text-sm">We'll parse it with AI and personalise your interview</p>
        </div>

        {/* Drop zone */}
        <div
          id="resume-dropzone"
          className={`glass p-10 text-center cursor-pointer transition-all duration-300 mb-4 ${
            isDragging
              ? 'border-purple-500 shadow-[0_0_30px_rgba(124,58,237,0.5)]'
              : 'hover:border-purple-500/40'
          }`}
          style={{ borderStyle: 'dashed', borderWidth: 2 }}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => !file && inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            id="resume-file-input"
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />

          {/* No file picked */}
          {!file && (
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: 'rgba(124,58,237,0.12)', border: '1.5px dashed rgba(124,58,237,0.5)' }}>
                <Upload size={26} className="text-purple-400" />
              </div>
              <div>
                <p className="font-semibold text-lg mb-1">
                  {isDragging ? 'Drop it here!' : 'Drag & drop your PDF'}
                </p>
                <p className="text-muted text-sm">or click to browse — max {MAX_SIZE_MB} MB</p>
              </div>
            </div>
          )}

          {/* File selected */}
          {file && (
            <div className="flex flex-col items-center gap-3 animate-scale-in">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #7c3aed30, #22d3ee20)', border: '1px solid rgba(124,58,237,0.4)' }}>
                <FileText size={26} className="text-purple-400" />
              </div>
              <div>
                <p className="font-semibold truncate max-w-xs">{file.name}</p>
                <p className="text-muted text-xs mt-0.5">{(file.size / 1024).toFixed(0)} KB · PDF</p>
              </div>
              <button
                type="button"
                className="text-xs text-muted hover:text-purple-400 transition-colors underline"
                onClick={(e) => { e.stopPropagation(); setFile(null); setError(null) }}
              >
                Change file
              </button>
            </div>
          )}
        </div>

        {/* Error alert */}
        {error && (
          <div className="flex items-start gap-3 p-4 rounded-xl mb-4 animate-scale-in"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
            <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* Parse button */}
        <button
          id="parse-resume-btn"
          onClick={handleParse}
          disabled={!file || loading}
          className="btn-primary w-full text-base py-4"
        >
          {loading ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              Parsing your resume with AI…
            </>
          ) : (
            <>
              <Sparkles size={20} />
              Start Parsing
            </>
          )}
        </button>

        {/* Loading message under button */}
        {loading && (
          <p className="text-center text-muted text-xs mt-3 animate-pulse">
            This usually takes 5–10 seconds…
          </p>
        )}

        {/* Tips */}
        {!loading && (
          <div className="flex justify-center gap-6 mt-6 text-xs text-muted">
            {['✅ Text-based PDF only', '🔒 Processed securely', '⚡ AI-powered parsing'].map(t => (
              <span key={t}>{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
