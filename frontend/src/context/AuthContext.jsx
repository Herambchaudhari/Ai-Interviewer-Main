/**
 * AuthContext — global auth state via React Context.
 * Wraps Supabase auth + JWT storage for the axios interceptor.
 */
import { createContext, useContext, useState, useEffect } from 'react'
// import { supabase } from '../lib/supabase'  // AUTH DISABLED

const AuthContext = createContext(null)

// AUTH DISABLED — mock user so all pages work without login
const MOCK_USER = { id: 'dev-user', email: 'dev@localhost', user_metadata: { full_name: 'Dev User' } }

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(MOCK_USER)   // AUTH DISABLED: was null
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(false)        // AUTH DISABLED: was true

  // AUTH DISABLED — Supabase auth listener commented out
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

  // AUTH DISABLED — stub implementations
  const signInWithEmail = async (_email, _password) => { return { user: MOCK_USER } }
  const signUpWithEmail = async (_email, _password, _name = '') => { return { user: MOCK_USER } }

  // AUTH DISABLED — original implementations commented out
  // const signInWithEmail = async (email, password) => {
  //   const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  //   if (error) throw error
  //   return data
  // }
  // const signUpWithEmail = async (email, password, name = '') => {
  //   const { data, error } = await supabase.auth.signUp({
  //     email, password, options: { data: { full_name: name } },
  //   })
  //   if (error) throw error
  //   return data
  // }

  // OAuth disabled — re-enable when Google OAuth is configured in Supabase
  // const signInWithGoogle = async () => {
  //   const { data, error } = await supabase.auth.signInWithOAuth({
  //     provider: 'google',
  //     options: { redirectTo: `${window.location.origin}/dashboard` },
  //   })
  //   if (error) throw error
  //   return data
  // }

  const signOut = async () => {
    // AUTH DISABLED — original sign-out commented out
    // await supabase.auth.signOut()
    // localStorage.removeItem('access_token')
    // localStorage.removeItem('profile_id')
    // localStorage.removeItem('parsed_profile')
    // localStorage.removeItem('student_meta')
    // setUser(null)
    // setSession(null)
  }

  const value = {
    user, session, loading,
    signInWithEmail, signUpWithEmail, signOut,
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
