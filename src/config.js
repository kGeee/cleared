import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const SCENARIOS = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'scenarios.json'), 'utf8'));
export const DOCS_DIR = path.join(ROOT, 'fixtures', 'docs');

const env = process.env;
const port = Number(env.PORT || 3000);

export const config = {
  port,
  appUrl: (env.APP_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  quickbooks: {
    clientId: env.QBO_CLIENT_ID || '',
    clientSecret: env.QBO_CLIENT_SECRET || '',
    environment: env.QBO_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
  },
  microsoft: {
    clientId: env.MS_CLIENT_ID || '',
    clientSecret: env.MS_CLIENT_SECRET || '',
    tenant: env.MS_TENANT || 'common',
    packetRoot: env.ONEDRIVE_ROOT || 'Cleared Demo',
  },
  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY || '',
    model: env.CLAUDE_MODEL || 'claude-sonnet-5-5',
  },
  // Where approved evidence requests go. Use an inbox you control so you can show it arriving.
  deductionsTo: env.DEDUCTIONS_TO || '',
  approverName: env.APPROVER_NAME || 'You',
  disputeWindowDays: Number(env.DISPUTE_WINDOW_DAYS || 30),
  // Minimum time per agent step, so the panel reads at a human pace on stage.
  stepMs: Number(env.STEP_MS ?? 1000),
};

const liveConfigured = Boolean(
  config.quickbooks.clientId && config.quickbooks.clientSecret && config.microsoft.clientId && config.microsoft.clientSecret,
);

// DEMO_MODE=offline forces rehearsal mode; otherwise live if both apps are configured.
export const MODE = env.DEMO_MODE === 'offline' || !liveConfigured ? 'offline' : 'live';
export const AGENT = config.anthropic.apiKey && env.AGENT !== 'scripted' ? 'claude' : 'scripted';

export function money(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
export function moneyExact(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export const round2 = (n) => Math.round(Number(n) * 100) / 100;
