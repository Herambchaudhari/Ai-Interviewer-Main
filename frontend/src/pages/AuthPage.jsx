/**
 * AuthPage — Sign In / Sign Up with email + Google OAuth.
 * Dark theme, glass card, professional look.
 */
import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Brain, Mail, Lock, User, Eye, EyeOff, Sparkles, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

// GOOGLE_SVG removed — OAuth disabled for local testing

export default function AuthPage() {
  const navigate = useNavigate()
  const { user, signInWithEmail, signUpWithEmail } = useAuth()

  const [mode, setMode]               = useState('signin')
  const [name, setName]               = useState('')
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [confirmPwd, setConfirmPwd]   = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)

  // If already logged in, redirect
  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true })
  }, [user, navigate])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (mode === 'signup') {
        if (password !== confirmPwd) {
          setError('Passwords do not match.')
          setLoading(false)
          return
        }
        if (password.length < 6) {
          setError('Password must be at least 6 characters.')
          setLoading(false)
          return
        }
        await signUpWithEmail(email, password, name)
        toast.success('Account created! Check your email to verify.', { duration: 5000 })
        setMode('signin')
      } else {
        await signInWithEmail(email, password)
        toast.success('Welcome back! 🎉')
        navigate('/dashboard')
      }
    } catch (err) {
      const msg = err.message || 'Authentication failed'
      // Friendly messages
      if (msg.includes('Invalid login')) setError('Wrong email or password.')
      else if (msg.includes('already registered')) setError('This email is already registered. Try signing in.')
      else if (msg.includes('rate limit')) setError('Too many attempts. Please wait a minute.')
      else setError(msg)
    } finally {
      setLoading(false)
    }
  }

  // OAuth disabled for local testing — re-enable when needed
  // const handleGoogle = async () => {
  //   try {
  //     await signInWithGoogle()
  //   } catch (err) {
  //     setError(err.message || 'Google sign-in failed')
  //   }
  // }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 animated-bg">
      {/* Background orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full opacity-30 animate-pulse-slow"
          style={{ background: 'radial-gradient(circle, #c7d2fe, transparent)' }} />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full opacity-20 animate-pulse-slow"
          style={{ background: 'radial-gradient(circle, #a5f3fc, transparent)', animationDelay: '1s' }} />
      </div>

      <div className="w-full max-w-md animate-fade-in-up relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 animate-glow"
            style={{ background: 'linear-gradient(135deg, #5b5ef6, #06b6d4)' }}>
            <Brain size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold gradient-text mb-2">AI Interviewer</h1>
          <p style={{ color: 'var(--color-muted)' }} className="text-sm">Your personal mock interview coach powered by AI</p>
        </div>

        {/* Card */}
        <div className="glass p-8">
          {/* Tab switcher */}
          <div className="flex rounded-xl p-1 mb-6" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
            {['signin', 'signup'].map(m => (
              <button key={m} onClick={() => { setMode(m); setError(null) }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                  mode === m ? 'text-white shadow-lg' : 'text-muted hover:text-white'
                }`}
                style={mode === m ? { background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' } : {}}>
                {m === 'signin' ? 'Sign In' : 'Sign Up'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name (signup only) */}
            {mode === 'signup' && (
              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">Full Name</label>
                <div className="relative">
                  <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input id="auth-name" type="text" value={name} onChange={e => setName(e.target.value)}
                    placeholder="John Doe" className="input-field pl-10" />
                </div>
              </div>
            )}

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-muted mb-1.5">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                <input id="auth-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" required className="input-field pl-10" />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-muted mb-1.5">Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                <input id="auth-password" type={showPassword ? 'text' : 'password'}
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" required minLength={6} className="input-field pl-10 pr-10" />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted hover:text-white transition-colors">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Forgot password (signin only) */}
            {mode === 'signin' && (
              <div className="flex justify-end -mt-1">
                <Link
                  to="/forgot-password"
                  className="text-xs text-purple-400 hover:text-purple-300 font-semibold transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
            )}

            {/* Confirm password (signup only) */}
            {mode === 'signup' && (
              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">Confirm Password</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input id="auth-confirm-password" type="password"
                    value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
                    placeholder="••••••••" required minLength={6} className="input-field pl-10" />
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-xl text-sm animate-scale-in"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>
                ⚠️ {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {loading ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          {/* OAuth disabled for local testing */}
          {/* Divider + Google button hidden — re-enable when OAuth is configured */}

          <p className="text-center text-muted text-xs mt-5">
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null) }}
              className="text-purple-400 hover:text-purple-300 font-semibold transition-colors">
              {mode === 'signin' ? 'Sign up free' : 'Sign in'}
            </button>
          </p>
        </div>

        {/* Feature badges */}
        <div className="flex justify-center gap-6 mt-6 text-xs text-muted">
          {['🎤 Speech STT', '🤖 LLaMA 3.3', '📊 Smart Reports'].map(f => (
            <span key={f} className="flex items-center gap-1">{f}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
