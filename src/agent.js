// Cleared's Finance teammate. Tools pull real records; code does the math; nothing is sent without approval.
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { AGENT, MODE, config, money, moneyExact, SCENARIOS } from './config.js';
import { quickbooks, microsoft } from './sources.js';
import { readDocument, kindOf } from './extract.js';
import { assess } from './assess.js';
import * as store from './store.js';

const client = AGENT === 'claude' ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BRAND = SCENARIOS.brand;

// ---------- case state (single-user demo, in memory) ----------
const cases = new Map(); // invoiceNumber -> case
const proposals = new Map(); // proposalId -> { invoiceNumber, ... }
let thread = []; // Claude conversation history
let runStartedAt = null;

export function resetThread() {
  thread = [];
  cases.clear();
  proposals.clear();
}

function getCase(n) {
  n = String(n).replace(/\D/g, '');
  if (!cases.has(n)) cases.set(n, { invoiceNumber: n, startedAt: runStartedAt || Date.now() });
  return cases.get(n);
}

export function caseFile(n, name) {
  const c = cases.get(String(n));
  if (!c) return null;
  if (c.remittance?.attachment?.name === name) return c.remittance.attachment.bytes;
  return c.packet?.files?.find((f) => f.name === name)?.bytes || null;
}

const fileUrl = (n, name) => `/api/case/${n}/file/${encodeURIComponent(name)}`;

// ---------- tools ----------
// Each tool: does real work, emits UI events (cards for the Cleared panel, views for the source pane),
// and returns a compact JSON result for the model.
const TOOLS = {
  async list_open_deductions(_input, emit) {
    emit({ type: 'step', app: 'outlook', label: 'Checking remittances in Outlook' });
    const remit = await microsoft.findRemittance('payment advice');
    if (!remit?.attachment) return { error: 'No remittance with a PDF found in the mailbox.' };
    const doc = await readDocument(remit.attachment.name, remit.attachment.bytes);
    emit({ type: 'step', app: 'quickbooks', label: 'Matching against open invoices in QuickBooks' });
    const rows = [];
    for (const l of doc.fields.lines || []) {
      const inv = await quickbooks.getInvoice(l.invoice_number).catch(() => null);
      if (!inv || inv.balance <= 0) continue;
      const pay = await quickbooks.getPayments(inv);
      const a = assess({ invoice: inv, payments: pay, remittance: { line: l } });
      rows.push({ invoice: l.invoice_number, reason: l.reason, cases: l.cases, amount: l.deducted, ref: l.deduction_ref, daysLeft: a.deadline?.daysLeft ?? null, deadline: a.deadline?.label ?? null });
    }
    const total = rows.reduce((s, r) => s + r.amount, 0);
    emit({ type: 'view', view: { app: 'outlook', type: 'message', message: remit.message, attachment: { name: remit.attachment.name } } });
    emit({ type: 'card', card: { kind: 'deductions', title: `${rows.length} short-pays on check ${doc.fields.check_number || ''}`.trim(), total: money(total), rows } });
    return { check: doc.fields.check_number, deductions: rows };
  },

  async lookup_invoice({ invoice_number }, emit) {
    const c = getCase(invoice_number);
    emit({ type: 'step', app: 'quickbooks', label: `Pulling invoice ${c.invoiceNumber} from QuickBooks` });
    const inv = await quickbooks.getInvoice(c.invoiceNumber);
    if (!inv) return { error: `Invoice ${c.invoiceNumber} not found in QuickBooks.` };
    const pay = await quickbooks.getPayments(inv);
    c.invoice = inv;
    c.payments = pay;
    const gap = Math.round((inv.total - pay.totalPaid) * 100) / 100;
    emit({ type: 'view', view: { app: 'quickbooks', type: 'invoice', invoice: inv, payments: pay, footer: 'The original invoice stays the record of what was billed' } });
    const pmt = pay.payments[0];
    emit({
      type: 'card',
      card: {
        kind: 'reconcile',
        title: `${inv.customer} · Invoice ${inv.docNumber}`,
        rows: [
          { label: 'QuickBooks invoice', value: money(inv.total) },
          { label: `${inv.customer} payment${pmt?.reference ? ` · check ${pmt.reference}` : ''}`, value: money(pay.totalPaid) },
        ],
        gap: gap > 0 ? { label: 'Unresolved difference', value: money(gap) } : null,
      },
    });
    return {
      invoice_number: inv.docNumber,
      customer: inv.customer,
      po_number: inv.poNumber,
      invoice_date: inv.txnDate,
      billed: inv.total,
      qty: inv.lines.reduce((s, l) => s + l.qty, 0),
      unit_price: inv.lines[0]?.rate,
      paid: pay.totalPaid,
      payments: pay.payments.map((p) => ({ date: p.date, check: p.reference, applied: p.applied })),
      unresolved: gap,
    };
  },

  async find_remittance({ invoice_number }, emit) {
    const c = getCase(invoice_number);
    emit({ type: 'step', app: 'outlook', label: 'Finding the payment advice in Outlook' });
    const remit = await microsoft.findRemittance(c.invoiceNumber);
    if (!remit) return { error: `No remittance email mentioning ${c.invoiceNumber} found.` };
    if (!remit.attachment) return { error: 'Remittance email has no PDF attachment.' };
    const doc = await readDocument(remit.attachment.name, remit.attachment.bytes);
    const line = (doc.fields.lines || []).find((l) => String(l.invoice_number) === c.invoiceNumber) || null;
    c.remittance = { message: remit.message, attachment: remit.attachment, check: doc.fields.check_number, line };
    emit({ type: 'view', view: { app: 'outlook', type: 'message', message: remit.message, attachment: { name: remit.attachment.name, url: fileUrl(c.invoiceNumber, remit.attachment.name) }, highlight: line } });
    if (line) {
      const rate = c.invoice?.lines?.[0]?.rate;
      emit({
        type: 'card',
        card: {
          kind: 'claim',
          id: `claim-${c.invoiceNumber}`,
          text: `${/short/i.test(line.reason || '') ? 'Shortage' : /damag/i.test(line.reason || '') ? 'Damage' : line.reason || 'Deduction'} claim: ${line.cases ?? '?'} cases${rate ? ` × ${money(rate)}` : ''}`,
          ref: [line.deduction_code, line.deduction_ref].filter(Boolean).join(' · '),
          tag: 'Checking',
          tone: 'neutral',
        },
      });
    }
    return { email_subject: remit.message.subject, from: remit.message.from, check: doc.fields.check_number, line_for_invoice: line, read_by: doc.reader };
  },

  async read_invoice_packet({ invoice_number }, emit) {
    const c = getCase(invoice_number);
    emit({ type: 'step', app: 'onedrive', label: `Opening the Invoice ${c.invoiceNumber} packet in OneDrive` });
    const { folder, files } = await microsoft.listPacket(c.invoiceNumber);
    const read = await Promise.all(
      files.map(async (f) => {
        const bytes = await microsoft.downloadFile(f.id);
        const doc = await readDocument(f.name, bytes);
        return { ...f, kind: doc.kind, fields: doc.fields, reader: doc.reader, bytes };
      }),
    );
    const order = { invoice: 0, manifest: 1, pod: 2 };
    read.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
    c.packet = { folder, files: read };
    const get = (k) => read.find((f) => f.kind === k)?.fields;
    const inv = get('invoice');
    const man = get('manifest');
    const pod = get('pod');
    const qty = c.invoice?.lines?.reduce((s, l) => s + l.qty, 0);
    emit({
      type: 'view',
      view: {
        app: 'onedrive',
        type: 'packet',
        folder,
        files: read.map((f) => ({ name: f.name, kind: f.kind, url: fileUrl(c.invoiceNumber, f.name), webUrl: f.webUrl || null })),
        selected: read.find((f) => f.kind === 'pod') ? 'pod' : read[0]?.kind,
        pod: pod ? { manifest: pod.cases_on_manifest, accepted: pod.accepted_count, receivedBy: pod.received_by, exceptions: pod.exceptions } : null,
      },
    });
    emit({
      type: 'card',
      card: {
        kind: 'evidence',
        title: "Let's check the receiving evidence.",
        tiles: [
          inv ? { label: 'Invoice', value: money(inv.total ?? c.invoice?.total), sub: `${qty ?? '?'} cases billed`, state: 'ok' } : { label: 'Invoice', value: 'Missing', state: 'warn' },
          man ? { label: 'Manifest', value: `${man.cases_shipped ?? '?'} cases`, sub: 'shipped', state: man.cases_shipped === qty ? 'ok' : 'warn' } : { label: 'Manifest', value: 'Missing', state: 'warn' },
          pod
            ? pod.accepted_count == null
              ? { label: 'POD', value: 'Accepted count not shown', state: 'warn' }
              : { label: 'POD', value: `${pod.accepted_count} accepted`, sub: pod.exceptions ? pod.exceptions : 'no exceptions', state: pod.accepted_count === qty ? 'ok' : 'info' }
            : { label: 'POD', value: 'Missing', state: 'warn' },
        ],
      },
    });
    return {
      folder,
      documents: read.map((f) => ({ name: f.name, kind: f.kind, fields: f.fields, read_by: f.reader })),
    };
  },

  async assess_deduction({ invoice_number }, emit) {
    const c = getCase(invoice_number);
    if (!c.invoice) await TOOLS.lookup_invoice({ invoice_number }, emit);
    if (!c.remittance) await TOOLS.find_remittance({ invoice_number }, emit);
    if (!c.packet) await TOOLS.read_invoice_packet({ invoice_number }, emit);
    const a = assess(c);
    c.assessment = a;
    const tag = { request_evidence: 'Claim, not proven', dispute: 'Claim not supported', valid: 'Claim supported', paid_in_full: 'Resolved' }[a.verdict];
    const tone = { request_evidence: 'warn', dispute: 'warn', valid: 'good', paid_in_full: 'good' }[a.verdict];
    emit({ type: 'update', id: `claim-${c.invoiceNumber}`, patch: { tag, tone } });
    emit({
      type: 'card',
      card: {
        kind: 'verdict',
        tone: a.verdict === 'valid' || a.verdict === 'paid_in_full' ? 'good' : 'warn',
        headline: a.headline,
        detail: a.detail,
        meta: [
          a.verdict === 'valid' ? null : `${money(a.gap)} still unresolved`,
          a.deadline && a.verdict !== 'valid' ? `dispute window closes ${a.deadline.label} (${a.deadline.daysLeft} days)` : null,
        ].filter(Boolean).join(' · '),
      },
    });
    emit({ type: 'status', text: a.verdict === 'valid' ? 'Deduction matches the POD' : `${money(a.gap)} unresolved · ${a.verdict === 'request_evidence' ? 'receiving count needed' : 'dispute recommended'}`, tone: a.verdict === 'valid' ? 'good' : 'warn' });
    const { checks, ...rest } = a;
    return { ...rest, checks, next_step: { request_evidence: 'propose_follow_up asking for the receiving count', dispute: 'propose_follow_up disputing the deduction', valid: 'recommend_close', paid_in_full: 'nothing' }[a.verdict] };
  },

  async propose_follow_up({ invoice_number, subject, body }, emit) {
    const c = getCase(invoice_number);
    const a = c.assessment;
    if (!a) return { error: 'Run assess_deduction first.' };
    if (!['request_evidence', 'dispute'].includes(a.verdict)) return { error: `Verdict is ${a.verdict}; do not send a follow-up. Use recommend_close.` };
    const amountPlain = a.amount.toFixed(2);
    if (!body.includes(money(a.amount)) && !body.includes('$' + amountPlain)) {
      return { error: `The body must state the deduction amount exactly as ${money(a.amount)} or $${amountPlain}. Rewrite and call again.` };
    }
    const to = config.deductionsTo || (MODE === 'live' ? microsoft.myEmail() : 'deductions@unfi.example');
    const attachments = [c.remittance?.attachment?.name, ...(c.packet?.files || []).map((f) => f.name)].filter(Boolean);
    const id = crypto.randomUUID();
    proposals.set(id, { id, invoiceNumber: c.invoiceNumber, to, subject, body, attachments, verdict: a.verdict });
    emit({
      type: 'card',
      card: {
        kind: 'proposal',
        id,
        eyebrow: 'Proposed follow-up',
        title: a.verdict === 'dispute' ? 'Review the dispute' : 'Review the evidence request',
        to,
        subject,
        body,
        attachments: attachments.map((n) => ({ name: n, label: labelFor(n), url: fileUrl(c.invoiceNumber, n) })),
        button: a.verdict === 'dispute' ? 'Approve dispute + evidence pack' : 'Approve follow-up + evidence pack',
      },
    });
    return { status: 'waiting_for_human_approval', proposal_id: id, to, attachments };
  },

  async recommend_close({ invoice_number, note }, emit) {
    const c = getCase(invoice_number);
    const a = c.assessment;
    if (!a) return { error: 'Run assess_deduction first.' };
    const id = crypto.randomUUID();
    proposals.set(id, { id, invoiceNumber: c.invoiceNumber, close: true, note });
    emit({
      type: 'card',
      card: { kind: 'close', id, eyebrow: 'Proposed', title: 'Accept the deduction', body: note, button: 'Approve: mark reviewed in QuickBooks' },
    });
    return { status: 'waiting_for_human_approval', proposal_id: id };
  },
};

function labelFor(name) {
  const k = kindOf(name);
  return { remittance: 'Remittance', pod: 'POD', manifest: 'Manifest', invoice: 'Invoice' }[k] || name;
}

const TOOL_DEFS = [
  {
    name: 'list_open_deductions',
    description: 'Find the latest distributor remittance in Outlook and list every short-paid invoice still open in QuickBooks, with amounts and dispute deadlines. Use when the user asks what needs attention or does not name an invoice.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'lookup_invoice',
    description: 'Get an invoice and the payments applied to it from QuickBooks. Returns billed, paid and the unresolved difference.',
    input_schema: { type: 'object', properties: { invoice_number: { type: 'string' } }, required: ['invoice_number'] },
  },
  {
    name: 'find_remittance',
    description: "Search Outlook for the distributor's payment advice that covers this invoice, read the attached PDF, and return the deduction line (code, reference, reason, cases, amount).",
    input_schema: { type: 'object', properties: { invoice_number: { type: 'string' } }, required: ['invoice_number'] },
  },
  {
    name: 'read_invoice_packet',
    description: 'Open the invoice packet folder in OneDrive and read each document (invoice, shipping manifest, proof of delivery).',
    input_schema: { type: 'object', properties: { invoice_number: { type: 'string' } }, required: ['invoice_number'] },
  },
  {
    name: 'assess_deduction',
    description: 'Compute the verdict from the gathered evidence: request_evidence, dispute, valid or paid_in_full, with the exact amount and deadline. Always call this before proposing anything; never do the money math yourself.',
    input_schema: { type: 'object', properties: { invoice_number: { type: 'string' } }, required: ['invoice_number'] },
  },
  {
    name: 'propose_follow_up',
    description: 'Draft the email to the distributor deductions team. It is NOT sent: the user reviews and approves it. The evidence pack (remittance, invoice, manifest, POD) is attached automatically and the recipient is set by the system.',
    input_schema: {
      type: 'object',
      properties: {
        invoice_number: { type: 'string' },
        subject: { type: 'string', description: 'Short, e.g. "Invoice 2086 · receiving detail"' },
        body: { type: 'string', description: 'Plain text email body. State the deduction reference and the exact amount from assess_deduction.' },
      },
      required: ['invoice_number', 'subject', 'body'],
    },
  },
  {
    name: 'recommend_close',
    description: 'When the deduction is valid, propose accepting it. Nothing is sent to the distributor.',
    input_schema: { type: 'object', properties: { invoice_number: { type: 'string' }, note: { type: 'string', description: 'One or two sentences on why the deduction is valid.' } }, required: ['invoice_number', 'note'] },
  },
];

const SYSTEM = `You are Cleared, the Finance teammate for ${BRAND.legalName}, a CPG brand that sells through distributors like UNFI.
You resolve short-pays: the distributor pays less than the invoice and takes a deduction. The dispute window is short, and the proof takes too long to find. You find it.

How you work:
- For a specific invoice, call tools in this order: lookup_invoice, find_remittance, read_invoice_packet, assess_deduction, then propose_follow_up (verdict request_evidence or dispute) or recommend_close (verdict valid).
- If no invoice is named, call list_open_deductions and stop there with a one-line summary.
- The tools render rich cards for the user. Do not repeat numbers the cards already show. Between tool calls, write at most one short sentence, in a calm, plain voice, or nothing.
- Never do arithmetic yourself; use the amounts from assess_deduction.
- Emails: polite, specific and brief (under 120 words). Reference the invoice, PO, check number, deduction reference and exact amount, say what the evidence shows, and ask for one concrete thing. Sign off as "${BRAND.legalName} · Accounts Receivable". No placeholders.
- For request_evidence, use the subject "Invoice <n> · receiving detail". For dispute, use "Invoice <n> · dispute <deduction ref>".
- Nothing goes out without the user's approval; after proposing, end your turn with one short sentence.`;

// ---------- runners ----------
function paced(fn) {
  return async (input, emit) => {
    const t0 = Date.now();
    const out = await fn(input, emit);
    const wait = config.stepMs - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    return out;
  };
}

async function runTool(name, input, emit) {
  const fn = TOOLS[name];
  if (!fn) return { error: `Unknown tool ${name}` };
  try {
    return await paced(fn)(input, emit);
  } catch (e) {
    console.error(`[tool ${name}]`, e);
    emit({ type: 'error', text: `${name}: ${e.message}` });
    return { error: e.message };
  }
}

async function runClaude(question, emit) {
  thread.push({ role: 'user', content: question });
  for (let i = 0; i < 12; i++) {
    const res = await client.messages.create({ model: config.anthropic.model, max_tokens: 1500, system: SYSTEM, tools: TOOL_DEFS, messages: thread });
    thread.push({ role: 'assistant', content: res.content });
    for (const b of res.content) if (b.type === 'text' && b.text.trim()) emit({ type: 'message', text: b.text.trim() });
    const calls = res.content.filter((b) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !calls.length) return;
    const results = [];
    for (const call of calls) {
      const out = await runTool(call.name, call.input || {}, emit);
      results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(out), ...(out?.error ? { is_error: true } : {}) });
    }
    thread.push({ role: 'user', content: results });
  }
  emit({ type: 'message', text: 'I stopped after too many steps. Try asking about one invoice.' });
}

function draftEmail(a, c) {
  const inv = c.invoice;
  const check = c.remittance?.check;
  const sign = `Thank you,\n${BRAND.legalName} · Accounts Receivable`;
  const ref = a.deductionRef ? ` under deduction ${a.deductionRef}` : '';
  const what = a.deductionReason ? ` (${a.deductionReason.toLowerCase()}, ${a.claimedCases} cases)` : '';
  if (a.verdict === 'dispute') {
    return {
      subject: `Invoice ${inv.docNumber} · dispute ${a.deductionRef || ''}`.trim(),
      body: `Hello ${inv.customer} Deductions team,\n\nCheck ${check} short-paid Invoice ${inv.docNumber} (PO ${inv.poNumber}) by ${moneyExact(a.claimedAmount)}${ref}${what}.\n\nThe proof of delivery${a.pod?.receivedBy ? `, signed by ${a.pod.receivedBy},` : ''} shows all ${a.accepted} cases accepted with no exceptions, matching our manifest. Please reverse the ${moneyExact(a.amount)} deduction and remit the balance.\n\nInvoice, payment advice, manifest and POD are attached.\n\n${sign}`,
    };
  }
  return {
    subject: `Invoice ${inv.docNumber} · receiving detail`,
    body: `Hello ${inv.customer} Deductions team,\n\nCheck ${check} short-paid Invoice ${inv.docNumber} (PO ${inv.poNumber}) by ${moneyExact(a.amount)}${ref}${what}.\n\nOur manifest shows ${a.shipped} cases shipped, and the delivery receipt was signed at your distribution center, but it doesn't show an accepted count. Please send the receiving count and backup for the ${moneyExact(a.amount)} deduction.\n\nInvoice, payment advice, manifest and POD are attached.\n\n${sign}`,
  };
}

async function runScripted(question, emit) {
  const n = question.match(/\b(\d{4})\b/)?.[1];
  if (!n) {
    const out = await runTool('list_open_deductions', {}, emit);
    if (out.deductions?.length) emit({ type: 'message', text: 'Start with the oldest. Ask me about any invoice and I\'ll pull the proof.' });
    return;
  }
  emit({ type: 'message', text: 'On it. Checking what was billed against what was paid.' });
  const inv = await runTool('lookup_invoice', { invoice_number: n }, emit);
  if (inv.error) return emit({ type: 'message', text: inv.error });
  if (inv.unresolved <= 0) return emit({ type: 'message', text: `Invoice ${n} is paid in full. Nothing to chase.` });
  await runTool('find_remittance', { invoice_number: n }, emit);
  emit({ type: 'message', text: 'Then it comes down to proof. Pulling the packet.' });
  await runTool('read_invoice_packet', { invoice_number: n }, emit);
  const a = await runTool('assess_deduction', { invoice_number: n }, emit);
  if (a.error) return;
  const c = getCase(n);
  if (a.verdict === 'valid') {
    await runTool('recommend_close', { invoice_number: n, note: `${a.detail} Disputing it would cost time without a case. I'd accept it and note it in QuickBooks.` }, emit);
    emit({ type: 'message', text: 'Not every deduction is worth fighting. This one is fair.' });
    return;
  }
  const d = draftEmail(a, c);
  await runTool('propose_follow_up', { invoice_number: n, ...d }, emit);
  emit({ type: 'message', text: 'Nothing goes out until you approve.' });
}

export async function ask(question, emit) {
  runStartedAt = Date.now();
  emit({ type: 'start', agent: AGENT, mode: MODE });
  try {
    if (AGENT === 'claude') await runClaude(question, emit);
    else await runScripted(question, emit);
  } catch (e) {
    console.error(e);
    emit({ type: 'error', text: e.message });
  }
  emit({ type: 'done' });
}

// ---------- approval: the only place anything is written or sent ----------
const esc = (s) => String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);

export async function approve(proposalId, edits = {}) {
  const p = proposals.get(proposalId);
  if (!p) throw new Error('That proposal has expired. Ask again.');
  if (p.done) throw new Error('Already approved.');
  const c = getCase(p.invoiceNumber);
  const a = c.assessment;
  const approvedAt = new Date();
  const time = approvedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const elapsedSec = Math.round((approvedAt - c.startedAt) / 1000);

  if (p.close) {
    await quickbooks.addNote(c.invoice, `[Cleared] ${approvedAt.toISOString().slice(0, 10)} · Deduction ${a.deductionRef} (${money(a.claimedAmount)}) reviewed and accepted. Approved by ${config.approverName}.`).catch((e) => console.warn('addNote', e.message));
    p.done = true;
    store.audit({ action: 'accept_deduction', invoice: p.invoiceNumber, ref: a.deductionRef, approver: config.approverName });
    return {
      card: { kind: 'sent', tone: 'good', headline: 'Reviewed and closed.', checks: ['Invoice matched', 'POD confirms the shortage', 'Note added to QuickBooks invoice'], pending: null, audit: `Approved by ${config.approverName} · ${time}`, elapsed: elapsedSec },
      status: { text: `Deduction accepted · ${money(a.claimedAmount)} closed`, tone: 'good' },
    };
  }

  const subject = (edits.subject || p.subject).trim();
  const body = (edits.body || p.body).trim();
  const attachments = p.attachments.map((name) => ({ name, bytes: caseFile(p.invoiceNumber, name) })).filter((x) => x.bytes);
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5">${esc(body).replace(/\n/g, '<br>')}</div>`;
  const sent = await microsoft.sendMail({ to: p.to, subject, html, attachments });
  p.done = true;

  let noted = false;
  try {
    noted = await quickbooks.addNote(c.invoice, `[Cleared] ${approvedAt.toISOString().slice(0, 10)} · ${a.verdict === 'dispute' ? 'Dispute' : 'Evidence request'} sent to ${p.to} for ${a.deductionRef} (${money(a.amount)}). Approved by ${config.approverName}.`);
  } catch (e) {
    console.warn('[approve] QuickBooks note failed:', e.message);
  }
  store.audit({ action: a.verdict === 'dispute' ? 'send_dispute' : 'send_evidence_request', invoice: p.invoiceNumber, ref: a.deductionRef, amount: a.amount, to: p.to, subject, attachments: attachments.map((x) => x.name), approver: config.approverName, sentMessageId: sent.id });

  return {
    view: { app: 'outlook', type: 'sent', to: p.to, subject, body, sentAt: sent.sentAt, webLink: sent.webLink, attachments: attachments.map((x) => ({ name: x.name, label: labelFor(x.name), url: fileUrl(p.invoiceNumber, x.name) })), offline: MODE !== 'live' },
    card: {
      kind: 'sent',
      tone: 'warn',
      headline: a.verdict === 'dispute' ? 'Dispute sent.' : 'Evidence pack sent.',
      checks: ['Invoice matched', a.verdict === 'dispute' ? 'Dispute filed with proof' : 'Receiving detail requested', 'Follow-up owned', ...(noted ? ['Note added to QuickBooks invoice'] : [])],
      pending: `${money(a.amount)} unresolved · awaiting ${c.invoice.customer}'s response`,
      audit: `Approved by ${config.approverName} · ${time} · ${attachments.length} attachments`,
      elapsed: elapsedSec,
    },
    status: { text: `${money(a.amount)} unresolved · awaiting ${a.verdict === 'dispute' ? 'reversal' : 'receiving detail'}`, tone: 'warn' },
  };
}
