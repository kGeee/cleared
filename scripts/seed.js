// Seeds the demo scenario into your QuickBooks sandbox and Microsoft 365 account.
// Run AFTER connecting both apps in the Cleared UI (tokens are stored in ./data):
//   npm run seed            (both)
//   npm run seed -- qbo     (QuickBooks only)
//   npm run seed -- ms      (Microsoft only)
// Safe to re-run: it skips anything that already exists.
import { MODE, config } from '../src/config.js';
import * as qb from '../src/connectors/quickbooks.js';
import * as ms from '../src/connectors/microsoft.js';
import * as store from '../src/store.js';
import { brand, payers, invoices, invoicesFor, gross, paid, remitSubject, packetFiles, docBytes } from '../src/scenario.js';

const only = process.argv[2];
const log = (...a) => console.log('  ', ...a);
const esc = (s) => String(s).replace(/'/g, "\\'");

if (MODE !== 'live') {
  console.error('Live mode is not configured. Fill in QBO_* and MS_* in .env first (see README).');
  process.exit(1);
}

async function seedQuickBooks() {
  if (!qb.isConnected()) throw new Error('Connect QuickBooks in the Cleared UI first.');
  console.log('QuickBooks sandbox');

  // Allow custom invoice numbers (2079–2106).
  try {
    const prefs = (await qb.api('/preferences')).Preferences;
    if (!prefs.SalesFormsPrefs?.CustomTxnNumbers) {
      await qb.api('/preferences', { method: 'POST', body: { Id: prefs.Id, SyncToken: prefs.SyncToken, sparse: true, SalesFormsPrefs: { CustomTxnNumbers: true } } });
      log('enabled custom transaction numbers');
    }
  } catch (e) {
    log('could not enable custom transaction numbers (will fall back to stored IDs):', e.message);
  }

  // Item
  const itemName = 'Fable Grove product case';
  let item = (await qb.query(`select * from Item where Name = '${itemName}'`)).Item?.[0];
  if (!item) {
    const income = (await qb.query(`select * from Account where AccountType = 'Income' maxresults 1`)).Account?.[0];
    item = (await qb.api('/item', { method: 'POST', body: { Name: itemName, Type: 'Service', Description: brand.product, UnitPrice: brand.unitPrice, IncomeAccountRef: { value: income.Id } } })).Item;
    log('created item', itemName);
  }

  const seed = store.load('seed-state');
  seed.invoices = seed.invoices || {};
  seed.payments = seed.payments || {};

  for (const p of payers) {
    // Customer
    let cust = (await qb.query(`select * from Customer where DisplayName = '${esc(p.name)}'`)).Customer?.[0];
    if (!cust) {
      cust = (await qb.api('/customer', { method: 'POST', body: { DisplayName: p.name, CompanyName: p.name } })).Customer;
      log('created customer', p.name);
    }
    // Invoices
    const ids = {};
    for (const s of invoicesFor(p.id)) {
      const existing = await qb.getInvoice(s.docNumber);
      if (existing) {
        ids[s.docNumber] = seed.invoices[s.docNumber] = existing.id;
        continue;
      }
      const inv = (
        await qb.api('/invoice', {
          method: 'POST',
          body: {
            DocNumber: s.docNumber,
            TxnDate: s.txnDate,
            DueDate: s.dueDate,
            CustomerRef: { value: cust.Id },
            CustomerMemo: { value: `PO ${s.poNumber}` },
            Line: [{ DetailType: 'SalesItemLineDetail', Amount: gross(s), Description: brand.product, SalesItemLineDetail: { ItemRef: { value: item.Id }, Qty: s.qty, UnitPrice: s.rate } }],
          },
        })
      ).Invoice;
      ids[s.docNumber] = seed.invoices[s.docNumber] = inv.Id;
      log(`created invoice ${s.docNumber} for ${p.name} (Id ${inv.Id}) $${gross(s)}`);
    }
    store.save('seed-state', seed);
    // Payment, net of deductions
    const r = p.remittance;
    if (seed.payments[p.id]) continue;
    const lines = invoicesFor(p.id).map((s) => ({ Amount: paid(s), LinkedTxn: [{ TxnId: ids[s.docNumber], TxnType: 'Invoice' }] }));
    const total = lines.reduce((a, l) => a + l.Amount, 0);
    const pmt = (
      await qb.api('/payment', {
        method: 'POST',
        body: { CustomerRef: { value: cust.Id }, TotalAmt: total, TxnDate: r.paymentDate, PaymentRefNum: r.method === 'EFT' ? `EFT ${r.number}` : r.number, PrivateNote: `${p.name} ${r.method} ${r.number}. Short-paid per payment advice.`, Line: lines },
      })
    ).Payment;
    seed.payments[p.id] = pmt.Id;
    store.save('seed-state', seed);
    log(`created ${p.name} payment ${r.method} ${r.number} $${total}`);
  }
}

async function seedMicrosoft() {
  if (!ms.isConnected()) throw new Error('Connect Microsoft 365 in the Cleared UI first.');
  console.log('Microsoft 365 (' + ms.myEmail() + ')');

  for (const s of invoices) {
    for (const name of packetFiles(s.docNumber)) {
      await ms.uploadFile(`${config.microsoft.packetRoot}/Invoice ${s.docNumber} packet/${name}`, docBytes(name));
    }
    log(`uploaded OneDrive/${config.microsoft.packetRoot}/Invoice ${s.docNumber} packet (${packetFiles(s.docNumber).length} files)`);
  }

  const existing = new Set((await ms.listRemittances().catch(() => [])).map((r) => r.message.subject.trim().toLowerCase()));
  for (const p of payers) {
    const subject = remitSubject(p);
    if (existing.has(subject.toLowerCase())) {
      log('payment advice already in mailbox:', subject);
      continue;
    }
    const r = p.remittance;
    const rows = invoicesFor(p.id)
      .map((s) => `<tr><td>${s.docNumber}</td><td>$${gross(s).toFixed(2)}</td><td>${s.deduction.code} ${s.deduction.ref}</td><td>${s.deduction.reason}${s.deduction.cases ? `: ${s.deduction.cases} cases` : ''}</td><td>-$${s.deduction.amount.toFixed(2)}</td><td>$${paid(s).toFixed(2)}</td></tr>`)
      .join('');
    await ms.sendMail({
      to: ms.myEmail(),
      subject,
      html: `<p>Payment advice for ${r.method} ${r.number}, paid ${r.paymentDate}. Remittance detail attached.</p>
<table border="1" cellpadding="4" style="border-collapse:collapse"><tr><th>Invoice</th><th>Gross</th><th>Deduction ref</th><th>Reason</th><th>Deducted</th><th>Paid</th></tr>${rows}</table>
<p>${r.from} (demo data)</p>`,
      attachments: [{ name: r.fileName, bytes: docBytes(r.fileName) }],
    });
    log('sent', subject);
  }
  log('(Outlook search indexing can take a minute or two)');
}

try {
  if (!only || only === 'qbo') await seedQuickBooks();
  if (!only || only === 'ms') await seedMicrosoft();
  console.log('\nDone. Open Cleared: 10 short-pays across 5 payers are waiting.');
} catch (e) {
  console.error('\nSeed failed:', e.message);
  process.exit(1);
}
