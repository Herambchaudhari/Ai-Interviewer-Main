/**
 * WebcamFeed — live webcam preview with LIVE pill, camera toggle, and permission error handling.
 */
import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Loader2, AlertTriangle } from 'lucide-react'

export default function WebcamFeed({ hidden }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  const [status, setStatus]   = useState('loading')  // loading | active | denied | off
  const [cameraOn, setCameraOn] = useState(true)

  const startCamera = async () => {
    setStatus('loading')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setStatus('active')
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setStatus('denied')
      } else {
        setStatus('denied')
      }
    }
  }

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    if (videoRef.current) videoRef.current.srcObject = null
  }

  useEffect(() => {
    if (!hidden) startCamera()
    return () => stopCamera()
  }, [hidden])

  const toggleCamera = () => {
    if (cameraOn) {
      stopCamera()
      setCameraOn(false)
      setStatus('off')
    } else {
      setCameraOn(true)
      startCamera()
    }
  }

  if (hidden) return null

  return (
    <div className="relative w-full" style={{ aspectRatio: '4/3' }}>
      {/* Video element */}
      <video
        ref={videoRef}
        autoPlay muted playsInline
        className="w-full h-full rounded-2xl object-cover"
        style={{
          transform: 'scaleX(-1)',
          background: '#0f0f1a',
          border: '1px solid var(--color-border)',
          display: status === 'active' ? 'block' : 'none',
        }}
      />

      {/* Loading state */}
      {status === 'loading' && (
        <div className="absolute inset-0 rounded-2xl flex flex-col items-center justify-center gap-3"
          style={{ background: '#0f1020', border: '1px solid var(--color-border)' }}>
          <Loader2 size={32} className="animate-spin text-purple-400" />
          <p className="text-muted text-sm">Initializing camera…</p>
        </div>
      )}

      {/* Camera off */}
      {status === 'off' && (
        <div className="absolute inset-0 rounded-2xl flex flex-col items-center justify-center gap-3"
          style={{ background: '#0f1020', border: '1px solid var(--color-border)' }}>
          <CameraOff size={36} className="text-muted" />
          <p className="text-muted text-sm">Camera is off</p>
        </div>
      )}

      {/* Permission denied */}
      {status === 'denied' && (
        <div className="absolute inset-0 rounded-2xl flex flex-col items-center justify-center gap-3 p-6 text-center"
          style={{ background: '#1a0f0f', border: '1px solid rgba(239,68,68,0.3)' }}>
          <AlertTriangle size={36} className="text-red-400" />
          <p className="font-semibold text-sm text-red-300">Camera access denied</p>
          <p className="text-muted text-xs leading-relaxed">
            Go to browser settings → Privacy → Camera and allow access for this site, then reload.
          </p>
          <button onClick={startCamera} className="btn-secondary text-xs py-2 px-4">
            Try Again
          </button>
        </div>
      )}

      {/* LIVE pill — top-left */}
      {status === 'active' && (
        <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold"
          style={{ background: 'rgba(239,68,68,0.85)', backdropFilter: 'blur(4px)' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          LIVE
        </div>
      )}

      {/* Camera toggle — top-right */}
      <button
        onClick={toggleCamera}
        id="webcam-toggle-btn"
        title={cameraOn ? 'Turn off camera' : 'Turn on camera'}
        className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110"
        style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.15)' }}
      >
        {cameraOn ? <Camera size={14} className="text-white" /> : <CameraOff size={14} className="text-red-400" />}
      </button>
    </div>
  )
}
