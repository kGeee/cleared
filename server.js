import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { ROOT, MODE, AGENT, config } from './src/config.js';
import { quickbooks, microsoft } from './src/sources.js';
import * as cases from './src/cases.js';
import * as assistant from './src/assistant.js';
import * as store from './src/store.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public')));

const providers = { quickbooks, microsoft };
const pendingStates = new Map();
const connected = () => quickbooks.isConnected() && microsoft.isConnected();
const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
};

app.get('/api/status', (_req, res) => {
  res.json({
    mode: MODE,
    ai: AGENT === 'claude',
    model: AGENT === 'claude' ? config.anthropic.model : null,
    approver: config.approverName,
    connections: { quickbooks: quickbooks.info(), microsoft: microsoft.info() },
  });
});

// ----- OAuth -----
app.get('/auth/offline/:provider', async (req, res) => {
  if (MODE !== 'offline') return res.status(404).end();
  await providers[req.params.provider]?.callback({});
  res.redirect('/?connected=' + req.params.provider);
});

app.get('/auth/:provider', (req, res) => {
  const p = providers[req.params.provider];
  if (!p) return res.status(404).end();
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, req.params.provider);
  res.redirect(p.authUrl(state));
});

app.get('/auth/:provider/callback', async (req, res) => {
  const p = providers[req.params.provider];
  if (!p) return res.status(404).end();
  if (pendingStates.get(req.query.state) !== req.params.provider) {
    return res.status(400).send('Sign-in state did not match. Go back and try connecting again.');
  }
  pendingStates.delete(req.query.state);
  try {
    await p.callback(req.query);
    res.redirect('/?connected=' + req.params.provider);
  } catch (e) {
    console.error(e);
    res.status(500).send(`<pre>Could not connect ${req.params.provider}:\n${e.message}</pre><a href="/">Back</a>`);
  }
});

app.post('/auth/:provider/disconnect', async (req, res) => {
  await providers[req.params.provider]?.disconnect();
  res.json({ ok: true });
});

// ----- Cases -----
app.use('/api/queue', (req, res, next) => (connected() ? next() : res.status(409).json({ error: 'Connect QuickBooks and Microsoft 365 first.' })));
app.get('/api/queue', wrap(() => cases.queue()));
app.get('/api/case/:n', wrap((req) => cases.getCase(req.params.n)));

// Streams the four investigation steps as NDJSON so the workspace fills in live.
app.post('/api/case/:n/investigate', async (req, res) => {
  if (!connected()) return res.status(409).json({ error: 'Connect QuickBooks and Microsoft 365 first.' });
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();
  const emit = (ev) => res.write(JSON.stringify(ev) + '\n');
  try {
    await cases.investigate(req.params.n, emit, { pace: req.query.quick !== '1' });
  } catch (e) {
    console.error(e);
    emit({ type: 'error', text: e.message });
  }
  res.end();
});

// Read-only views for the desktop apps (QuickBooks invoice, OneDrive packet).
app.get('/api/invoice/:n', wrap(async (req) => {
  const invoice = await quickbooks.getInvoice(req.params.n);
  if (!invoice) throw new Error(`Invoice ${req.params.n} not found`);
  return { invoice, payments: await quickbooks.getPayments(invoice) };
}));
app.get('/api/packet/:n', wrap(async (req) => {
  const { folder, files } = await microsoft.listPacket(req.params.n);
  return { folder, files: files.map((f) => ({ name: f.name, url: `/api/case/${req.params.n}/file/${encodeURIComponent(f.name)}`, webUrl: f.webUrl || null })) };
}));

app.post('/api/case/:n/draft', wrap((req) => cases.draft(req.params.n, req.body?.action)));
app.post('/api/case/:n/approve', wrap((req) => cases.approve(req.params.n, req.body || {})));
app.post('/api/case/:n/replies', wrap((req) => cases.checkReplies(req.params.n)));
app.post('/api/case/:n/simulate-reply', wrap((req) => cases.simulateReply(req.params.n)));

// Typed questions that don't match a flow. Claude is scoped tightly, uses code for every calculation,
// and its answer is checked number-by-number; anything unverifiable comes back as an escalation.
app.post('/api/chat', wrap((req) => assistant.ask(req.body?.text, req.body?.context)));

app.post('/api/reset', (_req, res) => {
  cases.reset();
  if (MODE === 'offline') store.update('offline', { notes: {} });
  res.json({ ok: true });
});

app.get('/api/remit/:name', async (req, res) => {
  try {
    const r = await cases.remitFile(req.params.name);
    if (!r) return res.status(404).send('Not found');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${req.params.name.replace(/"/g, '')}"`);
    res.send(r.bytes);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.get('/api/case/:n/file/:name', async (req, res) => {
  try {
    const bytes = await cases.file(req.params.n, req.params.name);
    if (!bytes) return res.status(404).send('Not found');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${req.params.name.replace(/"/g, '')}"`);
    res.send(bytes);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.listen(config.port, () => {
  console.log(`\n  Cleared demo running at ${config.appUrl}`);
  console.log(`  Mode: ${MODE === 'live' ? 'LIVE (QuickBooks ' + config.quickbooks.environment + ' + Microsoft 365)' : 'OFFLINE rehearsal (fixtures, nothing is sent)'}`);
  console.log(`  AI:   ${AGENT === 'claude' ? 'Claude (' + config.anthropic.model + ') reads documents and drafts emails' : 'off (set ANTHROPIC_API_KEY); parser + templates used'}\n`);
});
