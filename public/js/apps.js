// The work desktop's apps. Each renderer draws the app and reports what the employee is looking at,
// so the Cleared panel can offer the right one-click help.
import { S, $, $$, esc, money, d8, clock, logo, APPS, api, setApp, openDoc, persist } from './core.js';
import { EMAILS, STOCK, PO, LAUNCH, ASSETS, productSvg } from './data.js';

const preview = (app) => (APPS[app].live ? '' : `<span class="preview-tag" title="Not connected in this POC. Simulated data.">Preview · simulated</span>`);
const appHead = (app, desc, extra = '') => `<div class="app-head">${logo(app, true)}<b>${APPS[app].name}</b><span>${esc(desc)}</span>${preview(app)}${extra}</div>`;

// ---------- Outlook ----------
function financeEmails() {
  return (S.queue?.payers || []).map((p) => ({
    id: `remit:${p.file.name}`,
    team: 'finance',
    from: p.message?.from || p.name,
    fromAddress: p.message?.fromAddress || '',
    time: p.paymentDate ? new Date(p.paymentDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
    subject: p.message?.subject || `${p.name} payment advice`,
    preview: `${p.count} deduction${p.count > 1 ? 's' : ''} · ${money(p.withheld)} withheld`,
    payer: p.name,
    attachments: [p.file.name],
    live: S.status?.mode === 'live',
  }));
}
export function inbox() {
  return [...S.extra, ...EMAILS.slice(0, 4), ...financeEmails(), ...EMAILS.slice(4)];
}
function outlook() {
  const folder = S.sel.outlookFolder;
  const list = folder === 'sent' ? S.sent.map((m, i) => ({ ...m, id: `sent:${i}`, from: `To: ${m.to}`, time: clock(m.at), preview: m.body.slice(0, 80) })) : inbox();
  let sel = list.find((m) => m.id === S.sel.outlook) || list[0];
  if (sel && folder === 'inbox') S.read[sel.id] = true;
  const unread = inbox().filter((m) => m.unread && !S.read[m.id]).length;
  const body = sel ? readingPane(sel, folder) : `<div class="empty">Nothing here yet.</div>`;
  return {
    html: `${appHead('outlook', 'Inbox · Fable Grove ops@')}
    <div class="ol">
      <nav class="ol-folders">
        <button data-folder="inbox" class="${folder === 'inbox' ? 'sel' : ''}">Inbox ${unread ? `<span class="count">${unread}</span>` : ''}</button>
        <button data-folder="sent" class="${folder === 'sent' ? 'sel' : ''}">Sent Items ${S.sent.length ? `<span class="count muted">${S.sent.length}</span>` : ''}</button>
      </nav>
      <div class="ol-list">${list
        .map(
          (m) => `<button class="ol-item ${m.id === sel?.id ? 'sel' : ''} ${m.unread && !S.read[m.id] && folder === 'inbox' ? 'unread' : ''}" data-mail="${esc(m.id)}">
        <span class="ol-top"><b>${esc(m.from)}</b><span class="t">${esc(m.time || '')}</span></span>
        <span class="s">${esc(m.subject)}</span><span class="p">${esc(m.preview || '')}</span>
        ${m.team ? `<span class="tagline ${m.team}">${m.team === 'finance' ? 'Finance' : m.team === 'ops' ? 'Operations' : 'Growth'}${m.team !== 'finance' || !m.live ? '' : ' · live'}</span>` : ''}
      </button>`,
        )
        .join('')}</div>
      <div class="ol-read">${body}</div>
    </div>`,
    ctx: sel ? mailContext(sel, folder) : null,
  };
}
function readingPane(m, folder) {
  const rows = m.payer ? (S.queue?.rows || []).filter((r) => r.customer === m.payer) : [];
  return `<h3>${esc(m.subject)}</h3>
    <div class="from">${folder === 'sent' ? esc(m.from) : `${esc(m.from)} ${m.fromAddress ? `&lt;${esc(m.fromAddress)}&gt;` : ''}`} · ${esc(m.time || '')}</div>
    ${(m.attachments || []).map((a) => `<button class="att" data-attach="${esc(a)}" data-payer="${esc(m.payer || '')}">${esc(a)}</button>`).join('')}
    <p class="body">${esc(m.body || (m.payer ? `Payment advice for ${m.subject.split('·')[1]?.trim() || ''}. Remittance detail attached.` : ''))}</p>
    ${m.fields ? `<table class="kv">${m.fields.map(([k, v]) => `<tr><td>${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join('')}</table>` : ''}
    ${rows.length ? `<table class="lines"><thead><tr><th>Invoice</th><th>Deduction</th><th class="r">Withheld</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r.n}</td><td>${esc(r.code)} ${esc(r.ref)} · ${esc(r.reason)}${r.cases ? `: ${r.cases} cases` : ''}</td><td class="r">−${money(r.amount)}</td></tr>`).join('')}</tbody></table>` : ''}`;
}
function mailContext(m, folder) {
  if (folder === 'sent') return { team: m.team, title: `Sent · ${m.subject}`, chips: m.team === 'finance' && m.invoice ? [{ label: `Where does Invoice ${m.invoice} stand?`, flow: 'financeCase', arg: m.invoice }] : nextChips(m.team) };
  if (m.team === 'ops') return { team: 'ops', title: `${m.from} · PO 1042`, chips: opsChips() };
  if (m.team === 'growth') return { team: 'growth', title: `${m.from} · ${LAUNCH.title}`, chips: growthChips() };
  if (m.team === 'finance') {
    const open = (S.queue?.rows || []).filter((r) => r.customer === m.payer);
    return {
      team: 'finance',
      title: `${m.payer} payment advice`,
      chips: [{ label: `Why did ${m.payer} short-pay us?`, flow: 'financeQueue', arg: m.payer }, ...open.slice(0, 2).map((r) => ({ label: `Look into Invoice ${r.n} · ${money(r.amount)}`, flow: 'financeCase', arg: r.n }))],
    };
  }
  return null;
}

// ---------- Excel ----------
function excel() {
  const book = S.sel.excel;
  const tabs = `<div class="xl-books"><button data-book="order" class="${book === 'order' ? 'sel' : ''}">Order control.xlsx</button><button data-book="launch" class="${book === 'launch' ? 'sel' : ''}">Retail launch.xlsx</button></div>`;
  if (book === 'launch') {
    const g = S.growth;
    const rows = [
      ['Maple Market', 1, g.maple, g.maple !== 'Confirmed'],
      ['Harbor Pantry', 1, g.harbor, g.harbor !== 'Confirmed'],
      ['10 other stores', 10, 'Confirmed', false],
      ['Broker kit', '', g.broker, g.broker === 'Old image'],
    ];
    const confirmed = 10 + (g.maple === 'Confirmed') + (g.harbor === 'Confirmed');
    return {
      html: `${appHead('excel', 'the retail launch tracker')}${tabs}
      ${grid(['Store / partner', 'Slots', 'Status'], rows.map(([a, b, c, hl]) => [a, b, { v: c, cls: hl ? 'hl warn' : /Confirmed|Received/.test(c) ? 'good' : '' }]), `${confirmed} / 12 sampling slots confirmed`, ['Launch tracker', 'Product samples'])}
      <div class="app-foot warn">◷ ${esc(LAUNCH.samples)}</div>`,
      ctx: { team: 'growth', title: 'Retail launch.xlsx · Launch tracker', chips: growthChips() },
    };
  }
  const o = S.ops;
  const rel = (wh) => (o[wh.toLowerCase()] ? { v: o[wh.toLowerCase()], cls: 'good' } : null);
  const rows = STOCK.map((r) => {
    const isPo = r.sku === PO.sku;
    return [r.sku, r.wh, { v: r.available, cls: isPo ? 'hl' : '' }, isPo && rel(r.wh) ? rel(r.wh) : { v: r.release, cls: r.release === 'Pending' ? 'pending' : '' }];
  });
  return {
    html: `${appHead('excel', 'the stock and release tracker')}${tabs}
    ${grid(['SKU', 'Warehouse', 'Available', 'Release'], rows, `120 eligible cases · PO ${PO.po}`, ['Inventory', 'Orders'])}
    <div class="app-foot">Sources: Cin7 Core · 3PL confirmations · KeHE PO</div>`,
    ctx: { team: 'ops', title: 'Order control.xlsx · FG-12 for PO 1042', chips: opsChips() },
  };
}
function grid(cols, rows, summary, sheets) {
  const letters = 'ABCDEFG';
  return `<div class="xl">
    <div class="xl-bar"><span class="cell-ref">C2:C3</span><span class="fx">fx</span><span>${esc(String(rows[0]?.[2]?.v ?? rows[0]?.[2] ?? ''))}</span></div>
    <table class="xl-grid"><thead><tr><th></th>${cols.map((_, i) => `<th>${letters[i]}</th>`).join('')}</tr></thead>
    <tbody><tr><td class="rn">1</td>${cols.map((c) => `<td class="hdr">${esc(c)}</td>`).join('')}</tr>
    ${rows.map((r, i) => `<tr><td class="rn">${i + 2}</td>${r.map((c) => (c && typeof c === 'object' ? `<td class="${c.cls}">${esc(c.v)}</td>` : `<td>${esc(c ?? '')}</td>`)).join('')}</tr>`).join('')}
    </tbody></table>
    <div class="xl-sum">${esc(summary)}</div>
    <div class="xl-sheets">${sheets.map((s, i) => `<span class="${i ? '' : 'sel'}">${esc(s)}</span>`).join('')}</div>
  </div>`;
}

// ---------- Cin7 ----------
function cin7() {
  const o = S.ops;
  const alloc = (sku, wh) => (sku === PO.sku && ['running', 'asn', 'done'].includes(o.stage) ? PO.split.find((s) => s.wh === wh)?.cases ?? 0 : 0);
  return {
    html: `${appHead('cin7', 'stock on hand')}
    <div class="panelish"><table class="lines"><thead><tr><th>SKU</th><th>Location</th><th class="r">On hand</th><th class="r">Allocated</th><th class="r">Available</th></tr></thead><tbody>
    ${STOCK.map((r) => `<tr class="${r.sku === PO.sku ? 'hlrow' : ''}"><td>${r.sku}</td><td>${r.wh}</td><td class="r">${r.available}</td><td class="r">${alloc(r.sku, r.wh)}</td><td class="r">${r.available - alloc(r.sku, r.wh)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="app-foot">${['running', 'asn', 'done'].includes(o.stage) ? 'FG-12 allocated to KeHE PO 1042: 90 East · 30 West' : 'FG-12: 120 on hand across East and West'}</div>`,
    ctx: { team: 'ops', title: 'Cin7 · FG-12 stock', chips: opsChips() },
  };
}

// ---------- ShipBob ----------
function shipbob() {
  const o = S.ops;
  const st = (v) => `<span class="st ${/Accepted|Confirmed|Received/.test(v) ? 'good' : v ? 'sent' : ''}">${esc(v || '—')}</span>`;
  const has = ['running', 'asn', 'done'].includes(o.stage);
  return {
    html: `${appHead('shipbob', 'your 3PL portal: releases and packing')}
    <div class="panelish"><div class="crumbs">Orders › Wholesale › KeHE PO 1042</div>
    ${
      has
        ? `<table class="lines"><thead><tr><th>Release</th><th>Warehouse</th><th class="r">Cases</th><th>Status</th></tr></thead><tbody>
      <tr><td>WR-2291 · FG-12</td><td>East</td><td class="r">90</td><td>${st(o.east)}</td></tr>
      <tr><td>WR-2292 · FG-12</td><td>West</td><td class="r">30</td><td>${st(o.west)}</td></tr>
      <tr><td>Freight · LTL</td><td>East + West</td><td class="r">${money(o.freight)}</td><td>${st(o.freightStatus)}</td></tr>
      </tbody></table>
      ${o.packed ? `<div class="note-box">Packing list received · PO 1042<br><span>120 cases packed · 6 pallets · carton and SSCC labels generated</span></div>` : ''}`
        : `<div class="empty">No releases for PO 1042 yet. Waiting on an approved ship plan.</div>`
    }</div>
    <div class="app-foot ${has ? 'good' : ''}">${has ? 'Releases accepted in your 3PL portal · pickup not yet scheduled' : 'Nothing released'}</div>`,
    ctx: { team: 'ops', title: 'ShipBob · KeHE PO 1042', chips: opsChips() },
  };
}

// ---------- SPS Commerce ----------
function sps() {
  const o = S.ops;
  return {
    html: `${appHead('sps', 'the 856 ship notice for KeHE')}
    <div class="panelish">
    ${
      o.asn
        ? `<div class="crumbs">Fulfillment › Drafts · Trading partner: KeHE</div>
      <div class="asn"><div class="asn-h"><b>856 · Advance Ship Notice</b><span class="st sent">${o.stage === 'done' ? 'Sent' : 'Draft · ready for your review'}</span></div>
      <div class="asn-g"><div><small>Purchase order</small><b>KeHE PO 1042</b></div><div><small>Ship from</small><b>East + West warehouses</b></div><div><small>Cases</small><b>120 (90 + 30)</b></div><div><small>Pallets / SSCC labels</small><b>6 pallets · 120 cartons</b></div></div>
      <div class="note-box good">Built from the 3PL packing list<br><span>Quantities match the PO. ${o.stage === 'done' ? 'Sent to KeHE.' : 'Pickup still pending.'}</span></div></div>`
        : `<div class="empty">No ASN drafts. Cleared builds one from the 3PL packing list once the order is packed.</div>`
    }</div>
    <div class="app-foot ${o.asn ? 'good' : ''}">${o.asn ? (o.stage === 'done' ? 'ASN sent to KeHE' : 'ASN prepared in SPS Commerce · not sent until pickup is confirmed') : 'No drafts'}</div>`,
    ctx: { team: 'ops', title: 'SPS Commerce · ASN for PO 1042', chips: opsChips() },
  };
}

// ---------- QuickBooks ----------
function quickbooks() {
  const q = S.queue;
  const n = S.sel.quickbooks;
  if (n) {
    const d = S.invoices[n];
    if (!d) {
      api(`/api/invoice/${n}`).then((x) => {
        S.invoices[n] = x;
        if (S.app === 'quickbooks' && S.sel.quickbooks === n) renderApp();
      });
    }
    const row = q?.rows.find((r) => r.n === n);
    const inv = d?.invoice;
    return {
      html: `${appHead('quickbooks', `invoice ${n}`)}
      <div class="qb">
        <button class="back" data-qb="">‹ All invoices</button>
        ${
          inv
            ? `<div class="qb-inv"><div class="qb-row"><h3>Invoice ${esc(n)}</h3><span class="pill">${esc(inv.status)}</span></div>
        <div class="meta4"><div><small>Customer</small><b>${esc(inv.customer)}</b></div><div><small>Invoice date</small><b>${d8(inv.txnDate)}</b></div><div><small>Due</small><b>${d8(inv.dueDate)}</b></div><div><small>PO</small><b>${esc(inv.poNumber || '—')}</b></div></div>
        <table class="lines"><thead><tr><th>Product / service</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${inv.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="r">${l.qty}</td><td class="r">${money(l.rate)}</td><td class="r">${money(l.amount)}</td></tr>`).join('')}</tbody></table>
        <div class="total">Total <b>${money(inv.total)}</b></div>
        <div class="qb-pay">${d.payments.payments.map((p) => `<div class="r"><span>Payment ${esc(p.reference || '')} · ${d8(p.date)}</span><span>−${money(p.applied)}</span></div>`).join('')}<div class="r bal"><span>Balance due</span><span>${money(inv.balance)}</span></div></div>
        ${inv.privateNote ? `<div class="note-box"><b>Private note</b><br><span>${esc(inv.privateNote)}</span></div>` : ''}</div>`
            : `<div class="empty">Loading invoice ${esc(n)} from QuickBooks…</div>`
        }
      </div>
      <div class="app-foot">The original invoice stays the record of what was billed</div>`,
      ctx: { team: 'finance', title: `QuickBooks · Invoice ${n}${row ? ` · ${row.customer}` : ''}`, chips: [{ label: 'Why were we short-paid, and what do we need to resolve it?', flow: 'financeCase', arg: n }] },
    };
  }
  const t = q?.totals;
  return {
    html: `${appHead('quickbooks', 'open invoices with deductions')}
    <div class="qb">
      ${t ? `<div class="kpis">${[['Withheld', money(t.withheld), `${q.rows.length} deductions`], ['To review', money(t.open), 'open'], ['In dispute', money(t.inDispute), 'waiting on replies'], ['Recovered', money(t.recovered), t.accepted ? `${money(t.accepted)} accepted` : 'reversed', 'good'], ['Next deadline', t.nextDeadline ? `${t.nextDeadline.daysLeft} days` : '—', t.nextDeadline ? `${t.nextDeadline.payer} · ${t.nextDeadline.label}` : 'nothing open', t.nextDeadline && t.nextDeadline.daysLeft <= 10 ? 'warn' : '']].map(([a, b, c, cls]) => `<div class="kpi ${cls || ''}"><small>${a}</small><b>${b}</b><span>${c}</span></div>`).join('')}</div>` : ''}
      <table class="lines inv-list"><thead><tr><th>Invoice</th><th>Customer</th><th>Deduction</th><th class="r">Withheld</th><th>Status</th></tr></thead><tbody>
      ${(q?.rows || []).map((r) => `<tr data-qb="${r.n}" class="clicky"><td><b>${r.n}</b></td><td>${esc(r.customer)}</td><td>${esc(r.code)} · ${esc(r.reason)}</td><td class="r">${money(r.amount)}</td><td>${statusPill(r)}</td></tr>`).join('')}
      </tbody></table>
    </div>
    <div class="app-foot">Partially paid invoices · balances match the payment advices</div>`,
    ctx: { team: 'finance', title: 'QuickBooks · Invoices', chips: [{ label: 'Which short-pays need attention?', flow: 'financeQueue' }] },
  };
}
export function statusPill(r) {
  if (r.status === 'new') return `<span class="pill">Partially paid</span>`;
  if (r.status === 'ready') return `<span class="pill dark">${{ request_evidence: 'Ask for backup', dispute: r.recover && r.recover < r.amount ? `Dispute ${money(r.recover)}` : 'Dispute', valid: 'Accept', paid_in_full: 'Paid' }[r.verdict] || 'Ready'}</span>`;
  if (r.status === 'waiting') return `<span class="pill warn">Waiting on ${esc(r.customer)}</span>`;
  if (r.status === 'resolved') return `<span class="pill good">Recovered</span>`;
  if (r.status === 'accepted') return `<span class="pill">Accepted</span>`;
  return `<span class="pill">${esc(r.status)}</span>`;
}

// ---------- OneDrive ----------
function onedrive() {
  const sel = S.sel.onedrive;
  const nav = `<nav class="od-nav"><button data-od="assets" class="${sel === 'assets' ? 'sel' : ''}">Brand assets</button><button data-od="packets" class="${sel.startsWith('packet') ? 'sel' : ''}">Cleared Demo · invoice packets</button></nav>`;
  if (sel === 'assets') {
    const g = S.growth;
    const st = (a) => (a.name === 'Retail_Broker_Kit.pdf' ? (g.kit === 'v3' ? 'Uses v3' : 'Uses v2') : a.version === 'v2' ? (g.kit === 'v3' ? 'Replaced' : 'In broker kit') : 'Approved');
    return {
      html: `${appHead('onedrive', 'approved brand assets')}<div class="od">${nav}
      <div class="od-grid">${ASSETS.map((a) => `<button class="od-tile" data-asset="${a.name}"><span class="thumb">${a.kind === 'image' ? productSvg(a.version) : kitThumb(g.kit)}</span><b>${esc(a.name)}</b><span class="pill ${st(a) === 'Approved' || st(a) === 'Uses v3' ? 'good' : st(a) === 'Uses v2' ? 'warn' : ''}">${st(a)}</span></button>`).join('')}</div></div>
      <div class="app-foot ${g.kit === 'v3' ? 'good' : 'warn'}">${g.kit === 'v3' ? 'Broker kit updated to the approved image (v3)' : 'The broker kit still uses the v2 image'}</div>`,
      ctx: { team: 'growth', title: 'OneDrive · Brand assets', chips: growthChips() },
    };
  }
  const m = sel.match(/^packet:(\d+)$/);
  if (m) {
    const n = m[1];
    const p = S.packets[n];
    if (!p) {
      api(`/api/packet/${n}`).then((x) => {
        S.packets[n] = x;
        if (S.app === 'onedrive' && S.sel.onedrive === sel) renderApp();
      });
    }
    return {
      html: `${appHead('onedrive', `the Invoice ${n} packet`)}<div class="od">${nav}
      <div class="od-files"><button class="back" data-od="packets">‹ All packets</button>
      ${p ? p.files.map((f) => `<button class="od-file" data-file="${esc(f.name)}" data-n="${n}"><span class="pdf"></span><b>${esc(f.name)}</b><span class="open">Preview</span></button>`).join('') : '<div class="empty">Loading…</div>'}</div></div>
      <div class="app-foot">${p ? `${p.files.length} files · ${esc(p.folder)}` : ''}</div>`,
      ctx: { team: 'finance', title: `OneDrive · Invoice ${n} packet`, chips: [{ label: `Why were we short-paid on Invoice ${n}?`, flow: 'financeCase', arg: n }] },
    };
  }
  return {
    html: `${appHead('onedrive', 'invoice packets: invoices, PODs, agreements')}<div class="od">${nav}
    <div class="od-files">${(S.queue?.rows || []).map((r) => `<button class="od-file folder" data-od="packet:${r.n}"><span class="fold"></span><b>Invoice ${r.n} packet</b><span class="open">${esc(r.customer)}</span></button>`).join('')}</div></div>
    <div class="app-foot">One folder per invoice</div>`,
    ctx: { team: 'finance', title: 'OneDrive · Invoice packets', chips: [{ label: 'Which short-pays need attention?', flow: 'financeQueue' }] },
  };
}
const kitThumb = (v) => `<svg viewBox="0 0 120 150" xmlns="http://www.w3.org/2000/svg"><rect x="18" y="10" width="84" height="130" rx="4" fill="#fff" stroke="#00000022"/><rect x="28" y="22" width="64" height="8" fill="#dbe5d7"/><g transform="translate(38 38) scale(0.38)">${productSvg(v).replace(/<\/?svg[^>]*>/g, '')}</g><rect x="28" y="106" width="64" height="5" fill="#dbe5d7"/><rect x="28" y="116" width="44" height="5" fill="#dbe5d7"/></svg>`;

// ---------- chips per teammate state ----------
export function opsChips() {
  const st = S.ops.stage;
  if (st === 'new') return [{ label: "What's blocking PO 1042?", flow: 'opsPlan' }, { label: 'Can this order ship by Friday?', flow: 'opsPlan' }];
  if (st === 'planned') return [{ label: 'Show me the ship plan again', flow: 'opsPlan' }];
  if (st === 'paused') return [{ label: 'Review the new freight quote', flow: 'opsResume' }];
  return [{ label: 'Where is PO 1042 now?', flow: 'opsStatus' }, ...nextChips('ops')];
}
export function growthChips() {
  const st = S.growth.stage;
  if (st === 'new') return [{ label: "Is Friday's retail launch actually ready?", flow: 'growthCheck' }];
  if (st === 'sent') return [{ label: 'Any replies from the stores?', flow: 'growthReplies' }];
  return [{ label: 'Where does the launch stand?', flow: 'growthStatus' }, ...nextChips('growth')];
}
export function nextChips(team) {
  if (team === 'ops') return S.growth.stage === 'new' ? [{ label: "Next: Friday's retail launch →", flow: 'goGrowth' }] : [];
  if (team === 'growth') return [{ label: "Next: UNFI's $240 short-pay →", flow: 'financeCase', arg: '2086' }];
  return [];
}

// ---------- render ----------
const RENDER = { outlook, excel, cin7, shipbob, sps, quickbooks, onedrive };
let lastCtx = null;
export function renderApp() {
  const out = RENDER[S.app]();
  $('#appBody').innerHTML = out.html;
  lastCtx = out.ctx;
  $$('.dock button').forEach((b) => b.classList.toggle('sel', b.dataset.app === S.app));
  persist();
  return out.ctx;
}
export const currentContext = () => lastCtx;

// Clicks inside apps change the selection (and so the context).
export function bindAppEvents() {
  $('#appBody').addEventListener('click', (e) => {
    const t = e.target;
    const mail = t.closest('[data-mail]');
    if (mail) return setApp('outlook', { outlook: mail.dataset.mail });
    const folder = t.closest('[data-folder]');
    if (folder) return setApp('outlook', { outlookFolder: folder.dataset.folder, outlook: null });
    const book = t.closest('[data-book]');
    if (book) return setApp('excel', { excel: book.dataset.book });
    const qb = t.closest('[data-qb]');
    if (qb) return setApp('quickbooks', { quickbooks: qb.dataset.qb || null });
    const od = t.closest('[data-od]');
    if (od) return setApp('onedrive', { onedrive: od.dataset.od });
    const asset = t.closest('[data-asset]');
    if (asset) {
      const a = ASSETS.find((x) => x.name === asset.dataset.asset);
      return openDoc({ title: a.name, eyebrowHtml: `${logo('onedrive')} OneDrive · Brand assets`, html: `<div class="asset-prev">${a.kind === 'image' ? productSvg(a.version) : kitThumb(S.growth.kit)}</div>` });
    }
    const file = t.closest('[data-file]');
    if (file) {
      const n = file.dataset.n;
      const doc = S.cases[n]?.evidence?.docs.find((d) => d.name === file.dataset.file);
      return openDoc({ title: file.dataset.file, eyebrowHtml: `${logo('onedrive')} OneDrive · Invoice ${n} packet`, url: `/api/case/${n}/file/${encodeURIComponent(file.dataset.file)}`, read: doc?.read, reader: doc?.reader });
    }
    const att = t.closest('[data-attach]');
    if (att) {
      const name = att.dataset.attach;
      if (/\.pdf$/i.test(name) && att.dataset.payer) {
        const lines = (S.queue?.rows || []).filter((r) => r.customer === att.dataset.payer).map((r) => ({ invoice_number: r.n, deduction_code: r.code, deduction_ref: r.ref, reason: r.reason, cases: r.cases, deducted: r.amount }));
        return openDoc({ title: name, eyebrowHtml: `${logo('outlook')} Outlook attachment`, url: `/api/remit/${encodeURIComponent(name)}`, lines });
      }
      return openDoc({ title: name, eyebrowHtml: `${logo('outlook')} Outlook attachment`, html: `<div class="asset-prev">${kitThumb(S.growth.kit)}</div>` });
    }
  });
}
