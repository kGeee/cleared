# Cleared · Finance teammate demo

This is the Finance segment of the Cleared product film, built for real. Ask "Why were we short-paid on Invoice 2086?" and Cleared will:

1. Pull the invoice and payment from **QuickBooks**: $2,880 billed, $2,640 paid.
2. Find UNFI's payment advice in **Outlook** and read the attached PDF: deduction DED-55120, 10 cases short.
3. Open the invoice packet in **OneDrive** and read the invoice, manifest and POD. The POD has no accepted count.
4. Decide what the evidence supports. The verdict here is "Claim, not proven. Need UNFI's receiving count."
5. Draft the evidence request with all four documents attached. **Nothing is sent until you click Approve.**
6. On approval, send the email from Outlook, add a note to the QuickBooks invoice, and log who approved it.

There are three scenarios, so you can show judgment and not just automation:

| Ask about | What the POD shows | What Cleared does |
|---|---|---|
| **Invoice 2086** (the film) | Signed, but no accepted count | Requests the receiving count ($240) |
| **Invoice 2087** | All 80 cases accepted | Disputes the $144 deduction |
| **Invoice 2088** | 4 cases crushed and refused | Says the deduction is valid and recommends accepting it |

You can also ask "Which short-pays need attention?" for the list view.

---

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
Put an API key from https://console.anthropic.com into `ANTHROPIC_API_KEY`. Without a key, a scripted agent runs the same tools and the same deterministic math, so the demo still works.

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

1. **Play the film** (2:05). It sells the full vision: three teammates.
2. "Everything you just saw in the Finance segment is live. Real QuickBooks, real Outlook, real OneDrive, sandbox data."
3. Open **Connections** and show both apps connected, plus the permission list: "reads freely, writes only after you approve." *(Optional: disconnect and reconnect QuickBooks to show the real Intuit consent screen.)*
4. Click **Why were we short-paid on Invoice 2086?** and narrate as the left pane switches QuickBooks → Outlook → OneDrive. Point at the timer.
5. Edit one word in the draft to show the human is in control, then click **Approve follow-up + evidence pack**. Show the sent message, then the email arriving on your phone.
6. "Not every deduction is worth fighting." Ask about **2088**. Cleared says it's valid and recommends accepting it.
7. Close with the "what's live vs. next" slide.

**If anything breaks on stage:** stop the server and run `npm run offline`. It's the same UI and the same flow, with no network needed. Keep a screen recording as a final backup.

## 4. What's real, and what to say about it

- **Real:** OAuth to QuickBooks and Microsoft 365, reading invoices, payments, mail, attachments and files, Claude reading the PDFs, sending through Outlook, writing a QuickBooks note, and the audit log in `data/audit.jsonl`.
- **Deterministic by design:** the money math and the verdict (`src/assess.js`). The model explains and drafts. Code decides what the evidence supports. The server also rejects any draft that doesn't state the exact amount.
- **Sandbox data:** Fable Grove, UNFI and the documents are fictional. Say so.
- **Not built:** UNFI's supplier portal (deductions arrive by email remittance here), the Operations and Growth teammates, and the other integrations in the film's grid.

## Project map

```
server.js                 HTTP server, OAuth routes, NDJSON stream for the agent
src/agent.js              Claude tool loop + scripted fallback, approval (the only place anything is sent or written)
src/assess.js             Money math + verdict
src/extract.js            Document reading (Claude PDF input, text parser fallback)
src/connectors/           quickbooks.js, microsoft.js (live), offline.js (fixtures)
scripts/seed.js           Loads the demo scenario into your accounts
scripts/make_docs.py      Regenerates the PDFs from fixtures/scenarios.json
public/                   UI (styled after the product film)
```

Tokens, seed state and the audit log live in `./data` (gitignored). Delete `data/quickbooks.json` or `data/microsoft.json` to force a fresh connection.
