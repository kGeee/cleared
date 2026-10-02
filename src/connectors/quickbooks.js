// QuickBooks Online connector: OAuth 2.0 + Accounting API (read invoices/payments, add a note after approval).
import { config, round2 } from '../config.js';
import * as store from '../store.js';

const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const API_BASE =
  config.quickbooks.environment === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
const MINOR = 75;
const SCOPE = 'com.intuit.quickbooks.accounting';
const redirectUri = () => `${config.appUrl}/auth/quickbooks/callback`;

const basic = () =>
  'Basic ' + Buffer.from(`${config.quickbooks.clientId}:${config.quickbooks.clientSecret}`).toString('base64');

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basic(), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`QuickBooks token error ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

function saveTokens(t, extra = {}) {
  const prev = store.load('quickbooks');
  store.save('quickbooks', {
    ...prev,
    ...extra,
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + (t.expires_in - 60) * 1000,
  });
}

export function isConnected() {
  const t = store.load('quickbooks');
  return Boolean(t.refresh_token && t.realmId);
}

export function info() {
  const t = store.load('quickbooks');
  return { connected: isConnected(), company: t.companyName || null, environment: config.quickbooks.environment };
}

export function authUrl(state) {
  const q = new URLSearchParams({
    client_id: config.quickbooks.clientId,
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: redirectUri(),
    state,
  });
  return `${AUTH_URL}?${q}`;
}

export async function callback(query) {
  if (query.error) throw new Error(`QuickBooks: ${query.error}`);
  const t = await tokenRequest({ grant_type: 'authorization_code', code: query.code, redirect_uri: redirectUri() });
  saveTokens(t, { realmId: query.realmId });
  try {
    const ci = await api(`/companyinfo/${query.realmId}`);
    store.update('quickbooks', { companyName: ci.CompanyInfo?.CompanyName });
  } catch {
    /* name is cosmetic */
  }
}

export async function disconnect() {
  const t = store.load('quickbooks');
  if (t.refresh_token) {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { Authorization: basic(), Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: t.refresh_token }),
    }).catch(() => {});
  }
  store.save('quickbooks', {});
}

async function accessToken() {
  const t = store.load('quickbooks');
  if (!t.refresh_token) throw new Error('QuickBooks is not connected');
  if (t.access_token && Date.now() < t.expires_at) return t.access_token;
  const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  saveTokens(fresh);
  return fresh.access_token;
}

export async function api(pathname, { method = 'GET', body, query = {} } = {}) {
  const { realmId } = store.load('quickbooks');
  const q = new URLSearchParams({ ...query, minorversion: String(MINOR) });
  const url = `${API_BASE}/v3/company/${realmId}${pathname}?${q}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json.Fault?.Error?.map((e) => `${e.Message}: ${e.Detail}`).join('; ') || JSON.stringify(json);
    throw new Error(`QuickBooks ${method} ${pathname} failed (${res.status}): ${detail}`);
  }
  return json;
}

export async function query(sql) {
  const json = await api('/query', { query: { query: sql } });
  return json.QueryResponse || {};
}

const esc = (s) => String(s).replace(/'/g, "\\'");

function normalizeInvoice(inv) {
  const lines = (inv.Line || [])
    .filter((l) => l.DetailType === 'SalesItemLineDetail')
    .map((l) => ({
      description: l.Description || l.SalesItemLineDetail?.ItemRef?.name || 'Item',
      qty: Number(l.SalesItemLineDetail?.Qty ?? 0),
      rate: Number(l.SalesItemLineDetail?.UnitPrice ?? 0),
      amount: Number(l.Amount),
    }));
  const total = Number(inv.TotalAmt);
  const balance = Number(inv.Balance);
  return {
    id: inv.Id,
    syncToken: inv.SyncToken,
    docNumber: inv.DocNumber,
    customer: inv.CustomerRef?.name,
    customerId: inv.CustomerRef?.value,
    txnDate: inv.TxnDate,
    dueDate: inv.DueDate,
    terms: inv.SalesTermRef?.name || 'Net 30',
    poNumber: (inv.CustomerMemo?.value || '').replace(/^PO\s*/i, '') || null,
    lines,
    total,
    balance,
    status: balance <= 0 ? 'Paid' : balance < total ? 'Partially paid' : 'Open',
    privateNote: inv.PrivateNote || '',
  };
}

export async function getInvoice(docNumber) {
  let r = await query(`select * from Invoice where DocNumber = '${esc(docNumber)}'`);
  let inv = r.Invoice?.[0];
  if (!inv) {
    // Sandbox companies may have custom transaction numbers off; the seed script records the real Id.
    const seeded = store.load('seed-state').invoices?.[docNumber];
    if (seeded) inv = (await api(`/invoice/${seeded}`)).Invoice;
  }
  if (!inv) return null;
  const out = normalizeInvoice(inv);
  out.docNumber = String(docNumber);
  return out;
}

export async function getPayments(invoice) {
  const r = await query(`select * from Payment where CustomerRef = '${esc(invoice.customerId)}'`);
  const payments = [];
  for (const p of r.Payment || []) {
    for (const line of p.Line || []) {
      const linked = (line.LinkedTxn || []).some((t) => t.TxnType === 'Invoice' && t.TxnId === invoice.id);
      if (linked) {
        payments.push({
          id: p.Id,
          date: p.TxnDate,
          reference: p.PaymentRefNum || null,
          applied: Number(line.Amount),
          memo: p.PrivateNote || '',
        });
      }
    }
  }
  return { payments, totalPaid: round2(payments.reduce((s, p) => s + p.applied, 0)) };
}

export async function listOpenInvoices() {
  const r = await query(`select * from Invoice where Balance > '0' maxresults 50`);
  return (r.Invoice || []).map(normalizeInvoice);
}

// Write action: only ever called after a human approves in Cleared.
export async function addNote(invoice, note) {
  const current = (await api(`/invoice/${invoice.id}`)).Invoice;
  const PrivateNote = [current.PrivateNote, note].filter(Boolean).join('\n').slice(0, 4000);
  await api('/invoice', { method: 'POST', body: { Id: current.Id, SyncToken: current.SyncToken, sparse: true, PrivateNote } });
  return true;
}
