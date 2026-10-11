// MiniDot custom tool "galois_finite_field" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "galois_finite_field",
    "description": "Finite-field / Galois computation toolkit over F_p: constructs GF(p^n) via a found irreducible polynomial, computes Frobenius map x->x^p and its automorphism order (the Galois group of GF(p^n)/GF(p), cyclic of order n), multiplies elements, tests irreducibility (Rabin), and computes multiplicative element orders. Scope: finite Galois facts only — it does not verify FLT.",
    "parameters": {
      "type": "object",
      "properties": {
        "a": {
          "description": "Element/polynomial coefficients low-to-high, comma separated (for multiply/element_order)",
          "type": "string"
        },
        "b": {
          "description": "Second element coefficients (for multiply)",
          "type": "string"
        },
        "f": {
          "description": "Polynomial coefficients low-to-high for irreducible mode",
          "type": "string"
        },
        "mode": {
          "description": "One of: field, multiply, irreducible, element_order",
          "type": "string"
        },
        "n": {
          "description": "Extension degree",
          "type": "integer"
        },
        "p": {
          "description": "Prime base field characteristic",
          "type": "integer"
        }
      },
      "required": [
        "mode"
      ]
    }
  }
};
export const code = "// ===== Finite-field / Galois toolkit over F_p =====\nfunction modP(a, p) { a %= p; if (a < 0n) a += p; return a; }\nfunction norm(a, p) { a = a.map(c => modP(c, p)); while (a.length > 1 && a[a.length - 1] === 0n) a.pop(); return a; }\nfunction deg(a) { return a.length - 1; }\nfunction pAdd(a, b, p) { const n = Math.max(a.length, b.length), r = []; for (let i = 0; i < n; i++) r[i] = modP((a[i] || 0n) + (b[i] || 0n), p); return norm(r, p); }\nfunction pSub(a, b, p) { const n = Math.max(a.length, b.length), r = []; for (let i = 0; i < n; i++) r[i] = modP((a[i] || 0n) - (b[i] || 0n), p); return norm(r, p); }\nfunction pMul(a, b, p) { const r = new Array(a.length + b.length - 1).fill(0n); for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) r[i + j] = modP(r[i + j] + a[i] * b[j], p); return norm(r, p); }\nfunction pEq(a, b, p) { a = norm(a, p); b = norm(b, p); if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }\nfunction egcd(a, b) { if (b === 0n) return [a, 1n, 0n]; const [g, x, y] = egcd(b, a % b); return [g, y, x - (a / b) * y]; }\nfunction invMod(a, p) { a = modP(a, p); if (a === 0n) throw new Error('no inverse of 0'); const [g, x] = egcd(a, p); if (g !== 1n) throw new Error('not invertible'); return modP(x, p); }\nfunction pMod(a, f, p) {\n  a = norm(a, p); f = norm(f, p);\n  const df = deg(f);\n  if (df === 0) { if (f[0] === 0n) throw new Error('divide by zero polynomial'); return [0n]; }\n  const inv = invMod(f[df], p);\n  a = a.slice();\n  for (let i = deg(a); i >= df; i--) {\n    if (a[i] === 0n) continue;\n    const factor = modP(a[i] * inv, p);\n    for (let j = 0; j <= df; j++) a[i - df + j] = modP(a[i - df + j] - factor * f[j], p);\n  }\n  return norm(a, p);\n}\nfunction pGCD(a, b, p) {\n  a = norm(a, p); b = norm(b, p);\n  while (!(b.length === 1 && b[0] === 0n)) {\n    if (deg(b) === 0) return [1n];\n    const r = pMod(a, b, p); a = b; b = r;\n  }\n  return a;\n}\nfunction pPowMod(base, e, f, p) { let r = [1n]; let b = pMod(base, f, p); while (e > 0n) { if (e & 1n) r = pMod(pMul(r, b, p), f, p); b = pMod(pMul(b, b, p), f, p); e >>= 1n; } return r; }\nfunction bigPow(b, e) { let r = 1n; for (let i = 0n; i < e; i++) r *= b; return r; }\nfunction smallPrimeFactors(n) { const fs = []; let m = n; for (let d = 2; d * d <= m; d++) { if (m % d === 0) { fs.push(d); while (m % d === 0) m /= d; } } if (m > 1) fs.push(m); return fs; }\nfunction makeMonic(f, p) { f = norm(f, p); const inv = invMod(f[deg(f)], p); return norm(f.map(c => modP(c * inv, p)), p); }\nfunction isIrreducible(f, p) {\n  f = norm(f, p);\n  const n = deg(f);\n  if (n <= 0) return false;\n  if (n === 1) return true;\n  f = makeMonic(f, p);\n  const x = [0n, 1n];\n  const pn = bigPow(p, BigInt(n));\n  if (!pEq(pPowMod(x, pn, f, p), x, p)) return false;\n  for (const q of smallPrimeFactors(n)) {\n    const m = bigPow(p, BigInt(n / q));\n    const g = pSub(pPowMod(x, m, f, p), x, p);\n    if (deg(pGCD(f, g, p)) > 0) return false;\n  }\n  return true;\n}\nfunction findIrreducible(p, n) {\n  if (n === 1) return [0n, 1n];\n  const total = Number(bigPow(p, BigInt(n)));\n  if (total > 300000) throw new Error('search space too large; pick smaller p,n');\n  for (let code = 0; code < total; code++) {\n    let c = code; const f = [];\n    for (let i = 0; i < n; i++) { f.push(BigInt(c % Number(p))); c = Math.floor(c / Number(p)); }\n    if (f[0] === 0n) continue;\n    f.push(1n);\n    if (isIrreducible(f, p)) return f;\n  }\n  throw new Error('no irreducible found');\n}\nfunction polyStr(a) {\n  const terms = [];\n  for (let i = 0; i < a.length; i++) if (a[i] !== 0n) terms.push(i === 0 ? a[i].toString() : (a[i] === 1n ? '' : a[i].toString()) + (i === 1 ? 'x' : 'x^' + i));\n  return terms.length ? terms.join(' + ') : '0';\n}\nfunction parsePoly(str, p) {\n  if (str == null || str === '') throw new Error('missing polynomial');\n  return norm(String(str).split(/[,\\s]+/).filter(s => s.length).map(s => { if (!/^[-+]?\\d+$/.test(s)) throw new Error('bad coeff ' + s); return modP(BigInt(s), p); }), p);\n}\n\nconst mode = args.mode || 'field';\nconst out = { ok: true, mode, scope: 'Finite-field Galois computation over F_p. Verifies finite Galois facts; it does NOT and cannot verify Fermat\\'s Last Theorem (a universal statement about all n and all triples).' };\ntry {\n  const p = args.p != null ? BigInt(args.p) : null;\n  if (!p && mode !== 'none') throw new Error('p required');\n  const n = args.n != null ? parseInt(args.n) : 1;\n\n  if (mode === 'field') {\n    const f = findIrreducible(p, n);\n    const order = bigPow(p, BigInt(n)) - 1n;\n    let frobStr, k;\n    if (n === 1) {\n      frobStr = 'identity (on F_' + p.toString() + ', x^' + p.toString() + ' = x)';\n      k = 1;\n    } else {\n      const x = [0n, 1n];\n      const frob = pPowMod(x, p, f, p);\n      k = 1; let cur = frob;\n      while (!pEq(cur, x, p) && k < 100000) { cur = pPowMod(cur, p, f, p); k++; }\n      frobStr = 'x -> x^' + p.toString() + ' = ' + polyStr(frob);\n    }\n    out.Fp = p.toString();\n    out.degree = n;\n    out.field = 'GF(' + p.toString() + '^' + n + ')';\n    out.size = bigPow(p, BigInt(n)).toString();\n    out.irreducible_polynomial = polyStr(f);\n    out.multiplicative_group_order = order.toString();\n    out.frobenius_map = frobStr;\n    out.frobenius_automorphism_order = k;\n    out.galois_group = 'cyclic of order ' + n + ' generated by Frobenius';\n    out.galois_group_correct = (k === n);\n  }\n  else if (mode === 'multiply') {\n    const f = findIrreducible(p, n);\n    const a = parsePoly(args.a, p), b = parsePoly(args.b, p);\n    const prod = pMod(pMul(a, b, p), f, p);\n    out.irreducible_polynomial = polyStr(f);\n    out.a = polyStr(a); out.b = polyStr(b);\n    out.sum = polyStr(pAdd(a, b, p));\n    out.product_mod_f = polyStr(prod);\n    out.check_in_field = deg(prod) < n;\n  }\n  else if (mode === 'irreducible') {\n    const f = parsePoly(args.f, p);\n    out.polynomial = polyStr(f);\n    out.degree = deg(norm(f, p));\n    out.irreducible_over_Fp = isIrreducible(f, p);\n  }\n  else if (mode === 'element_order') {\n    const f = findIrreducible(p, n);\n    const a = pMod(parsePoly(args.a, p), f, p);\n    const N = bigPow(p, BigInt(n)) - 1n;\n    const fac = []; { let m = N, d = 2n; while (d * d <= m && d < 200000n) { if (m % d === 0n) { fac.push(d); while (m % d === 0n) m /= d; } d++; } if (m > 1n) fac.push(m); }\n    let order = N;\n    for (const q of fac) { while (order % q === 0n && pEq(pPowMod(a, order / q, f, p), [1n], p)) order /= q; }\n    out.irreducible_polynomial = polyStr(f);\n    out.a = polyStr(a);\n    out.group_order = N.toString();\n    out.element_multiplicative_order = order.toString();\n    out.divides_group_order = (N % order === 0n);\n    out.is_primitive_element = (order === N);\n  }\n  else if (mode === 'none') { out.note = 'nothing computed'; }\n  else throw new Error('unknown mode: ' + mode);\n} catch (e) { return { ok: false, error: e.message, mode }; }\nreturn out;\n";

export async function run(args, ctx) {
// ===== Finite-field / Galois toolkit over F_p =====
function modP(a, p) { a %= p; if (a < 0n) a += p; return a; }
function norm(a, p) { a = a.map(c => modP(c, p)); while (a.length > 1 && a[a.length - 1] === 0n) a.pop(); return a; }
function deg(a) { return a.length - 1; }
function pAdd(a, b, p) { const n = Math.max(a.length, b.length), r = []; for (let i = 0; i < n; i++) r[i] = modP((a[i] || 0n) + (b[i] || 0n), p); return norm(r, p); }
function pSub(a, b, p) { const n = Math.max(a.length, b.length), r = []; for (let i = 0; i < n; i++) r[i] = modP((a[i] || 0n) - (b[i] || 0n), p); return norm(r, p); }
function pMul(a, b, p) { const r = new Array(a.length + b.length - 1).fill(0n); for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) r[i + j] = modP(r[i + j] + a[i] * b[j], p); return norm(r, p); }
function pEq(a, b, p) { a = norm(a, p); b = norm(b, p); if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
function egcd(a, b) { if (b === 0n) return [a, 1n, 0n]; const [g, x, y] = egcd(b, a % b); return [g, y, x - (a / b) * y]; }
function invMod(a, p) { a = modP(a, p); if (a === 0n) throw new Error('no inverse of 0'); const [g, x] = egcd(a, p); if (g !== 1n) throw new Error('not invertible'); return modP(x, p); }
function pMod(a, f, p) {
  a = norm(a, p); f = norm(f, p);
  const df = deg(f);
  if (df === 0) { if (f[0] === 0n) throw new Error('divide by zero polynomial'); return [0n]; }
  const inv = invMod(f[df], p);
  a = a.slice();
  for (let i = deg(a); i >= df; i--) {
    if (a[i] === 0n) continue;
    const factor = modP(a[i] * inv, p);
    for (let j = 0; j <= df; j++) a[i - df + j] = modP(a[i - df + j] - factor * f[j], p);
  }
  return norm(a, p);
}
function pGCD(a, b, p) {
  a = norm(a, p); b = norm(b, p);
  while (!(b.length === 1 && b[0] === 0n)) {
    if (deg(b) === 0) return [1n];
    const r = pMod(a, b, p); a = b; b = r;
  }
  return a;
}
function pPowMod(base, e, f, p) { let r = [1n]; let b = pMod(base, f, p); while (e > 0n) { if (e & 1n) r = pMod(pMul(r, b, p), f, p); b = pMod(pMul(b, b, p), f, p); e >>= 1n; } return r; }
function bigPow(b, e) { let r = 1n; for (let i = 0n; i < e; i++) r *= b; return r; }
function smallPrimeFactors(n) { const fs = []; let m = n; for (let d = 2; d * d <= m; d++) { if (m % d === 0) { fs.push(d); while (m % d === 0) m /= d; } } if (m > 1) fs.push(m); return fs; }
function makeMonic(f, p) { f = norm(f, p); const inv = invMod(f[deg(f)], p); return norm(f.map(c => modP(c * inv, p)), p); }
function isIrreducible(f, p) {
  f = norm(f, p);
  const n = deg(f);
  if (n <= 0) return false;
  if (n === 1) return true;
  f = makeMonic(f, p);
  const x = [0n, 1n];
  const pn = bigPow(p, BigInt(n));
  if (!pEq(pPowMod(x, pn, f, p), x, p)) return false;
  for (const q of smallPrimeFactors(n)) {
    const m = bigPow(p, BigInt(n / q));
    const g = pSub(pPowMod(x, m, f, p), x, p);
    if (deg(pGCD(f, g, p)) > 0) return false;
  }
  return true;
}
function findIrreducible(p, n) {
  if (n === 1) return [0n, 1n];
  const total = Number(bigPow(p, BigInt(n)));
  if (total > 300000) throw new Error('search space too large; pick smaller p,n');
  for (let code = 0; code < total; code++) {
    let c = code; const f = [];
    for (let i = 0; i < n; i++) { f.push(BigInt(c % Number(p))); c = Math.floor(c / Number(p)); }
    if (f[0] === 0n) continue;
    f.push(1n);
    if (isIrreducible(f, p)) return f;
  }
  throw new Error('no irreducible found');
}
function polyStr(a) {
  const terms = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== 0n) terms.push(i === 0 ? a[i].toString() : (a[i] === 1n ? '' : a[i].toString()) + (i === 1 ? 'x' : 'x^' + i));
  return terms.length ? terms.join(' + ') : '0';
}
function parsePoly(str, p) {
  if (str == null || str === '') throw new Error('missing polynomial');
  return norm(String(str).split(/[,\s]+/).filter(s => s.length).map(s => { if (!/^[-+]?\d+$/.test(s)) throw new Error('bad coeff ' + s); return modP(BigInt(s), p); }), p);
}

const mode = args.mode || 'field';
const out = { ok: true, mode, scope: 'Finite-field Galois computation over F_p. Verifies finite Galois facts; it does NOT and cannot verify Fermat\'s Last Theorem (a universal statement about all n and all triples).' };
try {
  const p = args.p != null ? BigInt(args.p) : null;
  if (!p && mode !== 'none') throw new Error('p required');
  const n = args.n != null ? parseInt(args.n) : 1;

  if (mode === 'field') {
    const f = findIrreducible(p, n);
    const order = bigPow(p, BigInt(n)) - 1n;
    let frobStr, k;
    if (n === 1) {
      frobStr = 'identity (on F_' + p.toString() + ', x^' + p.toString() + ' = x)';
      k = 1;
    } else {
      const x = [0n, 1n];
      const frob = pPowMod(x, p, f, p);
      k = 1; let cur = frob;
      while (!pEq(cur, x, p) && k < 100000) { cur = pPowMod(cur, p, f, p); k++; }
      frobStr = 'x -> x^' + p.toString() + ' = ' + polyStr(frob);
    }
    out.Fp = p.toString();
    out.degree = n;
    out.field = 'GF(' + p.toString() + '^' + n + ')';
    out.size = bigPow(p, BigInt(n)).toString();
    out.irreducible_polynomial = polyStr(f);
    out.multiplicative_group_order = order.toString();
    out.frobenius_map = frobStr;
    out.frobenius_automorphism_order = k;
    out.galois_group = 'cyclic of order ' + n + ' generated by Frobenius';
    out.galois_group_correct = (k === n);
  }
  else if (mode === 'multiply') {
    const f = findIrreducible(p, n);
    const a = parsePoly(args.a, p), b = parsePoly(args.b, p);
    const prod = pMod(pMul(a, b, p), f, p);
    out.irreducible_polynomial = polyStr(f);
    out.a = polyStr(a); out.b = polyStr(b);
    out.sum = polyStr(pAdd(a, b, p));
    out.product_mod_f = polyStr(prod);
    out.check_in_field = deg(prod) < n;
  }
  else if (mode === 'irreducible') {
    const f = parsePoly(args.f, p);
    out.polynomial = polyStr(f);
    out.degree = deg(norm(f, p));
    out.irreducible_over_Fp = isIrreducible(f, p);
  }
  else if (mode === 'element_order') {
    const f = findIrreducible(p, n);
    const a = pMod(parsePoly(args.a, p), f, p);
    const N = bigPow(p, BigInt(n)) - 1n;
    const fac = []; { let m = N, d = 2n; while (d * d <= m && d < 200000n) { if (m % d === 0n) { fac.push(d); while (m % d === 0n) m /= d; } d++; } if (m > 1n) fac.push(m); }
    let order = N;
    for (const q of fac) { while (order % q === 0n && pEq(pPowMod(a, order / q, f, p), [1n], p)) order /= q; }
    out.irreducible_polynomial = polyStr(f);
    out.a = polyStr(a);
    out.group_order = N.toString();
    out.element_multiplicative_order = order.toString();
    out.divides_group_order = (N % order === 0n);
    out.is_primitive_element = (order === N);
  }
  else if (mode === 'none') { out.note = 'nothing computed'; }
  else throw new Error('unknown mode: ' + mode);
} catch (e) { return { ok: false, error: e.message, mode }; }
return out;

}
