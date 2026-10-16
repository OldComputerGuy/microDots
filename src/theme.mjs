// One place for colour. Semantic roles, not raw escape codes.
//
// Colour is ON only on a TTY, and OFF when NO_COLOR is set (https://no-color.org)
// or the stream is piped/redirected. FORCE_COLOR=1 overrides (useful for tests).
const supportsColor = () => {
  if (process.env.FORCE_COLOR) return true;
  if (process.env.NO_COLOR != null && process.env.NO_COLOR !== '') return false;
  return !!process.stdout.isTTY;
};

export const colorOn = supportsColor();
const wrap = (open, close) => (s) => (colorOn ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));

// ---- attributes ----
export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const italic = wrap(3, 23);
export const underline = wrap(4, 24);
export const inverse = wrap(7, 27);

// ---- 8 basic colours (fg) ----
export const black = wrap(30, 39);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const blue = wrap(34, 39);
export const magenta = wrap(35, 39);
export const cyan = wrap(36, 39);
export const white = wrap(37, 39);
export const gray = wrap(90, 39);

// ---- semantic roles (use these in UI code) ----
export const heading = bold; // section titles
export const label = cyan; // field labels / keys
export const accent = cyan; // the app/agent name, markers
export const user = cyan; // user prompt
export const ok = green; // success
export const warn = yellow; // warnings / caution
export const err = red; // errors / danger
export const path = blue; // filesystem paths / targets
export const project = green; // project names
export const engine = magenta; // shared / engine-level things
export const meta = dim; // secondary metadata, counts, hints

export default {
  bold,
  dim,
  italic,
  underline,
  inverse,
  black,
  red,
  green,
  yellow,
  blue,
  magenta,
  cyan,
  white,
  gray,
  heading,
  label,
  accent,
  user,
  ok,
  warn,
  err,
  path,
  project,
  engine,
  meta,
};
