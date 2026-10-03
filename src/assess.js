// What the evidence supports, per deduction type. The money math, the verdict, the recommendation
// and the email's factual sentences all live here, in code. Claude only reads documents and polishes wording.
import { money, moneyExact, round2 } from './config.js';

const short = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '?');
const long = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '?');
const usd = (n) => '$' + Number(n).toFixed(2);

export function typeOf(code = '', reason = '') {
  const c = `${code} ${reason}`.toUpperCase();
  if (/\bSHT\b|SHORT|\bDMG\b|DAMAG|REFUS/.test(c)) return 'quantity';
  if (/\bPRC\b|PRICE|COST/.test(c)) return 'pricing';
  if (/\bMCB\b|PROMO|SCAN|\bMDF\b/.test(c)) return 'promo';
  if (/OTIF|ON-TIME|FINE/.test(c)) return 'otif';
  if (/SLOT|NEW ITEM/.test(c)) return 'slotting';
  return 'other';
}

export function deadlineFor(paymentDate, windowDays) {
  if (!paymentDate) return null;
  const d = new Date(paymentDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + (windowDays || 30));
  const today = new Date(new Date().toLocaleDateString('en-CA') + 'T12:00:00Z');
  return { date: d.toISOString().slice(0, 10), label: short(d.toISOString().slice(0, 10)), daysLeft: Math.round((d - today) / 86400000) };
}

const node = (label, value, sub, state = 'ok') => ({ label, value: String(value), sub, state });

// ---------- per-type rules ----------
// Each returns { verdict, headline, detail, amount, trail, note, proof, ev: {request, dispute}, ask: {request, dispute}, acceptNote, validWhy }
const RULES = {
  quantity(x) {
    const { qty, claimedCases, claimed, payer, docs, rate } = x;
    const man = docs.manifest[0];
    const pods = docs.pod;
    const shipped = man?.cases_shipped ?? null;
    const split = (man?.ship_from || []).length > 1 ? man.ship_from : null;
    const known = pods.length > 0 && pods.every((p) => p.accepted_count != null);
    const accepted = known ? pods.reduce((s, p) => s + p.accepted_count, 0) : null;
    const podSplit = pods.length > 1 ? pods.map((p) => `${p.location || 'POD'} ${p.accepted_count ?? '?'}`).join(' + ') : null;
    const paidFor = qty - (claimedCases ?? 0);
    const exceptions = pods.map((p) => p.exceptions).filter(Boolean).join('; ');
    const receivedBy = pods.length === 1 ? pods[0].received_by : null;

    const trail = [
      node('Billed', qty, 'cases on the invoice'),
      node('Shipped', shipped ?? '?', split ? split.map((s) => `${s.location} ${s.cases}`).join(' · ') : 'cases on the manifest', shipped === qty ? 'ok' : 'warn'),
      node('Accepted', accepted ?? '?', !pods.length ? 'no POD on file' : accepted == null ? 'not written on the POD' : podSplit ? podSplit : accepted < qty ? `${qty - accepted} refused at dock` : 'signed for at the DC', accepted == null ? 'warn' : accepted < qty ? 'info' : 'ok'),
      node('Paid for', paidFor, `per ${payer}'s remittance`, 'muted'),
    ];
    const r = { trail, proof: pods.length > 1 ? 'PODs' : 'POD' };
    const ev = { request: `Our manifest shows ${shipped ?? qty} cases shipped and the delivery receipt was signed at your distribution center, but it doesn't show an accepted count.` };
    const ask = { request: `Please send the receiving count and backup for the ${moneyExact(claimed)} deduction.` };

    if (!pods.length) {
      return { ...r, verdict: 'request_evidence', headline: 'No proof of delivery on file.', detail: `Ask ${payer} for their receiving count before deciding.`, amount: claimed, note: `There's no POD in the packet, so the ${claimedCases}-case shortage can't be checked.`, ev, ask };
    }
    if (accepted == null) {
      return { ...r, verdict: 'request_evidence', headline: `Need ${payer}'s receiving count.`, detail: `The POD is signed but shows no accepted count, so the ${claimedCases}-case shortage is a claim, not proven.`, amount: claimed, note: `The POD was signed${receivedBy ? ` by ${receivedBy}` : ''}, but nobody wrote down how many cases were accepted. ${payer} paid for ${paidFor}, so ${claimedCases} cases are unaccounted for.`, ev, ask };
    }
    if (accepted >= qty) {
      const matchesOne = pods.length > 1 && pods.find((p) => p.accepted_count === paidFor);
      ev.dispute = `The proof${pods.length > 1 ? 's' : ''} of delivery show${pods.length > 1 ? '' : 's'} all ${accepted} cases accepted${podSplit ? ` (${podSplit})` : receivedBy ? `, signed by ${receivedBy}` : ''}, matching our manifest.${matchesOne ? ` It looks like only the ${matchesOne.location} delivery was matched; the ${pods.filter((p) => p !== matchesOne).map((p) => p.location).join(', ')} POD is attached.` : ''}`;
      ask.dispute = `Please reverse the ${moneyExact(claimed)} deduction and remit the balance.`;
      return {
        ...r,
        verdict: 'dispute',
        headline: matchesOne ? `${payer} only counted the ${matchesOne.location} delivery.` : 'The POD proves full delivery.',
        detail: matchesOne ? `This was a split shipment. The ${pods.map((p) => p.location).join(' and ')} PODs show ${podSplit} = ${accepted} cases accepted. ${payer} paid for ${paidFor}, exactly the ${matchesOne.location} delivery.` : `All ${accepted} cases were accepted${receivedBy ? ` and signed for by ${receivedBy}` : ''}, with no exceptions. The shortage isn't supported.`,
        amount: claimed,
        note: matchesOne ? `Two warehouses, two PODs. ${payer}'s deduction equals the ${pods.filter((p) => p !== matchesOne).map((p) => `${p.location} delivery (${p.accepted_count} cases)`).join(', ')}, which it never matched.` : `All ${accepted} cases were accepted at the dock. Nothing supports the ${claimedCases}-case shortage.`,
        ev,
        ask,
      };
    }
    const supported = qty - accepted;
    if (claimedCases != null && supported === claimedCases) {
      return {
        ...r,
        verdict: 'valid',
        headline: 'This deduction is valid.',
        detail: `The POD shows ${accepted} of ${qty} accepted${exceptions ? `: "${exceptions}"` : ''}. ${payer}'s ${claimedCases}-case deduction matches.`,
        amount: 0,
        note: `${supported} cases were refused at the dock${exceptions ? ` ("${exceptions}")` : ''}. That matches the ${claimedCases}-case deduction.`,
        acceptNote: `POD shows ${accepted} of ${qty} accepted${exceptions ? `: ${exceptions}` : ''}.`,
        validWhy: `The POD shows ${supported} cases refused, matching the deduction.`,
        ev,
        ask,
      };
    }
    const over = round2(((claimedCases ?? 0) - supported) * rate);
    ev.dispute = `The proof of delivery shows ${accepted} of ${qty} cases accepted, so only ${supported} cases were short, not ${claimedCases}.`;
    ask.dispute = `Please reverse ${moneyExact(over)} of the deduction and remit the balance.`;
    return { ...r, verdict: 'dispute', headline: 'The deduction is larger than the POD supports.', detail: `The POD supports ${supported} short cases; ${payer} deducted ${claimedCases}. Dispute the difference.`, amount: over, note: `Only ${supported} cases are missing on the POD, so ${(claimedCases ?? 0) - supported} cases (${money(over)}) are over-deducted.`, ev, ask };
  },

  pricing(x) {
    const { payer, claimed, rate, qty, claimedCases, invoiceDate, docs, n } = x;
    const letter = docs.price_letter[0];
    const cases = claimedCases || qty;
    const perCase = round2(claimed / cases);
    const paidRate = round2(rate - perCase);
    const trail = [
      node('Invoiced at', usd(rate), `per case · ${short(invoiceDate)}`),
      node('New cost', letter ? usd(letter.new_cost) : '?', letter ? `effective ${short(letter.effective_date)}` : 'no cost change on file', letter ? 'info' : 'warn'),
      node('Paid at', usd(paidRate), `${cases} cases`, 'muted'),
      node('Difference', money(claimed), `${usd(perCase)} × ${cases} cases`, 'warn'),
    ];
    const ev = { request: `We can't match the cost applied to Invoice ${n} to an agreed cost change.` };
    const ask = { request: `Please confirm the cost you applied and send backup for the ${moneyExact(claimed)} deduction.` };
    if (!letter) return { trail, proof: 'invoice', verdict: 'request_evidence', headline: 'No cost change explains this.', detail: `${payer} paid ${usd(paidRate)} per case against ${usd(rate)} invoiced, and there's no agreed cost change on file.`, amount: claimed, note: `${payer} paid ${usd(paidRate)} a case. Nothing on file says the cost changed.`, ev, ask };
    if (invoiceDate < letter.effective_date && Math.abs(letter.current_cost - rate) < 0.005) {
      ev.dispute = `Invoice ${n} is dated ${long(invoiceDate)}, before our new cost of ${usd(letter.new_cost)} takes effect on ${long(letter.effective_date)}, so the current cost of ${usd(letter.current_cost)} applies.`;
      ask.dispute = `Please reverse the ${moneyExact(claimed)} price deduction and remit the balance.`;
      return { trail, proof: 'cost change notice', verdict: 'dispute', headline: `${payer} applied the new cost too early.`, detail: `They paid ${usd(paidRate)} a case, the new cost that starts ${short(letter.effective_date)}. Invoice ${n} is dated ${short(invoiceDate)}, so ${usd(rate)} applies.`, amount: claimed, note: `The invoice is dated ${short(invoiceDate)}. The ${usd(letter.new_cost)} cost doesn't start until ${short(letter.effective_date)}.`, ev, ask };
    }
    return { trail, proof: 'cost change notice', verdict: 'valid', headline: 'This price deduction is valid.', detail: `Invoice ${n} was billed at the old cost after the new cost took effect on ${short(letter.effective_date)}.`, amount: 0, note: `The new cost was already in effect when we invoiced.`, acceptNote: `Billed at ${usd(rate)} after the ${usd(letter.new_cost)} cost took effect ${short(letter.effective_date)}. Fix pricing in QuickBooks.`, validWhy: 'The new cost was already in effect when we invoiced.', ev, ask };
  },

  promo(x) {
    const { payer, claimed, qty, invoiceDate, docs } = x;
    const ag = docs.promo_agreement[0];
    const trailNo = [node('Agreement', '?', 'no promotion on file', 'warn'), node('Deducted', money(claimed), x.reason, 'muted')];
    const ev = { request: `We don't have a promotion agreement that covers this deduction.` };
    const ask = { request: `Please send the promotion agreement and proof of performance for the ${moneyExact(claimed)} deduction.` };
    if (!ag) return { trail: trailNo, proof: 'invoice', verdict: 'request_evidence', headline: 'No promotion explains this.', detail: `There's no promotion agreement on file for this ${money(claimed)} chargeback.`, amount: claimed, note: 'No agreement in the packet.', ev, ask };
    const inPeriod = (!ag.period_start || invoiceDate >= ag.period_start) && (!ag.period_end || invoiceDate <= ag.period_end);
    const eligible = inPeriod ? Math.min(qty, ag.max_cases ?? qty) : 0;
    const agreed = round2(ag.lump_sum ?? (ag.rate_per_case ?? 0) * eligible);
    const trail = [
      node('Agreed rate', ag.lump_sum ? money(ag.lump_sum) : usd(ag.rate_per_case), ag.lump_sum ? 'lump sum' : `per case · ${ag.name || 'promotion'}`),
      node('Eligible', eligible, inPeriod ? `cases in ${short(ag.period_start)}–${short(ag.period_end)}` : 'invoice is outside the promo period', inPeriod ? 'ok' : 'warn'),
      node('Agreed total', money(agreed), 'what the agreement allows'),
      node('Deducted', money(claimed), claimed > agreed + 0.005 ? `${money(claimed - agreed)} over` : 'matches', claimed > agreed + 0.005 ? 'warn' : 'ok'),
    ];
    if (claimed <= agreed + 0.005) {
      return { trail, proof: 'promotion agreement', verdict: 'valid', headline: 'This promo chargeback is valid.', detail: `The ${ag.name || 'promotion'} agreement allows ${usd(ag.rate_per_case)} a case on ${eligible} cases = ${money(agreed)}. ${payer} deducted ${money(claimed)}.`, amount: 0, note: `${usd(ag.rate_per_case)} × ${eligible} cases = ${money(agreed)}, exactly what was deducted.`, acceptNote: `Matches the ${ag.name} agreement (${usd(ag.rate_per_case)} × ${eligible} cases).`, validWhy: `It matches the signed ${ag.name || 'promotion'} agreement.`, ev, ask };
    }
    const over = round2(claimed - agreed);
    ev.dispute = inPeriod ? `Our ${ag.name || 'promotion'} agreement allows ${usd(ag.rate_per_case)} a case on up to ${ag.max_cases} cases, which comes to ${moneyExact(agreed)} for this invoice.` : `This invoice is dated ${long(invoiceDate)}, outside the ${ag.name} period (${long(ag.period_start)} to ${long(ag.period_end)}).`;
    ask.dispute = `Please reverse the ${moneyExact(over)} deducted above the agreed amount.`;
    return { trail, proof: 'promotion agreement', verdict: 'dispute', headline: 'The chargeback is more than the agreement allows.', detail: `The agreement allows ${money(agreed)}; ${payer} deducted ${money(claimed)}.`, amount: over, note: `${money(over)} more than the agreement allows.`, ev, ask };
  },

  slotting(x) {
    const { payer, claimed, docs } = x;
    const ag = docs.slotting_agreement[0];
    const ev = { request: `We couldn't find a slotting agreement for this deduction.` };
    const ask = { request: `Please send the signed agreement for the ${moneyExact(claimed)} slotting deduction.` };
    if (!ag) return { trail: [node('Agreement', '?', 'none on file', 'warn'), node('Deducted', money(claimed), 'slotting', 'muted')], proof: 'invoice', verdict: 'request_evidence', headline: 'No slotting agreement on file.', detail: `Ask ${payer} for the signed agreement behind this ${money(claimed)} fee.`, amount: claimed, note: 'No agreement in the packet.', ev, ask };
    const over = round2(claimed - ag.fee);
    const trail = [
      node('Agreed fee', money(ag.fee), `${ag.items} item · ${ag.stores} store · signed ${short(ag.signed_date)}`),
      node('Deducted', money(claimed), `by ${payer}`, over > 0.005 ? 'warn' : 'ok'),
      node(over > 0.005 ? 'Over-deducted' : 'Difference', money(Math.max(over, 0)), over > 0.005 ? 'not in the agreement' : 'matches the agreement', over > 0.005 ? 'warn' : 'ok'),
    ];
    if (over <= 0.005) return { trail, proof: 'slotting agreement', verdict: 'valid', headline: 'This slotting fee is valid.', detail: `It matches the signed agreement: ${money(ag.fee)} for ${ag.items} new item.`, amount: 0, note: `${payer} deducted exactly the agreed ${money(ag.fee)}.`, acceptNote: `Matches the signed slotting agreement (${money(ag.fee)}).`, validWhy: 'It matches the signed slotting agreement.', ev, ask };
    ev.dispute = `Our signed slotting agreement sets a one-time fee of ${moneyExact(ag.fee)}, but ${moneyExact(claimed)} was deducted.`;
    ask.dispute = `Please reverse the ${moneyExact(over)} over-deduction and remit the balance.`;
    return { trail, proof: 'slotting agreement', verdict: 'dispute', headline: `${payer} deducted ${claimed / ag.fee === 2 ? 'double' : 'more than'} the agreed fee.`, detail: `The signed agreement says ${money(ag.fee)}; ${payer} took ${money(claimed)}. Dispute the ${money(over)} difference.`, amount: over, note: `The agreement caps the fee at ${money(ag.fee)}. ${money(over)} is over-deducted.`, ev, ask };
  },

  otif(x) {
    const { payer, claimed, billed, qty, docs } = x;
    const po = docs.purchase_order[0];
    const appt = docs.appointment[0];
    const pod = docs.pod[0];
    const mabd = po?.must_arrive_by;
    const delivered = pod?.delivery_date || appt?.delivered_date;
    const accepted = pod?.accepted_count;
    const inFull = accepted != null ? accepted >= qty : null;
    const pct = round2((claimed / billed) * 100);
    const moved = appt?.changed_by === 'consignee';
    const trail = [
      node('Must arrive by', short(mabd), 'per the purchase order'),
      node('Appointment', appt ? short(appt.delivered_date) : '?', appt ? (appt.changed_by ? `moved by ${appt.changed_by === 'consignee' ? payer + "'s DC" : 'the carrier'}` : 'unchanged') : 'no record', moved ? 'info' : appt?.changed_by === 'carrier' ? 'warn' : 'ok'),
      node('Delivered', short(delivered), accepted != null ? `${accepted}/${qty} cases accepted` : 'quantity unknown', delivered && mabd && delivered > mabd ? 'warn' : 'ok'),
      node('Fined', money(claimed), `${pct}% of ${money(billed)}`, 'muted'),
    ];
    const ev = { request: `We can't match this fine to a late or short delivery.` };
    const ask = { request: `Please send the OTIF detail (must-arrive-by date, receipt date and quantity) for the ${moneyExact(claimed)} fine.` };
    if (!mabd || !delivered) return { trail, proof: 'POD', verdict: 'request_evidence', headline: 'Not enough to check the fine.', detail: `Ask ${payer} for the OTIF detail behind the ${money(claimed)} fine.`, amount: claimed, note: 'Missing the must-arrive-by date or the delivery date.', ev, ask };
    if (inFull !== false && (delivered <= mabd || moved)) {
      ev.dispute = moved
        ? `The delivery appointment for ${long(mabd)} was rescheduled by your DC to ${long(appt.delivered_date)} (${String(appt.reason || '').replace(/^rescheduled by (the )?dc:?\s*/i, '')}). The order arrived on that appointment with all ${accepted} cases accepted, so the delay wasn't caused by the supplier.`
        : `The order arrived on ${long(delivered)}, on or before the must-arrive-by date of ${long(mabd)}, with all ${accepted} cases accepted.`;
      ask.dispute = `Please reverse the ${moneyExact(claimed)} OTIF fine.`;
      return {
        trail,
        proof: moved ? 'appointment record' : 'POD',
        verdict: 'dispute',
        headline: moved ? `${payer}'s DC moved the appointment.` : 'Delivered on time and in full.',
        detail: moved ? `The order was due ${short(mabd)}. The DC rescheduled the appointment to ${short(appt.delivered_date)} (${String(appt.reason || '').replace(/^rescheduled by (the )?dc:?\s*/i, '')}), and all ${accepted} cases were accepted that day. A DC-caused delay shouldn't count against OTIF.` : `It arrived ${short(delivered)}, by the ${short(mabd)} deadline, with all ${accepted} cases accepted.`,
        amount: claimed,
        note: moved ? `It arrived late only because the DC moved the appointment. All ${accepted} cases were accepted.` : 'On time and in full.',
        ev,
        ask,
      };
    }
    const why = inFull === false ? `short by ${qty - accepted} cases` : `${short(delivered)} vs. ${short(mabd)}${appt?.changed_by === 'carrier' ? ', after the carrier missed its appointment' : ''}`;
    return {
      trail,
      proof: 'POD',
      verdict: 'valid',
      headline: 'This fine is valid.',
      detail: `The delivery was late (${why}). The ${pct}% fine applies.${appt?.changed_by === 'carrier' ? ` Recover the ${money(claimed)} from the carrier instead.` : ''}`,
      amount: 0,
      note: `It was due ${short(mabd)} and arrived ${short(delivered)}${appt?.changed_by === 'carrier' ? '. The carrier missed the appointment' : ''}.`,
      acceptNote: `Late delivery: ${why}. ${appt?.changed_by === 'carrier' ? 'File a carrier claim for the fine.' : ''}`.trim(),
      validWhy: `It arrived late on the carrier, not ${payer}.`,
      ev,
      ask,
    };
  },

  other(x) {
    const { payer, claimed } = x;
    return { trail: [node('Deducted', money(claimed), x.reason, 'warn')], proof: 'invoice', verdict: 'request_evidence', headline: `Ask ${payer} for backup.`, detail: `There's nothing on file that explains this ${money(claimed)} deduction.`, amount: claimed, note: 'No supporting documents for this deduction type.', ev: { request: 'We could not find support for this deduction.' }, ask: { request: `Please send backup for the ${moneyExact(claimed)} deduction.` } };
  },
};

const REQUEST_TITLE = { quantity: 'Request the receiving count', pricing: 'Ask which cost they used', promo: 'Request the promo backup', slotting: 'Request the slotting backup', otif: 'Request the OTIF detail', other: 'Request backup' };
const REQUEST_SUBJECT = { quantity: 'receiving detail', pricing: 'cost applied', promo: 'promotion backup', slotting: 'slotting backup', otif: 'OTIF detail', other: 'deduction backup' };

export function assess(c) {
  const { invoice, payments, remittance, docs: docList = [], review = [] } = c;
  if (!invoice) throw new Error('Look up the invoice first.');
  const line = remittance?.line || {};
  const billed = invoice.total;
  const paid = payments?.totalPaid ?? 0;
  const gap = round2(billed - paid);
  const qty = invoice.lines.reduce((s, l) => s + l.qty, 0);
  const rate = invoice.lines[0]?.rate ?? 0;
  const payer = invoice.customer;
  const claimed = line.deducted ?? gap;
  const type = typeOf(line.deduction_code, line.reason);
  const docs = { invoice: [], manifest: [], pod: [], price_letter: [], promo_agreement: [], slotting_agreement: [], purchase_order: [], appointment: [] };
  for (const d of docList) (docs[d.kind] ||= []).push(d.fields || {});

  const x = { n: invoice.docNumber, payer, claimed, claimedCases: line.cases ?? null, qty, rate, billed, invoiceDate: invoice.txnDate, reason: line.reason, docs };
  const r = (RULES[type] || RULES.other)(x);
  if (gap <= 0) Object.assign(r, { verdict: 'paid_in_full', headline: 'Paid in full.', detail: 'Nothing to resolve on this invoice.', amount: 0 });
  // If any code check failed, Cleared doesn't decide: it hands the case to a person.
  if (review.length) {
    Object.assign(r, {
      verdict: 'needs_review',
      headline: 'This needs a person to check.',
      detail: review[0] + (review.length > 1 ? ` (+${review.length - 1} more)` : ''),
      amount: claimed,
      note: `Cleared's math checks failed, so it won't recommend a dispute or a write-off. ${review.join(' ')}`,
      ev: { ...r.ev, request: `We can't reconcile this payment against our records. ${review[0].replace(/QuickBooks shows/g, 'Our records show').replace(/QuickBooks recorded/g, 'We recorded').replace(/QuickBooks billed/g, 'We billed')}` },
      ask: { ...r.ask, request: `Please send the payment detail and backup for the ${moneyExact(claimed)} deduction so we can match it.` },
      requestSubjectOverride: 'payment detail',
      requestTitle: 'Ask for the payment detail',
      acceptNote: `Accepted after a person checked the numbers. Cleared had flagged: ${review[0]}`,
    });
  }

  const v = r.verdict;
  const amt = money(v === 'dispute' ? r.amount : claimed);
  const isFine = type === 'otif';
  const options = [
    {
      id: 'request',
      title: r.requestTitle || REQUEST_TITLE[type],
      desc: `Ask ${payer} for backup on the ${money(claimed)} ${isFine ? 'fine' : 'deduction'} before deciding.`,
      strength: v === 'request_evidence' || v === 'needs_review' ? 'recommended' : v === 'dispute' ? 'possible' : 'weak',
      why: v === 'needs_review' ? "Get the payer's detail before anyone decides." : v === 'request_evidence' ? r.detail : v === 'dispute' ? 'You already have proof; asking adds a round-trip.' : 'The paperwork already explains it.',
    },
    {
      id: 'dispute',
      title: isFine ? 'Dispute the fine' : r.amount && r.amount < claimed ? `Dispute ${money(r.amount)}` : 'Dispute the deduction',
      desc: `Ask ${payer} to reverse ${amt}, with the ${r.proof} as proof.`,
      strength: v === 'dispute' ? 'recommended' : 'weak',
      why: v === 'needs_review' ? "The numbers don't reconcile. Only a person who has checked them should dispute." : v === 'dispute' ? r.note : v === 'request_evidence' ? 'Without proof, a dispute is easy to deny.' : r.validWhy || 'The evidence supports the deduction.',
    },
    {
      id: 'accept',
      title: isFine ? 'Accept the fine' : 'Accept the deduction',
      desc: `Write off ${money(claimed)} and note it in QuickBooks. Nothing is sent to ${payer}.`,
      strength: v === 'valid' ? 'recommended' : 'weak',
      why: v === 'needs_review' ? "The numbers don't reconcile. Only a person who has checked them should write this off." : v === 'valid' ? r.validWhy || 'The evidence supports it.' : `You'd give up ${money(v === 'dispute' ? r.amount : claimed)} that may be recoverable.`,
    },
  ];

  return {
    type,
    invoiceNumber: invoice.docNumber,
    customer: payer,
    billed,
    paid,
    gap,
    billedQty: qty,
    rate,
    claimedCases: line.cases ?? null,
    claimedAmount: claimed,
    deductionRef: line.deduction_ref || null,
    deductionCode: line.deduction_code || null,
    deductionReason: line.reason || null,
    verdict: v,
    headline: r.headline,
    detail: r.detail,
    amount: r.amount,
    amountLabel: money(r.amount),
    trail: { nodes: r.trail, note: r.note },
    options,
    email: { ev: r.ev, ask: r.ask, requestSubject: r.requestSubjectOverride || REQUEST_SUBJECT[type], proof: r.proof },
    review,
    acceptNote: r.acceptNote || null,
  };
}
