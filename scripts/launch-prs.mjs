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
const rt = await createRuntime({ browser: 'off', compact: true, allowSpawn: true, maxSteps: 45 });
for (const t of tools) {
  if (t.name === 'github_submit_pr') {
    // Hard guarantee: plan mode can only ever validate.
    rt.registerTool({ ...t, run: (args) => t.run({ ...args, dryRun: true }) });
  } else {
    rt.registerTool(t);
  }
}

const dot = await rt.dot('launch', {
  type: 'researcher',
  mission: 'Propose correct awesome-list pull requests for MicroDot (proposals only — nobody submits yet).',
});

const task = `Your job: research real, actively-maintained "awesome" lists and PROPOSE correct pull requests that would add MicroDot. You are proposing only — github_submit_pr is forced to validate, so nothing is submitted.

What MicroDot is: ${REPO} — a tiny, self-hosted AI agent with its own browser tab. One process, one shared Chromium, one tab per agent. It writes its own tools (sandboxed), spawns sub-agents, keeps state in plain files. MIT, plain Node.

Entry line (adapt link/punctuation style to match each list):
- [MicroDot](${REPO}) - A tiny self-hosted AI agent with its own browser tab; writes its own tools, spawns sub-agents, one shared Chromium, plain-file state. MIT.

Method:
1. github_search_repos with several queries: "awesome ai agents", "awesome llm agents", "awesome autonomous agents", "awesome ai tools". Collect the real, popular lists.
2. For each promising candidate (aim for ${MAX}):
   a. Confirm it welcomes contributions (github_list_dir / github_find_lines for CONTRIBUTING or a Contributing section). Skip lists that don't accept additions.
   b. github_find_lines for "microdot" to confirm it isn't already listed.
   c. github_find_lines for "##"/"###" to find the best section for an agent/framework.
   d. Decide placement: alphabetical section -> section + sort:true; otherwise insertAfter a unique existing entry line you saw.
   e. Call github_submit_pr with dryRun:true (the tool records your proposal and validates the anchor/section against the live file).
3. Propose ONLY where the format is clearly correct and entries are welcome. When unsure, SKIP.
4. Finish with a short list: each proposed repo + section, and each skipped repo with a one-line reason.

Be efficient: use the github_* tools only; do NOT create new tools; submit proposals rather than exploring endlessly.`;

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
