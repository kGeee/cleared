# Cleared · your CPG team, in one chat

This is the product film, made clickable. It's a **Fable Grove work desktop** with the apps a CPG team lives in: Outlook, Excel, Cin7, ShipBob, SPS Commerce, QuickBooks and OneDrive. The **Cleared mascot** in the corner opens a chat beside whatever you're looking at.

Cleared knows what's on screen. Open the KeHE order email and it offers "What's blocking PO 1042?". Open the launch tracker and it offers "Is Friday's retail launch actually ready?". Open an invoice in QuickBooks and it offers "Why were we short-paid?". Each answer arrives as clickable cards: plans, evidence, drafts and approve buttons. While Cleared works, the desktop switches to the app it's working in. **Nothing is sent, booked or changed until you click approve.** You can also type a question.

All three teammates from the film are here:

**Operations: KeHE PO 1042** (Outlook → Excel → Cin7 → ShipBob → SPS)
120 eligible cases across two warehouses → plan: split 90 East / 30 West, $420 freight → approve → the freight quote changes to $480, so Cleared pauses and asks again → releases sent and accepted, freight confirmed, packing list received → the 856 ASN is prepared in SPS → send it when pickup is confirmed.

**Growth: Friday's retail launch** (Excel → OneDrive → Outlook)
10 of 12 sampling slots confirmed, and the broker kit uses an old image → "One fix. Two replies." → review the kit update and 3 follow-up emails (toggle or edit each) → approve → replies arrive → 12/12 confirmed, and the broker has the v3 kit.

**Finance: 10 short-pays across 5 payers** (QuickBooks → Outlook → OneDrive)
Cleared checks billed vs. paid, reads the payment advice and the paperwork, decides what the evidence supports and drafts the email → approve → the reply comes in → recovered. The cases:

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

What's live and what's preview:
- **Live** (connect with `.env`): QuickBooks, Outlook and OneDrive, i.e. the whole Finance flow plus the Outlook payment-advice emails.
- **Preview**: the Excel, Cin7, ShipBob and SPS screens, and the Operations and Growth emails. They aren't connected in this POC, so they're simulated and labeled "Preview" in the app.

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
Put an API key from https://console.anthropic.com into `ANTHROPIC_API_KEY`. Claude reads the PDFs, drafts the emails and answers typed questions that don't match a suggestion. Without a key, a built-in parser and evidence-based templates do the first two, so the demo still works.

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

## 3. Run of show (about 5 minutes)

1. **Play the film** (2:05). Then: "Here's the product, in the same apps."
2. **"What can you take off my plate?"** Click the mascot, then the button. One card shows all three teammates' work. Click **Handle it** on Operations.
3. **Operations.** Narrate as the desktop jumps from Outlook to Excel to Cin7: "120 cases, two warehouses." Approve the $420 plan. The quote changes to $480 and Cleared pauses on its own. "It doesn't spend money you didn't approve." Approve $480 and watch the releases, freight and packing land in ShipBob, then the ASN in SPS.
4. Click **Next: Friday's retail launch**. Cleared shows 10 of 12 slots and an old image in the broker kit. Click **Review**, edit one follow-up, approve, then **Check for replies** to get 12/12.
5. Click **Next: UNFI's $240 short-pay**. This is the live part: real QuickBooks, Outlook and OneDrive. Show the evidence trail, open the POD, approve the email, and show it arriving on your phone. Reply from your phone and click **Check for replies** to get $240 recovered.
6. **Context, not commands.** Open QuickBooks and click Invoice 2079: Cleared offers to explain *that* short-pay. It's the same PO 1042 from Operations, and KeHE only matched the East POD. Or open the Walmart email: it offers the Walmart fines.
7. Click **Reset demo** in the footer before the next run.

**If anything breaks on stage:** stop the server and run `npm run offline`. It's the same UI and the same flow, with no network needed.

## 4. What's real, and what to say about it

- **Real:** OAuth to QuickBooks and Microsoft 365, reading invoices, payments, mail, attachments and files, Claude reading the PDFs, sending through Outlook, writing a QuickBooks note, reading the distributor's reply, and the audit log in `data/audit.jsonl`.
- **Deterministic by design:** the money math, the verdict and the recommendation (`src/assess.js`, `src/cases.js`). Claude reads the PDFs and writes the drafts. Code decides what the evidence supports, and any draft that doesn't state the exact amount is rejected and rebuilt from the evidence.
- **Sandbox data:** Fable Grove, UNFI and the documents are fictional. Say so.
- **Preview (simulated):** the Operations and Growth teammates' apps: Excel, Cin7, ShipBob and SPS Commerce. The flows, approvals and state changes work, but the data is demo data and nothing reaches those systems.
- **Not built:** UNFI's supplier portal (deductions arrive by email remittance here), and the other integrations listed under Connections → Next.

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
public/js/main.js         Desktop boot, context-aware suggestions, wiring
public/js/apps.js         The 7 desktop apps; each reports what you're looking at
public/js/flows.js        What Cleared does: Operations, Growth and Finance flows as clickable cards
public/js/core.js         State, chat panel engine, document drawer
public/js/data.js         Operations + Growth demo data (from the film)
```

Tokens, case state, seed state and the audit log live in `./data` (gitignored). Use **Reset demo** in the footer to clear the cases between rehearsals. Delete `data/quickbooks.json` or `data/microsoft.json` to force a fresh connection.
