/**
 * TTS Service — Web Speech API singleton with voice preference.
 * Prefers "Google UK English Female", falls back to first available voice.
 */

let _utterance = null
let _voiceCache = null

function _getVoice() {
  if (_voiceCache) return _voiceCache
  const voices = window.speechSynthesis?.getVoices() ?? []

  // Priority order
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
  // Fallback: first en-US voice, then any voice
  return voices.find(v => v.lang?.startsWith('en')) ?? voices[0] ?? null
}

// Re-populate voice cache once voices load (Chrome async)
if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => { _voiceCache = null }
}

const tts = {
  isSupported() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
  },

  /**
   * Speak text aloud.
   * @param {string}    text
   * @param {Function}  [onEnd]   callback when speech finishes
   * @param {{ rate?: number, pitch?: number, volume?: number }} [opts]
   */
  speak(text, onEnd, opts = {}) {
    if (!this.isSupported() || !text) return
    this.stop()

    const u = new SpeechSynthesisUtterance(text)
    const voice = _getVoice()
    if (voice) u.voice = voice
    u.rate   = opts.rate   ?? 0.93
    u.pitch  = opts.pitch  ?? 1
    u.volume = opts.volume ?? 1
    if (onEnd) u.onend = onEnd
    u.onerror = (e) => {
      if (e.error !== 'interrupted') console.warn('[TTS error]', e.error)
    }

    _utterance = u
    window.speechSynthesis.speak(u)
  },

  /** Cancel any ongoing speech. */
  stop() {
    window.speechSynthesis?.cancel()
    _utterance = null
  },

  /** True if speech synthesis is currently active. */
  isSpeaking() {
    return window.speechSynthesis?.speaking ?? false
  },
}

export default tts
