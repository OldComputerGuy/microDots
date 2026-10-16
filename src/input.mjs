// Paste-aware, slash-command-aware line input.
//
// TTY: raw mode + bracketed paste. A pasted block fills the input (no submit);
// Enter runs it. When the input is a slash token (e.g. "/pro"), a live menu of
// matching commands is shown below the prompt. Up/Down (or Tab) fill the line
// with the highlighted command; Enter submits whatever is on the line.
//
// Editing: the input is a real editable line — Left/Right/Home/End move the
// cursor, Backspace/Delete edit at the cursor, and typing/pasting inserts at it.
//
// ask(prompt) resolves with the submitted text (may contain newlines).
export function createPrompt({ stdin = process.stdin, stdout = process.stdout, onEscape, onInterrupt, suggest } = {}) {
  const isTTY = !!stdin.isTTY;
  const DEBUG = process.env.MICRODOT_DEBUG_INPUT === '1';
  const pending = [];
  let waiter = null;
  let input = ''; // the line content
  let cur = 0; // caret index within `input`
  let filter = ''; // the token used to match suggestions (kept separate so
  let inPaste = false; //   navigating the menu doesn't collapse it)
  let pasteBuf = '';
  let lastPrompt = '';
  let sel = 0;
  let cursorRow = 1; // row (from the top of the rendered region) the caret is on
  let chooser = null; // active list picker: { prompt, options, index, resolve }
  let chooserRows = 0;

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
  function edit(next) {
    input = next;
    filter = input;
    if (cur > input.length) cur = input.length;
  }

  // Suggestions for the current typed token, from the caller's provider.
  function suggestions() {
    if (!filter || filter.includes('\n')) return [];
    let items = [];
    try {
      items = typeof suggest === 'function' ? suggest(filter) : [];
    } catch {
      items = [];
    }
    if (!items.length) return [];
    if (items.length === 1 && items[0].complete === filter) return [];
    return items;
  }

  function render() {
    if (!isTTY) return;
    const w = cols();
    const items = suggestions();
    if (sel >= items.length) sel = Math.max(0, items.length - 1);
    if (cur > input.length) cur = input.length;

    let out = '';
    if (cursorRow > 1) out += `\u001b[${cursorRow - 1}A`; // back to the first row
    out += '\r\u001b[0J';
    const body = promptTail() + input;
    out += body;

    // Where the caret sits (row from the top, and column), accounting for wraps.
    const prefix = promptTail() + input.slice(0, cur);
    const plines = prefix.split('\n');
    const caretRow = rowsOf(plines, w);
    const lastLen = stripAnsi(plines[plines.length - 1]).length;
    let caretCol = lastLen % w;
    if (caretCol === 0 && lastLen > 0) caretCol = w;

    const bodyRows = rowsOf(body.split('\n'), w);
    let menuRows = 0;
    if (items.length) {
      const mlines = items.map(
        (c, i) => `${i === sel ? '\u203a' : ' '} ${c.label}${c.help ? `  \u001b[2m${c.help}\u001b[0m` : ''}`,
      );
      menuRows = rowsOf(mlines, w);
      out += '\n' + mlines.join('\n');
    }
    // Move from where printing left the cursor (end of body + menu) to the caret.
    const up = bodyRows + menuRows - caretRow;
    if (up > 0) out += `\u001b[${up}A`;
    out += '\r';
    if (caretCol > 0) out += `\u001b[${caretCol}C`;

    stdout.write(out);
    cursorRow = caretRow;
  }

  // A simple list picker (used by /resume). Draws a prompt + options below the
  // current line; Up/Down move, Enter picks, Esc cancels.
  function renderChooser() {
    if (!isTTY || !chooser) return;
    const w = cols();
    let out = '';
    if (chooserRows > 1) out += `\u001b[${chooserRows - 1}A`;
    out += '\r\u001b[0J';
    const lines = [
      chooser.prompt,
      ...chooser.options.map((o, i) => `${i === chooser.index ? '\u203a' : ' '} ${o.label}`),
    ];
    out += lines.join('\n');
    stdout.write(out);
    chooserRows = rowsOf(lines, w);
  }
  function finishChooser() {
    if (isTTY && chooserRows > 0) {
      if (chooserRows > 1) stdout.write(`\u001b[${chooserRows - 1}A`);
      stdout.write('\r\u001b[0J');
    }
    chooser = null;
    chooserRows = 0;
    cursorRow = 1;
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

    // While a picker is open, only navigate/select/cancel.
    if (chooser) {
      const n = chooser.options.length;
      let k = 0;
      while (k < s.length) {
        if (s.startsWith('\u001b[A', k)) {
          chooser.index = (chooser.index - 1 + n) % n;
          k += 3;
          renderChooser();
          continue;
        }
        if (s.startsWith('\u001b[B', k)) {
          chooser.index = (chooser.index + 1) % n;
          k += 3;
          renderChooser();
          continue;
        }
        const c = s[k];
        if (c === '\r' || c === '\n') {
          const pick = chooser.options[chooser.index];
          const resolve = chooser.resolve;
          finishChooser();
          resolve(pick.value ?? pick);
          return;
        }
        if (c === '\u001b') {
          const resolve = chooser.resolve;
          finishChooser();
          resolve(null);
          return;
        }
        if (c === '\u0003') {
          onInterrupt?.();
          k++;
          continue;
        }
        k++;
      }
      return;
    }

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
        edit(input.slice(0, cur) + clean + input.slice(cur)); // insert at caret
        cur += clean.length;
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
        cur = 0;
        filter = '';
        sel = 0;
        cursorRow = 1;
        deliver(value);
        i++;
        continue;
      }
      if (ch === '\t') {
        const items = suggestions();
        if (items.length) {
          edit(items[sel].complete);
          cur = input.length;
          render();
        }
        i++;
        continue;
      }
      if (ch === '\u007f' || ch === '\b') {
        if (cur > 0) {
          edit(input.slice(0, cur - 1) + input.slice(cur));
          cur--;
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
          const items = suggestions();
          if (items.length && (seq === '\u001b[A' || seq === '\u001b[B')) {
            sel = (sel + (seq === '\u001b[A' ? -1 : 1) + items.length) % items.length;
            edit(items[sel].complete); // preview the highlighted command
            cur = input.length;
            render();
          } else if (seq === '\u001b[C') {
            if (cur < input.length) {
              cur++;
              render();
            }
          } else if (seq === '\u001b[D') {
            if (cur > 0) {
              cur--;
              render();
            }
          } else if (seq === '\u001b[H' || seq === '\u001b[1~' || seq === '\u001b[7~') {
            if (cur !== 0) {
              cur = 0;
              render();
            }
          } else if (seq === '\u001b[F' || seq === '\u001b[4~' || seq === '\u001b[8~') {
            if (cur !== input.length) {
              cur = input.length;
              render();
            }
          } else if (seq === '\u001b[3~') {
            if (cur < input.length) {
              edit(input.slice(0, cur) + input.slice(cur + 1));
              render();
            }
          }
          i += seq.length;
        } else {
          onEscape?.();
          i += 1;
        }
        continue;
      }
      // printable → insert at the caret
      edit(input.slice(0, cur) + ch + input.slice(cur));
      cur++;
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
      cursorRow = 1;
      cur = 0;
      sel = 0;
      if (pending.length) return Promise.resolve(pending.shift());
      return new Promise((res) => {
        waiter = res;
      });
    },
    // Interactive list picker: resolves with the chosen option's value, or null
    // if cancelled (or if not a TTY).
    choose(prompt, options = []) {
      if (!isTTY || !options.length) return Promise.resolve(null);
      return new Promise((resolve) => {
        chooser = { prompt, options, index: 0, resolve };
        chooserRows = 0;
        renderChooser();
      });
    },
    get interactive() {
      return isTTY;
    },
    clear() {
      input = '';
      cur = 0;
      filter = '';
      pasteBuf = '';
      inPaste = false;
      sel = 0;
      if (isTTY) {
        if (cursorRow > 1) stdout.write(`\u001b[${cursorRow - 1}A`);
        stdout.write(`\r\u001b[0J${promptTail()}`);
        cursorRow = 1;
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
