export function isFullscreenSupported() {
  if (typeof document === 'undefined') return false

  return Boolean(
    document.documentElement?.requestFullscreen
    || document.documentElement?.webkitRequestFullscreen
    || document.exitFullscreen
    || document.webkitExitFullscreen
  )
}

export function getFullscreenElement() {
  if (typeof document === 'undefined') return null
  return document.fullscreenElement || document.webkitFullscreenElement || null
}

export function isFullscreenActive() {
  return Boolean(getFullscreenElement())
}

export async function requestAppFullscreen(element = document.documentElement) {
  if (!element) return false

  try {
    if (element.requestFullscreen) {
      await element.requestFullscreen()
      return true
    }

    if (element.webkitRequestFullscreen) {
      element.webkitRequestFullscreen()
      return true
    }
  } catch {
    return false
  }

  return false
}

export async function exitAppFullscreen() {
  if (typeof document === 'undefined') return false

  try {
    if (document.exitFullscreen) {
      await document.exitFullscreen()
      return true
    }

    if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen()
      return true
    }
  } catch {
    return false
  }

  return false
}
