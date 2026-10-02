// Offline rehearsal connectors. Same interface as the live QuickBooks and Microsoft connectors,
// backed by fixtures/scenarios.json and the PDFs in fixtures/docs. Nothing leaves your machine.
import { round2 } from '../config.js';
import * as store from '../store.js';
import { brand, payers, payerById, invoiceByNumber, gross, paid, remitSubject, packetFiles, docBytes } from '../scenario.js';

const sent = [];
function state() {
  return store.load('offline', { quickbooks: false, microsoft: false, notes: {} });
}
function setState(patch) {
  store.save('offline', { ...state(), ...patch });
}

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
    const s = invoiceByNumber(n);
    if (!s) return null;
    const p = payerById(s.payer);
    return {
      id: `offline-${s.docNumber}`,
      docNumber: s.docNumber,
      customer: p.name,
      customerId: `offline-${p.id}`,
      txnDate: s.txnDate,
      dueDate: s.dueDate,
      terms: 'Net 30',
      poNumber: s.poNumber,
      lines: [{ description: brand.product, qty: s.qty, rate: s.rate, amount: gross(s) }],
      total: gross(s),
      balance: round2(gross(s) - paid(s)),
      status: 'Open',
      privateNote: state().notes?.[s.docNumber] || '',
    };
  },
  async getPayments(invoice) {
    const s = invoiceByNumber(invoice.docNumber);
    const r = payerById(s.payer).remittance;
    return { payments: [{ id: `offline-pmt-${r.number}`, date: r.paymentDate, reference: `${r.method === 'Check' ? '' : 'EFT '}${r.number}`, applied: paid(s), memo: '' }], totalPaid: paid(s) };
  },
  async addNote(invoice, note) {
    setState({ notes: { ...(state().notes || {}), [invoice.docNumber]: note } });
    return true;
  },
};

function remitFor(p) {
  const r = p.remittance;
  return {
    message: { id: `offline-remit-${p.id}`, subject: remitSubject(p), from: r.from, fromAddress: r.fromAddress, received: `${r.paymentDate}T16:04:00Z`, preview: `Payment advice for ${r.method} ${r.number}. Remittance detail attached.` },
    attachment: { name: r.fileName, bytes: docBytes(r.fileName) },
  };
}

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
  async listRemittances() {
    return payers.map(remitFor);
  },
  async findRemittance(n) {
    const s = invoiceByNumber(n);
    return s ? remitFor(payerById(s.payer)) : null;
  },
  async listPacket(n) {
    const folder = `Cleared Demo/Invoice ${n} packet`;
    if (!invoiceByNumber(n)) return { folder, files: [] };
    return { folder, files: packetFiles(n).map((name) => ({ id: `offline:${name}`, name })) };
  },
  async downloadFile(id) {
    return docBytes(id.replace(/^offline:/, ''));
  },
  async findReply() {
    return null; // offline rehearsal uses "Simulate reply" instead
  },
  async sendMail({ to, subject, html, attachments }) {
    const msg = { id: `offline-sent-${sent.length + 1}`, sentAt: new Date().toISOString(), to, subject, html, attachments: attachments.map((a) => a.name) };
    sent.push(msg);
    return { id: msg.id, sentAt: msg.sentAt, webLink: null };
  },
  deductionsEmailFor(customer) {
    return payers.find((p) => p.name === customer)?.deductionsEmail || 'deductions@example.com';
  },
};
