// The money math and the verdict live in code, not in the model.
// The model explains and drafts; this decides what the evidence actually supports.
import { config, money, round2 } from './config.js';

const fmtDate = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function assess(c) {
  const { invoice, payments, remittance, packet } = c;
  if (!invoice) throw new Error('Look up the invoice first.');
  const billed = invoice.total;
  const paid = payments?.totalPaid ?? 0;
  const gap = round2(billed - paid);
  const billedQty = invoice.lines.reduce((s, l) => s + l.qty, 0);
  const rate = invoice.lines[0]?.rate ?? 0;

  const line = remittance?.line || null;
  const claimedCases = line?.cases ?? null;
  const claimedAmount = line?.deducted ?? gap;
  const doc = (k) => packet?.files?.find((f) => f.kind === k)?.fields || null;
  const manifest = doc('manifest');
  const pod = doc('pod');
  const shipped = manifest?.cases_shipped ?? null;
  const accepted = pod?.accepted_count ?? null;

  const payDate = payments?.payments?.[0]?.date || null;
  let deadline = null;
  if (payDate) {
    const d = new Date(payDate + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + config.disputeWindowDays);
    const today = new Date(new Date().toLocaleDateString('en-CA') + 'T12:00:00Z');
    const daysLeft = Math.round((d - today) / 86400000);
    deadline = { date: d.toISOString().slice(0, 10), label: fmtDate(d.toISOString().slice(0, 10)), daysLeft };
  }

  const checks = {
    claimMatchesGap: line ? Math.abs(claimedAmount - gap) < 0.01 : null,
    claimMath: line && claimedCases != null ? Math.abs(claimedCases * rate - claimedAmount) < 0.01 : null,
    shippedMatchesBilled: shipped != null ? shipped === billedQty : null,
  };

  let verdict, headline, detail, amount;
  if (gap <= 0) {
    verdict = 'paid_in_full';
    headline = 'Paid in full.';
    detail = 'Nothing to resolve on this invoice.';
    amount = 0;
  } else if (!pod) {
    verdict = 'request_evidence';
    headline = 'No proof of delivery on file.';
    detail = `Need UNFI's receiving count and backup for the ${money(gap)} deduction.`;
    amount = gap;
  } else if (accepted == null) {
    verdict = 'request_evidence';
    headline = `Need ${invoice.customer}'s receiving count.`;
    detail = `The POD is signed but shows no accepted count, so the ${claimedCases ?? ''}-case shortage is a claim, not proven.`.replace('  ', ' ');
    amount = gap;
  } else if (accepted >= billedQty) {
    verdict = 'dispute';
    headline = 'The POD proves full delivery.';
    detail = `All ${accepted} cases were accepted${pod.received_by ? ` and signed for by ${pod.received_by}` : ''}, with no exceptions. The shortage isn't supported.`;
    amount = claimedAmount;
  } else if (claimedCases != null && billedQty - accepted === claimedCases) {
    verdict = 'valid';
    headline = 'This deduction is valid.';
    detail = `The POD shows ${accepted} of ${billedQty} accepted${pod.exceptions ? `: "${pod.exceptions}"` : ''}. UNFI's ${claimedCases}-case deduction matches.`;
    amount = 0;
  } else {
    const supportedCases = billedQty - accepted;
    const overCases = (claimedCases ?? 0) - supportedCases;
    verdict = 'dispute';
    headline = 'The deduction is larger than the POD supports.';
    detail = `The POD supports ${supportedCases} short cases; UNFI deducted ${claimedCases}. Dispute the difference.`;
    amount = round2(overCases * rate);
  }

  return {
    invoiceNumber: invoice.docNumber,
    customer: invoice.customer,
    billed,
    paid,
    gap,
    billedQty,
    rate,
    claimedCases,
    claimedAmount,
    deductionRef: line?.deduction_ref || null,
    deductionCode: line?.deduction_code || null,
    deductionReason: line?.reason || null,
    shipped,
    accepted,
    pod: pod ? { receivedBy: pod.received_by, signed: pod.signed, exceptions: pod.exceptions } : null,
    checks,
    deadline,
    verdict,
    headline,
    detail,
    amount,
    amountLabel: money(amount),
  };
}
