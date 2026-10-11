// MiniDot custom tool "number_theory_check" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "number_theory_check",
    "description": "Number-theory checks companion to algebraic_proof: gcd of an integer list, pairwise coprimality, perfect-square and prime-factorization tests, and a specialized mode that verifies the Pythagorean-triple (n=4 descent) assumption that (m^2-n^2, 2mn, m^2+n^2) is primitive for coprime opposite-parity m,n.",
    "parameters": {
      "type": "object",
      "properties": {
        "mode": {
          "description": "One of: gcd, coprime, square, factor, pythagorean, coprime_factors",
          "type": "string"
        },
        "numbers": {
          "description": "Comma/space separated integers for gcd/coprime/square/factor modes",
          "type": "string"
        },
        "limit": {
          "description": "Max m for pythagorean sampling (default 40)",
          "type": "integer"
        },
        "a": {
          "description": "First integer for coprime_factors mode",
          "type": "integer"
        },
        "b": {
          "description": "Second integer for coprime_factors mode",
          "type": "integer"
        }
      },
      "required": [
        "mode"
      ]
    }
  }
};
export const code = "// ===== Integer helpers (BigInt-safe for arbitrary size) =====\nfunction bigGcd(a, b) { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { const t = a % b; a = b; b = t; } return a; }\nfunction gcdList(nums) { let g = 0n; for (const n of nums) g = bigGcd(g, n); return g; }\n\nfunction isPerfectSquare(n) {\n  if (n < 0n) return { square: false, reason: 'negative' };\n  if (n === 0n) return { square: true, root: 0n };\n  let r = BigInt(Math.floor(Math.sqrt(Number(n))));\n  // adjust for float imprecision\n  while (r * r < n) r++;\n  while (r * r > n) r--;\n  return r * r === n ? { square: true, root: r } : { square: false };\n}\n\nfunction factorize(n) {\n  n = n < 0n ? -n : n;\n  if (n === 0n) return { factors: [], note: 'zero' };\n  if (n === 1n) return { factors: [], note: 'one' };\n  const factors = [];\n  let m = n, d = 2n;\n  while (d * d <= m) {\n    if (m % d === 0n) { let e = 0; while (m % d === 0n) { m /= d; e++; } factors.push({ prime: d.toString(), exp: e }); }\n    d += (d === 2n ? 1n : 2n);\n  }\n  if (m > 1n) factors.push({ prime: m.toString(), exp: 1 });\n  return { factors };\n}\n\nfunction groupCoprime(nums) {\n  // pairwise coprime: gcd of every pair == 1\n  const bad = [];\n  for (let i = 0; i < nums.length; i++)\n    for (let j = i + 1; j < nums.length; j++) {\n      const g = bigGcd(nums[i], nums[j]);\n      if (g !== 1n) bad.push({ i, j, gcd: g.toString() });\n    }\n  return { pairwiseCoprime: bad.length === 0, violations: bad, overallGcd: gcdList(nums).toString() };\n}\n\nfunction parseBigList(str) {\n  return String(str).split(/[,\\s]+/).filter(s => s.length).map(s => {\n    const t = s.trim();\n    if (!/^[-+]?\\d+$/.test(t)) throw new Error('Not an integer: ' + t);\n    return BigInt(t);\n  });\n}\n\nconst out = { ok: true };\nconst mode = args.mode || 'gcd';\n\ntry {\n  if (mode === 'gcd' || mode === 'coprime' || mode === 'square' || mode === 'factor') {\n    const nums = parseBigList(args.numbers);\n    out.inputs = nums.map(String);\n    if (mode === 'gcd' || mode === 'coprime') {\n      out.gcd = gcdList(nums).toString();\n      out.pairwise = groupCoprime(nums);\n    }\n    if (mode === 'coprime' || mode === 'square') {\n      out.squareTest = nums.map(n => ({ n: n.toString(), ...isPerfectSquare(n) }));\n    }\n    if (mode === 'factor') out.factorization = nums.map(n => ({ n: n.toString(), ...factorize(n) }));\n  }\n\n  else if (mode === 'pythagorean') {\n    // Test the n=4 descent assumptions over sample coprime, opposite-parity (m,n)\n    const limit = args.limit || 40;\n    const samples = [];\n    let allOk = true, checked = 0;\n    for (let m = 2n; m <= BigInt(limit); m++) {\n      for (let n = 1n; n < m; n++) {\n        // coprime?\n        if (bigGcd(m, n) !== 1n) continue;\n        // opposite parity? (one even, one odd)\n        if ((m % 2n) === (n % 2n)) continue;\n        checked++;\n        const legA = m * m - n * n;   // x^2\n        const legB = 2n * m * n;      // y^2\n        const hyp = m * m + n * n;    // z\n        const g = gcdList([legA, legB, hyp]);\n        const sqA = isPerfectSquare(legA), sqB = isPerfectSquare(legB);\n        const ok = g === 1n;\n        if (!ok) allOk = false;\n        if (samples.length < 12) samples.push({\n          m: m.toString(), n: n.toString(),\n          legA_x2: legA.toString(), legB_y2: legB.toString(), hyp_z: hyp.toString(),\n          gcd_of_legs_and_hyp: g.toString(),\n          legA_is_square: sqA.square, legB_is_square: sqB.square,\n          primitive: ok\n        });\n      }\n    }\n    out.mode = 'pythagorean';\n    out.hypothesis = 'For coprime m>n of opposite parity, (m^2-n^2, 2mn, m^2+n^2) is a primitive Pythagorean triple (gcd of all three = 1).';\n    out.pairsChecked = checked;\n    out.allPrimitive = allOk;\n    out.samples = samples;\n    out.verdict = allOk\n      ? 'CONFIRMED on all ' + checked + ' sample pairs: every resulting triple is primitive (gcd = 1), as the descent argument assumes.'\n      : 'FOUND a violating pair: the primitive-triple assumption fails somewhere in the sample.';\n  }\n\n  else if (mode === 'coprime_factors') {\n    // Test: if gcd(a,b)=1 then gcd(a, a+b)=1 and gcd(b,a+b)=1, and gcd(a^2, b^2)=1\n    const a = BigInt(args.a), b = BigInt(args.b);\n    out.inputs = { a: a.toString(), b: b.toString() };\n    out.gcd_ab = bigGcd(a, b).toString();\n    out.assume_coprime = bigGcd(a, b) === 1n;\n    out.gcd_a_aplusb = bigGcd(a, a + b).toString();\n    out.gcd_b_aplusb = bigGcd(b, a + b).toString();\n    out.gcd_a2_b2 = bigGcd(a * a, b * b).toString();\n    out.holds = bigGcd(a, a + b) === 1n && bigGcd(b, a + b) === 1n && bigGcd(a * a, b * b) === 1n;\n    out.verdict = out.assume_coprime\n      ? (out.holds ? 'CONFIRMED: coprime a,b imply the derived pairs are also coprime (identity gcd(a,a+b)=gcd(a,b)=1).' : 'Failed.')\n      : 'NOTE: a,b are not coprime, so the implication is not expected to apply (gcd=' + out.gcd_ab + ').';\n  }\n\n  else throw new Error('Unknown mode: ' + mode);\n\n} catch (e) {\n  return { ok: false, error: e.message, mode };\n}\nreturn out;\n";

export async function run(args, ctx) {
// ===== Integer helpers (BigInt-safe for arbitrary size) =====
function bigGcd(a, b) { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { const t = a % b; a = b; b = t; } return a; }
function gcdList(nums) { let g = 0n; for (const n of nums) g = bigGcd(g, n); return g; }

function isPerfectSquare(n) {
  if (n < 0n) return { square: false, reason: 'negative' };
  if (n === 0n) return { square: true, root: 0n };
  let r = BigInt(Math.floor(Math.sqrt(Number(n))));
  // adjust for float imprecision
  while (r * r < n) r++;
  while (r * r > n) r--;
  return r * r === n ? { square: true, root: r } : { square: false };
}

function factorize(n) {
  n = n < 0n ? -n : n;
  if (n === 0n) return { factors: [], note: 'zero' };
  if (n === 1n) return { factors: [], note: 'one' };
  const factors = [];
  let m = n, d = 2n;
  while (d * d <= m) {
    if (m % d === 0n) { let e = 0; while (m % d === 0n) { m /= d; e++; } factors.push({ prime: d.toString(), exp: e }); }
    d += (d === 2n ? 1n : 2n);
  }
  if (m > 1n) factors.push({ prime: m.toString(), exp: 1 });
  return { factors };
}

function groupCoprime(nums) {
  // pairwise coprime: gcd of every pair == 1
  const bad = [];
  for (let i = 0; i < nums.length; i++)
    for (let j = i + 1; j < nums.length; j++) {
      const g = bigGcd(nums[i], nums[j]);
      if (g !== 1n) bad.push({ i, j, gcd: g.toString() });
    }
  return { pairwiseCoprime: bad.length === 0, violations: bad, overallGcd: gcdList(nums).toString() };
}

function parseBigList(str) {
  return String(str).split(/[,\s]+/).filter(s => s.length).map(s => {
    const t = s.trim();
    if (!/^[-+]?\d+$/.test(t)) throw new Error('Not an integer: ' + t);
    return BigInt(t);
  });
}

const out = { ok: true };
const mode = args.mode || 'gcd';

try {
  if (mode === 'gcd' || mode === 'coprime' || mode === 'square' || mode === 'factor') {
    const nums = parseBigList(args.numbers);
    out.inputs = nums.map(String);
    if (mode === 'gcd' || mode === 'coprime') {
      out.gcd = gcdList(nums).toString();
      out.pairwise = groupCoprime(nums);
    }
    if (mode === 'coprime' || mode === 'square') {
      out.squareTest = nums.map(n => ({ n: n.toString(), ...isPerfectSquare(n) }));
    }
    if (mode === 'factor') out.factorization = nums.map(n => ({ n: n.toString(), ...factorize(n) }));
  }

  else if (mode === 'pythagorean') {
    // Test the n=4 descent assumptions over sample coprime, opposite-parity (m,n)
    const limit = args.limit || 40;
    const samples = [];
    let allOk = true, checked = 0;
    for (let m = 2n; m <= BigInt(limit); m++) {
      for (let n = 1n; n < m; n++) {
        // coprime?
        if (bigGcd(m, n) !== 1n) continue;
        // opposite parity? (one even, one odd)
        if ((m % 2n) === (n % 2n)) continue;
        checked++;
        const legA = m * m - n * n;   // x^2
        const legB = 2n * m * n;      // y^2
        const hyp = m * m + n * n;    // z
        const g = gcdList([legA, legB, hyp]);
        const sqA = isPerfectSquare(legA), sqB = isPerfectSquare(legB);
        const ok = g === 1n;
        if (!ok) allOk = false;
        if (samples.length < 12) samples.push({
          m: m.toString(), n: n.toString(),
          legA_x2: legA.toString(), legB_y2: legB.toString(), hyp_z: hyp.toString(),
          gcd_of_legs_and_hyp: g.toString(),
          legA_is_square: sqA.square, legB_is_square: sqB.square,
          primitive: ok
        });
      }
    }
    out.mode = 'pythagorean';
    out.hypothesis = 'For coprime m>n of opposite parity, (m^2-n^2, 2mn, m^2+n^2) is a primitive Pythagorean triple (gcd of all three = 1).';
    out.pairsChecked = checked;
    out.allPrimitive = allOk;
    out.samples = samples;
    out.verdict = allOk
      ? 'CONFIRMED on all ' + checked + ' sample pairs: every resulting triple is primitive (gcd = 1), as the descent argument assumes.'
      : 'FOUND a violating pair: the primitive-triple assumption fails somewhere in the sample.';
  }

  else if (mode === 'coprime_factors') {
    // Test: if gcd(a,b)=1 then gcd(a, a+b)=1 and gcd(b,a+b)=1, and gcd(a^2, b^2)=1
    const a = BigInt(args.a), b = BigInt(args.b);
    out.inputs = { a: a.toString(), b: b.toString() };
    out.gcd_ab = bigGcd(a, b).toString();
    out.assume_coprime = bigGcd(a, b) === 1n;
    out.gcd_a_aplusb = bigGcd(a, a + b).toString();
    out.gcd_b_aplusb = bigGcd(b, a + b).toString();
    out.gcd_a2_b2 = bigGcd(a * a, b * b).toString();
    out.holds = bigGcd(a, a + b) === 1n && bigGcd(b, a + b) === 1n && bigGcd(a * a, b * b) === 1n;
    out.verdict = out.assume_coprime
      ? (out.holds ? 'CONFIRMED: coprime a,b imply the derived pairs are also coprime (identity gcd(a,a+b)=gcd(a,b)=1).' : 'Failed.')
      : 'NOTE: a,b are not coprime, so the implication is not expected to apply (gcd=' + out.gcd_ab + ').';
  }

  else throw new Error('Unknown mode: ' + mode);

} catch (e) {
  return { ok: false, error: e.message, mode };
}
return out;

}
