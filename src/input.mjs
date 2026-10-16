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
  const history = []; // submitted inputs this session (commands included)
  let histIndex = 0; // === history.length => on the "current draft"
  let draft = '';
  let cursorRow = 1; // row (from the top of the rendered region) the caret is on
  let chooser = null; // active list picker: { prompt, options, index, resolve }
  let chooserRows = 0;

  const write = (s) => {
    if (isTTY) stdout.write(s);
  };
  const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');
  const promptTail = () => lastPrompt.split('\n').pop();
  const cols = () => Math.max(20, (stdout.columns || 80) | 0);

  // Parse one key escape sequence at the START of `str`. Returns
  // { consumed, key } where key is a logical name ('up','down','left','right',
  // 'home','end','delete','ignore'), or null if `str` isn't a complete sequence
  // (e.g. a lone ESC). Handles CSI (`\u001b[A`, `\u001b[1;2A`), SS3 (`\u001bOA`)
  // and tilde forms (`\u001b[3~`), so arrow keys work across terminals.
  function parseKey(str) {
    const csi = /^\u001b\[([0-9;]*)([A-Za-z~])/.exec(str);
    if (csi) {
      const p = csi[1];
      const f = csi[2];
      const consumed = csi[0].length;
      if (f === 'A') return { consumed, key: 'up' };
      if (f === 'B') return { consumed, key: 'down' };
      if (f === 'C') return { consumed, key: 'right' };
      if (f === 'D') return { consumed, key: 'left' };
      if (f === 'H') return { consumed, key: 'home' };
      if (f === 'F') return { consumed, key: 'end' };
      if (f === '~') {
        if (p === '1' || p === '7') return { consumed, key: 'home' };
        if (p === '4' || p === '8') return { consumed, key: 'end' };
        if (p === '3') return { consumed, key: 'delete' };
      }
      return { consumed, key: 'ignore' }; // unknown CSI (e.g. focus, paste) — don't act
    }
    const ss3 = /^\u001bO([A-Za-z])/.exec(str);
    if (ss3) {
      const map = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end' };
      return { consumed: ss3[0].length, key: map[ss3[1]] || 'ignore' };
    }
    return null;
  }
  // Rows a set of display lines occupies, accounting for terminal wrapping.
  function rowsOf(lines, w) {
    let r = 0;
    for (const l of lines) r += Math.max(1, Math.ceil(stripAnsi(l).length / w));
    return Math.max(1, r);
  }
  function edit(next) {
    input = next;
    filter = input;
    // NOTE: do not clamp `cur` here — callers adjust it, and render() clamps as
    // a safety net. Clamping here double-corrected Backspace (caret one short).
  }

  // Preview an entry in the menu without collapsing it: set the line to `next`
  // but keep `filter` as the typed token, so suggestions() still returns the
  // whole list and ↑/↓ can keep scrolling.
  function preview(next) {
    input = next;
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

  // Recalls a previous input (Up = older, Down = newer) when the menu isn't up.
  function historyNav(dir) {
    if (!history.length) return;
    if (dir < 0) {
      if (histIndex === history.length) draft = input; // remember what you were typing
      if (histIndex === 0) return; // already oldest
      histIndex--;
    } else {
      if (histIndex >= history.length) return; // already at the draft
      histIndex++;
    }
    input = histIndex === history.length ? draft : history[histIndex];
    cur = input.length;
    filter = input;
    render();
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
        const c = s[k];
        if (c === '\u001b') {
          const seq = parseKey(s.slice(k));
          if (seq) {
            if (seq.key === 'up') {
              chooser.index = (chooser.index - 1 + n) % n;
              renderChooser();
            } else if (seq.key === 'down') {
              chooser.index = (chooser.index + 1) % n;
              renderChooser();
            }
            k += seq.consumed;
            continue;
          }
          // A lone ESC (not part of a sequence) cancels the picker.
          const resolve = chooser.resolve;
          finishChooser();
          resolve(null);
          return;
        }
        if (c === '\r' || c === '\n') {
          const pick = chooser.options[chooser.index];
          const resolve = chooser.resolve;
          finishChooser();
          resolve(pick.value ?? pick);
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
        if (value.trim() && history[history.length - 1] !== value) history.push(value);
        histIndex = history.length;
        draft = '';
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
        const seq = parseKey(s.slice(i));
        if (seq) {
          const items = suggestions();
          if (seq.key === 'up' || seq.key === 'down') {
            if (items.length) {
              sel = (sel + (seq.key === 'up' ? -1 : 1) + items.length) % items.length;
              preview(items[sel].complete); // browse — keep the menu open
              cur = input.length;
              render();
            } else {
              historyNav(seq.key === 'up' ? -1 : 1); // shell-style history
            }
          } else if (seq.key === 'right') {
            if (cur < input.length) {
              cur++;
              render();
            }
          } else if (seq.key === 'left') {
            if (cur > 0) {
              cur--;
              render();
            }
          } else if (seq.key === 'home') {
            if (cur !== 0) {
              cur = 0;
              render();
            }
          } else if (seq.key === 'end') {
            if (cur !== input.length) {
              cur = input.length;
              render();
            }
          } else if (seq.key === 'delete') {
            if (cur < input.length) {
              edit(input.slice(0, cur) + input.slice(cur + 1));
              render();
            }
          }
          i += seq.consumed;
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
