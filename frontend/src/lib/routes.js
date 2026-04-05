export function getReportRoute(sessionId) {
  return `/report/${encodeURIComponent(sessionId)}`
}
