// Custom tools: MicroDot can author new tools that it (and future sessions) can call.
// Each tool is a standalone ES module:
//   export const definition = { type:'function', function:{ name, description, parameters } };
//   export const code = "...";          // shipped to the sandbox
//   export async function run(args, ctx) { ... return <json>; }
//
// Layered: engine tools (<install>/tools-custom) are shared; project tools
// (<project>/.microdot/tools) override them by name. New tools are written to
// the project layer.
import { readdirSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { layerDirs, writeDir } from './home.mjs';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const dirs = () => layerDirs('MICRODOT_TOOLS_DIR', 'tools-custom', 'tools');

export const customDir = () => writeDir('MICRODOT_TOOLS_DIR', 'tools-custom', 'tools');
export function toolFile(name, dir = customDir()) {
  return join(dir, `${name}.mjs`);
}

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

// Static scan for capabilities a tool shouldn't quietly exercise (reads keys,
// network, code exec, escaping the space). Used to gate approval.
const RISK_PATTERNS = [
  ['child_process', /child_process/],
  ['require()', /\brequire\s*\(/],
  ['dynamic import', /\bimport\s*\(/],
  ['process', /\bprocess\b/],
  ['direct fs', /node:fs\b|(?<![.\w])fs\.(readFile|writeFile|readdir|rm|unlink|mkdir|stat|appendFile|cp|rename)/],
  ['direct fetch', /(?<![.\w])fetch\s*\(/],
  ['network module', /node:(net|http|https|dns|tls)\b/],
  ['absolute path', /["']\/(?!\/)/],
  ['path traversal', /\.\.\//],
  ['eval/Function', /\beval\s*\(|new\s+Function/],
];

export function scanToolCode(code) {
  const s = String(code || '');
  return RISK_PATTERNS.filter(([, re]) => re.test(s)).map(([label]) => label);
}

function sourceFor({ name, description, parameters, code }) {
  const definition = { type: 'function', function: { name, description, parameters } };
  return [
    `// MicroDot custom tool "${name}" - auto-generated, safe to edit or delete.`,
    `// run() is used by the in-process backend; code is shipped to the sandbox.`,
    `export const definition = ${JSON.stringify(definition, null, 2)};`,
    `export const code = ${JSON.stringify(code)};`,
    ``,
    `export async function run(args, ctx) {`,
    code,
    `}`,
    ``,
  ].join('\n');
}

export function saveTool(spec, dir = customDir()) {
  mkdirSync(dir, { recursive: true });
  const file = toolFile(spec.name, dir);
  writeFileSync(file, sourceFor(spec));
  return file;
}

export function deleteTool(name) {
  let removed = null;
  for (const dir of dirs()) {
    const file = toolFile(name, dir);
    if (existsSync(file)) {
      rmSync(file, { force: true });
      removed = file;
    }
  }
  return removed;
}

async function importFile(file) {
  const url = `${pathToFileURL(file).href}?v=${Date.now()}`;
  const mod = await import(url);
  if (typeof mod.run !== 'function' || !mod.definition?.function) {
    throw new Error(`tool at ${file} must export run() and definition`);
  }
  return { definition: mod.definition, run: mod.run, code: typeof mod.code === 'string' ? mod.code : null };
}

// Search layers project-first.
function findToolFile(name) {
  for (const dir of [...dirs()].reverse()) {
    const file = toolFile(name, dir);
    if (existsSync(file)) return file;
  }
  return null;
}

export async function importTool(name) {
  const file = findToolFile(name);
  if (!file) throw new Error(`tool "${name}" not found`);
  return importFile(file);
}

// Load every saved custom tool across layers (project overrides engine).
export async function loadCustomTools() {
  const out = new Map();
  for (const dir of dirs()) {
    let files = [];
    try {
      files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mjs'));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const { definition, run, code } = await importFile(join(dir, f));
        out.set(definition.function.name ?? f.replace(/\.mjs$/i, ''), { definition, run, code });
      } catch (e) {
        console.error(`MicroDot: could not load custom tool ${f}: ${e?.message ?? e}`);
      }
    }
  }
  return out;
}
