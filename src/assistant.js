// Cleared's typed-question assistant.
// Claude is scoped tightly to Fable Grove's three teammates, does no arithmetic itself (it calls code),
// and every number in its answer is checked against tool results before it's shown.
// If anything can't be verified, or the question needs a decision, it goes to a human instead.
import Anthropic from '@anthropic-ai/sdk';
import { AGENT, config, money } from './config.js';
import * as cases from './cases.js';
import { calculate, verifyEqual, daysBetween, today, factSet, unverifiedNumbers } from './verify.js';

const client = AGENT === 'claude' ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;
const MAX_TURNS = 8;

function system(ctx) {
  const po = ctx?.facts?.po;
  const launch = ctx?.facts?.launch;
  return `You are Cleared, the in-app AI teammate inside Fable Grove Foods' work desktop. Fable Grove is a CPG brand that sells "Fable Grove product · case" through distributors and retailers. You answer questions the employee types into the Cleared side panel. Today is ${today()}.

The employee is looking at: ${ctx?.lookingAt || 'nothing specific'} (app: ${ctx?.app || 'unknown'}).

You cover exactly three areas, and nothing else:
1. OPERATIONS: KeHE purchase order 1042 for SKU FG-12. ${po ? `${po.cases} cases, requested ship ${po.ship}, split ${po.split.map((s) => `${s.wh} ${s.cases}`).join(' + ')}, freight quoted ${money(po.freight.quote)} split vs ${money(po.freight.wait)} to wait, re-quoted ${money(po.freight.updated)}.` : ''} Current status comes from get_workspace.
2. GROWTH: ${launch ? `${launch.title}: 12 sampling slots across Maple Market (1), Harbor Pantry (1) and 10 other stores; the broker kit must use the approved product image v3, not v2; ${launch.samples}.` : "Friday's retail launch."} Current status comes from get_workspace.
3. FINANCE: short-pays (deductions) on payment advices from UNFI, KeHE, Walmart, Maple Market and Harbor Pantry. Deduction types: shortage, damage, price, promotion chargeback, OTIF fine, slotting. Figures come only from get_short_pays and get_case.

If the question is outside these three areas, reply in one sentence that it's not something you handle here, and do not call tools.

NUMBERS: these rules are strict and override everything else.
- Never do arithmetic in your head. Every sum, difference, product, ratio, percentage, per-case amount or total you state must be the output of calculate or verify_equal in this conversation. Plain numbers in expressions have no commas; dollar amounts may be written $2,880.00.
- Every day count or "days left" must come from days_until or from a deadline returned by a tool.
- Every finance figure (billed, paid, deducted, unresolved, recoverable, deadline) must be copied from get_short_pays or get_case output. Do not use figures from memory.
- If the employee states a number, check it with verify_equal before agreeing or disagreeing.
- Don't round, estimate or say "about" unless a tool returned that rounding.

ESCALATE instead of answering, by calling escalate_to_human with a one-sentence reason and what a person should check, when:
- a verify_equal result is false, or two tool results disagree;
- a needed figure is missing, null, or a case says verdict "needs_review";
- the question asks you to decide, approve, send, book, write off, dispute or change anything;
- you are not sure.
After calling escalate_to_human, stop.

You cannot take actions. If an action fits, name the suggestion button the employee can click (for example: "Use 'Why were we short-paid, and what do we need to resolve it?' on the invoice").

STYLE: at most 3 short sentences. Plain words. No markdown, no bullet lists, no headings. Lead with the answer. Money as $240 or $2,640.00. Refer to invoices as "Invoice 2086".`;
}

const TOOLS = [
  { name: 'calculate', description: 'Evaluate arithmetic in code. Operators + - * / ( ) and % ("x * 3%" is 3 percent of x; "x + 15%" is x increased by 15%), functions round(x, d), min, max, abs, sum. Plain numbers have no commas; $ amounts may use thousands commas. Returns the exact result. Use this for EVERY calculation.', input_schema: { type: 'object', properties: { expression: { type: 'string' }, purpose: { type: 'string', description: 'What this computes, e.g. "UNFI unresolved on 2086"' } }, required: ['expression', 'purpose'] } },
  { name: 'verify_equal', description: 'Check in code whether a stated value equals an arithmetic expression (to the cent). Use before agreeing with any number the employee gives or any number you will state that combines figures.', input_schema: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string', description: 'The number being checked, e.g. "$240" or "240"' }, expression: { type: 'string' } }, required: ['label', 'value', 'expression'] } },
  { name: 'days_until', description: 'Count days from today to a date (YYYY-MM-DD) in code. Negative means it has passed.', input_schema: { type: 'object', properties: { date: { type: 'string' } }, required: ['date'] } },
  { name: 'get_short_pays', description: 'List short-paid invoices from the payment advices, with payer, deduction code/ref/reason, cases, amount withheld, status, verdict (if investigated), recoverable amount and dispute deadline. Optional filters.', input_schema: { type: 'object', properties: { payer: { type: 'string' }, status: { type: 'string', enum: ['new', 'ready', 'waiting', 'resolved', 'accepted'] } } } },
  { name: 'get_case', description: "Get one invoice's investigation: billed, paid, unresolved gap, what the payer claimed, the evidence trail, verdict and recommended action. Returns investigated:false if it hasn't been investigated yet.", input_schema: { type: 'object', properties: { invoice: { type: 'string' } }, required: ['invoice'] } },
  { name: 'get_workspace', description: 'Current status of Operations (PO 1042) and Growth (Friday launch) in the demo, and what the employee is looking at.', input_schema: { type: 'object', properties: {} } },
  { name: 'escalate_to_human', description: 'Hand the question to a person instead of answering, when something cannot be verified in code, data is missing or disagrees, or a decision/action is needed.', input_schema: { type: 'object', properties: { reason: { type: 'string', description: 'One sentence: why this needs a person.' }, what_to_check: { type: 'string', description: 'One sentence: what the person should look at.' } }, required: ['reason', 'what_to_check'] } },
];

async function runTool(name, input, ctx) {
  switch (name) {
    case 'calculate':
      return { expression: input.expression, result: calculate(input.expression) };
    case 'verify_equal':
      return { label: input.label, ...verifyEqual(input.value, input.expression) };
    case 'days_until':
      return { date: input.date, days: daysBetween(today(), input.date) };
    case 'get_short_pays': {
      const q = await cases.queue();
      const rows = q.rows
        .filter((r) => !input.payer || r.customer.toLowerCase().includes(String(input.payer).toLowerCase()))
        .filter((r) => !input.status || r.status === input.status)
        .map((r) => ({ invoice: r.n, payer: r.customer, code: r.code, ref: r.ref, reason: r.reason, cases: r.cases, withheld: r.amount, status: r.status, verdict: r.verdict, recoverable: r.recover, deadline: r.deadline?.date, days_left: r.deadline?.daysLeft }));
      return { count: rows.length, rows, totals: input.payer || input.status ? undefined : q.totals };
    }
    case 'get_case': {
      const c = cases.getCase(String(input.invoice).replace(/\D/g, ''));
      if (!c?.assessment) return { invoice: input.invoice, investigated: false, note: 'Not investigated yet. The employee can open it and click the suggestion to investigate.' };
      const a = c.assessment;
      return {
        invoice: c.n, investigated: true, payer: c.customer, status: c.status,
        billed: a.billed, paid: a.paid, unresolved: a.gap, claimed: { code: a.deductionCode, ref: a.deductionRef, reason: a.deductionReason, cases: a.claimedCases, amount: a.claimedAmount },
        verdict: a.verdict, headline: a.headline, detail: a.detail, recoverable: a.amount, review_issues: a.review || [],
        evidence: a.trail.nodes.map((x) => `${x.label}: ${x.value} (${x.sub})`), recommended: a.options.find((o) => o.strength === 'recommended')?.title,
        deadline: c.remittance?.deadline, sent: c.sent ? { subject: c.sent.subject, amount: c.sent.amount } : null, outcome: c.outcome,
      };
    }
    case 'get_workspace':
      return { looking_at: ctx?.lookingAt, app: ctx?.app, operations: ctx?.ops, growth: ctx?.growth };
    default:
      return { error: `unknown tool ${name}` };
  }
}

// Without an API key: still answer plain arithmetic, in code.
function offlineAnswer(text) {
  const m = String(text).match(/[$\d(][\d$.,\s()+\-*/x×÷%]*\d%?\)?/g)?.find((s) => /[+\-*/x×÷%]/.test(s) && (s.match(/\d+/g) || []).length >= 2);
  if (!m) return null;
  try {
    const expr = m.trim();
    const result = calculate(expr);
    return { text: `${expr} = ${Number.isInteger(result) ? result : result.toFixed(2)}.`, checks: [{ tool: 'calculate', input: { expression: expr }, output: { result } }] };
  } catch {
    return null;
  }
}

export async function ask(text, ctx = {}) {
  text = String(text || '').slice(0, 600);
  if (!client) return offlineAnswer(text) || { text: null };

  const messages = [{ role: 'user', content: text }];
  const trace = [];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await client.messages.create({ model: config.anthropic.model, max_tokens: 700, temperature: 0, system: system(ctx), tools: TOOLS, messages });
    messages.push({ role: 'assistant', content: res.content });
    const calls = res.content.filter((b) => b.type === 'tool_use');
    if (!calls.length) {
      const answer = res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
      return finalize(answer, trace, ctx, text);
    }
    const results = [];
    for (const call of calls) {
      if (call.name === 'escalate_to_human') {
        return { text: null, escalate: { reason: call.input.reason, check: call.input.what_to_check, question: text }, checks: trace };
      }
      let output;
      try {
        output = await runTool(call.name, call.input || {}, ctx);
      } catch (e) {
        output = { error: e.message };
      }
      trace.push({ tool: call.name, input: call.input, output });
      results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(output), ...(output?.error ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: null, escalate: { reason: 'I went back and forth too many times to be sure of the answer.', check: 'Look at this question directly.', question: text }, checks: trace };
}

// The last line of defense: every number in the answer must have come from a tool result or the given data.
function finalize(answer, trace, ctx, question) {
  if (!answer) return { text: null };
  const failed = trace.filter((t) => t.tool === 'verify_equal' && t.output?.ok === false);
  if (failed.length) {
    return { text: null, escalate: { reason: `A number didn't check out: ${failed.map((f) => `${f.output.label} is ${f.output.expected}, not ${f.output.actual}`).join('; ')}.`, check: 'Confirm the right figure before acting on it.', question }, checks: trace };
  }
  const facts = factSet(trace.map((t) => t.output), trace.map((t) => t.input), ctx?.facts, ctx?.ops, ctx?.growth, question);
  const unknown = unverifiedNumbers(answer, facts);
  if (unknown.length) {
    return { text: null, escalate: { reason: `I couldn't verify ${unknown.map((u) => u.raw).join(', ')} in code, so I won't state it.`, check: 'Check the figures in QuickBooks or the payment advice.', question }, checks: trace };
  }
  return { text: answer, checks: trace.filter((t) => ['calculate', 'verify_equal', 'days_until'].includes(t.tool)), sources: [...new Set(trace.map((t) => t.tool).filter((n) => n.startsWith('get_')))] };
}
