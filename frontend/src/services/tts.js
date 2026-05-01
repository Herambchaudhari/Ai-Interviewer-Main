/**
 * tts.js — ElevenLabs TTS via backend proxy (primary) + Web Speech API (fallback).
 *
 * Primary:  POST /api/v1/tts  →  backend proxies ElevenLabs (Rachel, eleven_flash_v2_5)
 *           API key stays server-side; no CORS issues.
 * Fallback: Web Speech API when the backend call fails or returns an error.
 *
 * Public API (signatures unchanged):
 *   tts.speak(text, onEnd?, opts?)   — async; fire-and-forget safe
 *   tts.stop()                       — sync; immediately kills active audio
 *   tts.isSpeaking()                 — bool
 *   tts.isSupported()                — bool
 */

// ── ElevenLabs proxy state ───────────────────────────────────────────────────
let _audioEl    = null   // active <Audio> element
let _blobUrl    = null   // active object URL (must be revoked)
let _abortCtrl  = null   // AbortController for in-flight fetch
let _elSpeaking = false  // true while EL audio is playing

async function _elevenSpeak(text, onEnd) {
  _abortCtrl?.abort()
  _abortCtrl = new AbortController()
  _cleanupAudio()

  try {
    const res = await fetch('/api/v1/tts/', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text }),
      signal:  _abortCtrl.signal,
    })

    if (!res.ok) {
      console.warn(`[TTS] Backend proxy error ${res.status} — falling back to Web Speech`)
      return false
    }

    const blob = await res.blob()
    _blobUrl   = URL.createObjectURL(blob)
    _audioEl   = new Audio(_blobUrl)
    _elSpeaking = true

    _audioEl.onended = () => {
      _elSpeaking = false
      _cleanupAudio()
      onEnd?.()
    }

    _audioEl.onerror = () => {
      _elSpeaking = false
      _cleanupAudio()
    }

    try {
      await _audioEl.play()
    } catch (playErr) {
      console.warn('[TTS] Audio play() blocked:', playErr.message)
      _elSpeaking = false
      _cleanupAudio()
      return false
    }

    return true
  } catch (err) {
    if (err.name === 'AbortError') return true   // intentional stop — not an error
    console.warn('[TTS] ElevenLabs proxy failed — falling back to Web Speech:', err.message)
    return false
  }
}

function _cleanupAudio() {
  if (_audioEl) {
    _audioEl.pause()
    _audioEl.onended = null
    _audioEl.onerror = null
    _audioEl = null
  }
  if (_blobUrl) {
    try { URL.revokeObjectURL(_blobUrl) } catch {}
    _blobUrl = null
  }
}

// ── Web Speech fallback ──────────────────────────────────────────────────────
let _utterance  = null
let _voiceCache = null

function _getVoice() {
  if (_voiceCache) return _voiceCache
  const voices   = window.speechSynthesis?.getVoices() ?? []
  const preferred = [
    'Google UK English Female',
    'Google US English',
    'Microsoft Zira - English (United States)',
    'Samantha',
  ]
  for (const name of preferred) {
    const v = voices.find(v => v.name === name)
    if (v) { _voiceCache = v; return v }
  }
  return voices.find(v => v.lang?.startsWith('en')) ?? voices[0] ?? null
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => { _voiceCache = null }
}

function _webSpeechSpeak(text, onEnd, opts = {}) {
  if (!window.speechSynthesis || !text) return
  window.speechSynthesis.cancel()
  const u     = new SpeechSynthesisUtterance(text)
  const voice = _getVoice()
  if (voice) u.voice = voice
  u.rate   = opts.rate   ?? 0.93
  u.pitch  = opts.pitch  ?? 1
  u.volume = opts.volume ?? 1
  if (onEnd) u.onend = onEnd
  u.onerror = (e) => {
    if (e.error !== 'interrupted') console.warn('[TTS Web Speech error]', e.error)
  }
  _utterance = u
  window.speechSynthesis.speak(u)
}

// ── Public singleton ─────────────────────────────────────────────────────────
const tts = {
  isSupported() {
    return typeof window !== 'undefined' && (
      true /* backend proxy always attempted */ ||
      'speechSynthesis' in window
    )
  },

  /**
   * Speak text — backend ElevenLabs proxy first, Web Speech on failure.
   * Safe to call without await; onEnd fires when speech completes.
   */
  async speak(text, onEnd, opts = {}) {
    if (!text?.trim()) return
    this.stop()
    const usedEL = await _elevenSpeak(text, onEnd)
    if (!usedEL) _webSpeechSpeak(text, onEnd, opts)
  },

  /** Immediately cancel any active speech (ElevenLabs or Web Speech). */
  stop() {
    _abortCtrl?.abort()
    _abortCtrl  = null
    _elSpeaking = false
    _cleanupAudio()
    window.speechSynthesis?.cancel()
    _utterance = null
  },

  isSpeaking() {
    return _elSpeaking || (window.speechSynthesis?.speaking ?? false)
  },
}

export default tts
