// Regression guards for the brownfield approval binding: a plan that executes a
// brownfield change must carry matching technical evidence whatever shape the
// plan has, so `ssf execution revise` cannot silently drop the gate.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { blockingPlanFailures, createPlan, validatePlan, writePlan } from '../../scripts/lib/execution-plan.mjs';
import { getPlanScopedPaths } from '../../scripts/lib/sdd-overlay.mjs';

const directories = [];

afterEach(() => {
  while (directories.length) rmSync(directories.pop(), { recursive: true, force: true });
});

describe('brownfield plan binding', () => {
  it('records technical evidence on every plan for a brownfield change', () => {
    const dir = writeBrownfieldChange();
    const plan = createPlan(dir, { mode: 'inline', source: 'user-confirmed', rationale: 'revise', waves: waves(), revision: 2 });
    assert.equal(plan.schema_version, undefined, 'this plan shape is the one `ssf execution revise` produces');
    assert.equal(plan.technical_validation.profile, 'brownfield');
    assert.equal(plan.technical_validation.status, 'pass');
    assert.match(plan.technical_validation.technical_contract_hash, /^sha256:/);
  });

  it('refuses to create a plan for an invalid brownfield change', () => {
    const dir = writeBrownfieldChange();
    rmSync(join(dir, 'traceability.json'));
    assert.throws(
      () => createPlan(dir, { mode: 'inline', source: 'user-confirmed', rationale: 'revise', waves: waves(), revision: 2 }),
      /Technical validation failed/,
    );
  });

  it('rejects a brownfield plan that lost its technical evidence, schema or not', () => {
    const dir = writeBrownfieldChange();
    const plan = createPlan(dir, { mode: 'inline', source: 'user-confirmed', rationale: 'revise', waves: waves(), revision: 2 });
    delete plan.technical_validation;
    const failures = validatePlan(dir, plan).failures;
    assert.ok(
      failures.includes('brownfield execution plan is missing technical validation evidence'),
      `expected the brownfield gate to fire, got: ${failures.join('; ')}`,
    );
  });

  it('does not record technical evidence for standard changes', () => {
    const dir = writeStandardChange();
    const plan = createPlan(dir, { mode: 'inline', source: 'user-confirmed', rationale: 'revise', waves: waves(), revision: 1 });
    assert.equal(plan.technical_validation, undefined);
  });

  it('re-approval replaces only refreshed-snapshot failures', () => {
    assert.deepEqual(blockingPlanFailures([
      'execution plan is stale: artifacts hash mismatch',
      'execution plan is stale: contract hash mismatch',
      'technical contract hash mismatch',
    ]), []);
    assert.deepEqual(
      blockingPlanFailures(['technical contract hash mismatch', 'brownfield execution plan is missing technical validation evidence']),
      ['brownfield execution plan is missing technical validation evidence'],
    );
  });

  it('records the plan-scoped technical validation evidence beside the plan', () => {
    const dir = writeBrownfieldChange();
    const plan = createPlan(dir, { mode: 'inline', source: 'user-confirmed', rationale: 'revise', waves: waves(), revision: 2 });
    const written = writePlan(dir, plan);
    const evidencePath = getPlanScopedPaths(dir, written).technicalValidation;
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    assert.equal(evidence.status, 'pass');
    assert.equal(evidence.profile, 'brownfield');
    assert.equal(evidence.plan_hash, written.hash);
    assert.equal(evidence.plan_revision, written.revision);
    assert.deepEqual(evidence.mapping, ['REQ-001 -> API-001 -> task 1.1 -> TEST-001', 'API-001 -> task 1.1 -> TEST-001']);
  });

  it('invalidates the plan when the approved design changes', () => {
    const dir = writeBrownfieldChange();
    const plan = createPlan(dir, { mode: 'inline', source: 'user-confirmed', rationale: 'revise', waves: waves(), revision: 2 });
    writeFileSync(join(dir, 'technical-design.md'), `${readTechnicalDesign()}\n<!-- corrected -->\n`);
    const failures = validatePlan(dir, plan).failures;
    assert.ok(failures.includes('technical contract hash mismatch'), failures.join('; '));
    assert.ok(failures.includes('execution plan is stale: artifacts hash mismatch'), failures.join('; '));
  });

  it('keeps a standard change with the optional design free of plan binding', () => {
    const dir = writeStandardChange();
    const plan = createPlan(dir, { mode: 'inline', source: 'user-confirmed', rationale: 'revise', waves: waves(), revision: 1 });
    assert.equal(plan.technical_validation, undefined);
    const written = writePlan(dir, plan);
    assert.equal(existsSync(getPlanScopedPaths(dir, written).technicalValidation), false);
    // Legacy plan shapes have their own recommendation obligations; the point
    // here is that no technical failure is raised for a standard change.
    const failures = validatePlan(dir, written).failures;
    assert.deepEqual(failures.filter(failure => /technical/i.test(failure)), [], failures.join('; '));
  });

  it('refuses to create a plan over an invalid optional technical design', () => {
    const dir = writeStandardChange();
    rmSync(join(dir, 'traceability.json'));
    assert.throws(
      () => createPlan(dir, { mode: 'inline', source: 'user-confirmed', rationale: 'revise', waves: waves(), revision: 1 }),
      /Technical validation failed/,
    );
  });
});

function waves() {
  return [{ id: 'implementation', strategy: 'serial', tasks: ['1.1'], depends_on: [] }];
}

function createChange() {
  const dir = mkdtempSync(join(tmpdir(), 'ssf-plan-binding-'));
  directories.push(dir);
  mkdirSync(join(dir, 'specs', 'salary'), { recursive: true });
  writeFileSync(join(dir, 'specs', 'salary', 'spec.md'), [
    '## ADDED Requirements', '', '### Requirement: REQ-001 — Create adjustment', '',
    'The service SHALL create an adjustment.', '', '#### Scenario: Create', '',
    '- **WHEN** a user submits', '- **THEN** it returns', '',
  ].join('\n'));
  writeFileSync(join(dir, 'tasks.md'), '- [ ] 1.1 Build the endpoint\n  Refs: REQ-001, API-001, FILE-001, TEST-001\n');
  return dir;
}

function writeStandardChange() {
  const dir = createChange();
  writeFileSync(join(dir, 'proposal.md'), '# Proposal\n\n## Engineering Profile\n\n- **Profile**: standard\n- **Boundaries**:\n');
  writeFileSync(join(dir, 'technical-design.md'), readTechnicalDesign());
  writeFileSync(join(dir, 'traceability.json'), JSON.stringify(readTraceability('standard'), null, 2));
  writeFileSync(join(dir, 'tasks.md'), brownfieldTask());
  return dir;
}

function writeBrownfieldChange() {
  const dir = createChange();
  writeFileSync(join(dir, 'proposal.md'), [
    '# Proposal', '', '## Engineering Profile', '', '- **Profile**: brownfield', '- **Boundaries**: api', '',
  ].join('\n'));
  writeFileSync(join(dir, 'technical-design.md'), readTechnicalDesign());
  writeFileSync(join(dir, 'traceability.json'), JSON.stringify(readTraceability('brownfield'), null, 2));
  writeFileSync(join(dir, 'tasks.md'), brownfieldTask());
  return dir;
}

function readTechnicalDesign() {
  return [
    '# Technical Design', '', '## API', '', '### API-001: Create adjustment', '',
    '- Method: POST', '- Path: /adjustments', '- Request: salary', '- Response: adjustment',
    '- Authorization: salary.write', '- Compatibility: additive', '',
  ].join('\n');
}

function readTraceability(profile) {
  return {
    schema_version: 1,
    profile,
    requirements: [{ id: 'REQ-001', design_items: ['API-001'], task_ids: ['1.1'], test_ids: ['TEST-001'] }],
    design_items: [{ id: 'API-001', kind: 'api', requirements: ['REQ-001'], files: ['FILE-001'], risk: 'high' }],
    files: [{ id: 'FILE-001', path: 'src/adjustment.mjs' }],
    tasks: [{ id: '1.1', requirements: ['REQ-001'], design_items: ['API-001'], files: ['FILE-001'], tests: ['TEST-001'] }],
    tests: [{ id: 'TEST-001', requirements: ['REQ-001'], design_items: ['API-001'], command: 'node --test' }],
  };
}

function brownfieldTask() {
  return '- [ ] **1.1 Build the endpoint**：修改 `src/adjustment.mjs`\n  Refs: REQ-001, API-001, FILE-001, TEST-001\n  证明：`node --test`\n';
}
