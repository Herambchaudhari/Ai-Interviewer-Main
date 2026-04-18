/**
 * CVHonestyGauge.jsx — Speedometer-style SVG gauge showing CV credibility score.
 * Half-circle arc: Red (0-40%) → Orange (40-70%) → Green (70-100%)
 * Animated fill on mount.
 */
import { useEffect, useState } from 'react'

export default function CVHonestyGauge({ score = 0 }) {
  const [displayed, setDisplayed] = useState(0)

  // Animate score on mount
  useEffect(() => {
    const target = Math.min(100, Math.max(0, score))
    let curr = 0
    const step = target / 40   // ~40 frames
    const timer = setInterval(() => {
      curr = Math.min(target, curr + step)
      setDisplayed(Math.round(curr))
      if (curr >= target) clearInterval(timer)
    }, 20)
    return () => clearInterval(timer)
  }, [score])

  // Semi-circle geometry (M 20 110 A 90 90 0 0 1 200 110)
  // cx=110, cy=110, r=90, from left endpoint to right endpoint
  const r            = 90
  const semiCircumf  = Math.PI * r   // ≈ 282.7
  const pct          = displayed / 100
  const fillLength   = pct * semiCircumf

  // Zone colors & label
  const color = displayed >= 70 ? '#10b981' : displayed >= 40 ? '#f59e0b' : '#ef4444'
  const label = displayed >= 70 ? 'Credible CV' : displayed >= 40 ? 'Mixed Signals' : 'Low Credibility'

  // Needle angle: 0 score = 180deg (left), 100 score = 0deg (right)
  // In SVG terms: needle points from center outward
  const needleAngleDeg = 180 - (displayed * 1.8)  // 180 → 0
  const needleRad      = (needleAngleDeg * Math.PI) / 180
  const needleLen      = 70
  const cx = 110, cy = 110
  const nx  = cx + needleLen * Math.cos(needleRad)
  const ny  = cy - needleLen * Math.sin(needleRad)  // SVG y inverted

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <svg viewBox="0 0 220 130" width="220" height="130">
        {/* ── Background arc (grey track) */}
        <path
          d="M 20 110 A 90 90 0 0 1 200 110"
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth="18"
          strokeLinecap="round"
        />

        {/* ── Zone 1: Red (0–40%) */}
        <path
          d="M 20 110 A 90 90 0 0 1 200 110"
          fill="none"
          stroke="#ef4444"
          strokeWidth="18"
          strokeLinecap="butt"
          strokeDasharray={`${0.4 * semiCircumf} ${semiCircumf}`}
          strokeDashoffset={0}
          opacity={0.35}
        />

        {/* ── Zone 2: Orange (40–70%) */}
        <path
          d="M 20 110 A 90 90 0 0 1 200 110"
          fill="none"
          stroke="#f59e0b"
          strokeWidth="18"
          strokeLinecap="butt"
          strokeDasharray={`${0.3 * semiCircumf} ${semiCircumf}`}
          strokeDashoffset={`-${0.4 * semiCircumf}`}
          opacity={0.35}
        />

        {/* ── Zone 3: Green (70–100%) */}
        <path
          d="M 20 110 A 90 90 0 0 1 200 110"
          fill="none"
          stroke="#10b981"
          strokeWidth="18"
          strokeLinecap="butt"
          strokeDasharray={`${0.3 * semiCircumf} ${semiCircumf}`}
          strokeDashoffset={`-${0.7 * semiCircumf}`}
          opacity={0.35}
        />

        {/* ── Filled arc (actual score) */}
        <path
          d="M 20 110 A 90 90 0 0 1 200 110"
          fill="none"
          stroke={color}
          strokeWidth="18"
          strokeLinecap="round"
          strokeDasharray={`${fillLength} ${semiCircumf}`}
          style={{ transition: 'stroke-dasharray 0.8s cubic-bezier(.4,2,.6,1), stroke 0.4s ease' }}
        />

        {/* ── Needle */}
        <line
          x1={cx} y1={cy}
          x2={nx}  y2={ny}
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          style={{ transition: 'x2 0.8s ease, y2 0.8s ease' }}
        />
        <circle cx={cx} cy={cy} r="5" fill={color} />

        {/* ── Score text */}
        <text
          x={cx} y={cy - 14}
          textAnchor="middle"
          fill={color}
          fontSize="26"
          fontWeight="800"
          fontFamily="system-ui, sans-serif"
        >
          {displayed}%
        </text>
        <text
          x={cx} y={cy + 3}
          textAnchor="middle"
          fill="var(--color-muted)"
          fontSize="10"
          fontFamily="system-ui, sans-serif"
        >
          {label}
        </text>

        {/* ── Zone tick labels */}
        <text x="14"  y="128" fontSize="9" fill="#ef4444"  fontWeight="600">0</text>
        <text x="193" y="128" fontSize="9" fill="#10b981"  fontWeight="600">100</text>
      </svg>
    </div>
  )
}
