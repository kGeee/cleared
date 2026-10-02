// Reads documents into structured fields.
// With an Anthropic key, Claude reads each PDF itself. Without one, a text parser handles the demo documents.
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { extractText, getDocumentProxy } from 'unpdf';
import { AGENT, config } from './config.js';

const client = AGENT === 'claude' ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;
const cache = new Map();

export function kindOf(name) {
  const n = String(name || '');
  if (/remit|payment.?advice/i.test(n)) return 'remittance';
  if (/^pod|proof.?of.?delivery/i.test(n)) return 'pod';
  if (/^manifest|^bol|bill.?of.?lading/i.test(n)) return 'manifest';
  if (/^price|cost.?change/i.test(n)) return 'price_letter';
  if (/^promo/i.test(n)) return 'promo_agreement';
  if (/^slotting/i.test(n)) return 'slotting_agreement';
  if (/^appointment/i.test(n)) return 'appointment';
  if (/^po[_\s-]|purchase.?order/i.test(n)) return 'purchase_order';
  if (/invoice/i.test(n)) return 'invoice';
  return 'unknown';
}

const DATE = '"YYYY-MM-DD"|null';
const PROMPTS = {
  remittance: `This is a payment advice (remittance) from a retailer or distributor. Return JSON:
{"payer": string|null, "method": "Check"|"EFT"|null, "number": string|null, "payment_date": ${DATE}, "window_days": number|null,
 "lines": [{"invoice_number": string, "gross": number, "deduction_code": string|null, "deduction_ref": string|null, "reason": string|null, "cases": number|null, "deducted": number, "paid": number}]}
"deducted" is positive. "reason" excludes the case count. "window_days" is the dispute window if stated.`,
  invoice: `This is a supplier invoice. Return JSON: {"invoice_number": string|null, "po_number": string|null, "invoice_date": ${DATE}, "total": number|null, "qty": number|null, "unit_price": number|null}`,
  manifest: `This is a shipping manifest / bill of lading. Return JSON: {"cases_shipped": number|null, "pallets": number|null, "po_number": string|null, "ship_date": ${DATE}, "ship_from": [{"location": string, "cases": number}]}`,
  pod: `This is a proof of delivery. Return JSON:
{"location": string|null, "cases_on_manifest": number|null, "accepted_count": number|null, "received_by": string|null, "signed": boolean, "exceptions": string|null, "delivery_date": ${DATE}}
Rules: accepted_count is null if the accepted/received count field is blank. Never infer it from the manifest count. exceptions is null if blank or "None". location is the ship-from location if stated.`,
  price_letter: `This is a cost change notice. Return JSON: {"current_cost": number|null, "new_cost": number|null, "effective_date": ${DATE}}`,
  promo_agreement: `This is a trade promotion agreement. Return JSON: {"name": string|null, "rate_per_case": number|null, "max_cases": number|null, "lump_sum": number|null, "period_start": ${DATE}, "period_end": ${DATE}}`,
  slotting_agreement: `This is a slotting / new item fee agreement. Return JSON: {"fee": number|null, "items": number|null, "stores": number|null, "signed_date": ${DATE}}`,
  purchase_order: `This is a retailer purchase order. Return JSON: {"po_number": string|null, "cases": number|null, "must_arrive_by": ${DATE}}`,
  appointment: `This is a delivery appointment record. Return JSON: {"original_date": ${DATE}, "delivered_date": ${DATE}, "changed_by": "consignee"|"carrier"|"shipper"|null, "reason": string|null}
"consignee" means the receiving DC/retailer changed it.`,
};

async function pdfText(bytes) {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

const num = (s) => (s == null ? null : Number(String(s).replace(/[$,]/g, '')));
const iso = (s) => {
  const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};
const after = (t, label, re = /([^\n]+)/) => {
  const i = t.indexOf(label);
  if (i < 0) return null;
  return t.slice(i + label.length).match(re)?.[1]?.trim() ?? null;
};

// Deterministic parser for the demo documents (used without an API key, and as a fallback).
async function parseText(kind, bytes) {
  const t = await pdfText(bytes);
  switch (kind) {
    case 'remittance': {
      const lines = [];
      const re = /(\d{4})\s+\$([\d,]+\.\d{2})\s+([A-Z]{3,4})\s+([A-Z]{2,3}(?:-[A-Z]{2})?-\d+)\s+(.+?)(?::\s*(\d+)\s+cases)?\s+-\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})/g;
      let m;
      while ((m = re.exec(t))) {
        lines.push({ invoice_number: m[1], gross: num(m[2]), deduction_code: m[3], deduction_ref: m[4], reason: m[5].trim(), cases: m[6] ? Number(m[6]) : null, deducted: num(m[7]), paid: num(m[8]) });
      }
      const head = t.match(/(Check|EFT)\s+(\d+)\s+·\s+Paid\s+(\d{2}\/\d{2}\/\d{4})/);
      return {
        payer: t.match(/\n([^\n]+)\nAccounts payable/)?.[1]?.trim() || null,
        method: head?.[1] || null,
        number: head?.[2] || null,
        payment_date: iso(head?.[3]),
        window_days: num(t.match(/within (\d+) days/)?.[1]),
        lines,
      };
    }
    case 'invoice':
      return {
        invoice_number: t.match(/Invoice\s+(\d+)/)?.[1] || null,
        po_number: after(t, 'CUSTOMER PO\n') ?? t.match(/([A-Z]{2,4}-PO-\d+)/)?.[1] ?? null,
        invoice_date: iso(after(t, 'INVOICE DATE\n')),
        total: num(t.match(/Total\s+\$([\d,.]+)/)?.[1]),
        qty: num(t.match(/case\s+(\d+)\s+\$/)?.[1]),
        unit_price: num(t.match(/case\s+\d+\s+\$([\d,.]+)/)?.[1]),
      };
    case 'manifest': {
      const from = [];
      const sf = t.match(/SHIPPED FROM:\s*([^\n]+)/)?.[1];
      if (sf) for (const p of sf.split('·')) {
        const m = p.trim().match(/(\w+)\s+(\d+)/);
        if (m) from.push({ location: m[1], cases: Number(m[2]) });
      }
      return { cases_shipped: num(t.match(/CASES SHIPPED:\s*(\d+)/)?.[1]), pallets: num(after(t, 'PALLETS\n')), po_number: after(t, 'CUSTOMER PO\n'), ship_date: iso(after(t, 'SHIP DATE\n')), ship_from: from };
    }
    case 'pod': {
      const accepted = t.match(/ACCEPTED COUNT:\s*(?:OS&D \/ EXCEPTIONS:)?\s*(\d+)\b/);
      const exc = t.match(/OS&D \/ EXCEPTIONS:\s*(?:\d+\s*\n)?([^\n]*cases[^\n]*)/) || t.match(/(\d+ cases [^\n]+)/);
      return {
        location: t.match(/SHIP FROM LOCATION:\s*(\w+)/)?.[1] || null,
        cases_on_manifest: num(after(t, 'CASES ON MANIFEST', /\s*(\d+)/)),
        accepted_count: accepted ? Number(accepted[1]) : null,
        received_by: t.match(/Printed name:\s*([^\n]+)/)?.[1]?.trim() || null,
        signed: /Printed name/.test(t),
        exceptions: exc ? exc[1].trim() : null,
        delivery_date: iso(after(t, 'DELIVERY DATE')),
      };
    }
    case 'price_letter':
      return { current_cost: num(after(t, 'CURRENT COST:', /\s*\$([\d,.]+)/)), new_cost: num(after(t, 'NEW COST:', /\s*\$([\d,.]+)/)), effective_date: iso(after(t, 'EFFECTIVE DATE:', /\s*([\d/]+)/)) };
    case 'promo_agreement': {
      const per = t.match(/PERIOD\n(\d{2}\/\d{2}\/\d{4})\s*–\s*(\d{2}\/\d{2}\/\d{4})/);
      return { name: after(t, 'PROMOTION\n'), rate_per_case: num(after(t, 'RATE PER CASE:', /\s*\$([\d,.]+)/)), max_cases: num(after(t, 'MAX CASES:', /\s*(\d+)/)), lump_sum: null, period_start: iso(per?.[1]), period_end: iso(per?.[2]) };
    }
    case 'slotting_agreement':
      return { fee: num(after(t, 'SLOTTING FEE:', /\s*\$([\d,.]+)/)), items: num(t.match(/(\d+) new item/)?.[1]), stores: num(t.match(/(\d+) store/)?.[1]), signed_date: iso(t.match(/signed (\d{2}\/\d{2}\/\d{4})/)?.[1]) };
    case 'purchase_order':
      return { po_number: after(t, 'PO NUMBER\n'), cases: num(t.match(/case\s+(\d+)\s+\$/)?.[1]), must_arrive_by: iso(after(t, 'MUST ARRIVE BY:', /\s*([\d/]+)/)) };
    case 'appointment': {
      const who = after(t, 'CHANGED BY:', /\s*([^\n]+)/) || '';
      return {
        original_date: iso(after(t, 'ORIGINAL APPOINTMENT:', /\s*([\d/]+)/)),
        delivered_date: iso(after(t, 'DELIVERED APPOINTMENT:', /\s*([\d/]+)/)),
        changed_by: /consignee|dc/i.test(who) ? 'consignee' : /carrier/i.test(who) ? 'carrier' : null,
        reason: t.match(/REASON:\s*([^\n]+)/)?.[1]?.trim() || null,
      };
    }
    default:
      return {};
  }
}

async function claudeRead(kind, bytes) {
  const res = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 1200,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(bytes).toString('base64') } },
          { type: 'text', text: `${PROMPTS[kind]}\nReturn only the JSON object, no prose.` },
        ],
      },
    ],
  });
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}

export async function readDocument(name, bytes) {
  const kind = kindOf(name);
  const key = crypto.createHash('sha256').update(bytes).digest('hex');
  if (cache.has(key)) return { kind, ...cache.get(key) };
  let fields;
  let reader = 'parser';
  if (client && PROMPTS[kind]) {
    try {
      fields = await claudeRead(kind, bytes);
      reader = 'claude';
    } catch (e) {
      console.warn(`[extract] Claude read of ${name} failed, using parser:`, e.message);
    }
  }
  if (!fields) fields = await parseText(kind, bytes);
  cache.set(key, { fields, reader });
  return { kind, fields, reader };
}
