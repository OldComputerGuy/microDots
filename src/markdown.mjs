// Tiny streaming markdown → ANSI renderer for the terminal.
// Line-buffered so it works with token streaming without flicker.
const b = (s) => `\x1b[1m${s}\x1b[22m`;
const i = (s) => `\x1b[3m${s}\x1b[23m`;
const u = (s) => `\x1b[4m${s}\x1b[24m`;
const dim = (s) => `\x1b[2m${s}\x1b[22m`;
const red = (s) => `\x1b[31m${s}\x1b[39m`;
const grn = (s) => `\x1b[32m${s}\x1b[39m`;
const yel = (s) => `\x1b[33m${s}\x1b[39m`;
const blu = (s) => `\x1b[34m${s}\x1b[39m`;
const mag = (s) => `\x1b[35m${s}\x1b[39m`;
const cyn = (s) => `\x1b[36m${s}\x1b[39m`;

const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

function inline(s) {
  let out = s;
  // links: [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, url) => `${u(t)}${dim(` (${url})`)}`);
  // bold
  out = out.replace(/\*\*([^*]+)\*\*/g, (_, t) => b(t));
  out = out.replace(/__([^_]+)__/g, (_, t) => b(t));
  // inline code
  out = out.replace(/`([^`]+)`/g, (_, t) => yel(t));
  // italic (avoid touching the inside of words)
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*/g, (_, p, t) => `${p}${i(t)}`);
  return out;
}

const headingFns = [mag, cyn, blu, grn, yel, red];

// --- tables ---
const looksTableRow = (line) => /^\s*\|/.test(line) || line.split('|').length >= 3;
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}
const isSeparator = (line) => {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
};

// Render a header + rows as a boxed table, padding each column to its widest cell.
function renderTable(header, body) {
  const cols = Math.max(header.length, ...body.map((r) => r.length), 1);
  const norm = (r) => Array.from({ length: cols }, (_, i) => String(r[i] ?? '').trim());
  const rendered = [norm(header), ...body.map(norm)].map((cells) => cells.map((c) => inline(c)));
  const widths = Array.from({ length: cols }, (_, i) => Math.max(1, ...rendered.map((r) => stripAnsi(r[i]).length)));
  const pad = (s, w) => s + ' '.repeat(Math.max(0, w - stripAnsi(s).length));
  const row = (cells) => '│ ' + cells.map((c, idx) => pad(c, widths[idx])).join(' │ ') + ' │';
  const rule = (l, m, r) => l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r;
  return [
    dim(rule('┌', '┬', '┐')),
    row(rendered[0].map((c) => b(c))),
    dim(rule('├', '┼', '┤')),
    ...rendered.slice(1).map((cells) => row(cells)),
    dim(rule('└', '┴', '┘')),
  ].join('\n');
}

export function createMarkdownStream({ write }) {
  let buf = '';
  let inCode = false;
  let codeLang = '';
  let inTable = false;
  let tableRows = [];

  function renderLine(line) {
    const trimmed = line.trimStart();
    const fence = trimmed.match(/^```\s*([\w+-]*)\s*$/);
    if (fence) {
      if (!inCode) {
        inCode = true;
        codeLang = fence[1] || '';
        write(dim(`┌─${codeLang ? ` ${codeLang} ` : ''}${'─'.repeat(Math.max(0, 46 - codeLang.length))}`) + '\n');
      } else {
        inCode = false;
        codeLang = '';
        write(dim('└' + '─'.repeat(49)) + '\n');
      }
      return;
    }
    if (inCode) {
      write(dim('│ ') + cyn(line) + '\n');
      return;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      write(dim('─'.repeat(60)) + '\n');
      return;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = Math.min(h[1].length, 6);
      write(headingFns[lvl - 1](b(h[2])) + '\n');
      return;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      write(dim('│ ') + i(inline(quote[1])) + '\n');
      return;
    }
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bullet) {
      write(`${bullet[1]}${cyn('•')} ${inline(bullet[2])}` + '\n');
      return;
    }
    const num = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (num) {
      write(`${num[1]}${cyn(num[2] + '.')} ${inline(num[3])}` + '\n');
      return;
    }
    write(inline(line) + '\n');
  }

  // Buffer consecutive table-looking lines, then render (or print raw if it
  // isn't actually a table — no separator row).
  function flushTable() {
    const rows = tableRows;
    inTable = false;
    tableRows = [];
    if (rows.length >= 2 && isSeparator(rows[1])) {
      const header = splitRow(rows[0]);
      const body = rows.slice(2).map(splitRow).filter((r) => r.some((c) => c !== ''));
      write(renderTable(header, body) + '\n');
    } else {
      for (const r of rows) renderLine(r);
    }
  }

  function handleLine(line) {
    if (inCode) {
      renderLine(line);
      return;
    }
    if (looksTableRow(line) && line.trim() !== '' && line.trim() !== '|') {
      if (!inTable) {
        inTable = true;
        tableRows = [];
      }
      tableRows.push(line);
      return;
    }
    if (inTable) flushTable();
    renderLine(line);
  }

  function push(chunk) {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      handleLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  function flush() {
    if (buf) {
      handleLine(buf);
      buf = '';
    }
    if (inTable) flushTable();
    if (inCode) {
      inCode = false;
      write(dim('└' + '─'.repeat(49)) + '\n');
    }
  }
  function reset() {
    buf = '';
    inCode = false;
    codeLang = '';
    inTable = false;
    tableRows = [];
  }
  return { push, flush, reset };
}
