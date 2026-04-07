/**
 * AuthContext — global auth state via React Context.
 *
 * [AUTH DISABLED] — Supabase OAuth/login is temporarily disabled.
 * This provider now returns a mock "always-authenticated" user so the
 * rest of the application works without any Supabase configuration.
 *
 * To re-enable: restore the original Supabase-backed implementation
 * from git history and set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY.
 */
import { createContext, useContext, useState } from 'react'

// ── Original Supabase import (commented out) ──
// import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

/** Mock user object that satisfies every component that reads user.id / user.email */
const MOCK_USER = {
  id: 'dev-user',
  email: 'dev@localhost',
  user_metadata: { full_name: 'Developer' },
}

export function AuthProvider({ children }) {
  // Always authenticated with the mock user — no loading state needed
  const [user]    = useState(MOCK_USER)
  const [session] = useState({ access_token: 'dev-token' })
  const loading   = false

  // ── Original Supabase auth logic (commented out) ──────────────────────────
  // const [user, setUser]       = useState(null)
  // const [session, setSession] = useState(null)
  // const [loading, setLoading] = useState(true)
  //
  // useEffect(() => {
  //   const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
  //     setSession(s)
  //     setUser(s?.user ?? null)
  //     if (s?.access_token) {
  //       localStorage.setItem('access_token', s.access_token)
  //     } else {
  //       localStorage.removeItem('access_token')
  //     }
  //     setLoading(false)
  //   })
  //   return () => subscription.unsubscribe()
  // }, [])
  // ──────────────────────────────────────────────────────────────────────────

  // ── Stubbed auth methods (no-ops) ─────────────────────────────────────────
  const signInWithEmail = async () => { /* no-op: auth disabled */ }
  const signUpWithEmail = async () => { /* no-op: auth disabled */ }
  const signInWithGoogle = async () => { /* no-op: auth disabled */ }
  const signOut = async () => {
    // Clear local caches so the Upload page acts like a fresh start
    localStorage.removeItem('access_token')
    localStorage.removeItem('profile_id')
    localStorage.removeItem('parsed_profile')
    localStorage.removeItem('student_meta')
  }

  // ── Original Supabase auth methods (commented out) ────────────────────────
  // const signInWithEmail = async (email, password) => {
  //   const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  //   if (error) throw error
  //   return data
  // }
  // const signUpWithEmail = async (email, password, name = '') => {
  //   const { data, error } = await supabase.auth.signUp({
  //     email, password,
  //     options: { data: { full_name: name } },
  //   })
  //   if (error) throw error
  //   return data
  // }
  // const signInWithGoogle = async () => {
  //   const { data, error } = await supabase.auth.signInWithOAuth({
  //     provider: 'google',
  //     options: { redirectTo: `${window.location.origin}/dashboard` },
  //   })
  //   if (error) throw error
  //   return data
  // }
  // const signOut = async () => {
  //   await supabase.auth.signOut()
  //   localStorage.removeItem('access_token')
  //   localStorage.removeItem('profile_id')
  //   localStorage.removeItem('parsed_profile')
  //   localStorage.removeItem('student_meta')
  //   setUser(null)
  //   setSession(null)
  // }
  // ──────────────────────────────────────────────────────────────────────────

  const value = {
    user, session, loading,
    signInWithEmail, signUpWithEmail, signInWithGoogle, signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/**
 * Hook to consume auth context — must be used inside <AuthProvider>.
 */
export function useAuthContext() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthContext must be used within <AuthProvider>')
  return ctx
}

export default AuthContext
