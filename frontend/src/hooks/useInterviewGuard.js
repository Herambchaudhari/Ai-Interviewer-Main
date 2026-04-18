import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'

import {
  exitAppFullscreen,
  isFullscreenActive,
  isFullscreenSupported,
  requestAppFullscreen,
} from '../lib/fullscreen'

export function useInterviewGuard({ enabled, onLimitReached, maxAttempts = 3 }) {
  const [exitAttempts, setExitAttempts] = useState(0)
  const [requiresFullscreen, setRequiresFullscreen] = useState(false)
  const [fullscreenSupported] = useState(() => isFullscreenSupported())

  const attemptsRef = useRef(0)
  const endingRef = useRef(false)
  const onLimitReachedRef = useRef(onLimitReached)

  useEffect(() => {
    onLimitReachedRef.current = onLimitReached
  }, [onLimitReached])

  const requestFullscreen = useCallback(async () => {
    if (!enabled || endingRef.current || !fullscreenSupported) return false
    if (isFullscreenActive()) {
      setRequiresFullscreen(false)
      return true
    }

    const ok = await requestAppFullscreen()
    const active = isFullscreenActive()
    setRequiresFullscreen(!active)

    return ok && active
  }, [enabled, fullscreenSupported])

  const registerAttempt = useCallback(async (source = 'fullscreen_exit') => {
    if (!enabled || endingRef.current) return

    const nextAttempts = attemptsRef.current + 1
    attemptsRef.current = nextAttempts
    setExitAttempts(nextAttempts)
    setRequiresFullscreen(!isFullscreenActive())

    if (nextAttempts >= maxAttempts) {
      endingRef.current = true
      setRequiresFullscreen(false)
      toast.error('Exit limit reached. Ending the interview and generating your report…', {
        duration: 5000,
      })
      await onLimitReachedRef.current?.(source)
      return
    }

    const remaining = maxAttempts - nextAttempts
    const action = source === 'manual_end'
      ? 'trying to end the interview'
      : 'leaving fullscreen'

    toast.error(
      `Attempt ${nextAttempts}/${maxAttempts}: ${action} is restricted. ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} left.`,
      { duration: 5000 }
    )
  }, [enabled, maxAttempts])

  const handleResumeFullscreen = useCallback(async () => {
    const ok = await requestFullscreen()
    if (ok) {
      toast.success('Fullscreen restored. Interview resumed.')
      return true
    }

    toast.error('Fullscreen is required to continue this interview.')
    return false
  }, [requestFullscreen])

  const handleManualEndAttempt = useCallback(async () => {
    await registerAttempt('manual_end')
  }, [registerAttempt])

  const releaseGuard = useCallback(async () => {
    endingRef.current = true
    setRequiresFullscreen(false)
    await exitAppFullscreen()
  }, [])

  useEffect(() => {
    if (!enabled || !fullscreenSupported) return
    requestFullscreen()
  }, [enabled, fullscreenSupported, requestFullscreen])

  useEffect(() => {
    if (!enabled || !fullscreenSupported) return

    const handleFullscreenChange = () => {
      const active = isFullscreenActive()
      setRequiresFullscreen(!active)

      if (!active && !endingRef.current) {
        registerAttempt('fullscreen_exit')
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
    }
  }, [enabled, fullscreenSupported, registerAttempt])

  return {
    exitAttempts,
    fullscreenSupported,
    maxAttempts,
    remainingAttempts: Math.max(0, maxAttempts - exitAttempts),
    requiresFullscreen,
    handleResumeFullscreen,
    handleManualEndAttempt,
    releaseGuard,
  }
}
