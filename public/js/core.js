// Shared state, helpers, the Cleared chat panel engine and the document drawer.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
export const d8 = (iso) => (iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '—');
export const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');
export const dur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const APPS = {
  outlook: { name: 'Outlook', mark: 'O', desc: 'mail', live: true },
  excel: { name: 'Excel', mark: 'X', desc: 'trackers', live: false },
  cin7: { name: 'Cin7', mark: 'C7', desc: 'inventory', live: false },
  shipbob: { name: 'ShipBob', mark: 'SB', desc: '3PL portal', live: false },
  sps: { name: 'SPS Commerce', mark: 'SPS', desc: 'EDI', live: false },
  quickbooks: { name: 'QuickBooks', mark: 'qb', desc: 'accounting', live: true },
  onedrive: { name: 'OneDrive', mark: '☁', desc: 'files', live: true },
};
export const TEAMS = { ops: 'Operations', growth: 'Growth', finance: 'Finance' };
export const logo = (app, lg) => `<span class="applogo ${app}${lg ? ' lg' : ''}">${app === 'cleared' ? '✓' : APPS[app]?.mark || ''}</span>`;

// ---------- state ----------
const KEY = 'cleared-desktop-v1';
const fresh = () => ({
  ops: { stage: 'new', freight: 420, east: '', west: '', freightStatus: '', packed: false, asn: false },
  growth: { stage: 'new', kit: 'v2', maple: 'Pending', harbor: 'Pending', broker: 'Old image', replies: [] },
  extra: [], // emails that arrived during the demo
  sent: [], // Sent Items
  read: {},
});
let saved = {};
try {
  saved = JSON.parse(localStorage.getItem(KEY) || '{}');
} catch {}
export const S = {
  status: null,
  queue: null,
  app: 'outlook',
  sel: { outlook: 'kehe-po-1042', outlookFolder: 'inbox', excel: 'order', quickbooks: null, onedrive: 'assets' },
  panel: false,
  busy: false,
  invoices: {}, // cached /api/invoice
  packets: {}, // cached /api/packet
  cases: {}, // cached /api/case
  ...fresh(),
  ...saved,
};
export function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ops: S.ops, growth: S.growth, extra: S.extra, sent: S.sent, read: S.read }));
  } catch {}
}
export function resetLocal() {
  Object.assign(S, fresh());
  S.invoices = {};
  S.packets = {};
  S.cases = {};
  persist();
}

// Late-bound hooks (set by apps.js / main.js) to avoid circular imports.
export const hooks = { render: () => {}, refreshContext: () => {}, start: () => {} };

export async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || res.statusText), { status: res.status });
  return json;
}

export function toast(text, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = text;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3600);
}

// ---------- app switching ----------
export function setApp(app, sel = {}) {
  S.app = app;
  Object.assign(S.sel, sel);
  hooks.render();
  hooks.refreshContext();
}
export function working(app, text) {
  $('#workingIn').textContent = text || (app ? `Working in ${APPS[app].name}` : 'Ready');
  $$('.dock button').forEach((b) => b.classList.toggle('working', b.dataset.app === app));
}
export function addEmail(m) {
  S.extra.unshift({ time: 'Now', unread: true, ...m });
  persist();
}
export function addSent(m) {
  S.sent.unshift({ at: new Date().toISOString(), ...m });
  persist();
}

// ---------- the Cleared panel ----------
const feed = () => $('#feed');
export function openPanel() {
  S.panel = true;
  document.body.classList.add('panel-open');
  hooks.refreshContext();
}
export function closePanel() {
  S.panel = false;
  document.body.classList.remove('panel-open');
}
function scroll() {
  requestAnimationFrame(() => {
    const f = feed();
    f.scrollTop = f.scrollHeight;
  });
}
let thinkingEl = null;
export function clearThinking() {
  thinkingEl?.remove();
  thinkingEl = null;
}
export function add(html, cls = '') {
  clearThinking();
  $('#feedEmpty')?.remove();
  const el = document.createElement('div');
  if (cls) el.className = cls;
  el.innerHTML = html;
  feed().appendChild(el);
  scroll();
  return el;
}
export const you = (text) => add(`<small>YOU</small><div>${esc(text)}</div>`, 'you');
export const say = (text) => add(esc(text), 'say');
export const eyebrow = (t = 'Cleared') => `<div class="eyebrow"><img src="/mascot.png" alt="">${esc(t)}</div>`;
export const card = (html, cls = '') => add(html, `card ${cls}`);

// Shows Cleared working, switches the visible app, and waits so the step reads on stage.
export async function step(label, app, sel, ms = 900) {
  clearThinking();
  thinkingEl = document.createElement('div');
  thinkingEl.className = 'thinking';
  thinkingEl.innerHTML = `<span class="d"><i></i><i></i><i></i></span>${app ? logo(app) : ''}${esc(label)}`;
  feed().appendChild(thinkingEl);
  scroll();
  if (app) {
    setApp(app, sel || {});
    working(app);
  } else working(null, 'Thinking');
  await sleep(ms);
}

// Wires [data-act] buttons in a card; resolves with the chosen action. Buttons disable after a choice.
export function choice(el, { keep = false } = {}) {
  return new Promise((resolve) => {
    $$('[data-act]', el).forEach((b) =>
      b.addEventListener('click', () => {
        if (!keep) $$('[data-act]', el).forEach((x) => (x.disabled = true));
        b.classList.add('chosen');
        resolve(b.dataset.act);
      }),
    );
  });
}

// Runs one flow at a time so clicks can't interleave.
export async function run(fn) {
  if (S.busy) return toast('Cleared is finishing the current task.');
  S.busy = true;
  document.body.classList.add('busy');
  if (!S.panel) openPanel();
  try {
    await fn();
  } catch (e) {
    console.error(e);
    clearThinking();
    add(esc(e.message), 'err');
  } finally {
    S.busy = false;
    document.body.classList.remove('busy');
    clearThinking();
    working(null);
    hooks.refreshContext();
  }
}

// ---------- document drawer ----------
export function openDoc({ title, eyebrowHtml, url, html, read, reader, lines, highlight }) {
  $('#dEyebrow').innerHTML = eyebrowHtml || '';
  $('#dTitle').textContent = title;
  $('#dOpen').hidden = !url;
  if (url) $('#dOpen').href = url;
  const frame = $('#dFrame');
  const preview = $('#dPreview');
  if (url) {
    frame.hidden = false;
    preview.hidden = true;
    frame.src = url + '#toolbar=0&navpanes=0&view=FitH';
  } else {
    frame.hidden = true;
    frame.src = 'about:blank';
    preview.hidden = false;
    preview.innerHTML = html || '';
  }
  let side = '';
  if (lines) {
    side = `<h4>What Cleared read</h4><div class="by">${reader === 'claude' ? '✦ Read by Claude' : 'Read by Cleared'}</div><table>${lines
      .map((l) => `<tr class="${String(l.invoice_number) === String(highlight) ? 'hl' : ''}"><td>${esc(l.invoice_number)}</td><td>${esc(l.deduction_code || '')} ${esc(l.deduction_ref || '')}<br>${esc(l.reason || '')}${l.cases ? `: ${l.cases} cases` : ''}</td><td>−${money(l.deducted)}</td></tr>`)
      .join('')}</table>`;
  } else if (read) {
    side = `<h4>What Cleared read</h4><div class="by">${reader === 'claude' ? '✦ Read by Claude' : reader === 'parser' ? 'Read by the built-in parser' : 'Read by Cleared'}</div><dl>${read
      .map((f) => `<dt>${esc(f.label)}</dt><dd class="${f.value == null && /accepted/i.test(f.label) ? 'missing' : ''}">${esc(f.value ?? f.missing ?? '—')}</dd>`)
      .join('')}</dl>`;
  }
  $('#dRead').innerHTML = side;
  $('#dRead').hidden = !side;
  $('#drawer').hidden = false;
}
export function closeDoc() {
  $('#drawer').hidden = true;
  $('#dFrame').src = 'about:blank';
}
