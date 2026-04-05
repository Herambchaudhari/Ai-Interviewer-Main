import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { Toaster } from 'react-hot-toast'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: '#16162a',
          color: '#e2e8f0',
          border: '1px solid #2a2a4a',
          borderRadius: '12px',
          fontFamily: 'Outfit, sans-serif',
        },
        success: { iconTheme: { primary: '#7c3aed', secondary: '#fff' } },
        error: { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
      }}
    />
  </React.StrictMode>
)
