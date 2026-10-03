// Tests the verified chat assistant against a stand-in Claude API (no key, no network).
// Your ./data is backed up and restored. The stand-in plays scripted tool calls; the test checks that code does the math, that unverifiable
// numbers and failed checks are escalated to a person, and that the strict instructions are sent.
//   npm run test:chat
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Back up ./data so the test never disturbs your rehearsal state.
const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
fs.mkdirSync(DATA, { recursive: true });
const backup = Object.fromEntries(fs.readdirSync(DATA).map((f) => [f, fs.readFileSync(path.join(DATA, f))]));
const restore = () => {
  for (const f of fs.readdirSync(DATA)) if (!(f in backup)) fs.unlinkSync(path.join(DATA, f));
  for (const [f, b] of Object.entries(backup)) fs.writeFileSync(path.join(DATA, f), b);
};

const SCRIPTS = {
  'How much did Walmart withhold?': [
    { tool: 'get_short_pays', input: { payer: 'Walmart' } },
    { tool: 'calculate', input: { expression: '144 + 72', purpose: 'Walmart total withheld' } },
    { text: 'Walmart withheld $216 across two OTIF fines.' },
  ],
  "What's our total exposure?": [{ text: 'About $999 is at risk right now.' }],
  'UNFI shorted us $250 on Invoice 2086, right?': [
    { tool: 'verify_equal', input: { label: 'UNFI deduction on 2086', value: '$250', expression: '2880 - 2640' } },
    { text: 'Yes, that is right.' },
  ],
  'Should we write off Invoice 2088?': [{ tool: 'escalate_to_human', input: { reason: 'Writing off a deduction is a decision for a person.', what_to_check: 'The POD and the damage note on Invoice 2088.' } }],
  "What's the weather in Oakland?": [{ text: "That's not something I handle here." }],
  'How many days until KeHE closes?': [
    { tool: 'get_short_pays', input: { payer: 'KeHE' } },
    { tool: 'days_until', input: { date: '2026-10-10' } },
    { text: '__DAYS__' },
  ],
};
const seen = [];
let polishCalls = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const b = JSON.parse(body);
    seen.push(b);
    if (String(b.system || '').startsWith('You polish')) {
      polishCalls++;
      const draft = JSON.parse(b.messages[0].content).draft;
      const body = polishCalls === 1 ? draft.body + ' We also expect $999 by Friday.' : draft.body.replace('Hello', 'Hi');
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'stand-in', content: [{ type: 'text', text: JSON.stringify({ subject: draft.subject, body }) }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
    }
    const q = typeof b.messages[0].content === 'string' ? b.messages[0].content : '';
    const turn = b.messages.filter((m) => m.role === 'assistant').length;
    let step = SCRIPTS[q]?.[turn] || { text: 'Done.' };
    if (step.text === '__DAYS__') {
      const last = b.messages.at(-1).content.find((c) => c.type === 'tool_result');
      step = { text: `KeHE's window closes in ${JSON.parse(last.content).days} days.` };
    }
    const content = step.tool ? [{ type: 'tool_use', id: `tu_${seen.length}`, name: step.tool, input: step.input }] : [{ type: 'text', text: step.text }];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'stand-in', content, stop_reason: step.tool ? 'tool_use' : 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
await new Promise((r) => server.listen(0, r));
process.env.ANTHROPIC_API_KEY = 'test';
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.DEMO_MODE = 'offline';
delete process.env.AGENT;

const { ask } = await import('../src/assistant.js');
let ok = true;
const check = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) ok = false;
};
const ctx = { lookingAt: 'QuickBooks · Invoices', app: 'quickbooks', ops: { stage: 'new' }, growth: { stage: 'new' } };

let r = await ask('How much did Walmart withhold?', ctx);
check(r.text === 'Walmart withheld $216 across two OTIF fines.' && r.checks.some((c) => c.tool === 'calculate' && c.output.result === 216), `verified answer passes; math done in code (144 + 72 = ${r.checks?.[0]?.output?.result})`);

r = await ask("What's our total exposure?", ctx);
check(!r.text && /\$999/.test(r.escalate?.reason || ''), `unverifiable number is escalated: "${r.escalate?.reason}"`);

r = await ask('UNFI shorted us $250 on Invoice 2086, right?', ctx);
check(!r.text && /240/.test(r.escalate?.reason || ''), `failed verify_equal is escalated, never agreed with: "${r.escalate?.reason}"`);

r = await ask('Should we write off Invoice 2088?', ctx);
check(!r.text && /decision for a person/.test(r.escalate?.reason || ''), 'decisions go to a person via escalate_to_human');

r = await ask("What's the weather in Oakland?", ctx);
check(r.text === "That's not something I handle here." && !r.checks?.length, 'out-of-scope question gets one sentence, no tools');

r = await ask('How many days until KeHE closes?', ctx);
check(!!r.text && r.checks.some((c) => c.tool === 'days_until'), `day count comes from code: "${r.text}"`);

const sys = seen[0]?.system || '';
check(seen.every((b) => b.temperature === 0), 'every request uses temperature 0');
check(/Never do arithmetic in your head/.test(sys) && /escalate_to_human/.test(sys) && /exactly three areas/.test(sys) && /looking at: QuickBooks · Invoices/.test(sys), 'strict, context-specific instructions are sent');
check(seen[0]?.tools?.map((t) => t.name).join(',') === 'calculate,verify_equal,days_until,get_short_pays,get_case,get_workspace,escalate_to_human', 'tools offered: calculate, verify_equal, days_until, data lookups, escalate_to_human');

// Email polishing: a draft that sneaks in a number is rejected in code; a clean one is used.
const cases = await import('../src/cases.js');
cases.reset();
await cases.investigate('2087', () => {}, { pace: false });
const d1 = await cases.draft('2087', 'dispute');
check(d1.writer === 'template' && !d1.body.includes('$999'), 'polished draft with a new number ($999) is rejected; evidence template used');
const d2 = await cases.draft('2087', 'dispute');
check(d2.writer === 'claude' && d2.body.startsWith('Hi') && d2.body.includes('$144.00'), 'polished draft with the same numbers is accepted');
cases.reset();

server.close();
restore();
console.log(ok ? '\nALL PASS' : '\nFAILURES');
process.exit(ok ? 0 : 1);
