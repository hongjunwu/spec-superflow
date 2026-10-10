import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTestCount } from '../../scripts/lib/test-count.mjs';

describe('test-count: evidence parsing from verification output', () => {
  it('reads the surefire summary of a real maven run', () => {
    const output = [
      '[INFO] Running com.example.SalaryTest',
      '[INFO] Tests run: 9, Failures: 0, Errors: 0, Skipped: 0',
      '[INFO] BUILD SUCCESS',
    ].join('\n');
    assert.deepEqual(parseTestCount(output), { count: 9, source: 'surefire-style Tests run' });
  });

  it('takes the maximum module line instead of double-counting the maven summary', () => {
    const output = [
      'module-a: Tests run: 4, Failures: 0',
      'module-b: Tests run: 12, Failures: 0',
      'Results: Tests run: 16, Failures: 0',
    ].join('\n');
    // 16 is the repeated total; the policy reports the per-line max so the
    // multi-module summary can never be summed twice.
    assert.equal(parseTestCount(output).count, 16);
    const noSummary = 'module-a: Tests run: 4\nmodule-b: Tests run: 12';
    assert.equal(parseTestCount(noSummary).count, 12);
  });

  it('reads pytest, jest and node:test summaries', () => {
    assert.equal(parseTestCount('3 passed, 1 failed in 0.4s').count, 3);
    assert.equal(parseTestCount('Tests: 7 passed, 7 total').count, 7);
    assert.equal(parseTestCount('# tests 12\n# pass 12\n# fail 0').count, 12);
  });

  it('returns null for theater: BUILD SUCCESS without any test execution', () => {
    assert.equal(parseTestCount('[INFO] BUILD SUCCESS'), null);
    assert.equal(parseTestCount(''), null);
    assert.equal(parseTestCount(undefined), null);
  });

  it('never misreads a zero-test run as evidence', () => {
    const output = 'Tests run: 0, Failures: 0, Errors: 0, Skipped: 0\nBUILD SUCCESS';
    const parsed = parseTestCount(output);
    assert.equal(parsed.count, 0);
  });
});
