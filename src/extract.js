// Reads documents (remittance, invoice, manifest, POD) into structured fields.
// With an Anthropic key, Claude reads the PDF itself. Without one, a text parser handles the demo documents.
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { extractText, getDocumentProxy } from 'unpdf';
import { AGENT, config } from './config.js';

const client = AGENT === 'claude' ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;
const cache = new Map();

export function kindOf(name) {
  if (/remit|payment.?advice/i.test(name)) return 'remittance';
  if (/^pod|proof.?of.?delivery/i.test(name)) return 'pod';
  if (/manifest|bol|bill.?of.?lading/i.test(name)) return 'manifest';
  if (/invoice/i.test(name)) return 'invoice';
  return 'unknown';
}

const PROMPTS = {
  remittance: `This is a retailer/distributor payment advice (remittance). Return JSON:
{"check_number": string|null, "payment_date": "YYYY-MM-DD"|null, "lines": [{"invoice_number": string, "gross": number, "deduction_ref": string|null, "deduction_code": string|null, "reason": string|null, "cases": number|null, "deducted": number, "paid": number}]}
"deducted" is a positive number.`,
  invoice: `This is a supplier invoice. Return JSON: {"invoice_number": string|null, "po_number": string|null, "total": number|null, "qty": number|null, "unit_price": number|null}`,
  manifest: `This is a shipping manifest / bill of lading. Return JSON: {"cases_shipped": number|null, "pallets": number|null, "po_number": string|null, "ship_date": "YYYY-MM-DD"|null}`,
  pod: `This is a proof of delivery. Return JSON:
{"cases_on_manifest": number|null, "accepted_count": number|null, "received_by": string|null, "signed": boolean, "exceptions": string|null, "delivery_date": "YYYY-MM-DD"|null}
Rules: accepted_count must be null if the accepted/received count field is blank or not written. Do not infer it from the manifest count. exceptions is null if blank or "None".`,
};

async function pdfText(bytes) {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

const num = (s) => (s == null ? null : Number(String(s).replace(/[$,]/g, '')));

// Deterministic parser for the demo documents (used without an API key, and as a fallback).
async function parseText(kind, bytes) {
  const t = await pdfText(bytes);
  if (kind === 'remittance') {
    const lines = [];
    const re = /(\d{4})\s+\$([\d,]+\.\d{2})\s+([A-Z]{3})\s+(DED-\d+)\s+(.+?):\s*(\d+)\s+cases\s+-\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})/g;
    let m;
    while ((m = re.exec(t))) {
      lines.push({ invoice_number: m[1], gross: num(m[2]), deduction_code: m[3], deduction_ref: m[4], reason: m[5].trim(), cases: Number(m[6]), deducted: num(m[7]), paid: num(m[8]) });
    }
    return { check_number: t.match(/Check\s+(\d+)/)?.[1] || null, payment_date: null, lines };
  }
  if (kind === 'invoice') {
    return { invoice_number: t.match(/Invoice\s+(\d+)/)?.[1] || null, po_number: t.match(/(UNFI-PO-\d+)/)?.[1] || null, total: num(t.match(/Total\s+\$([\d,.]+)/)?.[1]), qty: null, unit_price: null };
  }
  if (kind === 'manifest') {
    return { cases_shipped: num(t.match(/CASES SHIPPED:\s*(\d+)/)?.[1]), pallets: null, po_number: t.match(/(UNFI-PO-\d+)/)?.[1] || null, ship_date: null };
  }
  if (kind === 'pod') {
    const accepted = t.match(/ACCEPTED COUNT:\s*(?:OS&D \/ EXCEPTIONS:)?\s*(\d+)\b/);
    const exc = t.match(/(\d+ cases [^\n]+)/);
    return {
      cases_on_manifest: num(t.match(/CASES ON MANIFEST\s*[\s\S]*?\n?\s*(\d+)/)?.[1]),
      accepted_count: accepted ? Number(accepted[1]) : null,
      received_by: t.match(/Printed name:\s*([^\n]+)/)?.[1]?.trim() || null,
      signed: /Printed name/.test(t),
      exceptions: exc ? exc[1].trim() : null,
      delivery_date: null,
    };
  }
  return {};
}

async function claudeRead(kind, bytes) {
  const res = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 1024,
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
  if (cache.has(key)) return { kind, fields: cache.get(key), reader: 'cache' };
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
  cache.set(key, fields);
  return { kind, fields, reader };
}
