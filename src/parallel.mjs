// Parallel web search for MiniDot (the same provider OpenDots uses).
//
// Talks to Parallel's anonymous Search MCP endpoint. No API key is required for
// light use; set PARALLEL_API_KEY to use an authenticated (higher) tier.
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ENDPOINT = 'https://search.parallel.ai/mcp';

// Stable per-process id: Parallel uses it for free-tier rate limiting, so it
// must stay the same across all searches in a session.
const SESSION_ID = randomUUID();

function normalise(result) {
  if (!result || result.isError) {
    throw new Error('Parallel could not complete the web request (quota or provider error).');
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

export async function parallelSearch({ query, objective, urls, limit = 5, timeoutMs = 60000 } = {}) {
  const obj = String(objective ?? query ?? '').trim();
  const urlList = Array.isArray(urls) ? urls.filter(Boolean) : [];
  if (!obj && !urlList.length) throw new Error('web_search requires a query');

  const apiKey = (process.env.PARALLEL_API_KEY || '').trim() || undefined;
  const client = new Client({ name: 'minidot', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(ENDPOINT),
    apiKey ? { requestInit: { headers: { Authorization: `Bearer ${apiKey}` } } } : undefined,
  );

  const signal = AbortSignal.timeout(timeoutMs);
  const search_queries = [query || obj];
  try {
    await client.connect(transport);

    let results = normalise(
      await client.callTool(
        { name: 'web_search', arguments: { objective: obj || 'Extract evidence from the supplied URLs.', search_queries, session_id: SESSION_ID } },
        undefined,
        { signal },
      ),
    );

    if (urlList.length) {
      const pages = normalise(
        await client.callTool(
          {
            name: 'web_fetch',
            arguments: {
              urls: urlList.slice(0, 5),
              objective: obj.length <= 200 ? obj : 'Extract source evidence relevant to the supplied research queries.',
              search_queries,
              session_id: SESSION_ID,
            },
          },
          undefined,
          { signal },
        ),
      );
      if (pages.length) results = pages;
    }

    return results.slice(0, limit);
  } finally {
    await client.close().catch(() => {});
  }
}
