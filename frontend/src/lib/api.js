import axios from 'axios'
import { supabase } from './supabase'

// BASE_URL: empty string = use Vite proxy (relative URLs); fallback only if env is completely absent
const BASE_URL = (import.meta.env.VITE_API_URL !== undefined && import.meta.env.VITE_API_URL !== '')
  ? import.meta.env.VITE_API_URL
  : ''


// ── Axios Instance ─────────────────────────────────────────────────────────
const api = axios.create({ baseURL: `${BASE_URL}/api/v1` })

// Attach Supabase JWT on every request
api.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`
  }
  return config
})

// Response interceptor — log errors and re-throw cleanly
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const msg = error.response?.data?.error || error.response?.data?.detail || error.message
    console.error('[API Error]', msg, error.config?.url)
    return Promise.reject(error)
  }
)

// ── Resume ─────────────────────────────────────────────────────────────────
export async function uploadResume(file) {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await api.post('/resume/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

/** GET /api/v1/resume/profile/:profileId */
export async function getProfile(profileId) {
  const { data } = await api.get(`/resume/profile/${profileId}`)
  return data  // { success, data: { profile_id, parsed, created_at }, error }
}

/** GET /api/v1/resume/reports/user/:userId — past sessions + scores */
export async function getUserReports(userId) {
  const { data } = await api.get(`/resume/reports/user/${userId}`)
  return data  // { success, data: { reports: [], total }, error }
}

/**
 * PATCH /api/v1/resume/profile/:profileId
 * Merges student_meta (year, branch, cgpa, target_sectors, target_companies) into parsed_data.
 */
export async function updateProfile(profileId, studentMeta) {
  const { data } = await api.patch(`/resume/profile/${profileId}`, { student_meta: studentMeta })
  return data  // { success, data: { profile_id, parsed }, error }
}

// ── Session (Phase 03) ─────────────────────────────────────────────────────
/** POST /api/v1/session/start */
export async function startSession(payload) {
  // payload: { profile_id, round_type, difficulty, timer_mins, num_questions }
  const { data } = await api.post('/session/start', payload)
  return data  // { success, data: { session_id, first_question, questions, … } }
}

/** GET /api/v1/session/:sessionId */
export async function getSessionById(sessionId) {
  const { data } = await api.get(`/session/${sessionId}`)
  return data
}

// ── Interview (legacy) ─────────────────────────────────────────────────────
export async function startInterview(payload) {
  const { data } = await api.post('/interview/start', payload)
  return data
}

// ── Session Phase 05: Transcribe via faster-whisper ────────────────────────
/**
 * POST /api/v1/session/transcribe
 * Sends audio blob + metadata → returns { transcript, question_id }
 */
export async function transcribeSession(audioBlob, sessionId, questionId) {
  const fd = new FormData()
  // Detect MIME type for filename extension
  const ext = audioBlob.type?.includes('ogg') ? '.ogg'
    : audioBlob.type?.includes('wav') ? '.wav'
    : '.webm'
  fd.append('audio',       audioBlob, `recording${ext}`)
  fd.append('session_id',  sessionId)
  fd.append('question_id', questionId)
  const { data } = await api.post('/session/transcribe', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data  // { success, data: { transcript, question_id }, error }
}

/**
 * POST /api/v1/session/answer
 * Evaluate the transcript and return next question or session_complete.
 */
export async function submitSessionAnswer(payload) {
  // payload: { session_id, question_id, transcript, time_taken_secs? }
  const { data } = await api.post('/session/answer', payload)
  return data  // { success, data: { evaluation, next_question|null, session_complete }, error }
}

/**
 * POST /api/v1/session/run-code — execute via Judge0
 */
export async function runCode(payload) {
  // payload: { code, language, stdin?, session_id? }
  const { data } = await api.post('/session/run-code', payload)
  return data  // { success, data: { stdout, stderr, status, time_ms, memory_kb, success }, error }
}

// ── Transcription (old route — kept for compatibility) ─────────────────────
export async function transcribeAudio(audioBlob, filename = 'audio.webm') {
  const formData = new FormData()
  formData.append('audio', audioBlob, filename)
  const { data } = await api.post('/transcribe/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function submitAnswer(payload) {
  const { data } = await api.post('/interview/answer', payload)
  return data
}

// ── Report ─────────────────────────────────────────────────────────────────
export async function getReport(sessionId) {
  const { data } = await api.get(`/report/${sessionId}`)
  return data
}

/**
 * GET /api/v1/report/:sessionId — with SSE streaming support.
 * If the backend returns a cached report (JSON), calls onComplete immediately.
 * If it returns SSE, streams progress events until "complete".
 *
 * @param {string}   sessionId
 * @param {Function} onProgress  - ({stage, progress, label}) => void
 * @param {Function} onComplete  - (reportData) => void
 * @param {Function} onError     - (errorMessage) => void
 */
export async function getReportWithSSE(sessionId, onProgress, onComplete, onError) {
  const token = localStorage.getItem('access_token')
  const url = `${BASE_URL}/api/v1/report/${sessionId}`
  let response
  try {
    const headers = { Accept: 'text/event-stream, application/json' }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    response = await fetch(url, { headers })
  } catch (e) {
    onError(e.message || 'Network error')
    return
  }

  if (!response.ok) {
    onError(`Server error: ${response.status}`)
    return
  }

  const contentType = response.headers.get('content-type') || ''

  // Cached report — return as plain JSON
  if (contentType.includes('application/json')) {
    const data = await response.json()
    onComplete(data?.data ?? data)
    return
  }

  // SSE stream — parse line by line
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6))
          if (event.stage === 'complete') {
            onComplete(event.report)
            return
          } else if (event.stage === 'error') {
            onError(event.error || 'Report generation failed')
            return
          } else {
            onProgress(event)
          }
        } catch (_) { /* ignore malformed SSE lines */ }
      }
    }
  } catch (e) {
    onError(e.message || 'Stream read error')
  }
}

/** POST /api/v1/reports/generate — AI report generation via Groq */
export async function generateReport(sessionId) {
  const { data } = await api.post('/reports/generate', { session_id: sessionId })
  return data  // { success, data: { report_id, report }, error }
}

/** GET /api/v1/reports/:sessionId — fetch cached report */
export async function getReportV2(sessionId) {
  const { data } = await api.get(`/reports/${sessionId}`)
  return data
}

/** POST /api/v1/session/skip — skip current question, get next */
export async function skipQuestion(payload) {
  // payload: { session_id, question_id, current_question, is_last_question }
  const { data } = await api.post('/session/skip', payload)
  return data  // { success, data: { session_complete, next_question, skipped }, error }
}

/** POST /api/v1/session/end — end session + trigger async report */
export async function endSession(payload) {
  // payload: { session_id, reason?: 'completed'|'timeout'|'manual' }
  const { data } = await api.post('/session/end', payload)
  return data  // { success, data: { session_id, status, report_route, message }, error }
}

/** POST /api/v1/session/checkpoint — save current progress (Phase 5) */
export async function checkpointSession(sessionId, payload) {
  // payload: { current_question_index, scores, transcript, conversation_history,
  //            detected_weaknesses, avoided_topics, timer_remaining_secs }
  try {
    const { data } = await api.post(`/session/${sessionId}/checkpoint`, payload)
    return data
  } catch {
    return null  // checkpoint is best-effort, never throw
  }
}

/** GET /api/v1/session/:sessionId/resume — get full state for recovery (Phase 5) */
export async function resumeSession(sessionId) {
  try {
    const { data } = await api.get(`/session/${sessionId}/resume`)
    return data?.data ?? null
  } catch {
    return null
  }
}

/** GET /api/v1/session/active — list sessions with status=active for dashboard (Phase 5) */
export async function getActiveSessions() {
  try {
    const { data } = await api.get('/session/active')
    return data?.data ?? []
  } catch {
    return []
  }
}

// ── Context Hub ────────────────────────────────────────────────────────────

/** GET /api/v1/context-hub/reports — spreadsheet of all completed reports (legacy) */
export async function getHubReports({ roundType, difficulty, sortOrder } = {}) {
  const params = new URLSearchParams()
  if (roundType)  params.append('round_type',  roundType)
  if (difficulty) params.append('difficulty',  difficulty)
  if (sortOrder)  params.append('sort_order',  sortOrder)
  const qs = params.toString()
  const { data } = await api.get(`/context-hub/reports${qs ? '?' + qs : ''}`)
  return data
}

/** GET /api/v1/context-hub/reports/paginated — enhanced paginated reports spreadsheet */
export async function getHubReportsPaginated({
  roundType, difficulty, sortBy = 'date', sortDir = 'desc',
  page = 1, limit = 20, dateFrom, dateTo, minScore, maxScore
} = {}) {
  const params = new URLSearchParams()
  if (roundType)  params.append('round_type', roundType)
  if (difficulty) params.append('difficulty',  difficulty)
  params.append('sort_by',  sortBy)
  params.append('sort_dir', sortDir)
  params.append('page',     page)
  params.append('limit',    limit)
  if (dateFrom)   params.append('date_from',  dateFrom)
  if (dateTo)     params.append('date_to',    dateTo)
  if (minScore != null) params.append('min_score', minScore)
  if (maxScore != null) params.append('max_score', maxScore)
  const { data } = await api.get(`/context-hub/reports/paginated?${params.toString()}`)
  return data
}

/** GET /api/v1/context-hub/reports/summary — banner-level stats */
export async function getHubReportsSummary() {
  const { data } = await api.get('/context-hub/reports/summary')
  return data
}

/** GET /api/v1/context-hub/analytics — aggregated performance stats */
export async function getHubAnalytics() {
  const { data } = await api.get('/context-hub/analytics')
  return data
}

/** GET /api/v1/context-hub/topics-mastery — topics + proficiency + AI recs */
export async function getTopicsMastery() {
  const { data } = await api.get('/context-hub/topics-mastery')
  return data
}

/** GET /api/v1/context-hub/notes/:sessionId */
export async function getSessionNote(sessionId) {
  const { data } = await api.get(`/context-hub/notes/${sessionId}`)
  return data
}

/** POST /api/v1/context-hub/notes/:sessionId — create or update */
export async function saveSessionNote(sessionId, { content, tags }) {
  const { data } = await api.post(`/context-hub/notes/${sessionId}`, { content, tags })
  return data
}

/** GET /api/v1/context-hub/applications */
export async function getApplications(status) {
  const qs = status ? `?status=${status}` : ''
  const { data } = await api.get(`/context-hub/applications${qs}`)
  return data
}

/** POST /api/v1/context-hub/applications */
export async function createApplication(payload) {
  const { data } = await api.post('/context-hub/applications', payload)
  return data
}

/** PATCH /api/v1/context-hub/applications/:appId */
export async function updateApplication(appId, updates) {
  const { data } = await api.patch(`/context-hub/applications/${appId}`, updates)
  return data
}

/** DELETE /api/v1/context-hub/applications/:appId */
export async function deleteApplication(appId) {
  const { data } = await api.delete(`/context-hub/applications/${appId}`)
  return data
}

/** GET /api/v1/context-hub/resumes */
export async function getResumeVersions() {
  const { data } = await api.get('/context-hub/resumes')
  return data
}

/** PATCH /api/v1/context-hub/resumes/:profileId/activate */
export async function activateResume(profileId) {
  const { data } = await api.patch(`/context-hub/resumes/${profileId}/activate`)
  return data
}

// ── Portfolio ──────────────────────────────────────────────────────────────

/** GET /api/v1/portfolio/files */
export async function getPortfolioFiles() {
  const { data } = await api.get('/portfolio/files')
  return data
}

/** POST /api/v1/portfolio/upload */
export async function uploadPortfolioFile(formData) {
  const { data } = await api.post('/portfolio/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
  return data
}

/** DELETE /api/v1/portfolio/files/:fileId */
export async function deletePortfolioFile(fileId) {
  const { data } = await api.delete(`/portfolio/files/${fileId}`)
  return data
}

/** GET /api/v1/portfolio/links */
export async function getExternalLinks() {
  const { data } = await api.get('/portfolio/links')
  return data
}

/** POST /api/v1/portfolio/links */
export async function updateExternalLinks(payload) {
  const { data } = await api.post('/portfolio/links', payload)
  return data
}

// ── NEWS ──────────────────────────────────────────────────────────────────────
export async function getMarketNews(profileId, forceRefresh = false) {
  if (!profileId) return { data: null };
  const url = `/news/feed?profile_id=${profileId}${forceRefresh ? '&force_refresh=true' : ''}`
  const { data } = await api.get(url)
  return data
}


// ── Checklists ────────────────────────────────────────────────────────────────

/** GET /api/v1/context-hub/checklists */
export async function getUserChecklists(limit = 5) {
  const { data } = await api.get(`/context-hub/checklists?limit=${limit}`)
  return data
}

/** PATCH /api/v1/context-hub/checklists/:checklistId/items */
export async function toggleChecklistItem(checklistId, itemId, checked) {
  const { data } = await api.patch(`/context-hub/checklists/${checklistId}/items`, { item_id: itemId, checked })
  return data
}

// ── PROGRESS ──────────────────────────────────────────────────────────────────
export async function getUserProgress(userId, { limit = 20, roundType } = {}) {
  const params = new URLSearchParams({ limit })
  if (roundType) params.set('round_type', roundType)
  const { data } = await api.get(`/progress/${userId}?${params}`)
  return data
}


// ── Share Report ──────────────────────────────────────────────────────────────

/** POST /api/v1/share/{sessionId} — generate a public share link */
export async function generateShareLink(sessionId) {
  const { data } = await api.post(`/share/${sessionId}`)
  return data  // { success, data: { share_token, share_url }, error }
}

/** DELETE /api/v1/share/{sessionId} — revoke the share link */
export async function revokeShareLink(sessionId) {
  const { data } = await api.delete(`/share/${sessionId}`)
  return data
}

/** GET /api/v1/share/view/{token} — public, no auth needed */
export async function getSharedReport(token) {
  // Use plain fetch — no auth header — so it works for non-logged-in visitors
  const BASE = (import.meta.env.VITE_API_URL !== undefined && import.meta.env.VITE_API_URL !== '')
    ? import.meta.env.VITE_API_URL
    : ''
  const res  = await fetch(`${BASE}/api/v1/share/view/${token}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.detail || `Error ${res.status}`)
  }
  return res.json()  // { success, data: reportRow, error }
}

export default api
