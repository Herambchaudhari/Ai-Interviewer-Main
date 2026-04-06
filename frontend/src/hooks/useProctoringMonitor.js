import { useEffect, useMemo, useRef, useState } from 'react'

const ANALYSIS_INTERVAL_MS = 1800
const PHONE_SCAN_EVERY = 3
const INCIDENT_COOLDOWN_MS = 12000

const INCIDENT_META = {
  camera_blocked: {
    label: 'Camera blocked',
    severity: 'high',
    threshold: 2,
    deduction: 18,
  },
  multiple_faces: {
    label: 'Multiple faces detected',
    severity: 'high',
    threshold: 2,
    deduction: 16,
  },
  phone_detected: {
    label: 'Phone detected',
    severity: 'high',
    threshold: 1,
    deduction: 20,
  },
  looking_away: {
    label: 'Looking away',
    severity: 'medium',
    threshold: 3,
    deduction: 7,
  },
  poor_posture: {
    label: 'Posture drift',
    severity: 'low',
    threshold: 3,
    deduction: 5,
  },
}

const EMPTY_COUNTS = {
  camera_blocked: 0,
  multiple_faces: 0,
  phone_detected: 0,
  looking_away: 0,
  poor_posture: 0,
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function scoreLookup(blendshapes, name) {
  if (!Array.isArray(blendshapes)) return 0
  const entry = blendshapes.find(item => item.categoryName === name)
  return Number(entry?.score || 0)
}

function average(values) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function buildInitialSummary() {
  return {
    integrity_score: 100,
    total_incidents: 0,
    counts: { ...EMPTY_COUNTS },
    camera_uptime_ratio: 1,
    monitoring_status: 'starting',
    live_flags: [],
    recent_incidents: [],
    models_ready: false,
    last_updated_at: null,
  }
}

function buildIncident(type, detail) {
  return {
    id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    label: INCIDENT_META[type]?.label || type,
    severity: INCIDENT_META[type]?.severity || 'medium',
    detail,
    created_at: new Date().toISOString(),
  }
}

function deriveFaceSignals(result, video) {
  const faces = result?.faceLandmarks || []
  const blendshapeSet = result?.faceBlendshapes?.[0]?.categories || []

  if (!faces.length) {
    return {
      hasFace: false,
      flags: ['camera_blocked'],
      metrics: { attention: 0, posture: 0 },
    }
  }

  const face = faces[0]
  const xs = face.map(point => point.x)
  const ys = face.map(point => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const faceWidth = maxX - minX
  const faceHeight = maxY - minY

  const lookAwayScore = Math.max(
    scoreLookup(blendshapeSet, 'eyeLookOutLeft'),
    scoreLookup(blendshapeSet, 'eyeLookOutRight'),
    scoreLookup(blendshapeSet, 'eyeLookInLeft'),
    scoreLookup(blendshapeSet, 'eyeLookInRight'),
    scoreLookup(blendshapeSet, 'eyeLookUpLeft'),
    scoreLookup(blendshapeSet, 'eyeLookUpRight'),
    scoreLookup(blendshapeSet, 'eyeLookDownLeft'),
    scoreLookup(blendshapeSet, 'eyeLookDownRight'),
  )

  const flags = []
  if (faces.length > 1) {
    flags.push('multiple_faces')
  }
  if (lookAwayScore > 0.55 || Math.abs(centerX - 0.5) > 0.2 || Math.abs(centerY - 0.45) > 0.24) {
    flags.push('looking_away')
  }
  if (faceWidth < 0.08 || faceHeight < 0.12 || faceWidth > 0.75 || faceHeight > 0.9) {
    flags.push('camera_blocked')
  }

  const attention = clamp(1 - (lookAwayScore * 0.9 + Math.abs(centerX - 0.5) * 1.2), 0, 1)

  return {
    hasFace: true,
    flags,
    metrics: {
      attention,
      posture: clamp(1 - Math.abs(centerY - 0.42) * 1.8, 0, 1),
      frameWidth: video?.videoWidth || 0,
      frameHeight: video?.videoHeight || 0,
    },
  }
}

function derivePoseSignals(result) {
  const pose = result?.landmarks?.[0]
  if (!pose) {
    return { flags: [], metrics: { posture: 0.5 } }
  }

  const nose = pose[0]
  const leftShoulder = pose[11]
  const rightShoulder = pose[12]
  if (!nose || !leftShoulder || !rightShoulder) {
    return { flags: [], metrics: { posture: 0.5 } }
  }

  const shoulderSlope = Math.abs(leftShoulder.y - rightShoulder.y)
  const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2
  const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2
  const headOffsetX = Math.abs(nose.x - shoulderMidX)
  const headHeight = shoulderMidY - nose.y

  const posturePenalty = shoulderSlope * 2.2 + headOffsetX * 1.5 + (headHeight < 0.08 ? 0.35 : 0)
  const postureScore = clamp(1 - posturePenalty, 0, 1)

  const flags = []
  if (shoulderSlope > 0.08 || headOffsetX > 0.12 || headHeight < 0.08) {
    flags.push('poor_posture')
  }

  return {
    flags,
    metrics: {
      posture: postureScore,
    },
  }
}

function buildSummary(statsRef, liveFlags, modelState) {
  const stats = statsRef.current
  const counts = { ...stats.counts }
  const totalIncidents = Object.values(counts).reduce((sum, value) => sum + value, 0)
  const deductions = Object.entries(counts).reduce((sum, [type, count]) => {
    return sum + ((INCIDENT_META[type]?.deduction || 0) * count)
  }, 0)
  const integrityScore = clamp(100 - deductions, 5, 100)
  const uptimeRatio = stats.analysisRuns > 0
    ? clamp((stats.analysisRuns - stats.faceMissingRuns) / stats.analysisRuns, 0, 1)
    : 1

  return {
    integrity_score: integrityScore,
    total_incidents: totalIncidents,
    counts,
    camera_uptime_ratio: uptimeRatio,
    monitoring_status: modelState === 'ready' ? (liveFlags.length ? 'alert' : 'clear') : modelState,
    live_flags: liveFlags,
    recent_incidents: [...stats.recentIncidents],
    average_attention_score: Number((average(stats.attentionSamples) * 100).toFixed(1)),
    average_posture_score: Number((average(stats.postureSamples) * 100).toFixed(1)),
    models_ready: modelState === 'ready',
    last_updated_at: new Date().toISOString(),
  }
}

export function useProctoringMonitor({ enabled, videoRef }) {
  const [modelState, setModelState] = useState('idle')
  const [modelError, setModelError] = useState('')
  const [liveFlags, setLiveFlags] = useState([])
  const [summary, setSummary] = useState(buildInitialSummary())

  const faceLandmarkerRef = useRef(null)
  const poseLandmarkerRef = useRef(null)
  const phoneModelRef = useRef(null)
  const intervalRef = useRef(null)
  const loadingRef = useRef(false)
  const scanCountRef = useRef(0)
  const issueStreakRef = useRef({})
  const lastIncidentAtRef = useRef({})
  const statsRef = useRef({
    counts: { ...EMPTY_COUNTS },
    recentIncidents: [],
    attentionSamples: [],
    postureSamples: [],
    analysisRuns: 0,
    faceMissingRuns: 0,
  })

  const resetTracking = () => {
    issueStreakRef.current = {}
    lastIncidentAtRef.current = {}
    statsRef.current = {
      counts: { ...EMPTY_COUNTS },
      recentIncidents: [],
      attentionSamples: [],
      postureSamples: [],
      analysisRuns: 0,
      faceMissingRuns: 0,
    }
    setLiveFlags([])
    setSummary(buildInitialSummary())
  }

  useEffect(() => {
    if (!enabled || loadingRef.current || faceLandmarkerRef.current) return undefined

    let cancelled = false

    const loadModels = async () => {
      try {
        loadingRef.current = true
        setModelState('loading')
        setModelError('')

        const visionModule = await import('@mediapipe/tasks-vision')
        const tf = await import('@tensorflow/tfjs')
        const cocoSsd = await import('@tensorflow-models/coco-ssd')

        await tf.ready()

        const vision = await visionModule.FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
        )

        if (cancelled) return

        faceLandmarkerRef.current = await visionModule.FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 2,
          outputFaceBlendshapes: true,
        })

        poseLandmarkerRef.current = await visionModule.PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        })

        phoneModelRef.current = await cocoSsd.load({ base: 'lite_mobilenet_v2' })

        if (!cancelled) {
          setModelState('ready')
          setSummary(prev => ({ ...prev, models_ready: true }))
        }
      } catch (error) {
        if (!cancelled) {
          setModelState('error')
          setModelError(error?.message || 'Failed to load proctoring models.')
        }
      } finally {
        loadingRef.current = false
      }
    }

    loadModels()

    return () => {
      cancelled = true
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled || modelState !== 'ready') return undefined

    const registerIncident = (type, detail) => {
      const now = Date.now()
      const previous = lastIncidentAtRef.current[type] || 0
      if (now - previous < INCIDENT_COOLDOWN_MS) return

      lastIncidentAtRef.current[type] = now
      statsRef.current.counts[type] += 1

      const incident = buildIncident(type, detail)
      statsRef.current.recentIncidents = [incident, ...statsRef.current.recentIncidents].slice(0, 6)
    }

    const runAnalysis = async () => {
      const video = videoRef?.current
      if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return

      statsRef.current.analysisRuns += 1
      scanCountRef.current += 1

      try {
        const now = performance.now()
        const faceResult = faceLandmarkerRef.current?.detectForVideo(video, now)
        const poseResult = poseLandmarkerRef.current?.detectForVideo(video, now)

        const faceSignals = deriveFaceSignals(faceResult, video)
        const poseSignals = derivePoseSignals(poseResult)

        if (!faceSignals.hasFace) {
          statsRef.current.faceMissingRuns += 1
        }

        const currentFlags = [...new Set([
          ...faceSignals.flags,
          ...poseSignals.flags,
        ])]

        if (scanCountRef.current % PHONE_SCAN_EVERY === 0 && phoneModelRef.current) {
          const predictions = await phoneModelRef.current.detect(video)
          const phoneHit = predictions.some(item => item.class === 'cell phone' && item.score >= 0.55)
          if (phoneHit) {
            currentFlags.push('phone_detected')
          }
        }

        const uniqueFlags = [...new Set(currentFlags)]

        Object.keys(INCIDENT_META).forEach(type => {
          const streak = issueStreakRef.current[type] || 0
          if (uniqueFlags.includes(type)) {
            issueStreakRef.current[type] = streak + 1
            if (issueStreakRef.current[type] >= INCIDENT_META[type].threshold) {
              registerIncident(type, INCIDENT_META[type].label)
              issueStreakRef.current[type] = 0
            }
          } else {
            issueStreakRef.current[type] = 0
          }
        })

        statsRef.current.attentionSamples = [
          ...statsRef.current.attentionSamples.slice(-24),
          faceSignals.metrics.attention,
        ]
        statsRef.current.postureSamples = [
          ...statsRef.current.postureSamples.slice(-24),
          average([faceSignals.metrics.posture, poseSignals.metrics.posture]),
        ]

        setLiveFlags(uniqueFlags)
        setSummary(buildSummary(statsRef, uniqueFlags, modelState))
      } catch (error) {
        setModelError(error?.message || 'Proctoring monitor failed during analysis.')
      }
    }

    intervalRef.current = window.setInterval(() => {
      runAnalysis()
    }, ANALYSIS_INTERVAL_MS)

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current)
      }
      intervalRef.current = null
    }
  }, [enabled, modelState, videoRef])

  useEffect(() => {
    if (enabled) return undefined

    resetTracking()
    return undefined
  }, [enabled])

  const recentIncidents = useMemo(() => summary.recent_incidents || [], [summary])

  return {
    modelState,
    modelError,
    liveFlags,
    recentIncidents,
    summary,
  }
}

