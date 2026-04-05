/**
 * ErrorBoundary — catches React render errors and shows a friendly fallback.
 */
import { Component } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info)
  }

  handleRefresh = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6"
          style={{ background: 'var(--color-bg, #0a0a1a)' }}>
          <div className="glass p-10 max-w-md text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)' }}>
              <AlertCircle size={32} className="text-red-400" />
            </div>
            <h2 className="text-xl font-bold mb-2" style={{ color: '#e2e8f0' }}>
              Something went wrong
            </h2>
            <p className="text-sm mb-6" style={{ color: '#64748b' }}>
              An unexpected error occurred. This has been logged.
            </p>
            {this.state.error?.message && (
              <pre className="text-xs text-left p-3 rounded-lg mb-4 overflow-x-auto"
                style={{ background: 'rgba(0,0,0,0.3)', color: '#f87171', maxHeight: 100 }}>
                {this.state.error.message}
              </pre>
            )}
            <button onClick={this.handleRefresh}
              className="btn-primary inline-flex items-center gap-2">
              <RefreshCw size={16} /> Refresh Page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
