// Microsoft 365 connector via Microsoft Graph: Outlook (search, read attachments, send) and OneDrive (read files).
// One app registration and one sign-in cover both.
import { config } from '../config.js';
import * as store from '../store.js';

const { tenant } = config.microsoft;
const AUTH_URL = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
const TOKEN_URL = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
const GRAPH = 'https://graph.microsoft.com/v1.0';
// Files.ReadWrite is only needed by the seed script (to upload the demo packet). Cleared itself only reads files.
const SCOPES = 'openid profile email offline_access User.Read Mail.Read Mail.Send Files.ReadWrite';
const redirectUri = () => `${config.appUrl}/auth/microsoft/callback`;

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.microsoft.clientId,
      client_secret: config.microsoft.clientSecret,
      redirect_uri: redirectUri(),
      scope: SCOPES,
      ...params,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Microsoft token error ${res.status}: ${json.error_description || JSON.stringify(json)}`);
  return json;
}

function saveTokens(t, extra = {}) {
  const prev = store.load('microsoft');
  store.save('microsoft', {
    ...prev,
    ...extra,
    access_token: t.access_token,
    refresh_token: t.refresh_token || prev.refresh_token,
    expires_at: Date.now() + (t.expires_in - 60) * 1000,
  });
}

export function isConnected() {
  return Boolean(store.load('microsoft').refresh_token);
}

export function info() {
  const t = store.load('microsoft');
  return { connected: isConnected(), email: t.email || null };
}

export function authUrl(state) {
  const q = new URLSearchParams({
    client_id: config.microsoft.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: SCOPES,
    state,
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${q}`;
}

export async function callback(query) {
  if (query.error) throw new Error(`Microsoft: ${query.error_description || query.error}`);
  const t = await tokenRequest({ grant_type: 'authorization_code', code: query.code });
  saveTokens(t);
  const me = await graph('/me?$select=displayName,mail,userPrincipalName');
  store.update('microsoft', { email: me.mail || me.userPrincipalName, name: me.displayName });
}

export async function disconnect() {
  store.save('microsoft', {});
}

async function accessToken() {
  const t = store.load('microsoft');
  if (!t.refresh_token) throw new Error('Microsoft 365 is not connected');
  if (t.access_token && Date.now() < t.expires_at) return t.access_token;
  const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  saveTokens(fresh);
  return fresh.access_token;
}

export async function graph(pathname, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const res = await fetch(pathname.startsWith('http') ? pathname : GRAPH + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      ...(body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph ${method} ${pathname} failed (${res.status}): ${text.slice(0, 400)}`);
  }
  if (raw) return res;
  if (res.status === 202 || res.status === 204) return {};
  return res.json();
}

export function myEmail() {
  return store.load('microsoft').email;
}

const packetPath = (invoiceNumber) => `${config.microsoft.packetRoot}/Invoice ${invoiceNumber} packet`;
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

// Outlook: payment advices are emails whose subject says "payment advice" or "remittance", with a PDF attached.
async function toRemittance(msg) {
  const att = await graph(`/me/messages/${msg.id}/attachments`);
  const pdf = (att.value || []).find((a) => /pdf/i.test(a.contentType || '') || /\.pdf$/i.test(a.name || ''));
  return {
    message: {
      id: msg.id,
      subject: msg.subject,
      from: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || 'Payer',
      fromAddress: msg.from?.emailAddress?.address || '',
      received: msg.receivedDateTime,
      preview: msg.bodyPreview,
    },
    attachment: pdf ? { name: pdf.name, bytes: Buffer.from(pdf.contentBytes, 'base64') } : null,
  };
}

async function searchRemittances(term) {
  const search = encodeURIComponent(`"${term}"`);
  const r = await graph(`/me/messages?$search=${search}&$top=50&$select=id,subject,from,receivedDateTime,hasAttachments,bodyPreview`);
  // Match on subject only, so Cleared's own follow-ups (which mention "payment advice" in the body) never count.
  return (r.value || []).filter((m) => m.hasAttachments && /(remittance|payment advice)/i.test(m.subject || ''));
}

// Every payment advice in the mailbox (one per payer / payment), newest first, de-duplicated.
export async function listRemittances() {
  const seen = new Set();
  const out = [];
  const msgs = (await searchRemittances('payment advice')).sort((a, b) => new Date(b.receivedDateTime) - new Date(a.receivedDateTime));
  for (const m of msgs) {
    const key = m.subject.trim().toLowerCase();
    if (seen.has(key)) continue; // a self-sent seed email appears in Inbox and Sent Items
    seen.add(key);
    const r = await toRemittance(m);
    if (r.attachment) out.push(r);
  }
  return out;
}

// The payment advice that covers one invoice.
export async function findRemittance(invoiceNumber) {
  const msgs = await searchRemittances(String(invoiceNumber));
  const msg = msgs.find((m) => (m.subject || '').includes(String(invoiceNumber))) || msgs[0];
  return msg ? toRemittance(msg) : null;
}

export function deductionsEmailFor() {
  return null; // live mode sends to DEDUCTIONS_TO or your own address
}

// Outlook: find the distributor's reply to a follow-up Cleared sent (newest "RE:" after the send time).
export async function findReply(invoiceNumber, sentSubject, sinceIso) {
  const search = encodeURIComponent(`"Invoice ${invoiceNumber}"`);
  const r = await graph(`/me/messages?$search=${search}&$top=25&$select=id,subject,from,receivedDateTime,bodyPreview,parentFolderId`);
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const want = norm(sentSubject);
  const since = new Date(sinceIso).getTime();
  const hits = (r.value || [])
    .filter((m) => /^(re|aw|sv)\s*:/i.test(m.subject || '') && norm(m.subject).includes(want) && new Date(m.receivedDateTime).getTime() > since)
    .sort((a, b) => new Date(b.receivedDateTime) - new Date(a.receivedDateTime));
  const m = hits[0];
  if (!m) return null;
  let text = m.bodyPreview || '';
  try {
    const full = await graph(`/me/messages/${m.id}?$select=uniqueBody`, { headers: { Prefer: 'outlook.body-content-type="text"' } });
    text = (full.uniqueBody?.content || text).trim();
  } catch {
    /* preview is enough */
  }
  return { from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || 'Distributor', at: m.receivedDateTime, subject: m.subject, text: text.slice(0, 1200) };
}

// OneDrive: list the invoice packet folder.
export async function listPacket(invoiceNumber) {
  const folder = packetPath(invoiceNumber);
  try {
    const r = await graph(`/me/drive/root:/${encPath(folder)}:/children?$select=id,name,size,file,webUrl`);
    return { folder, files: (r.value || []).filter((f) => f.file).map((f) => ({ id: f.id, name: f.name, webUrl: f.webUrl })) };
  } catch (e) {
    if (/\(404\)/.test(e.message)) return { folder, files: [] };
    throw e;
  }
}

export async function downloadFile(id) {
  const res = await graph(`/me/drive/items/${id}/content`, { raw: true });
  return Buffer.from(await res.arrayBuffer());
}

export async function uploadFile(relPath, bytes) {
  return graph(`/me/drive/root:/${encPath(relPath)}:/content`, {
    method: 'PUT',
    body: new Uint8Array(bytes),
    headers: { 'Content-Type': 'application/pdf' },
  });
}

export async function sendMail({ to, subject, html, attachments = [] }) {
  await graph('/me/sendMail', {
    method: 'POST',
    body: {
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: to } }],
        attachments: attachments.map((a) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: a.name,
          contentType: 'application/pdf',
          contentBytes: Buffer.from(a.bytes).toString('base64'),
        })),
      },
      saveToSentItems: true,
    },
  });
  // Fetch the Sent Items copy so the UI can show the real sent message.
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 900));
    const r = await graph(
      `/me/mailFolders/sentitems/messages?$top=5&$orderby=sentDateTime desc&$select=id,subject,sentDateTime,toRecipients,webLink`,
    ).catch(() => ({ value: [] }));
    const hit = (r.value || []).find((m) => m.subject === subject);
    if (hit) return { id: hit.id, sentAt: hit.sentDateTime, webLink: hit.webLink };
  }
  return { id: null, sentAt: new Date().toISOString(), webLink: null };
}
