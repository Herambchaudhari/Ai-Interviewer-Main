import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Loader2, AlertTriangle } from 'lucide-react'

export default function InterviewCamera({
  hidden,
  captureOnly = false,
  videoRef: externalVideoRef = null,
  onStatusChange = null,
  overlay = null,
  compact = false,
  hideControls = false,
}) {
  const internalVideoRef = useRef(null)
  const videoRef = externalVideoRef || internalVideoRef
  const streamRef = useRef(null)

  const [status, setStatus] = useState('loading')
  const [cameraOn, setCameraOn] = useState(true)

  useEffect(() => {
    onStatusChange?.(status)
  }, [status, onStatusChange])

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
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setStatus('denied')
      } else {
        setStatus('denied')
      }
    }
  }

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }

  useEffect(() => {
    if (!hidden || captureOnly) startCamera()
    return () => stopCamera()
  }, [hidden, captureOnly]) // eslint-disable-line react-hooks/exhaustive-deps

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

  if (captureOnly) {
    return (
      <div
        aria-hidden="true"
        className="fixed pointer-events-none opacity-0 overflow-hidden"
        style={{ width: 1, height: 1, left: -9999, top: 0 }}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-full object-cover"
          style={{ transform: 'scaleX(-1)', background: '#0f0f1a' }}
        />
      </div>
    )
  }

  if (hidden) return null

  return (
    <div className="relative w-full overflow-hidden rounded-2xl" style={{ aspectRatio: compact ? '16/10' : '4/3' }}>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="w-full h-full object-cover"
        style={{
          transform: 'scaleX(-1)',
          background: '#0f0f1a',
          border: '1px solid var(--color-border)',
          display: status === 'active' ? 'block' : 'none',
        }}
      />

      {status === 'loading' && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3"
          style={{ background: '#0f1020', border: '1px solid var(--color-border)' }}
        >
          <Loader2 size={32} className="animate-spin text-purple-400" />
          <p className="text-muted text-sm">Initializing camera...</p>
        </div>
      )}

      {status === 'off' && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3"
          style={{ background: '#0f1020', border: '1px solid var(--color-border)' }}
        >
          <CameraOff size={36} className="text-muted" />
          <p className="text-muted text-sm">Camera is off</p>
        </div>
      )}

      {status === 'denied' && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center"
          style={{ background: '#1a0f0f', border: '1px solid rgba(239,68,68,0.3)' }}
        >
          <AlertTriangle size={36} className="text-red-400" />
          <p className="font-semibold text-sm text-red-300">Camera access denied</p>
          <p className="text-muted text-xs leading-relaxed">
            Go to browser settings and allow camera access for this site, then retry.
          </p>
          <button onClick={startCamera} className="btn-secondary text-xs py-2 px-4">
            Try Again
          </button>
        </div>
      )}

      {status === 'active' && (
        <div
          className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold"
          style={{ background: 'rgba(239,68,68,0.85)', backdropFilter: 'blur(4px)' }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          LIVE
        </div>
      )}

      {overlay}

      {!hideControls && (
        <button
          onClick={toggleCamera}
          id="webcam-toggle-btn"
          title={cameraOn ? 'Turn off camera' : 'Turn on camera'}
          className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.15)' }}
        >
          {cameraOn ? <Camera size={14} className="text-white" /> : <CameraOff size={14} className="text-red-400" />}
        </button>
      )}
    </div>
  )
}
