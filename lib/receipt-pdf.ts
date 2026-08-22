import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type { ReceiptView } from './receipt'
import { displayPhone } from './phone'

// The customer's receipt, as a PDF.
//
// This is the only Cat Day artefact that leaves the building, so it is a
// document rather than a screenshot of one: a real page the customer can save,
// forward to an employer, or hand to an accountant. It is also the reason the
// public link serves a PDF and not a page — a page is a door into the app, and
// a customer has no business being handed one.
//
// ── Typography ───────────────────────────────────────────────────────────────
//
// The brand's own Inter and Space Mono, embedded, because this is the one
// artefact that leaves the building and it should not be lettered in Helvetica.
// Both are SIL Open Font Licence 1.1, which permits embedding in a document;
// the files come from @fontsource, whose package licence says so.
//
// A CORRECTION worth recording. The plan claimed embedding a real font would
// also fix names the standard fonts cannot encode — a Malaysian business will
// have customers called 陈美玲 — and that is NOT true. @fontsource ships
// SUBSETTED files, and the latin subset has no CJK glyphs at all: fontkit
// accepts the codepoints without complaint and draws .notdef, so the name comes
// out as empty boxes instead of being stripped. Neither is a receipt.
//
// So `nameFor` below checks glyph coverage and falls back to the phone number
// when the font cannot draw a name. A receipt reading "+60 12-345 6789" is
// correct and useful; one reading "□□□" is not. Genuinely fixing it needs a
// font with CJK coverage, which is several megabytes — noted, not done.
//
// Helvetica remains the fallback if a font file is ever missing, so a receipt
// still renders rather than 500ing.

const INK = rgb(0x2d / 255, 0x19 / 255, 0x07 / 255)
const LINEN = rgb(0xf2 / 255, 0xed / 255, 0xe0 / 255)
const PAPER = rgb(0xfd / 255, 0xfb / 255, 0xf5 / 255)
const RUST = rgb(0xb1 / 255, 0x49 / 255, 0x19 / 255)
const GOLD = rgb(0x8a / 255, 0x6c / 255, 0x00 / 255)
const HAIR = rgb(0.78, 0.75, 0.70)
const MUTED = rgb(0.55, 0.50, 0.44)

const A5: [number, number] = [419.53, 595.28]
const MARGIN = 26
const PAD = 22

/**
 * Make a string safe for a standard PDF font, and free of em-dashes.
 *
 * Two jobs, both load-bearing:
 *
 *  • Em-dashes are stripped because the owner asked for a receipt without them.
 *    They are not only in our copy — service names in the database carry them
 *    ("Boarding — Standard (per night)"), so stripping has to happen at render
 *    or the data would put them back.
 *
 *  • WinAnsi cannot encode every character a name might contain, and pdf-lib
 *    THROWS on one it cannot write. An un-renderable character in a customer's
 *    name would turn their receipt into a 500, so anything outside the
 *    encodable range is replaced rather than allowed to blow up the document.
 */
export function pdfText(s: string): string {
  return s
    .replace(/\s*[—–]\s*/g, ' - ')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/…/g, '...')
    // WinAnsi covers Latin-1 plus a handful of punctuation already handled above.
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    .trim()
}

const money = (n: number) => `RM ${n.toFixed(2)}`

/** Break `text` to fit `width`, so a long service name wraps instead of running off the page. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']
  const lines: string[] = []
  let line = words[0]
  for (const w of words.slice(1)) {
    const next = `${line} ${w}`
    if (font.widthOfTextAtSize(next, size) <= width) line = next
    else { lines.push(line); line = w }
  }
  lines.push(line)
  return lines
}

/**
 * The tenant's own brand mark, from `brand.logoUrl` — NOT a hardcoded Cat Day
 * file. The logo is a per-tenant setting, and printing one business's mark on
 * another's receipt is the exact mistake that once put "Cat Day OS" under a
 * Velvet Paw logo.
 *
 * PDFs can only carry raster images, so an SVG logo cannot be embedded. That is
 * not a failure: the caller falls back to the business name set as a wordmark,
 * which is still that tenant's identity and never someone else's.
 */
async function loadLogo(doc: PDFDocument, logoUrl: string): Promise<PDFImage | null> {
  const local = logoUrl.startsWith('/') && !logoUrl.startsWith('//') ? logoUrl.slice(1) : null
  if (!local) return null

  const ext = path.extname(local).toLowerCase()
  if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') return null

  try {
    const bytes = await readFile(path.join(process.cwd(), 'public', ...local.split('/')))
    return ext === '.png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
  } catch {
    // A missing logo must not cost the customer their receipt.
    return null
  }
}

/** Brand fonts, with Helvetica as the fallback if a file cannot be read. */
async function loadFonts(doc: PDFDocument) {
  const at = (pkg: string, file: string) =>
    path.join(process.cwd(), 'node_modules', '@fontsource', pkg, 'files', file)
  try {
    doc.registerFontkit(fontkit)
    const [regular, bold, mono] = await Promise.all([
      readFile(at('inter', 'inter-latin-400-normal.woff')),
      readFile(at('inter', 'inter-latin-700-normal.woff')),
      readFile(at('space-mono', 'space-mono-latin-700-normal.woff')),
    ])
    return {
      regular: await doc.embedFont(regular, { subset: true }),
      bold: await doc.embedFont(bold, { subset: true }),
      mono: await doc.embedFont(mono, { subset: true }),
      brand: true,
    }
  } catch (e) {
    // Say so. A silent fall back to Helvetica still produces a receipt, which
    // is right for the customer and means nobody would ever notice the brand
    // font had stopped shipping.
    console.warn('receipt: brand fonts unavailable, falling back to Helvetica —', (e as Error)?.message)
    return {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
      mono: await doc.embedFont(StandardFonts.Courier),
      brand: false,
    }
  }
}

/**
 * A name the chosen font can actually draw, or the phone number instead.
 *
 * See the note at the top: an embedded latin subset does not contain CJK, and
 * silently draws .notdef boxes for it. Falling back to the phone keeps the
 * receipt correct for a customer whose name this font cannot letter.
 */
export function nameFor(
  name: string | null | undefined,
  phone: string,
  font: PDFFont,
): string {
  const cleaned = pdfText(name ?? '')
  if (!cleaned) return displayPhone(phone)
  try {
    // widthOfTextAtSize throws on a character the font cannot encode at all;
    // a .notdef substitution does not throw, so check coverage directly.
    const chars = [...cleaned].filter(c => c.trim())
    const drawable = chars.every(c => {
      try { return font.widthOfTextAtSize(c, 10) > 0 } catch { return false }
    })
    return drawable ? cleaned : displayPhone(phone)
  } catch {
    return displayPhone(phone)
  }
}

export interface ReceiptBusiness {
  name: string
  tagline?: string
  address?: string
  phone?: string
}

export async function renderReceiptPdf(
  view: ReceiptView,
  business: ReceiptBusiness,
  logoUrl: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(pdfText(`Receipt ${view.reference ?? view.id} - ${business.name}`))
  doc.setAuthor(pdfText(business.name))
  doc.setSubject('Receipt')
  doc.setCreationDate(view.date)

  const { regular, bold, mono } = await loadFonts(doc)
  const logo = await loadLogo(doc, logoUrl)

  const [pw, ph] = A5
  const innerW = pw - MARGIN * 2 - PAD * 2
  const colGap = 12
  const amountW = 74
  const descW = innerW - amountW - colGap

  let page!: PDFPage
  let y = 0

  /** Start a page: linen ground, paper panel, cursor at the top of the panel. */
  const newPage = () => {
    page = doc.addPage(A5)
    page.drawRectangle({ x: 0, y: 0, width: pw, height: ph, color: LINEN })
    page.drawRectangle({
      x: MARGIN, y: MARGIN, width: pw - MARGIN * 2, height: ph - MARGIN * 2,
      color: PAPER, borderColor: HAIR, borderWidth: 0.8,
    })
    y = ph - MARGIN - PAD
  }

  const text = (s: string, opts: { size?: number; font?: PDFFont; color?: typeof INK; x?: number }) => {
    const size = opts.size ?? 9
    page.drawText(pdfText(s), {
      x: opts.x ?? MARGIN + PAD, y, size, font: opts.font ?? regular, color: opts.color ?? INK,
    })
  }

  const centred = (s: string, size: number, font: PDFFont, color = INK) => {
    const t = pdfText(s)
    const w = font.widthOfTextAtSize(t, size)
    page.drawText(t, { x: (pw - w) / 2, y, size, font, color })
  }

  const rightAt = (s: string, size: number, font: PDFFont, color = INK) => {
    const t = pdfText(s)
    const w = font.widthOfTextAtSize(t, size)
    page.drawText(t, { x: pw - MARGIN - PAD - w, y, size, font, color })
  }

  const rule = (dashed = true) => {
    page.drawLine({
      start: { x: MARGIN + PAD, y }, end: { x: pw - MARGIN - PAD, y },
      thickness: 0.8, color: HAIR, ...(dashed ? { dashArray: [2, 2] } : {}),
    })
  }

  /** Reserve vertical space, breaking to a new page when the panel runs out. */
  const need = (h: number) => {
    if (y - h < MARGIN + PAD + 46) {
      // Say the receipt continues, or a second page reads as a separate document.
      y = MARGIN + PAD + 22
      centred('continued overleaf', 7.5, regular, MUTED)
      newPage()
      y -= 6
    }
    y -= h
  }

  newPage()

  // ── Masthead ──
  if (logo) {
    const lw = 128
    const lh = (logo.height / logo.width) * lw
    y -= lh
    page.drawImage(logo, { x: (pw - lw) / 2, y, width: lw, height: lh })
    y -= 12
  } else {
    y -= 16
    centred(business.name.toUpperCase(), 13, bold)
    y -= 6
  }

  if (business.tagline) {
    y -= 9
    centred(business.tagline.toUpperCase(), 7, regular, MUTED)
  }
  // The business phone is shown exactly as configured. Running it through
  // displayPhone (which is built for normalised customer mobiles) turned
  // "+60 3-0000 0000" into "+60 3-00000000" on every receipt.
  const contact = [business.address, business.phone].filter(Boolean).join('  ·  ')
  if (contact) {
    y -= 11
    centred(contact, 7.5, regular, MUTED)
  }

  y -= 16
  rule()

  // ── Who and when ──
  y -= 15
  text('RECEIPT', { size: 7.5, font: bold, color: MUTED })
  rightAt(view.reference ?? view.id, 9, mono)

  y -= 13
  text('Date', { size: 7.5, color: MUTED })
  rightAt(view.date.toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' }), 8.5, regular)

  if (view.customer) {
    y -= 13
    text('Customer', { size: 7.5, color: MUTED })
    rightAt(nameFor(view.customer.name, view.customer.phone, regular), 8.5, regular)
  }

  y -= 14
  rule()

  // ── Items ──
  y -= 15
  text('ITEM', { size: 7, font: bold, color: MUTED })
  rightAt('AMOUNT', 7, bold, MUTED)
  y -= 8
  rule(false)

  for (const line of view.lines) {
    const label = pdfText(line.description) + (line.quantity > 1 ? `  x${line.quantity}` : '')
    const rows = wrap(label, regular, 9, descW)
    need(14)
    text(rows[0], { size: 9 })
    rightAt(money(line.subtotal), 9, regular)
    for (const extra of rows.slice(1)) {
      need(11)
      text(extra, { size: 9, color: MUTED })
    }
    y -= 4
  }

  // ── Total ──
  need(14)
  rule()
  need(20)
  text('TOTAL', { size: 9.5, font: bold })
  rightAt(money(view.grandTotal), 15, bold)

  if (view.payments.length > 0) {
    need(12)
    for (const p of view.payments) {
      text(`Paid by ${p.method}`, { size: 8, color: MUTED })
      rightAt(money(p.amount), 8, regular, MUTED)
      need(11)
    }
    y += 11
  }

  if (view.points) {
    need(13)
    text('Points earned', { size: 8, color: GOLD })
    rightAt(`+${view.points}`, 8, bold, GOLD)
  }

  // ── Footer, pinned to the bottom of the panel ──
  y = MARGIN + PAD + 34
  rule()
  y -= 14
  centred('Thank you for visiting. See you and your cat again soon.', 8.5, regular, INK)
  y -= 11
  centred(`${business.name}  ·  this is a digital receipt`, 7, regular, MUTED)

  // A tiny rust rule at the very bottom: the one brand accent on the page.
  page.drawRectangle({ x: MARGIN, y: MARGIN, width: pw - MARGIN * 2, height: 3, color: RUST })

  return doc.save()
}
