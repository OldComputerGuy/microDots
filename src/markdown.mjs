// Tiny streaming markdown → ANSI renderer for the terminal.
// Line-buffered so it works with token streaming without flicker.
const R = '\x1b[0m';
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

export function createMarkdownStream({ write }) {
  let buf = '';
  let inCode = false;
  let codeLang = '';

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

  function push(chunk) {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      renderLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  function flush() {
    if (buf) {
      renderLine(buf);
      buf = '';
    }
    if (inCode) {
      inCode = false;
      write(dim('└' + '─'.repeat(49)) + '\n');
    }
  }
  function reset() {
    buf = '';
    inCode = false;
    codeLang = '';
  }
  return { push, flush, reset };
}
