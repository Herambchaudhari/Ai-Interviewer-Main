/**
 * TopicsMasterySection — topics matrix (weakest first) + AI recommendations.
 * Props: { topics, aiRecommendations }
 */
import { BookOpen, Lightbulb, ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'

const PROFICIENCY = {
  expert:     { label: 'Expert',     bg: 'rgba(74,222,128,0.1)',   text: '#4ade80', bar: '#4ade80',  min: 80 },
  proficient: { label: 'Proficient', bg: 'rgba(59,130,246,0.1)',   text: '#3b82f6', bar: '#3b82f6',  min: 60 },
  developing: { label: 'Developing', bg: 'rgba(245,158,11,0.1)',   text: '#f59e0b', bar: '#f59e0b',  min: 40 },
  beginner:   { label: 'Beginner',   bg: 'rgba(248,113,113,0.1)', text: '#f87171', bar: '#f87171',  min: 0  },
}

const PRIORITY_COLORS = {
  High:   { bg: 'rgba(248,113,113,0.15)', text: '#f87171' },
  Medium: { bg: 'rgba(245,158,11,0.15)',  text: '#f59e0b' },
  Low:    { bg: 'rgba(74,222,128,0.15)',  text: '#4ade80' },
}

function ProficiencyBadge({ level }) {
  const p = PROFICIENCY[level] || PROFICIENCY.beginner
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: p.bg, color: p.text }}>
      {p.label}
    </span>
  )
}

function ProgressBar({ score, level }) {
  const p = PROFICIENCY[level] || PROFICIENCY.beginner
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <div className="h-1.5 rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, score)}%`, background: p.bar }} />
      </div>
      <span className="text-xs text-muted w-8 text-right">{score}</span>
    </div>
  )
}

function TopicsTable({ topics }) {
  const [expandedIdx, setExpandedIdx] = useState(null)

  return (
    <div className="glass overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[600px]">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              {['Topic', 'Proficiency', 'Score', 'Appearances', 'Last Seen'].map(h => (
                <th key={h}
                  className="text-left text-xs text-muted uppercase tracking-wider px-4 py-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topics.map((t, i) => (
              <>
                <tr
                  key={t.topic}
                  className="hover:bg-white/[0.02] cursor-pointer transition-colors"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                  onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                >
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t.topic}</span>
                      {expandedIdx === i
                        ? <ChevronUp size={12} className="text-muted" />
                        : <ChevronDown size={12} className="text-muted" />}
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <ProficiencyBadge level={t.proficiency} />
                  </td>
                  <td className="px-4 py-3.5 w-40">
                    <ProgressBar score={t.avg_score} level={t.proficiency} />
                  </td>
                  <td className="px-4 py-3.5 text-muted">
                    {t.appearances}×
                  </td>
                  <td className="px-4 py-3.5 text-muted text-xs">
                    {t.last_seen || '—'}
                  </td>
                </tr>
                {expandedIdx === i && (
                  <tr key={`${t.topic}-exp`}
                    style={{ borderBottom: '1px solid var(--color-border)', background: 'rgba(255,255,255,0.01)' }}>
                    <td colSpan={5} className="px-4 py-3">
                      <p className="text-xs text-muted">
                        This topic appeared <strong className="text-white/70">{t.appearances}</strong> time(s)
                        across your interviews with an average score of{' '}
                        <strong className="text-white/70">{t.avg_score}</strong>.{' '}
                        {t.proficiency === 'beginner' && 'Focus on building foundational knowledge here.'}
                        {t.proficiency === 'developing' && 'You have basic understanding — practice more problems.'}
                        {t.proficiency === 'proficient' && 'Solid performance — aim to reach expert level.'}
                        {t.proficiency === 'expert' && 'Excellent — maintain this level with revision.'}
                      </p>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RecommendationsPanel({ recs }) {
  if (!recs?.length) return null
  return (
    <div>
      <h3 className="text-sm font-semibold text-muted uppercase tracking-widest mb-4 flex items-center gap-2">
        <Lightbulb size={14} style={{ color: '#f59e0b' }} /> AI Study Recommendations
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {recs.map(rec => {
          const pc = PRIORITY_COLORS[rec.priority] || PRIORITY_COLORS.Medium
          return (
            <div key={rec.topic} className="glass p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-sm">{rec.topic}</h4>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: pc.bg, color: pc.text }}>
                  {rec.priority}
                </span>
              </div>
              {rec.reason && (
                <p className="text-xs text-muted mb-3 leading-relaxed">{rec.reason}</p>
              )}
              {rec.resources?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {rec.resources.map(r => (
                    <span key={r}
                      className="text-xs px-2 py-0.5 rounded"
                      style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--color-text-2)' }}>
                      {r}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function TopicsMasterySection({ topics, aiRecommendations }) {
  if (!topics?.length) {
    return (
      <div className="glass p-12 text-center animate-fade-in-up">
        <BookOpen size={40} className="text-muted mx-auto mb-4" />
        <p className="text-muted">No topic data yet. Complete interviews to see your mastery matrix.</p>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-fade-in-up">
      <div>
        <h3 className="text-sm font-semibold text-muted uppercase tracking-widest mb-4 flex items-center gap-2">
          <BookOpen size={14} style={{ color: '#f59e0b' }} />
          Topics Mastery Matrix
          <span className="ml-auto text-xs font-normal normal-case">Sorted by weakest first</span>
        </h3>
        <TopicsTable topics={topics} />
      </div>
      <RecommendationsPanel recs={aiRecommendations} />
    </div>
  )
}
