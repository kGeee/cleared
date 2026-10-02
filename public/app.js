// Cleared · interactive Finance workspace
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const moneyExact = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const d8 = (iso) => (iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '—');
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');
const dur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

const APPS = {
  quickbooks: { name: 'QuickBooks', mark: 'qb' },
  outlook: { name: 'Outlook', mark: 'O' },
  onedrive: { name: 'OneDrive', mark: '☁' },
};
const logo = (app, lg) => `<span class="applogo ${app}${lg ? ' lg' : ''}">${app === 'cleared' ? '✓' : APPS[app]?.mark || ''}</span>`;
const PLAN = [
  { step: 'reconcile', app: 'quickbooks', text: 'Check what was billed and paid in QuickBooks' },
  { step: 'remittance', app: 'outlook', text: "Read UNFI's payment advice in Outlook" },
  { step: 'evidence', app: 'onedrive', text: 'Read the invoice, manifest and POD in OneDrive' },
  { step: 'decide', app: null, text: 'Decide what the evidence supports' },
];

const S = { status: null, queue: null, selected: null, filter: 'all', busy: new Set(), choice: {}, drafts: {}, timer: null };

// ---------- helpers ----------
async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || res.statusText), { status: res.status });
  return json;
}
function toast(text, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = text;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3600);
}
function setWorking(app, text) {
  $('#workingIn').textContent = text || (app ? `Working in ${APPS[app].name}` : 'Ready');
  $$('.chip').forEach((c) => c.classList.toggle('active', c.dataset.app === app));
}

// ---------- status & connections ----------
async function loadStatus() {
  S.status = await api('/api/status');
  const live = S.status.mode === 'live';
  $('#modeBadge').className = 'badge ' + (live ? 'live' : 'offline');
  $('#modeBadge').textContent = live ? 'Live · QuickBooks ' + (S.status.connections.quickbooks.environment || '') + ' + Microsoft 365' : 'Offline rehearsal · demo data, nothing is sent';
  $('#aiBadge').textContent = S.status.ai ? `Claude (${S.status.model}) reads documents and drafts emails` : 'AI off: built-in parser and templates (add ANTHROPIC_API_KEY)';
  const c = S.status.connections;
  const on = { quickbooks: c.quickbooks.connected, outlook: c.microsoft.connected, onedrive: c.microsoft.connected };
  $('#chips').innerHTML = Object.keys(APPS).map((a) => `<span class="chip ${on[a] ? '' : 'off'}" data-app="${a}">${logo(a)}${APPS[a].name}</span>`).join('');
  renderConnect();
  const ok = c.quickbooks.connected && c.microsoft.connected;
  $('#connect').hidden = ok;
  return ok;
}

function renderConnect() {
  const c = S.status.connections;
  const row = (key, title, who, perms, connected) => `
    <div class="cx">
      <div class="cx-top">
        ${key === 'quickbooks' ? logo('quickbooks', true) : `<span style="display:flex;gap:4px">${logo('outlook', true)}${logo('onedrive', true)}</span>`}
        <div><b>${title}</b><div class="who">${esc(who || '')}</div></div>
        <div class="act">${connected ? `<span class="connected">Connected ✓ <button class="link" data-disconnect="${key}">Disconnect</button></span>` : `<a class="cbtn" href="/auth/${key}">Connect</a>`}</div>
      </div>
      <ul>${perms.map((p) => `<li>${p[0]}${p[1] ? `<em>${p[1]}</em>` : ''}</li>`).join('')}</ul>
    </div>`;
  const ready = c.quickbooks.connected && c.microsoft.connected;
  $('#connectList').innerHTML =
    row('quickbooks', 'QuickBooks', c.quickbooks.connected ? c.quickbooks.company : 'Invoices and payments', [['Invoices and customers'], ['Payments and remittances'], ['Add notes to invoices', 'Only after you approve']], c.quickbooks.connected) +
    row('microsoft', 'Microsoft 365', c.microsoft.connected ? c.microsoft.email : 'Outlook + OneDrive, one sign-in', [['Read mail and attachments'], ['Read files in OneDrive'], ['Send mail', 'Only after you approve']], c.microsoft.connected) +
    (ready ? `<button class="btn wide" data-close-connect>Start working</button>` : `<div class="cx-note">${S.status.mode === 'live' ? "You approve access on each app's own sign-in screen. Disconnect anytime." : 'Offline rehearsal: Connect simulates sign-in. Set up .env for the real flow.'}</div>`);
}

// ---------- KPIs & queue ----------
let lastTotals = {};
function renderKpis() {
  const q = S.queue;
  if (!q?.totals) return ($('#kpis').innerHTML = '');
  const t = q.totals;
  const cnt = (f) => q.rows.filter(f).length;
  const dl = q.deadline;
  const tiles = [
    { k: 'withheld', label: `Withheld · check ${q.source.check}`, val: money(t.withheld), sub: `${q.rows.length} deductions from ${q.rows[0]?.customer || ''}` },
    { k: 'open', label: 'To review', val: money(t.open), sub: `${cnt((r) => ['new', 'ready'].includes(r.status))} open` },
    { k: 'inDispute', label: 'Waiting on UNFI', val: money(t.inDispute), sub: `${cnt((r) => r.status === 'waiting')} sent` },
    { k: 'recovered', label: 'Recovered', val: money(t.recovered), sub: t.accepted ? `${money(t.accepted)} accepted as valid` : 'Reversed deductions', cls: 'good' },
    { k: 'dl', label: 'Dispute window', val: dl ? `${dl.daysLeft} days` : '—', sub: dl ? `Closes ${dl.label}` : '', cls: dl && dl.daysLeft <= 10 ? 'warn' : '' },
  ];
  $('#kpis').innerHTML = tiles.map((x) => `<div class="kpi ${x.cls || ''} ${lastTotals[x.k] != null && lastTotals[x.k] !== t[x.k] ? 'bump' : ''}"><small>${esc(x.label)}</small><b>${esc(x.val)}</b><span>${esc(x.sub)}</span></div>`).join('');
  lastTotals = { ...t };
}

function rowPill(r) {
  if (S.busy.has(r.n)) return `<span class="pill">Checking</span>`;
  if (r.status === 'new') return `<span class="pill new">New</span>`;
  if (r.status === 'ready') {
    const next = { request_evidence: 'Next: ask for proof', dispute: 'Next: dispute', valid: 'Next: accept', paid_in_full: 'Paid' }[r.verdict] || 'Ready';
    return `<span class="pill dark">${next}</span>`;
  }
  if (r.status === 'waiting') return `<span class="pill warn">Waiting on ${esc(r.customer)}</span>`;
  if (r.status === 'resolved') return `<span class="pill good">Recovered</span>`;
  if (r.status === 'accepted') return `<span class="pill">Accepted</span>`;
  return `<span class="pill">${esc(r.status)}</span>`;
}

const FILTERS = { all: () => true, review: (r) => ['new', 'ready'].includes(r.status), waiting: (r) => r.status === 'waiting', closed: (r) => ['resolved', 'accepted'].includes(r.status) };
function renderQueue() {
  const q = S.queue;
  if (!q) return;
  $('#srcLink').hidden = !q.source;
  if (q.source) $('#srcLink').textContent = `${q.rows[0]?.customer || ''} payment advice · check ${q.source.check} ↗`;
  $$('#filters button').forEach((b) => {
    const n = q.rows.filter(FILTERS[b.dataset.f]).length;
    b.innerHTML = `${{ all: 'All', review: 'To review', waiting: 'Waiting', closed: 'Closed' }[b.dataset.f]}<span class="n">${n}</span>`;
    b.classList.toggle('sel', b.dataset.f === S.filter);
  });
  const rows = q.rows.filter(FILTERS[S.filter]);
  $('#rows').innerHTML = rows.length
    ? rows
        .map(
          (r) => `<button class="row ${S.selected === r.n ? 'sel' : ''} ${S.busy.has(r.n) ? 'busy' : ''}" data-n="${r.n}">
        <b>Invoice ${esc(r.n)}</b><span class="amt ${r.status === 'accepted' ? 'struck' : ''}">${money(r.amount)}</span>
        <span class="sub">${esc(r.reason)} · ${r.cases} cases · ${esc(r.ref)}</span><span></span>
        ${rowPill(r)}
      </button>`,
        )
        .join('')
    : `<div class="empty">Nothing here.</div>`;
  $('#checkAll').disabled = !q.rows.some((r) => r.status === 'new') || S.busy.size > 0;
}

async function loadQueue() {
  try {
    S.queue = await api('/api/queue');
  } catch (e) {
    if (e.status === 409) return;
    toast(e.message, true);
    return;
  }
  renderKpis();
  renderQueue();
}

// ---------- workspace ----------
function blank() {
  clearInterval(S.timer);
  const first = S.queue?.rows.find((r) => ['new', 'ready'].includes(r.status)) || S.queue?.rows[0];
  $('#work').innerHTML = `<div class="blank"><div>
    <img src="/mascot.png" alt="" />
    <h2>Every short-pay disputed in time.</h2>
    <p>Pick a short-pay on the left. Cleared checks QuickBooks, the payment advice and the delivery paperwork, then shows you what the evidence supports.</p>
    ${first ? `<button class="btn" data-n="${first.n}">Start with Invoice ${esc(first.n)} · ${money(first.amount)}</button>` : ''}
  </div></div>`;
}

async function select(n) {
  S.selected = n;
  renderQueue();
  const row = S.queue?.rows.find((r) => r.n === n);
  if (!row) return toast(`Invoice ${n} isn't on this remittance.`, true);
  const c = await api(`/api/case/${n}`).catch(() => null);
  if (c && c.assessment) renderCase(c);
  else renderStart(row);
}

function headHtml(row, c) {
  const a = c?.assessment;
  const dl = S.queue?.deadline;
  const status = row.status === 'resolved' ? `<span class="pill good">Recovered</span>` : rowPill(row);
  return `<div class="case-head">
    <div>
      <div class="eyebrow">${esc(row.customer)} · ${esc(row.ref)} · ${esc(row.code || '')}</div>
      <h1>Invoice ${esc(row.n)}</h1>
      <div class="claim">${esc(row.reason)} claim · ${row.cases} cases${a ? ` · billed ${a.billedQty} cases at ${money(a.rate)}` : ''}</div>
    </div>
    <div class="right">
      <div class="big">${money(row.amount)}<small>${row.status === 'resolved' ? 'recovered' : row.status === 'accepted' ? 'written off' : 'withheld'}</small></div>
      <div class="metaline">${dl && !['resolved', 'accepted'].includes(row.status) ? `<span class="pill ${dl.daysLeft <= 10 ? 'warn' : ''}">⏳ ${dl.daysLeft} days to dispute</span>` : ''}${status}<span class="timer" id="caseTimer" hidden></span></div>
    </div>
  </div>`;
}

function renderStart(row) {
  clearInterval(S.timer);
  $('#work').innerHTML = `<div class="work-inner">${headHtml(row)}
    <div class="start">
      <h3>Investigate this short-pay</h3>
      <p>Cleared reads your records and the paperwork. Nothing is sent or changed.</p>
      <ol class="plan" id="plan">${PLAN.map((p, i) => `<li data-step="${p.step}"><span class="ix">${i + 1}</span>${p.app ? logo(p.app) : `<span class="applogo cleared">✓</span>`}${esc(p.text)}<span class="st">Waiting</span></li>`).join('')}</ol>
      <button class="btn wide" id="go" data-investigate="${row.n}">Investigate Invoice ${esc(row.n)}</button>
    </div></div>`;
}

async function investigate(n, { quick = false } = {}) {
  if (S.busy.has(n)) return;
  S.busy.add(n);
  renderQueue();
  const visible = () => S.selected === n && !quick;
  if (visible()) {
    const go = $('#go');
    if (go) {
      go.disabled = true;
      go.textContent = 'Investigating…';
    }
    startTimer(Date.now());
  }
  try {
    const res = await fetch(`/api/case/${n}/investigate${quick ? '?quick=1' : ''}`, { method: 'POST' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let final = null;
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
        if (ev.type === 'case') final = ev.case;
        if (ev.type === 'step' && visible()) {
          const li = $(`#plan li[data-step="${ev.step}"]`);
          if (li) {
            li.className = ev.state;
            $('.st', li).textContent = ev.state === 'running' ? ev.label || 'Working' : summarize(ev.step, ev.data);
          }
          setWorking(ev.state === 'running' ? ev.app : null, ev.state === 'running' && !ev.app ? 'Thinking' : null);
        }
      }
    }
    S.busy.delete(n);
    setWorking(null);
    await loadQueue();
    if (final && S.selected === n) {
      if (visible()) await new Promise((r) => setTimeout(r, 450));
      renderCase(final);
    }
  } catch (e) {
    S.busy.delete(n);
    setWorking(null);
    renderQueue();
    toast(e.message, true);
    const go = $('#go');
    if (go) {
      go.disabled = false;
      go.textContent = 'Try again';
    }
  }
}

function summarize(step, d) {
  if (!d) return 'Done';
  if (step === 'reconcile') return `${money(d.billed)} billed · ${money(d.paid)} paid`;
  if (step === 'remittance') return d.line ? `${d.line.reason}: ${d.line.cases} cases` : 'Found';
  if (step === 'evidence') return `${d.docs.length} documents read`;
  if (step === 'decide') return d.assessment.headline;
  return 'Done';
}

function startTimer(t0, frozen) {
  clearInterval(S.timer);
  const el = $('#caseTimer');
  if (!el) return;
  el.hidden = false;
  if (frozen != null) {
    el.className = 'timer';
    el.textContent = `⏱ ${dur(frozen)} to approval`;
    return;
  }
  el.className = 'timer run';
  const tick = () => (el.textContent = `⏱ ${dur((Date.now() - t0) / 1000)}`);
  tick();
  S.timer = setInterval(tick, 500);
}

function renderCase(c) {
  const row = S.queue.rows.find((r) => r.n === c.n) || { n: c.n, customer: c.customer, ref: c.assessment.deductionRef, code: c.assessment.deductionCode, reason: c.assessment.deductionReason, cases: c.assessment.claimedCases, amount: c.assessment.claimedAmount, status: c.status };
  const a = c.assessment;
  const r = c.reconcile;
  const rm = c.remittance;
  const ev = c.evidence;
  const t = ev.trail;
  const closed = ['waiting', 'resolved', 'accepted'].includes(c.status);
  const podUnknown = t.accepted === null;
  const steps = [
    { id: 's1', label: 'Billed vs. paid', st: 'done' },
    { id: 's2', label: `${row.customer}'s claim`, st: 'done' },
    { id: 's3', label: 'Paper trail', st: podUnknown ? 'warn' : 'done' },
    { id: 's4', label: closed ? (c.status === 'waiting' ? 'Waiting on reply' : 'Closed') : 'Decide & act', st: closed ? (c.status === 'waiting' ? 'warn' : 'done') : 'todo' },
  ];
  const paidPct = Math.max(0, Math.min(100, (r.paid / r.billed) * 100));
  const docs = ev.docs;
  const docFlag = (d) => {
    const f = d.fields || {};
    if (d.kind === 'invoice') return { t: `${money(f.total ?? r.billed)} · ${t.billed} cases`, w: false };
    if (d.kind === 'manifest') return { t: `${f.cases_shipped ?? '?'} cases shipped`, w: f.cases_shipped !== t.billed };
    if (d.kind === 'pod') return f.accepted_count == null ? { t: 'Accepted count not shown', w: true } : { t: `${f.accepted_count} accepted${f.exceptions ? ' · exception noted' : ''}`, w: false };
    return { t: '', w: false };
  };
  const trailNote = podUnknown
    ? `The POD was signed by ${esc(t.receivedBy || 'the DC')} but nobody wrote down how many cases were accepted. ${esc(row.customer)} paid for ${t.paidFor}, so ${t.claimedShort} cases are unaccounted for.`
    : t.accepted >= t.billed
      ? `All ${t.accepted} cases were accepted at the dock. Nothing supports the ${t.claimedShort}-case shortage.`
      : `${t.billed - t.accepted} cases were refused at the dock${t.exceptions ? ` (“${esc(t.exceptions)}”)` : ''}. That matches the ${t.claimedShort}-case deduction.`;

  $('#work').innerHTML = `<div class="work-inner">
    ${headHtml(row, c)}
    <nav class="stepper">${steps.map((s, i) => `<button data-jumpto="${s.id}" class="${s.st}"><span class="dot">${s.st === 'done' ? '✓' : s.st === 'warn' ? '!' : i + 1}</span><span>${esc(s.label)}</span></button>`).join('')}</nav>

    <section class="sec" id="s1">
      <div class="sec-head"><span class="num">1</span><h3>Billed vs. paid</h3><span class="src">${logo('quickbooks')}QuickBooks · Invoice ${esc(r.invoice.docNumber)}</span></div>
      <div class="bar"><div class="paid" id="paidBar">Paid ${money(r.paid)}</div><div class="gap">${money(r.gap)} short</div></div>
      <div class="bar-legend">
        <div>Billed<b>${money(r.billed)}</b></div>
        <div>Paid<b>${money(r.paid)}</b></div>
        <div class="g">Unresolved<b>${money(r.gap)}</b></div>
      </div>
      <div class="facts">
        <span>Invoice date <b>${d8(r.invoice.txnDate)}</b></span>
        <span>Due <b>${d8(r.invoice.dueDate)}</b></span>
        <span>PO <b>${esc(r.invoice.poNumber || '—')}</b></span>
        ${r.payments.payments.map((p) => `<span>Payment <b>check ${esc(p.reference || '')} · ${d8(p.date)} · ${money(p.applied)}</b></span>`).join('')}
      </div>
    </section>

    <section class="sec" id="s2">
      <div class="sec-head"><span class="num">2</span><h3>What ${esc(row.customer)} says</h3><button class="src" data-doc="remittance">${logo('outlook')}Payment advice · check ${esc(rm.check)} ↗</button></div>
      ${
        rm.line
          ? `<div class="claimbox">
          <div class="code">${esc(rm.line.deduction_code || '')}<small>${esc(rm.line.deduction_ref || '')}</small></div>
          <div><div class="what">${esc(rm.line.reason)}: ${rm.line.cases} cases</div>
          <div class="math">${rm.line.cases} cases × ${money(r.rate)} = ${money(rm.line.deducted)} deducted</div></div>
          <span class="check ${rm.matchesGap ? '' : 'no'}">${rm.matchesGap ? `✓ Explains the ${money(r.gap)} gap` : '⚠ Does not match the gap'}</span>
        </div>`
          : `<div class="err">No deduction line for this invoice on the payment advice.</div>`
      }
    </section>

    <section class="sec" id="s3">
      <div class="sec-head"><span class="num">3</span><h3>What the paperwork shows</h3><span class="src">${logo('onedrive')}${esc(ev.folder.split('/').pop())}</span></div>
      <div class="trail">
        <div class="node"><small>Billed</small><b>${t.billed}</b><span>cases on the invoice</span></div><div class="arrow">→</div>
        <div class="node ${t.shipped !== t.billed ? 'unknown' : ''}"><small>Shipped</small><b>${t.shipped ?? '?'}</b><span>cases on the manifest</span></div><div class="arrow">→</div>
        <div class="node ${podUnknown ? 'unknown' : t.accepted < t.billed ? 'short' : ''}"><small>Accepted</small><b>${podUnknown ? '?' : t.accepted}</b><span>${podUnknown ? 'not written on the POD' : t.accepted < t.billed ? `${t.billed - t.accepted} refused at dock` : 'signed for at the DC'}</span></div><div class="arrow">→</div>
        <div class="node paid"><small>Paid for</small><b>${t.paidFor}</b><span>per ${esc(row.customer)}'s remittance</span></div>
      </div>
      <div class="trail-note">${trailNote}</div>
      <div class="docs">${docs
        .map((d) => {
          const f = docFlag(d);
          return `<button class="doc" data-doc="${d.kind}"><span class="pdf"></span><span><b>${esc(d.label)}</b><span class="k">${esc(d.name)}</span><span class="flag ${f.w ? 'warn' : ''}">${f.w ? '⚠ ' : '✓ '}${esc(f.t)}</span></span><span class="open">View</span></button>`;
        })
        .join('')}</div>
    </section>

    <section class="sec" id="s4">${closed ? outcomeHtml(c, row) : decideHtml(c, row)}</section>

    <section class="sec" id="s5">
      <div class="sec-head"><h3>Activity</h3><span class="src">${esc(S.status.approver)} + Cleared</span></div>
      <ul class="activity">${(c.history || []).slice().reverse().map((h) => `<li><time>${clock(h.at)}</time><span class="${h.kind === 'good' ? 'good' : ''}">${esc(h.text)}</span></li>`).join('')}</ul>
    </section>
  </div>`;

  requestAnimationFrame(() => requestAnimationFrame(() => ($('#paidBar').style.width = paidPct + '%')));
  window.__case = c;
  if (c.approval) startTimer(null, c.approval.elapsed);
  else startTimer(c.startedAt);
  if (!closed) {
    const pick = S.choice[c.n] || c.options.find((o) => o.strength === 'recommended')?.id;
    if (pick) choose(c, pick, { scroll: false });
  }
}

function decideHtml(c, row) {
  const a = c.assessment;
  const good = a.verdict === 'valid';
  return `<div class="sec-head"><span class="num">4</span><h3>What should we do?</h3><span class="src">${logo('cleared')}Cleared's read</span></div>
    <div class="verdict ${good ? 'good' : ''}"><span class="ic">${good ? '✅' : '⚠️'}</span><div><h4>${esc(a.headline)}</h4><p>${esc(a.detail)}</p></div></div>
    <div class="options">${c.options
      .map(
        (o) => `<button class="opt" data-opt="${o.id}">
        <span class="radio"></span>
        ${o.strength === 'recommended' ? `<span class="pill dark">Recommended</span>` : o.strength === 'possible' ? `<span class="pill">Possible</span>` : `<span class="pill">Not advised</span>`}
        <b>${esc(o.title)}</b><span class="d">${esc(o.desc)}</span><span class="w">${esc(o.why)}</span>
      </button>`,
      )
      .join('')}</div>
    <div id="actArea"></div>`;
}

async function choose(c, action, { scroll = true } = {}) {
  S.choice[c.n] = action;
  $$('.opt').forEach((o) => o.classList.toggle('sel', o.dataset.opt === action));
  const area = $('#actArea');
  if (!area) return;
  const key = `${c.n}:${action}`;
  let d = S.drafts[key];
  if (!d) {
    area.innerHTML = `<div class="compose"><div class="compose-head">${S.status.ai ? 'Claude is drafting…' : 'Drafting…'}</div></div>`;
    try {
      d = S.drafts[key] = await api(`/api/case/${c.n}/draft`, { method: 'POST', body: { action } });
    } catch (e) {
      area.innerHTML = `<div class="err">${esc(e.message)}</div>`;
      return;
    }
    if (S.choice[c.n] !== action) return;
  }
  if (action === 'accept') {
    area.innerHTML = `<div class="qbnote"><div class="eyebrow">${logo('quickbooks')} Note for the QuickBooks invoice</div>
      <div class="n">${esc(d.note)}</div>
      <div class="actions-row"><button class="btn" id="approveBtn">Approve: accept ${money(d.amount)} and close</button><span class="cx-note" style="align-self:center">Nothing is sent to ${esc(c.customer)}.</span></div></div>`;
  } else {
    area.innerHTML = `<div class="compose">
      <div class="compose-head">${logo('outlook')} <b>${action === 'dispute' ? 'Dispute' : 'Evidence request'}</b> · from your Outlook<span class="writer">${d.writer === 'claude' ? '✦ Drafted by Claude' : 'Drafted from the evidence'}</span></div>
      <div class="field"><label>To</label><span>${esc(d.to)}</span></div>
      <div class="field"><label>Subject</label><input id="cSubject" value="${esc(d.subject)}" /></div>
      <textarea id="cBody" rows="10">${esc(d.body)}</textarea>
      <div class="atts"><span>Attach</span>${d.attachments
        .map((x) => `<span class="att ${x.checked ? '' : 'off'}" data-att="${esc(x.name)}"><button class="tog" data-toggle-att="${esc(x.name)}">${esc(x.label)}</button><button class="eye" data-doc-name="${esc(x.name)}" title="Preview">👁</button></span>`)
        .join('')}</div>
      <div class="compose-foot"><span class="note">Nothing is sent until you approve. Edit anything above.</span><button class="btn" id="approveBtn">Approve &amp; send</button></div>
    </div>`;
  }
  if (scroll) area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function outcomeHtml(c, row) {
  const s = c.sent;
  const live = S.status.mode === 'live';
  if (c.status === 'accepted') {
    return `<div class="sec-head"><span class="num">4</span><h3>Closed</h3><span class="src">${logo('quickbooks')}Noted in QuickBooks</span></div>
      <div class="verdict good"><span class="ic">✅</span><div><h4>Deduction accepted.</h4><p>${esc(c.assessment.detail)} ${c.approval?.noted ? 'A note was added to the QuickBooks invoice.' : ''}</p></div></div>
      <div class="cx-note">Approved by ${esc(c.approval?.by)} at ${clock(c.approval?.at)} · ${dur(c.approval?.elapsed || 0)} from opening the case.</div>`;
  }
  const replied = !!c.reply;
  const won = c.status === 'resolved';
  const steps = [
    { t: 'Investigated', s: `QuickBooks, payment advice and ${c.evidence.docs.length} documents checked`, st: 'done' },
    { t: `Approved by ${c.approval?.by}`, s: `${clock(c.approval?.at)} · ${dur(c.approval?.elapsed || 0)} from opening the case`, st: 'done' },
    { t: `Sent to ${s.to}`, s: `${s.attachments.length} attachments${c.approval?.noted ? ' · note added in QuickBooks' : ''}`, st: 'done' },
    { t: replied ? `${c.customer} replied` : `Waiting on ${c.customer}`, s: replied ? clock(c.reply.at) : 'Cleared watches the inbox for the reply', st: replied ? 'done' : 'wait' },
    { t: won ? `${money(c.outcome.amount)} recovered` : 'Credit on the next remittance', s: won ? 'Deduction reversed' : 'Then the case closes itself', st: won ? 'done' : 'todo' },
  ];
  return `<div class="sec-head"><span class="num">4</span><h3>${won ? 'Resolved' : 'Follow-up'}</h3><span class="src">${logo('outlook')}Outlook</span></div>
    ${won ? `<div class="win"><img src="/mascot.png" alt=""><div><b>${money(c.outcome.amount)} recovered</b><br><span>${esc(c.customer)} reversed ${esc(c.assessment.deductionRef)}. It'll show on the next remittance.</span></div></div>` : ''}
    <div class="outcome">
      <ol class="track">${steps.map((x) => `<li class="${x.st}"><i>${x.st === 'done' ? '✓' : ''}</i><b>${esc(x.t)}</b><span>${esc(x.s)}</span></li>`).join('')}</ol>
      <div>
        <div class="sentcard"><div class="s">${esc(s.subject)}</div><div class="t">To ${esc(s.to)} · ${clock(s.at)}${live ? '' : ' · rehearsal, not actually sent'}</div><pre>${esc(s.body)}</pre></div>
        ${replied ? `<div class="reply ${c.reply.kind === 'reversed' ? '' : c.reply.kind === 'denied' ? 'bad' : 'neutral'}"><small>${esc(c.reply.from)} · ${clock(c.reply.at)}${c.reply.simulated ? ' · simulated' : ''}</small>${esc(c.reply.text)}</div>` : ''}
        <div class="actions-row">
          ${!won ? (live ? `<button class="btn secondary" id="checkReplies">Check for replies</button>` : `<button class="btn secondary" id="simReply">Simulate ${esc(c.customer)}'s reply</button>`) : ''}
          ${s.webLink ? `<a class="ghost" href="${s.webLink}" target="_blank">Open in Outlook ↗</a>` : ''}
        </div>
      </div>
    </div>`;
}

async function approveCurrent() {
  const c = window.__case;
  const action = S.choice[c.n];
  const btn = $('#approveBtn');
  btn.disabled = true;
  btn.textContent = action === 'accept' ? 'Closing…' : 'Sending…';
  setWorking(action === 'accept' ? 'quickbooks' : 'outlook');
  try {
    const body = action === 'accept' ? { action } : { action, subject: $('#cSubject').value, body: $('#cBody').value, attachments: $$('.att:not(.off)').map((x) => x.dataset.att) };
    const updated = await api(`/api/case/${c.n}/approve`, { method: 'POST', body });
    await loadQueue();
    renderCase(updated);
    $('#s4').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(action === 'accept' ? `Accepted ${money(updated.outcome.amount)} · noted in QuickBooks` : `Sent to ${updated.sent.to} with ${updated.sent.attachments.length} attachments`);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Try again';
    toast(e.message, true);
  } finally {
    setWorking(null);
  }
}

async function replyAction(kind) {
  const c = window.__case;
  const btn = $(kind === 'sim' ? '#simReply' : '#checkReplies');
  btn.disabled = true;
  btn.textContent = kind === 'sim' ? 'Waiting for reply…' : 'Checking Outlook…';
  setWorking('outlook');
  try {
    const out = await api(`/api/case/${c.n}/${kind === 'sim' ? 'simulate-reply' : 'replies'}`, { method: 'POST' });
    if (!out.found) {
      toast(`No reply from ${c.customer} yet.`);
      btn.disabled = false;
      btn.textContent = 'Check for replies';
      return;
    }
    await loadQueue();
    renderCase(out.case);
    $('#s4').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (out.case.status === 'resolved') toast(`${money(out.case.outcome.amount)} recovered on Invoice ${c.n}`);
  } catch (e) {
    toast(e.message, true);
    btn.disabled = false;
  } finally {
    setWorking(null);
  }
}

// ---------- document drawer ----------
const FIELDS = {
  invoice: [['invoice_number', 'Invoice #'], ['po_number', 'PO'], ['total', 'Total', money]],
  manifest: [['cases_shipped', 'Cases shipped'], ['po_number', 'PO']],
  pod: [['cases_on_manifest', 'Cases on manifest'], ['accepted_count', 'Accepted count', null, 'Not shown on this POD'], ['received_by', 'Received by'], ['exceptions', 'Exceptions', null, 'None noted']],
};
function openDoc(doc, highlightInvoice) {
  $('#dEyebrow').innerHTML = `${doc.kind === 'remittance' ? logo('outlook') + ' Outlook attachment' : logo('onedrive') + ' OneDrive'}`;
  $('#dTitle').textContent = `${doc.label} · ${doc.name}`;
  $('#dOpen').href = doc.url;
  $('#dFrame').src = doc.url + '#toolbar=0&navpanes=0&view=FitH';
  const by = doc.reader === 'claude' ? '✦ Read by Claude' : doc.reader === 'cache' ? 'Read earlier this session' : 'Read by the built-in parser';
  let html = `<h4>What Cleared read</h4><div class="by">${by}</div>`;
  if (doc.kind === 'remittance') {
    const lines = doc.lines || [];
    html += `<table>${lines.map((l) => `<tr class="${String(l.invoice_number) === String(highlightInvoice) ? 'hl' : ''}"><td>${esc(l.invoice_number)}</td><td>${esc(l.deduction_ref || '')}<br>${esc(l.reason || '')}</td><td style="text-align:right">−${money(l.deducted)}</td></tr>`).join('')}</table>`;
  } else {
    html += `<dl>${(FIELDS[doc.kind] || [])
      .map(([k, label, fmt, missing]) => {
        const v = doc.fields?.[k];
        const empty = v == null || v === '';
        return `<dt>${label}</dt><dd class="${empty && k === 'accepted_count' ? 'missing' : ''}">${empty ? esc(missing || '—') : esc(fmt ? fmt(v) : v)}</dd>`;
      })
      .join('')}</dl>`;
  }
  $('#dRead').innerHTML = html;
  $('#drawer').hidden = false;
}
function closeDoc() {
  $('#drawer').hidden = true;
  $('#dFrame').src = 'about:blank';
}
function docFor(kind, name) {
  const c = window.__case;
  if (kind === 'remittance' || (name && c?.remittance.file.name === name)) {
    return { ...c.remittance.file, reader: c.remittance.reader, lines: S.remitLines || (c.remittance.line ? [c.remittance.line] : []) };
  }
  return c.evidence.docs.find((d) => (name ? d.name === name : d.kind === kind));
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const t = e.target;
  const row = t.closest('.row, .blank [data-n]');
  if (row) return select(row.dataset.n);
  const inv = t.closest('[data-investigate]');
  if (inv) return investigate(inv.dataset.investigate);
  const jump = t.closest('[data-jumpto]');
  if (jump) return $('#' + jump.dataset.jumpto)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const opt = t.closest('[data-opt]');
  if (opt) return choose(window.__case, opt.dataset.opt);
  const tog = t.closest('[data-toggle-att]');
  if (tog) return tog.parentElement.classList.toggle('off');
  const dn = t.closest('[data-doc-name]');
  if (dn) return openDoc(docFor(null, dn.dataset.docName), window.__case?.n);
  const doc = t.closest('[data-doc]');
  if (doc) return openDoc(docFor(doc.dataset.doc), window.__case?.n);
  if (t.closest('[data-close]')) return closeDoc();
  if (t.id === 'approveBtn') return approveCurrent();
  if (t.id === 'simReply') return replyAction('sim');
  if (t.id === 'checkReplies') return replyAction('check');
  const f = t.closest('#filters button');
  if (f) {
    S.filter = f.dataset.f;
    return renderQueue();
  }
  const d = t.closest('[data-disconnect]');
  if (d) {
    await api(`/auth/${d.dataset.disconnect}/disconnect`, { method: 'POST' });
    await loadStatus();
    $('#connect').hidden = false;
    return;
  }
  if (t.closest('[data-close-connect]')) {
    $('#connect').hidden = true;
    return boot2();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#drawer').hidden) closeDoc();
});
$('#srcLink').onclick = () => {
  const q = S.queue;
  openDoc({ kind: 'remittance', label: 'Payment advice', name: q.source.file.name, url: q.source.file.url, reader: null, lines: q.rows.map((r) => ({ invoice_number: r.n, deduction_ref: r.ref, reason: `${r.reason}: ${r.cases} cases`, deducted: r.amount })) }, S.selected);
};
$('#checkAll').onclick = async () => {
  const todo = S.queue.rows.filter((r) => r.status === 'new').map((r) => r.n);
  for (const n of todo) await investigate(n, { quick: S.selected !== n });
  toast(`Checked ${todo.length} short-pays`);
};
$('#jump').addEventListener('submit', (e) => {
  e.preventDefault();
  const n = $('#jumpInput').value.match(/\d{3,}/)?.[0];
  $('#jumpInput').value = '';
  if (n) select(n);
});
$('#showConnect').onclick = async () => {
  await loadStatus();
  $('#connect').hidden = false;
};
$('#connect').addEventListener('click', (e) => {
  const c = S.status.connections;
  if (e.target.id === 'connect' && c.quickbooks.connected && c.microsoft.connected) $('#connect').hidden = true;
});
$('#reset').onclick = async () => {
  await api('/api/reset', { method: 'POST' });
  S.selected = null;
  S.choice = {};
  S.drafts = {};
  S.filter = 'all';
  lastTotals = {};
  await loadQueue();
  blank();
  toast('Demo reset');
};

// ---------- boot ----------
async function boot2() {
  await loadQueue();
  if (S.queue?.rows) {
    S.remitLines = S.queue.rows.map((r) => ({ invoice_number: r.n, deduction_ref: r.ref, reason: `${r.reason}: ${r.cases} cases`, deducted: r.amount }));
  }
  if (S.selected) select(S.selected);
  else blank();
}
(async () => {
  if (new URLSearchParams(location.search).has('connected')) history.replaceState(null, '', '/');
  const ok = await loadStatus();
  $('#work').innerHTML = '';
  if (ok) boot2();
})();
