/**
 * ProtectedRoute — AUTH DISABLED: always renders children directly.
 * Original behaviour: redirect to /auth when no user session found.
 */
// import { Navigate } from 'react-router-dom'  // AUTH DISABLED
// import { useAuth } from '../hooks/useAuth'     // AUTH DISABLED
// import LoadingSpinner from './LoadingSpinner'  // AUTH DISABLED

export default function ProtectedRoute({ children }) {
  // AUTH DISABLED — original auth check commented out
  // const { user, loading } = useAuth()
  // if (loading) return <LoadingSpinner fullScreen message="Checking authentication…" />
  // if (!user)   return <Navigate to="/auth" replace />
  return children
}
