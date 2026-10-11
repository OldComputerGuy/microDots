// MicroDot tools for one agent: browser actions target the agent's own tab,
// plain HTTP fetch, and self-authored custom tools.
import { mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import {
  customDir,
  toolFile,
  validateName,
  checkCode,
  scanToolCode,
  saveTool,
  deleteTool,
  importTool,
  loadCustomTools,
} from './custom-tools.mjs';
import { runSandboxedTool, sandboxToHostPath } from './tool-sandbox.mjs';
import { parallelSearch, parallelFetch } from './parallel.mjs';
import { listSkills, readSkill, saveSkill, deleteSkill } from './skills.mjs';
import { spaceDir, shotsDir } from './space.mjs';
import { listWorkerTypes, readWorkerType, saveWorkerType, deleteWorkerType } from './worker-types.mjs';

export function openPath(file) {
  try {
    if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', file]);
    else if (process.platform === 'darwin') execFile('open', [file]);
    else execFile('xdg-open', [file]);
  } catch {
    /* ignore */
  }
}

// Keep only the newest `keep` screenshots in a folder; delete the rest.
export function pruneScreenshots(keep = 10, dir = shotsDir()) {
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
      name: 'web_fetch',
      description:
        'Fetch specific public URLs (via Parallel) and return their extracted content. Use when you need exact wording, full-page analysis, or when search excerpts are not enough.',
      parameters: {
        type: 'object',
        properties: {
          urls: { type: 'array', items: { type: 'string' }, description: 'One or more public http(s) URLs to read' },
          objective: { type: 'string', description: 'Optional; what you want to extract from the pages' },
        },
        required: ['urls'],
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
  {
    type: 'function',
    function: {
      name: 'list_tools',
      description: 'List the tools available to you: the built-in tools and any custom tools you have created, with their descriptions.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_tool',
      description: 'Delete one of your custom tools (by name) and remove its file. Built-in tools cannot be deleted.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Name of the custom tool to delete' } },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_skill',
      description:
        'Save a reusable "skill" — a named markdown recipe/procedure you can follow later (not executable code; use create_tool for that). Stored in ./skills/<name>.md.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short skill name (letters, digits, hyphen, underscore)' },
          description: { type: 'string', description: 'One-line summary (shown in the skills list)' },
          instructions: { type: 'string', description: 'The full markdown recipe/steps' },
        },
        required: ['name', 'description', 'instructions'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_skills',
      description: 'List the reusable skills you have saved.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_skill',
      description: 'Read the full text of a saved skill so you can follow it.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Skill name' } },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_skill',
      description: 'Delete a saved skill by name.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Skill name' } },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_worker_type',
      description:
        'Create or update a worker type — a markdown file describing how a worker behaves (persona, method, rules). Saved to ./worker-types/<name>.md. Handwritten ones can just be dropped in that folder.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Type name (letters, digits, hyphen, underscore)' },
          description: { type: 'string', description: 'One-line summary' },
          content: { type: 'string', description: 'The behaviour description (markdown)' },
        },
        required: ['name', 'description', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_worker_types',
      description: 'List the available worker types.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_worker_type',
      description: 'Read the full markdown of a worker type.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Type name' } },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_worker_type',
      description: 'Delete a worker type by name.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Type name' } },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
];

const SPAWN_DEF = {
  type: 'function',
  function: {
    name: 'spawn_subagent',
    description:
      'Spawn a specialized sub-agent to complete one focused mission, then return its findings. Design the mission tightly — specific goal, constraints and expected deliverables — because the sub-agent works autonomously and only reports back. Its space is created under your own (subagents/<name>/). Subject to depth/agent limits.',
    parameters: {
      type: 'object',
      properties: {
        mission: { type: 'string', description: 'The specialized mission (specific and self-contained)' },
        name: { type: 'string', description: 'Optional short name for the child (else derived from the mission)' },
        type: { type: 'string', description: 'Optional worker type (defaults to "default")' },
        context: { type: 'string', description: 'Findings/URLs/constraints to seed the child with' },
        deliverables: { type: 'string', description: 'Exactly what you want back (fields/format)' },
      },
      required: ['mission'],
      additionalProperties: false,
    },
  },
};

const SPAWN_MANY_DEF = {
  type: 'function',
  function: {
    name: 'spawn_subagents',
    description:
      'Spawn several specialized sub-agents to run in parallel (bounded), then return all their findings. Use for independent fan-out sub-tasks. Each task is { mission, name?, type?, context?, deliverables? }. Subject to depth/agent limits.',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              mission: { type: 'string' },
              name: { type: 'string' },
              type: { type: 'string' },
              context: { type: 'string' },
              deliverables: { type: 'string' },
            },
            required: ['mission'],
            additionalProperties: false,
          },
        },
        concurrency: { type: 'integer', description: 'Max to run at once (defaults to MICRODOT_MAX_CONCURRENT)' },
      },
      required: ['tasks'],
      additionalProperties: false,
    },
  },
};

const BUILTIN_NAMES = new Set([...BUILTINS.map((t) => t.function.name), 'spawn_subagent', 'spawn_subagents']);

export async function createTools({ host, agentId, textLimit = 32768, space, delegate } = {}) {
  const clip = (s) => (typeof s === 'string' ? s.slice(0, textLimit) : '');
  const page = () => host.getPage();
  const dir = customDir();
  const sandbox = (process.env.MICRODOT_TOOL_SANDBOX ?? 'none').toLowerCase();
  const useSandbox = sandbox !== 'none';
  const root = space ? resolve(space) : spaceDir(agentId);
  mkdirSync(root, { recursive: true });
  const backendName = (code) => (useSandbox && code ? (process.platform === 'win32' ? 'wsl' : 'sandbox') : 'in-process');

  // Custom tools already on disk (name -> { definition, run, code }).
  const custom = await loadCustomTools();

  // Live tool list handed to the model; mutated when new tools are created.
  const definitions = [...BUILTINS, ...(delegate ? [SPAWN_DEF, SPAWN_MANY_DEF] : []), ...[...custom.values()].map((t) => t.definition)];

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

  // Host side of the sandbox's bridge: the agent's browser tab + openPath.
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
        openPath(sandboxToHostPath(spec.path));
        return { opened: true };
      default:
        throw new Error(`unknown bridge op: ${spec?.op}`);
    }
  }

  async function createTool(args, confirm) {
    const name = String(args?.name ?? '').trim();
    validateName(name, BUILTIN_NAMES);
    if (!args?.description) throw new Error('description is required');
    checkCode(args?.code);

    // Pattern-gated approval: only ask when the code touches risky capabilities.
    const risks = scanToolCode(args.code);
    if ((process.env.MICRODOT_APPROVE_CREATE_TOOL ?? 'true') !== 'false' && risks.length) {
      if (confirm) {
        const ok = await confirm(`create tool "${name}" — risky: ${risks.join(', ')}`, args.code);
        if (!ok) return { declined: true, name, note: 'The user declined to create this tool.' };
      } else {
        console.log(`  ! "${name}" uses risky code (${risks.join(', ')}) — auto-approved (non-interactive)`);
      }
    }

    const parameters = args.parameters?.type
      ? args.parameters
      : { type: 'object', ...(args.parameters ?? {}) };

    const file = saveTool({
      name,
      description: String(args.description),
      parameters,
      code: args.code,
    });
    const { definition, run, code } = await importTool(name);

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
      backend: backendName(code),
      schema: definition.function.parameters,
      note: 'Registered. You can call it now and it will load automatically in future sessions.',
    };
  }

  async function execute(name, args, { confirm } = {}) {
    const c = custom.get(name);
    if (c) {
      if (useSandbox && c.code) {
        return await runSandboxedTool({
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
      case 'spawn_subagent': {
        if (!delegate) throw new Error('spawning is disabled');
        return await delegate(args);
      }
      case 'spawn_subagents': {
        if (!delegate?.many) throw new Error('spawning is disabled');
        return { children: await delegate.many(args.tasks, args.concurrency) };
      }
      case 'web_search': {
        const results = await parallelSearch({ query: args.query, objective: args.objective });
        return { query: args.query, count: results.length, results };
      }
      case 'web_fetch': {
        const results = await parallelFetch({ urls: args.urls, objective: args.objective });
        return { count: results.length, results };
      }
      case 'save_skill': {
        const file = saveSkill({ name: args.name, description: args.description, instructions: args.instructions });
        return { saved: args.name, file };
      }
      case 'list_skills':
        return { skills: listSkills().map(({ name, description }) => ({ name, description })) };
      case 'read_skill':
        return { name: args.name, text: readSkill(String(args.name)) };
      case 'delete_skill': {
        const file = deleteSkill(String(args.name));
        return { deleted: args.name, file };
      }
      case 'save_worker_type': {
        const file = saveWorkerType({ name: args.name, description: args.description, content: args.content });
        return { saved: args.name, file };
      }
      case 'list_worker_types':
        return { workerTypes: listWorkerTypes().map(({ name, description }) => ({ name, description })) };
      case 'read_worker_type':
        return { name: args.name, text: readWorkerType(String(args.name)) };
      case 'delete_worker_type':
        return { deleted: args.name, file: deleteWorkerType(String(args.name)) };
      case 'create_tool':
        return await createTool(args, confirm);
      case 'list_tools': {
        return {
          builtin: BUILTINS.map((t) => ({ name: t.function.name, description: t.function.description })),
          custom: [...custom.values()].map((c) => ({
            name: c.definition.function.name,
            description: c.definition.function.description,
            backend: backendName(c.code),
          })),
        };
      }
      case 'delete_tool': {
        const name = String(args?.name ?? '').trim();
        if (!custom.has(name)) {
          throw new Error(
            BUILTIN_NAMES.has(name)
              ? `"${name}" is a built-in tool and cannot be deleted`
              : `no custom tool named "${name}"`,
          );
        }
        const entry = custom.get(name);
        const i = definitions.indexOf(entry.definition);
        if (i >= 0) definitions.splice(i, 1);
        custom.delete(name);
        const file = deleteTool(name);
        return { deleted: name, file };
      }
      case 'http_get': {
        const res = await fetch(args.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (MicroDot)' },
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
        const sdir = shotsDir(agentId);
        mkdirSync(sdir, { recursive: true });
        const file = resolve(sdir, `shot-${agentId}-${Date.now()}.jpg`);
        const quality = Math.min(100, Math.max(1, Number(process.env.MICRODOT_SHOT_QUALITY ?? 80)));
        const fullPage = (process.env.MICRODOT_SHOT_FULLPAGE ?? 'false') === 'true';
        const buf = await p.screenshot({ type: 'jpeg', quality, fullPage });
        writeFileSync(file, buf);
        const keep = Number(process.env.MICRODOT_SHOT_KEEP ?? 10);
        pruneScreenshots(Number.isFinite(keep) ? keep : 10, sdir);
        const open = (process.env.MICRODOT_OPEN_SHOTS ?? 'true') !== 'false';
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

  return { definitions, execute, customDir: dir, toolFile: (n) => toolFile(n) };
}
