import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setUser(s?.user ?? null)
      if (s?.access_token) {
        localStorage.setItem('access_token', s.access_token)
      } else {
        localStorage.removeItem('access_token')
      }
      setLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  const signInWithEmail = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  const signUpWithEmail = async (email, password, name = '') => {
    const { data, error } = await supabase.auth.signUp({
      email, password, options: { data: { full_name: name } },
    })
    if (error) throw error
    return data
  }

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
    await supabase.auth.signOut()
    localStorage.removeItem('access_token')
    localStorage.removeItem('profile_id')
    localStorage.removeItem('parsed_profile')
    localStorage.removeItem('student_meta')
    setUser(null)
    setSession(null)
  }

  const value = {
    user, session, loading,
    signInWithEmail, signUpWithEmail, signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuthContext() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthContext must be used within <AuthProvider>')
  return ctx
}

export default AuthContext
