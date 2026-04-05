import { useState, useEffect, useRef } from 'react'
import {
  FolderOpen, Link as LinkIcon, Github, Linkedin, CheckCircle2, Loader2, Plus, FileText, File, ExternalLink, Trash2
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  getPortfolioFiles,
  uploadPortfolioFile,
  deletePortfolioFile,
  getExternalLinks,
  updateExternalLinks
} from '../../lib/api'

export default function PortfolioSection() {
  const [loading, setLoading] = useState(true)
  const [savingLinks, setSavingLinks] = useState(false)
  const [uploading, setUploading] = useState(false)

  // Data states
  const [files, setFiles] = useState([])
  const [links, setLinks] = useState({
    linkedin_url: '',
    github_url: '',
    portfolio_url: '',
    other_links: []
  })

  // Upload modal state
  const [uploadCategory, setUploadCategory] = useState(null)
  
  const fileInputRef = useRef(null)
  const [uploadData, setUploadData] = useState({ title: '', semester_year: '' })

  const loadData = async () => {
    try {
      setLoading(true)
      const [filesRes, linksRes] = await Promise.all([
        getPortfolioFiles(),
        getExternalLinks()
      ])
      if (filesRes.success) setFiles(filesRes.data || [])
      if (linksRes.success && linksRes.data) {
        setLinks({
          linkedin_url: linksRes.data.linkedin_url || '',
          github_url: linksRes.data.github_url || '',
          portfolio_url: linksRes.data.portfolio_url || '',
          other_links: linksRes.data.other_links || []
        })
      }
    } catch (e) {
      toast.error("Failed to load portfolio")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleLinksSave = async () => {
    try {
      setSavingLinks(true)
      const res = await updateExternalLinks(links)
      if (res.success) toast.success("Links saved!")
    } catch (e) {
      toast.error("Failed to save links")
    } finally {
      setSavingLinks(false)
    }
  }

  const handleDeleteFile = async (id) => {
    if (!window.confirm("Delete this file?")) return
    try {
      const res = await deletePortfolioFile(id)
      if (res.success) {
        setFiles(prev => prev.filter(f => f.id !== id))
        toast.success("File deleted")
      }
    } catch {
      toast.error("Error deleting file")
    }
  }

  const triggerUpload = (category) => {
    setUploadCategory(category)
    setUploadData({ title: '', semester_year: '' })
    setTimeout(() => {
      fileInputRef.current?.click()
    }, 100)
  }

  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    // Quick title generation if not provided
    const defaultTitle = uploadData.title || file.name

    try {
      setUploading(true)
      const formData = new FormData()
      formData.append('file', file)
      formData.append('title', defaultTitle)
      formData.append('file_category', uploadCategory)
      if (uploadCategory === 'grade_card' && uploadData.semester_year) {
        formData.append('semester_year', uploadData.semester_year)
      }

      const res = await uploadPortfolioFile(formData)
      if (res.success) {
        setFiles([res.data, ...files])
        toast.success("File uploaded successfully!")
      }
    } catch (err) {
      toast.error("Upload failed")
    } finally {
      setUploading(false)
      setUploadCategory(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  if (loading) return <div className="p-8 flex justify-center"><Loader2 size={24} className="animate-spin text-purple-500"/></div>

  const gradeCards = files.filter(f => f.file_category === 'grade_card')
  const reports = files.filter(f => f.file_category === 'project_report')
  const publications = files.filter(f => f.file_category === 'publication')

  return (
    <div className="animate-fade-in-up space-y-8 pb-10">
      
      {/* Link Settings */}
      <div className="glass p-6 border rounded-2xl" style={{ borderColor: 'var(--color-border)' }}>
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-white">
          <LinkIcon size={20} className="text-blue-400" />
          External Links
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-semibold mb-1 text-muted">LinkedIn URL</label>
            <div className="relative">
              <Linkedin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input 
                className="input-field pl-9" 
                placeholder="https://linkedin.com/in/username" 
                value={links.linkedin_url} 
                onChange={e => setLinks({...links, linkedin_url: e.target.value})}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1 text-muted">GitHub URL</label>
            <div className="relative">
              <Github size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input 
                className="input-field pl-9" 
                placeholder="https://github.com/username" 
                value={links.github_url} 
                onChange={e => setLinks({...links, github_url: e.target.value})}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1 text-muted">Portfolio / Personal Website</label>
            <div className="relative">
              <ExternalLink size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input 
                className="input-field pl-9" 
                placeholder="https://mywebsite.com" 
                value={links.portfolio_url} 
                onChange={e => setLinks({...links, portfolio_url: e.target.value})}
              />
            </div>
          </div>
        </div>

        <button 
          onClick={handleLinksSave} 
          disabled={savingLinks}
          className="btn-primary py-2 px-6 text-sm flex items-center gap-2"
        >
          {savingLinks ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
          Save Links
        </button>
      </div>

      <input 
        type="file" 
        className="hidden" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Grade Cards */}
        <div className="glass p-6 border rounded-2xl" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold flex items-center gap-2 text-white">
              <FileText size={20} className="text-green-400" />
              Grade Cards
            </h3>
            <button 
              onClick={() => triggerUpload('grade_card')}
              className="text-xs flex items-center gap-1 bg-green-500/20 text-green-400 px-3 py-1.5 rounded-full hover:bg-green-500/30 transition-all"
            >
              {uploading && uploadCategory === 'grade_card' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Upload
            </button>
          </div>
          
          {uploadCategory === 'grade_card' && !uploading && (
             <div className="mb-4 bg-black/20 p-3 rounded-lg border border-green-500/20">
                <input 
                  placeholder="E.g. Semester 4" 
                  value={uploadData.semester_year}
                  onChange={e => setUploadData({...uploadData, semester_year: e.target.value})}
                  className="input-field mb-2 text-xs py-1.5"
                />
                <p className="text-xs text-muted">Fill then choose file</p>
             </div>
          )}

          {gradeCards.length === 0 ? (
            <p className="text-sm text-muted">No grade cards uploaded yet.</p>
          ) : (
            <ul className="space-y-3">
              {gradeCards.map(f => (
                <li key={f.id} className="flex items-center justify-between p-3 rounded-xl bg-black/20 border border-white/5">
                  <div className="flex items-center gap-3">
                    <File size={16} className="text-muted" />
                    <div>
                      <a href={f.file_url} target="_blank" rel="noreferrer" className="text-sm font-semibold hover:underline decoration-green-400">
                        {f.title}
                      </a>
                      {f.semester_year && <p className="text-xs text-muted">{f.semester_year}</p>}
                    </div>
                  </div>
                  <button onClick={() => handleDeleteFile(f.id)} className="text-red-400 hover:text-red-300 p-1">
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Project Reports */}
        <div className="glass p-6 border rounded-2xl" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold flex items-center gap-2 text-white">
              <FolderOpen size={20} className="text-yellow-400" />
              Project Reports & PPTs
            </h3>
            <button 
              onClick={() => triggerUpload('project_report')}
              className="text-xs flex items-center gap-1 bg-yellow-500/20 text-yellow-400 px-3 py-1.5 rounded-full hover:bg-yellow-500/30 transition-all"
            >
              {uploading && uploadCategory === 'project_report' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Upload
            </button>
          </div>

          {reports.length === 0 ? (
            <p className="text-sm text-muted">No project reports uploaded yet.</p>
          ) : (
            <ul className="space-y-3">
              {reports.map(f => (
                <li key={f.id} className="flex items-center justify-between p-3 rounded-xl bg-black/20 border border-white/5">
                  <div className="flex items-center gap-3">
                    <File size={16} className="text-muted" />
                    <a href={f.file_url} target="_blank" rel="noreferrer" className="text-sm font-semibold hover:underline decoration-yellow-400">
                      {f.title}
                    </a>
                  </div>
                  <button onClick={() => handleDeleteFile(f.id)} className="text-red-400 hover:text-red-300 p-1">
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        
        {/* Publications */}
        <div className="glass p-6 border rounded-2xl" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold flex items-center gap-2 text-white">
              <File size={20} className="text-purple-400" />
              Publications & Papers
            </h3>
            <button 
              onClick={() => triggerUpload('publication')}
              className="text-xs flex items-center gap-1 bg-purple-500/20 text-purple-400 px-3 py-1.5 rounded-full hover:bg-purple-500/30 transition-all"
            >
              {uploading && uploadCategory === 'publication' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Upload
            </button>
          </div>

          {publications.length === 0 ? (
            <p className="text-sm text-muted">No publications uploaded yet.</p>
          ) : (
            <ul className="space-y-3">
              {publications.map(f => (
                <li key={f.id} className="flex items-center justify-between p-3 rounded-xl bg-black/20 border border-white/5">
                  <div className="flex items-center gap-3">
                    <File size={16} className="text-muted" />
                    <a href={f.file_url} target="_blank" rel="noreferrer" className="text-sm font-semibold hover:underline decoration-purple-400">
                      {f.title}
                    </a>
                  </div>
                  <button onClick={() => handleDeleteFile(f.id)} className="text-red-400 hover:text-red-300 p-1">
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>
    </div>
  )
}
