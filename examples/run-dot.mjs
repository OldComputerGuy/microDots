// MicroDot as a library — minimal example.
//
//   node --env-file=.env examples/run-dot.mjs
//
// Relies on OPENROUTER_API_KEY (or an OpenRouterKey env var). Uses one Chromium
// on demand; the Dot gets its own tab and space.
import { createRuntime } from '../src/index.mjs';

const rt = await createRuntime({
  model: process.env.MICRODOT_MODEL || 'deepseek/deepseek-v4.1-flash',
  browser: 'on-demand', // 'off' for search-only Dots (no Chromium at all)
  compact: true, // keep long runs bounded
  allowSpawn: true, // sub-agents on
});

// An app-owned tool the embedding project provides.
rt.registerTool({
  name: 'app_time',
  description: 'Return the current time.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  run: async () => ({ now: new Date().toISOString() }),
});

const dot = await rt.dot('analyst', { type: 'researcher', mission: 'Answer concisely, with a source URL.' });

console.log('dot:', dot.name, '| space:', dot.space, '| type:', dot.type, '\n');
const text = await dot.run('What is the latest stable Node.js LTS version? One line plus a source.', {
  onToken: (t) => process.stdout.write(t),
  onTool: (kind, name) => {
    if (kind === 'call') process.stdout.write(`\n· ${name}\n`);
  },
});

console.log('\n\nfinal:', text);
await rt.close();
process.exit(0);
