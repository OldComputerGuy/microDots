// MiniDot custom tool "calculator" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "calculator",
    "description": "Evaluate a math expression safely. Supports + - * / % ^ (power), parentheses, unary minus, and functions: sqrt, abs, sin, cos, tan, log (base10), ln, exp, round, floor, ceil, min, max. Constants: pi, e. Example: 'sqrt(2) + 3^2 * (4 - 1)'.",
    "parameters": {
      "type": "object",
      "properties": {
        "expression": {
          "type": "string",
          "description": "The math expression to evaluate, e.g. '2 + 3 * 4'"
        },
        "precision": {
          "type": "integer",
          "description": "Optional number of decimal places to round the result to."
        }
      },
      "required": [
        "expression"
      ]
    }
  }
};
export const code = "function tokenize(str) {\n  const tokens = [];\n  let i = 0;\n  const isDigit = (c) => c >= '0' && c <= '9';\n  const isAlpha = (c) => /[a-zA-Z_]/.test(c);\n  while (i < str.length) {\n    const c = str[i];\n    if (c === ' ' || c === '\\t' || c === '\\n') { i++; continue; }\n    if (isDigit(c) || c === '.') {\n      let j = i;\n      while (j < str.length && (isDigit(str[j]) || str[j] === '.')) j++;\n      // scientific notation\n      if (j < str.length && (str[j] === 'e' || str[j] === 'E')) {\n        let k = j + 1;\n        if (k < str.length && (str[k] === '+' || str[k] === '-')) k++;\n        if (k < str.length && isDigit(str[k])) {\n          while (k < str.length && isDigit(str[k])) k++;\n          j = k;\n        }\n      }\n      const numStr = str.slice(i, j);\n      const val = Number(numStr);\n      if (isNaN(val)) throw new Error('Invalid number: ' + numStr);\n      tokens.push({ type: 'num', value: val });\n      i = j; continue;\n    }\n    if (isAlpha(c)) {\n      let j = i;\n      while (j < str.length && (isAlpha(str[j]) || isDigit(str[j]))) j++;\n      tokens.push({ type: 'ident', value: str.slice(i, j) });\n      i = j; continue;\n    }\n    if ('+-*/%^(),'.includes(c)) { tokens.push({ type: 'op', value: c }); i++; continue; }\n    throw new Error('Unexpected character: ' + c);\n  }\n  return tokens;\n}\n\nfunction evaluate(expr) {\n  const tokens = tokenize(expr);\n  let pos = 0;\n  const peek = () => tokens[pos];\n  const next = () => tokens[pos++];\n  const expect = (v) => {\n    const t = next();\n    if (!t || t.value !== v) throw new Error('Expected \"' + v + '\"');\n  };\n\n  const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };\n  const FUNCS = {\n    sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan,\n    asin: Math.asin, acos: Math.acos, atan: Math.atan,\n    log: Math.log10, ln: Math.log, exp: Math.exp,\n    round: Math.round, floor: Math.floor, ceil: Math.ceil,\n    sign: Math.sign,\n    pow: Math.pow,\n    min: Math.min, max: Math.max,\n  };\n\n  function parseExpr() { // + -\n    let left = parseTerm();\n    while (peek() && (peek().value === '+' || peek().value === '-')) {\n      const op = next().value;\n      const right = parseTerm();\n      left = op === '+' ? left + right : left - right;\n    }\n    return left;\n  }\n\n  function parseTerm() { // * / %\n    let left = parseUnary();\n    while (peek() && (peek().value === '*' || peek().value === '/' || peek().value === '%')) {\n      const op = next().value;\n      const right = parseUnary();\n      if (op === '*') left = left * right;\n      else if (op === '/') left = left / right;\n      else left = left % right;\n    }\n    return left;\n  }\n\n  function parseUnary() { // unary +/-, and power (right assoc)\n    if (peek() && (peek().value === '+' || peek().value === '-')) {\n      const op = next().value;\n      const val = parseUnary();\n      return op === '-' ? -val : val;\n    }\n    return parsePower();\n  }\n\n  function parsePower() {\n    const base = parseAtom();\n    if (peek() && peek().value === '^') {\n      next();\n      const exp = parseUnary(); // right-associative, allows 2^-1\n      return Math.pow(base, exp);\n    }\n    return base;\n  }\n\n  function parseAtom() {\n    const t = next();\n    if (!t) throw new Error('Unexpected end of expression');\n    if (t.type === 'num') return t.value;\n    if (t.type === 'op' && t.value === '(') {\n      const v = parseExpr();\n      expect(')');\n      return v;\n    }\n    if (t.type === 'ident') {\n      const name = t.value.toLowerCase();\n      if (peek() && peek().value === '(') {\n        next();\n        const args = [];\n        if (peek() && peek().value !== ')') {\n          args.push(parseExpr());\n          while (peek() && peek().value === ',') { next(); args.push(parseExpr()); }\n        }\n        expect(')');\n        if (!(name in FUNCS)) throw new Error('Unknown function: ' + name);\n        return FUNCS[name](...args);\n      }\n      if (name in CONSTS) return CONSTS[name];\n      throw new Error('Unknown identifier: ' + name);\n    }\n    throw new Error('Unexpected token: ' + t.value);\n  }\n\n  const result = parseExpr();\n  if (pos !== tokens.length) throw new Error('Unexpected trailing input at token ' + pos);\n  return result;\n}\n\nconst expr = String(args.expression);\nlet value;\ntry {\n  value = evaluate(expr);\n} catch (e) {\n  return { ok: false, expression: expr, error: e.message };\n}\nif (typeof value !== 'number' || !isFinite(value)) {\n  return { ok: false, expression: expr, error: 'Result is not a finite number (' + value + ')' };\n}\nlet out = value;\nif (typeof args.precision === 'number') {\n  out = Number(value.toFixed(args.precision));\n}\nreturn { ok: true, expression: expr, result: out, raw: value };\n";

export async function run(args, ctx) {
function tokenize(str) {
  const tokens = [];
  let i = 0;
  const isDigit = (c) => c >= '0' && c <= '9';
  const isAlpha = (c) => /[a-zA-Z_]/.test(c);
  while (i < str.length) {
    const c = str[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (isDigit(c) || c === '.') {
      let j = i;
      while (j < str.length && (isDigit(str[j]) || str[j] === '.')) j++;
      // scientific notation
      if (j < str.length && (str[j] === 'e' || str[j] === 'E')) {
        let k = j + 1;
        if (k < str.length && (str[k] === '+' || str[k] === '-')) k++;
        if (k < str.length && isDigit(str[k])) {
          while (k < str.length && isDigit(str[k])) k++;
          j = k;
        }
      }
      const numStr = str.slice(i, j);
      const val = Number(numStr);
      if (isNaN(val)) throw new Error('Invalid number: ' + numStr);
      tokens.push({ type: 'num', value: val });
      i = j; continue;
    }
    if (isAlpha(c)) {
      let j = i;
      while (j < str.length && (isAlpha(str[j]) || isDigit(str[j]))) j++;
      tokens.push({ type: 'ident', value: str.slice(i, j) });
      i = j; continue;
    }
    if ('+-*/%^(),'.includes(c)) { tokens.push({ type: 'op', value: c }); i++; continue; }
    throw new Error('Unexpected character: ' + c);
  }
  return tokens;
}

function evaluate(expr) {
  const tokens = tokenize(expr);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (v) => {
    const t = next();
    if (!t || t.value !== v) throw new Error('Expected "' + v + '"');
  };

  const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };
  const FUNCS = {
    sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    log: Math.log10, ln: Math.log, exp: Math.exp,
    round: Math.round, floor: Math.floor, ceil: Math.ceil,
    sign: Math.sign,
    pow: Math.pow,
    min: Math.min, max: Math.max,
  };

  function parseExpr() { // + -
    let left = parseTerm();
    while (peek() && (peek().value === '+' || peek().value === '-')) {
      const op = next().value;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm() { // * / %
    let left = parseUnary();
    while (peek() && (peek().value === '*' || peek().value === '/' || peek().value === '%')) {
      const op = next().value;
      const right = parseUnary();
      if (op === '*') left = left * right;
      else if (op === '/') left = left / right;
      else left = left % right;
    }
    return left;
  }

  function parseUnary() { // unary +/-, and power (right assoc)
    if (peek() && (peek().value === '+' || peek().value === '-')) {
      const op = next().value;
      const val = parseUnary();
      return op === '-' ? -val : val;
    }
    return parsePower();
  }

  function parsePower() {
    const base = parseAtom();
    if (peek() && peek().value === '^') {
      next();
      const exp = parseUnary(); // right-associative, allows 2^-1
      return Math.pow(base, exp);
    }
    return base;
  }

  function parseAtom() {
    const t = next();
    if (!t) throw new Error('Unexpected end of expression');
    if (t.type === 'num') return t.value;
    if (t.type === 'op' && t.value === '(') {
      const v = parseExpr();
      expect(')');
      return v;
    }
    if (t.type === 'ident') {
      const name = t.value.toLowerCase();
      if (peek() && peek().value === '(') {
        next();
        const args = [];
        if (peek() && peek().value !== ')') {
          args.push(parseExpr());
          while (peek() && peek().value === ',') { next(); args.push(parseExpr()); }
        }
        expect(')');
        if (!(name in FUNCS)) throw new Error('Unknown function: ' + name);
        return FUNCS[name](...args);
      }
      if (name in CONSTS) return CONSTS[name];
      throw new Error('Unknown identifier: ' + name);
    }
    throw new Error('Unexpected token: ' + t.value);
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error('Unexpected trailing input at token ' + pos);
  return result;
}

const expr = String(args.expression);
let value;
try {
  value = evaluate(expr);
} catch (e) {
  return { ok: false, expression: expr, error: e.message };
}
if (typeof value !== 'number' || !isFinite(value)) {
  return { ok: false, expression: expr, error: 'Result is not a finite number (' + value + ')' };
}
let out = value;
if (typeof args.precision === 'number') {
  out = Number(value.toFixed(args.precision));
}
return { ok: true, expression: expr, result: out, raw: value };

}
