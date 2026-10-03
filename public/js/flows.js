// What Cleared does when you click a suggestion. Each flow narrates its steps, switches the visible app
// as it works, and stops at an approval card. Nothing is sent or changed until you click approve.
import { S, $, $$, esc, money, clock, dur, sleep, logo, api, setApp, working, addEmail, addSent, persist, you, say, add, card, eyebrow, step, choice, openDoc, toast, hooks } from './core.js';
import { PO, LAUNCH, productSvg } from './data.js';
import { statusPill } from './apps.js';

const live = () => S.status?.mode === 'live';
const checks = (items) => `<ul class="checks">${items.map(([t, st]) => `<li class="${st || 'done'}"><i></i><span>${t}</span></li>`).join('')}</ul>`;
async function refreshQueue() {
  try {
    S.queue = await api('/api/queue');
  } catch {}
  hooks.render();
}

// ---------- overview ----------
export async function overview() {
  you('What can you take off my plate?');
  await step('Looking across your apps', null, null, 700);
  const t = S.queue?.totals;
  const el = card(`${eyebrow()}<h4>Three things need you today.</h4>
    <div class="ov">
      <div class="ov-row"><span class="team ops">Operations</span><div><b>KeHE PO 1042 · 120 cases due Friday</b><span>${S.ops.stage === 'new' ? 'No ship plan yet. Two warehouses, one freight quote.' : `In progress: ${S.ops.stage}`}</span></div><button class="mini" data-act="ops">${S.ops.stage === 'new' ? 'Handle it' : 'Open'}</button></div>
      <div class="ov-row"><span class="team growth">Growth</span><div><b>${LAUNCH.title}</b><span>${S.growth.stage === 'new' ? '12 stores, 1 broker kit. Not confirmed yet.' : `In progress: ${S.growth.stage}`}</span></div><button class="mini" data-act="growth">${S.growth.stage === 'new' ? 'Check it' : 'Open'}</button></div>
      <div class="ov-row"><span class="team finance">Finance</span><div><b>${t ? `${money(t.open)} of short-pays to review` : 'Short-pays'}</b><span>${t?.nextDeadline ? `${t.nextDeadline.payer}'s dispute window closes in ${t.nextDeadline.daysLeft} days` : 'Across your payment advices'}</span></div><button class="mini" data-act="finance">Review</button></div>
    </div>`);
  $$('[data-act]', el).forEach((b) => b.addEventListener('click', () => hooks.start({ ops: 'opsPlan', growth: 'growthCheck', finance: 'financeQueue' }[b.dataset.act])));
}

// ---------- Operations: PO 1042 ----------
// Every flow ends at a card; its buttons (data-go) start the next flow, so nothing waits on you.
const go = (flow, label, cls = 'btn wide', arg = '') => `<button class="${cls}" data-go="${flow}" data-arg="${arg}">${label}</button>`;

export async function opsPlan(skipAsk) {
  if (S.ops.stage === 'paused') return opsResume();
  if (S.ops.stage !== 'new' && S.ops.stage !== 'planned') return opsStatus();
  if (!skipAsk) you("What's blocking PO 1042?");
  await step('Reading the KeHE order in Outlook', 'outlook', { outlookFolder: 'inbox', outlook: 'kehe-po-1042' }, 800);
  await step('Checking FG-12 stock in Excel', 'excel', { excel: 'order' }, 1000);
  await step('Confirming with Cin7 and the 3PL', 'cin7', null, 900);
  card(`${eyebrow()}<h4>120 eligible cases, across two warehouses.</h4>
    <div class="split2"><div><small>East</small><b>90</b></div><div><small>West</small><b>30</b></div><div class="tot"><small>PO 1042</small><b>120</b></div></div>
    <p class="detail">Neither warehouse can fill the order alone. One shipment means waiting for a restock and missing Friday.</p>
    <div class="srcs">${logo('excel')} Order control.xlsx ${logo('cin7')} Cin7 Core ${logo('outlook')} KeHE PO</div>`);
  await step('Pricing the freight', 'outlook', { outlook: 'freight' }, 900);
  card(`${eyebrow('Cleared · Proposed plan')}<h4>Split the order. Target Friday.</h4>
    <div class="sub">90 East · 30 West · 120 cases</div>
    <div class="bigline"><b>${money(PO.freight.quote)}</b><span>total freight</span><span class="pill">+${money(PO.freight.quote - PO.freight.wait)} vs waiting</span></div>
    <p class="detail">2 warehouse releases · supplier-arranged freight · Friday is a target, not a guarantee.</p>
    ${go('opsApprove', `Approve ${money(PO.freight.quote)} + warehouse releases`)}
    ${go('opsWait', `Wait for one load (${money(PO.freight.wait)}, misses Friday)`, 'btn secondary wide')}`);
  S.ops.stage = 'planned';
  persist();
}

export async function opsWait() {
  you(`Wait for one load (${money(PO.freight.wait)})`);
  S.ops.stage = 'new';
  persist();
  say("OK. Nothing is booked. I'll draft a note to KeHE that PO 1042 ships next week when East restocks, for your approval.");
}

export async function opsApprove() {
  if (S.ops.stage !== 'planned') return opsStatus();
  you(`Approve ${money(PO.freight.quote)} + warehouse releases`);
  await step('Booking the freight', 'outlook', null, 900);
  addEmail({ id: 'freight-480', team: 'ops', from: 'Freight broker', fromAddress: 'quotes@freight.example', subject: 'Updated quote: $480 total', preview: 'Rates moved for Friday pickup', body: 'Rates moved for a Friday split pickup. Updated quote: $480 total (East + West LTL). Confirm and I will book it.' });
  setApp('outlook', { outlookFolder: 'inbox', outlook: 'freight-480' });
  S.ops.stage = 'paused';
  persist();
  pausedCard();
}

function pausedCard() {
  card(`${eyebrow('Cleared · Paused')}<h4>The quote changed. I paused.</h4>
    <div class="bigline"><s>${money(PO.freight.quote)}</s> → <b>${money(PO.freight.updated)}</b><span class="pill warn">+${money(PO.freight.updated - PO.freight.quote)}</span></div>
    <p class="detail"><b>Nothing booked or released yet.</b> Your first approval covered ${money(PO.freight.quote)}, so I need a fresh one.</p>
    ${go('opsApprove480', `Approve ${money(PO.freight.updated)} + releases`)}
    ${go('opsHold', "Hold. Don't book yet", 'btn secondary wide')}`, 'warn');
}

export async function opsResume() {
  if (S.ops.stage !== 'paused') return opsStatus();
  you('Review the new freight quote');
  setApp('outlook', { outlookFolder: 'inbox', outlook: 'freight-480' });
  pausedCard();
}

export async function opsHold() {
  you("Hold. Don't book yet");
  say("Holding. Nothing is booked. The $480 quote is good until noon; I'll remind you at 11.");
}

export async function opsApprove480() {
  if (S.ops.stage !== 'paused') return opsStatus();
  you(`Approve ${money(PO.freight.updated)} + releases`);
  S.ops.freight = PO.freight.updated;
  S.ops.stage = 'running';
  S.ops.east = 'Sent';
  S.ops.west = 'Sent';
  S.ops.freightStatus = 'Requested';
  persist();
  await step('Sending releases in ShipBob', 'shipbob', null, 800);
  const prog = card(`${eyebrow()}<h4>I'm handling the approved plan.</h4><div class="prog"></div>`);
  const upd = () => {
    $('.prog', prog).innerHTML = checks([
      [`East release · 90 cases <em>${S.ops.east}</em>`, S.ops.east === 'Accepted' ? 'done' : 'wait'],
      [`West release · 30 cases <em>${S.ops.west}</em>`, S.ops.west === 'Accepted' ? 'done' : 'wait'],
      [`Freight · ${money(S.ops.freight)} <em>${S.ops.freightStatus}</em>`, S.ops.freightStatus === 'Confirmed' ? 'done' : 'wait'],
      [`Packed actuals · 120 cases <em>${S.ops.packed ? 'Received' : 'Waiting'}</em>`, S.ops.packed ? 'done' : 'todo'],
      [`ASN from carton + SSCC data <em>${S.ops.asn ? 'Prepared' : S.ops.packed ? 'Preparing' : 'Next'}</em>`, S.ops.asn ? 'done' : 'todo'],
    ]);
    hooks.render();
  };
  upd();
  const beats = [
    () => ((S.ops.east = 'Accepted'), addEmail({ team: 'ops', id: 'east-acc', from: 'East warehouse', subject: 'Release accepted · 90 cases', preview: 'WR-2291 accepted', body: 'WR-2291 accepted. 90 cases FG-12 staged for Friday pickup.' })),
    () => ((S.ops.west = 'Accepted'), addEmail({ team: 'ops', id: 'west-acc', from: 'West warehouse', subject: 'Release accepted · 30 cases', preview: 'WR-2292 accepted', body: 'WR-2292 accepted. 30 cases FG-12 staged for Friday pickup.' })),
    () => ((S.ops.freightStatus = 'Confirmed'), addEmail({ team: 'ops', id: 'freight-ok', from: 'Freight broker', subject: 'Freight confirmed · $480', preview: 'Friday split pickup booked', body: 'Booked: Friday LTL pickup, East + West, $480 total.' })),
    () => ((S.ops.packed = true), addEmail({ team: 'ops', id: 'packing', from: '3PL portal', subject: 'Packing list · 120 cases', preview: 'Packed actuals · 6 pallets', body: 'Packing list for PO 1042: 120 cases packed on 6 pallets. Carton and SSCC labels generated.' })),
  ];
  for (const b of beats) {
    await sleep(850);
    b();
    persist();
    upd();
  }
  await step('Building the ASN in SPS Commerce', 'sps', null, 700);
  S.ops.asn = true;
  S.ops.stage = 'asn';
  persist();
  upd();
  card(`${eyebrow()}<h4>Both warehouses confirmed. Your ASN is prepared.</h4>
    ${checks([['90 + 30 cases accepted'], ['Packing matched to the ASN'], ["Pickup pending · I'll keep tracking it", 'wait']])}
    <p class="detail">I'll send the ASN to KeHE when the carrier confirms pickup. When KeHE pays, I'll match both PODs to the invoice so a split shipment can't be short-paid.</p>
    ${go('opsPickup', 'Carrier confirmed pickup · send the ASN', 'btn secondary wide')}
    ${S.growth.stage === 'new' ? go('goGrowth', `Next: ${LAUNCH.title} →`) : ''}`);
}

export async function opsPickup() {
  if (S.ops.stage !== 'asn') return opsStatus();
  you('Carrier confirmed pickup · send the ASN');
  await step('Sending the 856 in SPS Commerce', 'sps', null, 900);
  S.ops.stage = 'done';
  persist();
  hooks.render();
  card(`${eyebrow()}<h4>ASN sent. PO 1042 shipped.</h4>${checks([['Picked up East + West'], ['856 sent to KeHE'], ['Invoice 2079 · tracking both PODs for payment']])}
    ${S.growth.stage === 'new' ? go('goGrowth', `Next: ${LAUNCH.title} →`) : ''}`, 'good');
}

export async function opsStatus(said) {
  if (S.ops.stage === 'new' || S.ops.stage === 'planned') return opsPlan(!!said);
  if (S.ops.stage === 'paused') return said ? pausedCard() : opsResume();
  if (said !== true) you(said || 'Where is PO 1042 now?');
  await step('Checking ShipBob and SPS', S.ops.asn ? 'sps' : 'shipbob', null, 700);
  const o = S.ops;
  card(`${eyebrow()}<h4>${o.stage === 'done' ? 'Shipped. ASN sent.' : o.asn ? 'Packed. ASN ready. Pickup pending.' : 'Releases in progress.'}</h4>${checks([
    [`East release · ${o.east || '—'}`, o.east === 'Accepted' ? 'done' : 'wait'],
    [`West release · ${o.west || '—'}`, o.west === 'Accepted' ? 'done' : 'wait'],
    [`Freight · ${money(o.freight)} · ${o.freightStatus || '—'}`, o.freightStatus === 'Confirmed' ? 'done' : 'wait'],
    [`ASN · ${o.stage === 'done' ? 'Sent' : o.asn ? 'Prepared' : 'Not yet'}`, o.asn ? 'done' : 'todo'],
  ])}${o.stage === 'asn' ? go('opsPickup', 'Carrier confirmed pickup · send the ASN', 'btn secondary wide') : ''}`);
}

export async function goGrowth() {
  setApp('excel', { excel: 'launch' });
  return growthCheck(false);
}

// ---------- Growth: Friday's retail launch ----------
const FOLLOWUPS = [
  { to: 'Maple Market', addr: LAUNCH.stores[0].email, body: LAUNCH.stores[0].ask, subject: 'Friday sampling slot' },
  { to: 'Harbor Pantry', addr: LAUNCH.stores[1].email, body: LAUNCH.stores[1].ask, subject: 'Friday sampling slot' },
  { to: 'Broker', addr: LAUNCH.broker.email, body: LAUNCH.broker.ask, subject: 'Updated broker kit (v3)', attach: 'Retail_Broker_Kit.pdf (v3)' },
];
let reviewCard = null;

export async function growthCheck(skipAsk) {
  if (S.growth.stage !== 'new') return growthStatus();
  if (!skipAsk) you("Is Friday's retail launch actually ready?");
  await step('Checking every store in the launch tracker', 'excel', { excel: 'launch' }, 1000);
  await step('Checking the broker kit against approved assets', 'onedrive', { onedrive: 'assets' }, 1000);
  card(`${eyebrow()}<div class="bigline"><b>10 of 12</b><span>slots confirmed</span></div>
    ${checks([['Two stores still need to reply: Maple Market, Harbor Pantry', 'warn'], ['Broker kit uses an old image (v2; v3 is approved)', 'warn'], [LAUNCH.samples, 'wait']])}`);
  card(`${eyebrow()}<h4>One fix. Two replies.</h4>
    <div class="imgs"><figure>${productSvg('v2')}<figcaption>In broker kit · old image</figcaption></figure><figure class="ok">${productSvg('v3')}<figcaption>Approved in OneDrive · v3</figcaption></figure></div>
    <p class="detail">◷ Maple Market and Harbor Pantry haven't replied.</p>
    ${go('growthReview', 'Review changes and messages')}`);
}

export async function growthReview() {
  if (S.growth.stage !== 'new') return growthStatus();
  you('Review changes and messages');
  reviewCard = card(`${eyebrow('Cleared · Review')}<h4>Review the updates and follow-ups</h4>
    <div class="chiprow"><span class="pill">Kit → approved image v3</span><span class="pill">Tracker → record replies</span></div>
    <div class="lbl">Send these follow-ups</div>
    ${FOLLOWUPS.map((m, i) => `<label class="fu"><input type="checkbox" checked data-i="${i}"><span><small>${esc(m.to)} · Outlook</small><input class="fu-body" data-i="${i}" value="${esc(m.body)}">${m.attach ? `<em>📎 ${esc(m.attach)}</em>` : ''}</span></label>`).join('')}
    <button class="btn wide" data-go="growthApprove" id="gApprove">Approve updates + ${FOLLOWUPS.length} emails</button>`);
  const sync = () => {
    const k = $$('input[type=checkbox]', reviewCard).filter((x) => x.checked).length;
    $('#gApprove', reviewCard).textContent = `Approve updates + ${k} email${k === 1 ? '' : 's'}`;
  };
  $$('input[type=checkbox]', reviewCard).forEach((x) => x.addEventListener('change', sync));
}

export async function growthApprove() {
  if (S.growth.stage !== 'new' || !reviewCard) return growthStatus();
  const chosen = FOLLOWUPS.map((m, i) => ({ ...m, on: $(`input[type=checkbox][data-i="${i}"]`, reviewCard).checked, body: $(`.fu-body[data-i="${i}"]`, reviewCard).value })).filter((m) => m.on);
  $$('input', reviewCard).forEach((x) => (x.disabled = true));
  you(`Approve updates + ${chosen.length} emails`);
  await step('Updating the broker kit in OneDrive', 'onedrive', { onedrive: 'assets' }, 800);
  S.growth.kit = 'v3';
  S.growth.broker = 'v3 sent';
  for (const m of chosen) addSent({ team: 'growth', to: m.addr, subject: m.subject, body: m.body });
  S.growth.stage = 'sent';
  S.growth.sentTo = chosen.map((m) => m.to);
  persist();
  await step('Sending the follow-ups from Outlook', 'outlook', { outlookFolder: 'sent', outlook: 'sent:0' }, 800);
  card(`${eyebrow()}<h4>Approved. Putting it in motion.</h4>${checks([['Broker kit updated'], [`Follow-ups sent · ${chosen.length}`], ['Launch tracker updated', 'wait'], ['Replies pending', 'wait']])}
    ${go('growthReplies', 'Check for replies', 'btn secondary wide')}`);
}

export async function growthReplies() {
  if (S.growth.stage !== 'sent') return growthStatus();
  you('Any replies from the stores?');
  await step('Watching the inbox', 'outlook', { outlookFolder: 'inbox' }, 1100);
  const replies = [
    { who: 'Harbor Pantry', text: "We're confirmed for Friday.", key: 'harbor' },
    { who: 'Maple Market', text: 'Friday sampling slot confirmed.', key: 'maple' },
    { who: 'Retail broker', text: 'Got the v3 kit. Printing today.', key: 'broker' },
  ].filter((r) => (r.key === 'broker' ? S.growth.sentTo?.includes('Broker') : S.growth.sentTo?.includes(r.who)));
  for (const r of replies) {
    addEmail({ team: 'growth', id: `reply-${r.key}`, from: r.who, subject: r.key === 'broker' ? 'RE: Updated broker kit (v3)' : 'RE: Friday sampling slot', preview: r.text, body: r.text });
    if (r.key === 'broker') S.growth.broker = 'Received (v3)';
    else S.growth[r.key] = 'Confirmed';
  }
  S.growth.stage = 'done';
  persist();
  await step('Updating the launch tracker in Excel', 'excel', { excel: 'launch' }, 900);
  const conf = 10 + (S.growth.maple === 'Confirmed') + (S.growth.harbor === 'Confirmed');
  card(`${eyebrow()}<div class="bigline"><b>${conf}/12</b><span>slots confirmed</span></div>
    <h4>${conf === 12 ? 'Replies are in. The broker has the right kit.' : 'Some replies are in.'}</h4>
    ${replies.map((r) => `<div class="quote"><small>${esc(r.who)} · reply</small>${esc(r.text)}</div>`).join('')}
    ${checks([[`${conf} slots confirmed`, conf === 12 ? 'done' : 'wait'], [`Corrected kit ${S.growth.broker === 'Received (v3)' ? 'received by the broker' : 'sent'}`], ["Still open: product samples due Thursday · I'm tracking delivery", 'wait']])}
    ${go('financeCase', "Next: UNFI's $240 short-pay →", 'btn wide', '2086')}`, conf === 12 ? 'good' : '');
}

export async function growthStatus(said) {
  if (S.growth.stage === 'new') return growthCheck(!!said);
  if (said !== true) you(said || 'Where does the launch stand?');
  await step('Checking the launch tracker', 'excel', { excel: 'launch' }, 600);
  const g = S.growth;
  const conf = 10 + (g.maple === 'Confirmed') + (g.harbor === 'Confirmed');
  card(`${eyebrow()}<div class="bigline"><b>${conf}/12</b><span>slots confirmed</span></div>${checks([[`Broker kit · ${g.broker}`, g.kit === 'v3' ? 'done' : 'warn'], [`Maple Market · ${g.maple}`, g.maple === 'Confirmed' ? 'done' : 'wait'], [`Harbor Pantry · ${g.harbor}`, g.harbor === 'Confirmed' ? 'done' : 'wait'], [LAUNCH.samples, 'wait']])}
    ${g.stage === 'sent' ? go('growthReplies', 'Check for replies', 'btn secondary wide') : ''}`);
}

// ---------- Finance: short-pays ----------
export async function financeQueue(payer, said) {
  you(said || (payer ? `Why did ${payer} short-pay us?` : 'Which short-pays need attention?'));
  await step('Reading payment advices in Outlook', 'outlook', { outlookFolder: 'inbox' }, 700);
  await step('Matching them to open invoices in QuickBooks', 'quickbooks', { quickbooks: null }, 700);
  await refreshQueue();
  const q = S.queue;
  const payers = q.payers.filter((p) => !payer || p.name === payer);
  const el = card(`${eyebrow()}<h4>${payer ? `${payer} withheld ${money(payers[0]?.withheld)}.` : `${money(q.totals.withheld)} withheld across ${q.payers.length} payers.`}</h4>
    ${!payer && q.totals.nextDeadline ? `<p class="detail">${esc(q.totals.nextDeadline.payer)}'s dispute window closes first, in <b>${q.totals.nextDeadline.daysLeft} days</b>.</p>` : ''}
    ${payers
      .map(
        (p) => `<div class="grp-h"><b>${esc(p.name)}</b><span>${esc(p.payment)}</span>${p.deadline ? `<span class="days ${p.deadline.daysLeft <= 10 ? 'warn' : ''}">${p.deadline.daysLeft}d left</span>` : ''}</div>
      ${q.rows
        .filter((r) => r.customer === p.name)
        .map((r) => `<div class="qrow"><div><b>Invoice ${r.n}</b><span>${esc(r.reason)}${r.cases ? ` · ${r.cases} cases` : ''} · ${esc(r.ref)}</span></div><span class="amt">${money(r.amount)}</span>${statusPill(r)}<button class="mini" data-act="${r.n}">Open</button></div>`)
        .join('')}`,
      )
      .join('')}`);
  $$('[data-act]', el).forEach((b) => b.addEventListener('click', () => hooks.start('financeCase', b.dataset.act)));
}

const TAG = { request_evidence: ['Claim, not proven', 'warn'], dispute: ['Claim not supported', 'warn'], valid: ['Claim supported', 'good'], paid_in_full: ['Resolved', 'good'], needs_review: ['Needs a person', 'warn'] };

export async function financeCase(n, said) {
  n = String(n);
  you(said || `Why were we short-paid on Invoice ${n}, and what do we need to resolve it?`);
  let c = await api(`/api/case/${n}`).catch(() => null);
  if (c?.assessment && ['waiting', 'resolved', 'accepted'].includes(c.status)) {
    S.cases[n] = c;
    setApp('quickbooks', { quickbooks: n });
    return outcomeCard(c);
  }
  const t0 = Date.now();
  const res = await fetch(`/api/case/${n}/investigate`, { method: 'POST' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const labels = { reconcile: 'quickbooks', remittance: 'outlook', evidence: 'onedrive' };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.type === 'error') throw new Error(ev.text);
      if (ev.type === 'case') c = ev.case;
      if (ev.type === 'step' && ev.state === 'running') {
        const app = labels[ev.step];
        const payer = S.queue?.rows.find((r) => r.n === n)?.customer;
        const remit = S.queue?.payers.find((p) => p.name === payer);
        const sel = app === 'quickbooks' ? { quickbooks: n } : app === 'outlook' ? { outlookFolder: 'inbox', outlook: remit ? `remit:${remit.file.name}` : null } : app === 'onedrive' ? { onedrive: `packet:${n}` } : null;
        await step(ev.label, app || null, sel, 120);
      }
    }
  }
  S.cases[n] = c;
  await refreshQueue();
  setApp('quickbooks', { quickbooks: n });
  return caseCards(c, t0);
}

function checksLine(a) {
  const n = a.review?.length || 0;
  return n
    ? `<div class="codecheck bad">⚠ ${n} code check${n > 1 ? 's' : ''} failed · QuickBooks vs payment advice, document totals</div>`
    : `<div class="codecheck">✓ Checked in code: QuickBooks vs payment advice · each document's totals</div>`;
}

function trailHtml(nodes) {
  const NODE = { ok: '', warn: 'unknown', info: 'short', muted: 'paid' };
  return `<div class="mtrail">${nodes.map((x, i) => `${i ? '<span class="ar">→</span>' : ''}<div class="mnode ${NODE[x.state] ?? ''}"><small>${esc(x.label)}</small><b>${esc(x.value)}</b><span>${esc(x.sub || '')}</span></div>`).join('')}</div>`;
}

async function caseCards(c, t0) {
  const a = c.assessment;
  const r = c.reconcile;
  card(`${eyebrow()}<h4>${esc(c.customer)} · Invoice ${esc(c.n)}</h4>
    <div class="row2"><span>QuickBooks invoice</span><b>${money(r.billed)}</b></div>
    <div class="row2"><span>${esc(c.customer)} payment · ${esc(c.remittance.payment)}</span><b>${money(r.paid)}</b></div>
    <div class="gapline"><span>◷ Unresolved difference</span><b>${money(r.gap)}</b></div>`);
  if (c.claim) add(`<span>${esc(c.claim.title)}</span><span class="ref">${esc(c.claim.code)} · ${esc(c.claim.ref)}</span><span class="tag ${TAG[a.verdict]?.[1] || ''}">${TAG[a.verdict]?.[0] || ''}</span>`, 'claimline');
  const ev = card(`${eyebrow()}<h4>Let's check the evidence.</h4>${trailHtml(c.evidence.trail.nodes)}
    <p class="detail">${esc(a.verdict === 'needs_review' ? c.evidence.trail.nodes.length ? "Cleared's math checks failed on this one. Details below." : '' : c.evidence.trail.note)}</p>
    ${checksLine(a)}
    <div class="docchips">${[c.remittance.file, ...c.evidence.docs].map((d) => `<button class="dchip ${d.flag?.state === 'warn' ? 'warn' : ''}" data-doc="${esc(d.name)}">${d.kind === 'remittance' ? logo('outlook') : logo('onedrive')}${esc(d.short || 'Remittance')}</button>`).join('')}</div>`);
  $$('[data-doc]', ev).forEach((b) =>
    b.addEventListener('click', () => {
      const d = [c.remittance.file, ...c.evidence.docs].find((x) => x.name === b.dataset.doc);
      if (d.kind === 'remittance') openDoc({ title: d.name, eyebrowHtml: `${logo('outlook')} Outlook attachment`, url: d.url, lines: c.remittance.lines, highlight: c.n, reader: c.remittance.reader });
      else openDoc({ title: `${d.label} · ${d.name}`, eyebrowHtml: `${logo('onedrive')} OneDrive · Invoice ${c.n} packet`, url: d.url, read: d.read, reader: d.reader });
    }),
  );
  if (a.verdict === 'needs_review') {
    card(`${eyebrow('Cleared · Needs your review')}<div class="vh"><span>👤</span><div><h4>${esc(a.headline)}</h4><p class="detail">I won't guess. These checks failed in code:</p></div></div>
      <ul class="issues">${a.review.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <p class="detail">Ask ${esc(c.customer)} for the payment detail, or check QuickBooks yourself before anyone disputes or writes this off.</p>`, 'review');
  } else card(`<div class="vh"><span>${a.verdict === 'valid' ? '✅' : '⚠️'}</span><div><h4>${esc(a.headline)}</h4><p class="detail">${esc(a.detail)}</p>${c.remittance.deadline && a.verdict !== 'valid' ? `<div class="meta">${money(r.gap)} unresolved · dispute window closes ${esc(c.remittance.deadline.label)} (${c.remittance.deadline.daysLeft} days)</div>` : ''}</div></div>`, a.verdict === 'valid' ? 'good' : 'warn');
  const opts = card(`${eyebrow('Cleared · What should we do?')}<div class="opts">${c.options
    .map((o) => `<button class="optb ${o.strength}" data-opt="${o.id}"><span class="pill ${o.strength === 'recommended' ? 'dark' : ''}">${o.strength === 'recommended' ? 'Recommended' : o.strength === 'possible' ? 'Possible' : 'Not advised'}</span><b>${esc(o.title)}</b><span>${esc(o.desc)}</span><em>${esc(o.why)}</em></button>`)
    .join('')}</div><div class="act"></div>`);
  const actArea = $('.act', opts);
  let current = null;
  const pick = async (id) => {
    current = id;
    $$('.optb', opts).forEach((b) => b.classList.toggle('sel', b.dataset.opt === id));
    actArea.innerHTML = `<div class="thinking"><span class="d"><i></i><i></i><i></i></span>${S.status?.ai ? 'Claude is drafting' : 'Drafting'}</div>`;
    const d = await api(`/api/case/${c.n}/draft`, { method: 'POST', body: { action: id } });
    if (current !== id) return;
    actArea.innerHTML =
      id === 'accept'
        ? `<div class="qbnote">${logo('quickbooks')} Note for the QuickBooks invoice<div class="n">${esc(d.note)}</div></div><button class="btn wide" data-approve>Approve: accept ${money(d.amount)} and close</button><div class="fine">Nothing is sent to ${esc(c.customer)}.</div>`
        : `<div class="mail"><div class="mh">${logo('outlook')} To <b>${esc(d.to)}</b><span>${d.writer === 'claude' ? '✦ Drafted by Claude' : 'Drafted from the evidence'}</span></div>
          <input class="subj" value="${esc(d.subject)}"><textarea class="body" rows="9">${esc(d.body)}</textarea>
          <div class="atts">${d.attachments.map((x) => `<button class="att on" data-att="${esc(x.name)}">${esc(x.label)}</button>`).join('')}</div></div>
          <button class="btn wide" data-approve>Approve &amp; send</button><div class="fine">Nothing is sent until you approve. Edit anything above.</div>`;
    if (a.verdict === 'needs_review' && id !== 'request') {
      actArea.insertAdjacentHTML('afterbegin', `<label class="override"><input type="checkbox"> I've checked the numbers myself and want to ${id === 'accept' ? 'write this off' : 'dispute'} anyway.</label>`);
      const box = $('.override input', actArea);
      const btn = $('[data-approve]', actArea);
      btn.disabled = true;
      box.addEventListener('change', () => (btn.disabled = !box.checked));
    }
    $$('[data-att]', actArea).forEach((b) => b.addEventListener('click', () => b.classList.toggle('on')));
    $('[data-approve]', actArea).addEventListener('click', () => approve(c, id, actArea, t0));
  };
  $$('[data-opt]', opts).forEach((b) => b.addEventListener('click', () => !opts.classList.contains('locked') && pick(b.dataset.opt)));
  await pick(c.options.find((o) => o.strength === 'recommended')?.id || 'request');
}

async function approve(c, action, area, t0) {
  const btn = $('[data-approve]', area);
  btn.disabled = true;
  btn.textContent = action === 'accept' ? 'Closing…' : 'Sending…';
  const override = !!$('.override input', area)?.checked;
  const body = action === 'accept' ? { action, override } : { action, override, subject: $('.subj', area).value, body: $('.body', area).value, attachments: $$('.att.on', area).map((x) => x.dataset.att) };
  try {
    working(action === 'accept' ? 'quickbooks' : 'outlook');
    const updated = await api(`/api/case/${c.n}/approve`, { method: 'POST', body });
    area.closest('.card').classList.add('locked');
    $$('input,textarea,button', area).forEach((x) => (x.disabled = true));
    btn.textContent = 'Approved';
    S.cases[c.n] = updated;
    if (updated.sent) addSent({ team: 'finance', invoice: c.n, to: updated.sent.to, subject: updated.sent.subject, body: updated.sent.body });
    delete S.invoices[c.n];
    await refreshQueue();
    setApp(updated.sent ? 'outlook' : 'quickbooks', updated.sent ? { outlookFolder: 'sent', outlook: 'sent:0' } : { quickbooks: c.n });
    working(null);
    outcomeCard(updated);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Try again';
    toast(e.message, true);
  }
}

function outcomeCard(c) {
  const a = c.assessment;
  if (c.status === 'accepted') {
    return card(`${eyebrow()}<h4>Reviewed and closed.</h4>${checks([['Invoice matched'], [a.type === 'otif' ? 'Late delivery confirmed' : 'Evidence supports the deduction'], [c.approval?.noted ? 'Note added to QuickBooks invoice' : 'Logged']])}
      <div class="audit">Approved by ${esc(c.approval?.by)} · ${clock(c.approval?.at)} · ${dur(c.approval?.elapsed || 0)} from opening the case</div>`, 'good');
  }
  if (c.status === 'resolved') {
    return card(`<div class="win"><img src="/mascot.png" alt=""><div><b>${money(c.outcome.amount)} recovered</b><span>${esc(c.customer)} reversed ${esc(a.deductionRef)}.</span></div></div>
      ${c.reply ? `<div class="quote"><small>${esc(c.reply.from)} · ${clock(c.reply.at)}${c.reply.simulated ? ' · simulated' : ''}</small>${esc(c.reply.text)}</div>` : ''}`, 'good');
  }
  const el = card(`${eyebrow()}<h4>${c.sent.action === 'dispute' ? 'Dispute sent.' : 'Backup request sent.'}</h4>
    ${checks([['Invoice matched'], [c.sent.action === 'dispute' ? 'Dispute filed with proof' : 'Backup requested'], ['Follow-up owned'], ...(c.approval?.noted ? [['Note added to QuickBooks invoice']] : [])])}
    <div class="pendline">◷ ${money(c.sent.amount)} unresolved · awaiting ${esc(c.customer)}'s response</div>
    <div class="audit">Approved by ${esc(c.approval?.by)} · ${clock(c.approval?.at)} · ${c.sent.attachments.length} attachments · <b>${dur(c.approval?.elapsed || 0)}</b> from opening the case</div>
    <button class="btn secondary wide" data-act="reply">${live() ? 'Check for replies' : `Simulate ${esc(c.customer)}'s reply`}</button>`);
  choice(el).then(async () => {
    const out = await api(`/api/case/${c.n}/${live() ? 'replies' : 'simulate-reply'}`, { method: 'POST' }).catch((e) => (toast(e.message, true), null));
    if (!out) return;
    if (!out.found) {
      toast(`No reply from ${c.customer} yet.`);
      return;
    }
    S.cases[c.n] = out.case;
    addEmail({ team: 'finance', id: `reply-${c.n}`, from: out.case.reply.from, subject: out.case.reply.subject, preview: out.case.reply.text.slice(0, 80), body: out.case.reply.text });
    await refreshQueue();
    setApp('quickbooks', { quickbooks: null });
    outcomeCard(out.case);
    if (out.case.status === 'resolved') toast(`${money(out.case.outcome.amount)} recovered on Invoice ${c.n}`);
  });
  return el;
}

// ---------- free text ----------
export function route(text) {
  const t = text.toLowerCase();
  const inv = t.match(/\b(20\d{2})\b/)?.[1];
  if (inv && S.queue?.rows.some((r) => r.n === inv)) return () => financeCase(inv, text);
  if (/1042|ship|freight|release|asn|warehouse|kehe order|friday.*(order|ship)/.test(t)) return () => (you(text), opsStatus(true));
  if (/launch|broker|kit|maple|harbor|sampl|slot|store/.test(t)) return () => (you(text), growthStatus(true));
  if (/short|deduct|paid|remit|dispute|fine|otif|chargeback|withh/.test(t)) {
    const payer = S.queue?.payers.find((p) => t.includes(p.name.toLowerCase()))?.name;
    return () => financeQueue(payer, text);
  }
  if (/plate|today|help|what can|overview/.test(t)) return () => overview();
  return () => ask(text);
}

// Anything else: the verified assistant. Claude answers from tools, does its math in code, and every number is
// checked before it's shown. If it can't verify something, it hands the question to a person.
async function ask(text) {
  you(text);
  await step(S.status?.ai ? 'Checking with code' : 'Thinking', null, null, 300);
  const ctx = hooks.context?.();
  const out = await api('/api/chat', { method: 'POST', body: { text, context: { lookingAt: ctx?.title || null, app: S.app, ops: S.ops, growth: S.growth, facts: { po: PO, launch: LAUNCH } } } }).catch((e) => ({ error: e.message }));
  if (out?.escalate) return escalation(out);
  if (out?.text) {
    const calc = (out.checks || []).map((t) =>
      t.tool === 'calculate' ? `${esc(t.input.expression)} = <b>${esc(fmtNum(t.output.result))}</b>`
      : t.tool === 'verify_equal' ? `${esc(t.output.label)}: ${t.output.ok ? '✓ matches' : '✗ expected ' + esc(fmtNum(t.output.expected))}`
      : t.tool === 'days_until' ? `days to ${esc(t.input.date)} = <b>${esc(t.output.days)}</b>` : '');
    return add(`<div class="ans">${esc(out.text)}</div>${calc.length || out.sources?.length ? `<div class="proof">${calc.length ? `<span>✓ Math done in code</span>${calc.map((x) => `<code>${x}</code>`).join('')}` : ''}${out.sources?.length ? `<span class="src">From: ${out.sources.map((x) => esc(SRC[x] || x)).join(', ')}</span>` : ''}</div>` : ''}`, 'say verified');
  }
  say(S.status?.ai ? "I couldn't answer that one. Try one of the suggestions below." : 'I can do arithmetic in code (try "what is 10 x 24") and help with orders, launches and short-pays through the suggestions below. Add an Anthropic key for open questions.');
}
const SRC = { get_short_pays: 'payment advices + QuickBooks', get_case: 'the investigated case', get_workspace: 'Operations and Growth status' };
const fmtNum = (n) => (typeof n === 'number' ? (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 4 })) : n);

function escalation(out) {
  const e = out.escalate;
  const el = card(`${eyebrow('Cleared · Needs your review')}<div class="vh"><span>👤</span><div><h4>I'm handing this to you.</h4><p class="detail">${esc(e.reason)}</p></div></div>
    ${e.check ? `<div class="meta">What to check: ${esc(e.check)}</div>` : ''}
    ${out.checks?.length ? `<div class="proof"><span>What I checked in code</span>${out.checks.map((t) => `<code>${esc(t.tool)}${t.input?.expression ? ': ' + esc(t.input.expression) : t.input?.invoice ? ': ' + esc(t.input.invoice) : ''}${t.output?.result != null ? ' = ' + esc(fmtNum(t.output.result)) : t.output?.ok === false ? ' ✗' : ''}</code>`).join('')}</div>` : ''}
    <button class="btn wide" data-act="take">I'll take it</button>`, 'review');
  choice(el).then(() => {
    $('[data-act="take"]', el).textContent = `Assigned to ${S.status?.approver || 'you'}`;
    toast('Added to your review list');
  });
}

export const FLOWS = { overview, opsPlan: () => opsPlan(false), opsWait, opsApprove, opsApprove480, opsHold, opsResume, opsPickup, opsStatus: () => opsStatus(), goGrowth, growthCheck: () => growthCheck(false), growthReview, growthApprove, growthReplies, growthStatus: () => growthStatus(), opsStatusFlow: () => opsStatus(), financeQueue: (payer) => financeQueue(payer), financeCase: (n) => financeCase(n) };
