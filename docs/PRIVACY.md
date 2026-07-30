# Data protection & privacy — data map

This document is the **data map** for the Cat Day Business OS: what personal data
the system holds, why, where it lives, how long it's kept, and how a data subject's
rights are honoured. It is the artefact a client's privacy officer (or an auditor
under Malaysia's **PDPA 2010**, or the **GDPR/CCPA** for clients serving abroad)
will ask for. Keep it current when a schema change adds or removes personal data.

The OS is **single-tenant**: each client runs their own isolated instance (own
database, own Blob store, own credentials). One client's data never shares storage
with another's.

---

## 1. What personal data is held, and why

| Data subject | Model(s) | Personal fields | Purpose | Lawful basis |
|---|---|---|---|---|
| **Customer** | `Customer` | `phone` (unique id), `name`, `email`, `address`, `notes`, `source`, `marketingConsent` | Booking, POS, loyalty, wallet, membership, service history | Contract (service delivery); consent for marketing |
| | `LoyaltyEntry`, `WalletEntry` | ledger of points/stored value tied to the customer | Loyalty & prepaid wallet | Contract |
| | `Transaction`, `TransactionLine` | purchase history, amounts | Sales record, **financial/tax retention** | Legal obligation |
| | `Appointment` | visit schedule & status | Operations | Contract |
| | `Membership` | tier, dates | Membership programme | Contract |
| **Cat** (about the customer's pet; may indirectly identify owner) | `Cat` | `name`, `breed`, health/care/feeding notes, vaccination & treatment dates | Grooming/boarding care | Contract |
| | `CatAssessment`, `MediaAsset (ownerType 'cat'/'assessment')` | condition notes, **photos/videos** | Care record, before/after evidence | Contract |
| **Lead / enquirer** | `WhatsAppLead`, `WhatsAppMessage` | phone, message text | Enquiry handling | Legitimate interest / pre-contract |
| **Job applicant** | `JobApplication` | `name`, `phone`, `email`, message, role applied for | Recruitment | Consent / pre-contract |
| **Staff** | `Staff` | `name`, `role`, `pinHash` (salted scrypt — never plaintext), commission rate | Employment, access control | Contract (employment) |
| | `TimeEntry` | clock-in/out times, selfie (`MediaAsset ownerType 'timeclock'`), IP at punch | Attendance, anti-buddy-punch | Legitimate interest (employment) |
| | `LeaveRequest` | leave type, dates, reason | Leave management | Contract (employment) |
| **Actor (audit)** | `AuditLog` | actor name/id, action, entity, summary | Security & accountability | Legal obligation / legitimate interest |

**Not held:** no passwords for customers (they never log in), no payment-card
numbers (card handling is out of band), no government IDs, no bank details.
Customer photos are **not** stored as base64 on the `Cat` row — that legacy column
was removed (see §4); all images live in private Blob and are served only through
the authenticated media proxy.

---

## 2. Where data lives (storage & sub-processors)

| Store | Contents | Provider | Region |
|---|---|---|---|
| Primary database (libsql) | all structured data above | **Turso** | `aws-ap-northeast-1` (Tokyo) |
| Blob object store (private) | photos, videos, clock-in selfies | **Vercel Blob** | — |
| Application hosting | the app; no data at rest beyond logs | **Vercel** | `hnd1` (Tokyo) |
| Error monitoring (optional) | scrubbed stack traces (PII stripped, see `lib/sentry-scrub.ts`) | **Sentry** | — |
| Rate-limit counters (optional) | hashed login-throttle keys, no PII | **Upstash Redis** | — |
| AI assistant (optional) | prompt text sent per request; not used for training | **Anthropic** | — |
| WhatsApp messaging (optional) | inbound/outbound message content | **Meta / WhatsApp** | — |

Blob objects use `access: 'private'` and are reachable only via
`GET /api/media/[id]/file` behind the auth gate — never on a public URL.

---

## 3. Security posture (already implemented)

- **Transport:** HTTPS everywhere; HSTS in production.
- **Auth:** single httpOnly signed session cookie (HMAC-SHA256, 30-day hard
  expiry, epoch-revocable); staff PINs are salted scrypt; login rate-limited
  (8 fails / 15 min). Manager-only routes gated in `proxy.ts` **and** by
  `requireManager()` in the page (defence in depth).
- **Headers:** CSP (`frame-ancestors`/`object-src`/`base-uri`/`form-action`),
  `X-Frame-Options: DENY`.
- **Webhooks / cron:** fail-closed, signature/secret-checked.
- **Audit trail:** sensitive actions (deletes, PIN resets, wallet/loyalty
  adjustments, leave/commission changes) recorded append-only in `AuditLog`.
- **Backups:** scheduled DB backup + documented restore (`docs/BACKUP_RESTORE.md`).

---

## 4. Retention

| Category | Retention | Rationale |
|---|---|---|
| Financial records (`Transaction`, ledgers) | **7 years** | Malaysian tax/accounting statutory minimum |
| Customer profile & pet care records | Life of relationship + retention window; erasable on request (see §5) | Contract |
| Job applications | 12 months after decision, then eligible for erasure | Recruitment norm |
| WhatsApp leads/messages | Kept while relevant; anonymised with the linked customer | Legitimate interest |
| Audit log | Retained (security record) | Legal/security |

Retention windows are configurable (see the `getConfig` seam). Erasure of a
customer respects the financial-record window — see §5.

---

## 5. Data-subject rights — how they're honoured

- **Right of access / portability (A2):** a manager can export a customer's
  complete record (profile, cats, appointments, transactions, wallet & loyalty
  ledgers, media list, WhatsApp history) as a machine-readable JSON bundle from
  the customer page (`GET /api/customers/[id]/export`). Media bytes stay in
  private Blob and are referenced by URL. The disclosure is audit-logged
  (`customer.export`).
- **Right to erasure / "be forgotten" (A3):** two steps, because financial
  records carry a statutory retention obligation:
  1. **Anonymise now** (`POST /api/customers/[id]/erase`, manager-only,
     confirm-required, audit-logged as `customer.erase`): the customer's
     identifying fields (name, phone→token, email, address, free-text notes) and
     their cats' free-text health/care notes are redacted, all photos/videos are
     deleted, and linked WhatsApp content is blanked. De-identified financial rows
     are kept so the books stay correct. `Customer.erasedAt` is set.
  2. **Purge after the window** (`/api/cron/retention`, daily): once an anonymised
     customer's newest financial record has aged past `data.retentionYears`
     (default **7**, editable in Settings), the remaining de-identified rows are
     hard-deleted (audit `customer.purge`). This completes the erasure without
     breaching tax retention in the meantime.
- **Right to rectification:** editable throughout the CRM.
- **Right to object / withdraw marketing consent (A4):** `Customer.marketingConsent`
  toggle, recorded together with **when** (`marketingConsentAt`) and **through which
  channel** (`marketingConsentSource`) it was given — the provenance a regulator
  asks for. Withdrawing consent clears the stamp. A plain-language public **privacy
  notice** lives at `/privacy`, linked from the job-application form and the digital
  receipt.

---

## 6. Breach & contact

- On suspected breach: rotate `SESSION_SECRET`/`APP_PASSWORD` (invalidates all
  sessions), bump `SESSION_EPOCH`, review `AuditLog`, restore from backup if data
  integrity is in doubt, and notify affected data subjects and the relevant
  authority within the statutory window.
- **Data controller / contact:** _(per-client — fill in the client's business name
  and privacy contact when provisioning a new instance)._

---

_Last reviewed: A3 data-protection round (export + erasure + retention purge live).
Update this file whenever a schema change adds, removes, or repurposes personal data._
