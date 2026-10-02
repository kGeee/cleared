import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { ROOT, MODE, AGENT, config } from './src/config.js';
import { quickbooks, microsoft } from './src/sources.js';
import * as agent from './src/agent.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public')));

const providers = { quickbooks, microsoft };
const pendingStates = new Map();

app.get('/api/status', (_req, res) => {
  res.json({
    mode: MODE,
    agent: AGENT,
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

// ----- Agent -----
app.post('/api/ask', async (req, res) => {
  const question = String(req.body?.question || '').trim().slice(0, 500);
  if (!question) return res.status(400).json({ error: 'Ask a question' });
  if (!quickbooks.isConnected() || !microsoft.isConnected()) {
    return res.status(409).json({ error: 'Connect QuickBooks and Microsoft 365 first.' });
  }
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();
  const emit = (ev) => res.write(JSON.stringify(ev) + '\n');
  await agent.ask(question, emit);
  res.end();
});

app.post('/api/approve', async (req, res) => {
  try {
    const out = await agent.approve(String(req.body?.id || ''), { subject: req.body?.subject, body: req.body?.body });
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/reset', (_req, res) => {
  agent.resetThread();
  res.json({ ok: true });
});

app.get('/api/case/:n/file/:name', (req, res) => {
  const bytes = agent.caseFile(req.params.n, req.params.name);
  if (!bytes) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${req.params.name.replace(/"/g, '')}"`);
  res.send(bytes);
});

app.listen(config.port, () => {
  console.log(`\n  Cleared demo running at ${config.appUrl}`);
  console.log(`  Mode:  ${MODE === 'live' ? 'LIVE (QuickBooks ' + config.quickbooks.environment + ' + Microsoft 365)' : 'OFFLINE rehearsal (fixtures, nothing is sent)'}`);
  console.log(`  Agent: ${AGENT === 'claude' ? 'Claude (' + config.anthropic.model + ')' : 'scripted (set ANTHROPIC_API_KEY for Claude)'}\n`);
});
