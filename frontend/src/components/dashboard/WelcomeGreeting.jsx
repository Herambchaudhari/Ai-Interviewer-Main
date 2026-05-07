import { CalendarDays } from 'lucide-react'

function getGreetingTier(hour) {
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function WelcomeGreeting({ name, today }) {
  const greeting = getGreetingTier(new Date().getHours())
  const displayName = name || 'there'

  return (
    <div>
      <h1 className="text-4xl font-bold mb-1">
        {greeting},{' '}
        <span className="gradient-text">{displayName}</span>
      </h1>
      <div className="flex items-center gap-2 text-muted text-sm mt-1">
        <CalendarDays size={14} />
        {today}
      </div>
    </div>
  )
}
