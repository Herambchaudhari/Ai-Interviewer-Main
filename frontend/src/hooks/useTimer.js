/**
 * useTimer — enhanced countdown timer hook.
 * Features: localStorage persistence, warning callbacks, formatted output.
 *
 * @param {number}   totalSeconds  starting value in seconds
 * @param {Function} onTick        called with 'warning' when ≤5 min remaining
 * @param {Function} onExpire      called when timer reaches 0
 * @param {string}   storageKey    localStorage key for persistence (optional)
 */
import { useState, useEffect, useRef, useCallback } from 'react'

export function useTimer(totalSeconds, { onTick, onExpire, storageKey } = {}) {
  // Restore from localStorage if a key is provided
  const initSeconds = () => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const n = parseInt(saved, 10)
        if (!isNaN(n) && n > 0) return n
      }
    }
    return totalSeconds
  }

  const [timeLeft,   setTimeLeft]   = useState(initSeconds)
  const [isRunning,  setIsRunning]  = useState(false)
  const intervalRef  = useRef(null)
  const persistRef   = useRef(0)         // tick counter for localStorage persist
  const onTickRef    = useRef(onTick)
  const onExpireRef  = useRef(onExpire)
  const warnedRef    = useRef(false)

  useEffect(() => { onTickRef.current   = onTick   }, [onTick])
  useEffect(() => { onExpireRef.current = onExpire }, [onExpire])

  // ── Controls ────────────────────────────────────────────────────────────────
  const start  = useCallback(() => setIsRunning(true),  [])
  const pause  = useCallback(() => setIsRunning(false), [])
  const resume = useCallback(() => setIsRunning(true),  [])

  const reset  = useCallback((newSeconds) => {
    clearInterval(intervalRef.current)
    setIsRunning(false)
    warnedRef.current = false
    const val = newSeconds ?? totalSeconds
    setTimeLeft(val)
    if (storageKey) localStorage.setItem(storageKey, String(val))
  }, [totalSeconds, storageKey])

  // ── Tick ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isRunning) {
      clearInterval(intervalRef.current)
      return
    }

    intervalRef.current = setInterval(() => {
      setTimeLeft(prev => {
        const next = prev - 1

        // Warning at 5 min remaining
        if (next <= 300 && !warnedRef.current) {
          warnedRef.current = true
          onTickRef.current?.('warning')
        }

        // Persist to localStorage every 10 ticks
        persistRef.current += 1
        if (persistRef.current >= 10) {
          persistRef.current = 0
          if (storageKey) localStorage.setItem(storageKey, String(next))
        }

        // Expire
        if (next <= 0) {
          clearInterval(intervalRef.current)
          setIsRunning(false)
          if (storageKey) localStorage.removeItem(storageKey)
          onExpireRef.current?.()
          return 0
        }

        return next
      })
    }, 1000)

    return () => clearInterval(intervalRef.current)
  }, [isRunning, storageKey])

  // ── Format mm:ss ────────────────────────────────────────────────────────────
  const formattedTime = [
    String(Math.floor(timeLeft / 60)).padStart(2, '0'),
    String(timeLeft % 60).padStart(2, '0'),
  ].join(':')

  // ── Color hint ──────────────────────────────────────────────────────────────
  const colorState = timeLeft <= 60 ? 'red' : timeLeft <= 300 ? 'amber' : 'white'

  return { timeLeft, formattedTime, colorState, isRunning, start, pause, resume, reset }
}
