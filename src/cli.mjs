// MicroDot CLI: one agent per process, all attached to one shared Chromium.
// `/new` opens a new terminal (a new agent).
import { createPrompt } from './input.mjs';
import { readdirSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
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
import { ensureSpace, readMission, writeMission, resetMission, shotsDir, getSpaceType, setSpaceType, pruneNotes } from './space.mjs';
import { listProjects, existsProject, createProject, deleteProject, setCurrentProject, clearCurrentProject } from './projects.mjs';
import { listWorkerTypes, readWorkerType } from './worker-types.mjs';
import { newChatId, saveChat, listChats, loadChat } from './chats.mjs';
import { ensureProject } from './home.mjs';
import { sweepOrphanTabs, stopChromiumIfIdle } from './tabs.mjs';
import { bold, dim, cyan, yellow, green, magenta, blue, red, gray } from './theme.mjs';
import { addReference, removeReference, setReferences, listReferences, referencePaths } from './references.mjs';
import { listTrash, restoreTrash, emptyTrash } from './gc.mjs';

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
  console.error(red('MicroDot: missing OPENROUTER_API_KEY (or an OpenRouterKey env var).'));
  process.exit(1);
}

// Quiet by default: a KITT-style scanner instead of a wall of tool lines.
// MICRODOT_VERBOSE=true restores the per-tool logging.
const VERBOSE = (process.env.MICRODOT_VERBOSE ?? 'false') === 'true';
const busy = createBusy();

// Clear the terminal (screen + scrollback) without touching the conversation.
const clearScreen = () => process.stdout.write('\u001b[2J\u001b[3J\u001b[H');

// ---- Read-only file references ----------------------------------------------
const looksLikePath = (s) => /[\\/:]/.test(s);
function parsePaths(str) {
  const out = [];
  const re = /"([^"]+)"|'([^']+)'|(\S+)/g;
  let m;
  while ((m = re.exec(str))) out.push(m[1] || m[2] || m[3]);
  return out;
}
// A dropped file path is the whole input and every token is a real file that
// looks like a path. Returns the paths, else null.
function bareFilePaths(line) {
  if (!line) return null;
  const parts = parsePaths(line);
  if (!parts.length || !parts.every((p) => looksLikePath(p))) return null;
  const ok = parts.every((p) => {
    try {
      return existsSync(resolve(process.cwd(), p)) && statSync(resolve(process.cwd(), p)).isFile();
    } catch {
      return false;
    }
  });
  return ok ? parts : null;
}

// Each worker has its own space: spaces/<worker_name>/ (mission.md + files).
// Start with NO project unless one is set explicitly (MICRODOT_PROJECT); select
// one at runtime with /project (which resumes its chat).
ensureProject();
let spacePath = ensureSpace(agentName);
let mission = readMission(agentName).trim();

let workerType = (process.env.MICRODOT_WORKER_TYPE || '').trim() || getSpaceType(agentName) || 'default';
setSpaceType(agentName, workerType);

let SYSTEM = buildSystem({ space: spacePath, type: workerType, mission });

// Paste-aware input: a pasted block fills the prompt and does NOT submit —
// press Enter to run it. (Bracketed paste; raw mode.)
let activeAbort = null; // AbortController for the running turn (Esc stops it)
let onInterrupt = null; // Ctrl-C handler, installed in main()
const COMMANDS = [
  { name: '/new', help: 'open a new worker' },
  { name: '/project', help: 'show/load/delete a project (/ = root)' },
  { name: '/resume', help: 'list or resume a chat' },
  { name: '/name', help: "set this chat's title" },
  { name: '/gc', help: 'review and clean up the tools you built (reversible trash)' },
  { name: '/trash', help: 'list / restore / empty trashed tools' },
  { name: '/ref', help: 'add a read-only file reference' },
  { name: '/refs', help: 'list reference files' },
  { name: '/unref', help: 'remove a reference' },
  { name: '/tools', help: 'list built-in and custom tools' },
  { name: '/delete', help: 'delete a custom tool' },
  { name: '/skills', help: 'list saved skills' },
  { name: '/type', help: "show or set this worker's type" },
  { name: '/mission', help: 'show or set the mission (/ resets to the root mission)' },
  { name: '/reset', help: 'start a new conversation' },
  { name: '/cls', help: 'clear the screen' },
  { name: '/clear', help: 'clear the context and the screen' },
  { name: '/shots', help: 'open the latest screenshot' },
  { name: '/help', help: 'show commands' },
  { name: '/exit', help: 'quit' },
];
// Suggest completions for the current input: slash commands, or project names
// after "/project ".
function suggest(input) {
  if (/^\/\S*$/.test(input)) {
    return COMMANDS.filter((c) => c.name.startsWith(input)).map((c) => ({ label: c.name, help: c.help, complete: c.name }));
  }
  const m = input.match(/^\/project\s+(\S*)$/);
  if (m) {
    const prefix = m[1];
    return listProjects()
      .map((p) => p.name)
      .filter((n) => n.startsWith(prefix))
      .map((n) => ({ label: n, help: '', complete: `/project ${n}` }));
  }
  return [];
}
const input = createPrompt({
  suggest,
  onEscape: () => {
    if (activeAbort) activeAbort.abort(); // stop the current turn
    else input.clear(); // idle: clear whatever is typed
  },
  onInterrupt: () => onInterrupt?.(),
});
const ask = (q) => input.ask(q);

// Approval for create_tool (off by default; enable with MICRODOT_APPROVE_CREATE_TOOL=true).
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
  console.log(dim('  /project [<name>]    show/load a project — no name: pick from a list (resumes its last chat); new/delete; "/" = root'));
  console.log(dim('  (paste multi-line text directly, then press Enter to run it)'));
  console.log(dim('  (type / for a command menu — Up/Down or Tab fill the line, Enter runs it)'));
  console.log(dim('  (Up/Down (no menu) recall previous inputs — commands included)'));
  console.log(dim('  (Esc stops a running turn · while it runs, Ctrl-C again stops; idle Ctrl-C is ignored)'));
  console.log(dim('  /gc           review your tool set; trashes temporary/old/broken tools (reversible)'));
  console.log(dim('  /trash        list trashed tools; /trash restore <name> | /trash empty'));
  console.log(dim('  /ref <path>   add a read-only file reference (or drop a file into the prompt)'));
  console.log(dim('  /refs         list reference files; /unref <path|all> removes one'));
  console.log(dim('  /tools        list built-in and custom tools (with descriptions)'));
  console.log(dim('  /delete <n>   delete a custom tool'));
  console.log(dim('  /skills       list saved skills'));
  console.log(dim('  /resume [id]  resume a chat — no id: pick from a list (Up/Down, Enter)'));
  console.log(dim('  /name [t]     show or set this chat\'s title'));
  console.log(dim('  /type [name]  show or set this worker\'s type'));
  console.log(dim('  /mission [t]  show or set this space\'s mission.md (/ resets to the root mission)'));
  console.log(dim('  /reset        reset this conversation'));
  console.log(dim('  /cls          clear the screen'));
  console.log(dim('  /clear        clear the context and the screen (bare "clear" also works)'));
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
    if (m.role === 'user' && typeof m.content === 'string') {
      console.log(`${cyan('you>')} ${m.content}`);
    } else if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) {
      const md = createMarkdownStream({ write: (s) => process.stdout.write(s) });
      md.push(m.content.endsWith('\n') ? m.content : `${m.content}\n`);
      md.flush();
    }
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
  async function cleanup({ gc = true } = {}) {
    busy.stop();
    autosave({ onlyIfUsed: true });
    // Occasionally review the tools at end of run — only when there are obvious
    // candidates (probe/tmp/dbg/parked/experiment/deprecated), so a normal exit
    // costs nothing. Never block shutdown on it.
    if (gc && (process.env.MICRODOT_GC ?? 'true') !== 'false') {
      try {
        const r = await runToolGc({ quiet: true });
        if (r) console.log(dim(`tool gc: reviewed ${r.reviewed} tool(s); trash holds ${r.trashed}`));
      } catch {
        /* ignore */
      }
    }
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

  // Ctrl-C does nothing when idle (so a stray Ctrl-C/"copy" can't hurt).
  // Only while a turn is running: first press warns, a second within EXIT_MS
  // stops everything. Exit when idle with /exit.
  const EXIT_MS = Math.max(200, Number(process.env.MICRODOT_EXIT_CONFIRM_MS ?? 1000) || 1000);
  let lastInterrupt = 0;
  function handleInterrupt() {
    if (!activeAbort) return; // idle → ignore Ctrl-C entirely
    const now = Date.now();
    if (now - lastInterrupt < EXIT_MS) {
      console.log(dim('\n(exiting)'));
      cleanup({ gc: false }).finally(() => process.exit(0));
      return;
    }
    lastInterrupt = now;
    console.log(dim('\n(Press Ctrl-C again to stop)'));
  }
  onInterrupt = handleInterrupt;
  process.on('SIGINT', handleInterrupt);
  // Conversation state (persisted so it can be resumed later).
  const chat = { id: newChatId(), title: '', agent: agentName, type: workerType, space: `spaces/${agentName}`, cwd: process.env.MICRODOT_LAUNCH_DIR || process.cwd(), model, createdAt: Date.now(), updatedAt: Date.now(), messages: [], refs: [] };
  function autosave({ onlyIfUsed = false } = {}) {
    chat.messages = messages;
    // Don't persist a chat that was never actually used (no user turn) — that
    // would create spurious blank "contexts" that then look like the newest.
    if (onlyIfUsed && !messages.some((m) => m.role === 'user')) return;
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
      chat.refs = Array.isArray(c.refs) ? c.refs : [];
      setReferences(chat.refs);
      SYSTEM = buildSystem({ space: spacePath, type: workerType, mission });
      messages = [{ role: 'system', content: SYSTEM }, ...(c.messages || []).slice(1)];
      console.log(dim(`resumed "${c.title || c.id}" (${messages.length - 1} messages)`));
      renderHistory(messages);
    } catch (e) {
      console.error(red(`resume failed: ${e?.message ?? e}`));
    }
  }

  // Rebuild the system prompt (e.g. after the reference list changes).
  function refreshSystem() {
    SYSTEM = buildSystem({ space: spacePath, type: workerType, mission });
    messages[0] = { role: 'system', content: SYSTEM };
  }
  function addRefToChat(p) {
    try {
      const r = addReference(p);
      const known = chat.refs.includes(r.host);
      if (!known) chat.refs.push(r.host);
      setReferences(chat.refs);
      refreshSystem();
      autosave({ onlyIfUsed: true });
      console.log(dim(`${known ? 'already referenced' : 'reference added'}: ${r.host}  (sandbox: ${r.sandbox})`));
    } catch (e) {
      console.log(red(`  ${e.message}`));
    }
  }

  // Ask the model to review the tools it built and clean up the set. Trash is
  // reversible; unsure → trash. `quiet` skips obvious-noise-free sessions and
  // suppresses the spinner (used at end of run).
  async function runToolGc({ quiet = false } = {}) {
    const inv = await tools.execute('gc_scan', {});
    if (!inv.tools.length) return null;
    const candidates = inv.tools.filter(
      (t) => t.parked || /^(dbg_|tmp_|prb_)/i.test(t.name) || ['experiment', 'deprecated'].includes(t.status),
    );
    if (quiet && !candidates.length) return null;
    const brief = inv.tools.map(({ name, project, description, status, parked, ageDays, bytes }) => ({
      name,
      project,
      description,
      status: status || undefined,
      parked,
      ageDays,
      bytes,
    }));
    const reviewTools = {
      definitions: tools.definitions.filter((d) => ['gc_scan', 'trash_tool', 'park_tool'].includes(d.function?.name)),
      execute: (name, a) => tools.execute(name, a),
    };
    if (!quiet) busy.start('gc: reviewing tools');
    let answer = '';
    try {
      answer = await runAgent({
        messages: [
          {
            role: 'system',
            content:
              "You maintain MicroDot's custom tool set. Use gc_scan, trash_tool and park_tool only. Be conservative: trash rather than guess, and always give a short reason.",
          },
          {
            role: 'user',
            content:
              'Review these custom tools and clean up the set.\n' +
              'Keep tools that are useful, working and not superseded. Trash tools that are temporary, probes/debug, broken, or old versions superseded by a newer working tool. If unsure, trash it (the trash is reversible). Never touch built-ins or shipped tools — only the listed ones. Call trash_tool or park_tool with a reason, then reply with a one-line summary per tool.\n\n' +
              JSON.stringify(brief, null, 2),
          },
        ],
        tools: reviewTools,
        model,
        apiKey,
        baseUrl,
        textLimit,
        maxSteps: 8,
        onToken: () => {},
        onTool: quiet
          ? undefined
          : (kind, name) => {
              if (kind === 'call') busy.set(`gc: ${name}`);
            },
      });
    } finally {
      if (!quiet) busy.stop();
    }
    await reloadTools();
    return { answer, reviewed: inv.tools.length, trashed: listTrash().length };
  }

  // Rebuild the live tool list (after GC trashes/parks or restores a tool).
  async function reloadTools() {
    tools = await createTools({
      host,
      agentId: agentName,
      textLimit,
      delegate: allowSpawn ? makeDelegate({ parentSpace: spacePath, depth: 0 }) : undefined,
    });
  }

  // Switch the active project and re-init the session for it. `null` means the
  // root (no project) layer. `fresh` starts a clean chat; otherwise the layer's
  // most recent chat is resumed.
  async function loadProject(name = null, { fresh = false } = {}) {
    autosave({ onlyIfUsed: true });
    if (name) setCurrentProject(name);
    else clearCurrentProject();
    ensureProject();
    spacePath = ensureSpace(agentName);
    mission = readMission(agentName).trim();
    workerType = (process.env.MICRODOT_WORKER_TYPE || '').trim() || getSpaceType(agentName) || 'default';
    setSpaceType(agentName, workerType);
    chat.refs = [];
    setReferences([]);
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
        chat.refs = Array.isArray(c.refs) ? c.refs : [];
        setReferences(chat.refs);
        SYSTEM = buildSystem({ space: spacePath, type: workerType, mission });
        messages = [{ role: 'system', content: SYSTEM }, ...(c.messages || []).slice(1)];
        console.log(dim(`resumed "${c.title || c.id}" (${messages.length - 1} messages)`));
        renderHistory(messages);
      }
    }
    autosave({ onlyIfUsed: true });
    console.log(
      name
        ? `${cyan('project')} ${green(name)} ${dim(`· space spaces/${agentName} · type`)} ${magenta(workerType)} ${dim(`· ${listChats().length} chat(s)`)}`
        : `${cyan('root (no project)')} ${dim(`· space spaces/${agentName} · type`)} ${magenta(workerType)} ${dim(`· ${listChats().length} chat(s)`)}`,
    );
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
    const ac = new AbortController();
    activeAbort = ac;
    busy.start('thinking');
    try {
      const result = await runAgent({
        messages,
        tools,
        model,
        apiKey,
        baseUrl,
        textLimit,
        maxSteps,
        signal: ac.signal,
        onToken: (t) => {
          if (!VERBOSE) busy.stop();
          md.push(t);
        },
        onTool: rootOnTool,
        confirm: confirmCreate,
        compact: compactFor(spacePath, 0),
      });
      if (typeof result === 'string' && result.startsWith('(stopped') && !ac.signal.aborted) {
        console.log(dim(`\n${result}`));
      }
    } catch (e) {
      busy.stop();
      md.flush();
      if (!ac.signal.aborted) console.error(`\n${red('error:')} ${e?.message ?? e}`);
    }
    if (ac.signal.aborted) console.log(dim('\n(interrupted)'));
    md.flush();
    busy.stop();
    process.stdout.write('\n');
    autosave();
    activeAbort = null;
  }

  if (once) {
    if (!prompt) {
      console.error(red('usage: microdot --prompt "your task"'));
      process.exit(1);
    }
    await turn(prompt);
    await cleanup();
    input.close();
    return;
  }

  console.log(
    cyan('MicroDot') +
      dim(' · agent=') +
      bold(agentName) +
      dim(' · type=') +
      magenta(workerType) +
      dim(` · space=spaces/${agentName} · chat=${chat.id}`) +
      dim(' · model=') +
      bold(model) +
      dim(
        ` · browser=${headless ? 'headless' : 'headful'}${allowSpawn ? ` · spawn=on(${maxDepth}/${maxAgents})` : ''} shared via ${host.cdpUrl}`,
      ),
  );
  help();
  while (true) {
    const line = (await ask(cyan(`\n${agentName}@you> `))).trim();
    if (!line) continue;
    if (line === '/exit' || line === '/quit' || line === 'exit' || line === 'quit') break;
    if (line === '/help') {
      help();
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
    if (line === '/gc') {
      let r;
      try {
        r = await runToolGc();
      } catch (e) {
        console.log(red(`  gc failed: ${e?.message ?? e}`));
        continue;
      }
      if (!r) {
        console.log(dim('no custom tools to review'));
        continue;
      }
      if (r.answer && r.answer.trim()) console.log(r.answer.trim());
      console.log(dim(`trash holds ${r.trashed} tool(s) — /trash to review, /trash restore <name> to undo`));
      continue;
    }
    if (line === '/trash') {
      const list = listTrash();
      if (!list.length) console.log(dim('trash is empty'));
      else {
        console.log(cyan('trashed tools:'));
        for (const e of list) console.log(`  ${green(e.name)}  ${dim(`${e.project} · ${e.reason || 'no reason'} · ${e.at}`)}`);
        console.log(dim('restore: /trash restore <name>   empty: /trash empty'));
      }
      continue;
    }
    if (line === '/trash empty') {
      const r = emptyTrash();
      console.log(dim(`emptied trash (${r.emptied} file(s))`));
      continue;
    }
    if (line.startsWith('/trash restore ')) {
      const key = line.slice(15).trim();
      try {
        const r = restoreTrash(key);
        await reloadTools();
        console.log(dim(`restored ${r.restored} → ${r.to}`));
      } catch (e) {
        console.log(red(`  ${e.message}`));
      }
      continue;
    }
    if (line === '/ref' || line.startsWith('/ref ')) {
      const arg = line.slice(4).trim();
      if (!arg) console.log(dim('usage: /ref <path>   (or drop a file into the prompt)'));
      else for (const p of parsePaths(arg)) addRefToChat(p);
      continue;
    }
    if (line === '/refs') {
      const list = listReferences();
      if (!list.length) console.log(dim('no reference files — add one with /ref <path>'));
      else {
        console.log(cyan('references (read-only):'));
        for (const r of list) console.log(`  ${green(r.path)}  ${dim(`(sandbox: ${r.sandbox})`)}`);
      }
      continue;
    }
    if (line === '/unref' || line.startsWith('/unref ')) {
      const arg = line.slice(6).trim();
      if (!arg) console.log(dim('usage: /unref <path | all>'));
      else {
        const n = removeReference(arg);
        chat.refs = referencePaths();
        setReferences(chat.refs);
        refreshSystem();
        autosave({ onlyIfUsed: true });
        console.log(dim(n ? `removed ${n} reference(s)` : `no matching reference for "${arg}"`));
      }
      continue;
    }
    if (line === '/tools') {
      const { builtin, custom, byProject } = await tools.execute('list_tools', {});
      console.log(cyan('built-in:'));
      for (const t of builtin) console.log(`  ${bold(t.name)}${dim(` — ${(t.description || '').slice(0, 96)}`)}`);
      if (byProject) {
        // Root (no project): cross-project view — project name, then its tools.
        console.log(cyan('custom — by project:'));
        for (const g of byProject) {
          const label = g.name.startsWith('engine')
            ? magenta(g.name)
            : g.name.startsWith('root')
              ? blue(g.name)
              : green(g.name);
          console.log(`  ${label} ${dim(`(${g.tools.length})`)}`);
          for (const n of g.tools) console.log(`    ${n}`);
        }
      } else {
        console.log(cyan(`custom (${custom.length}):`));
        for (const t of custom) console.log(`  ${bold(t.name)} ${dim(`[${t.backend}] — ${(t.description || '').slice(0, 88)}`)}`);
      }
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
        console.log(red(`  ${e?.message ?? e}`));
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
      } else if (text === '/') {
        const file = resetMission(agentName);
        mission = readMission(agentName).trim();
        messages[0] = { role: 'system', content: buildSystem({ space: spacePath, type: workerType, mission }) };
        console.log(dim(`mission reset to the root mission: ${file}`));
      } else {
        const file = writeMission(agentName, text);
        mission = text;
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
          console.log(red(`  no worker type "${name}" in ./worker-types/`));
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
        if (!list.length) {
          console.log(dim('no saved chats yet'));
          continue;
        }
        let pick = null;
        if (input.interactive) {
          const items = list.slice(0, 40).map((c) => ({
            label: `${(c.title || c.id).slice(0, 60)}  · ${new Date(c.updatedAt).toLocaleString()} · ${c.count} msgs`,
            value: c.id,
          }));
          pick = await input.choose('resume which chat?  (Up/Down · Enter · Esc cancels)', items);
          if (!pick) {
            console.log(dim('resume cancelled'));
            continue;
          }
        } else {
          console.log(dim('saved chats (newest first):'));
          for (const c of list.slice(0, 20)) {
            console.log(`  ${cyan(c.id)}  ${dim(`${new Date(c.updatedAt).toLocaleString()} · ${c.count} msgs · ${c.agent} · ${c.title || ''}`)}`);
          }
          console.log(dim('resume with: /resume <id>'));
          continue;
        }
        try {
          const c = loadChat(pick);
          chat.id = c.id;
          chat.title = c.title || '';
          messages = [{ role: 'system', content: SYSTEM }, ...(c.messages || []).slice(1)];
          console.log(dim(`resumed "${c.title || c.id}" (${messages.length - 1} messages)`));
          renderHistory(messages);
        } catch (e) {
          console.log(red(`  ${e?.message ?? e}`));
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
          console.log(red(`  ${e?.message ?? e}`));
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
        const list = listProjects();
        if (!list.length) {
          console.log(dim('no projects yet — create one with: /project new <name>'));
          continue;
        }
        if (input.interactive) {
          const items = list.map((p) => ({
            label: `${p.name}${p.name === cur ? '  (current)' : ''}  · ${p.chats} chat(s) · ${new Date(p.updatedAt).toLocaleString()}`,
            value: p.name,
          }));
          // A selectable entry for the root (no project) layer.
          items.unshift({ label: `(root — no project, generic)${cur ? '' : '  (current)'}`, value: '__root__' });
          const pick = await input.choose('project?  (Up/Down · Enter resumes it · Esc cancels)', items);
          if (!pick) {
            console.log(dim('(unchanged)'));
            continue;
          }
          const target = pick === '__root__' ? null : pick;
          if (target !== (cur || null)) console.log(dim(`loading ${target ? `"${target}"` : 'the root (no project)'}…`));
          try {
            await loadProject(target, { fresh: false });
          } catch (e) {
            console.log(red(`  ${e?.message ?? e}`));
          }
          continue;
        }
        console.log(`${cyan('current project:')} ${cur ? green(cur) : dim('(none — root)')}`);
        for (const p of list) console.log(`  ${p.name === cur ? cyan('*') : ' '} ${green(p.name)}  ${dim(`${p.chats} chat(s) · ${new Date(p.updatedAt).toLocaleString()}`)}`);
        console.log(dim('load: /project <name>   new: /project new <name>   delete: /project delete <name>   root: /project /'));
        continue;
      }
      if (sub === 'new') {
        if (!name) console.log(dim('usage: /project new <name>'));
        else {
          try {
            createProject(name);
            await loadProject(name, { fresh: true });
          } catch (e) {
            console.log(red(`  ${e?.message ?? e}`));
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
            console.log(red(`  ${e?.message ?? e}`));
          }
        }
        continue;
      }
      if (sub === '/' || sub === 'root') {
        try {
          await loadProject(null, { fresh: false }); // back to the root (no project)
        } catch (e) {
          console.log(red(`  ${e?.message ?? e}`));
        }
        continue;
      }
      if (!existsProject(sub)) {
        console.log(red(`  no project "${sub}" — create it with: /project new ${sub}`));
        continue;
      }
      try {
        await loadProject(sub, { fresh: false });
      } catch (e) {
        console.log(red(`  ${e?.message ?? e}`));
      }
      continue;
    }
    if (line === '/cls') {
      clearScreen();
      continue;
    }
    if (line === '/clear' || line === 'clear') {
      autosave();
      chat.id = newChatId();
      chat.title = '';
      chat.createdAt = Date.now();
      chat.refs = [];
      setReferences([]);
      SYSTEM = buildSystem({ space: spacePath, type: workerType, mission });
      messages = [{ role: 'system', content: SYSTEM }];
      clearScreen();
      console.log(dim('cleared the context and the screen (previous chat saved — /resume to reopen)'));
      continue;
    }
    if (line === '/reset') {
      autosave();
      chat.id = newChatId();
      chat.title = '';
      chat.createdAt = Date.now();
      chat.refs = [];
      setReferences([]);
      SYSTEM = buildSystem({ space: spacePath, type: workerType, mission });
      messages = [{ role: 'system', content: SYSTEM }];
      console.log(dim('started a new conversation (previous chat saved — /resume to reopen)'));
      continue;
    }
    // A dropped file path becomes a read-only reference (never its contents).
    const dropped = bareFilePaths(line);
    if (dropped) {
      for (const p of dropped) addRefToChat(p);
      continue;
    }
    await turn(line);
  }
  await cleanup();
  input.close();
}

main();
