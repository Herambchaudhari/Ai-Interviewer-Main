import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthContext } from '../context/AuthContext'
import { getProfile, getUserReports, getMarketNews } from '../lib/api'
import RoundCards from '../components/RoundCards'
import SessionConfig from '../components/SessionConfig'
import { COMPANY_SECTORS } from '../constants/companies'
import {
  CalendarDays, TrendingUp, ChevronRight,
  BarChart2, RefreshCcw, Trophy, Clock,
  GraduationCap, Settings, Building2, Star, Layers,
  Globe, ExternalLink, Activity, Loader2
} from 'lucide-react'
import LoadingSpinner from '../components/LoadingSpinner'
import { getReportRoute } from '../lib/routes'

const ROUND_LABELS = {
  technical:     'Technical',
  hr:            'HR / Behavioural',
  dsa:           'DSA / Coding',
  mcq_practice:  'MCQ Practice',
  system_design: 'Legacy System Design',
}

const DIFF_BADGE = {
  easy:   'badge-green',
  medium: 'badge-yellow',
  hard:   'badge-red',
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export default function DashboardPage() {
  const { user } = useAuthContext()
  const navigate = useNavigate()

  const [profile, setProfile]         = useState(null)
  const [profileId, setProfileId]     = useState(null)
  const [studentMeta, setStudentMeta] = useState(null)
  const [reports, setReports]         = useState([])
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [selectedRound, setSelectedRound]   = useState(null) 
  
  const [marketNews, setMarketNews]         = useState(null)
  const [loadingNews, setLoadingNews]       = useState(true)
  const [reloadsLeft, setReloadsLeft]       = useState(5)   // max 5 per day
  const DAILY_LIMIT                         = 5

  const fetchNews = (forceRefresh = false) => {
    setLoadingNews(true)
    const pid = localStorage.getItem('profile_id')
    if (pid) {
      getMarketNews(pid, forceRefresh)
        .then(res => {
          if (res && res.data) {
            setMarketNews(res.data)
            // Backend sends back how many reloads remain today
            if (res.data.reloads_remaining !== undefined) {
              setReloadsLeft(res.data.reloads_remaining)
            }
          }
        })
        .catch(() => {})
        .finally(() => setLoadingNews(false))
    } else {
      setLoadingNews(false)
    }
  }

  // ── Load profile + student_meta ───────────────────────────────────────────
  useEffect(() => {
    // Load student_meta from localStorage
    try {
      const raw = localStorage.getItem('student_meta')
      if (raw) setStudentMeta(JSON.parse(raw))
    } catch {}

    const pid = localStorage.getItem('profile_id')
    if (!pid) { setLoadingProfile(false); return }
    setProfileId(pid)

    // Try to load from localStorage first (fast), then sync from API
    const cached = localStorage.getItem('parsed_profile')
    if (cached) {
      try { setProfile(JSON.parse(cached)) } catch {}
    }

    getProfile(pid)
      .then(res => {
        const parsed = res.data?.parsed
        if (parsed) {
          setProfile(parsed)
          localStorage.setItem('parsed_profile', JSON.stringify(parsed))
        }
      })
      .catch(() => {/* use cached */})
      .finally(() => setLoadingProfile(false))
  }, [])

  // ── Load past reports ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return
    getUserReports(user.id)
      .then(res => setReports(res.data?.reports || []))
      .catch(() => {}) // fail silently — reports are optional
      
    fetchNews()
  }, [user])

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  // ─────────────────────────────────────────────────────────────────────────
  if (loadingProfile) return <LoadingSpinner fullScreen />

  return (
    <div className="min-h-screen pt-24 pb-16 px-4">
      <div className="max-w-5xl mx-auto">

        {/* ── Greeting ───────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-6 animate-fade-in-up">
          <div>
            <h1 className="text-4xl font-bold mb-1">
              Welcome back,{' '}
              <span className="gradient-text">
                {studentMeta?.name?.split(' ')[0] || profile?.name?.split(' ')[0] || user?.email?.split('@')[0]} 👋
              </span>
            </h1>
            <div className="flex items-center gap-2 text-muted text-sm mt-1">
              <CalendarDays size={14} />{today}
            </div>
          </div>
          {!profile && (
            <button onClick={() => navigate('/')} className="btn-secondary text-sm py-2 px-4 flex-shrink-0">
              <RefreshCcw size={14} /> Upload Resume
            </button>
          )}
        </div>

        {/* ── Student Profile Card ────────────────────────────────────────── */}
        {(studentMeta || profile) && (
          <div className="glass p-5 mb-8 animate-fade-in-up delay-100">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Academic row */}
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  {studentMeta?.year && (
                    <span className="flex items-center gap-1.5 text-sm font-semibold"
                      style={{ color: 'var(--color-text-2)' }}>
                      <GraduationCap size={15} style={{ color: '#5b5ef6' }} />
                      {studentMeta.year} Year
                    </span>
                  )}
                  {studentMeta?.branch && (
                    <span className="badge-purple">{studentMeta.branch}</span>
                  )}
                  {studentMeta?.cgpa != null && (
                    <span className="flex items-center gap-1 text-sm font-semibold"
                      style={{ color: 'var(--color-text-2)' }}>
                      <Star size={13} style={{ color: '#f59e0b' }} />
                      CGPA {studentMeta.cgpa}
                    </span>
                  )}
                </div>

                {/* Target companies */}
                {studentMeta?.target_companies?.length > 0 && (
                  <div>
                    <p className="text-xs text-muted uppercase tracking-widest mb-2 flex items-center gap-1.5">
                      <Building2 size={11} /> Targeting
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {studentMeta.target_companies.slice(0, 8).map(c => (
                        <span key={c} className="badge-cyan text-xs">{c}</span>
                      ))}
                      {studentMeta.target_companies.length > 8 && (
                        <span className="badge-purple text-xs">+{studentMeta.target_companies.length - 8} more</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Skills fallback if no student meta */}
                {!studentMeta && profile?.skills?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {profile.skills.slice(0, 6).map((skill, i) => (
                      <span key={i} className={i < 3 ? 'badge-purple' : 'badge-cyan'}>{skill}</span>
                    ))}
                    {profile.skills.length > 6 && (
                      <span className="badge-purple">+{profile.skills.length - 6} more</span>
                    )}
                  </div>
                )}
              </div>

              <Link to="/settings"
                className="btn-secondary text-xs py-2 px-3 flex-shrink-0 flex items-center gap-1.5">
                <Settings size={13} /> Edit Profile
              </Link>
            </div>
          </div>
        )}

        {/* ── Start New Interview ─────────────────────────────────────────── */}
        <div className="mb-10 animate-fade-in-up delay-200">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <TrendingUp size={20} className="text-purple-400" />
            Start New Interview
          </h2>

          {!profile && (
            <div className="glass p-6 text-center mb-4" style={{ borderStyle: 'dashed' }}>
              <p className="text-muted text-sm mb-3">Upload your resume first to start a personalised interview</p>
              <button onClick={() => navigate('/')} className="btn-primary text-sm py-2.5 px-5">
                Upload Resume
              </button>
            </div>
          )}

          {profile && !selectedRound && (
            <RoundCards onSelect={setSelectedRound} />
          )}

          {profile && selectedRound && (
            <div className="flex justify-center mt-2">
              <SessionConfig
                roundType={selectedRound}
                onBack={() => setSelectedRound(null)}
                onStart={() => {}} // navigation handled inside SessionConfig
              />
            </div>
          )}
        </div>

        {/* ── Live Market Intelligence ───────────────────────────────────── */}
        {profile && (
        <div className="mb-10 animate-fade-in-up delay-[250ms]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Globe size={20} className="text-blue-400" />
              Live Market Intelligence
            </h2>
            <div className="flex items-center gap-3">
              {loadingNews && <span className="text-xs text-muted flex items-center gap-1.5"><Loader2 size={12} className="animate-spin text-blue-400" /> Analysing Market...</span>}
              <div className="flex items-center gap-2">
                {/* Daily reload counter */}
                <span
                  title={`${reloadsLeft} of ${DAILY_LIMIT} free refreshes remaining today`}
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    reloadsLeft === 0
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : reloadsLeft <= 2
                      ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                      : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  }`}>
                  {reloadsLeft}/{DAILY_LIMIT}
                </span>
                <button
                  id="reload-news-btn"
                  onClick={() => fetchNews(true)}
                  className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 transition-all hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                  disabled={loadingNews || reloadsLeft === 0}
                  title={reloadsLeft === 0 ? 'Daily refresh limit reached. Resets tomorrow.' : 'Fetch fresh market news'}>
                  <RefreshCcw size={13} className={loadingNews ? 'animate-spin' : ''} /> Reload News
                </button>
              </div>
            </div>
          </div>

          {!loadingNews && marketNews && (
            <div className="glass p-6">
              {/* Insight Header */}
              <div className="mb-6 p-5 rounded-xl" style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Activity size={16} className="text-blue-400" />
                  <span className="font-bold text-sm tracking-wide uppercase text-blue-400">
                    AI Market Insight
                  </span>
                  {marketNews.trend_label && (
                    <span className={`ml-auto badge text-xs ${marketNews.trend_type === 'negative' ? 'badge-red' : marketNews.trend_type === 'warning' ? 'badge-yellow' : 'badge-green'}`}>
                      {marketNews.trend_label}
                    </span>
                  )}
                </div>
                <p className="text-[15px] font-medium leading-relaxed" style={{ color: 'var(--color-text)' }}>
                  {marketNews.insight}
                </p>
              </div>

              {/* Articles */}
              {marketNews.articles?.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs uppercase tracking-widest text-muted font-bold mb-3 pl-1">Verified Sources</h3>
                  {marketNews.articles.map((article, i) => (
                    <a key={i} href={article.url} target="_blank" rel="noreferrer"
                       className="block p-3.5 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-colors group">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h4 className="text-[15px] font-bold group-hover:text-blue-400 transition-colors line-clamp-1">{article.title}</h4>
                          <p className="text-xs text-muted mt-1.5 font-medium">{article.source || new URL(article.url).hostname.replace('www.', '')}</p>
                        </div>
                        <ExternalLink size={16} className="text-muted group-hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all mt-0.5" />
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        )}

        {/* ── Past Reports ───────────────────────────────────────────────── */}
        <div className="animate-fade-in-up delay-300">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <BarChart2 size={20} className="text-cyan-400" />
              Past Reports
            </h2>
            <Link to="/context-hub"
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-all duration-200"
              style={{ background: 'rgba(124,58,237,0.15)', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.3)' }}>
              <Layers size={13} /> View All in Hub
            </Link>
          </div>

          {reports.length === 0 ? (
            <div className="glass p-8 text-center">
              <Trophy size={32} className="text-muted mx-auto mb-3" />
              <p className="text-muted text-sm">No interview reports yet. Complete an interview to see your results here.</p>
            </div>
          ) : (
            <div className="glass overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {['Date', 'Round', 'Difficulty', 'Questions', 'Score', ''].map(h => (
                      <th key={h} className="text-left text-muted text-xs uppercase tracking-wider px-5 py-3 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r, i) => (
                    <tr key={r.id}
                      style={{ borderBottom: i < reports.length - 1 ? '1px solid var(--color-border)' : 'none' }}
                      className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-5 py-3.5 text-muted">
                        <div className="flex items-center gap-1.5">
                          <Clock size={12} />{formatDate(r.created_at)}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 font-medium">
                        {ROUND_LABELS[r.round_type] || r.round_type}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`badge ${DIFF_BADGE[r.difficulty] || 'badge-purple'}`}>
                          {r.difficulty}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-muted">{r.num_questions}</td>
                      <td className="px-5 py-3.5">
                        {r.overall_score != null ? (
                          <span className={`font-bold ${r.overall_score >= 7 ? 'text-green-400' : r.overall_score >= 5 ? 'text-yellow-400' : 'text-red-400'}`}>
                            {Number(r.overall_score).toFixed(1)}/10
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {r.overall_score != null && (
                          <Link to={getReportRoute(r.id)}
                            className="text-purple-400 hover:text-purple-300 text-xs font-semibold flex items-center gap-0.5 transition-colors">
                            View Report <ChevronRight size={12} />
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
