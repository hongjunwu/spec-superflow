// scripts/lib/ascii-safe.mjs — GBK-console safety for CLI output on Windows.
//
// The CLI prints emoji status markers (✅ ❌ 🔴 🟡 🔵 📋 …). When stdout is a
// Windows console with a legacy codepage (GBK/936, the default for cmd.exe
// outside Windows Terminal), those characters render as □□□ — Node cannot
// help because the glyph is simply missing from the console font/charset, and
// Chinese text stays readable only because CJK is in the codepage.
//
// installAsciiSafeOutput() wraps the console and stream writers so emoji are
// replaced with ASCII markers before they reach the console. It only activates
// when all of these hold:
//   - win32 (the problem does not exist elsewhere)
//   - the stream is a TTY (piped/redirected output is UTF-8 and renders fine
//     in editors and CI logs, so rewriting would only destroy information)
//   - SSF_UTF8 is unset (opt-out for Windows Terminal users who prefer emoji)
//
// Chinese text is preserved: CJK lives in GBK, so only the emoji layer needs
// rewriting.

const EMOJI_MAP = new Map(Object.entries({
  '✅': '[OK]',
  '❌': '[FAIL]',
  '🔴': '[E]',
  '🟡': '[W]',
  '🔵': '[I]',
  '📋': '[doc]',
  '🔍': '[scan]',
  '⚡': '[run]',
  '🐛': '[dbg]',
  '📝': '[doc]',
  '🌉': '[bridge]',
  '🔒': '[lock]',
  '🚫': '[x]',
  '⚠️': '[!]',
  '⚠': '[!]',
  'ℹ': '[i]',
  '↳': '>',
}));

// Everything else in the emoji and symbol blocks that has no mapping: strip.
// CJK (4E00-9FFF), CJK punctuation (3000-303F), fullwidth forms (FF00-FFEF)
// and ASCII are outside these ranges, so Chinese output survives untouched.
const EMOJI_RANGE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu;

export function toConsoleSafeText(text) {
  if (typeof text !== 'string') return text;
  const mapped = text.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2139}\u{2190}-\u{21FF}]/gu, ch => EMOJI_MAP.get(ch) ?? ch);
  return mapped.replace(EMOJI_RANGE, '');
}

export function consoleNeedsAsciiSafety(stream = process.stdout) {
  return process.platform === 'win32' && stream.isTTY === true && !process.env.SSF_UTF8;
}

let installed = false;

export function installAsciiSafeOutput({ stdout = process.stdout, stderr = process.stderr } = {}) {
  if (installed) return;
  if (!consoleNeedsAsciiSafety(stdout) && !consoleNeedsAsciiSafety(stderr)) return;
  installed = true;
  const wrap = (stream) => {
    if (!stream || !consoleNeedsAsciiSafety(stream)) return;
    const original = stream.write.bind(stream);
    stream.write = (chunk, ...rest) => original(typeof chunk === 'string' ? toConsoleSafeText(chunk) : chunk, ...rest);
  };
  wrap(stdout);
  wrap(stderr);
  for (const method of ['log', 'error', 'warn', 'info']) {
    const original = console[method].bind(console);
    console[method] = (...args) => original(...args.map(value => (typeof value === 'string' ? toConsoleSafeText(value) : value)));
  }
}
