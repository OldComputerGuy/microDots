// Knight-Rider style busy indicator: a row of dashes with an 'o' bouncing
// back and forth (e.g. "-----o------" -> "------o-----" -> ...).
// Only draws on a TTY; on a pipe it is a no-op (but still tracks state).
export function createBusy({ stream = process.stdout } = {}) {
  const width = 20;
  let pos = 0;
  let dir = 1;
  let label = '';
  let timer = null;
  let active = false;
  const tty = !!stream.isTTY;

  function render() {
    if (!tty || !active) return;
    const chars = new Array(width).fill('-');
    chars[pos] = 'o';
    const line = (label ? `${label}  ` : '') + chars.join('');
    stream.write(`\r\x1b[2K${line}`);
  }
  function tick() {
    pos += dir;
    if (pos <= 0) {
      pos = 0;
      dir = 1;
    } else if (pos >= width - 1) {
      pos = width - 1;
      dir = -1;
    }
    render();
  }

  return {
    start(text = '') {
      label = text;
      if (!active) {
        active = true;
        if (tty && !timer) timer = setInterval(tick, 90);
      }
      render();
    },
    set(text) {
      label = text;
      render();
    },
    stop() {
      active = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (tty) stream.write('\r\x1b[2K');
    },
    get active() {
      return active;
    },
  };
}
