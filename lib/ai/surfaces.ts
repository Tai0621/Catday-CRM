// Every AI surface in the OS, in one list.
//
// The OS grew AI feature by feature and each one landed wherever its business
// domain already was: the brief and reports at the top level, campaign offers
// under Marketing, captions under Content, triage under WhatsApp. Individually
// each was the right home. Together they read as AI scattered through the
// building with no front door.
//
// This registry is that front door. It is also the honest answer to "what is
// the AI actually doing here?", which is a question an owner is entitled to ask
// of a system that spends their money and writes to their customers.
//
// The split below is the important part.

export type SurfaceKind =
  /** The output IS the AI's work. These belong in the AI space and nowhere else. */
  | 'destination'
  /**
   * A business workflow that calls a model at one step. These stay where the
   * work is: the Content Studio's consent gates live in its pool query, next to
   * the photographs, and moving the button into an AI tab away from that data is
   * how such a check quietly stops being applied. Listed here, launched here,
   * but not relocated.
   */
  | 'assist'

export interface AiSurface {
  key: string
  kind: SurfaceKind
  label: string
  href: string
  /** What it does, in the owner's terms. */
  what: string
  /** For assists: why it lives where it does rather than in here. */
  whyThere?: string
}

export const AI_SURFACES: AiSurface[] = [
  {
    key: 'ask',
    kind: 'destination',
    label: 'Assistant',
    href: '/ask',
    what: 'Plain-English questions answered from live data. It can also draft a booking, an expense or a message — always for you to confirm, never actioned on its own.',
  },
  {
    key: 'brief',
    kind: 'destination',
    label: 'Morning Brief',
    href: '/brief',
    what: 'Written overnight: what happened yesterday, what it means, and what to do about it today. Every figure is computed, not guessed.',
  },
  {
    key: 'reports',
    kind: 'destination',
    label: 'Monthly Reports',
    href: '/reports',
    what: 'One report per department each month. A report whose prose contains a number the facts do not support is flagged rather than published.',
  },
  {
    key: 'campaigns',
    kind: 'assist',
    label: 'Campaign Studio',
    href: '/marketing/campaigns',
    what: 'Proposes offer structures against real open capacity and true margin, then reports what each would take to break even.',
    whyThere: 'The offers are built from capacity and margin figures that live with Marketing.',
  },
  {
    key: 'content',
    kind: 'assist',
    label: 'Content Studio',
    href: '/marketing/content',
    what: 'Pairs before/after grooming photos and drafts a caption in the brand voice, for you to post yourself.',
    whyThere: 'Two consent gates — household contact and per-cat publication — are enforced in the query that selects the photos. Separating the button from that data is how a gate stops being applied.',
  },
  {
    key: 'whatsapp',
    kind: 'assist',
    label: 'WhatsApp triage',
    href: '/whatsapp',
    what: 'Reads inbound messages and extracts what each customer actually wants, so nothing is lost in a busy inbox.',
    whyThere: 'It belongs next to the conversation it is reading.',
  },
  {
    key: 'onboarding',
    kind: 'assist',
    label: 'Guided setup',
    href: '/admin/onboarding',
    what: 'Turns a description of the business into a starting configuration — services, rooms, tiers — for you to correct before anything is saved.',
    whyThere: 'It writes business settings, so it sits with them.',
  },
]

export const destinations = (): AiSurface[] => AI_SURFACES.filter(s => s.kind === 'destination')
export const assists = (): AiSurface[] => AI_SURFACES.filter(s => s.kind === 'assist')
