/**
 * Tests for SectionErrorBoundary component (Bug #1 fix).
 *
 * Setup required (one-time):
 *   npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom
 *   # Add to vite.config.js test block:
 *   #   test: { environment: 'jsdom', globals: true, setupFiles: './src/tests/setup.js' }
 *   # Create src/tests/setup.js:
 *   #   import '@testing-library/jest-dom'
 *
 * Run:
 *   npx vitest run src/tests/SectionErrorBoundary.test.jsx
 *
 * Covers:
 *   1. Renders children normally when no error occurs
 *   2. Renders compact error fallback when a child throws
 *   3. Crashed sibling boundary does not affect its neighbour
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import SectionErrorBoundary from '../components/SectionErrorBoundary'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A component that always throws during render. */
function AlwaysCrashes({ message = 'boom' }) {
  throw new Error(message)
}

/** A well-behaved component. */
function SafeChild({ text }) {
  return <p data-testid="safe-child">{text}</p>
}

// Suppress React's console.error noise from intentional throws in tests
const originalConsoleError = console.error
beforeEach(() => {
  console.error = vi.fn()
})
afterEach(() => {
  console.error = originalConsoleError
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SectionErrorBoundary', () => {

  it('renders children normally when no error occurs', () => {
    render(
      <SectionErrorBoundary>
        <SafeChild text="All good" />
      </SectionErrorBoundary>
    )

    expect(screen.getByTestId('safe-child')).toBeInTheDocument()
    expect(screen.getByText('All good')).toBeInTheDocument()
    expect(screen.queryByText("This section couldn't load")).not.toBeInTheDocument()
  })

  it('renders compact error fallback when child throws', () => {
    render(
      <SectionErrorBoundary>
        <AlwaysCrashes />
      </SectionErrorBoundary>
    )

    expect(screen.getByText("This section couldn't load")).toBeInTheDocument()
    expect(screen.getByText(/rest of your report is intact/i)).toBeInTheDocument()
  })

  it('does not show children content in the fallback state', () => {
    render(
      <SectionErrorBoundary>
        <AlwaysCrashes />
        <SafeChild text="Should not appear" />
      </SectionErrorBoundary>
    )

    expect(screen.queryByTestId('safe-child')).not.toBeInTheDocument()
    expect(screen.queryByText('Should not appear')).not.toBeInTheDocument()
  })

  it('crashed boundary does not affect sibling boundaries', () => {
    render(
      <div>
        <SectionErrorBoundary>
          <AlwaysCrashes />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <SafeChild text="Sibling is fine" />
        </SectionErrorBoundary>
      </div>
    )

    // Crashed section shows fallback
    expect(screen.getByText("This section couldn't load")).toBeInTheDocument()
    // Sibling section still renders correctly
    expect(screen.getByTestId('safe-child')).toBeInTheDocument()
    expect(screen.getByText('Sibling is fine')).toBeInTheDocument()
  })

  it('logs the error to console.error', () => {
    render(
      <SectionErrorBoundary>
        <AlwaysCrashes message="test-error-msg" />
      </SectionErrorBoundary>
    )

    // componentDidCatch calls console.error
    expect(console.error).toHaveBeenCalled()
  })

})
