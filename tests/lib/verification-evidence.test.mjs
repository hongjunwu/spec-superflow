import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readState } from '../../scripts/lib/state-loader.mjs';

const CLI = join(process.cwd(), 'scripts', 'spec-superflow.mjs');
let changeDir;

function runSsf(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { exitCode: 0, stdout };
  } catch (error) {
    return { exitCode: error.status ?? 1, stdout: error.stdout?.toString() ?? '', stderr: error.stderr?.toString() ?? '' };
  }
}

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'ssf-evidence-'));
  changeDir = join(root, 'openspec', 'changes', 'evidence');
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: auto\n');
  // The fake verification command prints a surefire-style summary from argv,
  // sidestepping shell quoting differences between cmd.exe and POSIX shells.
  writeFileSync(join(changeDir, 'print-tests.mjs'),
    "const n = Number(process.argv[2] ?? 0); console.log(`Tests run: ${n}, Failures: 0, Errors: 0, Skipped: 0`);\n");
  // workflow start requires the change to live strictly inside a git checkout.
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'tests@example.invalid');
  git('config', 'user.name', 'Evidence Gate Test');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  const started = runSsf(['workflow', 'start', changeDir, '--path', 'direct', '--scope', 'evidence gate coverage']);
  assert.equal(started.exitCode, 0, started.stderr);
});

afterEach(() => {
  rmSync(changeDir, { recursive: true, force: true });
});

describe('verification evidence gate', () => {
  it('records the parsed count and passes when the output proves enough tests', () => {
    const result = runSsf(['workflow', 'complete', changeDir,
      '--verification-command', `node openspec/changes/evidence/print-tests.mjs 12`, '--expect-tests', '5', '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(readState(changeDir).test_result.includes('pass: node openspec/changes/evidence/print-tests.mjs 12 (tests run: 12)'),
      `test_result was: ${readState(changeDir).test_result}`);
    assert.equal(readState(changeDir).state, 'closing');
  });

  it('fails the gate when fewer tests ran than expected', () => {
    const result = runSsf(['workflow', 'complete', changeDir,
      '--verification-command', `node openspec/changes/evidence/print-tests.mjs 3`, '--expect-tests', '5']);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /evidence gate failed/);
    assert.match(result.stderr, /3 tests ran \(surefire-style Tests run\), below --expect-tests 5/);
    assert.ok(readState(changeDir).test_result.startsWith('fail: node openspec/changes/evidence/print-tests.mjs 3 (test evidence: 3 tests ran'),
      `test_result was: ${readState(changeDir).test_result}`);
    assert.equal(readState(changeDir).state, 'executing', 'a failed evidence gate must not close the change');
  });

  it('rejects BUILD SUCCESS with no test execution at all', () => {
    const result = runSsf(['workflow', 'complete', changeDir,
      '--verification-command', 'node -e "process.stdout.write(\'BUILD SUCCESS\\n\')"', '--expect-tests', '1']);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /no recognizable test execution/);
    assert.match(readState(changeDir).test_result, /^fail: node -e/);
  });

  it('requires explicit approval for the no-tests escape hatch', () => {
    const result = runSsf(['workflow', 'complete', changeDir,
      '--verification-command', 'node -e "process.stdout.write(\'BUILD SUCCESS\\n\')"',
      '--expect-tests', '1', '--no-tests-ok']);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /--confirm --reason/);
    assert.equal(readState(changeDir).state, 'executing');
  });

  it('accepts a documented evidence gap with --no-tests-ok --confirm --reason', () => {
    const result = runSsf(['workflow', 'complete', changeDir,
      '--verification-command', 'node -e "process.stdout.write(\'BUILD SUCCESS\\n\')"',
      '--expect-tests', '1', '--no-tests-ok', '--confirm',
      '--reason', 'the covered component has no executable tests yet']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(readState(changeDir).test_result, /pass: node -e.*\(no test evidence accepted: the covered component has no executable tests yet\)/);
  });

  it('rejects --no-tests-ok without an expectation to attach to', () => {
    const result = runSsf(['workflow', 'complete', changeDir,
      '--verification-command', `node openspec/changes/evidence/print-tests.mjs 4`, '--no-tests-ok']);
    assert.equal(result.exitCode, 2, 'a usage error exits with code 2');
    assert.match(result.stderr, /only matters with --expect-tests/);
  });
});
