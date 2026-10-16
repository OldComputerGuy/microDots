// Paste-aware, slash-command-aware line input.
//
// TTY: raw mode + bracketed paste. A pasted block fills the input (no submit);
// Enter runs it. When the input is a slash token (e.g. "/pro"), a live menu of
// matching commands is shown below the prompt. Up/Down (or Tab) fill the line
// with the highlighted command; Enter submits whatever is on the line.
//
// ask(prompt) resolves with the submitted text (may contain newlines).
export function createPrompt({ stdin = process.stdin, stdout = process.stdout, onEscape, onInterrupt, commands = [] } = {}) {
  const isTTY = !!stdin.isTTY;
  const DEBUG = process.env.MICRODOT_DEBUG_INPUT === '1';
  const pending = [];
  let waiter = null;
  let input = ''; // what's on the line (and what gets submitted)
  let filter = ''; // the slash token used to match commands (kept separate so
  let inPaste = false; //   navigating the menu doesn't collapse it)
  let pasteBuf = '';
  let lastPrompt = '';
  let sel = 0;
  let inputRows = 1; // rows occupied by (prompt tail + input) at the last render

  const write = (s) => {
    if (isTTY) stdout.write(s);
  };
  const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');
  const promptTail = () => lastPrompt.split('\n').pop();
  const cols = () => Math.max(20, (stdout.columns || 80) | 0);
  // Rows a set of display lines occupies, accounting for terminal wrapping.
  function rowsOf(lines, w) {
    let r = 0;
    for (const l of lines) r += Math.max(1, Math.ceil(stripAnsi(l).length / w));
    return Math.max(1, r);
  }

  // Matching slash commands for the current typed token (hidden after a space,
  // or when the token is already an exact command).
  function matches() {
    if (filter.includes('\n') || !filter.startsWith('/') || /\s/.test(filter)) return [];
    const m = commands.filter((c) => c.name.startsWith(filter));
    return m.length === 1 && m[0].name === filter ? [] : m;
  }

  function render() {
    if (!isTTY) return;
    const w = cols();
    const items = matches();
    if (sel >= items.length) sel = Math.max(0, items.length - 1);

    let out = '';
    if (inputRows > 1) out += `\u001b[${inputRows - 1}A`; // back to the first input row
    out += '\r\u001b[0J';
    const body = promptTail() + input;
    out += body;

    if (items.length) {
      const mlines = items.map(
        (c, i) => `${i === sel ? '\u203a' : ' '} ${c.name}${c.help ? `  \u001b[2m${c.help}\u001b[0m` : ''}`,
      );
      const menuRows = rowsOf(mlines, w);
      out += '\n' + mlines.join('\n');
      // put the cursor back on the (last) input row, just after the input
      out += `\u001b[${menuRows}A\r`;
      const len = stripAnsi(body).length; // menu only when input is a single line
      const col = len % w;
      out += `\u001b[${col === 0 ? w : col}C`;
    }
    stdout.write(out);
    inputRows = rowsOf(body.split('\n'), w);
  }

  if (isTTY) {
    try {
      stdin.setRawMode(true);
    } catch {
      /* not a raw-capable tty */
    }
    stdout.write('\u001b[?2004h'); // ask the terminal to bracket pastes
  }
  if (DEBUG) process.stderr.write(`\u001b[2m[input] isTTY=${isTTY} raw=${(() => { try { return process.stdin.isRaw; } catch { return '?'; } })()}\u001b[0m\n`);
  stdin.setEncoding?.('utf8');
  stdin.resume?.();

  stdin.on('data', (chunk) => {
    const s = String(chunk);
    if (DEBUG) process.stderr.write(`\u001b[2m[input] chunk(${s.length}) ${JSON.stringify(s)}\u001b[0m\n`);
    let i = 0;
    while (i < s.length) {
      if (!inPaste && s.startsWith('\u001b[200~', i)) {
        inPaste = true;
        pasteBuf = '';
        i += 6;
        continue;
      }
      if (inPaste && s.startsWith('\u001b[201~', i)) {
        inPaste = false;
        i += 6;
        const clean = pasteBuf.replace(/\r\n?/g, '\n');
        input += clean; // fill the buffer, do NOT submit
        filter = input;
        render();
        pasteBuf = '';
        continue;
      }
      if (inPaste) {
        pasteBuf += s[i];
        i++;
        continue;
      }
      const ch = s[i];

      if (ch === '\r' || ch === '\n') {
        if (isTTY) stdout.write('\u001b[0J'); // drop the menu
        write('\n');
        const value = input; // submit the line as-is
        input = '';
        filter = '';
        sel = 0;
        inputRows = 1;
        deliver(value);
        i++;
        continue;
      }
      if (ch === '\t') {
        const items = matches();
        if (items.length) {
          input = items[sel].name; // fill the line (menu stays for more navigation)
          render();
        }
        i++;
        continue;
      }
      if (ch === '\u007f' || ch === '\b') {
        if (input) {
          input = input.slice(0, -1);
          filter = input;
          render();
        } else if (filter) {
          filter = '';
          render();
        }
        i++;
        continue;
      }
      if (ch === '\u0003') {
        onInterrupt?.(); // Ctrl-C -> handled by the CLI
        i++;
        continue;
      }
      if (ch === '\u0004') {
        i++; // Ctrl-D: ignore (use /exit)
        continue;
      }
      if (ch === '\u001b') {
        const m = s.slice(i).match(/^\u001b\[[0-9;?]*[A-Za-z~]|^\u001bO[A-Za-z]/);
        if (m) {
          const seq = m[0];
          const items = matches();
          if (items.length && (seq === '\u001b[A' || seq === '\u001b[B')) {
            sel = (sel + (seq === '\u001b[A' ? -1 : 1) + items.length) % items.length;
            input = items[sel].name; // preview the highlighted command on the line
            render();
          }
          i += seq.length;
        } else {
          onEscape?.();
          i += 1;
        }
        continue;
      }
      // printable
      input += ch;
      filter = input;
      sel = 0;
      render();
      i++;
    }
  });

  function deliver(value) {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(value);
    } else {
      pending.push(value);
    }
  }

  return {
    ask(prompt) {
      lastPrompt = prompt || '';
      if (prompt) stdout.write(prompt);
      inputRows = 1;
      sel = 0;
      if (pending.length) return Promise.resolve(pending.shift());
      return new Promise((res) => {
        waiter = res;
      });
    },
    clear() {
      input = '';
      filter = '';
      pasteBuf = '';
      inPaste = false;
      sel = 0;
      if (isTTY) {
        if (inputRows > 1) stdout.write(`\u001b[${inputRows - 1}A`);
        stdout.write(`\r\u001b[0J${promptTail()}`);
        inputRows = 1;
      }
    },
    close() {
      if (isTTY) {
        stdout.write('\u001b[?2004l');
        try {
          stdin.setRawMode(false);
        } catch {
          /* ignore */
        }
      }
      stdin.pause?.();
    },
  };
}
