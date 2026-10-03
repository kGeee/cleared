// Arithmetic and validation, done in code. Claude never does math in its head: it calls these,
// and anything that doesn't check out goes to a human instead of being guessed.

const TOL = 0.005; // half a cent

export const round2 = (n) => Math.round(Number(n) * 100) / 100;
const $ = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const same = (a, b, tol = TOL) => a != null && b != null && Math.abs(Number(a) - Number(b)) <= tol;

// ---------- safe calculator ----------
// Grammar: expr := term (('+'|'-') term)* ; term := factor (('*'|'/'|'x'|'×'|'÷') factor)* ;
// factor := ('+'|'-') factor | number '%'? | '(' expr ')' | fn '(' args ')'
// Plain numbers have no commas (so commas separate arguments); $ amounts may use thousands commas ($2,880.00). Functions: round(x[,d]), min, max, abs, sum. No eval.
export function calculate(input) {
  const src = String(input ?? '').trim();
  if (!src) throw new Error('empty expression');
  if (src.length > 200) throw new Error('expression too long');
  const toks = [];
  const re = /\s*(\$(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\d+(?:\.\d+)?|\$?\.\d+|[a-z]+|[-+*/×÷x(),%])/giy;
  let m;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    m = re.exec(src);
    if (!m) throw new Error(`can't read "${src.slice(pos, pos + 12)}"`);
    toks.push(m[1]);
    pos = re.lastIndex;
    while (src[pos] === ' ') pos++;
  }
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  const num = (t) => Number(t.replace(/[$,]/g, ''));
  const FN = { round: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d, min: Math.min, max: Math.max, abs: Math.abs, sum: (...a) => a.reduce((s, v) => s + v, 0) };
  // "a + b%" / "a - b%" means a increased/decreased by b percent, like a calculator.
  const relPct = () => /^\d/.test(toks[i] || '') && toks[i + 1] === '%' && [undefined, '+', '-', ')', ','].includes(toks[i + 2]);
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      if (relPct()) {
        const p = num(next()) / 100;
        next();
        v = op === '+' ? v * (1 + p) : v * (1 - p);
      } else v = op === '+' ? v + term() : v - term();
    }
    return v;
  }
  function term() {
    let v = factor();
    while (['*', '/', 'x', 'X', '×', '÷'].includes(peek())) {
      const op = next();
      const r = factor();
      if ((op === '/' || op === '÷') && r === 0) throw new Error('division by zero');
      v = op === '/' || op === '÷' ? v / r : v * r;
    }
    return v;
  }
  function factor() {
    const t = next();
    if (t === undefined) throw new Error('unexpected end');
    if (t === '-') return -factor();
    if (t === '+') return factor();
    if (t === '(') {
      const v = expr();
      if (next() !== ')') throw new Error('missing )');
      return v;
    }
    if (/^[a-z]+$/i.test(t) && t.toLowerCase() !== 'x') {
      const f = FN[t.toLowerCase()];
      if (!f) throw new Error(`unknown function ${t}`);
      if (next() !== '(') throw new Error(`${t} needs (`);
      const args = [expr()];
      while (peek() === ',') {
        next();
        args.push(expr());
      }
      if (next() !== ')') throw new Error('missing )');
      return f(...args);
    }
    if (/^\$?[\d.]/.test(t)) {
      let v = num(t);
      if (peek() === '%') {
        next();
        v = v / 100;
      }
      return v;
    }
    throw new Error(`unexpected "${t}"`);
  }
  const v = expr();
  if (i < toks.length) throw new Error(`unexpected "${toks[i]}"`);
  if (!Number.isFinite(v)) throw new Error('result is not a finite number');
  return Math.round(v * 1e9) / 1e9;
}

export function verifyEqual(value, expression) {
  const expected = calculate(expression);
  const actual = Number(String(value).replace(/[$,]/g, ''));
  return { ok: same(actual, expected), expected, actual, difference: round2(actual - expected) };
}

export function daysBetween(fromIso, toIso) {
  const a = new Date(String(fromIso).slice(0, 10) + 'T12:00:00Z');
  const b = new Date(String(toIso).slice(0, 10) + 'T12:00:00Z');
  if (isNaN(a) || isNaN(b)) throw new Error('dates must be YYYY-MM-DD');
  return Math.round((b - a) / 86400000);
}
export const today = () => new Date().toLocaleDateString('en-CA');

// ---------- document checks ----------
// Each returns a list of human-readable problems. Empty list = the document's own math holds.
export function checkDocument(kind, f = {}) {
  const issues = [];
  if (kind === 'remittance') {
    if (!f.lines?.length) issues.push('No deduction lines could be read from the payment advice.');
    for (const l of f.lines || []) {
      if ([l.gross, l.deducted, l.paid].some((v) => v == null || isNaN(v))) {
        issues.push(`Invoice ${l.invoice_number}: gross, deducted or paid is missing.`);
        continue;
      }
      if (!same(l.gross - l.deducted, l.paid)) issues.push(`Invoice ${l.invoice_number}: gross ${$(l.gross)} − deducted ${$(l.deducted)} = ${$(l.gross - l.deducted)}, but the payment advice says paid ${$(l.paid)}.`);
      if (l.deducted < 0 || l.deducted > l.gross) issues.push(`Invoice ${l.invoice_number}: deduction ${$(l.deducted)} is outside $0–${$(l.gross)}.`);
    }
  }
  if (kind === 'invoice' && f.qty != null && f.unit_price != null && f.total != null && !same(f.qty * f.unit_price, f.total)) {
    issues.push(`Invoice ${f.invoice_number}: ${f.qty} × ${$(f.unit_price)} = ${$(f.qty * f.unit_price)}, but the total says ${$(f.total)}.`);
  }
  if (kind === 'pod' && f.accepted_count != null && f.cases_on_manifest != null && f.accepted_count > f.cases_on_manifest) {
    issues.push(`POD: accepted ${f.accepted_count} is more than the ${f.cases_on_manifest} cases on the manifest.`);
  }
  if (kind === 'manifest' && f.ship_from?.length > 1 && f.cases_shipped != null) {
    const sum = f.ship_from.reduce((s, x) => s + x.cases, 0);
    if (sum !== f.cases_shipped) issues.push(`Manifest: warehouses add up to ${sum}, but cases shipped says ${f.cases_shipped}.`);
  }
  if (kind === 'price_letter' && f.current_cost != null && f.new_cost != null && f.new_cost <= 0) issues.push('Cost notice: new cost is not positive.');
  if (kind === 'slotting_agreement' && f.fee != null && f.fee <= 0) issues.push('Slotting agreement: fee is not positive.');
  return issues;
}

// QuickBooks vs the payment advice: what we billed minus what QuickBooks says was paid must equal the deduction.
export function checkReconcile({ billed, paid, line }) {
  const issues = [];
  if (!line) return ['The payment advice has no line for this invoice.'];
  if (!same(billed, line.gross)) issues.push(`QuickBooks billed ${$(billed)}, but the payment advice shows gross ${$(line.gross)}.`);
  if (!same(billed - paid, line.deducted)) issues.push(`QuickBooks shows ${$(billed - paid)} unpaid, but the payment advice only deducted ${$(line.deducted)}, so ${$(Math.abs(billed - paid - line.deducted))} is unexplained.`);
  if (!same(paid, line.paid)) issues.push(`QuickBooks recorded ${$(paid)} received; the payment advice says ${$(line.paid)} was paid.`);
  return issues;
}

// ---------- provenance: every number in an answer must come from code or data ----------
export function numbersIn(text) {
  const out = [];
  const re = /\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?/g;
  let m;
  while ((m = re.exec(String(text)))) {
    const raw = m[0];
    const v = Number(raw.replace(/[$,%]/g, ''));
    if (Number.isFinite(v)) out.push({ raw, value: v, money: raw.startsWith('$'), pct: raw.endsWith('%') });
  }
  return out;
}

// Collects every number that appears anywhere in tool results / context (as the set of "known facts").
export function factSet(...sources) {
  const set = new Set();
  const add = (v) => {
    if (Number.isFinite(v)) {
      set.add(round2(v));
      set.add(round2(v * 100)); // 0.03 <-> 3%
      set.add(round2(v / 100));
    }
  };
  const walk = (x) => {
    if (x == null) return;
    if (typeof x === 'number') return add(x);
    if (typeof x === 'string') return numbersIn(x).forEach((n) => add(n.value));
    if (Array.isArray(x)) return x.forEach(walk);
    if (typeof x === 'object') return Object.values(x).forEach(walk);
  };
  sources.forEach(walk);
  return set;
}

// Small counts (0–12) are allowed freely ("two stores", "3 sentences"); everything else must be known.
export function unverifiedNumbers(text, facts) {
  return numbersIn(text).filter((n) => !(Number.isInteger(n.value) && n.value <= 12 && !n.money) && !facts.has(round2(n.value)));
}
