// Seeds the demo scenario into your QuickBooks sandbox and Microsoft 365 account.
// Run AFTER connecting both apps in the Cleared UI (tokens are stored in ./data):
//   npm run seed            (both)
//   npm run seed -- qbo     (QuickBooks only)
//   npm run seed -- ms      (Microsoft only)
// Safe to re-run: it skips anything that already exists.
import fs from 'node:fs';
import path from 'node:path';
import { SCENARIOS, DOCS_DIR, MODE, config } from '../src/config.js';
import * as qb from '../src/connectors/quickbooks.js';
import * as ms from '../src/connectors/microsoft.js';
import * as store from '../src/store.js';

const { brand, customer, remittance, invoices } = SCENARIOS;
const only = process.argv[2];
const log = (...a) => console.log('  ', ...a);

if (MODE !== 'live') {
  console.error('Live mode is not configured. Fill in QBO_* and MS_* in .env first (see README).');
  process.exit(1);
}

async function seedQuickBooks() {
  if (!qb.isConnected()) throw new Error('Connect QuickBooks in the Cleared UI first.');
  console.log('QuickBooks sandbox');

  // 1. Allow custom invoice numbers so we can use 2086/2087/2088.
  try {
    const prefs = (await qb.api('/preferences')).Preferences;
    if (!prefs.SalesFormsPrefs?.CustomTxnNumbers) {
      await qb.api('/preferences', {
        method: 'POST',
        body: { Id: prefs.Id, SyncToken: prefs.SyncToken, sparse: true, SalesFormsPrefs: { CustomTxnNumbers: true } },
      });
      log('enabled custom transaction numbers');
    }
  } catch (e) {
    log('could not enable custom transaction numbers (will fall back to stored IDs):', e.message);
  }

  // 2. Customer
  let cust = (await qb.query(`select * from Customer where DisplayName = '${customer.name}'`)).Customer?.[0];
  if (!cust) {
    cust = (await qb.api('/customer', { method: 'POST', body: { DisplayName: customer.name, CompanyName: customer.name } })).Customer;
    log('created customer', customer.name);
  } else log('customer exists', customer.name);

  // 3. Item
  const itemName = 'Fable Grove product case';
  let item = (await qb.query(`select * from Item where Name = '${itemName}'`)).Item?.[0];
  if (!item) {
    const income = (await qb.query(`select * from Account where AccountType = 'Income' maxresults 1`)).Account?.[0];
    item = (
      await qb.api('/item', {
        method: 'POST',
        body: { Name: itemName, Type: 'Service', Description: brand.product, UnitPrice: brand.unitPrice, IncomeAccountRef: { value: income.Id } },
      })
    ).Item;
    log('created item', itemName);
  } else log('item exists', itemName);

  // 4. Invoices
  const seed = store.load('seed-state');
  seed.invoices = seed.invoices || {};
  const created = {};
  for (const s of invoices) {
    const existing = await qb.getInvoice(s.docNumber);
    if (existing) {
      created[s.docNumber] = existing.id;
      seed.invoices[s.docNumber] = existing.id;
      log(`invoice ${s.docNumber} exists (Id ${existing.id})`);
      continue;
    }
    const amount = s.qty * brand.unitPrice;
    const inv = (
      await qb.api('/invoice', {
        method: 'POST',
        body: {
          DocNumber: s.docNumber,
          TxnDate: s.txnDate,
          DueDate: s.dueDate,
          CustomerRef: { value: cust.Id },
          CustomerMemo: { value: `PO ${s.poNumber}` },
          Line: [
            {
              DetailType: 'SalesItemLineDetail',
              Amount: amount,
              Description: brand.product,
              SalesItemLineDetail: { ItemRef: { value: item.Id }, Qty: s.qty, UnitPrice: brand.unitPrice },
            },
          ],
        },
      })
    ).Invoice;
    created[s.docNumber] = inv.Id;
    seed.invoices[s.docNumber] = inv.Id;
    log(`created invoice ${s.docNumber} (Id ${inv.Id}, DocNumber ${inv.DocNumber}) $${amount}`);
  }
  store.save('seed-state', seed);

  // 5. Payment (check 7741) applied across the three invoices, net of UNFI's deductions.
  if (seed.paymentId) {
    log('payment exists (Id ' + seed.paymentId + ')');
  } else {
    const lines = invoices.map((s) => ({
      Amount: s.qty * brand.unitPrice - s.deduction.cases * brand.unitPrice,
      LinkedTxn: [{ TxnId: created[s.docNumber], TxnType: 'Invoice' }],
    }));
    const total = lines.reduce((a, l) => a + l.Amount, 0);
    const pmt = (
      await qb.api('/payment', {
        method: 'POST',
        body: {
          CustomerRef: { value: cust.Id },
          TotalAmt: total,
          TxnDate: remittance.paymentDate,
          PaymentRefNum: remittance.checkNumber,
          PrivateNote: `UNFI check ${remittance.checkNumber}. Short-paid per payment advice.`,
          Line: lines,
        },
      })
    ).Payment;
    store.update('seed-state', { paymentId: pmt.Id });
    log(`created payment check ${remittance.checkNumber} $${total} (Id ${pmt.Id})`);
  }
}

async function seedMicrosoft() {
  if (!ms.isConnected()) throw new Error('Connect Microsoft 365 in the Cleared UI first.');
  console.log('Microsoft 365 (' + ms.myEmail() + ')');

  for (const s of invoices) {
    for (const kind of ['Invoice', 'Manifest', 'POD']) {
      const name = `${kind}_${s.docNumber}.pdf`;
      const rel = `${config.microsoft.packetRoot}/Invoice ${s.docNumber} packet/${name}`;
      await ms.uploadFile(rel, fs.readFileSync(path.join(DOCS_DIR, name)));
      log('uploaded OneDrive/' + rel);
    }
  }

  const already = await ms.findRemittance(invoices[0].docNumber).catch(() => null);
  if (already) {
    log('remittance email already in mailbox:', already.message.subject);
    return;
  }
  const rows = invoices
    .map((s) => {
      const gross = s.qty * brand.unitPrice;
      const ded = s.deduction.cases * brand.unitPrice;
      return `<tr><td>${s.docNumber}</td><td>$${gross.toFixed(2)}</td><td>${s.deduction.code} ${s.deduction.reference}</td><td>${s.deduction.reason}: ${s.deduction.cases} cases</td><td>-$${ded.toFixed(2)}</td><td>$${(gross - ded).toFixed(2)}</td></tr>`;
    })
    .join('');
  await ms.sendMail({
    to: ms.myEmail(),
    subject: remittance.emailSubject,
    html: `<p>Payment advice for check ${remittance.checkNumber}, paid ${remittance.paymentDate}. Remittance detail attached.</p>
<table border="1" cellpadding="4" style="border-collapse:collapse"><tr><th>Invoice</th><th>Gross</th><th>Deduction ref</th><th>Reason</th><th>Deducted</th><th>Paid</th></tr>${rows}</table>
<p>UNFI Accounts Payable (demo data)</p>`,
    attachments: [{ name: remittance.fileName, bytes: fs.readFileSync(path.join(DOCS_DIR, remittance.fileName)) }],
  });
  log('sent remittance email to', ms.myEmail(), '(search indexing can take a minute)');
}

try {
  if (!only || only === 'qbo') await seedQuickBooks();
  if (!only || only === 'ms') await seedMicrosoft();
  console.log('\nDone. Open Cleared and click Invoice 2086 → Investigate.');
} catch (e) {
  console.error('\nSeed failed:', e.message);
  process.exit(1);
}
