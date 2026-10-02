"""Generate the demo document PDFs from fixtures/scenarios.json.

Run:  python3 scripts/make_docs.py      (needs: pip install reportlab)
The generated PDFs are committed in fixtures/docs, so you only need this
if you change the scenario data.
"""
import json, math, os
from datetime import date
from reportlab.lib.pagesizes import letter
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = json.load(open(os.path.join(ROOT, "fixtures", "scenarios.json")))
OUT = os.path.join(ROOT, "fixtures", "docs")
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith(".pdf"):
        os.remove(os.path.join(OUT, f))

W, H = letter
INK = HexColor("#1d2b22")
MUTED = HexColor("#5d6b62")
RULE = HexColor("#c9d3cc")
BRAND = DATA["brand"]
PAYERS = {p["id"]: p for p in DATA["payers"]}
brand_lines = [BRAND["legalName"], BRAND["address"]]


def d(s):
    return date.fromisoformat(s).strftime("%m/%d/%Y")


def money(x):
    return f"${x:,.2f}"


def new(name, title):
    c = canvas.Canvas(os.path.join(OUT, name), pagesize=letter)
    c.setTitle(title)
    return c


def header(c, title, subtitle, issuer, issuer_lines):
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 20)
    c.drawString(54, H - 72, title)
    c.setFont("Helvetica", 10)
    c.setFillColor(MUTED)
    c.drawString(54, H - 90, subtitle)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 11)
    c.drawRightString(W - 54, H - 70, issuer)
    c.setFont("Helvetica", 9)
    c.setFillColor(MUTED)
    for i, line in enumerate(issuer_lines):
        c.drawRightString(W - 54, H - 84 - i * 12, line)
    c.setStrokeColor(RULE)
    c.line(54, H - 120, W - 54, H - 120)


def field(c, x, y, label, value, size=11):
    c.setFont("Helvetica", 8)
    c.setFillColor(MUTED)
    c.drawString(x, y, label.upper())
    c.setFont("Helvetica-Bold", size)
    c.setFillColor(INK)
    c.drawString(x, y - 15, value)


def table(c, y, cols, rows, size=10):
    c.setFont("Helvetica", 8)
    c.setFillColor(MUTED)
    for label, x, align in cols:
        (c.drawRightString if align == "r" else c.drawString)(x, y, label.upper())
    c.setStrokeColor(RULE)
    c.line(54, y - 6, W - 54, y - 6)
    c.setFillColor(INK)
    c.setFont("Helvetica", size)
    yy = y - 22
    for row in rows:
        for (label, x, align), val in zip(cols, row):
            (c.drawRightString if align == "r" else c.drawString)(x, yy, str(val))
        yy -= 18
    c.line(54, yy + 8, W - 54, yy + 8)
    return yy


def boxed(c, x, y, w, label, value, big=True):
    c.setStrokeColor(INK)
    c.rect(x, y, w, 48)
    c.setFont("Helvetica", 8)
    c.setFillColor(MUTED)
    c.drawString(x + 8, y + 34, label)
    if value:
        c.setFont("Helvetica-Bold" if big else "Helvetica", 16 if big else 10)
        c.setFillColor(INK)
        c.drawString(x + 8, y + 10 if big else y + 12, value)


def signature(c, x, y):
    c.setStrokeColor(HexColor("#2a3b8f"))
    c.setLineWidth(1.2)
    p = c.beginPath()
    p.moveTo(x, y)
    for i in range(1, 60):
        t = i / 59
        p.lineTo(x + t * 110, y + 7 * math.sin(t * 13) * (1 - t * 0.5) + 3 * math.sin(t * 31))
    c.drawPath(p)
    c.setLineWidth(1)


def footer(c, text):
    c.setFont("Helvetica", 8)
    c.setFillColor(MUTED)
    c.drawString(54, 40, text)
    c.drawRightString(W - 54, 40, "Demo document · fictional data")
    c.save()


for inv in DATA["invoices"]:
    n = inv["docNumber"]
    payer = PAYERS[inv["payer"]]
    total = inv["qty"] * inv["rate"]
    docs = inv["docs"]

    # ---- Invoice ----
    c = new(f"Invoice_{n}.pdf", f"Invoice {n}")
    header(c, f"Invoice {n}", "Wholesale invoice", BRAND["name"], brand_lines)
    y = H - 150
    field(c, 54, y, "Bill to", payer["name"])
    field(c, 200, y, "Invoice date", d(inv["txnDate"]))
    field(c, 320, y, "Due date", d(inv["dueDate"]))
    field(c, 440, y, "Terms", "Net 30")
    field(c, 54, y - 44, "Customer PO", inv["poNumber"])
    field(c, 200, y - 44, "Invoice number", n)
    yy = table(c, y - 100, [("Product / service", 54, "l"), ("Qty (cases)", 360, "r"), ("Rate", 450, "r"), ("Amount", W - 54, "r")],
               [[BRAND["product"], inv["qty"], money(inv["rate"]), money(total)]])
    c.setFont("Helvetica-Bold", 13)
    c.drawRightString(450, yy - 20, "Total")
    c.drawRightString(W - 54, yy - 20, money(total))
    footer(c, f"{BRAND['legalName']} · Invoice {n}")

    # ---- Manifest / BOL ----
    if "manifest" in docs:
        m = docs["manifest"]
        c = new(f"Manifest_{n}.pdf", f"Shipping manifest · Invoice {n}")
        header(c, "Shipping manifest", f"Bill of lading · Ref: Invoice {n}", BRAND["name"], brand_lines)
        y = H - 150
        field(c, 54, y, "Shipper", BRAND["name"])
        field(c, 220, y, "Consignee", payer["billTo"])
        field(c, 54, y - 44, "Ship date", d(m["shipDate"]))
        field(c, 220, y - 44, "Customer PO", inv["poNumber"])
        field(c, 400, y - 44, "Pallets", str(m["pallets"]))
        rows, i = [], 0
        per = inv["qty"] // m["pallets"]
        for wh in m["warehouses"]:
            k = wh.get("pallets") or -(-wh["cases"] // per)
            sizes = [wh["cases"] // k + (1 if j < wh["cases"] % k else 0) for j in range(k)]
            for take in sizes:
                i += 1
                rows.append([f"Pallet {i}", wh["name"], f"SSCC 00 0812345 {n}{i:03d}", take])
        yy = table(c, y - 100, [("Pallet", 54, "l"), ("Ship from", 130, "l"), ("Label", 220, "l"), ("Cases", W - 54, "r")], rows)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(54, yy - 20, f"CASES SHIPPED: {inv['qty']}")
        if len(m["warehouses"]) > 1:
            c.setFont("Helvetica", 10)
            c.drawString(54, yy - 38, "SHIPPED FROM: " + " · ".join(f"{w['name']} {w['cases']}" for w in m["warehouses"]))
        footer(c, f"Manifest · Invoice {n} · {inv['poNumber']}")

    # ---- Proofs of delivery ----
    pods = docs.get("pods", [])
    for pod in pods:
        loc = pod.get("location") or ""
        name = f"POD_{n}_{loc}.pdf" if len(pods) > 1 else f"POD_{n}.pdf"
        expected = next((w["cases"] for w in docs.get("manifest", {}).get("warehouses", []) if w["name"] == loc), inv["qty"]) if loc else inv["qty"]
        c = new(name, f"Proof of delivery · Invoice {n}{' · ' + loc if loc else ''}")
        header(c, "Proof of delivery", f"Delivery receipt · Ref: Invoice {n}", "Carrier copy", ["LTL delivery receipt", f"PO {inv['poNumber']}"])
        y = H - 150
        field(c, 54, y, "Consignee", payer["billTo"])
        field(c, 300, y, "Shipper", BRAND["name"] + (f" · {loc} warehouse" if loc else ""))
        field(c, 54, y - 44, "Delivery date", d(pod["deliveryDate"]))
        field(c, 300, y - 44, "Cases on manifest", str(expected))
        by = y - 140
        boxed(c, 54, by, 220, "ACCEPTED COUNT:", str(pod["acceptedCount"]) if pod["acceptedCount"] is not None else "")
        boxed(c, 300, by, W - 354, "OS&D / EXCEPTIONS:", pod["exceptions"] if pod["exceptions"] and pod["exceptions"] != "None" else "", big=False)
        c.setFont("Helvetica", 8)
        c.setFillColor(MUTED)
        c.drawString(54, by - 40, "RECEIVED BY:")
        signature(c, 130, by - 40)
        c.setFillColor(INK)
        c.setFont("Helvetica", 10)
        c.drawString(260, by - 40, f"Printed name: {pod['receivedBy']}")
        if loc:
            c.drawString(54, by - 70, f"SHIP FROM LOCATION: {loc}")
        footer(c, f"POD · Invoice {n} · {inv['poNumber']}{' · ' + loc if loc else ''}")

    # ---- Price letter ----
    if "priceLetter" in docs:
        p = docs["priceLetter"]
        c = new(f"PriceLetter_{n}.pdf", "Cost change notice")
        header(c, "Cost change notice", f"Issued {d(p['issued'])} · Acknowledged by {payer['name']} category team", BRAND["name"], brand_lines)
        y = H - 150
        field(c, 54, y, "To", f"{payer['name']} category management")
        field(c, 300, y, "Item", BRAND["product"])
        boxed(c, 54, y - 110, 150, "CURRENT COST:", money(p["oldPrice"]))
        boxed(c, 220, y - 110, 150, "NEW COST:", money(p["newPrice"]))
        boxed(c, 386, y - 110, W - 440, "EFFECTIVE DATE:", d(p["effectiveDate"]))
        c.setFont("Helvetica", 10)
        c.setFillColor(INK)
        c.drawString(54, y - 150, "The new cost applies to orders invoiced on or after the effective date.")
        c.drawString(54, y - 166, "Orders invoiced before the effective date are billed at the current cost.")
        footer(c, f"{BRAND['legalName']} · Cost change notice · {payer['name']}")

    # ---- Promotion agreement ----
    if "promo" in docs:
        p = docs["promo"]
        c = new(f"PromoAgreement_{n}.pdf", f"Promotion agreement · {p['name']}")
        header(c, "Promotion agreement", f"{p['name']} · signed by {BRAND['name']} and {payer['name']}", BRAND["name"], brand_lines)
        y = H - 150
        field(c, 54, y, "Promotion", p["name"])
        field(c, 300, y, "Period", f"{d(p['start'])} – {d(p['end'])}")
        boxed(c, 54, y - 110, 180, "RATE PER CASE:", money(p["ratePerCase"]))
        boxed(c, 250, y - 110, 180, "MAX CASES:", str(p["maxCases"]))
        c.setFont("Helvetica", 10)
        c.setFillColor(INK)
        c.drawString(54, y - 150, f"{payer['name']} may deduct the rate per case on qualifying shipments in the period, up to the maximum.")
        footer(c, f"Promotion agreement · {p['name']} · {payer['name']}")

    # ---- Slotting agreement ----
    if "slotting" in docs:
        s = docs["slotting"]
        c = new(f"SlottingAgreement_{n}.pdf", "New item slotting agreement")
        header(c, "Slotting agreement", f"New item placement · signed {d(s['signed'])}", payer["name"], ["Merchandising", f"Supplier: {BRAND['name']}"])
        y = H - 150
        field(c, 54, y, "Supplier", BRAND["legalName"])
        field(c, 300, y, "Items", f"{s['items']} new item(s) · {s['stores']} store(s)")
        boxed(c, 54, y - 110, 220, "SLOTTING FEE:", money(s["amount"]))
        c.setFont("Helvetica", 10)
        c.setFillColor(INK)
        c.drawString(54, y - 150, s["note"] + ". Deducted once from the first invoice.")
        footer(c, f"Slotting agreement · {payer['name']} · {BRAND['name']}")

    # ---- Purchase order (MABD) ----
    if "po" in docs:
        p = docs["po"]
        c = new(f"PO_{n}.pdf", f"Purchase order {inv['poNumber']}")
        header(c, "Purchase order", f"PO {inv['poNumber']}", payer["name"], ["Replenishment", f"Supplier: {BRAND['name']}"])
        y = H - 150
        field(c, 54, y, "PO number", inv["poNumber"])
        field(c, 300, y, "Ship to", payer["billTo"])
        yy = table(c, y - 60, [("Item", 54, "l"), ("Cases", 400, "r"), ("Cost", W - 54, "r")], [[BRAND["product"], inv["qty"], money(inv["rate"])]])
        boxed(c, 54, yy - 70, 220, "MUST ARRIVE BY:", d(p["mustArriveBy"]))
        c.setFont("Helvetica", 9)
        c.setFillColor(MUTED)
        c.drawString(54, yy - 95, "On-time in-full: deliveries after the must-arrive-by date or short of the ordered quantity may be fined 3% of cost.")
        footer(c, f"PO {inv['poNumber']} · {payer['name']}")

    # ---- Delivery appointment record ----
    if "appointment" in docs:
        a = docs["appointment"]
        c = new(f"Appointment_{n}.pdf", f"Delivery appointment · {inv['poNumber']}")
        header(c, "Delivery appointment record", f"PO {inv['poNumber']} · carrier scheduling portal export", "Carrier copy", ["Appointment history", payer["billTo"]])
        y = H - 150
        boxed(c, 54, y - 50, 160, "ORIGINAL APPOINTMENT:", d(a["scheduled"]))
        boxed(c, 230, y - 50, 160, "DELIVERED APPOINTMENT:", d(a["actual"]))
        who = {"consignee": "Consignee (DC)", "carrier": "Carrier"}.get(a["changedBy"], "None")
        boxed(c, 406, y - 50, W - 460, "CHANGED BY:", who)
        c.setFont("Helvetica", 10)
        c.setFillColor(INK)
        c.drawString(54, y - 80, f"REASON: {a['reason']}")
        footer(c, f"Appointment record · {inv['poNumber']}")

# ---- Payment advices (one per payer) ----
for payer in DATA["payers"]:
    r = payer["remittance"]
    lines = [i for i in DATA["invoices"] if i["payer"] == payer["id"]]
    c = new(r["fileName"], f"{payer['name']} payment advice · {r['method']} {r['number']}")
    header(c, "Payment advice", f"{r['method']} {r['number']} · Paid {d(r['paymentDate'])}", payer["name"], ["Accounts payable", "Remittance detail"])
    y = H - 150
    field(c, 54, y, "Payee", BRAND["legalName"])
    field(c, 260, y, f"{r['method']} number", r["number"])
    field(c, 420, y, "Payment date", d(r["paymentDate"]))
    rows, total_paid = [], 0
    for inv in lines:
        gross = inv["qty"] * inv["rate"]
        ded = inv["deduction"]
        paid = gross - ded["amount"]
        total_paid += paid
        reason = ded["reason"] + (f": {ded['cases']} cases" if ded.get("cases") else "")
        rows.append([inv["docNumber"], money(gross), f"{ded['code']} {ded['ref']}", reason, f"-{money(ded['amount'])}", money(paid)])
    yy = table(c, y - 70, [("Invoice", 54, "l"), ("Gross", 140, "r"), ("Deduction ref", 152, "l"), ("Reason", 252, "l"), ("Deducted", 490, "r"), ("Paid", W - 54, "r")], rows, size=9)
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(490, yy - 20, "Total paid")
    c.drawRightString(W - 54, yy - 20, money(total_paid))
    c.setFont("Helvetica", 9)
    c.setFillColor(MUTED)
    c.drawString(54, yy - 60, f"Deductions may be disputed with supporting documentation within {payer['windowDays']} days of payment.")
    footer(c, f"{payer['name']} payment advice · {r['method']} {r['number']}")

print("wrote", len([f for f in os.listdir(OUT) if f.endswith('.pdf')]), "PDFs")
