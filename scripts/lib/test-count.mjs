// scripts/lib/test-count.mjs — parse executable test-run evidence from a
// verification command's output. The goal is anti-theater: `mvn test` with a
// missing jupiter engine exits 0 and prints BUILD SUCCESS without running a
// single test, and a completion gate that only inspects the exit code passes
// that. A recognizable test count is the cheapest evidence that tests actually
// executed.
//
// Counting policy: report the MAXIMUM per-line match, not the sum. Maven's
// multi-module output prints one `Tests run:` line per module plus a trailing
// summary that repeats the total — summing would double-count, while the max
// gives the largest single-module run, a safe lower bound for "did tests
// execute". Thresholds set against a multi-module total should use the
// single-module peak instead.

const PATTERNS = [
  // Maven / Surefire / Gradle test-logging: "Tests run: 12, Failures: 0, ..."
  { re: /\bTests run:\s*(\d+)/gi, name: 'surefire-style Tests run' },
  // pytest / vitest / jest style: "5 passed", "3 passed, 2 failed"
  { re: /\b(\d+)\s+passed\b/gi, name: 'x-passed style' },
  // jest summary: "Tests: 7 passed, 7 total"
  { re: /\bTests:\s*(\d+)\s+passed/gi, name: 'jest summary' },
  // node:test reporter summary: "ℹ tests 12" (the symbols are stripped on
  // Windows consoles, hence the optional leading character class)
  { re: /^(?:.*?tests?)\s+(\d+)\s*$/gim, name: 'node:test summary' },
  // TAP: "# tests 12" / "# pass 12"
  { re: /^#\s+(?:tests|pass)\s+(\d+)\s*$/gim, name: 'TAP summary' },
];

/**
 * Parse the largest recognizable test-execution count from command output.
 * Returns null when nothing looks like a test-run report — that is exactly
 * the case the completion gate must reject instead of trusting exit code 0.
 */
export function parseTestCount(output) {
  if (typeof output !== 'string' || !output.trim()) return null;
  let best = null;
  for (const { re, name } of PATTERNS) {
    re.lastIndex = 0;
    for (const match of output.matchAll(re)) {
      const count = Number.parseInt(match[1], 10);
      if (Number.isSafeInteger(count) && count >= 0 && (!best || count > best.count)) {
        best = { count, source: name };
      }
    }
  }
  return best;
}
