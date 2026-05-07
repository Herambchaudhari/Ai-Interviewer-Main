import { useState, useEffect } from 'react'
import { useAuthContext } from '../context/AuthContext'
import { pickQuote, getQuoteSeed, bumpQuoteSeed } from '../data/motivationalQuotes'
import { Sparkles } from 'lucide-react'

export default function MotivationalQuote({ bumpOnMount = true }) {
  const { user } = useAuthContext()
  const [seed, setSeed] = useState(getQuoteSeed)

  useEffect(() => {
    if (!bumpOnMount) return
    const next = bumpQuoteSeed()
    setSeed(next)
  }, []) // runs once on mount — covers login, page refresh, return from session

  const quote = pickQuote(user?.id || '', seed)

  return (
    <div
      className="glass mb-8 px-5 py-4 animate-fade-in-up"
      style={{
        borderLeft: '3px solid var(--color-primary)',
        borderRadius: '12px',
        background: 'rgba(124,58,237,0.06)',
      }}
    >
      <div className="flex items-start gap-3">
        <Sparkles
          size={15}
          className="flex-shrink-0 mt-0.5"
          style={{ color: 'var(--color-primary)' }}
        />
        <div>
          <p
            className="text-sm font-medium leading-relaxed"
            style={{ color: 'var(--color-text-2)' }}
          >
            "{quote.text}"
          </p>
          {quote.author && (
            <p className="text-xs text-muted mt-1">— {quote.author}</p>
          )}
        </div>
      </div>
    </div>
  )
}
