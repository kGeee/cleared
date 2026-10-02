"""Generate the demo document packet PDFs from fixtures/scenarios.json.

Run:  python3 scripts/make_docs.py      (needs: pip install reportlab)
The generated PDFs are already committed in fixtures/docs, so you only need
this if you change the scenario data.
"""
import json, math, os
from datetime import date
from reportlab.lib.pagesizes import letter
from reportlab.lib.colors import HexColor, black
from reportlab.pdfgen import canvas

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = json.load(open(os.path.join(ROOT, "fixtures", "scenarios.json")))
OUT = os.path.join(ROOT, "fixtures", "docs")
os.makedirs(OUT, exist_ok=True)

W, H = letter
INK = HexColor("#1d2b22")
MUTED = HexColor("#5d6b62")
RULE = HexColor("#c9d3cc")
BRAND = DATA["brand"]
CUST = DATA["customer"]


def fmt_date(s):
    d = date.fromisoformat(s)
    return d.strftime("%m/%d/%Y")


def money(x):
    return f"${x:,.2f}"


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


def field(c, x, y, label, value, bold=True, size=11):
    c.setFont("Helvetica", 8)
    c.setFillColor(MUTED)
    c.drawString(x, y, label.upper())
    c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
    c.setFillColor(INK)
    c.drawString(x, y - 15, value)


def table(c, y, cols, rows):
    """cols: list of (label, x, align)."""
    c.setFont("Helvetica", 8)
    c.setFillColor(MUTED)
    for label, x, align in cols:
        (c.drawRightString if align == "r" else c.drawString)(x, y, label.upper())
    c.setStrokeColor(RULE)
    c.line(54, y - 6, W - 54, y - 6)
    c.setFillColor(INK)
    c.setFont("Helvetica", 10)
    yy = y - 22
    for row in rows:
        for (label, x, align), val in zip(cols, row):
            (c.drawRightString if align == "r" else c.drawString)(x, yy, str(val))
        yy -= 18
    c.line(54, yy + 8, W - 54, yy + 8)
    return yy


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


brand_lines = [BRAND["legalName"], BRAND["address"]]

for inv in DATA["invoices"]:
    n = inv["docNumber"]
    total = inv["qty"] * BRAND["unitPrice"]

    # ---- Invoice ----
    c = canvas.Canvas(os.path.join(OUT, f"Invoice_{n}.pdf"), pagesize=letter)
    c.setTitle(f"Invoice {n}")
    header(c, f"Invoice {n}", "Wholesale invoice", BRAND["name"], brand_lines)
    y = H - 150
    field(c, 54, y, "Bill to", CUST["name"])
    field(c, 200, y, "Invoice date", fmt_date(inv["txnDate"]))
    field(c, 320, y, "Due date", fmt_date(inv["dueDate"]))
    field(c, 440, y, "Terms", "Net 30")
    field(c, 54, y - 44, "Customer PO", inv["poNumber"])
    field(c, 200, y - 44, "Invoice number", n)
    yy = table(
        c, y - 100,
        [("Product / service", 54, "l"), ("Qty (cases)", 360, "r"), ("Rate", 450, "r"), ("Amount", W - 54, "r")],
        [[BRAND["product"], inv["qty"], money(BRAND["unitPrice"]), money(total)]],
    )
    c.setFont("Helvetica-Bold", 13)
    c.drawRightString(450, yy - 20, "Total")
    c.drawRightString(W - 54, yy - 20, money(total))
    footer(c, f"{BRAND['legalName']} · Invoice {n}")
    c.save()

    # ---- Manifest / BOL ----
    c = canvas.Canvas(os.path.join(OUT, f"Manifest_{n}.pdf"), pagesize=letter)
    c.setTitle(f"Shipping manifest · Invoice {n}")
    header(c, "Shipping manifest", f"Bill of lading · Ref: Invoice {n}", BRAND["name"], brand_lines)
    y = H - 150
    field(c, 54, y, "Shipper", BRAND["name"])
    field(c, 220, y, "Consignee", CUST["billTo"])
    field(c, 54, y - 44, "Ship date", fmt_date(inv["shipDate"]))
    field(c, 220, y - 44, "Customer PO", inv["poNumber"])
    field(c, 400, y - 44, "Pallets", str(inv["pallets"]))
    per = inv["qty"] // inv["pallets"]
    rows = [[f"Pallet {i+1}", f"SSCC 00 0812345 {n}{i+1:03d}", per] for i in range(inv["pallets"])]
    yy = table(c, y - 100, [("Pallet", 54, "l"), ("Label", 160, "l"), ("Cases", W - 54, "r")], rows)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(54, yy - 20, f"CASES SHIPPED: {inv['qty']}")
    footer(c, f"Manifest · Invoice {n} · {inv['poNumber']}")
    c.save()

    # ---- Proof of delivery ----
    pod = inv["pod"]
    c = canvas.Canvas(os.path.join(OUT, f"POD_{n}.pdf"), pagesize=letter)
    c.setTitle(f"Proof of delivery · Invoice {n}")
    header(c, "Proof of delivery", f"Delivery receipt · Ref: Invoice {n}", "Carrier copy", ["LTL delivery receipt", f"PO {inv['poNumber']}"])
    y = H - 150
    field(c, 54, y, "Consignee", CUST["billTo"])
    field(c, 300, y, "Shipper", BRAND["name"])
    field(c, 54, y - 44, "Delivery date", fmt_date(inv["deliveryDate"]))
    field(c, 300, y - 44, "Cases on manifest", str(inv["qty"]))
    # Accepted count box
    bx, by = 54, y - 140
    c.setStrokeColor(INK)
    c.rect(bx, by, 220, 48)
    c.setFont("Helvetica", 8)
    c.setFillColor(MUTED)
    c.drawString(bx + 8, by + 34, "ACCEPTED COUNT:")
    if pod["acceptedCount"] is not None:
        c.setFont("Helvetica-Bold", 16)
        c.setFillColor(INK)
        c.drawString(bx + 8, by + 10, str(pod["acceptedCount"]))
    c.rect(300, by, W - 354, 48)
    c.setFont("Helvetica", 8)
    c.setFillColor(MUTED)
    c.drawString(308, by + 34, "OS&D / EXCEPTIONS:")
    if pod["exceptions"]:
        c.setFont("Helvetica", 10)
        c.setFillColor(INK)
        c.drawString(308, by + 12, pod["exceptions"])
    # Signature
    c.setFont("Helvetica", 8)
    c.setFillColor(MUTED)
    c.drawString(54, by - 40, "RECEIVED BY:")
    signature(c, 130, by - 40)
    c.setFillColor(INK)
    c.setFont("Helvetica", 10)
    c.drawString(260, by - 40, f"Printed name: {pod['receivedBy']}")
    footer(c, f"POD · Invoice {n} · {inv['poNumber']}")
    c.save()

# ---- Remittance / payment advice ----
r = DATA["remittance"]
c = canvas.Canvas(os.path.join(OUT, r["fileName"]), pagesize=letter)
c.setTitle(f"UNFI payment advice · Check {r['checkNumber']}")
header(c, "Payment advice", f"Check {r['checkNumber']} · Paid {fmt_date(r['paymentDate'])}", CUST["name"], ["Accounts payable", "Remittance detail"])
y = H - 150
field(c, 54, y, "Payee", BRAND["legalName"])
field(c, 260, y, "Check number", r["checkNumber"])
field(c, 420, y, "Payment date", fmt_date(r["paymentDate"]))
rows = []
total_paid = 0
for inv in DATA["invoices"]:
    gross = inv["qty"] * BRAND["unitPrice"]
    d = inv["deduction"]
    ded = d["cases"] * BRAND["unitPrice"]
    paid = gross - ded
    total_paid += paid
    rows.append([inv["docNumber"], money(gross), f"{d['code']} {d['reference']}", f"{d['reason']}: {d['cases']} cases", f"-{money(ded)}", money(paid)])
yy = table(
    c, y - 70,
    [("Invoice", 54, "l"), ("Gross", 150, "r"), ("Deduction ref", 165, "l"), ("Reason", 270, "l"), ("Deducted", 480, "r"), ("Paid", W - 54, "r")],
    rows,
)
c.setFont("Helvetica-Bold", 12)
c.drawRightString(480, yy - 20, "Total paid")
c.drawRightString(W - 54, yy - 20, money(total_paid))
c.setFont("Helvetica", 9)
c.setFillColor(MUTED)
c.drawString(54, yy - 60, "Deductions may be disputed with supporting documentation through the supplier deductions process.")
footer(c, f"UNFI payment advice · Check {r['checkNumber']}")
c.save()
print("wrote", sorted(os.listdir(OUT)))
