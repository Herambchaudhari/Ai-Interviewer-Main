import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import LoadingSpinner from './LoadingSpinner'

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <LoadingSpinner fullScreen message="Checking authentication…" />
  // Token exists but React state hasn't committed yet — hold spinner instead of bouncing to /auth
  if (!user && localStorage.getItem('access_token')) {
    return <LoadingSpinner fullScreen message="Signing in…" />
  }
  if (!user) return <Navigate to="/auth" replace />
  return children
}
