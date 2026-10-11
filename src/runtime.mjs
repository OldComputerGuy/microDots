// MicroDot runtime: the library/API surface. Owns the shared, heavy resources
// (one Chromium on demand, one sandbox worker) so many Dots are cheap.
//
//   const rt = await createRuntime({ apiKey, dataDir, browser: 'on-demand' });
//   const dot = await rt.dot('analyst', { type: 'researcher', mission: '…' });
//   const text = await dot.run('summarise NVDA');
//   await rt.close();
import { resolve } from 'node:path';
import { createBrowserHost } from './browser-host.mjs';
import { createTools } from './tools.mjs';
import { runAgent } from './agent.mjs';
import { buildSystem } from './prompt.mjs';
import { makeSpawner } from './spawner.mjs';
import { ensureSpace, readMission, getSpaceType, setSpaceType } from './space.mjs';
import { ensureProject } from './home.mjs';
import { stopSandboxWorker } from './tool-sandbox.mjs';
import { stopChromiumIfIdle } from './tabs.mjs';

export async function createRuntime(opts = {}) {
  const {
    model = process.env.MICRODOT_MODEL ?? 'deepseek/deepseek-v4.1-flash',
    apiKey = process.env.OPENROUTER_API_KEY || process.env.OpenRouterKey,
    baseUrl = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    dataDir,
    browser = 'on-demand', // 'off' | 'on-demand' | 'always'
    headless = (process.env.MICRODOT_HEADLESS ?? 'true') !== 'false',
    isolate = false,
    sandbox = process.env.MICRODOT_TOOL_SANDBOX ?? 'auto',
    textLimit = Number(process.env.MICRODOT_TEXT_LIMIT ?? 32768),
    maxSteps = Number(process.env.MICRODOT_MAX_STEPS ?? 12),
    allowSpawn = true,
    maxDepth = 3,
    maxAgents = 16,
    maxConcurrent = 8,
    compact = false,
    contextTokens = 24000,
    keepRecent = 6,
    offloadTokens = 4000,
    summaryModel = process.env.MICRODOT_SUMMARY_MODEL || 'qwen/qwen3.6-flash',
    charsPerToken = Number(process.env.MICRODOT_CHARS_PER_TOKEN ?? 4),
    debug = false,
  } = opts;

  if (!apiKey) throw new Error('createRuntime: apiKey (or OPENROUTER_API_KEY) is required');
  if (dataDir) process.env.MICRODOT_LAUNCH_DIR = resolve(dataDir);
  process.env.MICRODOT_MODEL = model;
  process.env.MICRODOT_TOOL_SANDBOX = sandbox;
  process.env.MICRODOT_ALLOW_SPAWN = String(allowSpawn);
  ensureProject();

  // One Chromium per runtime, created lazily.
  let host = null;
  const ensureHost = async () => {
    if (!host) host = await createBrowserHost({ headless, isolate, agentId: 'runtime' });
    return host;
  };
  const offHost = {
    getPage: async () => {
      throw new Error('browser disabled for this runtime (browser: "off")');
    },
    closeTab: async () => {},
    close: async () => {},
  };
  const lazyHost = {
    async getPage() {
      const h = await ensureHost();
      return h.getPage();
    },
    async closeTab() {
      if (host) await host.closeTab();
    },
    async close() {
      if (host) await host.close();
    },
  };
  const selectHost = () => (browser === 'off' ? offHost : lazyHost);
  if (browser === 'always') await ensureHost();

  const hostTools = [];
  const compactBase = {
    enabled: !!compact,
    maxTokens: contextTokens,
    keepRecent,
    charsPerToken,
    offloadTokens,
    summaryModel,
    fallbackModel: model,
  };
  const compactFor = (space) => ({ ...compactBase, spaceDir: space, headChars: 2000 });

  const makeDelegate = makeSpawner({
    model,
    apiKey,
    baseUrl,
    textLimit,
    maxSteps,
    maxDepth,
    maxAgents,
    maxConcurrent,
    allowSpawn,
    sandbox,
    headless,
    isolate,
    debug,
    compactFor,
  });

  async function dot(name, { type, mission } = {}) {
    const space = ensureSpace(name);
    const workerType = (type || getSpaceType(name) || 'default').trim();
    setSpaceType(name, workerType);
    const dotHost = selectHost();
    const tools = await createTools({
      host: dotHost,
      agentId: name,
      textLimit,
      space,
      delegate: allowSpawn ? makeDelegate({ parentSpace: space, depth: 0 }) : undefined,
      hostTools,
    });
    const systemFor = () => buildSystem({ space, type: workerType, mission: mission || readMission(name).trim() });
    let messages = [{ role: 'system', content: systemFor() }];

    return {
      name,
      space,
      type: workerType,
      get messages() {
        return messages;
      },
      // Run a task; streams via onToken/onTool and resolves to the final text.
      async run(task, { onToken, onTool } = {}) {
        if (task) messages.push({ role: 'user', content: task });
        return await runAgent({ messages, tools, model, apiKey, baseUrl, textLimit, maxSteps, onToken, onTool, compact: compactFor(space) });
      },
      reset() {
        messages = [{ role: 'system', content: systemFor() }];
      },
    };
  }

  async function close() {
    if (host) {
      await host.closeTab().catch(() => {});
      await host.close().catch(() => {});
    }
    stopSandboxWorker();
    await stopChromiumIfIdle().catch(() => {});
  }

  return {
    model,
    browser,
    dot,
    registerTool: (t) => hostTools.push(t),
    close,
  };
}
