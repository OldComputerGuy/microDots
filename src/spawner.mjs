// Sub-agent spawner, shared by the CLI and the library runtime.
// Returns makeDelegate({ parentSpace, depth }) -> a `delegate` function with a
// `delegate.many(tasks, concurrency)` batch method.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createBrowserHost } from './browser-host.mjs';
import { createTools } from './tools.mjs';
import { runAgent } from './agent.mjs';
import { buildSystem } from './prompt.mjs';

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'task';

export function makeSpawner(config) {
  const {
    model,
    apiKey,
    baseUrl,
    textLimit = 32768,
    maxSteps = 12,
    maxDepth = 3,
    maxAgents = 16,
    maxConcurrent = 8,
    allowSpawn = true,
    headless = true,
    isolate = false,
    debug = false,
    compactFor,
    onToolFor, // (depth) => onTool handler
    log, // (msg) => void  (for verbose spawn/finish lines)
  } = config;

  const budget = { agents: 0 };
  const rel = (p) => relative(process.cwd(), p).replace(/\\/g, '/');
  const uniqueChild = (parentSpace, base) => {
    let name = base;
    let n = 2;
    while (existsSync(resolve(parentSpace, 'subagents', name))) name = `${base}-${n++}`;
    return name;
  };

  function makeDelegate({ parentSpace, depth }) {
    async function runChild(args) {
      if (!allowSpawn) return { declined: true, reason: 'spawning disabled' };
      if (depth >= maxDepth) return { declined: true, reason: `max depth ${maxDepth} reached` };
      if (budget.agents >= maxAgents) return { declined: true, reason: `max agents ${maxAgents} reached` };

      const childName = uniqueChild(parentSpace, slugify(args.name || args.mission));
      const childSpace = resolve(parentSpace, 'subagents', childName);
      const childType = String(args.type || 'default').trim();
      mkdirSync(resolve(childSpace, 'shots'), { recursive: true });
      writeFileSync(resolve(childSpace, 'mission.md'), `${String(args.mission || '').trim()}\n`);
      writeFileSync(resolve(childSpace, 'worker_type'), `${childType}\n`);
      budget.agents++;
      const started = Date.now();
      log?.(`⤷ spawn ${childName} [${childType}] (agents ${budget.agents}/${maxAgents}, depth ${depth + 1}/${maxDepth})`);

      const childHost = await createBrowserHost({ headless, isolate, agentId: childName });
      await childHost.getPage();
      const childTools = await createTools({
        host: childHost,
        agentId: childName,
        textLimit,
        space: childSpace,
        delegate: makeDelegate({ parentSpace: childSpace, depth: depth + 1 }),
      });
      const childMessages = [
        {
          role: 'system',
          content: buildSystem({
            space: childSpace,
            type: childType,
            mission: args.mission,
            context: args.context,
            deliverables: args.deliverables,
            isSub: true,
          }),
        },
        { role: 'user', content: 'Complete your mission and report back.' },
      ];

      let status = 'done';
      try {
        await runAgent({
          messages: childMessages,
          tools: childTools,
          model,
          apiKey,
          baseUrl,
          textLimit,
          maxSteps,
          onTool: onToolFor ? onToolFor(depth + 1) : undefined,
          compact: compactFor ? compactFor(childSpace, depth + 1) : undefined,
        });
      } catch {
        status = 'failed';
      } finally {
        await childHost.closeTab().catch(() => {});
        await childHost.close().catch(() => {});
      }

      let report = null;
      try {
        report = JSON.parse(readFileSync(resolve(childSpace, 'report.json'), 'utf8'));
      } catch {
        /* none written */
      }
      const lastAssistant = [...childMessages].reverse().find((m) => m.role === 'assistant' && typeof m.content === 'string');
      const digest = {
        child: childName,
        space: rel(childSpace),
        status,
        mission: args.mission,
        summary: report?.summary || lastAssistant?.content || '(no summary)',
        findings: report?.findings || [],
        sources: report?.sources || [],
        artifacts: report?.artifacts || [],
        report_path: existsSync(resolve(childSpace, 'report.md')) ? rel(resolve(childSpace, 'report.md')) : null,
        children: report?.children || [],
      };
      log?.(`└─ ${childName} [${status}] ${Date.now() - started}ms: ${String(digest.summary).slice(0, 120)}`);
      return digest;
    }

    const delegate = (args) => runChild(args);
    delegate.many = async (tasks, concurrency) => {
      const list = Array.isArray(tasks) ? tasks : [];
      if (!list.length) return [];
      const limit = Math.max(1, Math.min(Number(concurrency) || maxConcurrent, maxConcurrent, list.length));
      const results = new Array(list.length);
      let next = 0;
      async function worker() {
        while (next < list.length) {
          const i = next++;
          results[i] = await runChild(list[i]);
        }
      }
      await Promise.all(Array.from({ length: limit }, () => worker()));
      return results;
    };
    return delegate;
  }

  return makeDelegate;
}
