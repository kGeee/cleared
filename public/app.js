const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const fmtDate = (iso) => (iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '');
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

const APPS = {
  quickbooks: { name: 'QuickBooks', mark: 'qb' },
  outlook: { name: 'Outlook', mark: 'O' },
  onedrive: { name: 'OneDrive', mark: '☁' },
};
const logo = (app, lg) => `<span class="applogo ${app}${lg ? ' lg' : ''}">${APPS[app].mark}</span>`;

const feed = $('#feed');
const sourceHead = $('#sourceHead');
const sourceBody = $('#sourceBody');
const sourceFoot = $('#sourceFoot');
let status = null;
let busy = false;
let activeApp = null;
let timer = null;
let awaitingApproval = false;

// ---------- status / connections ----------
async function loadStatus() {
  status = await (await fetch('/api/status')).json();
  const live = status.mode === 'live';
  $('#modeBadge').className = 'badge ' + (live ? 'live' : 'offline');
  $('#modeBadge').textContent = live ? 'Live · QuickBooks ' + (status.connections.quickbooks.environment || '') + ' + Microsoft 365' : 'Offline rehearsal · demo data, nothing is sent';
  $('#agentBadge').textContent = status.agent === 'claude' ? `Agent: Claude (${status.model})` : 'Agent: scripted (add ANTHROPIC_API_KEY for Claude)';
  renderChips();
  renderConnect();
  const ok = status.connections.quickbooks.connected && status.connections.microsoft.connected;
  $('#connect').hidden = ok;
  return ok;
}

function renderChips() {
  if (!status) return;
  const c = status.connections;
  const on = { quickbooks: c.quickbooks.connected, outlook: c.microsoft.connected, onedrive: c.microsoft.connected };
  $('#chips').innerHTML = Object.keys(APPS)
    .map((a) => `<span class="chip ${on[a] ? 'on' : 'off'} ${activeApp === a ? 'active' : ''}">${logo(a)}${APPS[a].name}</span>`)
    .join('');
}

function setWorking(app, label) {
  activeApp = app;
  $('#workingIn').textContent = app ? `Working in ${APPS[app].name}` : 'Ready';
  renderChips();
  if (label) setThinking(label);
}

function renderConnect() {
  const c = status.connections;
  const row = (key, title, who, perms, connected) => `
    <div class="cx">
      <div class="cx-top">
        ${key === 'quickbooks' ? logo('quickbooks', true) : `<span style="display:flex;gap:4px">${logo('outlook', true)}${logo('onedrive', true)}</span>`}
        <div><b>${title}</b><div class="who">${esc(who || '')}</div></div>
        <div class="act">${
          connected
            ? `<span class="connected">Connected ✓ <button class="link" data-disconnect="${key}">Disconnect</button></span>`
            : `<a class="cbtn" href="/auth/${key}">Connect</a>`
        }</div>
      </div>
      <ul>${perms.map((p) => `<li>${p[0]}${p[1] ? `<em>${p[1]}</em>` : ''}</li>`).join('')}</ul>
    </div>`;
  const ready = c.quickbooks.connected && c.microsoft.connected;
  $('#connectList').innerHTML =
    row('quickbooks', 'QuickBooks', c.quickbooks.connected ? c.quickbooks.company : 'Invoices and payments', [
      ['Invoices and customers'],
      ['Payments and remittances'],
      ['Add notes to invoices', 'Only after you approve in Cleared'],
    ], c.quickbooks.connected) +
    row('microsoft', 'Microsoft 365', c.microsoft.connected ? c.microsoft.email : 'Outlook + OneDrive, one sign-in', [
      ['Read mail and attachments'],
      ['Read files in OneDrive'],
      ['Send mail', 'Only after you approve in Cleared'],
    ], c.microsoft.connected) +
    (ready ? `<button class="btn cx-done" id="doneConnect">Start working</button>` : `<div class="cx-note">${status.mode === 'live' ? 'You approve access on each app\'s own sign-in screen. Disconnect anytime.' : 'Offline rehearsal: Connect simulates sign-in. Set up .env for the real flow.'}</div>`);
}

document.addEventListener('click', async (e) => {
  const d = e.target.closest('[data-disconnect]');
  if (d) {
    await fetch(`/auth/${d.dataset.disconnect}/disconnect`, { method: 'POST' });
    await loadStatus();
    $('#connect').hidden = false;
  }
  if (e.target.id === 'doneConnect') $('#connect').hidden = true;
  const ask = e.target.closest('[data-ask]');
  if (ask && !busy) send(ask.dataset.ask);
  const tab = e.target.closest('[data-doc]');
  if (tab) selectDoc(tab.dataset.doc);
});
$('#showConnect').onclick = async () => {
  await loadStatus();
  $('#connect').hidden = false;
};
$('#connect').addEventListener('click', (e) => {
  if (e.target.id === 'connect' && status.connections.quickbooks.connected && status.connections.microsoft.connected) $('#connect').hidden = true;
});
$('#reset').onclick = async () => {
  await fetch('/api/reset', { method: 'POST' });
  feed.innerHTML = '';
  stopTimer(true);
  idle();
};

// ---------- source pane views ----------
function setSource(app, title, html, foot) {
  sourceHead.innerHTML = app ? `${logo(app, true)}<b>${APPS[app].name}</b><span>${esc(title)}</span>` : '';
  sourceBody.style.animation = 'none';
  void sourceBody.offsetWidth;
  sourceBody.style.animation = '';
  sourceBody.innerHTML = html;
  if (foot !== undefined) setFoot(foot);
}
function setFoot(f) {
  if (!f) return (sourceFoot.hidden = true);
  sourceFoot.hidden = false;
  sourceFoot.className = 'source-foot ' + (f.tone || '');
  sourceFoot.textContent = f.text;
}

function idle() {
  setWorking(null);
  setSource(
    null,
    '',
    `<div class="idle"><div>
      <img src="/mascot.png" alt="" />
      <h2>Every short-pay disputed in time.</h2>
      <p>Your Finance teammate. Ask like you'd text a coworker.</p>
      <div class="suggest">
        <button data-ask="Why were we short-paid on Invoice 2086, and what do we need to resolve it?">Why were we short-paid on Invoice 2086?</button>
        <button data-ask="Which short-pays need attention?">Which short-pays need attention?</button>
        <button data-ask="What about Invoice 2087?">What about Invoice 2087? <span class="hint">POD proves delivery</span></button>
        <button data-ask="Should we fight the deduction on Invoice 2088?">Should we fight the deduction on 2088? <span class="hint">valid claim</span></button>
      </div>
    </div></div>`,
    null,
  );
}

const views = {
  invoice(v) {
    const inv = v.invoice;
    const p = v.payments;
    const html = `
      <div class="appbar quickbooks"><span>QuickBooks</span><span class="sub">Invoice ${esc(inv.docNumber)}</span><span class="right">Status: ${esc(inv.status)}</span></div>
      <div class="qb-inv">
        <div class="qb-row"><h3>Invoice ${esc(inv.docNumber)}</h3><span class="pill open">${esc(inv.status)}</span></div>
        <div class="meta4">
          <div><small>Customer</small><b>${esc(inv.customer)}</b></div>
          <div><small>Invoice date</small><b>${fmtDate(inv.txnDate)}</b></div>
          <div><small>Due date</small><b>${fmtDate(inv.dueDate)}</b></div>
          <div><small>Terms</small><b>${esc(inv.terms)}</b></div>
        </div>
        <table class="lines"><thead><tr><th>Product / service</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
        <tbody>${inv.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="r">${l.qty}</td><td class="r">${money(l.rate)}</td><td class="r">${money(l.amount)}</td></tr>`).join('')}</tbody></table>
        <div class="total">Total <b>${money(inv.total)}</b></div>
        <div class="qb-pay reveal" style="animation-delay:.35s">
          ${p.payments.map((x) => `<div class="r"><span>Payment ${x.reference ? '· check ' + esc(x.reference) : ''} · ${fmtDate(x.date)}</span><span>−${money(x.applied)}</span></div>`).join('')}
          <div class="r bal"><span>Balance due</span><span>${money(inv.balance)}</span></div>
        </div>
      </div>`;
    setSource('quickbooks', `invoice ${inv.docNumber}`, html, { text: v.footer, tone: '' });
  },
  message(v) {
    const m = v.message;
    const h = v.highlight;
    const html = `
      <div class="appbar outlook"><span>Outlook</span><span class="search">Search: ${esc(m.subject.match(/Check \d+/)?.[0] || 'payment advice')}</span><span class="right">Inbox</span></div>
      <div class="ol">
        <div class="ol-list"><div class="folder">Focused</div>
          <div class="ol-item sel"><b>${esc(m.from)}</b><div class="s">Payment advice</div><div class="p">${esc(m.preview)}</div></div>
        </div>
        <div class="ol-read">
          <h3>${esc(m.subject)}</h3>
          <div class="from">${esc(m.from)} ${m.fromAddress ? '&lt;' + esc(m.fromAddress) + '&gt;' : ''} · ${fmtWhen(m.received)}</div>
          ${v.attachment ? (v.attachment.url ? `<a class="att" href="${v.attachment.url}" target="_blank">${esc(v.attachment.name)}</a>` : `<span class="att">${esc(v.attachment.name)}</span>`) : ''}
          <p style="color:var(--ink-2)">${esc(m.preview)}</p>
          ${
            h
              ? `<div class="hl reveal" style="animation-delay:.3s"><small>Read from the attached PDF · Invoice ${esc(h.invoice_number)}</small>
                  <div class="row"><span>Gross</span><span>${money(h.gross)}</span></div>
                  <div class="row"><span>${esc(h.deduction_code || '')} ${esc(h.deduction_ref || '')} · ${esc(h.reason || '')}${h.cases ? ': ' + h.cases + ' cases' : ''}</span><span>−${money(h.deducted)}</span></div>
                  <div class="row"><span>Paid</span><span>${money(h.paid)}</span></div></div>`
              : ''
          }
        </div>
      </div>`;
    setSource('outlook', 'the payment advice', html);
  },
  packet(v) {
    window.__packet = v;
    const pod = v.pod;
    const html = `
      <div class="appbar onedrive"><span>Documents</span><span class="sub">${esc(v.folder.split('/').pop())}</span><span class="right">${v.files.length} files</span></div>
      <div class="od">
        <div class="od-tabs">${v.files.map((f) => `<button data-doc="${f.kind}" class="${f.kind === v.selected ? 'sel' : ''}">${{ invoice: 'Invoice', manifest: 'Manifest', pod: 'Proof of delivery' }[f.kind] || esc(f.name)}</button>`).join('')}</div>
        ${
          pod
            ? `<div class="od-facts reveal" id="podFacts">
                <div class="fact"><small>Cases on manifest</small><b>${pod.manifest ?? '—'}</b></div>
                <div class="fact"><small>Received by</small><b>${esc(pod.receivedBy || '—')}</b></div>
                <div class="fact ${pod.accepted == null ? 'warn' : ''}"><small>Accepted count</small><b>${pod.accepted == null ? 'Not shown on this POD' : pod.accepted + ' accepted' + (pod.exceptions ? ' · ' + esc(pod.exceptions) : '')}</b></div>
              </div>`
            : ''
        }
        <iframe id="docFrame" title="document"></iframe>
      </div>`;
    setSource('onedrive', 'the invoice packet: manifest and POD', html);
    selectDoc(v.selected);
  },
  sent(v) {
    const html = `
      <div class="appbar outlook"><span>Outlook</span><span class="search">Sent Items</span><span class="right">${v.offline ? 'Rehearsal' : 'Sent just now'}</span></div>
      <div class="ol">
        <div class="ol-list"><div class="folder">Sent Items</div>
          <div class="ol-item sel"><b>${esc(v.subject)}</b><div class="p">To: ${esc(v.to)}</div></div>
        </div>
        <div class="ol-read">
          <h3>${esc(v.subject)}</h3>
          <div class="from">To: ${esc(v.to)} · ${fmtWhen(v.sentAt)}</div>
          <div>${v.attachments.map((a) => `<a class="att" href="${a.url}" target="_blank">${esc(a.label)}</a>`).join('')}</div>
          <div class="sentbody">${esc(v.body)}</div>
          ${v.webLink ? `<a class="att" style="--x:0" href="${v.webLink}" target="_blank">Open in Outlook</a>` : ''}
          ${v.offline ? `<div class="offline-note">Offline rehearsal: this message was not actually sent. In live mode it goes out from your Microsoft 365 account.</div>` : ''}
        </div>
      </div>`;
    setSource('outlook', 'the approved follow-up, sent', html);
  },
};

function selectDoc(kind) {
  const v = window.__packet;
  if (!v) return;
  const f = v.files.find((x) => x.kind === kind) || v.files[0];
  if (!f) return;
  document.querySelectorAll('.od-tabs button').forEach((b) => b.classList.toggle('sel', b.dataset.doc === f.kind));
  const facts = $('#podFacts');
  if (facts) facts.style.display = f.kind === 'pod' ? '' : 'none';
  $('#docFrame').src = f.url + '#toolbar=0&navpanes=0&view=FitH';
}

// ---------- Cleared panel ----------
const eyebrow = (t) => `<div class="eyebrow"><img src="/mascot.png" alt="">${esc(t || 'Cleared')}</div>`;
let thinkingEl = null;
function setThinking(label) {
  clearThinking();
  thinkingEl = document.createElement('div');
  thinkingEl.className = 'thinking';
  thinkingEl.innerHTML = `<span class="d"><i></i><i></i><i></i></span>${esc(label || '')}`;
  feed.appendChild(thinkingEl);
  scroll();
}
function clearThinking() {
  thinkingEl?.remove();
  thinkingEl = null;
}
function add(html, cls = '') {
  clearThinking();
  const el = document.createElement('div');
  if (cls) el.className = cls;
  el.innerHTML = html;
  feed.appendChild(el);
  scroll();
  return el;
}
function scroll() {
  requestAnimationFrame(() => (feed.scrollTop = feed.scrollHeight));
}

const cards = {
  reconcile: (c) =>
    add(`${eyebrow()}<h4>${esc(c.title)}</h4>
      ${c.rows.map((r) => `<div class="row"><span>${esc(r.label)}</span><b>${esc(r.value)}</b></div>`).join('')}
      ${c.gap ? `<div class="gap"><span>◷ ${esc(c.gap.label)}</span><b>${esc(c.gap.value)}</b></div>` : ''}`, 'card recon'),
  claim: (c) => {
    const el = add(`<span>${esc(c.text)}</span><span class="ref">${esc(c.ref)}</span><span class="tag ${c.tone}">${esc(c.tag)}</span>`, 'claim');
    el.id = c.id;
  },
  evidence: (c) =>
    add(`${eyebrow()}<h4>${esc(c.title)}</h4><div class="tiles">${c.tiles
      .map((t) => `<div class="tile ${t.state}"><small>${esc(t.label)}</small><b>${esc(t.value)}</b>${t.sub ? `<span>${esc(t.sub)}</span>` : ''}</div>`)
      .join('')}</div>`, 'card'),
  verdict: (c) =>
    add(`<div class="verdict-h"><span class="ic">${c.tone === 'good' ? '✅' : '⚠️'}</span><div><h4>${esc(c.headline)}</h4><div class="detail">${esc(c.detail)}</div>${c.meta ? `<div class="meta">${esc(c.meta)}</div>` : ''}</div></div>`, `card ${c.tone}`),
  proposal: (c) => {
    const el = add(`${eyebrow('Cleared · ' + c.eyebrow)}<h4>${esc(c.title)}</h4>
      <div class="mail">
        <div class="hdr">To <b>${esc(c.to)}</b></div>
        <div class="hdr">Subject</div><input class="subj" value="${esc(c.subject)}" />
        <textarea class="body" rows="9">${esc(c.body)}</textarea>
        <div class="attchips">${c.attachments.map((a) => `<a href="${a.url}" target="_blank">${esc(a.label)}</a>`).join('')}</div>
      </div>
      <div class="actions"><button class="btn">${esc(c.button)}</button></div>`, 'card prop');
    awaitingApproval = true;
    const btn = $('.btn', el);
    btn.onclick = () => approve(c.id, el, () => ({ subject: $('.subj', el).value, body: $('.body', el).value }));
  },
  close: (c) => {
    const el = add(`${eyebrow('Cleared · ' + c.eyebrow)}<h4>${esc(c.title)}</h4><div class="detail" style="margin-bottom:12px">${esc(c.body)}</div><div class="actions"><button class="btn">${esc(c.button)}</button></div>`, 'card prop');
    awaitingApproval = true;
    $('.btn', el).onclick = () => approve(c.id, el, () => ({}));
  },
  sent: (c) =>
    add(`${eyebrow()}<h4>${esc(c.headline)}</h4><ul class="checks">${c.checks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${c.pending ? `<div class="pending">${esc(c.pending)}</div>` : ''}
      <div class="auditline"><span>${esc(c.audit)}</span><span>Question to done: <b>${fmtElapsed(c.elapsed)}</b></span></div>`, `card sent`),
  deductions: (c) =>
    add(`${eyebrow()}<h4>${esc(c.title)}</h4><div class="detail" style="margin-bottom:6px">${esc(c.total)} withheld. Dispute window: ${esc(c.rows[0]?.deadline || '')}${c.rows[0]?.daysLeft != null ? ` (${c.rows[0].daysLeft} days left)` : ''}.</div>
      <table>${c.rows
        .map((r) => `<tr><td><b>${esc(r.invoice)}</b></td><td>${esc(r.reason)} · ${r.cases} cases<br><span style="color:var(--muted);font-size:11.5px">${esc(r.ref)}</span></td><td class="r">${money(r.amount)}</td><td class="r"><button class="go" data-ask="Why were we short-paid on Invoice ${esc(r.invoice)}?">Look into it</button></td></tr>`)
        .join('')}</table>`, 'card ded'),
};

const fmtElapsed = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
function startTimer() {
  const t0 = Date.now();
  const el = $('#timer');
  el.hidden = false;
  el.classList.add('running');
  clearInterval(timer);
  const tick = () => (el.textContent = '⏱ ' + fmtElapsed(Math.round((Date.now() - t0) / 1000)));
  tick();
  timer = setInterval(tick, 500);
}
function stopTimer(hide) {
  clearInterval(timer);
  $('#timer').classList.remove('running');
  if (hide) $('#timer').hidden = true;
}

function handle(ev) {
  switch (ev.type) {
    case 'step':
      setWorking(ev.app, ev.label);
      break;
    case 'view':
      views[ev.view.type]?.(ev.view);
      break;
    case 'card':
      cards[ev.card.kind]?.(ev.card);
      break;
    case 'update': {
      const el = document.getElementById(ev.id);
      const tag = el && $('.tag', el);
      if (tag) {
        tag.textContent = ev.patch.tag;
        tag.className = 'tag ' + (ev.patch.tone || '');
      }
      break;
    }
    case 'status':
      setFoot(ev);
      break;
    case 'message':
      add(esc(ev.text), 'say');
      break;
    case 'error':
      add(esc(ev.text), 'err');
      break;
    case 'done':
      clearThinking();
      break;
  }
}

async function send(question) {
  if (busy) return;
  if (!(await loadStatus())) return;
  busy = true;
  $('#composer button').disabled = true;
  awaitingApproval = false;
  add(`<small>YOU</small><div>${esc(question)}</div>`, 'you');
  setThinking('Thinking');
  startTimer();
  try {
    const res = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) handle(JSON.parse(line));
      }
    }
  } catch (e) {
    add(esc(e.message), 'err');
  } finally {
    clearThinking();
    busy = false;
    $('#composer button').disabled = false;
    $('#workingIn').textContent = 'Waiting on you';
    // keep the clock running while a proposal waits for approval
    if (!awaitingApproval) stopTimer();
  }
}

async function approve(id, el, getEdits) {
  const btn = $('.btn', el);
  btn.disabled = true;
  btn.textContent = 'Sending…';
  setWorking('outlook');
  try {
    const res = await fetch('/api/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...getEdits() }) });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error);
    $('.actions', el).innerHTML = `<div class="approved">Approved</div>`;
    el.querySelectorAll('input,textarea').forEach((x) => (x.readOnly = true));
    if (out.view) views[out.view.type]?.(out.view);
    if (out.status) setFoot(out.status);
    cards.sent(out.card);
    awaitingApproval = false;
    stopTimer();
    $('#timer').textContent = '⏱ ' + fmtElapsed(out.card.elapsed);
    $('#workingIn').textContent = out.view ? 'Working in Outlook' : 'Working in QuickBooks';
    if (!out.view) setWorking('quickbooks');
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Try again';
    add(esc(e.message), 'err');
  }
}

$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (!q) return;
  $('#q').value = '';
  send(q);
});

// ---------- boot ----------
idle();
loadStatus().then(() => {
  if (new URLSearchParams(location.search).has('connected')) history.replaceState(null, '', '/');
  $('#q').focus();
});
