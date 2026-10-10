// MiniDot CLI: one agent per process, all attached to one shared Chromium.
// `/new` opens a new terminal (a new agent).
import readline from 'node:readline';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { execFile } from 'node:child_process';
import { createBrowserHost } from './browser-host.mjs';
import { createTools, openPath, pruneScreenshots } from './tools.mjs';
import { runAgent } from './agent.mjs';
import { createMarkdownStream } from './markdown.mjs';
import { stopSandboxWorker } from './tool-sandbox.mjs';
import { listSkills } from './skills.mjs';
import { ensureSpace, readMission, writeMission, shotsDir, getSpaceType, setSpaceType } from './space.mjs';
import { listWorkerTypes, readWorkerType } from './worker-types.mjs';

const apiKey = process.env.OPENROUTER_API_KEY || process.env.OpenRouterKey;
const baseUrl = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const model = process.env.MINIDOT_MODEL ?? 'deepseek/deepseek-v4.1-flash';
const headless = (process.env.MINIDOT_HEADLESS ?? 'true') !== 'false';
const isolate = (process.env.MINIDOT_ISOLATE_AGENTS ?? 'false') === 'true';
const textLimit = Number(process.env.MINIDOT_TEXT_LIMIT ?? 32768);
const maxSteps = Number(process.env.MINIDOT_MAX_STEPS ?? 12);
const allowSpawn = (process.env.MINIDOT_ALLOW_SPAWN ?? 'false') === 'true';
const maxDepth = Number(process.env.MINIDOT_MAX_DEPTH ?? 3);
const maxAgents = Number(process.env.MINIDOT_MAX_AGENTS ?? 16);
const maxConcurrent = Number(process.env.MINIDOT_MAX_CONCURRENT ?? 8);
const debug = (process.env.MINIDOT_DEBUG ?? 'false') === 'true';
const agentName = process.env.MINIDOT_AGENT || 'main';

if (!apiKey) {
  console.error('MiniDot: missing OPENROUTER_API_KEY (or an OpenRouterKey env var).');
  process.exit(1);
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

const SYSTEM_BASE = `You are MiniDot, a small autonomous agent with your own browser tab in a shared Chromium. You have tools to fetch the web and to drive your tab. Be concise and factual.
- Prefer web_search for current information; use http_get for plain pages; use the browser for pages that need JavaScript or interaction.
- Always report what you actually observed. Never invent page content.
- When your task is complete, answer the user directly in a short summary.`;

// Each worker has its own space: spaces/<worker_name>/ (mission.md + files).
const spacePath = ensureSpace(agentName);
const mission = readMission(agentName).trim();

let workerType = (process.env.MINIDOT_WORKER_TYPE || '').trim() || getSpaceType(agentName) || 'default';
setSpaceType(agentName, workerType);

// Build the system prompt for a worker or sub-agent.
function buildSystem({ space, type, mission: missionText, context, deliverables, isSub }) {
  const typeText = readWorkerType(type).trim();
  let s = SYSTEM_BASE;
  s += typeText
    ? `\n\nYour worker type "${type}" (how you behave):\n${typeText}`
    : `\n\nYour worker type is "${type}" (no description file found in ./worker-types/).`;
  s += `\n\nYour space: ${space}\nKeep the files you produce (documents, notes, outputs, downloads) here.`;
  if (missionText) s += `\n\nYour mission (mission.md):\n${missionText}`;
  const skills = listSkills();
  if (skills.length) {
    s += `\n\nSaved skills (call read_skill to load one, then follow its steps):\n${skills
      .map((x) => `- ${x.name}: ${x.description}`)
      .join('\n')}`;
  }
  if (isSub) {
    s += `\n\nYou are a sub-agent, working autonomously on ONE mission.`;
    if (context) s += `\n\nContext from your parent:\n${context}`;
    if (deliverables) s += `\n\nDeliverables your parent needs:\n${deliverables}`;
    s += `\n\nWhen you finish, write report.json in your space with { summary, findings:[..], sources:[{title,url}], artifacts:[..], children:[..] }, write a readable report.md, then reply with a concise summary. If part of the mission needs deeper work you may call spawn_subagent (subject to limits) and include its digest under children[].`;
  }
  return s;
}

const SYSTEM = buildSystem({ space: spacePath, type: workerType, mission });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, (a) => r(a)));

// Approval for create_tool (skip with MINIDOT_APPROVE_CREATE_TOOL=false).
async function confirmCreate(action, code) {
  if (!process.stdin.isTTY) {
    console.log(dim(`  (non-interactive) auto-approving ${action}`));
    return true;
  }
  console.log(dim(`\n  new tool — ${action}:`));
  for (const line of String(code ?? '').split('\n')) console.log(yellow(`  │ ${line}`));
  const a = (await ask(dim('  create this tool? [y/N] '))).trim().toLowerCase();
  return a === 'y' || a === 'yes';
}

function makeOnTool(depth = 0) {
  const pad = '  '.repeat(depth);
  return (kind, name, data) => {
    if (kind === 'call') console.log(dim(`${pad}  → ${name} ${Object.keys(data).length ? JSON.stringify(data) : ''}`));
    else {
      const s = JSON.stringify(data);
      console.log(dim(`${pad}  ← ${name} ${s.length > 180 ? s.slice(0, 180) + '…' : s}`));
    }
  };
}
const onTool = makeOnTool(0);

function slugify(s) {
  return (
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'task'
  );
}

function uniqueChildDir(parentSpace, base) {
  let name = base;
  let n = 2;
  while (existsSync(resolve(parentSpace, 'subagents', name))) name = `${base}-${n++}`;
  return name;
}

function spawnAgentTerminal(name, type) {
  const env = { ...process.env };
  env.MINIDOT_AGENT = name || `agent-${Date.now().toString(36)}`;
  if (type) env.MINIDOT_WORKER_TYPE = type;
  if (process.platform === 'win32') {
    const bat = resolve(process.cwd(), 'minidot.bat');
    const comspec = process.env.ComSpec || 'cmd.exe';
    execFile(comspec, ['/c', 'start', 'MiniDot', 'cmd', '/k', `"${bat}"`], { cwd: process.cwd(), env });
  } else {
    // Linux/VPS: prefer a new tmux window if we're inside tmux, else a terminal
    // emulator, else launch a detached background process (no window).
    const sh = resolve(process.cwd(), 'minidot.sh');
    const insideTmux = !!process.env.TMUX;
    if (insideTmux) {
      execFile('tmux', ['new-window', `-n`, env.MINIDOT_AGENT, `MINIDOT_AGENT=${env.MINIDOT_AGENT} ${sh}`], { cwd: process.cwd() });
    } else if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
      const term = process.env.MINIDOT_TERMINAL || 'x-terminal-emulator';
      execFile(term, ['-e', `MINIDOT_AGENT=${env.MINIDOT_AGENT} ${sh}`], { cwd: process.cwd(), env });
    } else {
      execFile('setsid', ['-f', 'env', `MINIDOT_AGENT=${env.MINIDOT_AGENT}`, sh], { cwd: process.cwd(), env, detached: true });
    }
  }
  return env.MINIDOT_AGENT;
}

function help() {
  console.log(dim('commands:'));
  console.log(dim('  /new [name] [type]   open a new MiniDot CLI (new worker + space)'));
  console.log(dim('  /tools        list built-in and custom tools (with descriptions)'));
  console.log(dim('  /delete <n>   delete a custom tool'));
  console.log(dim('  /skills       list saved skills'));
  console.log(dim('  /type [name]  show or set this worker\'s type'));
  console.log(dim('  /mission [t]  show or set this space\'s mission.md'));
  console.log(dim('  /reset        reset this conversation'));
  console.log(dim('  /shots        open the latest screenshot'));
  console.log(dim(`  /help /exit`));
  if (allowSpawn) console.log(dim(`  (sub-agents: spawn_subagent is available; depth<=${maxDepth}, agents<=${maxAgents})`));
}

async function main() {
  const argv = process.argv.slice(2);
  const pi = argv.indexOf('--prompt');
  const once = argv.includes('--once') || pi >= 0;
  const prompt = pi >= 0 ? argv.slice(pi + 1).join(' ') : argv.filter((a) => a !== '--once').join(' ').trim();

  const host = await createBrowserHost({ headless, isolate });
  await host.getPage(); // this agent's tab exists from the start

  // --- sub-agent spawner -------------------------------------------------
  const budget = { agents: 0 };
  const relPath = (p) => relative(process.cwd(), p).replace(/\\/g, '/');

  function makeDelegate({ parentSpace, depth }) {
    async function runChild(args) {
      if (!allowSpawn) return { declined: true, reason: 'spawning disabled (set MINIDOT_ALLOW_SPAWN=true)' };
      if (depth >= maxDepth) return { declined: true, reason: `max depth ${maxDepth} reached` };
      if (budget.agents >= maxAgents) return { declined: true, reason: `max agents ${maxAgents} reached` };

      // reserve budget synchronously so parallel batches can't over-spend
      const childName = uniqueChildDir(parentSpace, slugify(args.name || args.mission));
      const childSpace = resolve(parentSpace, 'subagents', childName);
      const childType = String(args.type || 'default').trim();
      mkdirSync(resolve(childSpace, 'shots'), { recursive: true });
      writeFileSync(resolve(childSpace, 'mission.md'), `${String(args.mission || '').trim()}\n`);
      writeFileSync(resolve(childSpace, 'worker_type'), `${childType}\n`);
      budget.agents++;
      const started = Date.now();
      console.log(
        dim(`${'  '.repeat(depth)}  ⤷ spawn ${childName} [${childType}] (agents ${budget.agents}/${maxAgents}, depth ${depth + 1}/${maxDepth})${debug ? ` @${new Date(started).toISOString().slice(11, 23)}` : ''}`),
      );

      // Each agent gets its OWN tab (its own CDP host) on the shared Chromium —
      // created now, never changed, closed when the agent is done.
      const childHost = await createBrowserHost({ headless, isolate });
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
        await runAgent({ messages: childMessages, tools: childTools, model, apiKey, baseUrl, textLimit, maxSteps, onTool: makeOnTool(depth + 1) });
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
        space: relPath(childSpace),
        status,
        mission: args.mission,
        summary: report?.summary || lastAssistant?.content || '(no summary)',
        findings: report?.findings || [],
        sources: report?.sources || [],
        artifacts: report?.artifacts || [],
        report_path: existsSync(resolve(childSpace, 'report.md')) ? relPath(resolve(childSpace, 'report.md')) : null,
        children: report?.children || [],
      };
      const ms = Date.now() - started;
      console.log(dim(`${'  '.repeat(depth + 1)}└─ ${childName} [${status}] ${ms}ms: ${String(digest.summary).slice(0, 120)}`));
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

  const tools = await createTools({
    host,
    agentId: agentName,
    textLimit,
    delegate: allowSpawn ? makeDelegate({ parentSpace: spacePath, depth: 0 }) : undefined,
  });
  pruneScreenshots(Number(process.env.MINIDOT_SHOT_KEEP ?? 10) || 10, shotsDir(agentName));

  // End-of-run cleanup: the sub-agent tree is scratch; results were folded up.
  function cleanupSubagents() {
    if (debug) {
      console.log(dim(`(debug) keeping sub-agent spaces under spaces/${agentName}/subagents/`));
      return;
    }
    try {
      rmSync(resolve(spacePath, 'subagents'), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  let messages = [{ role: 'system', content: SYSTEM }];

  async function turn(p) {
    messages.push({ role: 'user', content: p });
    process.stdout.write(cyan('\ndot> '));
    const md = createMarkdownStream({ write: (s) => process.stdout.write(s) });
    try {
      await runAgent({
        messages,
        tools,
        model,
        apiKey,
        baseUrl,
        textLimit,
        maxSteps,
        onToken: (t) => md.push(t),
        onTool,
        confirm: confirmCreate,
      });
    } catch (e) {
      md.flush();
      console.error(`\n${yellow('error:')} ${e?.message ?? e}`);
    }
    md.flush();
    process.stdout.write('\n');
  }

  if (once) {
    if (!prompt) {
      console.error('usage: minidot --prompt "your task"');
      process.exit(1);
    }
    await turn(prompt);
    cleanupSubagents();
    await host.closeTab().catch(() => {});
    await host.close();
    stopSandboxWorker();
    rl.close();
    return;
  }

  console.log(
    cyan('MiniDot') +
      dim(` · agent="${agentName}" · type=${workerType} · space=spaces/${agentName} · model=${model} · browser=${headless ? 'headless' : 'headful'}${allowSpawn ? ` · spawn=on(${maxDepth}/${maxAgents})` : ''} shared via ${host.cdpUrl}`),
  );
  help();
  while (true) {
    const line = (await ask(cyan(`\n${agentName}@you> `))).trim();
    if (!line) continue;
    if (line === '/exit' || line === '/quit') break;
    if (line === '/help') {
      help();
      continue;
    }
    if (line === '/new' || line.startsWith('/new ')) {
      const parts = line.slice(4).trim().split(/\s+/).filter(Boolean);
      const given = parts[0] || '';
      const type = parts[1] || 'default'; // no type stated -> default
      const spawned = spawnAgentTerminal(given, type);
      console.log(dim(`opened a new MiniDot CLI window (agent "${spawned}", worker type "${type}") — shares the same Chromium`));
      continue;
    }
    if (line === '/tools') {
      const { builtin, custom } = await tools.execute('list_tools', {});
      console.log(dim('built-in:'));
      for (const t of builtin) console.log(`  ${t.name}${dim(` — ${(t.description || '').slice(0, 96)}`)}`);
      console.log(dim(`custom (${custom.length}):`));
      for (const t of custom) console.log(`  ${t.name} ${dim(`[${t.backend}] — ${(t.description || '').slice(0, 88)}`)}`);
      continue;
    }
    if (line === '/delete' || line.startsWith('/delete ')) {
      const toolName = line.slice(7).trim();
      if (!toolName) {
        console.log(dim('usage: /delete <tool-name>'));
        continue;
      }
      try {
        const r = await tools.execute('delete_tool', { name: toolName });
        console.log(dim(`deleted "${r.deleted}"`));
      } catch (e) {
        console.log(yellow(`  ${e?.message ?? e}`));
      }
      continue;
    }
    if (line === '/skills') {
      const skills = listSkills();
      if (!skills.length) console.log(dim('no skills yet'));
      else for (const s of skills) console.log(`  ${s.name}${dim(` — ${s.description}`)}`);
      continue;
    }
    if (line === '/mission' || line.startsWith('/mission ')) {
      const text = line.slice(8).trim();
      if (!text) {
        console.log(dim(`space: ${spacePath}`));
        console.log(readMission(agentName).trim() || dim('(no mission set)'));
      } else {
        const file = writeMission(agentName, text);
        messages[0] = { role: 'system', content: buildSystem({ space: spacePath, type: workerType, mission: text }) };
        console.log(dim(`mission updated: ${file}`));
      }
      continue;
    }
    if (line === '/type' || line.startsWith('/type ')) {
      const name = line.slice(5).trim();
      if (!name) {
        console.log(dim(`worker type: ${workerType}`));
        const types = listWorkerTypes();
        if (types.length) {
          console.log(dim('available:'));
          for (const t of types) console.log(`  ${t.name}${dim(` — ${t.description}`)}`);
        }
      } else {
        const text = readWorkerType(name).trim();
        if (!text) {
          console.log(yellow(`  no worker type "${name}" in ./worker-types/`));
          continue;
        }
        workerType = name;
        setSpaceType(agentName, name);
        messages[0] = {
          role: 'system',
          content: buildSystem({ space: spacePath, type: name, mission: readMission(agentName).trim() }),
        };
        console.log(dim(`worker type set to "${name}"`));
      }
      continue;
    }
    if (line === '/shots') {
      const dir = shotsDir(agentName);
      try {
        const files = readdirSync(dir).sort();
        if (!files.length) console.log(dim('no screenshots yet'));
        else {
          const latest = resolve(dir, files[files.length - 1]);
          console.log(dim(`opening: ${latest}`));
          openPath(latest);
        }
      } catch {
        console.log(dim('no screenshots yet'));
      }
      continue;
    }
    if (line === '/reset') {
      messages = [{ role: 'system', content: SYSTEM }];
      console.log(dim('conversation reset'));
      continue;
    }
    await turn(line);
  }
  cleanupSubagents();
  await host.closeTab().catch(() => {});
  await host.close();
  stopSandboxWorker();
  rl.close();
}

main();
