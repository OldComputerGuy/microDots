// Paste-aware line input.
//
// In a TTY we enable bracketed paste (\x1b[?2004h). The terminal then wraps a
// pasted block in \x1b[200~ … \x1b[201~, so we can tell a paste from typing:
// a paste fills the input buffer and does NOT submit — the user presses Enter to
// run it. This is raw mode, so we echo input ourselves (basic append/backspace).
//
// ask(prompt) resolves with the submitted text (may contain newlines).
export function createPrompt({ stdin = process.stdin, stdout = process.stdout } = {}) {
  const isTTY = !!stdin.isTTY;
  const DEBUG = process.env.MICRODOT_DEBUG_INPUT === '1';
  const pending = [];
  let waiter = null;
  let input = '';
  let inPaste = false;
  let pasteBuf = '';

  const write = (s) => {
    if (isTTY) stdout.write(s);
  };

  function deliver(value) {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(value);
    } else {
      pending.push(value);
    }
  }

  if (isTTY) {
    try {
      stdin.setRawMode(true);
    } catch {
      /* not a raw-capable tty */
    }
    stdout.write('\x1b[?2004h'); // ask the terminal to bracket pastes
  }
  stdin.setEncoding?.('utf8');
  stdin.resume?.();

  stdin.on('data', (chunk) => {
    const s = String(chunk);
    if (DEBUG) process.stderr.write(`\x1b[2m[input] ${JSON.stringify(s)}\x1b[0m\n`);
    let i = 0;
    while (i < s.length) {
      if (!inPaste && s.startsWith('\x1b[200~', i)) {
        inPaste = true;
        pasteBuf = '';
        i += 6;
        continue;
      }
      if (inPaste && s.startsWith('\x1b[201~', i)) {
        inPaste = false;
        i += 6;
        input += pasteBuf; // fill the buffer, do NOT submit
        write(pasteBuf);
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
        write('\n');
        const value = input;
        input = '';
        deliver(value);
        i++;
        continue;
      }
      if (ch === '\u007f' || ch === '\b') {
        if (input) {
          input = input.slice(0, -1);
          write('\b \b');
        }
        i++;
        continue;
      }
      if (ch === '\u0003') {
        process.emit('SIGINT'); // Ctrl-C
        i++;
        continue;
      }
      if (ch === '\u0004') {
        i++; // Ctrl-D: ignore (use /exit)
        continue;
      }
      if (ch === '\u001b') {
        // swallow ANSI sequences (arrow keys etc.) — we don't do cursor editing
        const m = s.slice(i).match(/^\u001b\[[0-9;?]*[A-Za-z~]|^\u001bO[A-Za-z]/);
        i += m ? m[0].length : 1;
        continue;
      }
      input += ch;
      write(ch);
      i++;
    }
  });

  return {
    ask(prompt) {
      if (prompt) stdout.write(prompt);
      if (pending.length) return Promise.resolve(pending.shift());
      return new Promise((res) => {
        waiter = res;
      });
    },
    close() {
      if (isTTY) {
        stdout.write('\x1b[?2004l');
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
