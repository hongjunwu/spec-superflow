// End-to-end guards for the Brownfield gate: the entry gate, the conflict stop,
// and the mapped-file requirement on a passing review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { recordReview } from '../../scripts/lib/execution-plan.mjs';
import { listOpenTechnicalConflicts } from '../../scripts/lib/technical-conflicts.mjs';
import { readPlan } from '../../scripts/lib/execution-plan.mjs';
import { readState } from '../../scripts/lib/state-loader.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'spec-superflow.mjs');

function brownfieldFixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'ssf-brownfield-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  // A non-protected trunk: review receipts must certify work committed on the
  // change's own branch, not straight onto main/master.
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'Spec Superflow Test');
  git('config', 'user.email', 'tests@example.invalid');

  const dir = join(root, 'changes', 'bf');
  fs.mkdirSync(join(dir, 'specs', 'salary'), { recursive: true });
  fs.writeFileSync(join(dir, 'proposal.md'), [
    '# Proposal', '', '## Why', '',
    'The salary adjustment endpoint changes an existing public API, so the change needs a technical design and a traceability map.',
    '', '## What Changes', '', '- Add a salary adjustment endpoint.', '',
    '## Engineering Profile', '', '- **Profile**: brownfield', '- **Boundaries**: api', '',
  ].join('\n'));
  fs.writeFileSync(join(dir, 'specs', 'salary', 'spec.md'), [
    '## ADDED Requirements', '', '### Requirement: REQ-001 — Create adjustment', '',
    'The service SHALL create a salary adjustment.', '', '#### Scenario: Create adjustment', '',
    '- **WHEN** an authorized user submits an adjustment', '- **THEN** the service returns it', '',
  ].join('\n'));
  fs.writeFileSync(join(dir, 'technical-design.md'), [
    '# Technical Design', '', '## API', '', '### API-001: Create adjustment', '',
    '- Method: POST', '- Path: /adjustments', '- Request: salary', '- Response: adjustment',
    '- Authorization: salary.write', '- Compatibility: additive', '',
  ].join('\n'));
  fs.writeFileSync(join(dir, 'traceability.json'), JSON.stringify({
    schema_version: 1,
    profile: 'brownfield',
    requirements: [{ id: 'REQ-001', design_items: ['API-001'], task_ids: ['1.1'], test_ids: ['TEST-001'] }],
    design_items: [{ id: 'API-001', kind: 'api', requirements: ['REQ-001'], files: ['FILE-001'], risk: 'high' }],
    files: [{ id: 'FILE-001', path: 'src/adjustment.mjs' }],
    tasks: [{ id: '1.1', requirements: ['REQ-001'], design_items: ['API-001'], files: ['FILE-001'], tests: ['TEST-001'] }],
    tests: [{ id: 'TEST-001', requirements: ['REQ-001'], design_items: ['API-001'], command: 'node --test' }],
  }, null, 2));
  fs.writeFileSync(join(dir, 'tasks.md'), '- [ ] **1.1 Build the endpoint**：修改 `src/adjustment.mjs`\n  Refs: REQ-001, API-001, FILE-001, TEST-001\n  证明：`node --test`\n');
  git('add', '-A');
  git('commit', '-qm', 'plan the change');

  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  const commit = (name, content) => {
    fs.mkdirSync(dirname(join(root, name)), { recursive: true });
    fs.writeFileSync(join(root, name), content);
    git('add', '-A');
    git('commit', '-qm', name);
    return git('rev-parse', 'HEAD');
  };
  const report = () => {
    const reports = join(dir, '.superpowers', 'sdd', 'reviews');
    fs.mkdirSync(reports, { recursive: true });
    const file = join(reports, 'final.md');
    fs.writeFileSync(file, 'Review completed without blocking findings.\n');
    return file;
  };
  const start = () => {
    const result = run('workflow', 'start', dir, '--path', 'planned', '--confirm', '--reason', 'approved plan');
    assert.equal(result.status, 0, result.stderr);
  };
  return { root, dir, git, run, commit, report, start };
}

test('the entry gate blocks a brownfield change whose technical map is invalid', t => {
  const f = brownfieldFixture(t);
  fs.rmSync(join(f.dir, 'traceability.json'));
  const result = f.run('workflow', 'start', f.dir, '--path', 'planned', '--confirm', '--reason', 'approved plan');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /technical validation failed/i);
});

test('an open technical conflict blocks the passing review and the completion', t => {
  const f = brownfieldFixture(t);
  f.start();
  const head = f.commit('src/adjustment.mjs', 'export const create = () => {};\n');
  const anchor = readState(f.dir).review_base;

  const recorded = f.run('technical', 'conflict', 'record', f.dir, '--task', '1.1',
    '--summary', 'the consumer rejects the additive field', '--affected', 'REQ-001,API-001',
    '--why', 'compatibility needs a product decision', '--next', 'revise the technical design and reapprove');
  assert.equal(recorded.status, 0, recorded.stderr);
  assert.equal(listOpenTechnicalConflicts(f.dir, readPlan(f.dir)).length, 1);

  assert.throws(
    () => recordReview(f.dir, 'final', { status: 'pass', base: anchor, head, report: f.report() }),
    /unresolved technical conflicts/i,
  );
  const completion = f.run('workflow', 'complete', f.dir, '--accept-risk', '--confirm', '--reason', 'ship anyway');
  assert.notEqual(completion.status, 0);
  assert.match(completion.stderr, /Unresolved technical conflicts block completion/);
});

test('a passing review must cover only files declared in the map', t => {
  const f = brownfieldFixture(t);
  f.start();
  const anchor = readState(f.dir).review_base;
  const head = f.commit('src/unmapped.mjs', 'export const stray = true;\n');
  assert.throws(
    () => recordReview(f.dir, 'final', { status: 'pass', base: anchor, head, report: f.report() }),
    /absent from traceability\.json: src\/unmapped\.mjs/,
  );
});

test('a passing review over the mapped range is recorded', t => {
  const f = brownfieldFixture(t);
  f.start();
  const anchor = readState(f.dir).review_base;
  const head = f.commit('src/adjustment.mjs', 'export const create = () => {};\n');
  const receipt = recordReview(f.dir, 'final', { status: 'pass', base: anchor, head, report: f.report() });
  assert.equal(receipt.status, 'pass');
  assert.equal(receipt.head, head);
});
