// Helpers over fixtures/scenarios.json, shared by the offline connector and the seed script.
import fs from 'node:fs';
import path from 'node:path';
import { SCENARIOS, DOCS_DIR } from './config.js';

export const payers = SCENARIOS.payers;
export const invoices = SCENARIOS.invoices;
export const brand = SCENARIOS.brand;

export const payerById = (id) => payers.find((p) => p.id === id);
export const invoiceByNumber = (n) => invoices.find((i) => i.docNumber === String(n));
export const invoicesFor = (payerId) => invoices.filter((i) => i.payer === payerId);
export const gross = (inv) => inv.qty * inv.rate;
export const paid = (inv) => gross(inv) - inv.deduction.amount;

export function remitSubject(p) {
  const r = p.remittance;
  return `${p.name} payment advice · ${r.method} ${r.number} · Invoice${invoicesFor(p.id).length > 1 ? 's' : ''} ${invoicesFor(p.id).map((i) => i.docNumber).join(', ')}`;
}

// The packet of supporting documents for an invoice (file names in fixtures/docs).
export function packetFiles(n) {
  const all = fs.readdirSync(DOCS_DIR);
  const re = new RegExp(`^(Invoice|Manifest|POD|PriceLetter|PromoAgreement|SlottingAgreement|PO|Appointment)_${n}(_[A-Za-z]+)?\\.pdf$`);
  const order = ['Invoice', 'PO', 'Manifest', 'POD', 'Appointment', 'PriceLetter', 'PromoAgreement', 'SlottingAgreement'];
  return all.filter((f) => re.test(f)).sort((a, b) => order.indexOf(a.split('_')[0]) - order.indexOf(b.split('_')[0]) || a.localeCompare(b));
}

export const docBytes = (name) => fs.readFileSync(path.join(DOCS_DIR, name));
