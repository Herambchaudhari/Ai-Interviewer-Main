/**
 * useAuth.js — thin wrapper that re-exports AuthContext values.
 * Components can use either useAuth() or useAuthContext().
 */
import { useAuthContext } from '../context/AuthContext'

export function useAuth() {
  return useAuthContext()
}
