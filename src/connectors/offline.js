// Offline rehearsal connectors. Same interface as the live QuickBooks and Microsoft connectors,
// backed by fixtures/scenarios.json and the PDFs in fixtures/docs. Nothing leaves your machine.
import fs from 'node:fs';
import path from 'node:path';
import { SCENARIOS, DOCS_DIR, round2 } from '../config.js';
import * as store from '../store.js';

const { brand, customer, remittance, invoices } = SCENARIOS;
const sent = [];

function state() {
  return store.load('offline', { quickbooks: false, microsoft: false, notes: {} });
}
function setState(patch) {
  store.save('offline', { ...state(), ...patch });
}

const scenario = (n) => invoices.find((i) => i.docNumber === String(n));

export const quickbooks = {
  isConnected: () => state().quickbooks,
  info: () => ({ connected: state().quickbooks, company: 'Fable Grove Foods (offline)', environment: 'offline' }),
  authUrl: () => '/auth/offline/quickbooks',
  async callback() {
    setState({ quickbooks: true });
  },
  async disconnect() {
    setState({ quickbooks: false });
  },
  async getInvoice(n) {
    const s = scenario(n);
    if (!s) return null;
    const total = s.qty * brand.unitPrice;
    const paid = total - s.deduction.cases * brand.unitPrice;
    return {
      id: `offline-${s.docNumber}`,
      docNumber: s.docNumber,
      customer: customer.name,
      customerId: 'offline-unfi',
      txnDate: s.txnDate,
      dueDate: s.dueDate,
      terms: 'Net 30',
      poNumber: s.poNumber,
      lines: [{ description: brand.product, qty: s.qty, rate: brand.unitPrice, amount: total }],
      total,
      balance: round2(total - paid),
      status: 'Open',
      privateNote: state().notes?.[s.docNumber] || '',
    };
  },
  async getPayments(invoice) {
    const s = scenario(invoice.docNumber);
    const applied = s.qty * brand.unitPrice - s.deduction.cases * brand.unitPrice;
    return {
      payments: [{ id: 'offline-pmt-7741', date: remittance.paymentDate, reference: remittance.checkNumber, applied, memo: '' }],
      totalPaid: applied,
    };
  },
  async addNote(invoice, note) {
    const notes = { ...(state().notes || {}), [invoice.docNumber]: note };
    setState({ notes });
    return true;
  },
};

export const microsoft = {
  isConnected: () => state().microsoft,
  info: () => ({ connected: state().microsoft, email: 'ar@fablegrove.example (offline)' }),
  authUrl: () => '/auth/offline/microsoft',
  async callback() {
    setState({ microsoft: true });
  },
  async disconnect() {
    setState({ microsoft: false });
  },
  myEmail: () => 'ar@fablegrove.example',
  async findRemittance(n) {
    if (!scenario(n) && !/advice|remit/i.test(String(n))) return null;
    return {
      message: {
        id: 'offline-remit-7741',
        subject: remittance.emailSubject,
        from: 'UNFI Accounts Payable',
        fromAddress: 'ap-remittance@unfi.example',
        received: `${remittance.paymentDate}T16:04:00Z`,
        preview: `Payment advice for check ${remittance.checkNumber}. Remittance detail attached.`,
      },
      attachment: { name: remittance.fileName, bytes: fs.readFileSync(path.join(DOCS_DIR, remittance.fileName)) },
    };
  },
  async listPacket(n) {
    const folder = `Cleared Demo/Invoice ${n} packet`;
    if (!scenario(n)) return { folder, files: [] };
    const files = ['Invoice', 'Manifest', 'POD'].map((k) => ({ id: `offline:${k}_${n}.pdf`, name: `${k}_${n}.pdf` }));
    return { folder, files };
  },
  async downloadFile(id) {
    return fs.readFileSync(path.join(DOCS_DIR, id.replace(/^offline:/, '')));
  },
  async sendMail({ to, subject, html, attachments }) {
    const msg = { id: `offline-sent-${sent.length + 1}`, sentAt: new Date().toISOString(), to, subject, html, attachments: attachments.map((a) => a.name) };
    sent.push(msg);
    return { id: msg.id, sentAt: msg.sentAt, webLink: null };
  },
};
