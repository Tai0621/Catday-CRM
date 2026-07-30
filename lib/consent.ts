// Track A / A4 — marketing-consent provenance. One helper the four write paths
// (new/edit customer, Google Forms webhook, WhatsApp/walk-in resolution) share so
// consent, its timestamp and its source always move together.
//
// Giving consent stamps the time + channel; an already-consented customer keeps
// their original stamp (re-saving the form doesn't reset it); withdrawing consent
// clears both. This is what lets us prove *when and how* consent was obtained.

export type ConsentSource = 'Staff' | 'GoogleForm' | 'WhatsApp' | 'WalkIn' | 'Import'

export type ConsentFields = {
  marketingConsent: boolean
  marketingConsentAt: Date | null
  marketingConsentSource: string | null
}

export function consentUpdate(
  consent: boolean,
  source: ConsentSource,
  existing?: { marketingConsentAt?: Date | null; marketingConsentSource?: string | null } | null,
): ConsentFields {
  if (!consent) {
    return { marketingConsent: false, marketingConsentAt: null, marketingConsentSource: null }
  }
  return {
    marketingConsent: true,
    marketingConsentAt: existing?.marketingConsentAt ?? new Date(),
    marketingConsentSource: existing?.marketingConsentSource ?? source,
  }
}
