/**
 * TopicsMasterySection — topics matrix (weakest first) + AI recommendations.
 * Props: { topics, aiRecommendations }
 */
import { BookOpen, Lightbulb, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { getReportRoute } from '../../lib/routes'

const PROFICIENCY = {
  expert:     { label: 'Expert',     bg: 'rgba(74,222,128,0.1)',   text: '#4ade80', bar: '#4ade80'  },
  proficient: { label: 'Proficient', bg: 'rgba(59,130,246,0.1)',   text: '#3b82f6', bar: '#3b82f6'  },
  developing: { label: 'Developing', bg: 'rgba(245,158,11,0.1)',   text: '#f59e0b', bar: '#f59e0b'  },
  beginner:   { label: 'Beginner',   bg: 'rgba(248,113,113,0.1)', text: '#f87171', bar: '#f87171'  },
}

const PRIORITY_COLORS = {
  High:   { bg: 'rgba(248,113,113,0.15)', text: '#f87171' },
  Medium: { bg: 'rgba(245,158,11,0.15)',  text: '#f59e0b' },
  Low:    { bg: 'rgba(74,222,128,0.15)',  text: '#4ade80' },
}

const ROUND_TYPE_LABELS = {
  technical:     { label: 'Technical',  bg: 'rgba(124,58,237,0.12)', text: '#7c3aed' },
  dsa:           { label: 'DSA',        bg: 'rgba(6,182,212,0.12)',  text: '#06b6d4' },
  hr:            { label: 'HR',         bg: 'rgba(236,72,153,0.12)', text: '#ec4899' },
  system_design: { label: 'Sys Design', bg: 'rgba(245,158,11,0.12)', text: '#f59e0b' },
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

function TrendBadge({ trend }) {
  if (trend === 'up') return (
    <span className="flex items-center gap-0.5 text-xs font-semibold" style={{ color: '#4ade80' }}>
      <TrendingUp size={11} /> Improving
    </span>
  )
  if (trend === 'down') return (
    <span className="flex items-center gap-0.5 text-xs font-semibold" style={{ color: '#f87171' }}>
      <TrendingDown size={11} /> Declining
    </span>
  )
  return (
    <span className="flex items-center gap-0.5 text-xs" style={{ color: 'var(--color-muted)' }}>
      <Minus size={11} /> Stable
    </span>
  )
}

function RoundTypeChip({ rt }) {
  const cfg = ROUND_TYPE_LABELS[rt] || { label: rt, bg: 'rgba(255,255,255,0.06)', text: 'var(--color-muted)' }
  return (
    <span className="px-1.5 py-0.5 rounded text-xs font-medium"
      style={{ background: cfg.bg, color: cfg.text }}>
      {cfg.label}
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
      <span className="text-xs w-8 text-right" style={{ color: 'var(--color-text)' }}>{score}</span>
    </div>
  )
}

function ScoreHistoryRow({ history }) {
  if (!history?.length) return null
  return (
    <div className="mt-3">
      <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
        Session history
      </p>
      <div className="flex flex-col gap-1.5">
        {history.map((h, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="text-xs w-24 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{h.date}</span>
            <div className="flex-1 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div className="h-1 rounded-full"
                style={{
                  width: `${Math.min(100, h.score)}%`,
                  background: h.score >= 60 ? '#4ade80' : h.score >= 40 ? '#f59e0b' : '#f87171',
                }} />
            </div>
            <span className="text-xs w-8 text-right font-medium" style={{ color: 'var(--color-text)' }}>{h.score}</span>
            {h.round_type && <RoundTypeChip rt={h.round_type} />}
            <a
              href={getReportRoute(h.session_id)}
              className="flex-shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors"
              style={{ color: 'var(--color-muted)' }}
              title="View report"
            >
              <ExternalLink size={11} />
            </a>
          </div>
        ))}
      </div>
    </div>
  )
}

function ExpandedRow({ topic }) {
  const profTip = {
    beginner:   'Focus on building foundational knowledge. Start with core concepts before moving to advanced topics.',
    developing: 'You have basic understanding — practice more problems and work on edge cases.',
    proficient: 'Solid performance. Aim for expert level by studying advanced patterns and system-level thinking.',
    expert:     'Excellent mastery. Maintain this level with periodic revision and harder challenges.',
  }
  return (
    <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'rgba(255,255,255,0.01)' }}>
      <td colSpan={6} className="px-4 py-4">
        <div className="space-y-3">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            This topic appeared{' '}
            <strong style={{ color: 'var(--color-text)' }}>{topic.appearances}</strong> time(s)
            {' '}across your interviews with an average score of{' '}
            <strong style={{ color: 'var(--color-text)' }}>{topic.avg_score}</strong>/100.{' '}
            {profTip[topic.proficiency] || profTip.beginner}
          </p>

          {topic.how_to_improve && (
            <div className="p-3 rounded-lg" style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.15)' }}>
              <p className="text-xs font-semibold mb-1" style={{ color: '#7c3aed' }}>How to improve</p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>{topic.how_to_improve}</p>
            </div>
          )}

          <ScoreHistoryRow history={topic.score_history} />
        </div>
      </td>
    </tr>
  )
}

function TopicsTable({ topics }) {
  const [expandedIdx, setExpandedIdx] = useState(null)

  return (
    <div className="glass overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              {['Topic', 'Proficiency', 'Score', 'Trend', 'Appearances', 'Last Seen'].map(h => (
                <th key={h}
                  className="text-left text-xs uppercase tracking-wider px-4 py-3 font-semibold"
                  style={{ color: 'var(--color-muted)' }}>
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
                  style={{ borderBottom: expandedIdx === i ? 'none' : '1px solid var(--color-border)' }}
                  onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                >
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium" style={{ color: 'var(--color-text)' }}>{t.topic}</span>
                      {t.round_types?.map(rt => <RoundTypeChip key={rt} rt={rt} />)}
                      {expandedIdx === i
                        ? <ChevronUp size={12} style={{ color: 'var(--color-muted)' }} />
                        : <ChevronDown size={12} style={{ color: 'var(--color-muted)' }} />}
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <ProficiencyBadge level={t.proficiency} />
                  </td>
                  <td className="px-4 py-3.5 w-40">
                    <ProgressBar score={t.avg_score} level={t.proficiency} />
                  </td>
                  <td className="px-4 py-3.5">
                    <TrendBadge trend={t.trend || 'stable'} />
                  </td>
                  <td className="px-4 py-3.5 text-xs" style={{ color: 'var(--color-muted)' }}>
                    {t.appearances}×
                  </td>
                  <td className="px-4 py-3.5 text-xs" style={{ color: 'var(--color-muted)' }}>
                    {t.last_seen || '—'}
                  </td>
                </tr>
                {expandedIdx === i && <ExpandedRow key={`${t.topic}-exp`} topic={t} />}
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
      <h3 className="text-sm font-semibold uppercase tracking-widest mb-4 flex items-center gap-2"
        style={{ color: 'var(--color-muted)' }}>
        <Lightbulb size={14} style={{ color: '#f59e0b' }} /> AI Study Recommendations
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {recs.map(rec => {
          const pc = PRIORITY_COLORS[rec.priority] || PRIORITY_COLORS.Medium
          return (
            <div key={rec.topic} className="glass p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{rec.topic}</h4>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: pc.bg, color: pc.text }}>
                  {rec.priority}
                </span>
              </div>
              {rec.reason && (
                <p className="text-xs mb-3 leading-relaxed" style={{ color: 'var(--color-muted)' }}>{rec.reason}</p>
              )}
              {rec.resources?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {rec.resources.map(r => (
                    <span key={r}
                      className="text-xs px-2 py-0.5 rounded"
                      style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--color-text)' }}>
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
        <h3 className="text-sm font-semibold uppercase tracking-widest mb-4 flex items-center gap-2"
          style={{ color: 'var(--color-muted)' }}>
          <BookOpen size={14} style={{ color: '#f59e0b' }} />
          Topics Mastery Matrix
          <span className="ml-auto text-xs font-normal normal-case" style={{ color: 'var(--color-muted)' }}>
            Sorted by weakest first
          </span>
        </h3>
        <TopicsTable topics={topics} />
      </div>
      <RecommendationsPanel recs={aiRecommendations} />
    </div>
  )
}
