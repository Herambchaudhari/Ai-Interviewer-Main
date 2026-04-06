/**
 * ContextHubPage — central hub for all user data:
 * Reports | Analytics | Resumes | Topics | Notes | Applications
 */
import { useState, useEffect, useCallback } from 'react'
import { useAuthContext } from '../context/AuthContext'
import {
  FileText, BarChart2, Database, BookOpen,
  StickyNote, Briefcase, Layers,
} from 'lucide-react'
import LoadingSpinner from '../components/LoadingSpinner'
import ReportsSection       from '../components/hub/ReportsSection'
import AnalyticsSection     from '../components/hub/AnalyticsSection'
import ResumesSection       from '../components/hub/ResumesSection'
import TopicsMasterySection from '../components/hub/TopicsMasterySection'
import NotesSection         from '../components/hub/NotesSection'
import ApplicationsSection  from '../components/hub/ApplicationsSection'
import PortfolioSection     from '../components/hub/PortfolioSection'
import { Folder }           from 'lucide-react'

import {
  getHubReports,
  getHubAnalytics,
  getTopicsMastery,
  getApplications,
  getResumeVersions,
} from '../lib/api'
// Note: getHubReports kept for Notes tab fallback (loads sessions list)

const TABS = [
  { id: 'reports',      label: 'Reports',      icon: FileText,  color: '#7c3aed' },
  { id: 'analytics',    label: 'Analytics',    icon: BarChart2, color: '#06b6d4' },
  { id: 'resumes',      label: 'Resumes',      icon: Database,  color: '#10b981' },
  { id: 'topics',       label: 'Topics',       icon: BookOpen,  color: '#f59e0b' },
  { id: 'notes',        label: 'Notes',        icon: StickyNote,color: '#ec4899' },
  { id: 'applications', label: 'Applications', icon: Briefcase, color: '#3b82f6' },
  { id: 'portfolio',    label: 'Portfolio',    icon: Folder,    color: '#8b5cf6' },
]

export default function ContextHubPage() {
  const { user } = useAuthContext()
  const [activeTab, setActiveTab]   = useState('reports')
  const [tabData, setTabData]       = useState({})
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)

  const fetchTab = useCallback(async (tab, filters = {}) => {
    if (!user?.id) return
    setLoading(true)
    setError(null)
    try {
      let result
      switch (tab) {
        case 'reports':
          // ReportsSection is self-contained — skip pre-fetch
          return setLoading(false)
        case 'analytics':
          result = await getHubAnalytics()
          break
        case 'resumes':
          result = await getResumeVersions()
          break
        case 'topics':
          result = await getTopicsMastery()
          break
        case 'notes':
          // Notes uses the same sessions list as reports; reuse if cached
          if (tabData.reports) return setLoading(false)
          result = await getHubReports({})
          // Store under 'reports' so NotesSection can access it
          setTabData(prev => ({ ...prev, reports: result?.data }))
          return setLoading(false)
        case 'applications':
          result = await getApplications()
          break
        case 'portfolio':
          setLoading(false)
          return // data fetched inside PortfolioSection directly
        default:
          return setLoading(false)
      }
      setTabData(prev => ({ ...prev, [tab]: result?.data }))
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [user, tabData.reports])

  // Fetch on tab change
  useEffect(() => {
    fetchTab(activeTab)
  }, [activeTab, user])

  const handleResumeActivated = (profileId) => {
    // Update localStorage + refetch resumes
    localStorage.setItem('profile_id', profileId)
    fetchTab('resumes')
  }

  const handleApplicationsChanged = () => fetchTab('applications')

  const activeColor = TABS.find(t => t.id === activeTab)?.color || '#7c3aed'

  return (
    <div className="min-h-screen pt-24 pb-16 px-4">
      <div className="max-w-7xl mx-auto">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 mb-8 animate-fade-in-up">
          <div className="p-3 rounded-xl" style={{ background: 'rgba(124,58,237,0.15)' }}>
            <Layers size={24} style={{ color: '#7c3aed' }} />
          </div>
          <div>
            <h1 className="text-3xl font-bold gradient-text">Context Hub</h1>
            <p className="text-muted text-sm mt-0.5">All your interview data in one place</p>
          </div>
        </div>

        {/* ── Tab bar ─────────────────────────────────────────────────────── */}
        <div className="flex gap-1 p-1 rounded-xl mb-8 overflow-x-auto"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)' }}>
          {TABS.map(({ id, label, icon: Icon, color }) => {
            const isActive = id === activeTab
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium
                           whitespace-nowrap transition-all duration-200 flex-shrink-0"
                style={isActive
                  ? { background: `${color}20`, color: color, borderBottom: `2px solid ${color}` }
                  : { color: 'var(--color-muted)' }}
              >
                <Icon size={15} />
                {label}
              </button>
            )
          })}
        </div>

        {/* ── Content ─────────────────────────────────────────────────────── */}
        {error && (
          <div className="glass p-4 mb-6 text-red-400 text-sm border border-red-500/20">
            {error}
          </div>
        )}

        {loading ? (
          <LoadingSpinner />
        ) : (
          <>
            {activeTab === 'reports' && (
              <ReportsSection />
            )}
            {activeTab === 'analytics' && (
              <AnalyticsSection analytics={tabData.analytics || {}} />
            )}
            {activeTab === 'resumes' && (
              <ResumesSection
                resumes={tabData.resumes?.resumes || []}
                onActivated={handleResumeActivated}
                onUploaded={() => fetchTab('resumes')}
              />
            )}
            {activeTab === 'topics' && (
              <TopicsMasterySection
                topics={tabData.topics?.topics || []}
                aiRecommendations={tabData.topics?.ai_recommendations || []}
              />
            )}
            {activeTab === 'notes' && (
              <NotesSection sessions={tabData.reports?.reports || []} />
            )}
            {activeTab === 'applications' && (
              <ApplicationsSection
                applications={tabData.applications?.applications || []}
                sessions={tabData.reports?.reports || []}
                onChange={handleApplicationsChanged}
              />
            )}
            {activeTab === 'portfolio' && (
              <PortfolioSection />
            )}
          </>
        )}
      </div>
    </div>
  )
}
