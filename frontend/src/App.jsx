import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import ErrorBoundary from './components/ErrorBoundary'
import Navbar from './components/Navbar'
import ProtectedRoute from './components/ProtectedRoute'
// ── AuthPage import (commented out — auth disabled) ──
// import AuthPage from './pages/AuthPage'

import UploadPage from './pages/Upload'
import OnboardingPage from './pages/OnboardingPage'
import DashboardPage from './pages/DashboardPage'
import InterviewRoom from './pages/InterviewRoom'
import Report from './pages/ReportPage'
import SharedReportPage from './pages/SharedReportPage'
import SettingsPage from './pages/SettingsPage'
import ContextHubPage from './pages/ContextHubPage'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <ErrorBoundary>
    <ThemeProvider>
    <AuthProvider>
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#1e1b4b',
            color: '#e2e8f0',
            border: '1px solid rgba(139,92,246,0.3)',
            borderRadius: '12px',
            fontSize: '14px',
          },
          success: { iconTheme: { primary: '#4ade80', secondary: '#1e1b4b' } },
          error:   { iconTheme: { primary: '#f87171', secondary: '#1e1b4b' } },
        }}
      />
      <Navbar />
      <Routes>
        {/* Auth route — redirect to home since login is disabled */}
        <Route path="/auth" element={<Navigate to="/" replace />} />

        {/* ── Original auth route (commented out) ──
        <Route path="/auth" element={<AuthPage />} />
        */}

        {/* Public */}
        <Route path="/share/:token" element={<SharedReportPage />} />

        {/* Protected (ProtectedRoute is currently a passthrough) */}
        <Route path="/" element={
          <ProtectedRoute><UploadPage /></ProtectedRoute>
        } />
        <Route path="/onboarding" element={
          <ProtectedRoute><OnboardingPage /></ProtectedRoute>
        } />
        <Route path="/dashboard" element={
          <ProtectedRoute><DashboardPage /></ProtectedRoute>
        } />
        <Route path="/interview/:sessionId" element={
          <ProtectedRoute><InterviewRoom /></ProtectedRoute>
        } />
        <Route path="/coding/:sessionId" element={
          <ProtectedRoute><InterviewRoom /></ProtectedRoute>
        } />
        <Route path="/report/:sessionId" element={
          <ProtectedRoute><Report /></ProtectedRoute>
        } />
        <Route path="/settings" element={
          <ProtectedRoute><SettingsPage /></ProtectedRoute>
        } />
        <Route path="/context-hub" element={
          <ProtectedRoute><ContextHubPage /></ProtectedRoute>
        } />

        {/* 404 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
    </ErrorBoundary>
  )
}
