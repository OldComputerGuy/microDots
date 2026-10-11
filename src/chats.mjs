// Saved conversations ("chats") so a session can be resumed later.
// One JSON file per chat in ./chats/<id>.json.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Chats are stored per *project* — the directory you launched MicroDot from —
// in <launchDir>/.microdot/chats (like Codex/OpenCode keying sessions to a cwd).
const launchDir = () => process.env.MICRODOT_LAUNCH_DIR || process.cwd();

export const chatsDir = () => {
  const explicit = process.env.MICRODOT_CHATS_DIR;
  if (explicit) return resolve(launchDir(), explicit);
  return resolve(launchDir(), '.microdot', 'chats');
};
const chatFile = (dir, id) => join(dir, `${id}.json`);

export function newChatId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

export function saveChat(chat, dir = chatsDir()) {
  mkdirSync(dir, { recursive: true });
  chat.updatedAt = Date.now();
  writeFileSync(chatFile(dir, chat.id), JSON.stringify(chat));
  return chatFile(dir, chat.id);
}

export function listChats(dir = chatsDir()) {
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const c = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      out.push({ id: c.id, title: c.title, agent: c.agent, type: c.type, updatedAt: c.updatedAt || 0, count: (c.messages || []).length });
    } catch {
      /* skip corrupt */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

// Match by exact id, unique id prefix, or title (case-insensitive).
export function loadChat(idOrMatch, dir = chatsDir()) {
  const list = listChats(dir);
  const key = String(idOrMatch).trim();
  const meta =
    list.find((c) => c.id === key) ||
    list.filter((c) => c.id.startsWith(key)).sort((a, b) => b.updatedAt - a.updatedAt)[0] ||
    list.find((c) => (c.title || '').toLowerCase().includes(key.toLowerCase()));
  if (!meta) throw new Error(`no chat matching "${key}"`);
  return JSON.parse(readFileSync(join(dir, `${meta.id}.json`), 'utf8'));
}

export function deleteChat(id, dir = chatsDir()) {
  rmSync(chatFile(dir, id), { force: true });
  return chatFile(dir, id);
}
