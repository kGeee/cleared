# Cleared · Finance teammate demo

This is the Finance segment of the Cleared product film, built as an interactive workspace you click through.

- **The queue.** Cleared reads UNFI's payment advice from **Outlook** and lists every short-paid invoice, with totals for withheld, waiting and recovered money, plus the dispute deadline.
- **Investigate.** Click a short-pay, then **Investigate**. Four checks run as you watch:
  1. **Billed vs. paid** from **QuickBooks**, shown as a bar with the short amount.
  2. **What UNFI says**, read from the payment advice PDF: code, reference, cases × price.
  3. **What the paperwork shows**, read from the invoice packet in **OneDrive**. A case trail runs Billed → Shipped → Accepted → Paid for, so you can see where the cases go missing. Click any document to open it next to what Cleared read from it.
  4. **What should we do?** Cleared states what the evidence supports and recommends one of three actions. You can pick a different one.
- **Act.** Edit the email, toggle attachments and click **Approve & send**. The email goes out from Outlook and a note is added to the invoice in QuickBooks. **Nothing is sent or written until you approve.**
- **Follow up.** The case moves to *Waiting on UNFI*. When UNFI replies (in live mode, use **Check for replies**), Cleared reads the reply, marks the money recovered and updates the totals.

There are three scenarios, so you can show judgment and not just automation:

| Invoice | What the POD shows | Cleared recommends |
|---|---|---|
| **2086** (the film) | Signed, but no accepted count | Request the receiving count ($240) |
| **2087** | All 80 cases accepted | Dispute the $144 deduction |
| **2088** | 4 cases crushed and refused | Accept it. The deduction is valid ($96) |

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
Wait about a minute after seeding. Outlook search needs time to index the remittance email. Then ask about Invoice 2086.

The seed script is safe to re-run. It creates:
- **QuickBooks:** customer UNFI, invoices 2086/2087/2088 for Fable Grove product · case at $24, and one payment, check 7741 for $5,760, applied net of deductions.
- **OneDrive:** `Cleared Demo/Invoice 2086 packet/` (Invoice, Manifest, POD), plus the same for 2087 and 2088.
- **Outlook:** the UNFI payment advice email with the remittance PDF attached. It's sent to yourself, so the sender shows as you.

---

## 3. The 3-minute run of show

1. **Play the film** (2:05).
2. "Everything in the Finance segment is live: real QuickBooks, Outlook and OneDrive, with sandbox data." Point at the totals strip: $480 withheld, 28 days to dispute.
3. Click **Invoice 2086**, then **Investigate**. Narrate as each check fills in, and as the chips at the top light up QuickBooks, then Outlook, then OneDrive.
4. Point at the case trail: "120 billed, 120 shipped, **?** accepted, 110 paid for. That question mark is the whole case." Click the POD to show the document next to what Cleared read.
5. The recommendation is pre-selected. Click **Dispute** to show that the draft changes and why it's "Not advised". Switch back, edit a word, and click **Approve & send**. Show the email arriving on your phone.
6. Reply from your phone ("Receiving shows 120 accepted, deduction reversed"), then click **Check for replies**. **$240 recovered** appears and the totals update. (Offline: **Simulate UNFI's reply**.)
7. "Not every deduction is worth fighting." Open **2088**: the trail shows 4 cases refused, and Cleared recommends accepting it.
8. Click **Reset demo** before the next run.

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
src/assess.js             Money math + verdict
src/extract.js            Document reading (Claude PDF input, text parser fallback)
src/connectors/           quickbooks.js, microsoft.js (live), offline.js (fixtures)
scripts/seed.js           Loads the demo scenario into your accounts
scripts/selftest.mjs      npm test: runs the live code paths against fake QuickBooks + Graph
scripts/make_docs.py      Regenerates the PDFs from fixtures/scenarios.json
public/                   The interactive workspace UI
```

Tokens, case state, seed state and the audit log live in `./data` (gitignored). Use **Reset demo** in the footer to clear the cases between rehearsals. Delete `data/quickbooks.json` or `data/microsoft.json` to force a fresh connection.
