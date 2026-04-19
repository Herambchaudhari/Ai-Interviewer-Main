/**
 * SectionErrorBoundary — section-level error boundary for ReportPage.
 * Catches render errors inside a single report section and shows a compact
 * inline fallback so the rest of the report remains visible and interactive.
 * Unlike the app-level ErrorBoundary, this never takes over the full screen.
 */
import { Component } from 'react'
import { AlertTriangle } from 'lucide-react'

export default class SectionErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('[ReportPage] Section render error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="glass p-4 rounded-xl flex items-center gap-3"
          style={{
            border: '1px solid rgba(248,113,113,0.3)',
            background: 'rgba(248,113,113,0.06)',
          }}
        >
          <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-400">
              This section couldn't load
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
              The rest of your report is intact. Try refreshing if this persists.
            </p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
