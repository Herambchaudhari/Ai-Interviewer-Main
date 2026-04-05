/**
 * RoundCards — 2x2 grid of interview round type selector cards.
 * Props: { onSelect }
 */
import { useState } from 'react'
import { Code2, User, Braces, ListChecks, CheckCircle } from 'lucide-react'

const ROUNDS = [
  {
    id: 'technical',
    label: 'Technical',
    Icon: Code2,
    accent: '#7c3aed',
    gradient: 'from-purple-600 to-purple-800',
    glow: 'rgba(124,58,237,0.4)',
    description: 'Deep dive into your tech stack, frameworks, and architecture',
    tags: ['DSA', 'OOP', 'Architecture'],
  },
  {
    id: 'hr',
    label: 'HR / Behavioural',
    Icon: User,
    accent: '#ec4899',
    gradient: 'from-pink-600 to-rose-800',
    glow: 'rgba(236,72,153,0.4)',
    description: 'Situational questions, culture fit, communication',
    tags: ['STAR Method', 'Leadership', 'Conflict'],
  },
  {
    id: 'dsa',
    label: 'DSA / Coding',
    Icon: Braces,
    accent: '#06b6d4',
    gradient: 'from-cyan-600 to-blue-800',
    glow: 'rgba(6,182,212,0.4)',
    description: 'Data structures, algorithms, live coding challenges',
    tags: ['Arrays', 'Graphs', 'DP'],
  },
  {
    id: 'mcq_practice',
    label: 'MCQ Practice',
    Icon: ListChecks,
    accent: '#f59e0b',
    gradient: 'from-amber-600 to-orange-800',
    glow: 'rgba(245,158,11,0.4)',
    description: 'Timed company-specific screening with options, resume signals, and core CS',
    tags: ['Company OA', 'Core CS', 'Resume'],
  },
]

export default function RoundCards({ onSelect }) {
  const [selected, setSelected] = useState(null)

  const handleClick = (id) => {
    setSelected(id)
    onSelect(id)
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {ROUNDS.map(({ id, label, Icon, accent, gradient, glow, description, tags }) => {
        const isSelected = selected === id
        return (
          <button
            key={id}
            id={`round-card-${id}`}
            onClick={() => handleClick(id)}
            className="glass p-6 text-left transition-all duration-300 relative overflow-hidden group"
            style={isSelected ? {
              borderColor: accent,
              boxShadow: `0 0 24px ${glow}, inset 0 0 24px ${glow}20`,
            } : {}}
          >
            {/* Subtle gradient bg on hover */}
            <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300`} />

            {/* Selected checkmark */}
            {isSelected && (
              <div className="absolute top-3 right-3">
                <CheckCircle size={18} style={{ color: accent }} className="animate-scale-in" />
              </div>
            )}

            {/* Icon */}
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 bg-gradient-to-br ${gradient}`}
              style={isSelected ? { boxShadow: `0 0 16px ${glow}` } : {}}
            >
              <Icon size={22} className="text-white" />
            </div>

            {/* Text */}
            <h3 className="font-bold text-base mb-1" style={isSelected ? { color: accent } : {}}>
              {label}
            </h3>
            <p className="text-muted text-sm leading-snug mb-3">{description}</p>

            {/* Tags */}
            <div className="flex flex-wrap gap-1.5">
              {tags.map(tag => (
                <span
                  key={tag}
                  className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{
                    background: `${accent}18`,
                    color: accent,
                    border: `1px solid ${accent}35`,
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </button>
        )
      })}
    </div>
  )
}
