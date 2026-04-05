/**
 * NotFound — 404 page.
 */
import { useNavigate } from 'react-router-dom'
import { Home, ArrowLeft } from 'lucide-react'

export default function NotFound() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'var(--color-bg, #0a0a1a)' }}>
      <div className="text-center max-w-md animate-fade-in-up">
        <p className="text-8xl font-black mb-4"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #22d3ee)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          404
        </p>
        <h1 className="text-2xl font-bold mb-2" style={{ color: '#e2e8f0' }}>
          Page not found
        </h1>
        <p className="text-sm mb-8" style={{ color: '#64748b' }}>
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => navigate(-1)}
            className="btn-secondary text-sm py-2.5 px-5">
            <ArrowLeft size={16} /> Go Back
          </button>
          <button onClick={() => navigate('/dashboard')}
            className="btn-primary text-sm py-2.5 px-5">
            <Home size={16} /> Dashboard
          </button>
        </div>
      </div>
    </div>
  )
}
