'use server'

import { db } from '@/lib/db'
import { requireManager } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { parseHex, toHex, evaluateBrand } from '@/lib/brand/contrast'
import { revalidatePath } from 'next/cache'

// C7 · Save the brand colours.
//
// The client proposed them, so nothing it sent is trusted: the hex is re-parsed
// and the SAME contrast check is re-run here. Below the readable threshold the
// save is refused unless the manager explicitly ticked the override — which is
// then recorded, because "the app is hard to read" is a support call somebody
// will make in six months and the answer should be findable.

export async function saveBrandColours(data: FormData) {
  await requireManager()

  const primaryRgb = parseHex(String(data.get('primary') ?? ''))
  const inkRgb = parseHex(String(data.get('ink') ?? ''))
  if (!primaryRgb || !inkRgb) return

  const primary = toHex(primaryRgb)
  const ink = toHex(inkRgb)

  const checks = evaluateBrand(primary, ink)
  const failing = checks.filter(c => !c.passes)
  const override = String(data.get('override') ?? '') === 'yes'
  if (failing.length > 0 && !override) return

  for (const [key, value] of [['brand.primary', primary], ['brand.ink', ink]] as const) {
    await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } })
  }

  await recordAudit({
    action: 'brand.colours',
    entityType: 'Setting',
    summary: `Brand colours set to ${primary} / ${ink}`
      + (failing.length > 0 ? ` — saved below the readable threshold (${failing.map(f => f.label).join(', ')})` : ''),
    detail: { primary, ink, override, checks },
  })

  // The colours are injected into every page from the root layout, so the whole
  // app is stale after this.
  revalidatePath('/', 'layout')
}
