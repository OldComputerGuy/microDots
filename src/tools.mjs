// MiniDot tools for one agent: browser actions target the agent's own tab,
// plain HTTP fetch, and self-authored custom tools.
import { mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import {
  customDir,
  toolFile,
  validateName,
  checkCode,
  saveTool,
  importTool,
  loadCustomTools,
} from './custom-tools.mjs';
import { runWslTool, toWinPath } from './wsl-sandbox.mjs';
import { parallelSearch } from './parallel.mjs';

export function openPath(file) {
  try {
    if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', file]);
    else if (process.platform === 'darwin') execFile('open', [file]);
    else execFile('xdg-open', [file]);
  } catch {
    /* ignore */
  }
}

// Keep only the newest `keep` screenshots; delete the rest.
export function pruneScreenshots(keep = 10) {
  const dir = resolve(process.cwd(), 'screenshots');
  try {
    const files = readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.jpg'))
      .map((f) => ({ f, t: statSync(resolve(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(Math.max(0, keep))) {
      try {
        unlinkSync(resolve(dir, f));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* no folder yet */
  }
}

const BUILTINS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the public web (via Parallel) and return the top sources with title, url and excerpt. Use this for current information, news, documentation and comparisons. Prefer it over opening a search engine in the browser. Pass a few keywords as `query`; optionally give a specific `objective` or a list of `urls` to read.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for (keywords or a short question)' },
          objective: { type: 'string', description: 'Optional one-line description of what you are trying to find' },
          urls: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional specific public URLs to read instead of searching',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'http_get',
      description:
        'Fetch a URL over HTTP(S) and return status, length and the first part of the body text. No browser, no JavaScript.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Absolute http(s) URL' } },
        required: ['url'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_open',
      description: 'Open a URL in your tab and return the page title and visible text. Read-only.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Absolute http(s) URL' } },
        required: ['url'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_text',
      description: 'Return the title and visible text of your current tab. Read-only.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description:
        'Capture a screenshot of your tab. The image is attached to the conversation so you can see the page and describe it. Also saved to disk. Read-only.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: 'Click the first element matching a CSS selector in your tab.',
      parameters: {
        type: 'object',
        properties: { selector: { type: 'string', description: 'CSS selector' } },
        required: ['selector'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description: 'Type text into the first element matching a CSS selector in your tab.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector' },
          text: { type: 'string', description: 'Text to type' },
        },
        required: ['selector', 'text'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_close',
      description: 'Close your own tab. The shared browser stays open for other agents.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_tool',
      description:
        'Create a new tool for yourself. Provide a name, a description, a JSON-Schema `parameters` object, and the JavaScript body of `async function run(args, ctx)`. `return` a JSON-serialisable result. Available at once and saved to ./tools-custom/ for future sessions. ctx always has agentId, fetch(url,opts), log(...). In the WSL sandbox it also has ctx.fs (a filesystem jailed to the sandbox folder) and ctx.browser.{open,text,url,screenshot,click,type,close}. In in-process mode it has page() (your browser tab), host, clip, textLimit, openPath and import().',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Tool name: letters, digits, underscore' },
          description: { type: 'string', description: 'What the tool does (shown to the model)' },
          parameters: {
            type: 'object',
            description: 'JSON Schema for the arguments, e.g. { type:"object", properties:{...}, required:[...] }',
          },
          code: { type: 'string', description: 'Body of `async function run(args, ctx)`, ending in `return`' },
        },
        required: ['name', 'description', 'parameters', 'code'],
        additionalProperties: false,
      },
    },
  },
];

const BUILTIN_NAMES = new Set(BUILTINS.map((t) => t.function.name));

export async function createTools({ host, agentId, textLimit = 8000 } = {}) {
  const clip = (s) => (typeof s === 'string' ? s.slice(0, textLimit) : '');
  const page = () => host.getPage();
  const dir = customDir();
  const sandbox = (process.env.MINIDOT_TOOL_SANDBOX ?? 'none').toLowerCase();
  const root = resolve(process.cwd(), process.env.MINIDOT_SANDBOX_DIR ?? 'workspace');
  if (sandbox === 'wsl') mkdirSync(root, { recursive: true });

  // Custom tools already on disk (name -> { definition, run, code }).
  const custom = await loadCustomTools(dir);

  // Live tool list handed to the model; mutated when new tools are created.
  const definitions = [...BUILTINS, ...[...custom.values()].map((t) => t.definition)];

  const ctx = {
    agentId,
    host,
    page,
    clip,
    textLimit,
    fetch: (...a) => fetch(...a),
    openPath,
    import: (spec) => import(spec),
  };

  // Host side of the WSL sandbox's bridge: the agent's browser tab + openPath.
  async function sandboxBridge(spec) {
    switch (spec?.op) {
      case 'browser_open':
        return await execute('browser_open', { url: spec.url });
      case 'browser_text':
        return await execute('browser_text', {});
      case 'browser_url':
        return { url: (await page()).url() };
      case 'browser_screenshot': {
        const { __image, ...rest } = await execute('browser_screenshot', {});
        return rest;
      }
      case 'browser_click':
        return await execute('browser_click', { selector: spec.selector });
      case 'browser_type':
        return await execute('browser_type', { selector: spec.selector, text: spec.text });
      case 'browser_close':
        return await execute('browser_close', {});
      case 'openPath':
        openPath(toWinPath(spec.path));
        return { opened: true };
      default:
        throw new Error(`unknown bridge op: ${spec?.op}`);
    }
  }

  async function createTool(args) {
    const name = String(args?.name ?? '').trim();
    validateName(name, BUILTIN_NAMES);
    if (!args?.description) throw new Error('description is required');
    checkCode(args?.code);
    const parameters = args.parameters?.type
      ? args.parameters
      : { type: 'object', ...(args.parameters ?? {}) };

    const file = saveTool(dir, {
      name,
      description: String(args.description),
      parameters,
      code: args.code,
    });
    const { definition, run, code } = await importTool(dir, name);

    const existing = custom.get(name);
    if (existing) {
      const i = definitions.indexOf(existing.definition);
      if (i >= 0) definitions[i] = definition;
      else definitions.push(definition);
    } else {
      definitions.push(definition);
    }
    custom.set(name, { definition, run, code });

    return {
      created: name,
      savedTo: file,
      backend: sandbox === 'wsl' && code ? 'wsl' : 'in-process',
      schema: definition.function.parameters,
      note: 'Registered. You can call it now and it will load automatically in future sessions.',
    };
  }

  async function execute(name, args) {
    const c = custom.get(name);
    if (c) {
      if (sandbox === 'wsl' && c.code) {
        return await runWslTool({
          code: c.code,
          args,
          root,
          agentId,
          bridge: sandboxBridge,
          log: (m) => console.log(`  [${name}] ${m}`),
          textLimit,
        });
      }
      return await c.run(args, ctx);
    }

    switch (name) {
      case 'web_search': {
        const results = await parallelSearch({ query: args.query, objective: args.objective, urls: args.urls });
        return { query: args.query, count: results.length, results };
      }
      case 'create_tool':
        return await createTool(args);
      case 'http_get': {
        const res = await fetch(args.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (MiniDot)' },
          redirect: 'follow',
        });
        const body = await res.text();
        return { status: res.status, length: body.length, text: clip(body) };
      }
      case 'browser_open': {
        const p = await page();
        const res = await p.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const text = await p.evaluate(() => document.body?.innerText ?? '');
        return { status: res?.status() ?? null, url: p.url(), title: await p.title(), text: clip(text) };
      }
      case 'browser_text': {
        const p = await page();
        const text = await p.evaluate(() => document.body?.innerText ?? '');
        return { url: p.url(), title: await p.title(), text: clip(text) };
      }
      case 'browser_screenshot': {
        const p = await page();
        const sdir = resolve(process.cwd(), 'screenshots');
        mkdirSync(sdir, { recursive: true });
        const file = resolve(sdir, `shot-${agentId}-${Date.now()}.jpg`);
        const quality = Math.min(100, Math.max(1, Number(process.env.MINIDOT_SHOT_QUALITY ?? 80)));
        const fullPage = (process.env.MINIDOT_SHOT_FULLPAGE ?? 'false') === 'true';
        const buf = await p.screenshot({ type: 'jpeg', quality, fullPage });
        writeFileSync(file, buf);
        const keep = Number(process.env.MINIDOT_SHOT_KEEP ?? 10);
        pruneScreenshots(Number.isFinite(keep) ? keep : 10);
        const open = (process.env.MINIDOT_OPEN_SHOTS ?? 'true') !== 'false';
        if (open) openPath(file);
        return {
          saved: file,
          url: p.url(),
          title: await p.title(),
          opened: open,
          note: 'Screenshot captured, saved, opened in the default viewer, and attached to the conversation so you can see the page.',
          __image: `data:image/jpeg;base64,${buf.toString('base64')}`,
        };
      }
      case 'browser_click': {
        const p = await page();
        await p.click(args.selector, { timeout: 15000 });
        return { clicked: args.selector, url: p.url() };
      }
      case 'browser_type': {
        const p = await page();
        await p.fill(args.selector, args.text, { timeout: 15000 });
        return { typed: args.selector, url: p.url() };
      }
      case 'browser_close': {
        await host.closeTab();
        return { closed: true, agent: agentId };
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  return { definitions, execute, customDir: dir, toolFile: (n) => toolFile(dir, n) };
}
