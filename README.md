# Cleared · Finance teammate demo

This is the Finance segment of the Cleared product film, built as an interactive workspace you click through.

- **The queue.** Cleared reads UNFI's payment advice from **Outlook** and lists every short-paid invoice, with totals for withheld, waiting and recovered money, plus the dispute deadline.
- **Investigate.** Click a short-pay, then **Investigate**. Four checks run as you watch:
  1. **Billed vs. paid** from **QuickBooks**, shown as a bar with the short amount.
  2. **What UNFI says**, read from the payment advice PDF: code, reference, cases × price.
  3. **What the paperwork shows**, read from the invoice packet in **OneDrive**. A case trail runs Billed → Shipped → Accepted → Paid for, so you can see where the cases go missing. Click any document to open it next to what Cleared read from it.
  4. **What should we do?** Cleared states what the evidence supports and recommends one of three actions. You can pick a different one.
- **Act.** Edit the email, toggle attachments and click **Approve & send**. The email goes out from Outlook and a note is added to the invoice in QuickBooks. **Nothing is sent or written until you approve.**
- **Follow up.** The case moves to *Waiting on* the payer. When they reply (in live mode, use **Check for replies**), Cleared reads the reply, marks the money recovered and updates the totals.

There are 10 short-pays across 5 payers, drawn from the product film. They cover six deduction types, so you can show judgment and not just automation:

| Invoice | Payer | Deduction | What the evidence shows | Cleared recommends |
|---|---|---|---|---|
| **2086** (the film) | UNFI | Shortage, 10 cases, $240 | POD signed, no accepted count | Request the receiving count |
| **2087** | UNFI | Shortage, 6 cases, $144 | POD: all 80 accepted | Dispute $144 |
| **2088** | UNFI | Damage, 4 cases, $96 | POD: 4 crushed, refused | Accept (valid) |
| **2079** (film's PO 1042) | KeHE | Shortage, 30 cases, $720 | Split shipment: East 90 + West 30 PODs; KeHE only matched East | Dispute $720 |
| **2081** | KeHE | Price, $120 | Paid the new $22 cost; it starts Nov 1, invoice is Aug 25 | Dispute $120 |
| **2083** | KeHE | Promo chargeback, $180 | Matches $1.50 × 120 cases in the agreement | Accept (valid) |
| **2097** | Walmart | OTIF fine (the film's 3%), $144 | Walmart's DC moved the appointment; 200/200 accepted | Dispute the fine |
| **2099** | Walmart | OTIF fine, $72 | Carrier missed the appointment, 2 days late | Accept (pursue the carrier) |
| **2104** | Maple Market (film's launch) | Slotting, $750 | Matches the signed agreement | Accept (valid) |
| **2106** | Harbor Pantry (film's launch) | Slotting, $1,000 | Agreement says $500 | Dispute $500 |

In total, $3,466 is withheld across 5 payment advices. KeHE's dispute window closes first, in 9 days, so it's highlighted.

## 1. Run it now (offline rehearsal, 2 minutes)

You need Node.js 18 or newer.

```bash
npm install
npm run offline
```

Open http://localhost:3000. The Connect buttons simulate sign-in, the data comes from `fixtures/`, and nothing is sent. The UI is identical to live mode. A yellow badge in the corner says "Offline rehearsal".

## 2. Go live (about 45 minutes, one time)

Copy `.env.example` to `.env`, then fill in each section below.

### QuickBooks (about 10 min)
1. Sign in at https://developer.intuit.com, then go to **Dashboard → Create an app → QuickBooks Online and Payments**. Select the **Accounting** scope.
2. Under **Keys & credentials (Development)**, add this redirect URI: `http://localhost:3000/auth/quickbooks/callback`
3. Copy the Client ID and Client Secret into `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET`.
4. Intuit gives you a free sandbox company automatically. That's where the demo data goes.

### Microsoft 365: Outlook + OneDrive (about 15 min)
1. Go to https://entra.microsoft.com (or portal.azure.com), then **App registrations → New registration**.
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
   - Redirect URI, platform **Web**: `http://localhost:3000/auth/microsoft/callback`
2. Under **Certificates & secrets**, create a new client secret and copy its **Value** into `MS_CLIENT_SECRET`. Put the Application (client) ID into `MS_CLIENT_ID`.
3. Under **API permissions**, add these Microsoft Graph delegated permissions: `User.Read`, `Mail.Read`, `Mail.Send`, `Files.ReadWrite`, `offline_access`.
4. Use a dedicated demo mailbox. A free Outlook.com account works with these permissions. If you have no Entra directory, a free Azure account gives you one.

### Claude (2 min)
Put an API key from https://console.anthropic.com into `ANTHROPIC_API_KEY`. Claude reads the PDFs and drafts the emails. Without a key, a built-in parser and evidence-based templates do both, so the demo still works.

### Optional
- `DEDUCTIONS_TO`: where approved emails go. Use a second inbox you control and have it open on your phone, so the room sees the email arrive.
- `APPROVER_NAME`: the name shown on the audit line, e.g. "Approved by Priya · 3:12 PM".

### Seed and run
```bash
npm start                # open http://localhost:3000 and Connect both apps
npm run seed             # loads the film's data into your QuickBooks sandbox, OneDrive and Outlook
```
Wait a minute or two after seeding. Outlook search needs time to index the payment advice emails. Then open Cleared.

The seed script is safe to re-run. It creates:
- **QuickBooks:** 5 customers (UNFI, KeHE, Walmart, Maple Market, Harbor Pantry), 10 invoices, and one payment per payer, applied net of deductions.
- **OneDrive:** `Cleared Demo/Invoice <n> packet/` for each invoice. Depending on the type, it holds invoices, manifests, PODs, purchase orders, appointment records, cost change notices, promotion and slotting agreements: 29 files in all.
- **Outlook:** 5 payment advice emails, one per payer, each with its remittance PDF attached. They're sent to yourself, so the sender shows as you.

---

## 3. The 3-minute run of show

1. **Play the film** (2:05).
2. "Everything in the Finance segment is live: real QuickBooks, Outlook and OneDrive, with sandbox data." Point at the totals strip: $3,466 withheld by five payers, and KeHE's window closes in 9 days.
3. Click **Invoice 2086**, then **Investigate**. Narrate as each check fills in, and as the chips at the top light up QuickBooks, then Outlook, then OneDrive.
4. Point at the case trail: "120 billed, 120 shipped, **?** accepted, 110 paid for. That question mark is the whole case." Click the POD to show the document next to what Cleared read.
5. The recommendation is pre-selected. Click **Dispute** to show that the draft changes and why it's "Not advised". Switch back, edit a word, and click **Approve & send**. Show the email arriving on your phone.
6. Reply from your phone ("Receiving shows 120 accepted, deduction reversed"), then click **Check for replies**. **$240 recovered** appears and the totals update. (Offline: **Simulate UNFI's reply**.)
7. "Here's the film's split shipment." Open **KeHE 2079**: two PODs, East 90 + West 30, and KeHE only matched East. Then show **Walmart 2097**: the OTIF fine is only there because Walmart's own DC moved the appointment.
8. "Not every deduction is worth fighting." Open **2099** or **2104**: the carrier really was late, or the slotting fee matches the agreement, so Cleared recommends accepting it.
9. Click **Reset demo** before the next run. **Check all** runs every case at once, if you want to show the whole queue triaged in seconds.

**If anything breaks on stage:** stop the server and run `npm run offline`. It's the same UI and the same flow, with no network needed.

## 4. What's real, and what to say about it

- **Real:** OAuth to QuickBooks and Microsoft 365, reading invoices, payments, mail, attachments and files, Claude reading the PDFs, sending through Outlook, writing a QuickBooks note, reading the distributor's reply, and the audit log in `data/audit.jsonl`.
- **Deterministic by design:** the money math, the verdict and the recommendation (`src/assess.js`, `src/cases.js`). Claude reads the PDFs and writes the drafts. Code decides what the evidence supports, and any draft that doesn't state the exact amount is rejected and rebuilt from the evidence.
- **Sandbox data:** Fable Grove, UNFI and the documents are fictional. Say so.
- **Not built:** UNFI's supplier portal (deductions arrive by email remittance here), the Operations and Growth teammates, and the other integrations in the film's grid.

## Project map

```
server.js                 HTTP server, OAuth routes, case API (investigate streams NDJSON)
src/cases.js              Queue, investigation steps, options, drafts, approval, replies
src/assess.js             Per-deduction-type rules: money math, verdict, evidence trail, email facts
src/scenario.js           Helpers over fixtures/scenarios.json (offline mode + seed)
src/extract.js            Reads 9 document kinds (Claude PDF input, text parser fallback)
src/connectors/           quickbooks.js, microsoft.js (live), offline.js (fixtures)
scripts/seed.js           Loads the demo scenario into your accounts
scripts/selftest.mjs      npm test: runs the live code paths against fake QuickBooks + Graph
scripts/make_docs.py      Regenerates the PDFs from fixtures/scenarios.json
public/                   The interactive workspace UI
```

Tokens, case state, seed state and the audit log live in `./data` (gitignored). Use **Reset demo** in the footer to clear the cases between rehearsals. Delete `data/quickbooks.json` or `data/microsoft.json` to force a fresh connection.
