// Boot, wiring and the context-aware suggestions.
import { S, $, $$, esc, logo, APPS, TEAMS, api, toast, setApp, hooks, openPanel, closePanel, run, you, say, add, closeDoc, resetLocal, persist } from './core.js';
import { renderApp, currentContext, bindAppEvents } from './apps.js';
import { FLOWS, route } from './flows.js';

hooks.render = renderApp;
hooks.start = (flow, arg) => run(() => FLOWS[flow](arg));
hooks.refreshContext = refreshContext;
hooks.context = () => currentContext();

const DEFAULT_CHIP = { label: 'What can you take off my plate?', flow: 'overview' };

function refreshContext() {
  const ctx = currentContext();
  const team = ctx?.team || null;
  $$('#teams .tab').forEach((t) => t.classList.toggle('active', t.dataset.team === team));
  $('#panelTeam').textContent = team ? TEAMS[team] : '';
  $('#ctx').innerHTML = ctx ? `${logo(S.app)}<span><small>Looking at</small>${esc(ctx.title)}</span>` : '';
  const chips = [...(ctx?.chips || [])];
  if (!chips.some((c) => c.flow === 'overview')) chips.push(DEFAULT_CHIP);
  $('#suggest').innerHTML = chips.map((c, i) => `<button class="chip-s ${i === 0 && c.flow !== 'overview' ? 'primary' : ''}" data-flow="${c.flow}" data-arg="${esc(c.arg ?? '')}" ${S.busy ? 'disabled' : ''}>${esc(c.label)}</button>`).join('');
  // The launcher hints that Cleared can help with what's on screen.
  const hint = ctx?.chips?.[0];
  $('#launcherBadge').hidden = S.panel || !hint;
  $('#launcherBadge').textContent = ctx?.chips?.length || '';
  $('#launcherTip').textContent = hint && !S.panel ? hint.label : '';
  $('#launcher').classList.toggle('hint', !!hint && !S.panel);
}

function renderDock() {
  $('#dock').innerHTML = Object.entries(APPS)
    .map(([k, a]) => `<button data-app="${k}" class="${S.app === k ? 'sel' : ''}" title="${a.name}${a.live ? '' : ' (preview)'}">${logo(k, true)}<span>${a.name.replace(' Commerce', '')}</span>${a.live ? '' : '<i class="pv-dot"></i>'}</button>`)
    .join('');
}

// ---------- status & connections ----------
async function loadStatus() {
  S.status = await api('/api/status');
  const live = S.status.mode === 'live';
  $('#modeBadge').className = 'badge ' + (live ? 'live' : 'offline');
  $('#modeBadge').textContent = live ? 'Live · QuickBooks + Microsoft 365' : 'Offline rehearsal · demo data, nothing is sent';
  $('#aiBadge').textContent = S.status.ai ? `Claude (${S.status.model}) reads documents and drafts emails` : 'AI off: built-in parser and templates (add ANTHROPIC_API_KEY)';
  renderConnect();
  const c = S.status.connections;
  return c.quickbooks.connected && c.microsoft.connected;
}

function renderConnect() {
  const c = S.status.connections;
  const row = (key, title, who, perms, connected) => `
    <div class="cx"><div class="cx-top">${key === 'quickbooks' ? logo('quickbooks', true) : `<span style="display:flex;gap:4px">${logo('outlook', true)}${logo('onedrive', true)}</span>`}
      <div><b>${title}</b><div class="who">${esc(who || '')}</div></div>
      <div class="act">${connected ? `<span class="connected">Connected ✓ <button class="link" data-disconnect="${key}">Disconnect</button></span>` : `<a class="cbtn" href="/auth/${key}">Connect</a>`}</div></div>
      <ul>${perms.map((p) => `<li>${p[0]}${p[1] ? `<em>${p[1]}</em>` : ''}</li>`).join('')}</ul></div>`;
  const ready = c.quickbooks.connected && c.microsoft.connected;
  $('#connectList').innerHTML =
    `<div class="cx-sec">Live in this demo</div>` +
    row('quickbooks', 'QuickBooks', c.quickbooks.connected ? c.quickbooks.company : 'Invoices and payments', [['Invoices and payments'], ['Add notes to invoices', 'Only after you approve']], c.quickbooks.connected) +
    row('microsoft', 'Microsoft 365', c.microsoft.connected ? c.microsoft.email : 'Outlook + OneDrive, one sign-in', [['Read mail, attachments and files'], ['Send mail', 'Only after you approve']], c.microsoft.connected) +
    `<div class="cx-sec">Preview (simulated in this demo)</div><div class="cx-chips">${['excel', 'cin7', 'shipbob', 'sps'].map((k) => `<span>${logo(k)}${APPS[k].name}</span>`).join('')}</div>
     <div class="cx-sec">Next</div><div class="cx-chips muted">${['Gmail', 'Slack', 'Teams', 'Google Sheets', 'Drive', 'Shopify', 'Amazon', 'ShipStation', 'Xero', 'Faire', 'Klaviyo', 'HubSpot', 'Canva'].map((n) => `<span>${n}</span>`).join('')}</div>` +
    (ready ? `<button class="btn wide" data-close-connect>Start working</button>` : `<div class="cx-note">${S.status.mode === 'live' ? "You approve access on each app's own sign-in screen." : 'Offline rehearsal: Connect simulates sign-in. Set up .env for the real flow.'}</div>`);
}

async function loadQueue() {
  try {
    S.queue = await api('/api/queue');
  } catch (e) {
    if (e.status !== 409) toast(e.message, true);
  }
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const t = e.target;
  const dock = t.closest('#dock [data-app]');
  if (dock) return setApp(dock.dataset.app);
  const team = t.closest('#teams [data-team]');
  if (team) {
    const go = { ops: ['outlook', { outlookFolder: 'inbox', outlook: 'kehe-po-1042' }], growth: ['excel', { excel: 'launch' }], finance: ['quickbooks', { quickbooks: null }] }[team.dataset.team];
    setApp(...go);
    return openPanel();
  }
  const goBtn = t.closest('[data-go]');
  if (goBtn && !goBtn.disabled) {
    if (S.busy) return toast('Cleared is finishing the current task.');
    const c = goBtn.closest('.card');
    if (c) $$('[data-go]', c).forEach((b) => (b.disabled = true));
    goBtn.classList.add('chosen');
    return hooks.start(goBtn.dataset.go, goBtn.dataset.arg || undefined);
  }
  const flow = t.closest('[data-flow]');
  if (flow && !flow.disabled) return hooks.start(flow.dataset.flow, flow.dataset.arg || undefined);
  if (t.closest('#launcher')) return S.panel ? closePanel() : (openPanel(), refreshContext());
  if (t.closest('#closePanel')) return closePanel(), refreshContext();
  if (t.closest('[data-close]')) return closeDoc();
  const d = t.closest('[data-disconnect]');
  if (d) {
    await api(`/auth/${d.dataset.disconnect}/disconnect`, { method: 'POST' });
    await loadStatus();
    $('#connect').hidden = false;
    return;
  }
  if (t.closest('[data-close-connect]')) {
    $('#connect').hidden = true;
    await loadQueue();
    return renderApp(), refreshContext();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#drawer').hidden) closeDoc();
    else if (S.panel) closePanel(), refreshContext();
  }
});
$('#showConnect').onclick = async () => {
  await loadStatus();
  $('#connect').hidden = false;
};
$('#connect').addEventListener('click', (e) => {
  const c = S.status.connections;
  if (e.target.id === 'connect' && c.quickbooks.connected && c.microsoft.connected) $('#connect').hidden = true;
});
$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#q').value.trim();
  if (!text) return;
  $('#q').value = '';
  run(route(text));
});
$('#reset').onclick = async () => {
  await api('/api/reset', { method: 'POST' }).catch(() => {});
  resetLocal();
  $('#feed').innerHTML = `<div class="feed-empty" id="feedEmpty"><img src="/mascot.png" alt="" /><h3>Your CPG team, in one chat.</h3><p>I see what you're working on. Pick a suggestion below, or just ask.</p><button class="btn" data-flow="overview">What can you take off my plate?</button></div>`;
  await loadQueue();
  setApp('outlook', { outlookFolder: 'inbox', outlook: 'kehe-po-1042', excel: 'order', quickbooks: null, onedrive: 'assets' });
  toast('Demo reset');
};

// ---------- boot ----------
(async () => {
  if (new URLSearchParams(location.search).has('connected')) history.replaceState(null, '', '/');
  bindAppEvents();
  renderDock();
  const ok = await loadStatus();
  $('#connect').hidden = ok;
  if (ok) await loadQueue();
  renderApp();
  refreshContext();
  persist();
})();
