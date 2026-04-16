/**
 * fullscreen.js — request/exit browser fullscreen for the interview room.
 * Fails silently: fullscreen is a UX enhancement, not a hard requirement.
 */

/** Returns true if the browser supports the Fullscreen API. */
export function isFullscreenSupported() {
  return Boolean(
    document.documentElement.requestFullscreen ||
    document.documentElement.webkitRequestFullscreen ||
    document.documentElement.mozRequestFullScreen ||
    document.documentElement.msRequestFullscreen
  )
}

/** Returns true if the browser is currently in fullscreen mode. */
export function isFullscreenActive() {
  return Boolean(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  )
}

/** @deprecated Use isFullscreenActive() */
export function isFullscreen() {
  return isFullscreenActive()
}

/**
 * Request fullscreen on the document element.
 * Resolves regardless of success/denial so callers can always continue.
 */
export async function requestAppFullscreen() {
  try {
    const el = document.documentElement
    if (el.requestFullscreen) {
      await el.requestFullscreen()
    } else if (el.webkitRequestFullscreen) {
      await el.webkitRequestFullscreen()
    } else if (el.mozRequestFullScreen) {
      await el.mozRequestFullScreen()
    } else if (el.msRequestFullscreen) {
      await el.msRequestFullscreen()
    }
  } catch {
    // Browser denied fullscreen — non-fatal, interview continues normally.
  }
}

/**
 * Exit fullscreen if currently active.
 */
export async function exitAppFullscreen() {
  try {
    if (isFullscreenActive()) {
      if (document.exitFullscreen) {
        await document.exitFullscreen()
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen()
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen()
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen()
      }
    }
  } catch {
    // Non-fatal
  }
}
