// MicroDot CLI: one agent per process, all attached to one shared Chromium.
// `/new` opens a new terminal (a new agent).
import readline from 'node:readline';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { createBrowserHost } from './browser-host.mjs';
import { createTools, openPath, pruneScreenshots } from './tools.mjs';
import { runAgent } from './agent.mjs';
import { createMarkdownStream } from './markdown.mjs';
import { createBusy } from './busy.mjs';
import { buildSystem } from './prompt.mjs';
import { makeSpawner } from './spawner.mjs';
import { stopSandboxWorker } from './tool-sandbox.mjs';
import { listSkills } from './skills.mjs';
import { ensureSpace, readMission, writeMission, shotsDir, getSpaceType, setSpaceType, pruneNotes } from './space.mjs';
import { listProjects, existsProject, createProject, deleteProject, getCurrentProject, setCurrentProject, clearCurrentProject } from './projects.mjs';
import { listWorkerTypes, readWorkerType } from './worker-types.mjs';
import { newChatId, saveChat, listChats, loadChat } from './chats.mjs';
import { ensureProject } from './home.mjs';
import { sweepOrphanTabs, stopChromiumIfIdle } from './tabs.mjs';

const apiKey = process.env.OPENROUTER_API_KEY || process.env.OpenRouterKey;
const baseUrl = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const model = process.env.MICRODOT_MODEL ?? 'deepseek/deepseek-v4.1-flash';
const headless = (process.env.MICRODOT_HEADLESS ?? 'true') !== 'false';
const isolate = (process.env.MICRODOT_ISOLATE_AGENTS ?? 'false') === 'true';
const charsPerToken = Number(process.env.MICRODOT_CHARS_PER_TOKEN ?? 4);
const textTokens = Number(process.env.MICRODOT_TEXT_TOKENS ?? 0);
// Prefer a token budget when given; clip tool results to (tokens * chars/token).
const textLimit = textTokens > 0 ? Math.round(textTokens * charsPerToken) : Number(process.env.MICRODOT_TEXT_LIMIT ?? 32768);
const maxSteps = Number(process.env.MICRODOT_MAX_STEPS ?? 12);
const allowSpawn = (process.env.MICRODOT_ALLOW_SPAWN ?? 'true') !== 'false';
const maxDepth = Number(process.env.MICRODOT_MAX_DEPTH ?? 3);
const maxAgents = Number(process.env.MICRODOT_MAX_AGENTS ?? 16);
const maxConcurrent = Number(process.env.MICRODOT_MAX_CONCURRENT ?? 8);
const debug = (process.env.MICRODOT_DEBUG ?? 'false') === 'true';
const compactEnabled = (process.env.MICRODOT_COMPACT ?? 'false') === 'true';
const contextTokens = Number(process.env.MICRODOT_CONTEXT_TOKENS ?? 24000);
const keepRecent = Number(process.env.MICRODOT_KEEP_RECENT ?? 6);
const offloadTokens = Number(process.env.MICRODOT_OFFLOAD_TOKENS ?? 4000);
const summaryModel = process.env.MICRODOT_SUMMARY_MODEL || 'qwen/qwen3.6-flash';
const keepShots = (process.env.MICRODOT_KEEP_SHOTS ?? 'false') === 'true';
const agentName = process.env.MICRODOT_AGENT || 'main';

if (!apiKey) {
  console.error('MicroDot: missing OPENROUTER_API_KEY (or an OpenRouterKey env var).');
  process.exit(1);
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

// Quiet by default: a KITT-style scanner instead of a wall of tool lines.
// MICRODOT_VERBOSE=true restores the per-tool logging.
const VERBOSE = (process.env.MICRODOT_VERBOSE ?? 'false') === 'true';
const busy = createBusy();

// Each worker has its own space: spaces/<worker_name>/ (mission.md + files).
// Resume the remembered project (if any) before laying out paths.
{
  const remembered = getCurrentProject();
  if (remembered && !(process.env.MICRODOT_PROJECT || '').trim()) setCurrentProject(remembered);
}
ensureProject();
let spacePath = ensureSpace(agentName);
let mission = readMission(agentName).trim();

let workerType = (process.env.MICRODOT_WORKER_TYPE || '').trim() || getSpaceType(agentName) || 'default';
setSpaceType(agentName, workerType);

let SYSTEM = buildSystem({ space: spacePath, type: workerType, mission });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, (a) => r(a)));

// Approval for create_tool (skip with MICRODOT_APPROVE_CREATE_TOOL=false).
async function confirmCreate(action, code) {
  if (!process.stdin.isTTY) {
    console.log(dim(`  (non-interactive) auto-approving ${action}`));
    return true;
  }
  busy.pause(); // hide the spinner so the prompt is actually visible
  try {
    console.log(dim(`\n  new tool — ${action}:`));
    for (const line of String(code ?? '').split('\n')) console.log(yellow(`  │ ${line}`));
    const a = (await ask(dim('  create this tool? [y/N] '))).trim().toLowerCase();
    return a === 'y' || a === 'yes';
  } finally {
    busy.resume();
  }
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

// Compaction config for an agent (space + indent depth).
function compactFor(space, depth) {
  return {
    enabled: compactEnabled,
    maxTokens: contextTokens,
    keepRecent,
    charsPerToken,
    offloadTokens,
    summaryModel,
    fallbackModel: model,
    spaceDir: space,
    headChars: 2000,
    onNote: (m) => {
      if (VERBOSE) console.log(dim(`${'  '.repeat(depth)}  · ${m}`));
    },
  };
}

function spawnAgentTerminal(name, type) {
  const env = { ...process.env };
  env.MICRODOT_AGENT = name || `agent-${Date.now().toString(36)}`;
  if (type) env.MICRODOT_WORKER_TYPE = type;
  if (process.platform === 'win32') {
    const bat = resolve(process.cwd(), 'microdot.bat');
    const comspec = process.env.ComSpec || 'cmd.exe';
    execFile(comspec, ['/c', 'start', 'MicroDot', 'cmd', '/k', `"${bat}"`], { cwd: process.cwd(), env });
  } else {
    // Linux/VPS: prefer a new tmux window if we're inside tmux, else a terminal
    // emulator, else launch a detached background process (no window).
    const sh = resolve(process.cwd(), 'microdot.sh');
    const insideTmux = !!process.env.TMUX;
    if (insideTmux) {
      execFile('tmux', ['new-window', `-n`, env.MICRODOT_AGENT, `MICRODOT_AGENT=${env.MICRODOT_AGENT} ${sh}`], { cwd: process.cwd() });
    } else if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
      const term = process.env.MICRODOT_TERMINAL || 'x-terminal-emulator';
      execFile(term, ['-e', `MICRODOT_AGENT=${env.MICRODOT_AGENT} ${sh}`], { cwd: process.cwd(), env });
    } else {
      execFile('setsid', ['-f', 'env', `MICRODOT_AGENT=${env.MICRODOT_AGENT}`, sh], { cwd: process.cwd(), env, detached: true });
    }
  }
  return env.MICRODOT_AGENT;
}

function help() {
  console.log(dim('commands:'));
  console.log(dim('  /new [name] [type]   open a new MicroDot CLI (new worker + space)'));
  console.log(dim('  /project [<name>]    show/load a project (resumes it); new <name> / delete <name> / off'));
  console.log(dim('  /paste        paste a multi-line prompt (end with a line containing only ".")'));
  console.log(dim('  /tools        list built-in and custom tools (with descriptions)'));
  console.log(dim('  /delete <n>   delete a custom tool'));
  console.log(dim('  /skills       list saved skills'));
  console.log(dim('  /resume [id]  list saved chats, or resume one'));
  console.log(dim('  /name [t]     show or set this chat\'s title'));
  console.log(dim('  /type [name]  show or set this worker\'s type'));
  console.log(dim('  /mission [t]  show or set this space\'s mission.md'));
  console.log(dim('  /reset        reset this conversation'));
  console.log(dim('  /shots        open the latest screenshot'));
  console.log(dim(`  /help /exit`));
  if (allowSpawn)
    console.log(dim(`  (sub-agents: spawn_subagent available — depth<=${maxDepth}, agents<=${maxAgents}, concurrency<=${maxConcurrent})`));
  else console.log(dim('  (sub-agents: disabled - MICRODOT_ALLOW_SPAWN=false)'));
}

// Re-print a resumed conversation so the terminal shows where you left off.
function renderHistory(msgs) {
  for (const m of msgs) {
    if (m.role === 'system') continue;
    if (m.role === 'user' && typeof m.content === 'string') console.log(`${cyan('you>')} ${m.content}`);
    else if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) console.log(`\n${m.content}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const pi = argv.indexOf('--prompt');
  const pfi = argv.indexOf('--prompt-file');
  const ri = argv.indexOf('--resume');
  const resumeId = ri >= 0 ? argv[ri + 1] : null;
  const once = argv.includes('--once') || pi >= 0 || pfi >= 0;
  const prompt =
    pfi >= 0
      ? readFileSync(argv[pfi + 1], 'utf8')
      : pi >= 0
        ? argv.slice(pi + 1).join(' ')
        : argv.filter((a) => a !== '--once').join(' ').trim();

  const host = await createBrowserHost({ headless, isolate, agentId: agentName });
  await sweepOrphanTabs(); // clean up tabs left behind by crashed agents
  await host.getPage(); // this agent's tab exists from the start

  // --- sub-agent spawner (shared with the library) -----------------------
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
    sandbox: (process.env.MICRODOT_TOOL_SANDBOX ?? 'auto').toLowerCase(),
    headless,
    isolate,
    debug,
    compactFor,
    onToolFor: (d) => makeOnTool(d),
    log: (m) => {
      if (VERBOSE) console.log(dim(m));
    },
  });

  let tools = await createTools({
    host,
    agentId: agentName,
    textLimit,
    delegate: allowSpawn ? makeDelegate({ parentSpace: spacePath, depth: 0 }) : undefined,
  });
  pruneScreenshots(Number(process.env.MICRODOT_SHOT_KEEP ?? 10) || 10, shotsDir(agentName));

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

  // Full agent shutdown: release the tab, stop the shared browser if we were the
  // last agent, and clean scratch (sub-agents, screenshots) unless kept.
  async function cleanup() {
    busy.stop();
    autosave();
    cleanupSubagents();
    if ((process.env.MICRODOT_PRUNE_NOTES ?? 'true') !== 'false') {
      pruneNotes(agentName, {
        keep: Number(process.env.MICRODOT_NOTES_KEEP ?? 400) || 400,
        maxMB: Number(process.env.MICRODOT_NOTES_MAX_MB ?? 25) || 25,
      });
    }
    await host.closeTab().catch(() => {});
    await stopChromiumIfIdle().catch(() => {});
    await host.close().catch(() => {});
    stopSandboxWorker();
    if (!keepShots) {
      try {
        rmSync(shotsDir(agentName), { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  process.on('SIGINT', () => {
    cleanup().finally(() => process.exit(0));
  });
  // Conversation state (persisted so it can be resumed later).
  const chat = { id: newChatId(), title: '', agent: agentName, type: workerType, space: `spaces/${agentName}`, cwd: process.env.MICRODOT_LAUNCH_DIR || process.cwd(), model, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
  function autosave() {
    chat.messages = messages;
    if (!chat.title) {
      const firstUser = messages.find((m) => m.role === 'user' && typeof m.content === 'string');
      if (firstUser) chat.title = firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 60);
    }
    if (!chat.title) chat.title = `chat ${chat.id}`;
    try {
      saveChat(chat);
    } catch {
      /* ignore */
    }
  }

  let messages = [{ role: 'system', content: SYSTEM }];
  if (resumeId) {
    try {
      const c = loadChat(resumeId);
      chat.id = c.id;
      chat.title = c.title || '';
      messages = [{ role: 'system', content: SYSTEM }, ...(c.messages || []).slice(1)];
      console.log(dim(`resumed "${c.title || c.id}" (${messages.length - 1} messages)`));
      renderHistory(messages);
    } catch (e) {
      console.error(yellow(`resume failed: ${e?.message ?? e}`));
    }
  }

  // Switch the active project and re-init the session for it. `fresh` starts a
  // clean chat; otherwise the project's most recent chat is resumed.
  async function loadProject(name, { fresh = false } = {}) {
    autosave();
    setCurrentProject(name);
    ensureProject();
    spacePath = ensureSpace(agentName);
    mission = readMission(agentName).trim();
    workerType = (process.env.MICRODOT_WORKER_TYPE || '').trim() || getSpaceType(agentName) || 'default';
    setSpaceType(agentName, workerType);
    SYSTEM = buildSystem({ space: spacePath, type: workerType, mission });
    tools = await createTools({
      host,
      agentId: agentName,
      textLimit,
      delegate: allowSpawn ? makeDelegate({ parentSpace: spacePath, depth: 0 }) : undefined,
    });
    chat.space = `spaces/${agentName}`;
    chat.id = newChatId();
    chat.title = '';
    chat.createdAt = Date.now();
    messages = [{ role: 'system', content: SYSTEM }];
    if (!fresh) {
      const list = listChats();
      if (list.length) {
        const c = loadChat(list[0].id);
        chat.id = c.id;
        chat.title = c.title || '';
        messages = [{ role: 'system', content: SYSTEM }, ...(c.messages || []).slice(1)];
        console.log(dim(`resumed "${c.title || c.id}" (${messages.length - 1} messages)`));
        renderHistory(messages);
      }
    }
    autosave();
    console.log(dim(`project "${name}" · space spaces/${agentName} · type ${workerType} · ${listChats().length} chat(s)`));
  }

  async function turn(p) {
    messages.push({ role: 'user', content: p });
    process.stdout.write('\n');
    const md = createMarkdownStream({ write: (s) => process.stdout.write(s) });
    const rootOnTool = (kind, name, data) => {
      if (VERBOSE) {
        onTool(kind, name, data);
        return;
      }
      if (kind === 'call') busy.start(name);
      else busy.set(`${name} · done`);
    };
    busy.start('thinking');
    try {
      await runAgent({
        messages,
        tools,
        model,
        apiKey,
        baseUrl,
        textLimit,
        maxSteps,
        onToken: (t) => {
          if (!VERBOSE) busy.stop();
          md.push(t);
        },
        onTool: rootOnTool,
        confirm: confirmCreate,
        compact: compactFor(spacePath, 0),
      });
    } catch (e) {
      busy.stop();
      md.flush();
      console.error(`\n${yellow('error:')} ${e?.message ?? e}`);
    }
    md.flush();
    busy.stop();
    process.stdout.write('\n');
    autosave();
  }

  if (once) {
    if (!prompt) {
      console.error('usage: microdot --prompt "your task"');
      process.exit(1);
    }
    await turn(prompt);
    await cleanup();
    rl.close();
    return;
  }

  console.log(
    cyan('MicroDot') +
      dim(` · agent="${agentName}" · type=${workerType} · space=spaces/${agentName} · chat=${chat.id} · model=${model} · browser=${headless ? 'headless' : 'headful'}${allowSpawn ? ` · spawn=on(${maxDepth}/${maxAgents})` : ''} shared via ${host.cdpUrl}`),
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
    if (line === '/paste') {
      console.log(dim('paste your prompt; finish with a line containing only "."'));
      const buf = [];
      for (;;) {
        const l = await ask(dim('… '));
        if (l.trim() === '.' || l.trim() === 'EOF') break;
        buf.push(l);
      }
      const text = buf.join('\n').trim();
      if (text) await turn(text);
      continue;
    }
    if (line === '/new' || line.startsWith('/new ')) {
      const parts = line.slice(4).trim().split(/\s+/).filter(Boolean);
      const given = parts[0] || '';
      const type = parts[1] || 'default'; // no type stated -> default
      const spawned = spawnAgentTerminal(given, type);
      console.log(dim(`opened a new MicroDot CLI window (agent "${spawned}", worker type "${type}") — shares the same Chromium`));
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
    if (line === '/resume' || line.startsWith('/resume ')) {
      const arg = line.slice(7).trim();
      if (!arg) {
        const list = listChats();
        if (!list.length) console.log(dim('no saved chats yet'));
        else {
          console.log(dim('saved chats (newest first):'));
          for (const c of list.slice(0, 20)) {
            console.log(`  ${c.id}  ${dim(`${new Date(c.updatedAt).toLocaleString()} · ${c.count} msgs · ${c.agent} · ${c.title || ''}`)}`);
          }
          console.log(dim('resume with: /resume <id>'));
        }
      } else {
        try {
          const c = loadChat(arg);
          chat.id = c.id;
          chat.title = c.title || '';
          messages = [{ role: 'system', content: SYSTEM }, ...(c.messages || []).slice(1)];
          console.log(dim(`resumed "${c.title || c.id}" (${messages.length - 1} messages)`));
          renderHistory(messages);
        } catch (e) {
          console.log(yellow(`  ${e?.message ?? e}`));
        }
      }
      continue;
    }
    if (line === '/name' || line.startsWith('/name ')) {
      const t = line.slice(5).trim();
      if (t) {
        chat.title = t;
        autosave();
        console.log(dim(`chat title: ${t}`));
      } else {
        console.log(dim(`chat: ${chat.title || '(auto)'} · id ${chat.id}`));
      }
      continue;
    }
    if (line === '/projects' || line === '/project' || line.startsWith('/project ')) {
      const rest = line === '/projects' ? '' : line.replace(/^\/project\b\s*/, '').trim();
      const parts = rest.split(/\s+/).filter(Boolean);
      const sub = parts[0] || '';
      const name = parts[1] || '';
      const cur = (process.env.MICRODOT_PROJECT || '').trim();
      if (!sub || sub === 'list') {
        console.log(dim(`current project: ${cur || '(none — using the launch folder)'}`));
        const list = listProjects();
        if (!list.length) console.log(dim('no projects yet — create one with: /project new <name>'));
        else for (const p of list) console.log(`  ${p.name === cur ? '*' : ' '} ${p.name}  ${dim(`${p.chats} chat(s) · ${new Date(p.updatedAt).toLocaleString()}`)}`);
        console.log(dim('load: /project <name>   new: /project new <name>   delete: /project delete <name>   off: /project off'));
        continue;
      }
      if (sub === 'new') {
        if (!name) console.log(dim('usage: /project new <name>'));
        else {
          try {
            createProject(name);
            await loadProject(name, { fresh: true });
          } catch (e) {
            console.log(yellow(`  ${e?.message ?? e}`));
          }
        }
        continue;
      }
      if (sub === 'delete') {
        if (!name) console.log(dim('usage: /project delete <name>'));
        else {
          try {
            deleteProject(name);
            console.log(dim(`deleted project "${name}"`));
          } catch (e) {
            console.log(yellow(`  ${e?.message ?? e}`));
          }
        }
        continue;
      }
      if (sub === 'off') {
        clearCurrentProject();
        console.log(dim('project cleared — using the launch folder'));
        continue;
      }
      if (!existsProject(sub)) {
        console.log(yellow(`  no project "${sub}" — create it with: /project new ${sub}`));
        continue;
      }
      try {
        await loadProject(sub, { fresh: false });
      } catch (e) {
        console.log(yellow(`  ${e?.message ?? e}`));
      }
      continue;
    }
    if (line === '/reset') {
      autosave();
      chat.id = newChatId();
      chat.title = '';
      chat.createdAt = Date.now();
      messages = [{ role: 'system', content: SYSTEM }];
      console.log(dim('started a new conversation (previous chat saved — /resume to reopen)'));
      continue;
    }
    await turn(line);
  }
  await cleanup();
  rl.close();
}

main();
