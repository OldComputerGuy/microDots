// MiniDot custom tool "nasdaq100_momentum" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "nasdaq100_momentum",
    "description": "Rank Nasdaq-100 companies by price momentum. Fetches the current constituent list from Wikipedia and 1 year of weekly prices from Yahoo Finance, then computes 1/3/6/12-month returns and a composite momentum score. Returns a ranked list of the top-N momentum stocks.",
    "parameters": {
      "type": "object",
      "properties": {
        "top": {
          "type": "integer",
          "description": "How many top momentum stocks to return (default 15).",
          "default": 15
        },
        "min_price": {
          "type": "number",
          "description": "Optional minimum share price filter to drop penny stocks.",
          "default": 0
        },
        "sort_by": {
          "type": "string",
          "description": "Which metric to rank by: 'score' (composite, default), 'r1m', 'r3m', 'r6m', 'r12m'.",
          "default": "score"
        }
      },
      "required": []
    }
  }
};
export const code = "const TOP = Math.max(1, Math.min(args.top ?? 15, 120));\nconst MIN_PRICE = args.min_price ?? 0;\nconst SORT = args.sort_by || \"score\";\nconst hosts = [\"query1.finance.yahoo.com\", \"query2.finance.yahoo.com\"];\n\nasync function getText(url) {\n  const res = await ctx.fetch(url, { headers: { \"User-Agent\": \"Mozilla/5.0 (compatible; MiniDot/1.0)\" } });\n  if (typeof res === \"string\") return res;\n  if (res && typeof res.text === \"string\") return res.text;\n  if (res && typeof res.text === \"function\") return await res.text();\n  if (res && typeof res.body === \"string\") return res.body;\n  throw new Error(\"bad fetch result\");\n}\n\n// 1. Constituent tickers from Wikipedia raw wikitext\nconst wiki = await getText(\"https://en.wikipedia.org/w/index.php?title=List_of_NASDAQ-100_companies&action=raw\");\nconst tickers = [];\nconst seen = new Set();\nconst rowRe = /^\\|\\s*([A-Z0-9.]{1,6})\\s*\\|\\|/gm;\nlet m;\nwhile ((m = rowRe.exec(wiki)) !== null) {\n  const t = m[1];\n  if (!/^[A-Z]/.test(t)) continue;\n  if (!seen.has(t)) { seen.add(t); tickers.push(t); }\n}\nif (tickers.length < 50) throw new Error(\"could not parse constituents (\" + tickers.length + \" found)\");\n\n// 2. Weekly history (~1y) per ticker — small enough to fit the fetch limit\nasync function hist(sym) {\n  for (const host of hosts) {\n    try {\n      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1wk&range=1y`;\n      const j = JSON.parse(await getText(url));\n      const r = j?.chart?.result?.[0];\n      if (!r) continue;\n      const q = r.indicators?.quote?.[0] || {};\n      const closes = q.close || [];\n      const ts = r.timestamp || [];\n      const series = [];\n      for (let i = 0; i < closes.length; i++) if (closes[i] != null) series.push([ts[i], closes[i]]);\n      return { meta: r.meta || {}, series };\n    } catch (e) { /* try next host */ }\n  }\n  return null;\n}\n\nfunction pctWeeks(series, weeks) {\n  if (series.length < 2) return null;\n  const lastT = series[series.length - 1][0];\n  const cutoff = lastT - weeks * 7 * 86400;\n  let base = series[0];\n  for (const p of series) { if (p[0] >= cutoff) { base = p; break; } }\n  const first = base[1], last = series[series.length - 1][1];\n  if (!first) return null;\n  return +(((last - first) / first) * 100).toFixed(2);\n}\n\nconst data = [];\nconst BATCH = 8;\nfor (let i = 0; i < tickers.length; i += BATCH) {\n  const chunk = tickers.slice(i, i + BATCH);\n  const res = await Promise.all(chunk.map(async (sym) => {\n    const h = await hist(sym);\n    if (!h || h.series.length < 8) return { symbol: sym, error: \"no data\" };\n    const s = h.series;\n    const price = h.meta.regularMarketPrice ?? s[s.length - 1][1];\n    const r1 = pctWeeks(s, 4.35), r3 = pctWeeks(s, 13), r6 = pctWeeks(s, 26), r12 = pctWeeks(s, 52);\n    const vals = [r1, r3, r6, r12].filter(v => v != null);\n    const score = vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : null;\n    return {\n      symbol: h.meta.symbol || sym,\n      name: h.meta.longName || h.meta.shortName || null,\n      price: price != null ? +price.toFixed(2) : null,\n      r1m: r1, r3m: r3, r6m: r6, r12m: r12, score\n    };\n  }));\n  data.push(...res);\n}\n\nconst valid = data.filter(d => !d.error && d.score != null && (d.price ?? 0) >= MIN_PRICE);\nconst key = [\"r1m\",\"r3m\",\"r6m\",\"r12m\"].includes(SORT) ? SORT : \"score\";\nvalid.sort((a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity));\n\nreturn {\n  universe: tickers.length,\n  asOf: new Date().toISOString(),\n  sortBy: key,\n  ranked: valid.length,\n  top: valid.slice(0, TOP)\n};";

export async function run(args, ctx) {
const TOP = Math.max(1, Math.min(args.top ?? 15, 120));
const MIN_PRICE = args.min_price ?? 0;
const SORT = args.sort_by || "score";
const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

async function getText(url) {
  const res = await ctx.fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; MiniDot/1.0)" } });
  if (typeof res === "string") return res;
  if (res && typeof res.text === "string") return res.text;
  if (res && typeof res.text === "function") return await res.text();
  if (res && typeof res.body === "string") return res.body;
  throw new Error("bad fetch result");
}

// 1. Constituent tickers from Wikipedia raw wikitext
const wiki = await getText("https://en.wikipedia.org/w/index.php?title=List_of_NASDAQ-100_companies&action=raw");
const tickers = [];
const seen = new Set();
const rowRe = /^\|\s*([A-Z0-9.]{1,6})\s*\|\|/gm;
let m;
while ((m = rowRe.exec(wiki)) !== null) {
  const t = m[1];
  if (!/^[A-Z]/.test(t)) continue;
  if (!seen.has(t)) { seen.add(t); tickers.push(t); }
}
if (tickers.length < 50) throw new Error("could not parse constituents (" + tickers.length + " found)");

// 2. Weekly history (~1y) per ticker — small enough to fit the fetch limit
async function hist(sym) {
  for (const host of hosts) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1wk&range=1y`;
      const j = JSON.parse(await getText(url));
      const r = j?.chart?.result?.[0];
      if (!r) continue;
      const q = r.indicators?.quote?.[0] || {};
      const closes = q.close || [];
      const ts = r.timestamp || [];
      const series = [];
      for (let i = 0; i < closes.length; i++) if (closes[i] != null) series.push([ts[i], closes[i]]);
      return { meta: r.meta || {}, series };
    } catch (e) { /* try next host */ }
  }
  return null;
}

function pctWeeks(series, weeks) {
  if (series.length < 2) return null;
  const lastT = series[series.length - 1][0];
  const cutoff = lastT - weeks * 7 * 86400;
  let base = series[0];
  for (const p of series) { if (p[0] >= cutoff) { base = p; break; } }
  const first = base[1], last = series[series.length - 1][1];
  if (!first) return null;
  return +(((last - first) / first) * 100).toFixed(2);
}

const data = [];
const BATCH = 8;
for (let i = 0; i < tickers.length; i += BATCH) {
  const chunk = tickers.slice(i, i + BATCH);
  const res = await Promise.all(chunk.map(async (sym) => {
    const h = await hist(sym);
    if (!h || h.series.length < 8) return { symbol: sym, error: "no data" };
    const s = h.series;
    const price = h.meta.regularMarketPrice ?? s[s.length - 1][1];
    const r1 = pctWeeks(s, 4.35), r3 = pctWeeks(s, 13), r6 = pctWeeks(s, 26), r12 = pctWeeks(s, 52);
    const vals = [r1, r3, r6, r12].filter(v => v != null);
    const score = vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : null;
    return {
      symbol: h.meta.symbol || sym,
      name: h.meta.longName || h.meta.shortName || null,
      price: price != null ? +price.toFixed(2) : null,
      r1m: r1, r3m: r3, r6m: r6, r12m: r12, score
    };
  }));
  data.push(...res);
}

const valid = data.filter(d => !d.error && d.score != null && (d.price ?? 0) >= MIN_PRICE);
const key = ["r1m","r3m","r6m","r12m"].includes(SORT) ? SORT : "score";
valid.sort((a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity));

return {
  universe: tickers.length,
  asOf: new Date().toISOString(),
  sortBy: key,
  ranked: valid.length,
  top: valid.slice(0, TOP)
};
}
