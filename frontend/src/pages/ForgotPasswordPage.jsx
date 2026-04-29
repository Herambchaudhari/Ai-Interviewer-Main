/**
 * ForgotPasswordPage — request a password reset email.
 * On submit, Supabase sends a recovery link that lands on /reset-password.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Brain, Mail, ArrowLeft, Loader2, MailCheck } from 'lucide-react'
import toast from 'react-hot-toast'

export default function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth()
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await sendPasswordReset(email.trim())
      setSent(true)
      toast.success('Reset link sent! Check your inbox.', { duration: 5000 })
    } catch (err) {
      const msg = err.message || 'Failed to send reset email'
      if (msg.includes('rate limit')) setError('Too many attempts. Please wait a minute.')
      else setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 animated-bg">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full opacity-30 animate-pulse-slow"
          style={{ background: 'radial-gradient(circle, #c7d2fe, transparent)' }} />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full opacity-20 animate-pulse-slow"
          style={{ background: 'radial-gradient(circle, #a5f3fc, transparent)', animationDelay: '1s' }} />
      </div>

      <div className="w-full max-w-md animate-fade-in-up relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 animate-glow"
            style={{ background: 'linear-gradient(135deg, #5b5ef6, #06b6d4)' }}>
            <Brain size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold gradient-text mb-2">Reset Password</h1>
          <p style={{ color: 'var(--color-muted)' }} className="text-sm">
            Enter your email and we'll send you a recovery link
          </p>
        </div>

        <div className="glass p-8">
          {sent ? (
            <div className="text-center space-y-4 py-2">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full mx-auto"
                style={{ background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.4)' }}>
                <MailCheck size={28} className="text-green-400" />
              </div>
              <p className="text-white font-medium">Check your email</p>
              <p className="text-muted text-sm">
                We sent a password reset link to <span className="text-white">{email}</span>.
                The link expires in 1 hour.
              </p>
              <button
                onClick={() => { setSent(false); setEmail('') }}
                className="text-purple-400 hover:text-purple-300 text-sm font-semibold transition-colors"
              >
                Send to a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">Email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    id="reset-email" type="email" value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com" required
                    className="input-field pl-10"
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-xl text-sm animate-scale-in"
                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>
                  ⚠️ {error}
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                {loading ? 'Sending…' : 'Send Reset Link'}
              </button>
            </form>
          )}

          <Link
            to="/auth"
            className="flex items-center justify-center gap-1.5 text-muted hover:text-white text-xs mt-5 transition-colors"
          >
            <ArrowLeft size={14} /> Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
