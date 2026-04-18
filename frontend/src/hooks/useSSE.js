/**
 * hooks/useSSE.js
 *
 * Provides submitAnswerStreaming() — a streaming alternative to api.submitAnswer().
 * Reads Server-Sent Events from /api/v1/session/answer/stream and fires callbacks
 * for each event type so the UI can update progressively.
 *
 * Event types:
 *   evaluation_start     — immediately, show loading indicator
 *   feedback_chunk       — token delta, append to feedback text
 *   evaluation_complete  — full evaluation JSON payload
 *   next_question        — next adaptive question payload
 *   session_complete     — no more questions
 *   [DONE]              — stream finished
 */

const BASE_URL = (import.meta.env.VITE_API_URL !== undefined && import.meta.env.VITE_API_URL !== '')
  ? import.meta.env.VITE_API_URL
  : ''

function getToken() {
  return localStorage.getItem('access_token') || ''
}

/**
 * Submit an answer via SSE stream.
 *
 * @param {object} payload  - Body for /answer/stream (session_id, question_id, transcript, …)
 * @param {object} handlers - Callback functions:
 *   onStart(data)           - called on evaluation_start
 *   onFeedbackChunk(text)   - called on each feedback_chunk token
 *   onEvalComplete(eval)    - called when full evaluation JSON is ready
 *   onNextQuestion(question)- called with next adaptive question
 *   onSessionComplete()     - called when session is done
 *   onError(err)            - called on network / parse error
 */
export async function submitAnswerStreaming(payload, handlers = {}) {
  const {
    onStart,
    onFeedbackChunk,
    onEvalComplete,
    onNextQuestion,
    onSessionComplete,
    onError,
  } = handlers

  let response
  try {
    response = await fetch(`${BASE_URL}/api/v1/session/answer/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    onError?.(err)
    return
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText)
    onError?.(new Error(`SSE request failed: ${response.status} — ${errText}`))
    return
  }

  const reader  = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer    = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // SSE events are separated by double newlines
      const parts = buffer.split('\n\n')
      // Keep the last (possibly incomplete) part in buffer
      buffer = parts.pop() ?? ''

      for (const part of parts) {
        const line = part.trim()
        if (!line) continue

        // Terminal sentinel
        if (line === 'data: [DONE]') break

        if (!line.startsWith('data: ')) continue

        let event
        try {
          event = JSON.parse(line.slice(6))
        } catch {
          // Partial JSON — skip, will be completed in next chunk
          buffer = line + '\n\n' + buffer
          continue
        }

        switch (event.type) {
          case 'evaluation_start':
            onStart?.(event)
            break
          case 'feedback_chunk':
            onFeedbackChunk?.(event.text ?? '')
            break
          case 'evaluation_complete':
            onEvalComplete?.(event.payload)
            break
          case 'next_question':
            onNextQuestion?.(event.payload)
            break
          case 'session_complete':
            onSessionComplete?.()
            break
          default:
            break
        }
      }
    }
  } catch (err) {
    onError?.(err)
  } finally {
    reader.cancel().catch(() => {})
  }
}

/**
 * Submit via SSE with Promise-based return (for callers that prefer await).
 * Resolves with { evaluation, nextQuestion, sessionComplete }.
 * Falls back to resolved promise on error (caller should check sessionComplete).
 */
export function submitAnswerStreamingAsync(payload) {
  return new Promise((resolve) => {
    let evaluation    = null
    let nextQuestion  = null
    let sessionComplete = false
    let feedbackText  = ''

    submitAnswerStreaming(payload, {
      onFeedbackChunk: (chunk) => { feedbackText += chunk },
      onEvalComplete:  (ev)    => { evaluation = ev },
      onNextQuestion:  (q)     => { nextQuestion = q },
      onSessionComplete: ()    => { sessionComplete = true },
      onError: (err) => {
        console.error('[useSSE] stream error:', err)
        resolve({ evaluation, nextQuestion, sessionComplete: true, error: err })
      },
    }).then(() => {
      resolve({ evaluation, nextQuestion, sessionComplete, feedbackText })
    })
  })
}
