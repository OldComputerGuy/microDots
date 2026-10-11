// Have MicroDot propose awesome-list pull requests, then apply them after review.
//
//   $env:GITHUB_TOKEN = '<token with repo scope>'
//   node scripts/launch-prs.mjs plan    # research + write launch-plan.json (opens NOTHING)
//   # ...review launch-plan.json...
//   node scripts/launch-prs.mjs apply   # open exactly the PRs in the plan
//
// Env: MAX_PRS (default 5), PLAN_FILE (default <repo>/launch-plan.json)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRuntime } from '../src/index.mjs';
import { createGithubTools } from '../src/host-tools/github.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_FILE = process.env.PLAN_FILE || resolve(here, '..', 'launch-plan.json');
const mode = (process.argv[2] || 'plan').toLowerCase();
const MAX = Number(process.env.MAX_PRS || 5);
const REPO = 'https://github.com/OldComputerGuy/microDots';

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('Set GITHUB_TOKEN (a token with repo scope) first.');
  process.exit(1);
}

const tools = createGithubTools({ token, maxPullRequests: MAX, planFile: PLAN_FILE });
const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

// --- apply: deterministic, no model -------------------------------------
if (mode === 'apply') {
  let plan;
  try {
    plan = JSON.parse(readFileSync(PLAN_FILE, 'utf8'));
  } catch {
    console.error(`No plan at ${PLAN_FILE}. Run \`node scripts/launch-prs.mjs plan\` first.`);
    process.exit(1);
  }
  console.log(`Applying ${plan.length} proposed PR(s) from ${PLAN_FILE}\n`);
  const opened = [];
  for (const entry of plan) {
    try {
      const r = await byName.github_submit_pr.run(entry);
      console.log(`✓ ${entry.upstream} -> ${r.pr_url}`);
      opened.push(r.pr_url);
    } catch (e) {
      console.log(`✗ ${entry.upstream}: ${e.message}`);
    }
  }
  console.log(`\nOpened ${opened.length}/${plan.length} PR(s).`);
  process.exit(0);
}

// --- plan: the Dot researches and PROPOSES (downloads nothing, opens nothing)
const rt = await createRuntime({ browser: 'off', compact: true, allowSpawn: true, maxSteps: 24 });
for (const t of tools) {
  if (t.name === 'github_submit_pr') {
    // Hard guarantee: plan mode can only ever validate.
    rt.registerTool({ ...t, run: (args) => t.run({ ...args, dryRun: true }) });
  } else {
    rt.registerTool(t);
  }
}

const dot = await rt.dot('launch', {
  type: 'default',
  mission: 'Propose correct awesome-list pull requests for MicroDot (proposals only).',
});

const TARGETS = `TARGETS (for each, propose ONLY if MicroDot genuinely fits a section AND the entry format is clear; otherwise skip and say why):
1. e2b-dev/awesome-ai-sdks — SDKs/frameworks/libraries for building agents. Find the best-fitting section and match its exact entry format.
2. e2b-dev/awesome-ai-agents — NOTE: this uses a multi-line block format (## [Name](url) + Category/Description/Features/Links subsections); propose only if a single well-formed block can be built, otherwise skip.
3. kyrolabs/awesome-langchain — the "Other LLM Frameworks" section; match its exact entry format.
4. webfuse-com/awesome-autoresearch — autonomous/self-improving agents; propose only if a section genuinely fits.
5. WenyuChiou/awesome-agentic-ai-zh — match its exact (trilingual) format.
6. bradAGI/awesome-cli-coding-agents — CLI agent harnesses; MicroDot is a CLI agent but is NOT a coding agent, so propose only if the scope truly fits, else skip.`;

const task = `Your job: propose pull requests that add MicroDot to curated "awesome" lists. You are proposing ONLY — github_submit_pr is forced to validate, so nothing is submitted.

MicroDot: ${REPO} — a tiny, self-hosted AI agent with its own browser tab (one process, one shared Chromium, a tab per agent). It writes its own tools (sandboxed), spawns sub-agents, and keeps state in plain files. MIT, plain Node. Do NOT research MicroDot — everything you need is here.

Use ONLY these tools: github_find_lines, github_read_file (small files only), github_submit_pr. Do NOT create tools. Do NOT read your space. Do NOT use web_search.

Entry line (adapt to each list's punctuation, link style and format):
- [MicroDot](${REPO}) - A tiny, self-hosted AI agent with its own browser tab; writes its own tools, spawns sub-agents, one shared Chromium, plain-file state. MIT.

${TARGETS}

Per target:
1. github_find_lines for "microdot" to confirm it isn't already listed.
2. github_find_lines for the section heading to get its exact text.
3. github_find_lines to see 2-3 existing entries and copy their exact format.
4. github_submit_pr with dryRun:true — use section + sort (or insertAfter a unique entry), your adapted line, title "Add MicroDot", and a 1-2 sentence body ending with the repo URL.

Be efficient: propose for the lists that genuinely fit, then stop. Finish with each proposed repo + section, and each skipped repo with a one-line reason.`;

const text = await dot.run(task, {
  onToken: (t) => process.stdout.write(t),
  onTool: (kind, name) => {
    if (kind === 'call') process.stdout.write(`\n· ${name}\n`);
  },
});

console.log('\n\n==== PROPOSAL SUMMARY ====\n', text);
await rt.close();

try {
  const plan = JSON.parse(readFileSync(PLAN_FILE, 'utf8'));
  console.log(`\nWrote ${plan.length} proposal(s) to ${PLAN_FILE}:`);
  for (const e of plan) console.log(`  • ${e.upstream} (${e.path})${e.section ? ` [section: ${e.section}${e.sort ? ', sorted' : ''}]` : e.insertAfter ? ` [after: ${e.insertAfter}]` : ''}`);
  console.log(`\nReview it, then run:  node scripts/launch-prs.mjs apply`);
} catch {
  console.log('\nNo proposals were recorded.');
}
process.exit(0);
