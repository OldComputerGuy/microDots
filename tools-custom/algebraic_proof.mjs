// MicroDot custom tool "algebraic_proof" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "algebraic_proof",
    "description": "Symbolically verify whether two algebraic expressions are identically equal. Expands both sides as exact polynomials (rational coefficients), compares LHS-RHS, and reports the difference or proves the identity. Falls back to numeric sampling. Supports + - * / ^, parentheses, multiple variables, non-negative integer exponents.",
    "parameters": {
      "properties": {
        "lhs": {
          "description": "Left-hand side expression, e.g. '(a+b)^2'",
          "type": "string"
        },
        "rhs": {
          "description": "Right-hand side expression, e.g. 'a^2 + 2*a*b + b^2'",
          "type": "string"
        },
        "symbolic": {
          "description": "Set false to skip symbolic expansion and only do numeric testing",
          "type": "boolean"
        }
      },
      "required": [
        "lhs",
        "rhs"
      ],
      "type": "object"
    }
  }
};
export const code = "// ---- Exact rational arithmetic ----\nfunction gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a; }\nfunction Frac(n, d = 1) {\n  if (d === 0) throw new Error('Division by zero');\n  if (d < 0) { n = -n; d = -d; }\n  const g = gcd(n, d) || 1;\n  return { n: n / g, d: d / g };\n}\nconst fAdd = (a, b) => Frac(a.n * b.d + b.n * a.d, a.d * b.d);\nconst fSub = (a, b) => Frac(a.n * b.d - b.n * a.d, a.d * b.d);\nconst fMul = (a, b) => Frac(a.n * b.n, a.d * b.d);\nconst fNeg = (a) => Frac(-a.n, a.d);\nconst fInv = (a) => { if (a.n === 0) throw new Error('Division by zero'); return Frac(a.d, a.n); };\nconst fStr = (a) => a.d === 1 ? String(a.n) : a.n + '/' + a.d;\nconst fIsInt = (a) => a.d === 1;\n\n// ---- Polynomial: Map<monoKey, {c:Frac, m:{var:exp}}> ----\nfunction monoKey(m) {\n  return Object.keys(m).filter(v => m[v] !== 0).sort()\n    .map(v => v + '^' + m[v]).join('*') || '1';\n}\nfunction mulMono(a, b) { const r = { ...a }; for (const v in b) r[v] = (r[v] || 0) + b[v]; return r; }\nfunction Poly() { this.terms = new Map(); }\nPoly.prototype.addTerm = function (c, m) {\n  if (c.n === 0) return;\n  const k = monoKey(m);\n  const ex = this.terms.get(k);\n  if (ex) { ex.c = fAdd(ex.c, c); if (ex.c.n === 0) this.terms.delete(k); }\n  else this.terms.set(k, { c, m: { ...m } });\n};\nfunction constPoly(f) { const p = new Poly(); p.addTerm(f, {}); return p; }\nfunction varPoly(name) { const p = new Poly(); p.addTerm(Frac(1), { [name]: 1 }); return p; }\nfunction addPoly(A, B) { const r = new Poly(); for (const t of A.terms.values()) r.addTerm(t.c, t.m); for (const t of B.terms.values()) r.addTerm(t.c, t.m); return r; }\nfunction scalePoly(A, f) { const r = new Poly(); for (const t of A.terms.values()) r.addTerm(fMul(t.c, f), t.m); return r; }\nfunction subPoly(A, B) { return addPoly(A, scalePoly(B, Frac(-1))); }\nfunction mulPoly(A, B) { const r = new Poly(); for (const a of A.terms.values()) for (const b of B.terms.values()) r.addTerm(fMul(a.c, b.c), mulMono(a.m, b.m)); return r; }\nfunction powPoly(A, k) { let r = constPoly(Frac(1)); for (let i = 0; i < k; i++) r = mulPoly(r, A); return r; }\nfunction constValue(P) {\n  let s = Frac(0);\n  for (const t of P.terms.values()) { if (monoKey(t.m) !== '1') return null; s = fAdd(s, t.c); }\n  return s;\n}\n\n// ---- Tokenizer / parser ----\nfunction tokenize(s) {\n  const toks = []; let i = 0;\n  const dig = c => c >= '0' && c <= '9', alp = c => /[A-Za-z_]/.test(c);\n  while (i < s.length) {\n    const c = s[i];\n    if (c === ' ' || c === '\\t' || c === '\\n') { i++; continue; }\n    if (dig(c) || (c === '.' && dig(s[i + 1]))) {\n      let j = i; while (j < s.length && (dig(s[j]) || s[j] === '.')) j++;\n      toks.push({ t: 'num', v: parseFloat(s.slice(i, j)) }); i = j; continue;\n    }\n    if (alp(c)) { let j = i; while (j < s.length && (alp(s[j]) || dig(s[j]))) j++; toks.push({ t: 'var', v: s.slice(i, j) }); i = j; continue; }\n    if ('+-*/^()'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }\n    throw new Error('Unexpected character: ' + c);\n  }\n  return toks;\n}\nfunction parse(tokens) {\n  let p = 0;\n  const peek = () => tokens[p], next = () => tokens[p++];\n  function expr() { let l = term(); while (peek() && (peek().v === '+' || peek().v === '-')) { const op = next().v; l = { t: 'op', op, a: l, b: term() }; } return l; }\n  function term() { let l = unary(); while (peek() && (peek().v === '*' || peek().v === '/')) { const op = next().v; l = { t: 'op', op, a: l, b: unary() }; } return l; }\n  function unary() { if (peek() && (peek().v === '+' || peek().v === '-')) { const op = next().v; const v = unary(); return op === '-' ? { t: 'neg', a: v } : v; } return power(); }\n  function power() { const b = atom(); if (peek() && peek().v === '^') { next(); const e = unary(); return { t: 'op', op: '^', a: b, b: e }; } return b; }\n  function atom() {\n    const t = next(); if (!t) throw new Error('Unexpected end');\n    if (t.t === 'num') return { t: 'num', v: t.v };\n    if (t.t === 'var') return { t: 'var', v: t.v };\n    if (t.v === '(') { const e = expr(); if (!peek() || next().v !== ')') throw new Error('Expected )'); return e; }\n    throw new Error('Unexpected token: ' + t.v);\n  }\n  const ast = expr();\n  if (p !== tokens.length) throw new Error('Trailing input');\n  return ast;\n}\nfunction toPoly(node) {\n  switch (node.t) {\n    case 'num': return constPoly(Frac(Math.round(node.v * 1e6), 1e6));\n    case 'var': return varPoly(node.v);\n    case 'neg': return scalePoly(toPoly(node.a), Frac(-1));\n    case 'op': {\n      const A = toPoly(node.a);\n      if (node.op === '^') {\n        const B = toPoly(node.b); const e = constValue(B);\n        if (!e || !fIsInt(e) || e.n < 0) throw new Error('Exponent must be a non-negative integer constant');\n        return powPoly(A, e.n);\n      }\n      const B = toPoly(node.b);\n      if (node.op === '+') return addPoly(A, B);\n      if (node.op === '-') return subPoly(A, B);\n      if (node.op === '*') return mulPoly(A, B);\n      if (node.op === '/') { const c = constValue(B); if (!c) throw new Error('Can only divide by a constant'); return scalePoly(A, fInv(c)); }\n    }\n  }\n  throw new Error('Bad node');\n}\nfunction polyStr(P) {\n  if (P.terms.size === 0) return '0';\n  const terms = [...P.terms.values()].sort((a, b) => monoKey(b.m).length - monoKey(a.m).length);\n  let out = '';\n  for (const t of terms) {\n    const mk = monoKey(t.m) === '1' ? '' : monoKey(t.m);\n    let coef = t.c;\n    let monoPart = mk;\n    let termStr;\n    if (!mk) termStr = fStr(coef);\n    else if (coef.n === 1 && coef.d === 1) termStr = mk;\n    else if (coef.n === -1 && coef.d === 1) termStr = '-' + mk;\n    else termStr = fStr(coef) + '*' + mk;\n    if (out === '') out = termStr;\n    else if (termStr.startsWith('-')) out += ' - ' + termStr.slice(1);\n    else out += ' + ' + termStr;\n  }\n  return out;\n}\nfunction varsOf(node, set) {\n  if (node.t === 'var') set.add(node.v);\n  else if (node.t === 'op') { varsOf(node.a, set); varsOf(node.b, set); }\n  else if (node.t === 'neg') varsOf(node.a, set);\n  return set;\n}\nfunction evalAst(node, env) {\n  switch (node.t) {\n    case 'num': return node.v;\n    case 'var': if (!(node.v in env)) throw new Error('Unbound var ' + node.v); return env[node.v];\n    case 'neg': return -evalAst(node.a, env);\n    case 'op': {\n      const a = evalAst(node.a, env), b = evalAst(node.b, env);\n      if (node.op === '+') return a + b; if (node.op === '-') return a - b;\n      if (node.op === '*') return a * b; if (node.op === '/') return a / b;\n      if (node.op === '^') return Math.pow(a, b);\n    }\n  }\n}\n\n// ---- Run ----\nconst lhs = String(args.lhs), rhs = String(args.rhs);\nconst okSym = args.symbolic !== false;\nlet AstL, AstR;\ntry { AstL = parse(tokenize(lhs)); AstR = parse(tokenize(rhs)); }\ncatch (e) { return { ok: false, error: 'Parse error: ' + e.message, lhs, rhs }; }\n\nconst vars = [...varsOf(AstL, varsOf(AstR, new Set()))];\n\n// Numeric spot-check\nfunction numCheck() {\n  const vals = [-3, -2, -1, 0, 1, 2, 3, 5];\n  let checked = 0, mismatch = null;\n  const combos = 300;\n  for (let c = 0; c < combos; c++) {\n    const env = {};\n    for (const v of vars) env[v] = vals[Math.floor(Math.random() * vals.length)];\n    let l, r;\n    try { l = evalAst(AstL, env); r = evalAst(AstR, env); } catch { continue; }\n    if (!isFinite(l) || !isFinite(r)) continue;\n    checked++;\n    if (Math.abs(l - r) > 1e-9) { if (!mismatch) mismatch = { env: { ...env }, lhs: l, rhs: r }; }\n  }\n  return { checked, mismatch };\n}\n\nlet result = { ok: true, lhs, rhs, variables: vars };\nconst nc = numCheck();\nresult.numericCheck = { pointsChecked: nc.checked, matches: nc.mismatch === null };\nif (nc.mismatch) result.numericCounterexample = nc.mismatch;\n\nif (okSym) {\n  try {\n    const diff = subPoly(toPoly(AstL), toPoly(AstR));\n    const diffStr = polyStr(diff);\n    result.symbolic = true;\n    result.difference = diffStr;\n    result.proved = diff.terms.size === 0;\n    result.verdict = result.proved\n      ? 'IDENTITY PROVED: LHS - RHS simplifies to exactly 0 for all values of the variables.'\n      : 'NOT an identity: LHS - RHS = ' + diffStr + ' (nonzero).';\n  } catch (e) {\n    result.symbolic = false;\n    result.symbolicError = e.message;\n    result.proved = false;\n    result.verdict = 'Symbolic expansion unavailable (' + e.message + '). Fell back to numeric testing only.';\n  }\n}\nreturn result;\n";

export async function run(args, ctx) {
// ---- Exact rational arithmetic ----
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a; }
function Frac(n, d = 1) {
  if (d === 0) throw new Error('Division by zero');
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d) || 1;
  return { n: n / g, d: d / g };
}
const fAdd = (a, b) => Frac(a.n * b.d + b.n * a.d, a.d * b.d);
const fSub = (a, b) => Frac(a.n * b.d - b.n * a.d, a.d * b.d);
const fMul = (a, b) => Frac(a.n * b.n, a.d * b.d);
const fNeg = (a) => Frac(-a.n, a.d);
const fInv = (a) => { if (a.n === 0) throw new Error('Division by zero'); return Frac(a.d, a.n); };
const fStr = (a) => a.d === 1 ? String(a.n) : a.n + '/' + a.d;
const fIsInt = (a) => a.d === 1;

// ---- Polynomial: Map<monoKey, {c:Frac, m:{var:exp}}> ----
function monoKey(m) {
  return Object.keys(m).filter(v => m[v] !== 0).sort()
    .map(v => v + '^' + m[v]).join('*') || '1';
}
function mulMono(a, b) { const r = { ...a }; for (const v in b) r[v] = (r[v] || 0) + b[v]; return r; }
function Poly() { this.terms = new Map(); }
Poly.prototype.addTerm = function (c, m) {
  if (c.n === 0) return;
  const k = monoKey(m);
  const ex = this.terms.get(k);
  if (ex) { ex.c = fAdd(ex.c, c); if (ex.c.n === 0) this.terms.delete(k); }
  else this.terms.set(k, { c, m: { ...m } });
};
function constPoly(f) { const p = new Poly(); p.addTerm(f, {}); return p; }
function varPoly(name) { const p = new Poly(); p.addTerm(Frac(1), { [name]: 1 }); return p; }
function addPoly(A, B) { const r = new Poly(); for (const t of A.terms.values()) r.addTerm(t.c, t.m); for (const t of B.terms.values()) r.addTerm(t.c, t.m); return r; }
function scalePoly(A, f) { const r = new Poly(); for (const t of A.terms.values()) r.addTerm(fMul(t.c, f), t.m); return r; }
function subPoly(A, B) { return addPoly(A, scalePoly(B, Frac(-1))); }
function mulPoly(A, B) { const r = new Poly(); for (const a of A.terms.values()) for (const b of B.terms.values()) r.addTerm(fMul(a.c, b.c), mulMono(a.m, b.m)); return r; }
function powPoly(A, k) { let r = constPoly(Frac(1)); for (let i = 0; i < k; i++) r = mulPoly(r, A); return r; }
function constValue(P) {
  let s = Frac(0);
  for (const t of P.terms.values()) { if (monoKey(t.m) !== '1') return null; s = fAdd(s, t.c); }
  return s;
}

// ---- Tokenizer / parser ----
function tokenize(s) {
  const toks = []; let i = 0;
  const dig = c => c >= '0' && c <= '9', alp = c => /[A-Za-z_]/.test(c);
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (dig(c) || (c === '.' && dig(s[i + 1]))) {
      let j = i; while (j < s.length && (dig(s[j]) || s[j] === '.')) j++;
      toks.push({ t: 'num', v: parseFloat(s.slice(i, j)) }); i = j; continue;
    }
    if (alp(c)) { let j = i; while (j < s.length && (alp(s[j]) || dig(s[j]))) j++; toks.push({ t: 'var', v: s.slice(i, j) }); i = j; continue; }
    if ('+-*/^()'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    throw new Error('Unexpected character: ' + c);
  }
  return toks;
}
function parse(tokens) {
  let p = 0;
  const peek = () => tokens[p], next = () => tokens[p++];
  function expr() { let l = term(); while (peek() && (peek().v === '+' || peek().v === '-')) { const op = next().v; l = { t: 'op', op, a: l, b: term() }; } return l; }
  function term() { let l = unary(); while (peek() && (peek().v === '*' || peek().v === '/')) { const op = next().v; l = { t: 'op', op, a: l, b: unary() }; } return l; }
  function unary() { if (peek() && (peek().v === '+' || peek().v === '-')) { const op = next().v; const v = unary(); return op === '-' ? { t: 'neg', a: v } : v; } return power(); }
  function power() { const b = atom(); if (peek() && peek().v === '^') { next(); const e = unary(); return { t: 'op', op: '^', a: b, b: e }; } return b; }
  function atom() {
    const t = next(); if (!t) throw new Error('Unexpected end');
    if (t.t === 'num') return { t: 'num', v: t.v };
    if (t.t === 'var') return { t: 'var', v: t.v };
    if (t.v === '(') { const e = expr(); if (!peek() || next().v !== ')') throw new Error('Expected )'); return e; }
    throw new Error('Unexpected token: ' + t.v);
  }
  const ast = expr();
  if (p !== tokens.length) throw new Error('Trailing input');
  return ast;
}
function toPoly(node) {
  switch (node.t) {
    case 'num': return constPoly(Frac(Math.round(node.v * 1e6), 1e6));
    case 'var': return varPoly(node.v);
    case 'neg': return scalePoly(toPoly(node.a), Frac(-1));
    case 'op': {
      const A = toPoly(node.a);
      if (node.op === '^') {
        const B = toPoly(node.b); const e = constValue(B);
        if (!e || !fIsInt(e) || e.n < 0) throw new Error('Exponent must be a non-negative integer constant');
        return powPoly(A, e.n);
      }
      const B = toPoly(node.b);
      if (node.op === '+') return addPoly(A, B);
      if (node.op === '-') return subPoly(A, B);
      if (node.op === '*') return mulPoly(A, B);
      if (node.op === '/') { const c = constValue(B); if (!c) throw new Error('Can only divide by a constant'); return scalePoly(A, fInv(c)); }
    }
  }
  throw new Error('Bad node');
}
function polyStr(P) {
  if (P.terms.size === 0) return '0';
  const terms = [...P.terms.values()].sort((a, b) => monoKey(b.m).length - monoKey(a.m).length);
  let out = '';
  for (const t of terms) {
    const mk = monoKey(t.m) === '1' ? '' : monoKey(t.m);
    let coef = t.c;
    let monoPart = mk;
    let termStr;
    if (!mk) termStr = fStr(coef);
    else if (coef.n === 1 && coef.d === 1) termStr = mk;
    else if (coef.n === -1 && coef.d === 1) termStr = '-' + mk;
    else termStr = fStr(coef) + '*' + mk;
    if (out === '') out = termStr;
    else if (termStr.startsWith('-')) out += ' - ' + termStr.slice(1);
    else out += ' + ' + termStr;
  }
  return out;
}
function varsOf(node, set) {
  if (node.t === 'var') set.add(node.v);
  else if (node.t === 'op') { varsOf(node.a, set); varsOf(node.b, set); }
  else if (node.t === 'neg') varsOf(node.a, set);
  return set;
}
function evalAst(node, env) {
  switch (node.t) {
    case 'num': return node.v;
    case 'var': if (!(node.v in env)) throw new Error('Unbound var ' + node.v); return env[node.v];
    case 'neg': return -evalAst(node.a, env);
    case 'op': {
      const a = evalAst(node.a, env), b = evalAst(node.b, env);
      if (node.op === '+') return a + b; if (node.op === '-') return a - b;
      if (node.op === '*') return a * b; if (node.op === '/') return a / b;
      if (node.op === '^') return Math.pow(a, b);
    }
  }
}

// ---- Run ----
const lhs = String(args.lhs), rhs = String(args.rhs);
const okSym = args.symbolic !== false;
let AstL, AstR;
try { AstL = parse(tokenize(lhs)); AstR = parse(tokenize(rhs)); }
catch (e) { return { ok: false, error: 'Parse error: ' + e.message, lhs, rhs }; }

const vars = [...varsOf(AstL, varsOf(AstR, new Set()))];

// Numeric spot-check
function numCheck() {
  const vals = [-3, -2, -1, 0, 1, 2, 3, 5];
  let checked = 0, mismatch = null;
  const combos = 300;
  for (let c = 0; c < combos; c++) {
    const env = {};
    for (const v of vars) env[v] = vals[Math.floor(Math.random() * vals.length)];
    let l, r;
    try { l = evalAst(AstL, env); r = evalAst(AstR, env); } catch { continue; }
    if (!isFinite(l) || !isFinite(r)) continue;
    checked++;
    if (Math.abs(l - r) > 1e-9) { if (!mismatch) mismatch = { env: { ...env }, lhs: l, rhs: r }; }
  }
  return { checked, mismatch };
}

let result = { ok: true, lhs, rhs, variables: vars };
const nc = numCheck();
result.numericCheck = { pointsChecked: nc.checked, matches: nc.mismatch === null };
if (nc.mismatch) result.numericCounterexample = nc.mismatch;

if (okSym) {
  try {
    const diff = subPoly(toPoly(AstL), toPoly(AstR));
    const diffStr = polyStr(diff);
    result.symbolic = true;
    result.difference = diffStr;
    result.proved = diff.terms.size === 0;
    result.verdict = result.proved
      ? 'IDENTITY PROVED: LHS - RHS simplifies to exactly 0 for all values of the variables.'
      : 'NOT an identity: LHS - RHS = ' + diffStr + ' (nonzero).';
  } catch (e) {
    result.symbolic = false;
    result.symbolicError = e.message;
    result.proved = false;
    result.verdict = 'Symbolic expansion unavailable (' + e.message + '). Fell back to numeric testing only.';
  }
}
return result;

}
