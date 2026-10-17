// Custom tools: MicroDot can author new tools that it (and future sessions) can call.
// Each tool is a standalone ES module:
//   export const definition = { type:'function', function:{ name, description, parameters } };
//   export const code = "...";          // the body of async run(args, ctx), run in the sandbox
//
// Layered: engine tools (<install>/tools-custom) are shared; project tools
// (<project>/.microdot/tools) override them by name. New tools are written to
// the project layer.
import { readdirSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { layerDirs, writeDir, projectsRoot, engineDir, dataDir } from './home.mjs';
import { validProjectName } from './projects.mjs';

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

function sourceFor({ name, description, parameters, code, status }) {
  const definition = { type: 'function', function: { name, description, parameters } };
  const lines = [
    `// MicroDot custom tool "${name}" - auto-generated, safe to edit or delete.`,
    `// The code below runs ONLY in the isolated Linux sandbox worker (WSL on Windows).`,
  ];
  if (status) lines.push(`// meta: ${JSON.stringify({ status })}`);
  lines.push(`export const definition = ${JSON.stringify(definition, null, 2)};`);
  lines.push(`export const code = ${JSON.stringify(code)};`);
  lines.push('');
  return lines.join('\n');
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

// The tools dir for a NAMED project (regardless of which project is active now).
export function projectToolDir(project) {
  return resolve(projectsRoot(), validProjectName(project), 'tools');
}

// Names of the .mjs tool files in a dir (sorted), or [] if it doesn't exist.
function listToolFiles(dir) {
  try {
    return readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.mjs'))
      .map((f) => f.replace(/\.mjs$/i, ''))
      .sort();
  } catch {
    return [];
  }
}

// Every custom tool on disk, grouped — engine (shared), the root layer, and each
// named project — for a cross-project listing when no single project is active.
export function toolsByProject() {
  const override = (process.env.MICRODOT_TOOLS_DIR || '').trim();
  const engine = listToolFiles(override ? resolve(process.cwd(), override) : resolve(engineDir(), 'tools-custom'));
  const root = listToolFiles(resolve(dataDir(), 'tools'));
  const projects = [];
  let entries = [];
  try {
    entries = readdirSync(projectsRoot(), { withFileTypes: true });
  } catch {
    /* no projects root yet */
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const tools = listToolFiles(resolve(projectsRoot(), e.name, 'tools'));
    if (tools.length) projects.push({ name: e.name, tools });
  }
  projects.sort((a, b) => a.name.localeCompare(b.name));
  return { engine, root, projects };
}

// Copy a custom tool file from one project to another. Tools are host-managed
// and per-project, so this runs on the host (exposed to the agent as the
// `copy_tool` builtin). A leading "_" (parked) name is preserved.
export function copyTool({ name, from, to, overwrite = false } = {}) {
  const tool = String(name || '').trim();
  if (!NAME_RE.test(tool)) throw new Error(`invalid tool name "${name}" — use letters, digits or underscore`);
  if (!from) throw new Error('a source project ("from") is required');
  if (!to) throw new Error('a target project ("to") is required');
  const src = join(projectToolDir(from), `${tool}.mjs`);
  const dst = join(projectToolDir(to), `${tool}.mjs`);
  if (!existsSync(src)) {
    let available = [];
    try {
      available = readdirSync(projectToolDir(from))
        .filter((f) => f.toLowerCase().endsWith('.mjs'))
        .map((f) => f.replace(/\.mjs$/i, ''));
    } catch {
      /* none */
    }
    throw new Error(
      `tool "${tool}" not found in project "${from}"${available.length ? ` (has: ${available.join(', ')})` : ' (no tools)'}`,
    );
  }
  if (existsSync(dst) && !overwrite) {
    throw new Error(`"${to}/tools/${tool}.mjs" already exists — pass overwrite:true to replace it`);
  }
  mkdirSync(projectToolDir(to), { recursive: true });
  writeFileSync(dst, readFileSync(src));
  return { copied: tool, from: String(from).trim(), to: String(to).trim(), file: dst };
}

async function importFile(file) {
  const url = `${pathToFileURL(file).href}?v=${Date.now()}`;
  const mod = await import(url);
  if (!mod.definition?.function || typeof mod.code !== 'string' || !mod.code.trim()) {
    throw new Error(`tool at ${file} must export definition and non-empty code`);
  }
  return { definition: mod.definition, code: mod.code };
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
      // Convention: a leading "_" parks a tool — the file stays on disk but is
      // not loaded (kept out of the model's tool list). Rename it to activate.
      if (f.startsWith('_')) continue;
      try {
        const { definition, code } = await importFile(join(dir, f));
        out.set(definition.function.name ?? f.replace(/\.mjs$/i, ''), { definition, code });
      } catch (e) {
        console.error(`MicroDot: could not load custom tool ${f}: ${e?.message ?? e}`);
      }
    }
  }
  return out;
}
