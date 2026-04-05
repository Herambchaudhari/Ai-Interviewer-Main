/**
 * Navbar — visible on all pages except /auth and during interviews.
 * Shows logo, user email, dashboard link, sign out.
 */
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Brain, LogOut, LayoutDashboard, Upload, Settings, Layers } from 'lucide-react'
import toast from 'react-hot-toast'

export default function Navbar() {
  const { user, signOut } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()
  const path      = location.pathname

  // Hide on auth page and during active interview/coding sessions
  const hidden = !user
    || path === '/auth'
    || path.startsWith('/interview/')
    || path.startsWith('/coding/')
  if (hidden) return null

  const handleSignOut = async () => {
    try {
      await signOut()
      toast.success('Signed out successfully')
      navigate('/auth')
    } catch {
      toast.error('Sign out failed')
    }
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-3 no-print"
      style={{
        background: 'rgba(255,255,255,0.9)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--color-border)',
        boxShadow: '0 1px 4px rgba(15,23,42,0.06)',
      }}>

      {/* Logo */}
      <Link to="/dashboard" className="flex items-center gap-2.5 group">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center transition-transform group-hover:scale-105"
          style={{ background: 'linear-gradient(135deg, #5b5ef6, #06b6d4)' }}>
          <Brain size={18} className="text-white" />
        </div>
        <span className="font-bold text-lg gradient-text hidden sm:block">AI Interviewer</span>
      </Link>

      {/* Right side */}
      <div className="flex items-center gap-2">
        <span className="text-muted text-xs hidden md:block mr-1 max-w-[180px] truncate">
          {user.email}
        </span>

        <Link to="/" className="btn-secondary text-xs py-2 px-3 hidden sm:flex items-center gap-1.5"
          title="Upload Resume">
          <Upload size={14} /> Upload
        </Link>

        <Link to="/dashboard" className="btn-secondary text-xs py-2 px-3 flex items-center gap-1.5">
          <LayoutDashboard size={14} />
          <span className="hidden sm:inline">Dashboard</span>
        </Link>

        <Link to="/context-hub" className="btn-secondary text-xs py-2 px-3 flex items-center gap-1.5"
          title="Context Hub">
          <Layers size={14} />
          <span className="hidden sm:inline">Hub</span>
        </Link>

        <Link to="/settings" className="btn-secondary text-xs py-2 px-3 flex items-center gap-1.5"
          title="Settings">
          <Settings size={14} />
          <span className="hidden sm:inline">Settings</span>
        </Link>

        <button onClick={handleSignOut}
          className="btn-secondary text-xs py-2 px-3 flex items-center gap-1.5"
          title="Sign Out">
          <LogOut size={14} />
          <span className="hidden sm:inline">Sign Out</span>
        </button>
      </div>
    </nav>
  )
}
