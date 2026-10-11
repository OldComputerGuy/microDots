// Parallel web search + fetch for MicroDot (the same provider OpenDots uses).
//
// Talks to Parallel's anonymous Search MCP endpoint. No API key is required for
// light use; set PARALLEL_API_KEY to use an authenticated (higher) tier.
//
// Cost/rate limits: the anonymous tier is rate-limited and search is metered
// (~$1 / 1000 searches). To keep that in check this module:
//   - caches results in-process (identical search/fetch calls are free),
//   - retries rate-limit (429) responses with backoff,
//   - optionally caps searches per session with MICRODOT_SEARCH_MAX (0 = off).
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ENDPOINT = 'https://search.parallel.ai/mcp';

// Stable per-process id: Parallel uses it for free-tier rate limiting, so it
// must stay the same across all calls in a session.
const SESSION_ID = randomUUID();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- in-process cache + counters ---------------------------------------
const CACHE = new Map(); // key -> results
const MAX_CACHE = 200;
let searches = 0;
let fetches = 0;
let cacheHits = 0;

const cacheKey = (kind, payload) => `${kind}|${JSON.stringify(payload)}`;
function cacheGet(key) {
  if (!CACHE.has(key)) return undefined;
  // refresh LRU position
  const v = CACHE.get(key);
  CACHE.delete(key);
  CACHE.set(key, v);
  return v;
}
function cacheSet(key, val) {
  if (CACHE.size >= MAX_CACHE) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, val);
}

export function parallelStats() {
  return { searches, fetches, cacheHits, cached: CACHE.size };
}
export function resetParallelStats() {
  searches = 0;
  fetches = 0;
  cacheHits = 0;
  CACHE.clear();
}

const maxSearches = () => Number(process.env.MICRODOT_SEARCH_MAX ?? 0) || 0; // 0 = unlimited

// ---- provider call -----------------------------------------------------
function normalise(result) {
  if (!result || result.isError) {
    const detail = result?.content?.find((c) => c.type === 'text')?.text;
    throw new Error(`Parallel could not complete the web request${detail ? `: ${String(detail).slice(0, 200)}` : ' (quota or provider error).'}`);
  }
  let data = result.structuredContent;
  if (!data) {
    const text = result.content?.find((c) => c.type === 'text')?.text;
    try {
      data = JSON.parse(text ?? '');
    } catch {
      throw new Error('Parallel returned an invalid response.');
    }
  }
  const results = Array.isArray(data?.results) ? data.results : [];
  return results
    .filter((r) => r && typeof r.url === 'string' && Array.isArray(r.excerpts) && r.excerpts.some((e) => e && e.trim()))
    .map((r) => ({
      title: r.title || r.url,
      url: r.url,
      publish_date: r.publish_date ?? null,
      excerpt: r.excerpts.join('\n').trim(),
    }));
}

const RATE_LIMIT_RE = /\b429\b|rate.?limit|too many requests|overloaded|quota|temporarily unavailable/i;

async function callTool(name, args, timeoutMs, attempt = 0) {
  const apiKey = (process.env.PARALLEL_API_KEY || '').trim() || undefined;
  const client = new Client({ name: 'microdot', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(ENDPOINT),
    apiKey ? { requestInit: { headers: { Authorization: `Bearer ${apiKey}` } } } : undefined,
  );
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    await client.connect(transport);
    const res = await client.callTool({ name, arguments: args }, undefined, { signal });
    await client.close().catch(() => {});
    return normalise(res);
  } catch (e) {
    await client.close().catch(() => {});
    const msg = String(e?.message ?? e);
    const rateLimited = RATE_LIMIT_RE.test(msg);
    // Retry transient rate limits with backoff (1s, 2s, 4s).
    if (rateLimited && attempt < 3) {
      const wait = 1000 * 2 ** attempt;
      process.stderr.write(`\x1b[2m[parallel] rate limited — retrying in ${wait}ms\x1b[0m\n`);
      await sleep(wait);
      return callTool(name, args, timeoutMs, attempt + 1);
    }
    if (rateLimited) {
      const clean = (msg.match(/"message":"([^"]+)"/)?.[1] ?? msg).replace(/\s+/g, ' ').trim();
      throw new Error(
        `Parallel rate limited (${clean}). Set PARALLEL_API_KEY for a higher tier, or reduce searches (MICRODOT_SEARCH_MAX).`,
      );
    }
    throw e;
  }
}

// ---- public API --------------------------------------------------------
export async function parallelSearch({ query, objective, limit = 5, timeoutMs = 60000 } = {}) {
  const obj = String(objective ?? query ?? '').trim();
  if (!obj) throw new Error('web_search requires a query');

  const key = cacheKey('search', { obj, q: String(query || obj), limit });
  const hit = cacheGet(key);
  if (hit) {
    cacheHits++;
    return hit.slice(0, limit);
  }

  const cap = maxSearches();
  if (cap && searches >= cap) {
    throw new Error(`search budget reached (MICRODOT_SEARCH_MAX=${cap}); set it to 0 to lift the cap.`);
  }
  searches++;
  const results = await callTool(
    'web_search',
    { objective: obj, search_queries: [query || obj], session_id: SESSION_ID },
    timeoutMs,
  );
  cacheSet(key, results);
  return results.slice(0, limit);
}

export async function parallelFetch({ urls, objective, query, limit = 5, timeoutMs = 60000 } = {}) {
  const urlList = (Array.isArray(urls) ? urls : [urls]).filter(Boolean).map(String);
  if (!urlList.length) throw new Error('web_fetch requires at least one url');

  const obj = String(objective ?? '').trim();
  const key = cacheKey('fetch', { urls: urlList, obj, limit });
  const hit = cacheGet(key);
  if (hit) {
    cacheHits++;
    return hit.slice(0, limit);
  }

  fetches++;
  const results = await callTool(
    'web_fetch',
    {
      urls: urlList.slice(0, 5),
      objective: obj.length && obj.length <= 200 ? obj : 'Extract the main content of the supplied pages.',
      search_queries: [query || obj || 'extract page content'],
      session_id: SESSION_ID,
    },
    timeoutMs,
  );
  cacheSet(key, results);
  return results.slice(0, limit);
}
