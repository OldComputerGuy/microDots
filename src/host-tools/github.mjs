// GitHub host tools for MicroDot — lets a Dot research and open pull requests.
// The token stays in the host process; it is never written to disk, logged, or
// passed into sandboxed/generated tool code.
import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';

const API = 'https://api.github.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headingLevel = (l) => (/^(#{1,6})\s/.test(l) ? l.match(/^(#{1,6})/)[1].length : 0);
const sortKey = (line) => {
  const m = line.match(/^\s*[-*+]\s+(.*)$/) || line.match(/^\s*\d+\.\s+(.*)$/);
  let t = m ? m[1] : line;
  return t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '').trim().toLowerCase();
};

// Insert `line` into `lines`, either after a unique anchor, or into an
// alphabetically-sorted list section identified by its heading text.
function resolveInsert(lines, { line, insertAfter, section, sort }) {
  if (insertAfter) {
    const hits = [];
    lines.forEach((l, i) => {
      if (l.includes(insertAfter)) hits.push(i);
    });
    if (hits.length !== 1) throw new Error(`insertAfter matched ${hits.length} lines; make it unique`);
    lines.splice(hits[0] + 1, 0, line);
    return { line, after: lines[hits[0]] };
  }
  if (section) {
    const hIdx = lines.findIndex((l) => headingLevel(l) > 0 && l.toLowerCase().includes(section.toLowerCase()));
    if (hIdx < 0) throw new Error(`section heading not found: ${section}`);
    const level = headingLevel(lines[hIdx]);
    let end = lines.length;
    for (let i = hIdx + 1; i < lines.length; i++) {
      const lvl = headingLevel(lines[i]);
      if (lvl > 0 && lvl <= level) {
        end = i;
        break;
      }
    }
    const items = [];
    for (let i = hIdx + 1; i < end; i++) if (/^\s*([-*+]|\d+\.)\s+/.test(lines[i])) items.push(i);
    if (!items.length) {
      lines.splice(hIdx + 1, 0, '', line);
      return { line, section: lines[hIdx] };
    }
    let at = items[items.length - 1] + 1;
    if (sort) {
      const key = sortKey(line);
      const before = items.find((i) => sortKey(lines[i]) > key);
      if (before !== undefined) at = before;
    }
    lines.splice(at, 0, line);
    return { line, section: lines[hIdx] };
  }
  throw new Error('provide content, or insertAfter, or section');
}

export function createGithubTools({ token, maxPullRequests = 6, planFile = null } = {}) {
  if (!token) throw new Error('createGithubTools: a token is required');
  let submitted = 0;

  const readPlan = () => {
    try {
      return JSON.parse(readFileSync(planFile, 'utf8'));
    } catch {
      return [];
    }
  };
  const writePlan = (list) => writeFileSync(planFile, `${JSON.stringify(list, null, 2)}\n`);
  const recordProposal = (entry) => {
    if (!planFile) return;
    const list = readPlan();
    const i = list.findIndex((e) => e.upstream === entry.upstream && e.path === entry.path);
    if (i >= 0) list[i] = entry;
    else list.push(entry);
    writePlan(list);
  };

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'microdot-agent',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  async function gh(method, path, body) {
    const res = await fetch(API + path, {
      method,
      headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const raw = await res.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = raw;
    }
    if (!res.ok) {
      const msg = typeof data === 'string' ? data : data?.message || JSON.stringify(data)?.slice(0, 200);
      throw new Error(`GitHub ${method} ${path} -> ${res.status}: ${msg}`);
    }
    return data;
  }

  async function fileAt(repo, path, ref) {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const data = await gh('GET', `/repos/${repo}/contents/${encodeURIComponent(path)}${q}`);
    if (Array.isArray(data)) throw new Error(`${path} is a directory, not a file`);
    return { content: Buffer.from(data.content || '', 'base64').toString('utf8'), sha: data.sha };
  }

  async function whoami() {
    if (!whoami._v) whoami._v = (await gh('GET', '/user')).login;
    return whoami._v;
  }

  const tools = [
    {
      name: 'github_whoami',
      description: 'Return the login (username) of the authenticated GitHub account.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => ({ login: await whoami() }),
    },

    {
      name: 'github_search_repos',
      description:
        'Find repositories on GitHub. Use to discover real, popular "awesome" lists (e.g. query "awesome ai agents"). Returns full_name, stars, description, url, most-starred first.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'GitHub search query, e.g. "awesome llm agents"' },
          limit: { type: 'number', description: 'How many results (default 10, max 30)' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      run: async ({ query, limit = 10 }) => {
        const n = Math.max(1, Math.min(Number(limit) || 10, 30));
        const data = await gh('GET', `/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${n}`);
        return {
          count: data.total_count,
          results: (data.items || []).map((r) => ({
            full_name: r.full_name,
            stars: r.stargazers_count,
            description: r.description,
            url: r.html_url,
            default_branch: r.default_branch,
          })),
        };
      },
    },

    {
      name: 'github_list_dir',
      description: 'List a directory in a repository (e.g. to find CONTRIBUTING.md).',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'owner/name' },
          path: { type: 'string', description: 'directory path (optional, root by default)' },
        },
        required: ['repo'],
        additionalProperties: false,
      },
      run: async ({ repo, path = '' }) => {
        const data = await gh('GET', `/repos/${repo}/contents/${path}`);
        if (!Array.isArray(data)) throw new Error(`${path} is a file, not a directory`);
        return { entries: data.map((e) => ({ name: e.name, type: e.type, path: e.path })) };
      },
    },

    {
      name: 'github_find_lines',
      description:
        'Search within ONE file for lines containing a query (case-insensitive). Returns matching lines with line numbers — use this instead of reading huge lists. Great for finding section headings and the neighbouring entries where a new item belongs.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'owner/name' },
          path: { type: 'string', description: 'file path (default README.md)' },
          query: { type: 'string', description: 'substring to find (case-insensitive)' },
          limit: { type: 'number', description: 'max matches (default 40)' },
        },
        required: ['repo', 'query'],
        additionalProperties: false,
      },
      run: async ({ repo, path = 'README.md', query, limit = 40 }) => {
        const { content, sha } = await fileAt(repo, path);
        const q = String(query).toLowerCase();
        const matches = [];
        content.split('\n').forEach((text, i) => {
          if (matches.length < Math.min(Number(limit) || 40, 200) && text.toLowerCase().includes(q)) matches.push({ n: i + 1, text });
        });
        return { repo, path, sha, bytes: content.length, matches };
      },
    },

    {
      name: 'github_read_file',
      description: 'Read a whole file (use only for short files; prefer github_find_lines for large ones). Returns text + blob sha.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'owner/name' },
          path: { type: 'string', description: 'file path, e.g. README.md' },
          ref: { type: 'string', description: 'branch/commit (optional)' },
        },
        required: ['repo', 'path'],
        additionalProperties: false,
      },
      run: async ({ repo, path, ref }) => {
        const { content, sha } = await fileAt(repo, path, ref);
        return { repo, path, sha, bytes: content.length, content };
      },
    },

    {
      name: 'github_submit_pr',
      description:
        'Open a PR that adds exactly ONE line to a list file. Choose ONE placement mode: `insertAfter` (unique substring of the existing line to follow), or `section` (+ optional `sort:true`) to drop it into a heading section, alphabetically if sorted. The tool reads/writes the file itself — you never reproduce it. Forks+branches+commits+PRs. dryRun:true validates only.',
      parameters: {
        type: 'object',
        properties: {
          upstream: { type: 'string', description: 'owner/name of the repository to PR against' },
          path: { type: 'string', description: 'file to change (default README.md)' },
          line: { type: 'string', description: 'the new entry (a markdown list item)' },
          insertAfter: { type: 'string', description: 'unique substring of the existing line to insert after' },
          section: { type: 'string', description: 'heading text to insert into (its list)' },
          sort: { type: 'boolean', description: 'insert alphabetically within the section' },
          content: { type: 'string', description: 'advanced: complete new file content (overrides placement)' },
          title: { type: 'string', description: 'pull request title' },
          body: { type: 'string', description: 'pull request body' },
          base: { type: 'string', description: 'base branch (optional)' },
          branch: { type: 'string', description: 'head branch name (optional)' },
          dryRun: { type: 'boolean', description: 'validate only; create nothing' },
        },
        required: ['upstream', 'title', 'body'],
        additionalProperties: false,
      },
      run: async ({ upstream, path = 'README.md', line, insertAfter, section, sort, content, title, body, base, branch, dryRun }) => {
        const me = await whoami();
        const repoMeta = await gh('GET', `/repos/${upstream}`);
        const baseBranch = base || repoMeta.default_branch || 'main';
        const head = branch || `microdot-${Date.now().toString(36)}`;

        // Build the final file content (never by hand).
        let finalContent = content;
        let placement = null;
        if (!finalContent) {
          const { content: cur } = await fileAt(upstream, path, baseBranch);
          const lines = cur.split('\n');
          placement = resolveInsert(lines, { line, insertAfter, section, sort });
          finalContent = lines.join('\n');
        }

        if (dryRun) {
          const entry = { upstream, path, line, insertAfter, section, sort, title, body };
          recordProposal(entry);
          return {
            validated: true,
            recorded: !!planFile,
            upstream,
            path,
            base: baseBranch,
            title,
            placement,
            bytes: Buffer.byteLength(finalContent, 'utf8'),
            remaining: maxPullRequests - submitted,
          };
        }

        if (submitted >= maxPullRequests) throw new Error(`PR limit reached (${maxPullRequests}).`);

        const name = upstream.split('/')[1];
        await gh('POST', `/repos/${upstream}/forks`, {}).catch((e) => {
          if (!/already exists|Name already exists/i.test(String(e.message))) throw e;
        });
        let ready = false;
        for (let i = 0; i < 30 && !ready; i++) {
          try {
            await gh('GET', `/repos/${me}/${name}`);
            ready = true;
          } catch {
            await sleep(1000);
          }
        }
        if (!ready) throw new Error('fork did not become available in time');

        const ref = await gh('GET', `/repos/${me}/${name}/git/ref/heads/${encodeURIComponent(baseBranch)}`);
        await gh('POST', `/repos/${me}/${name}/git/refs`, { ref: `refs/heads/${head}`, sha: ref.object.sha });

        let fileSha = null;
        try {
          const cur = await gh('GET', `/repos/${me}/${name}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(baseBranch)}`);
          if (cur && !Array.isArray(cur)) fileSha = cur.sha;
        } catch {
          /* new file */
        }
        await gh('PUT', `/repos/${me}/${name}/contents/${encodeURIComponent(path)}`, {
          message: title,
          content: Buffer.from(finalContent, 'utf8').toString('base64'),
          ...(fileSha ? { sha: fileSha } : {}),
          branch: head,
        });

        const pr = await gh('POST', `/repos/${upstream}/pulls`, { title, body, head: `${me}:${head}`, base: baseBranch });
        submitted++;
        return { pr_url: pr.html_url, number: pr.number, upstream, path, placement };
      },
    },
  ];

  return tools;
}
