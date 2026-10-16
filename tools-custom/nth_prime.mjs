// MicroDot custom tool "nth_prime" - auto-generated, safe to edit or delete.
// The code below runs only in the isolated Linux sandbox worker.
export const definition = {
  "type": "function",
  "function": {
    "name": "nth_prime",
    "description": "Find the nth prime (1-indexed) by sieve/trial division, and report the count of primes below a given limit.",
    "parameters": {
      "type": "object",
      "properties": {
        "n": {
          "type": "integer",
          "description": "Which prime to return (1-indexed)."
        },
        "below": {
          "type": "integer",
          "description": "Optional limit: also report how many primes are strictly below this value."
        }
      },
      "required": [
        "n"
      ]
    }
  }
};
export const code = "function isPrime(x) {\n  if (x < 2) return false;\n  if (x % 2 === 0) return x === 2;\n  for (let d = 3; d * d <= x; d += 2) if (x % d === 0) return false;\n  return true;\n}\nconst n = parseInt(args.n, 10);\nif (!Number.isInteger(n) || n < 1) throw new Error('n must be a positive integer');\nconst limit = n < 6 ? 15 : Math.ceil(n * (Math.log(n) + Math.log(Math.log(n))) + 10);\nconst primes = [];\nfor (let x = 2; x <= limit * 2 && primes.length < n; x++) {\n  if (isPrime(x)) primes.push(x);\n}\nconst result = {\n  n,\n  nthPrime: primes[n - 1],\n  neighbors: primes.slice(Math.max(0, n - 3), n + 2),\n};\nif (typeof args.below === 'number') {\n  result.primesBelow = primes.filter(p => p < args.below).length;\n  // ensure we counted fully if below exceeds scanned range\n  let cnt = result.primesBelow;\n  if (args.below > limit * 2) {\n    cnt = 0;\n    for (let x = 2; x < args.below; x++) if (isPrime(x)) cnt++;\n    result.primesBelow = cnt;\n  }\n}\nreturn result;\n";
