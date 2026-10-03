// The case engine behind the interactive workspace.
// A "case" is one short-paid invoice. You investigate it, pick an action, approve, and track the reply.
// Records come from QuickBooks / Outlook / OneDrive; money math and the verdict come from assess.js;
// Claude (when configured) reads the PDFs and writes the drafts. Nothing is sent or written without approval.
import Anthropic from '@anthropic-ai/sdk';
import { AGENT, MODE, config, money, moneyExact, SCENARIOS } from './config.js';
import { quickbooks, microsoft } from './sources.js';
import { readDocument, kindOf } from './extract.js';
import { assess, deadlineFor } from './assess.js';
import { checkReconcile, factSet, unverifiedNumbers } from './verify.js';
import * as store from './store.js';

const client = AGENT === 'claude' ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;
const BRAND = SCENARIOS.brand;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fileUrl = (n, name) => `/api/case/${n}/file/${encodeURIComponent(name)}`;
const short = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');
const clean = (r) => String(r).replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();
const usd = (n) => (n == null ? '—' : '$' + Number(n).toFixed(2));

export const LABEL = { remittance: 'Payment advice', invoice: 'Invoice', manifest: 'Manifest', pod: 'Proof of delivery', price_letter: 'Cost change notice', promo_agreement: 'Promotion agreement', slotting_agreement: 'Slotting agreement', purchase_order: 'Purchase order', appointment: 'Appointment record' };
const SHORT = { remittance: 'Remittance', invoice: 'Invoice', manifest: 'Manifest', pod: 'POD', price_letter: 'Cost notice', promo_agreement: 'Promo agreement', slotting_agreement: 'Slotting agreement', purchase_order: 'PO', appointment: 'Appointment' };

// ---------- persisted state (data/cases.json) + in-memory file bytes ----------
const files = new Map(); // `${n}/${name}` -> Buffer
let remitCache = null;

// Case records carry a schema version; records from an older demo build are ignored (treated as new).
const SCHEMA = 2;
const all = () => Object.fromEntries(Object.entries(store.load('cases', {})).filter(([, c]) => c?.v === SCHEMA));
const get = (n) => all()[n] || null;
function put(n, c) {
  c.v = SCHEMA;
  const s = all();
  s[n] = c;
  store.save('cases', s);
  return c;
}
function log(c, text, kind = 'info') {
  c.history = [...(c.history || []), { at: new Date().toISOString(), text, kind }];
}

export function reset() {
  store.save('cases', {});
  files.clear();
  remitCache = null;
}

// ---------- the queue: every line on every payment advice ----------
async function remittances() {
  if (remitCache) return remitCache;
  const list = microsoft.listRemittances ? await microsoft.listRemittances() : [await microsoft.findRemittance('payment advice')].filter(Boolean);
  const out = [];
  for (const r of list) {
    if (!r?.attachment) continue;
    const doc = await readDocument(r.attachment.name, r.attachment.bytes);
    const f = doc.fields;
    const payer = f.payer || r.message.from;
    out.push({
      payer,
      method: f.method || 'Payment',
      number: f.number || '',
      paymentDate: f.payment_date,
      windowDays: f.window_days || config.disputeWindowDays,
      deadline: deadlineFor(f.payment_date, f.window_days || config.disputeWindowDays),
      message: r.message,
      attachment: r.attachment,
      lines: f.lines || [],
      reader: doc.reader,
      file: { name: r.attachment.name, url: `/api/remit/${encodeURIComponent(r.attachment.name)}` },
    });
  }
  remitCache = out;
  return out;
}

export async function queue() {
  const rems = await remittances();
  const state = all();
  const rows = [];
  for (const r of rems) {
    for (const l of r.lines) {
      const n = String(l.invoice_number);
      const c = state[n];
      rows.push({
        n,
        customer: r.payer,
        reason: l.reason,
        code: l.deduction_code,
        ref: l.deduction_ref,
        cases: l.cases,
        amount: l.deducted,
        status: c?.status || 'new',
        verdict: c?.assessment?.verdict || null,
        recover: c?.assessment?.amount ?? null,
        outcome: c?.outcome || null,
        sentAmount: c?.sent?.amount ?? null,
        deadline: r.deadline,
        payment: `${r.method} ${r.number}`,
      });
    }
  }
  const sum = (f) => rows.filter(f).reduce((s, x) => s + (x.status === 'resolved' || x.status === 'accepted' ? x.outcome?.amount ?? x.amount : x.status === 'waiting' ? x.sentAmount ?? x.amount : x.amount), 0);
  const open = rows.filter((x) => ['new', 'ready'].includes(x.status));
  const next = open.map((x) => x.deadline).filter(Boolean).sort((a, b) => a.daysLeft - b.daysLeft)[0] || null;
  return {
    payers: rems.map((r) => ({ name: r.payer, payment: `${r.method} ${r.number}`, paymentDate: r.paymentDate, deadline: r.deadline, file: r.file, count: r.lines.length, withheld: r.lines.reduce((s, l) => s + l.deducted, 0), message: { subject: r.message.subject, from: r.message.from, fromAddress: r.message.fromAddress, received: r.message.received, preview: r.message.preview } })),
    rows,
    totals: {
      withheld: rows.reduce((s, x) => s + x.amount, 0),
      open: open.reduce((s, x) => s + x.amount, 0),
      inDispute: sum((x) => x.status === 'waiting'),
      recovered: sum((x) => x.status === 'resolved'),
      accepted: sum((x) => x.status === 'accepted'),
      nextDeadline: next ? { ...next, payer: open.find((x) => x.deadline === next)?.customer } : null,
    },
  };
}

// ---------- how each document is shown ----------
function docView(kind, f, ctx) {
  const { qty, claimed } = ctx;
  const row = (label, value, missing) => ({ label, value: value == null || value === '' ? null : String(value), missing: missing || null });
  switch (kind) {
    case 'invoice':
      return { flag: { text: `${money(f.total ?? 0)} · ${f.qty ?? qty} cases`, state: 'ok' }, read: [row('Invoice #', f.invoice_number), row('PO', f.po_number), row('Date', short(f.invoice_date)), row('Cases', f.qty), row('Unit price', usd(f.unit_price)), row('Total', f.total != null ? money(f.total) : null)] };
    case 'manifest': {
      const split = (f.ship_from || []).length > 1 ? ' · ' + f.ship_from.map((s) => `${s.location} ${s.cases}`).join(', ') : '';
      return { flag: { text: `${f.cases_shipped ?? '?'} cases shipped${split}`, state: f.cases_shipped === qty ? 'ok' : 'warn' }, read: [row('Cases shipped', f.cases_shipped), row('Pallets', f.pallets), row('Ship date', short(f.ship_date)), row('Shipped from', (f.ship_from || []).map((s) => `${s.location} ${s.cases}`).join(' · ') || null, 'One location'), row('PO', f.po_number)] };
    }
    case 'pod':
      return {
        flag: f.accepted_count == null ? { text: 'Accepted count not shown', state: 'warn' } : { text: `${f.accepted_count} accepted${f.location ? ` · ${f.location}` : ''}${f.exceptions ? ' · exception noted' : ''}`, state: f.exceptions ? 'info' : 'ok' },
        read: [row('Ship-from location', f.location, 'Not stated'), row('Cases on manifest', f.cases_on_manifest), row('Accepted count', f.accepted_count, 'Not shown on this POD'), row('Received by', f.received_by), row('Delivered', short(f.delivery_date)), row('Exceptions', f.exceptions, 'None noted')],
      };
    case 'price_letter':
      return { flag: { text: `${usd(f.new_cost)} from ${short(f.effective_date)}`, state: 'ok' }, read: [row('Current cost', usd(f.current_cost)), row('New cost', usd(f.new_cost)), row('Effective date', short(f.effective_date))] };
    case 'promo_agreement':
      return { flag: { text: `${usd(f.rate_per_case)}/case · up to ${f.max_cases ?? '?'} cases`, state: 'ok' }, read: [row('Promotion', f.name), row('Rate per case', usd(f.rate_per_case)), row('Max cases', f.max_cases), row('Period', f.period_start ? `${short(f.period_start)} – ${short(f.period_end)}` : null)] };
    case 'slotting_agreement':
      return { flag: { text: `Agreed fee ${money(f.fee ?? 0)}`, state: Math.abs((f.fee ?? 0) - claimed) < 0.005 ? 'ok' : 'warn' }, read: [row('Slotting fee', f.fee != null ? money(f.fee) : null), row('Items', f.items), row('Stores', f.stores), row('Signed', short(f.signed_date))] };
    case 'purchase_order':
      return { flag: { text: `Must arrive by ${short(f.must_arrive_by)}`, state: 'ok' }, read: [row('PO', f.po_number), row('Cases ordered', f.cases), row('Must arrive by', short(f.must_arrive_by))] };
    case 'appointment':
      return {
        flag: { text: f.changed_by === 'consignee' ? `Moved by the DC to ${short(f.delivered_date)}` : f.changed_by === 'carrier' ? 'Carrier missed the appointment' : `Delivered ${short(f.delivered_date)}`, state: f.changed_by === 'carrier' ? 'warn' : 'ok' },
        read: [row('Original appointment', short(f.original_date)), row('Delivered appointment', short(f.delivered_date)), row('Changed by', f.changed_by === 'consignee' ? 'Receiving DC' : f.changed_by === 'carrier' ? 'Carrier' : null, 'Not changed'), row('Reason', f.reason)],
      };
    case 'remittance':
      return { flag: { text: `${f.lines?.length || 0} lines`, state: 'ok' }, read: [] };
    default:
      return { flag: { text: '', state: 'ok' }, read: [] };
  }
}

// ---------- investigate: four visible steps ----------
export async function investigate(n, emit, { pace = true } = {}) {
  n = String(n);
  const t0 = Date.now();
  const prev = get(n) || {};
  const c = { n, status: 'investigating', history: prev.history || [], startedAt: t0 };
  if (!prev.history?.length) log(c, 'Investigation started');
  const step = async (id, app, label, fn) => {
    emit({ type: 'step', step: id, state: 'running', app, label });
    const s0 = Date.now();
    const data = await fn();
    const wait = pace ? config.stepMs - (Date.now() - s0) : 0;
    if (wait > 0) await sleep(wait);
    emit({ type: 'step', step: id, state: 'done', app, data });
    return data;
  };

  const recon = await step('reconcile', 'quickbooks', `Pulling invoice ${n} from QuickBooks`, async () => {
    const invoice = await quickbooks.getInvoice(n);
    if (!invoice) throw new Error(`Invoice ${n} isn't in QuickBooks.`);
    const payments = await quickbooks.getPayments(invoice);
    return { invoice, payments, billed: invoice.total, paid: payments.totalPaid, gap: Math.round((invoice.total - payments.totalPaid) * 100) / 100, qty: invoice.lines.reduce((s, l) => s + l.qty, 0), rate: invoice.lines[0]?.rate ?? 0 };
  });

  const remit = await step('remittance', 'outlook', `Reading ${recon.invoice.customer}'s payment advice in Outlook`, async () => {
    const found = await microsoft.findRemittance(n);
    if (!found?.attachment) throw new Error(`No payment advice mentioning ${n} found in Outlook.`);
    files.set(`${n}/${found.attachment.name}`, found.attachment.bytes);
    const doc = await readDocument(found.attachment.name, found.attachment.bytes);
    const f = doc.fields;
    const line = (f.lines || []).find((l) => String(l.invoice_number) === n) || null;
    const window = f.window_days || config.disputeWindowDays;
    const issues = (doc.issues || []).filter((x) => !/^Invoice \d+:/.test(x) || x.startsWith(`Invoice ${n}:`));
    return {
      message: found.message,
      payment: `${f.method || 'Payment'} ${f.number || ''}`.trim(),
      paymentDate: f.payment_date,
      deadline: deadlineFor(f.payment_date, window),
      line,
      lines: f.lines || [],
      reader: doc.reader,
      file: { name: found.attachment.name, kind: 'remittance', label: LABEL.remittance, url: fileUrl(n, found.attachment.name) },
      matchesGap: line ? Math.abs(line.deducted - recon.gap) < 0.01 : false,
      issues,
    };
  });

  const evidence = await step('evidence', 'onedrive', `Reading the Invoice ${n} packet in OneDrive`, async () => {
    const { folder, files: list } = await microsoft.listPacket(n);
    const ctx = { qty: recon.qty, claimed: remit.line?.deducted ?? recon.gap };
    const docs = await Promise.all(
      list.map(async (f) => {
        const bytes = await microsoft.downloadFile(f.id);
        files.set(`${n}/${f.name}`, bytes);
        const d = await readDocument(f.name, bytes);
        const view = docView(d.kind, d.fields, ctx);
        const loc = d.kind === 'pod' && d.fields.location ? ` · ${d.fields.location}` : '';
        return { name: f.name, kind: d.kind, label: (LABEL[d.kind] || f.name) + loc, short: (SHORT[d.kind] || f.name) + loc, url: fileUrl(n, f.name), webUrl: f.webUrl || null, fields: d.fields, reader: d.reader, issues: d.issues || [], ...view, ...(d.issues?.length ? { flag: { text: 'Numbers don’t add up', state: 'warn' } } : {}) };
      }),
    );
    const order = ['invoice', 'purchase_order', 'manifest', 'pod', 'appointment', 'price_letter', 'promo_agreement', 'slotting_agreement'];
    docs.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name));
    return { folder, docs };
  });

  const decision = await step('decide', null, 'Weighing the evidence', async () => {
    // Code checks before any verdict: QuickBooks vs the payment advice, and each document's own math.
    const review = [...checkReconcile({ billed: recon.billed, paid: recon.paid, line: remit.line }), ...remit.issues, ...evidence.docs.flatMap((d) => d.issues || [])];
    const assessment = assess({ invoice: recon.invoice, payments: recon.payments, remittance: { line: remit.line }, docs: evidence.docs.map((d) => ({ kind: d.kind, fields: d.fields })), review });
    return { assessment };
  });

  const a = decision.assessment;
  const claim = remit.line
    ? {
        code: remit.line.deduction_code,
        ref: remit.line.deduction_ref,
        title: `${remit.line.reason}${remit.line.cases ? `: ${remit.line.cases} cases` : ''}`,
        math:
          a.type === 'quantity'
            ? `${remit.line.cases} cases × ${money(recon.rate)} = ${money(remit.line.deducted)} deducted`
            : a.type === 'pricing'
              ? `${remit.line.cases} cases × ${usd(remit.line.deducted / remit.line.cases)} = ${money(remit.line.deducted)} deducted`
              : a.type === 'otif'
                ? `${((remit.line.deducted / recon.billed) * 100).toFixed(0)}% of ${money(recon.billed)} = ${money(remit.line.deducted)} fined`
                : `${money(remit.line.deducted)} deducted from a ${money(recon.billed)} invoice`,
      }
    : null;

  Object.assign(c, {
    status: a.verdict === 'paid_in_full' ? 'resolved' : 'ready',
    customer: recon.invoice.customer,
    reconcile: recon,
    remittance: remit,
    claim,
    evidence: { ...evidence, trail: a.trail },
    assessment: a,
    options: a.options,
    sent: prev.sent || null,
    outcome: prev.outcome || null,
    reply: prev.reply || null,
    approval: prev.approval || null,
    investigatedMs: Date.now() - t0,
  });
  if (prev.status && ['waiting', 'resolved', 'accepted'].includes(prev.status)) {
    c.status = prev.status;
    c.startedAt = prev.startedAt;
  }
  log(c, `Checked QuickBooks, ${c.customer}'s payment advice and ${evidence.docs.length} documents${a.review?.length ? `; ${a.review.length} check${a.review.length > 1 ? 's' : ''} failed` : '; all math checks passed'}. ${a.headline}`, a.verdict === 'valid' ? 'good' : 'warn');
  put(n, c);
  emit({ type: 'case', case: c });
  return c;
}

// ---------- drafts ----------
const amountFor = (action, a) => (action === 'dispute' ? a.amount || a.claimedAmount : a.claimedAmount);

function templateDraft(action, c) {
  const a = c.assessment;
  const inv = c.reconcile.invoice;
  const e = a.email;
  const reason = `${clean(a.deductionReason || 'deduction')}${a.claimedCases && a.type === 'quantity' ? `, ${a.claimedCases} cases` : ''}`;
  const NOUN = { remittance: 'payment advice', invoice: 'invoice', manifest: 'manifest', pod: 'POD', price_letter: 'cost change notice', promo_agreement: 'promotion agreement', slotting_agreement: 'slotting agreement', purchase_order: 'purchase order', appointment: 'appointment record' };
  const counts = new Map();
  for (const d of [c.remittance.file, ...c.evidence.docs]) counts.set(NOUN[d.kind] || d.kind, (counts.get(NOUN[d.kind] || d.kind) || 0) + 1);
  const uniq = [...counts].map(([k, v]) => (v > 1 ? `${k}s` : k));
  const attachLine = `${uniq.slice(0, -1).join(', ')}${uniq.length > 1 ? ' and ' : ''}${uniq.at(-1)} ${uniq.length > 1 || counts.get(uniq[0]) > 1 ? 'are' : 'is'} attached.`;
  const ev = e.ev[action] || e.ev.request;
  const ask = e.ask[action] || e.ask.request;
  return {
    subject: action === 'dispute' ? `Invoice ${inv.docNumber} · dispute ${a.deductionRef || ''}`.trim() : `Invoice ${inv.docNumber} · ${e.requestSubject}`,
    body: `Hello ${inv.customer} Deductions team,\n\n${c.remittance.payment} deducted ${moneyExact(a.claimedAmount)} from Invoice ${inv.docNumber} (PO ${inv.poNumber}) under ${a.deductionRef} (${reason}).\n\n${ev} ${ask}\n\n${attachLine.charAt(0).toUpperCase() + attachLine.slice(1)}\n\nThank you,\n${BRAND.legalName} · Accounts Receivable`,
  };
}

async function claudeDraft(action, c) {
  const a = c.assessment;
  const base = templateDraft(action, c);
  const amount = moneyExact(amountFor(action, a));
  const res = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 700,
    temperature: 0,
    system: `You polish one accounts-receivable email from Fable Grove Foods (a CPG brand) to a retailer's or distributor's deductions team. The draft's facts were computed and checked in code. Rules: keep every number, dollar amount, date, invoice number, PO number, payment number and deduction reference exactly as written; do not add, remove, round or recompute any number; do not add facts, promises or deadlines; keep the request (the one thing being asked for) and the sign-off. Improve only flow and tone: polite, direct, under 130 words, plain text, no markdown. Keep the subject unchanged. Return only JSON {"subject": string, "body": string}. Code rejects any draft whose numbers differ from the original.`,
    messages: [{ role: 'user', content: JSON.stringify({ draft: base, must_include_exact_amount: amount }) }],
  });
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  if (!out.subject || !out.body) throw new Error('draft missing fields');
  // Guardrail: the email must state the exact amount the code computed.
  if (!out.body.includes(amount)) throw new Error('draft did not state the exact amount');
  const stray = unverifiedNumbers(out.body, factSet(base.body, base.subject));
  if (stray.length) throw new Error(`draft introduced numbers not in the evidence: ${stray.map((x) => x.raw).join(', ')}`);
  return { subject: out.subject, body: out.body };
}

const recipient = (c) => config.deductionsTo || (MODE === 'live' ? microsoft.myEmail() : microsoft.deductionsEmailFor?.(c.customer) || 'deductions@example.com');

export async function draft(n, action) {
  const c = get(String(n));
  if (!c?.assessment) throw new Error('Investigate this short-pay first.');
  const a = c.assessment;
  if (action === 'accept') {
    return { action, amount: a.claimedAmount, note: `[Cleared] ${a.deductionRef} (${money(a.claimedAmount)}, ${clean(a.deductionReason || '')}) reviewed and accepted.${a.acceptNote ? ' ' + a.acceptNote : ''}` };
  }
  let d;
  let writer = 'template';
  if (client) {
    try {
      d = await claudeDraft(action, c);
      writer = 'claude';
    } catch (e) {
      console.warn('[draft] Claude draft failed, using template:', e.message);
    }
  }
  if (!d) d = templateDraft(action, c);
  const attachments = [c.remittance.file, ...c.evidence.docs].map((f) => ({ name: f.name, label: f.kind === 'remittance' ? 'Remittance' : f.short || SHORT[f.kind] || f.name, url: f.url, checked: true }));
  return { action, to: recipient(c), ...d, attachments, writer, amount: amountFor(action, a) };
}

// ---------- approve: the only place anything is sent or written ----------
export async function approve(n, { action, subject, body, attachments, override }) {
  n = String(n);
  const c = get(n);
  if (!c?.assessment) throw new Error('Investigate this short-pay first.');
  if (['waiting', 'resolved', 'accepted'].includes(c.status)) throw new Error('This case was already actioned.');
  const a = c.assessment;
  const now = new Date();
  const who = config.approverName;
  const elapsed = Math.round((now - c.startedAt) / 1000);
  if (a.verdict === 'needs_review' && action !== 'request' && !override) {
    throw new Error("This case didn't pass Cleared's checks. Confirm you've checked the numbers yourself to continue.");
  }

  if (action === 'accept') {
    const d = await draft(n, 'accept');
    let noted = false;
    try {
      noted = await quickbooks.addNote(c.reconcile.invoice, `${d.note} Approved by ${who} ${now.toISOString().slice(0, 10)}.`);
    } catch (e) {
      console.warn('[approve] QuickBooks note failed:', e.message);
    }
    c.status = 'accepted';
    c.outcome = { kind: 'accepted', amount: a.claimedAmount };
    c.approval = { action, at: now.toISOString(), by: who, elapsed, noted };
    if (a.verdict === 'needs_review') log(c, `${who} overrode the review flag after checking the numbers`, 'warn');
    log(c, `${who} accepted the ${money(a.claimedAmount)} ${a.type === 'otif' ? 'fine' : 'deduction'}${noted ? '; note added in QuickBooks' : ''}`, 'good');
    store.audit({ action: 'accept_deduction', invoice: n, ref: a.deductionRef, amount: a.claimedAmount, approver: who });
    return put(n, c);
  }

  if (!['request', 'dispute'].includes(action)) throw new Error('Unknown action');
  const amount = amountFor(action, a);
  if (!String(body || '').includes(moneyExact(amount)) && !String(body || '').includes(money(amount))) throw new Error(`The email should state the amount (${moneyExact(amount)}).`);
  const chosen = (attachments || []).map((name) => ({ name, bytes: files.get(`${n}/${name}`) })).filter((x) => x.bytes);
  const to = recipient(c);
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5">${body.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]).replace(/\n/g, '<br>')}</div>`;
  const sent = await microsoft.sendMail({ to, subject, html, attachments: chosen });
  let noted = false;
  try {
    noted = await quickbooks.addNote(c.reconcile.invoice, `[Cleared] ${now.toISOString().slice(0, 10)} · ${action === 'dispute' ? 'Dispute' : 'Backup request'} sent to ${to} for ${a.deductionRef} (${money(amount)}). Approved by ${who}.`);
  } catch (e) {
    console.warn('[approve] QuickBooks note failed:', e.message);
  }
  if (a.verdict === 'needs_review' && action !== 'request') log(c, `${who} overrode the review flag after checking the numbers`, 'warn');
  c.status = 'waiting';
  c.sent = { action, to, subject, body, attachments: chosen.map((x) => x.name), at: sent.sentAt || now.toISOString(), messageId: sent.id, webLink: sent.webLink, amount };
  c.approval = { action, at: now.toISOString(), by: who, elapsed, noted };
  log(c, `${who} approved and sent "${subject}" to ${to} with ${chosen.length} attachments${noted ? '; note added in QuickBooks' : ''}`, 'good');
  store.audit({ action: action === 'dispute' ? 'send_dispute' : 'send_backup_request', invoice: n, ref: a.deductionRef, amount, to, subject, attachments: c.sent.attachments, approver: who, sentMessageId: sent.id });
  return put(n, c);
}

// ---------- replies ----------
function classify(text) {
  if (/(revers|credit(ed)? back|refund|repay|will be (paid|remitted)|approved|added to (the |your )?next)/i.test(text)) return 'reversed';
  if (/(denied|deny|uphold|stands|valid deduction|not eligible)/i.test(text)) return 'denied';
  return 'replied';
}

function applyReply(c, reply) {
  const kind = classify(reply.text);
  c.reply = { ...reply, kind };
  if (kind === 'reversed') {
    c.status = 'resolved';
    c.outcome = { kind: 'recovered', amount: c.sent.amount };
    log(c, `${c.customer} replied: reversed. ${money(c.sent.amount)} recovered.`, 'good');
  } else if (kind === 'denied') {
    log(c, `${c.customer} replied and denied it.`, 'warn');
  } else {
    log(c, `${c.customer} replied.`, 'info');
  }
  return c;
}

export async function checkReplies(n) {
  n = String(n);
  const c = get(n);
  if (!c?.sent) throw new Error('Nothing has been sent on this case yet.');
  const reply = await microsoft.findReply?.(n, c.sent.subject, c.sent.at);
  if (!reply) return { case: c, found: false };
  return { case: put(n, applyReply(c, reply)), found: true };
}

// Offline rehearsal only: play the payer's reply.
export async function simulateReply(n) {
  if (MODE === 'live') throw new Error('Replies are real in live mode. Use Check for replies.');
  n = String(n);
  const c = get(n);
  if (!c?.sent) throw new Error('Nothing has been sent on this case yet.');
  const a = c.assessment;
  const why = {
    quantity: c.sent.action === 'dispute' ? `We've matched the ${c.evidence.docs.filter((d) => d.kind === 'pod').length > 1 ? 'additional POD' : 'POD'} and confirmed full receipt.` : `Receiving shows ${a.billedQty} cases accepted at the DC. The shortage was keyed in error.`,
    pricing: 'Confirmed: the cost change is effective Nov 1, so the invoice cost stands.',
    promo: 'We re-ran the promotion and corrected the chargeback.',
    slotting: 'Confirmed against the signed agreement; the extra slotting was taken in error.',
    otif: 'Confirmed the appointment was moved by our DC. The OTIF fine is waived.',
    other: 'We reviewed the backup.',
  }[a.type];
  const text = `Hi, thanks for the documentation on Invoice ${n}. ${why} ${a.deductionRef} has been reversed and ${moneyExact(c.sent.amount)} will be added to your next remittance.`;
  return { case: put(n, applyReply(c, { from: `${c.customer} Deductions`, at: new Date().toISOString(), subject: `RE: ${c.sent.subject}`, text, simulated: true })), found: true };
}

// ---------- reads ----------
export function getCase(n) {
  return get(String(n));
}

export async function remitFile(name) {
  const r = (await remittances()).find((x) => x.attachment.name === name);
  return r ? { bytes: r.attachment.bytes, lines: r.lines, reader: r.reader } : null;
}

export async function file(n, name) {
  const key = `${n}/${name}`;
  if (files.has(key)) return files.get(key);
  // After a restart, refetch on demand.
  if (kindOf(name) === 'remittance') {
    const r = await microsoft.findRemittance(n);
    if (r?.attachment?.name === name) files.set(key, r.attachment.bytes);
  } else {
    const { files: list } = await microsoft.listPacket(n);
    const f = list.find((x) => x.name === name);
    if (f) files.set(key, await microsoft.downloadFile(f.id));
  }
  return files.get(key) || null;
}
