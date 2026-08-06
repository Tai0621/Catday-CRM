import type Anthropic from '@anthropic-ai/sdk'
import { EXPENSE_CATEGORIES } from '../finance-categories'
import {
  LOG_APPETITE, LOG_STOOL, LOG_URINE, LOG_ENERGY,
  LOG_BEHAVIOR, LOG_RESPIRATORY, LOG_SKIN,
} from '../constants'
import { MAX_PROPOSED_EXPENSE_RM } from './proposals'

// ── C2 · The five writes the assistant may propose ───────────────────────────
//
// Every one of these DRAFTS. None writes. The description says so in the first
// line of each, because a model that believes a tool has already acted will
// tell the user it is done and move on.
//
// Arguments are NAMES, not ids. The model never sees a cuid and never needs to:
// resolution happens in proposals.ts, where an ambiguous "Luna" becomes a
// refusal instead of a guess.
//
// The enumerated fields below are the same allow-lists the manual UI's chips
// offer. Putting them in the schema is a courtesy to the model — the server
// validates them again regardless, since a description is a suggestion and a
// `where` clause is not.

const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object' as const, properties, required,
})

export const writeToolDefs: Anthropic.Tool[] = [
  {
    name: 'draft_whatsapp',
    description:
      'DRAFT a WhatsApp message to one customer. Nothing is sent — staff review it and confirm. ' +
      'Refuses for customers without marketing consent or messaged recently, so do not promise it will go out. ' +
      'Write the message in full, personalised, ready to send.',
    input_schema: obj({
      customerName: { type: 'string', description: 'Customer name or phone fragment. Must match exactly one customer.' },
      body: { type: 'string', description: 'The complete message text, as the customer will read it.' },
    }, ['customerName', 'body']),
  },
  {
    name: 'draft_appointment',
    description:
      'DRAFT a booking. Nothing is booked — staff review it and confirm. ' +
      'Price, duration and end time are computed by the system from the service, so do not state a price. ' +
      'Give endISO only for boarding (it is the check-out); omit it for grooming and bath.',
    input_schema: obj({
      catName: { type: 'string', description: 'Cat name. Must match exactly one cat.' },
      serviceName: { type: 'string', description: 'Service name as it appears in the service list.' },
      startISO: { type: 'string', description: 'Start / check-in as an ISO datetime, e.g. 2026-08-09T14:00:00+08:00' },
      endISO: { type: 'string', description: 'Boarding check-out as an ISO datetime. Omit for grooming.' },
      roomName: { type: 'string', description: 'Room name, boarding only. Omit to leave unassigned.' },
      notes: { type: 'string', description: 'Anything the groomer should know.' },
    }, ['catName', 'serviceName', 'startISO']),
  },
  {
    name: 'draft_care_note',
    description:
      "DRAFT today's daily care log for a cat currently boarding. Nothing is saved — staff review it and confirm. " +
      'Only record observations that were actually reported to you; leave a field out rather than guessing it.',
    input_schema: obj({
      catName: { type: 'string', description: 'Cat name. Must be currently checked in for boarding.' },
      period: { type: 'string', enum: ['AM', 'PM'], description: 'Which round.' },
      appetite: { type: 'string', enum: [...LOG_APPETITE] },
      stool: { type: 'string', enum: [...LOG_STOOL] },
      urine: { type: 'string', enum: [...LOG_URINE] },
      energy: { type: 'string', enum: [...LOG_ENERGY] },
      respiratory: { type: 'string', enum: [...LOG_RESPIRATORY] },
      skin: { type: 'string', enum: [...LOG_SKIN] },
      behavior: { type: 'array', items: { type: 'string', enum: [...LOG_BEHAVIOR] }, description: 'Any that apply.' },
      vomiting: { type: 'boolean' },
      notes: { type: 'string', description: 'Anything the structured fields do not cover.' },
    }, ['catName', 'period']),
  },
  {
    name: 'draft_reorder_level',
    description:
      'DRAFT a change to a product\'s reorder threshold — the stock level at which it starts flagging as low. ' +
      'Nothing changes — staff review it and confirm. This does not order anything and does not change stock or price.',
    input_schema: obj({
      productName: { type: 'string', description: 'Product name. Must match exactly one active product.' },
      reorderLevel: { type: 'number', description: 'Units at or below which it flags as low. Use 0 or omit to turn the alert off.' },
    }, ['productName']),
  },
  {
    name: 'draft_expense',
    description:
      `DRAFT a cost for the income statement. Nothing is recorded — staff review it and confirm. ` +
      `Category must be one of the listed values. Amounts above RM ${MAX_PROPOSED_EXPENSE_RM} must be entered by hand instead.`,
    input_schema: obj({
      category: { type: 'string', enum: [...EXPENSE_CATEGORIES], description: 'Which line of the income statement it belongs to.' },
      amount: { type: 'number', description: 'Amount in RM.' },
      dateStr: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
      vendor: { type: 'string', description: 'Supplier or payee.' },
      notes: { type: 'string' },
      paid: { type: 'boolean', description: 'False if it is owed rather than settled — it becomes an account payable.' },
    }, ['category', 'amount']),
  },
]

/** Tool name → proposal kind. The only mapping; an unlisted tool name cannot propose anything. */
export const TOOL_TO_KIND: Record<string, string> = {
  draft_whatsapp: 'whatsapp',
  draft_appointment: 'appointment',
  draft_care_note: 'careNote',
  draft_reorder_level: 'reorder',
  draft_expense: 'expense',
}

export const isWriteTool = (name: string) => name in TOOL_TO_KIND
