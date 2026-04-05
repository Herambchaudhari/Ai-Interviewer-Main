/**
 * useAudioRecorder — MediaRecorder hook with auto-stop, audioUrl, and reset.
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import toast from 'react-hot-toast'

const DEFAULT_MAX_DURATION = 120  // seconds

export function useAudioRecorder(maxDuration = DEFAULT_MAX_DURATION) {
  const [isRecording,   setIsRecording]   = useState(false)
  const [audioBlob,     setAudioBlob]     = useState(null)
  const [audioUrl,      setAudioUrl]      = useState(null)
  const [error,         setError]         = useState(null)

  const mediaRecorderRef = useRef(null)
  const chunksRef        = useRef([])
  const streamRef        = useRef(null)
  const autoStopRef      = useRef(null)

  // Revoke old object URL on unmount / replacement
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      clearTimeout(autoStopRef.current)
    }
  }, [audioUrl])

  // ── Reset ────────────────────────────────────────────────────────────────
  const resetRecording = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioBlob(null)
    setAudioUrl(null)
    setError(null)
    chunksRef.current = []
  }, [audioUrl])

  // ── Stop (internal) ──────────────────────────────────────────────────────
  const _stopTracks = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  // ── stopRecording → returns the Blob ────────────────────────────────────
  const stopRecording = useCallback(() => {
    return new Promise((resolve) => {
      clearTimeout(autoStopRef.current)
      const mr = mediaRecorderRef.current
      if (!mr || mr.state === 'inactive') {
        setIsRecording(false)
        resolve(null)
        return
      }
      mr.onstop = () => {
        const mimeType = mr.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: mimeType })
        const url  = URL.createObjectURL(blob)
        setAudioBlob(blob)
        setAudioUrl(url)
        setIsRecording(false)
        _stopTracks()
        resolve(blob)
      }
      mr.stop()
    })
  }, [])

  // ── startRecording ───────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    setError(null)
    resetRecording()

    if (!navigator.mediaDevices?.getUserMedia) {
      const msg = 'Audio recording is not supported in this browser.'
      setError(msg)
      toast.error(msg)
      return
    }

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      const msg = err.name === 'NotAllowedError'
        ? 'Microphone permission denied. Please allow access in browser settings.'
        : `Could not access microphone: ${err.message}`
      setError(msg)
      toast.error(msg)
      return
    }

    streamRef.current = stream
    chunksRef.current = []

    // Pick best supported MIME type
    const mimeType = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
    ].find(t => MediaRecorder.isTypeSupported(t)) || ''

    const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {})
    mr.ondataavailable = e => { if (e.data?.size > 0) chunksRef.current.push(e.data) }
    mr.start(200)   // collect every 200ms so we get data quickly
    mediaRecorderRef.current = mr
    setIsRecording(true)

    // Auto-stop after maxDuration
    autoStopRef.current = setTimeout(() => {
      if (mediaRecorderRef.current?.state !== 'inactive') {
        toast('⏱ Max recording duration reached — stopping.', { icon: '⚠️' })
        stopRecording()
      }
    }, maxDuration * 1000)
  }, [maxDuration, resetRecording, stopRecording])

  return {
    isRecording,
    startRecording,
    stopRecording,
    audioBlob,
    audioUrl,
    error,
    resetRecording,
  }
}
