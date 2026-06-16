// Normalise Malaysian phone numbers to 60xxxxxxxxx format
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('60')) return digits
  if (digits.startsWith('0')) return `6${digits}`
  return `60${digits}`
}

export function displayPhone(normalised: string): string {
  // 601x-xxxxxxx or 60x-xxxxxxx
  const d = normalised.replace(/\D/g, '')
  if (d.startsWith('60')) {
    const local = d.slice(2)
    if (local.startsWith('1')) return `+60 ${local.slice(0, 2)}-${local.slice(2)}`
    return `+60 ${local.slice(0, 1)}-${local.slice(1)}`
  }
  return normalised
}

export function whatsappUrl(phone: string, message?: string): string {
  const n = normalisePhone(phone)
  const base = `https://wa.me/${n}`
  if (!message) return base
  return `${base}?text=${encodeURIComponent(message)}`
}
