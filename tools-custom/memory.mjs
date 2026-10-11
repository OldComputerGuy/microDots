// MiniDot custom tool "memory" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "memory",
    "description": "Persistent long-term memory for the agent. Save important facts/notes and retrieve them later. Actions: 'save' (store a memory with optional tags), 'list' (show recent memories), 'search' (keyword/tag match), 'delete' (by id), 'clear' (wipe all). Memories persist across sessions in memory.json.",
    "parameters": {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "save",
            "list",
            "search",
            "delete",
            "clear"
          ],
          "description": "Operation to perform"
        },
        "text": {
          "type": "string",
          "description": "Memory text to store (for 'save')"
        },
        "tags": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Optional tags/labels for the memory (for 'save')"
        },
        "query": {
          "type": "string",
          "description": "Keyword to search for (for 'search')"
        },
        "id": {
          "type": "string",
          "description": "Memory id to delete (for 'delete')"
        },
        "limit": {
          "type": "integer",
          "description": "Max results for list/search (default 20)"
        }
      },
      "required": [
        "action"
      ]
    }
  }
};
export const code = "const FILE = 'memory.json';\nconst fs = ctx.fs;\nif (!fs) throw new Error('No filesystem available in this backend');\n\nasync function load() {\n  try {\n    const raw = await fs.readFile(FILE, 'utf8');\n    const data = JSON.parse(raw);\n    return Array.isArray(data) ? data : [];\n  } catch (e) {\n    return [];\n  }\n}\nasync function save(mems) {\n  await fs.writeFile(FILE, JSON.stringify(mems, null, 2));\n}\nfunction mkid() {\n  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);\n}\n\nconst action = String(args.action || 'list').toLowerCase();\nconst limit = typeof args.limit === 'number' ? args.limit : 20;\nlet mems = await load();\n\nif (action === 'save') {\n  if (!args.text || !String(args.text).trim()) throw new Error(\"'text' is required for save\");\n  const entry = {\n    id: mkid(),\n    text: String(args.text).trim(),\n    tags: Array.isArray(args.tags) ? args.tags.map(String) : [],\n    created: new Date().toISOString(),\n  };\n  mems.push(entry);\n  await save(mems);\n  return { ok: true, action: 'save', saved: entry, total: mems.length };\n}\n\nif (action === 'list') {\n  const recent = mems.slice(-limit).reverse();\n  return { ok: true, action: 'list', count: mems.length, memories: recent };\n}\n\nif (action === 'search') {\n  const q = String(args.query || '').toLowerCase();\n  if (!q) throw new Error(\"'query' is required for search\");\n  const hits = mems.filter(m =>\n    m.text.toLowerCase().includes(q) ||\n    (m.tags || []).some(t => t.toLowerCase().includes(q))\n  ).slice(-limit).reverse();\n  return { ok: true, action: 'search', query: args.query, matchCount: hits.length, memories: hits };\n}\n\nif (action === 'delete') {\n  if (!args.id) throw new Error(\"'id' is required for delete\");\n  const before = mems.length;\n  mems = mems.filter(m => m.id !== args.id);\n  await save(mems);\n  return { ok: true, action: 'delete', id: args.id, deleted: before - mems.length, total: mems.length };\n}\n\nif (action === 'clear') {\n  const n = mems.length;\n  await save([]);\n  return { ok: true, action: 'clear', cleared: n };\n}\n\nreturn { ok: false, error: 'Unknown action: ' + action };\n";

export async function run(args, ctx) {
const FILE = 'memory.json';
const fs = ctx.fs;
if (!fs) throw new Error('No filesystem available in this backend');

async function load() {
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}
async function save(mems) {
  await fs.writeFile(FILE, JSON.stringify(mems, null, 2));
}
function mkid() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

const action = String(args.action || 'list').toLowerCase();
const limit = typeof args.limit === 'number' ? args.limit : 20;
let mems = await load();

if (action === 'save') {
  if (!args.text || !String(args.text).trim()) throw new Error("'text' is required for save");
  const entry = {
    id: mkid(),
    text: String(args.text).trim(),
    tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
    created: new Date().toISOString(),
  };
  mems.push(entry);
  await save(mems);
  return { ok: true, action: 'save', saved: entry, total: mems.length };
}

if (action === 'list') {
  const recent = mems.slice(-limit).reverse();
  return { ok: true, action: 'list', count: mems.length, memories: recent };
}

if (action === 'search') {
  const q = String(args.query || '').toLowerCase();
  if (!q) throw new Error("'query' is required for search");
  const hits = mems.filter(m =>
    m.text.toLowerCase().includes(q) ||
    (m.tags || []).some(t => t.toLowerCase().includes(q))
  ).slice(-limit).reverse();
  return { ok: true, action: 'search', query: args.query, matchCount: hits.length, memories: hits };
}

if (action === 'delete') {
  if (!args.id) throw new Error("'id' is required for delete");
  const before = mems.length;
  mems = mems.filter(m => m.id !== args.id);
  await save(mems);
  return { ok: true, action: 'delete', id: args.id, deleted: before - mems.length, total: mems.length };
}

if (action === 'clear') {
  const n = mems.length;
  await save([]);
  return { ok: true, action: 'clear', cleared: n };
}

return { ok: false, error: 'Unknown action: ' + action };

}
