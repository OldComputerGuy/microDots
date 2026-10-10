// MiniDot CLI: one agent per process, all attached to one shared Chromium.
// `/new` opens a new terminal (a new agent).
import readline from 'node:readline';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { createBrowserHost } from './browser-host.mjs';
import { createTools, openPath, pruneScreenshots } from './tools.mjs';
import { runAgent } from './agent.mjs';
import { createMarkdownStream } from './markdown.mjs';
import { stopSandboxWorker } from './tool-sandbox.mjs';
import { listSkills } from './skills.mjs';

const apiKey = process.env.OPENROUTER_API_KEY || process.env.OpenRouterKey;
const baseUrl = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const model = process.env.MINIDOT_MODEL ?? 'deepseek/deepseek-v4.1-flash';
const headless = (process.env.MINIDOT_HEADLESS ?? 'true') !== 'false';
const isolate = (process.env.MINIDOT_ISOLATE_AGENTS ?? 'false') === 'true';
const textLimit = Number(process.env.MINIDOT_TEXT_LIMIT ?? 32768);
const maxSteps = Number(process.env.MINIDOT_MAX_STEPS ?? 12);
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

const skillList = listSkills();
const SKILLS_SECTION = skillList.length
  ? `\n\nSaved skills (call read_skill to load one, then follow its steps):\n${skillList
      .map((s) => `- ${s.name}: ${s.description}`)
      .join('\n')}`
  : '';
const SYSTEM = SYSTEM_BASE + SKILLS_SECTION;

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

function onTool(kind, name, data) {
  if (kind === 'call') console.log(dim(`  → ${name} ${Object.keys(data).length ? JSON.stringify(data) : ''}`));
  else {
    const s = JSON.stringify(data);
    console.log(dim(`  ← ${name} ${s.length > 220 ? s.slice(0, 220) + '…' : s}`));
  }
}

function spawnAgentTerminal(name) {
  const env = { ...process.env };
  env.MINIDOT_AGENT = name || `agent-${Date.now().toString(36)}`;
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
  console.log(dim('  /new [name]   open a new MiniDot CLI (a new agent, own tab)'));
  console.log(dim('  /tools        list built-in and custom tools (with descriptions)'));
  console.log(dim('  /delete <n>   delete a custom tool'));
  console.log(dim('  /skills       list saved skills'));
  console.log(dim('  /reset        reset this conversation'));
  console.log(dim('  /shots        open the latest screenshot'));
  console.log(dim('  /help /exit'));
}

async function main() {
  const argv = process.argv.slice(2);
  const pi = argv.indexOf('--prompt');
  const once = argv.includes('--once') || pi >= 0;
  const prompt = pi >= 0 ? argv.slice(pi + 1).join(' ') : argv.filter((a) => a !== '--once').join(' ').trim();

  const host = await createBrowserHost({ headless, isolate });
  const tools = await createTools({ host, agentId: agentName, textLimit });
  pruneScreenshots(Number(process.env.MINIDOT_SHOT_KEEP ?? 10) || 10);
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
    await host.close();
    stopSandboxWorker();
    rl.close();
    return;
  }

  console.log(cyan('MiniDot') + dim(` · agent="${agentName}" · model=${model} · browser=${headless ? 'headless' : 'headful'} shared via ${host.cdpUrl}`));
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
      const given = line.slice(4).trim();
      const spawned = spawnAgentTerminal(given);
      console.log(dim(`opened a new MiniDot CLI window (agent "${spawned}") — it attaches to the same shared Chromium`));
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
    if (line === '/shots') {
      const dir = resolve(process.cwd(), 'screenshots');
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
  await host.close();
  stopSandboxWorker();
  rl.close();
}

main();
