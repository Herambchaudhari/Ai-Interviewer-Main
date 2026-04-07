/**
 * ProtectedRoute — guards routes that require auth.
 *
 * [AUTH DISABLED] — Always renders children since auth is bypassed.
 * To re-enable: restore the original gate logic from git history.
 */

// ── Original auth-gated implementation (commented out) ──────────────────────
// import { Navigate } from 'react-router-dom'
// import { useAuth } from '../hooks/useAuth'
// import LoadingSpinner from './LoadingSpinner'
//
// export default function ProtectedRoute({ children }) {
//   const { user, loading } = useAuth()
//   if (loading) return <LoadingSpinner fullScreen message="Checking authentication…" />
//   if (!user)   return <Navigate to="/auth" replace />
//   return children
// }
// ─────────────────────────────────────────────────────────────────────────────

export default function ProtectedRoute({ children }) {
  // Auth disabled — always allow access
  return children
}
