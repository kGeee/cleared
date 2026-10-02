// Self-test: runs the LIVE QuickBooks + Microsoft Graph code paths (seed, investigate, draft, approve, replies)
// against in-memory fakes of both APIs. No network, no accounts needed. Your ./data is backed up and restored.
//   npm test
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.QBO_CLIENT_ID = 'x'; process.env.QBO_CLIENT_SECRET = 'y';
process.env.MS_CLIENT_ID = 'x'; process.env.MS_CLIENT_SECRET = 'y';
process.env.STEP_MS = '0'; process.env.AGENT = 'scripted'; delete process.env.DEMO_MODE;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = ROOT + '/data';
fs.mkdirSync(DATA, { recursive: true });
const backup = {};
for (const f of fs.readdirSync(DATA)) backup[f] = fs.readFileSync(`${DATA}/${f}`);
for (const f of fs.readdirSync(DATA)) fs.unlinkSync(`${DATA}/${f}`);
fs.writeFileSync(`${DATA}/quickbooks.json`, JSON.stringify({ refresh_token: 'r', access_token: 'a', expires_at: 0, realmId: '999' }));
fs.writeFileSync(`${DATA}/microsoft.json`, JSON.stringify({ refresh_token: 'r', access_token: 'a', expires_at: 0, email: 'ar@fablegrove.test' }));

const db = { Customer: [], Item: [], Account: [{ Id: '79', Name: 'Sales', AccountType: 'Income' }], Invoice: [], Payment: [], prefs: { Id: '1', SyncToken: '0', SalesFormsPrefs: { CustomTxnNumbers: false } } };
const files = new Map(); const mail = []; const calls = [];
let id = 100;
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

function qboQuery(sql) {
  const m = sql.match(/select \* from (\w+)(?: where (\w+) (=|>) '([^']*)')?/i);
  const [, table, field, op, val] = m;
  let rows = db[table] || [];
  if (field) rows = rows.filter((r) => {
    const v = field === 'CustomerRef' ? r.CustomerRef.value : r[field];
    return op === '=' ? String(v) === val : Number(v) > Number(val);
  });
  return J({ QueryResponse: rows.length ? { [table]: rows } : {} });
}

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url); const method = opts.method || 'GET';
  calls.push(`${method} ${u.host}${decodeURIComponent(u.pathname)}`);
  const body = opts.body && typeof opts.body === 'string' ? (opts.body.startsWith('{') ? JSON.parse(opts.body) : opts.body) : opts.body;
  if (u.host.includes('oauth.platform.intuit.com') || u.host.includes('login.microsoftonline.com')) return J({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 });
  if (u.host.includes('sandbox-quickbooks')) {
    if (u.searchParams.get('minorversion') !== '75') throw new Error('minorversion missing');
    const p = u.pathname.replace('/v3/company/999', '');
    if (p === '/query') return qboQuery(u.searchParams.get('query'));
    if (p === '/preferences' && method === 'GET') return J({ Preferences: db.prefs });
    if (p === '/preferences') { db.prefs.SalesFormsPrefs.CustomTxnNumbers = body.SalesFormsPrefs.CustomTxnNumbers; return J({ Preferences: db.prefs }); }
    if (p === '/customer') { const c = { Id: String(++id), DisplayName: body.DisplayName }; db.Customer.push(c); return J({ Customer: c }); }
    if (p === '/item') { if (!body.IncomeAccountRef?.value) return J({ Fault: { Error: [{ Message: 'need acct' }] } }, 400); const c = { Id: String(++id), Name: body.Name }; db.Item.push(c); return J({ Item: c }); }
    if (p === '/invoice' && method === 'POST') {
      if (body.sparse) { const inv = db.Invoice.find((i) => i.Id === body.Id); inv.PrivateNote = body.PrivateNote; inv.SyncToken = String(+inv.SyncToken + 1); return J({ Invoice: inv }); }
      const cust = db.Customer.find((c) => c.Id === body.CustomerRef.value);
      const total = body.Line.reduce((s, l) => s + l.Amount, 0);
      const inv = { ...body, Id: String(++id), SyncToken: '0', DocNumber: db.prefs.SalesFormsPrefs.CustomTxnNumbers ? body.DocNumber : String(1000 + id), CustomerRef: { value: cust.Id, name: cust.DisplayName }, TotalAmt: total, Balance: total };
      db.Invoice.push(inv); return J({ Invoice: inv });
    }
    if (p.startsWith('/invoice/')) return J({ Invoice: db.Invoice.find((i) => i.Id === p.split('/')[2]) });
    if (p === '/payment') {
      for (const l of body.Line) { const inv = db.Invoice.find((i) => i.Id === l.LinkedTxn[0].TxnId); inv.Balance -= l.Amount; }
      const pm = { ...body, Id: String(++id) }; db.Payment.push(pm); return J({ Payment: pm });
    }
    if (p.startsWith('/companyinfo')) return J({ CompanyInfo: { CompanyName: 'Sandbox Co' } });
  }
  if (u.host === 'graph.microsoft.com') {
    const p = decodeURIComponent(u.pathname).replace('/v1.0', '');
    if (p === '/me') return J({ mail: 'ar@fablegrove.test', displayName: 'AR' });
    let m;
    if ((m = p.match(/^\/me\/drive\/root:\/(.+):\/content$/)) && method === 'PUT') { const fid = 'f' + ++id; files.set(m[1], { id: fid, bytes: Buffer.from(body) }); return J({ id: fid }, 201); }
    if ((m = p.match(/^\/me\/drive\/root:\/(.+):\/children$/))) {
      const kids = [...files.entries()].filter(([k]) => k.startsWith(m[1] + '/')).map(([k, v]) => ({ id: v.id, name: k.split('/').pop(), file: {}, webUrl: 'https://onedrive/' + v.id }));
      return kids.length ? J({ value: kids }) : J({ error: 'nf' }, 404);
    }
    if ((m = p.match(/^\/me\/drive\/items\/(.+)\/content$/))) { const f = [...files.values()].find((v) => v.id === m[1]); return new Response(f.bytes); }
    if (p === '/me/messages') {
      const q = u.searchParams.get('$search').replace(/"/g, '');
      const hits = mail.filter((x) => (x.message.subject + x.message.body.content).includes(q));
      return J({ value: hits.map((x) => ({ id: x.id, subject: x.message.subject, from: { emailAddress: { name: 'AR', address: 'ar@fablegrove.test' } }, receivedDateTime: x.at, hasAttachments: x.message.attachments.length > 0, bodyPreview: x.message.body.content.replace(/<[^>]+>/g, ' ').slice(0, 200) })) });
    }
    if ((m = p.match(/^\/me\/messages\/([^/]+)$/))) { const x = mail.find((y) => y.id === m[1]); return J({ uniqueBody: { content: x.message.body.content } }); }
    if ((m = p.match(/^\/me\/messages\/(.+)\/attachments$/))) return J({ value: mail.find((x) => x.id === m[1]).message.attachments });
    if (p === '/me/sendMail') { if (!body.message.toRecipients[0].emailAddress.address) throw new Error('no recipient'); mail.push({ id: 'm' + ++id, at: new Date().toISOString(), message: body.message }); return new Response(null, { status: 202 }); }
    if (p === '/me/mailFolders/sentitems/messages') return J({ value: mail.map((x) => ({ id: x.id, subject: x.message.subject, sentDateTime: x.at, webLink: 'https://outlook/x' })).reverse() });
  }
  throw new Error('UNHANDLED ' + method + ' ' + url);
};

let ok = true;
const check = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) ok = false; };
try {
  const realExit = process.exit; process.exit = (c) => { throw new Error('seed exited ' + c); };
  await import(ROOT + '/scripts/seed.js');
  await import(ROOT + '/scripts/seed.js?again'); // idempotency
  process.exit = realExit;
  check(db.Invoice.length === 10 && db.Payment.length === 5 && db.Customer.length === 5, `seed idempotent: ${db.Customer.length} customers, ${db.Invoice.length} invoices, ${db.Payment.length} payments`);
  check(db.Invoice.find((i) => i.DocNumber === '2079')?.Balance === 720, 'invoice 2079 balance 720');
  check(files.size === 34 - 5 && mail.length === 5, `uploaded ${files.size} packet files, ${mail.length} payment advice emails`);

  const cases = await import(ROOT + '/src/cases.js');
  cases.reset();
  const q = await cases.queue();
  check(q.rows.length === 10 && q.totals.withheld === 3466 && q.payers.length === 5, `queue: ${q.rows.length} rows from ${q.payers.length} payers, $${q.totals.withheld} withheld`);
  const expect = {
    2086: ['request_evidence', 'request', 240], 2087: ['dispute', 'dispute', 144], 2088: ['valid', 'accept', 0],
    2079: ['dispute', 'dispute', 720], 2081: ['dispute', 'dispute', 120], 2083: ['valid', 'accept', 0],
    2097: ['dispute', 'dispute', 144], 2099: ['valid', 'accept', 0], 2104: ['valid', 'accept', 0], 2106: ['dispute', 'dispute', 500],
  };
  for (const [n, [verdict, action, amount]] of Object.entries(expect)) {
    const ev = [];
    const c = await cases.investigate(n, (e) => ev.push(e), { pace: false });
    const rec = c.options.find((o) => o.strength === 'recommended').id;
    check(c.assessment.verdict === verdict && rec === action && c.assessment.amount === amount && ev.filter((e) => e.type === 'step' && e.state === 'done').length === 4, `${n} ${c.assessment.type}: ${c.assessment.verdict} $${c.assessment.amount}, recommends ${rec}`);
    const d = await cases.draft(n, action);
    const body = action === 'accept' ? { action } : { action, subject: d.subject, body: d.body, attachments: d.attachments.map((a) => a.name) };
    const after = await cases.approve(n, body);
    check(after.status === (action === 'accept' ? 'accepted' : 'waiting'), `${n}: approved -> ${after.status}${after.sent ? ` · "${after.sent.subject}" · ${after.sent.attachments.length} attachments` : ''}`);
  }
  let err = null; try { await cases.approve('2086', { action: 'request', subject: 'x', body: 'x' }); } catch (e) { err = e.message; }
  check(/already/.test(err || ''), 'double-approve blocked');
  const sent = mail.slice(5);
  check(sent.length === 6, `sent ${sent.length} follow-ups`);
  const s2079 = sent.find((m) => m.message.subject.includes('2079'));
  check(s2079 && s2079.message.attachments.length === 5, '2079 dispute carries both PODs (5 attachments)');
  let r = await cases.checkReplies('2079');
  check(r.found === false, 'no reply yet -> not found');
  mail.push({ id: 'm' + ++id, at: new Date(Date.now() + 5000).toISOString(), message: { subject: 'RE: ' + s2079.message.subject, body: { content: 'We matched the West POD. Deduction KD-77310 reversed; will be added to the next remittance.' }, attachments: [] } });
  r = await cases.checkReplies('2079');
  check(r.found && r.case.status === 'resolved' && r.case.outcome.amount === 720, `reply found -> ${r.case.status}, recovered ${r.case.outcome?.amount}`);
  const q2 = await cases.queue();
  check(q2.totals.recovered === 720 && q2.totals.accepted === 1098 && q2.totals.inDispute === 1148, `totals ${JSON.stringify({ recovered: q2.totals.recovered, accepted: q2.totals.accepted, inDispute: q2.totals.inDispute })}`);
  check(db.Invoice.every((i) => /\[Cleared\]/.test(i.PrivateNote || '')), 'QuickBooks notes written after approval');
  const f = await cases.file('2079', 'POD_2079_West.pdf');
  check(f && f.length > 1000, 'file served');
} catch (e) { console.error(e); ok = false; }
finally {
  for (const f of fs.readdirSync(DATA)) fs.unlinkSync(`${DATA}/${f}`);
  for (const [f, b] of Object.entries(backup)) fs.writeFileSync(`${DATA}/${f}`, b);
}
console.log(ok ? '\nALL PASS' : '\nFAILURES');
process.exit(ok ? 0 : 1);
