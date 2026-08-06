// ── C1 · Page scope ──────────────────────────────────────────────────────────
// The difference between a chatbot and a copilot is that the copilot already
// knows what you are looking at. Asking "who hasn't been in lately?" from the
// customers page should not require restating that you mean customers.
//
// Scope is advisory: it steers the model toward the right tools and suggests
// starting questions. It never restricts what can be asked, because a manager on
// the run sheet may legitimately want yesterday's takings.

export interface PageScope {
  key: string
  label: string
  /** Appended to the system prompt so the model knows the user's vantage point. */
  brief: string
  suggestions: string[]
}

const SCOPES: PageScope[] = [
  {
    key: 'runsheet',
    label: 'Boarding round',
    brief: 'They are working the boarding run sheet — today\'s stays, care tasks and daily health logs.',
    suggestions: ['Which cats are boarding tonight?', 'Any health flags logged today?', 'What is today\'s room occupancy?'],
  },
  {
    key: 'customers',
    label: 'Customers',
    brief: 'They are looking at customer records.',
    suggestions: ['Who hasn\'t returned in six months?', 'Top 10 customers by spending', 'How many customers are at risk of leaving?'],
  },
  {
    key: 'cats',
    label: 'Cats',
    brief: 'They are looking at cat records — breed, coat, health notes, grooming history.',
    suggestions: ['Show me cats with allergies', 'Which cats are overdue for grooming?', 'Which vaccinations expire soon?'],
  },
  {
    key: 'finance',
    label: 'Finance',
    brief: 'They are in the finance section — the three statements, expenses and aging.',
    suggestions: ['Revenue this month by category', 'How does this month compare to last?', 'What is outstanding from customers?'],
  },
  {
    key: 'revenue',
    label: 'Revenue',
    brief: 'They are looking at recorded sales.',
    suggestions: ['Revenue this month by category', 'Which service earns the most?'],
  },
  {
    key: 'marketing',
    label: 'Marketing',
    brief: 'They are in the marketing section — audiences, reviews, referrals and message variants.',
    suggestions: ['Which customers are at risk of leaving?', 'How many customers can we actually message?', 'Who is due a win-back?'],
  },
  {
    key: 'actions',
    label: 'Action Inbox',
    brief: 'They are working the Action Inbox — the ranked queue of suggested follow-ups.',
    suggestions: ['Who needs a win-back message?', 'Which memberships expire soon?', 'What is overdue right now?'],
  },
  {
    key: 'appointments',
    label: 'Appointments',
    brief: 'They are looking at the appointment book.',
    suggestions: ['What is booked today?', 'How busy are we this week?'],
  },
  {
    key: 'pos',
    label: 'Point of sale',
    brief: 'They are at the till, likely mid-checkout with a customer in front of them. Answer briefly.',
    suggestions: ['What does this customer usually book?', 'Do they have wallet credit?'],
  },
  {
    key: 'hr',
    label: 'Human resource',
    brief: 'They are in the HR section — staff, attendance, leave and commission.',
    suggestions: ['Who is on leave this week?', 'How many hours has each groomer worked?'],
  },
]

const DEFAULT_SCOPE: PageScope = {
  key: 'general',
  label: 'Anywhere',
  brief: 'They are on the dashboard or a general page.',
  suggestions: [
    'What needs my attention today?',
    'Revenue this month by category',
    'Who hasn\'t returned in six months?',
  ],
}

/** Longest matching path prefix wins, so /marketing/groups beats a bare /marketing. */
export function scopeForPath(path: string | undefined): PageScope {
  if (!path) return DEFAULT_SCOPE
  const clean = path.split('?')[0]
  const match = SCOPES
    .filter(s => clean === `/${s.key}` || clean.startsWith(`/${s.key}/`))
    .sort((a, b) => b.key.length - a.key.length)[0]
  return match ?? DEFAULT_SCOPE
}
