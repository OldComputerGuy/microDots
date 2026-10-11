// MicroDot custom tool "stock_quote" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "stock_quote",
    "description": "Get live stock/ETF/crypto quotes from Yahoo Finance (same data source as yfinance). Accepts one or more ticker symbols and returns price, change, change percent, day high/low, volume, 52-week range, currency, name and market time.",
    "parameters": {
      "type": "object",
      "properties": {
        "symbols": {
          "description": "Ticker symbol or array of symbols, e.g. 'AAPL' or ['AAPL','MSFT','BTC-USD']",
          "oneOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          ]
        },
        "range": {
          "type": "string",
          "description": "Optional Yahoo range for the chart request (default '1d'). E.g. 1d,5d,1mo,1y,max.",
          "default": "1d"
        }
      },
      "required": [
        "symbols"
      ]
    }
  }
};
export const code = "let raw = args.symbols;\nif (typeof raw === \"string\") {\n  const t = raw.trim();\n  if (t.startsWith(\"[\")) { try { raw = JSON.parse(t); } catch (e) { raw = t; } }\n}\nconst list = (Array.isArray(raw) ? raw : String(raw).split(/[\\s,]+/))\n  .map(s => String(s).replace(/[\"'\\[\\]]/g, \"\").trim().toUpperCase()).filter(Boolean);\nif (!list.length) throw new Error(\"No symbols given\");\nconst range = args.range || \"1d\";\nconst hosts = [\"query1.finance.yahoo.com\", \"query2.finance.yahoo.com\"];\n\nasync function getText(url) {\n  const res = await ctx.fetch(url, { headers: { \"User-Agent\": \"Mozilla/5.0 (compatible; MicroDot/1.0)\" } });\n  if (typeof res === \"string\") return res;\n  if (res && typeof res.text === \"string\") return res.text;\n  if (res && typeof res.text === \"function\") return await res.text();\n  if (res && typeof res.json === \"function\") return JSON.stringify(await res.json());\n  if (res && typeof res.body === \"string\") return res.body;\n  throw new Error(\"unexpected fetch result keys=\" + (res && typeof res === \"object\" ? Object.keys(res).join(\",\") : typeof res));\n}\n\nasync function quote(sym) {\n  let lastErr;\n  for (const host of hosts) {\n    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${encodeURIComponent(range)}`;\n    try {\n      const data = JSON.parse(await getText(url));\n      const r = data?.chart?.result?.[0];\n      if (!r) throw new Error(data?.chart?.error?.description || \"no result\");\n      const m = r.meta || {};\n      const q = r.indicators?.quote?.[0] || {};\n      const closes = (q.close || []).filter(v => v != null);\n      const lastClose = closes.length ? closes[closes.length - 1] : undefined;\n      const price = m.regularMarketPrice ?? lastClose;\n      const prev = m.chartPreviousClose ?? m.previousClose;\n      const change = (price != null && prev != null) ? +(price - prev).toFixed(4) : null;\n      const changePct = (change != null && prev) ? +(change / prev * 100).toFixed(2) : null;\n      return {\n        symbol: m.symbol || sym,\n        name: m.longName || m.shortName || null,\n        currency: m.currency || null,\n        exchange: m.fullExchangeName || m.exchangeName || null,\n        price, previousClose: prev ?? null, change, changePercent: changePct,\n        dayHigh: m.regularMarketDayHigh ?? null, dayLow: m.regularMarketDayLow ?? null,\n        volume: m.regularMarketVolume ?? null,\n        fiftyTwoWeekHigh: m.fiftyTwoWeekHigh ?? null, fiftyTwoWeekLow: m.fiftyTwoWeekLow ?? null,\n        marketTime: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,\n        marketState: m.marketState || null\n      };\n    } catch (e) { lastErr = e; }\n  }\n  return { symbol: sym, error: String(lastErr && lastErr.message || lastErr) };\n}\n\nconst results = [];\nfor (const s of list) results.push(await quote(s));\nreturn list.length === 1 ? results[0] : { count: results.length, quotes: results };";

export async function run(args, ctx) {
let raw = args.symbols;
if (typeof raw === "string") {
  const t = raw.trim();
  if (t.startsWith("[")) { try { raw = JSON.parse(t); } catch (e) { raw = t; } }
}
const list = (Array.isArray(raw) ? raw : String(raw).split(/[\s,]+/))
  .map(s => String(s).replace(/["'\[\]]/g, "").trim().toUpperCase()).filter(Boolean);
if (!list.length) throw new Error("No symbols given");
const range = args.range || "1d";
const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

async function getText(url) {
  const res = await ctx.fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; MicroDot/1.0)" } });
  if (typeof res === "string") return res;
  if (res && typeof res.text === "string") return res.text;
  if (res && typeof res.text === "function") return await res.text();
  if (res && typeof res.json === "function") return JSON.stringify(await res.json());
  if (res && typeof res.body === "string") return res.body;
  throw new Error("unexpected fetch result keys=" + (res && typeof res === "object" ? Object.keys(res).join(",") : typeof res));
}

async function quote(sym) {
  let lastErr;
  for (const host of hosts) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${encodeURIComponent(range)}`;
    try {
      const data = JSON.parse(await getText(url));
      const r = data?.chart?.result?.[0];
      if (!r) throw new Error(data?.chart?.error?.description || "no result");
      const m = r.meta || {};
      const q = r.indicators?.quote?.[0] || {};
      const closes = (q.close || []).filter(v => v != null);
      const lastClose = closes.length ? closes[closes.length - 1] : undefined;
      const price = m.regularMarketPrice ?? lastClose;
      const prev = m.chartPreviousClose ?? m.previousClose;
      const change = (price != null && prev != null) ? +(price - prev).toFixed(4) : null;
      const changePct = (change != null && prev) ? +(change / prev * 100).toFixed(2) : null;
      return {
        symbol: m.symbol || sym,
        name: m.longName || m.shortName || null,
        currency: m.currency || null,
        exchange: m.fullExchangeName || m.exchangeName || null,
        price, previousClose: prev ?? null, change, changePercent: changePct,
        dayHigh: m.regularMarketDayHigh ?? null, dayLow: m.regularMarketDayLow ?? null,
        volume: m.regularMarketVolume ?? null,
        fiftyTwoWeekHigh: m.fiftyTwoWeekHigh ?? null, fiftyTwoWeekLow: m.fiftyTwoWeekLow ?? null,
        marketTime: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
        marketState: m.marketState || null
      };
    } catch (e) { lastErr = e; }
  }
  return { symbol: sym, error: String(lastErr && lastErr.message || lastErr) };
}

const results = [];
for (const s of list) results.push(await quote(s));
return list.length === 1 ? results[0] : { count: results.length, quotes: results };
}
