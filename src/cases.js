// The case engine behind the interactive workspace.
// A "case" is one short-paid invoice. You investigate it, pick an action, approve, and track the reply.
// Records come from QuickBooks / Outlook / OneDrive; money math and the verdict come from assess.js;
// Claude (when configured) reads the PDFs and writes the drafts. Nothing is sent or written without approval.
import Anthropic from '@anthropic-ai/sdk';
import { AGENT, MODE, config, money, moneyExact, SCENARIOS } from './config.js';
import { quickbooks, microsoft } from './sources.js';
import { readDocument, kindOf } from './extract.js';
import { assess } from './assess.js';
import * as store from './store.js';

const client = AGENT === 'claude' ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;
const BRAND = SCENARIOS.brand;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fileUrl = (n, name) => `/api/case/${n}/file/${encodeURIComponent(name)}`;
const LABEL = { remittance: 'Payment advice', invoice: 'Invoice', manifest: 'Manifest', pod: 'Proof of delivery' };
const SHORT = { remittance: 'Remittance', invoice: 'Invoice', manifest: 'Manifest', pod: 'POD' };

// ---------- persisted state (data/cases.json) + in-memory file bytes ----------
const files = new Map(); // `${n}/${name}` -> Buffer
let remitCache = null;

function all() {
  return store.load('cases', {});
}
function get(n) {
  return all()[n] || null;
}
function put(n, c) {
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

// ---------- the queue ----------
async function remittance() {
  if (remitCache) return remitCache;
  const r = await microsoft.findRemittance('payment advice');
  if (!r?.attachment) return null;
  const doc = await readDocument(r.attachment.name, r.attachment.bytes);
  remitCache = { message: r.message, attachment: r.attachment, fields: doc.fields, reader: doc.reader };
  return remitCache;
}

function deadlineFor(dateIso) {
  if (!dateIso) return null;
  const d = new Date(dateIso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + config.disputeWindowDays);
  const today = new Date(new Date().toLocaleDateString('en-CA') + 'T12:00:00Z');
  return {
    date: d.toISOString().slice(0, 10),
    label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    daysLeft: Math.round((d - today) / 86400000),
  };
}

export async function queue() {
  const r = await remittance();
  if (!r) return { source: null, rows: [], totals: null };
  const state = all();
  const rows = [];
  for (const l of r.fields.lines || []) {
    const n = String(l.invoice_number);
    const c = state[n];
    rows.push({
      n,
      customer: SCENARIOS.customer.name,
      reason: l.reason,
      code: l.deduction_code,
      ref: l.deduction_ref,
      cases: l.cases,
      amount: l.deducted,
      status: c?.status || 'new',
      verdict: c?.assessment?.verdict || null,
      outcome: c?.outcome || null,
    });
  }
  const sum = (f) => rows.filter(f).reduce((s, x) => s + x.amount, 0);
  const payDate = r.fields.payment_date || SCENARIOS.remittance.paymentDate;
  return {
    source: { check: r.fields.check_number, subject: r.message.subject, from: r.message.from, received: r.message.received, file: { name: r.attachment.name, url: fileUrl('remit', r.attachment.name) } },
    deadline: deadlineFor(payDate),
    rows,
    totals: {
      withheld: sum(() => true),
      open: sum((x) => ['new', 'ready'].includes(x.status)),
      inDispute: sum((x) => x.status === 'waiting'),
      recovered: sum((x) => x.status === 'resolved'),
      accepted: sum((x) => x.status === 'accepted'),
    },
  };
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

  // 1. QuickBooks: billed vs paid
  const recon = await step('reconcile', 'quickbooks', `Pulling invoice ${n} from QuickBooks`, async () => {
    const invoice = await quickbooks.getInvoice(n);
    if (!invoice) throw new Error(`Invoice ${n} isn't in QuickBooks.`);
    const payments = await quickbooks.getPayments(invoice);
    const qty = invoice.lines.reduce((s, l) => s + l.qty, 0);
    return {
      invoice,
      payments,
      billed: invoice.total,
      paid: payments.totalPaid,
      gap: Math.round((invoice.total - payments.totalPaid) * 100) / 100,
      qty,
      rate: invoice.lines[0]?.rate ?? 0,
    };
  });

  // 2. Outlook: what the distributor claims
  const remit = await step('remittance', 'outlook', 'Reading the payment advice in Outlook', async () => {
    const found = await microsoft.findRemittance(n);
    if (!found?.attachment) throw new Error(`No payment advice mentioning ${n} found in Outlook.`);
    files.set(`${n}/${found.attachment.name}`, found.attachment.bytes);
    const doc = await readDocument(found.attachment.name, found.attachment.bytes);
    const line = (doc.fields.lines || []).find((l) => String(l.invoice_number) === n) || null;
    return {
      message: found.message,
      check: doc.fields.check_number,
      line,
      reader: doc.reader,
      file: { name: found.attachment.name, kind: 'remittance', label: LABEL.remittance, url: fileUrl(n, found.attachment.name), fields: line || {} },
      matchesGap: line ? Math.abs(line.deducted - recon.gap) < 0.01 : false,
      math: line ? { cases: line.cases, rate: recon.rate, total: line.deducted, ok: Math.abs(line.cases * recon.rate - line.deducted) < 0.01 } : null,
    };
  });

  // 3. OneDrive: the paper trail
  const evidence = await step('evidence', 'onedrive', `Reading the Invoice ${n} packet in OneDrive`, async () => {
    const { folder, files: list } = await microsoft.listPacket(n);
    const docs = await Promise.all(
      list.map(async (f) => {
        const bytes = await microsoft.downloadFile(f.id);
        files.set(`${n}/${f.name}`, bytes);
        const d = await readDocument(f.name, bytes);
        return { name: f.name, kind: d.kind, label: LABEL[d.kind] || f.name, url: fileUrl(n, f.name), webUrl: f.webUrl || null, fields: d.fields, reader: d.reader };
      }),
    );
    const order = { invoice: 0, manifest: 1, pod: 2 };
    docs.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
    const f = (k) => docs.find((d) => d.kind === k)?.fields || null;
    const claimed = remit.line?.cases ?? 0;
    return {
      folder,
      docs,
      trail: {
        billed: recon.qty,
        shipped: f('manifest')?.cases_shipped ?? null,
        accepted: f('pod') ? f('pod').accepted_count : undefined,
        paidFor: recon.qty - claimed,
        claimedShort: claimed,
        exceptions: f('pod')?.exceptions || null,
        receivedBy: f('pod')?.received_by || null,
      },
    };
  });

  // 4. Decide
  const decision = await step('decide', null, 'Weighing the evidence', async () => {
    const a = assess({
      invoice: recon.invoice,
      payments: recon.payments,
      remittance: { line: remit.line, check: remit.check },
      packet: { files: evidence.docs.map((d) => ({ kind: d.kind, fields: d.fields })) },
    });
    return { assessment: a, options: optionsFor(a) };
  });

  Object.assign(c, {
    status: decision.assessment.verdict === 'paid_in_full' ? 'resolved' : 'ready',
    customer: recon.invoice.customer,
    reconcile: recon,
    remittance: remit,
    evidence,
    assessment: decision.assessment,
    options: decision.options,
    sent: prev.sent || null,
    outcome: prev.outcome || null,
    investigatedMs: Date.now() - t0,
  });
  if (prev.status && ['waiting', 'resolved', 'accepted'].includes(prev.status)) c.status = prev.status;
  log(c, `Checked QuickBooks, the payment advice and ${evidence.docs.length} documents. ${decision.assessment.headline}`, decision.assessment.verdict === 'valid' ? 'good' : 'warn');
  put(n, c);
  emit({ type: 'case', case: c });
  return c;
}

function optionsFor(a) {
  const v = a.verdict;
  const amt = money(a.verdict === 'dispute' ? a.amount : a.gap);
  return [
    {
      id: 'request',
      title: 'Request the receiving count',
      desc: `Ask ${a.customer} for their receiving count and backup for the ${amt} deduction.`,
      strength: v === 'request_evidence' ? 'recommended' : v === 'dispute' ? 'possible' : 'weak',
      why: v === 'request_evidence' ? 'The POD has no accepted count, so the shortage is unproven either way.' : v === 'dispute' ? "You already have proof; asking adds a round-trip." : 'The POD already explains the shortage.',
    },
    {
      id: 'dispute',
      title: 'Dispute the deduction',
      desc: `Ask ${a.customer} to reverse ${amt}, with the POD as proof.`,
      strength: v === 'dispute' ? 'recommended' : v === 'request_evidence' ? 'weak' : 'weak',
      why: v === 'dispute' ? `The POD shows all ${a.accepted} cases accepted.` : v === 'request_evidence' ? 'Without an accepted count, a dispute is easy to deny.' : `The POD shows ${a.billedQty - (a.accepted ?? 0)} cases refused, matching the deduction.`,
    },
    {
      id: 'accept',
      title: 'Accept the deduction',
      desc: `Write off ${money(a.claimedAmount)} and note it in QuickBooks. Nothing is sent to ${a.customer}.`,
      strength: v === 'valid' ? 'recommended' : 'weak',
      why: v === 'valid' ? 'The deduction matches the refused cases on the POD.' : `You'd give up ${money(a.gap)} that may be recoverable.`,
    },
  ];
}

// ---------- drafts ----------
function templateDraft(action, c) {
  const a = c.assessment;
  const inv = c.reconcile.invoice;
  const check = c.remittance.check;
  const sign = `Thank you,\n${BRAND.legalName} · Accounts Receivable`;
  const ded = a.deductionRef ? ` under deduction ${a.deductionRef}` : '';
  const what = a.deductionReason ? ` (${a.deductionReason.toLowerCase()}, ${a.claimedCases} cases)` : '';
  if (action === 'dispute') {
    const proof =
      a.accepted != null && a.accepted >= a.billedQty
        ? `The proof of delivery${a.pod?.receivedBy ? `, signed by ${a.pod.receivedBy},` : ''} shows all ${a.accepted} cases accepted with no exceptions, matching our manifest.`
        : `Our manifest shows ${a.shipped} cases shipped and the delivery receipt was signed at your distribution center.`;
    return {
      subject: `Invoice ${inv.docNumber} · dispute ${a.deductionRef || ''}`.trim(),
      body: `Hello ${inv.customer} Deductions team,\n\nCheck ${check} short-paid Invoice ${inv.docNumber} (PO ${inv.poNumber}) by ${moneyExact(a.claimedAmount)}${ded}${what}.\n\n${proof} Please reverse the ${moneyExact(a.claimedAmount)} deduction and remit the balance.\n\nInvoice, payment advice, manifest and POD are attached.\n\n${sign}`,
    };
  }
  return {
    subject: `Invoice ${inv.docNumber} · receiving detail`,
    body: `Hello ${inv.customer} Deductions team,\n\nCheck ${check} short-paid Invoice ${inv.docNumber} (PO ${inv.poNumber}) by ${moneyExact(a.gap)}${ded}${what}.\n\nOur manifest shows ${a.shipped} cases shipped, and the delivery receipt was signed at your distribution center, but it doesn't show an accepted count. Please send the receiving count and backup for the ${moneyExact(a.gap)} deduction.\n\nInvoice, payment advice, manifest and POD are attached.\n\n${sign}`,
  };
}

const amountFor = (action, a) => (action === 'dispute' ? a.claimedAmount : a.gap);

async function claudeDraft(action, c) {
  const a = c.assessment;
  const inv = c.reconcile.invoice;
  const amount = moneyExact(amountFor(action, a));
  const facts = {
    action: action === 'dispute' ? 'Ask the distributor to reverse the deduction, citing the POD.' : 'Ask the distributor for their receiving count and backup.',
    brand: BRAND.legalName,
    distributor: inv.customer,
    invoice: inv.docNumber,
    po: inv.poNumber,
    check: c.remittance.check,
    deduction_ref: a.deductionRef,
    deduction_reason: a.deductionReason,
    cases_claimed_short: a.claimedCases,
    amount_exact: amount,
    cases_billed: a.billedQty,
    cases_shipped_per_manifest: a.shipped,
    cases_accepted_per_pod: a.accepted,
    pod_received_by: a.pod?.receivedBy,
    pod_exceptions: a.pod?.exceptions,
    attachments: 'invoice, payment advice, manifest, POD',
  };
  const res = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 700,
    system: `You write accounts-receivable emails for a CPG brand to a distributor's deductions team. Polite, specific, under 120 words, plain text. Reference invoice, PO, check, deduction reference and the exact amount string given. Say what the evidence shows and ask for one concrete thing. Sign off as "${BRAND.legalName} · Accounts Receivable". No placeholders. Return JSON {"subject": string, "body": string} only. Subject format: "Invoice <n> · receiving detail" for a request, "Invoice <n> · dispute <deduction ref>" for a dispute.`,
    messages: [{ role: 'user', content: JSON.stringify(facts) }],
  });
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  if (!out.subject || !out.body) throw new Error('draft missing fields');
  // Guardrail: the email must state the exact amount the code computed.
  if (!out.body.includes(amount) && !out.body.includes(money(amountFor(action, a)))) throw new Error('draft did not state the exact amount');
  return { subject: out.subject, body: out.body };
}

export async function draft(n, action) {
  const c = get(String(n));
  if (!c?.assessment) throw new Error('Investigate this short-pay first.');
  const a = c.assessment;
  if (action === 'accept') {
    return {
      action,
      note: `[Cleared] Deduction ${a.deductionRef} (${money(a.claimedAmount)}, ${a.deductionReason?.toLowerCase()}) reviewed and accepted. POD shows ${a.accepted ?? '?'} of ${a.billedQty} accepted${a.pod?.exceptions ? `: ${a.pod.exceptions}` : ''}.`,
      amount: a.claimedAmount,
    };
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
  const to = config.deductionsTo || (MODE === 'live' ? microsoft.myEmail() : 'deductions@unfi.example');
  const attachments = [c.remittance.file, ...c.evidence.docs].map((f) => ({ name: f.name, label: SHORT[f.kind] || f.name, url: f.url, checked: true }));
  return { action, to, ...d, attachments, writer, amount: amountFor(action, a) };
}

// ---------- approve: the only place anything is sent or written ----------
export async function approve(n, { action, subject, body, attachments }) {
  n = String(n);
  const c = get(n);
  if (!c?.assessment) throw new Error('Investigate this short-pay first.');
  if (['waiting', 'resolved', 'accepted'].includes(c.status)) throw new Error('This case was already actioned.');
  const a = c.assessment;
  const now = new Date();
  const who = config.approverName;
  const elapsed = Math.round((now - c.startedAt) / 1000);

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
    log(c, `${who} accepted the ${money(a.claimedAmount)} deduction${noted ? '; note added in QuickBooks' : ''}`, 'good');
    store.audit({ action: 'accept_deduction', invoice: n, ref: a.deductionRef, amount: a.claimedAmount, approver: who });
    return put(n, c);
  }

  if (!['request', 'dispute'].includes(action)) throw new Error('Unknown action');
  const amount = amountFor(action, a);
  if (!body.includes(moneyExact(amount)) && !body.includes(money(amount))) throw new Error(`The email should state the amount (${moneyExact(amount)}).`);
  const chosen = (attachments || []).map((name) => ({ name, bytes: files.get(`${n}/${name}`) })).filter((x) => x.bytes);
  const to = config.deductionsTo || (MODE === 'live' ? microsoft.myEmail() : 'deductions@unfi.example');
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5">${body.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]).replace(/\n/g, '<br>')}</div>`;
  const sent = await microsoft.sendMail({ to, subject, html, attachments: chosen });
  let noted = false;
  try {
    noted = await quickbooks.addNote(c.reconcile.invoice, `[Cleared] ${now.toISOString().slice(0, 10)} · ${action === 'dispute' ? 'Dispute' : 'Evidence request'} sent to ${to} for ${a.deductionRef} (${money(amount)}). Approved by ${who}.`);
  } catch (e) {
    console.warn('[approve] QuickBooks note failed:', e.message);
  }
  c.status = 'waiting';
  c.sent = { action, to, subject, body, attachments: chosen.map((x) => x.name), at: sent.sentAt || now.toISOString(), messageId: sent.id, webLink: sent.webLink, amount };
  c.approval = { action, at: now.toISOString(), by: who, elapsed, noted };
  log(c, `${who} approved and sent "${subject}" to ${to} with ${chosen.length} attachments${noted ? '; note added in QuickBooks' : ''}`, 'good');
  store.audit({ action: action === 'dispute' ? 'send_dispute' : 'send_evidence_request', invoice: n, ref: a.deductionRef, amount, to, subject, attachments: c.sent.attachments, approver: who, sentMessageId: sent.id });
  return put(n, c);
}

// ---------- replies ----------
function classify(text) {
  if (/(revers|credit(ed)? back|refund|repay|will be (paid|remitted)|approved|added to (the )?next)/i.test(text)) return 'reversed';
  if (/(denied|deny|uphold|stands|valid deduction|not eligible)/i.test(text)) return 'denied';
  return 'replied';
}

function applyReply(c, reply) {
  const kind = classify(reply.text);
  c.reply = { ...reply, kind };
  if (kind === 'reversed') {
    c.status = 'resolved';
    c.outcome = { kind: 'recovered', amount: c.sent.amount };
    log(c, `${c.customer} replied: deduction reversed. ${money(c.sent.amount)} recovered.`, 'good');
  } else if (kind === 'denied') {
    log(c, `${c.customer} replied and denied the dispute.`, 'warn');
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

// Offline rehearsal only: play the distributor's reply.
export async function simulateReply(n) {
  if (MODE === 'live') throw new Error('Replies are real in live mode. Use Check for replies.');
  n = String(n);
  const c = get(n);
  if (!c?.sent) throw new Error('Nothing has been sent on this case yet.');
  const a = c.assessment;
  const text =
    c.sent.action === 'dispute'
      ? `Hi, we've reviewed the POD for Invoice ${n}. Full receipt confirmed. Deduction ${a.deductionRef} has been reversed and ${moneyExact(c.sent.amount)} will be added to your next remittance.`
      : `Hi, receiving shows ${a.billedQty} cases accepted at the DC for Invoice ${n}. The shortage was keyed in error. Deduction ${a.deductionRef} is reversed; ${moneyExact(c.sent.amount)} will be added to your next remittance.`;
  return { case: put(n, applyReply(c, { from: `${c.customer} Supplier Deductions`, at: new Date().toISOString(), subject: `RE: ${c.sent.subject}`, text, simulated: true })), found: true };
}

// ---------- reads ----------
export function getCase(n) {
  return get(String(n));
}

export async function file(n, name) {
  if (n === 'remit') {
    const r = await remittance();
    return r && r.attachment.name === name ? r.attachment.bytes : null;
  }
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
