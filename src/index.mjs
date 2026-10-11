// MicroDot — public library entry.
// Use createRuntime() to run Dots programmatically, or the CLI (src/cli.mjs).
export { createRuntime } from './runtime.mjs';
export { buildSystem, BASE_PROMPT } from './prompt.mjs';
export { createBrowserHost } from './browser-host.mjs';
export { createTools } from './tools.mjs';
export { runAgent } from './agent.mjs';
