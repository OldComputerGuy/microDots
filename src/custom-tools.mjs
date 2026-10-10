// Custom tools: MiniDot can author new tools that it (and future sessions) can call.
// Each tool is a standalone ES module written to ./tools-custom/<name>.mjs:
//   export const definition = { type:'function', function:{ name, description, parameters } };
//   export async function run(args, ctx) { ... return <json>; }
// The code runs in this Node process (full local privileges), so treat it as code.
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const customDir = () => resolve(process.cwd(), process.env.MINIDOT_TOOLS_DIR ?? 'tools-custom');

export function toolFile(dir, name) {
  return join(dir, `${name}.mjs`);
}

// Validate the name and that it does not collide with a built-in tool.
export function validateName(name, reserved) {
  if (!NAME_RE.test(name)) throw new Error('invalid tool name: use letters, digits or underscore (start with a letter/underscore)');
  if (name === 'create_tool') throw new Error('"create_tool" is reserved');
  if (reserved.has(name)) throw new Error(`"${name}" is already a built-in tool`);
}

// Syntax-check the body of run(args, ctx) before we persist it.
export function checkCode(code) {
  if (typeof code !== 'string' || !code.trim()) throw new Error('code is required');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  // throws SyntaxError on bad code; also permits `return` and top-level `await`
  new AsyncFunction('args', 'ctx', code);
}

function normaliseParameters(parameters) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new Error('parameters must be a JSON Schema object, e.g. { type:"object", properties:{...} }');
  }
  if (!parameters.type) return { type: 'object', ...parameters };
  return parameters;
}

function sourceFor({ name, description, parameters, code }) {
  const definition = { type: 'function', function: { name, description, parameters } };
  return [
    `// MiniDot custom tool "${name}" - auto-generated, safe to edit or delete.`,
    `// run() is used by the in-process backend; code is shipped to the WSL sandbox.`,
    `export const definition = ${JSON.stringify(definition, null, 2)};`,
    `export const code = ${JSON.stringify(code)};`,
    ``,
    `export async function run(args, ctx) {`,
    code,
    `}`,
    ``,
  ].join('\n');
}

export function saveTool(dir, spec) {
  mkdirSync(dir, { recursive: true });
  const file = toolFile(dir, spec.name);
  writeFileSync(file, sourceFor(spec));
  return file;
}

export async function importTool(dir, name) {
  const file = toolFile(dir, name);
  const url = `${pathToFileURL(file).href}?v=${Date.now()}`; // bust the module cache so edits take effect
  const mod = await import(url);
  if (typeof mod.run !== 'function' || !mod.definition?.function) {
    throw new Error(`tool "${name}" must export run() and definition`);
  }
  return { definition: mod.definition, run: mod.run, code: typeof mod.code === 'string' ? mod.code : null };
}

// Load every saved custom tool. Returns Map<name, { definition, run, code }>.
export async function loadCustomTools(dir = customDir()) {
  const out = new Map();
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mjs'));
  } catch {
    return out; // no folder yet
  }
  for (const f of files) {
    const name = f.replace(/\.mjs$/i, '');
    try {
      const { definition, run, code } = await importTool(dir, name);
      out.set(definition.function.name ?? name, { definition, run, code });
    } catch (e) {
      console.error(`MiniDot: could not load custom tool ${f}: ${e?.message ?? e}`);
    }
  }
  return out;
}
