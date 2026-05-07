import { Flame, Zap } from 'lucide-react'

export default function PracticeStreak({ streak = 0 }) {
  if (streak === 0) return null

  const isHot = streak >= 5

  return (
    <div
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold mt-3"
      style={{
        background: isHot ? 'rgba(251,146,60,0.12)' : 'rgba(234,179,8,0.10)',
        border: `1px solid ${isHot ? 'rgba(251,146,60,0.3)' : 'rgba(234,179,8,0.25)'}`,
        color: isHot ? '#fb923c' : '#eab308',
      }}
    >
      {isHot
        ? <Flame size={13} style={{ flexShrink: 0 }} />
        : <Zap size={13} style={{ flexShrink: 0 }} />
      }
      {streak}-day streak
    </div>
  )
}
