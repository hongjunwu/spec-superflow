import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeArtifactsHash } from '../../scripts/lib/hash.mjs';
import { parseTasks } from '../../scripts/lib/task-parser.mjs';
import { formatTechnicalMapping, validateTechnicalChange } from '../../scripts/lib/technical-validation.mjs';

const directories = [];

afterEach(() => {
  while (directories.length) rmSync(directories.pop(), { recursive: true, force: true });
});

describe('technical validation', () => {
  it('accepts a complete brownfield traceability chain', () => {
    const dir = writeBrownfieldChange();
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, true, JSON.stringify(report.issues));
    assert.equal(report.profile, 'brownfield');
    assert.match(report.technical_contract_hash, /^sha256:/);
  });

  it('requires every brownfield task Ref declared by its traceability entry', () => {
    const dir = writeBrownfieldChange();
    writeFileSync(join(dir, 'tasks.md'), brownfieldTask('REQ-001, API-001, FILE-001'));
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(entry => entry.message === 'Task 1.1 Refs is missing TEST-001'));
  });

  it('accepts the optional technical design on a standard change', () => {
    const dir = writeStandardChange();
    writeStandardArtifacts(dir);
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, true, JSON.stringify(report.issues));
    assert.equal(report.profile, 'standard');
    assert.equal(report.applies, true);
  });

  it('rejects a standard change with only one of the optional technical artifacts', () => {
    const dir = writeStandardChange();
    writeStandardArtifacts(dir);
    rmSync(join(dir, 'traceability.json'));
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(entry => /must be provided together/.test(entry.message)));
  });

  it('leaves a standard change without technical artifacts on the compact flow', () => {
    const dir = writeStandardChange();
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, true);
    assert.equal(report.applies, false);
  });

  it('treats a change without an Engineering Profile section as standard', () => {
    const dir = writeStandardChange();
    writeFileSync(join(dir, 'proposal.md'), '# Proposal\n\n## Why\n\nA pre-existing planned change without an Engineering Profile section.\n\n## What Changes\n\n- Keep the compact flow.\n');
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, true, JSON.stringify(report.issues));
    assert.equal(report.profile, 'standard');
    assert.equal(report.applies, false);
  });

  it('rejects boundaries declared by a standard Engineering Profile', () => {
    const dir = writeStandardChange();
    writeFileSync(join(dir, 'proposal.md'), '# Proposal\n\n## Engineering Profile\n\n- **Profile**: standard\n- **Boundaries**: api\n');
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(entry => entry.message === 'standard Engineering Profile must not declare Brownfield boundaries'));
  });

  it('rejects a mapped requirement that does not exist in the specs', () => {
    const dir = writeBrownfieldChange();
    editTraceability(dir, trace => {
      trace.requirements.push({ id: 'REQ-002', design_items: ['API-001'], task_ids: ['1.1'], test_ids: ['TEST-001'] });
    });
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(entry => entry.message === 'REQ-002 does not exist in specs'));
  });

  it('rejects a traceability map with an unsupported schema_version', () => {
    const dir = writeBrownfieldChange();
    editTraceability(dir, trace => { trace.schema_version = 2; });
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(entry => entry.message === 'schema_version must be 1'));
  });

  it('hashes technical artifacts only for brownfield changes', () => {
    const dir = writeBrownfieldChange();
    const before = computeArtifactsHash(dir);
    writeFileSync(join(dir, 'technical-design.md'), `${readTechnicalDesign()}\n<!-- changed -->\n`);
    assert.notEqual(computeArtifactsHash(dir), before);
  });

  it('parses continuation-line Refs without changing existing task IDs', () => {
    const [task] = parseTasks('- [ ] **1.2 Add behavior**\n  Refs: REQ-001, API-001\n');
    assert.equal(task.id, '1.2');
    assert.deepEqual(task.refs, ['REQ-001', 'API-001']);
  });

  it('rejects a design item that no task implements', () => {
    const dir = writeBrownfieldChange();
    editTraceability(dir, trace => {
      trace.design_items.push({ id: 'IMPACT-001', kind: 'impact', requirements: ['REQ-001'], files: ['FILE-001'], risk: 'low' });
      trace.requirements[0].design_items.push('IMPACT-001');
      trace.requirements[0].task_ids.push('1.1');
    });
    appendTechnicalDesign(dir, '## Impact Analysis\n\n### IMPACT-001: Existing callers\n\n- Affected callers: hr-web\n- Compatibility: unchanged\n- Regression: query path\n');
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(entry => entry.message === 'IMPACT-001 has no mapped task'), JSON.stringify(report.issues));
  });

  it('rejects a controlled file that no design item or task references', () => {
    const dir = writeBrownfieldChange();
    editTraceability(dir, trace => { trace.files.push({ id: 'FILE-002', path: 'src/orphan.mjs' }); });
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(entry => entry.message === 'FILE-002 is not referenced by any design item'));
    assert.ok(report.issues.some(entry => entry.message === 'FILE-002 is not referenced by any task'));
  });

  it('rejects a declared boundary without a matching design item', () => {
    const dir = writeBrownfieldChange();
    writeFileSync(join(dir, 'proposal.md'), [
      '# Proposal', '', '## Engineering Profile', '',
      '- **Profile**: brownfield', '- **Boundaries**: api, database', '',
    ].join('\n'));
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(entry => entry.message === "declared boundary 'database' has no DB design item"), JSON.stringify(report.issues));
  });

  it('requires a mapped test for api and database items regardless of declared risk', () => {
    const dir = writeBrownfieldChange();
    editTraceability(dir, trace => {
      trace.design_items[0].risk = 'low';
      trace.tests[0].design_items = [];
      trace.requirements[0].test_ids = [];
      trace.tasks[0].tests = [];
      writeFileSync(join(dir, 'tasks.md'), brownfieldTask('REQ-001, API-001, FILE-001'));
    });
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(entry => entry.message === 'API-001 (api) has no mapped test'), JSON.stringify(report.issues));
  });

  it('reports a missing tasks.md instead of throwing', () => {
    const dir = writeBrownfieldChange();
    rmSync(join(dir, 'tasks.md'));
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(entry => entry.message === 'tasks.md is required by traceability.json'));
  });

  it('prints the requirement-to-test mapping for a valid brownfield change', () => {
    const dir = writeBrownfieldChange();
    const lines = formatTechnicalMapping(validateTechnicalChange(dir).traceability);
    assert.ok(lines.includes('REQ-001 -> API-001 -> task 1.1 -> TEST-001'), lines.join('\n'));
    assert.ok(lines.includes('API-001 -> task 1.1 -> TEST-001'), lines.join('\n'));
  });

  it('rejects a duplicate Requirement ID in the specs', () => {
    const dir = writeBrownfieldChange();
    writeFileSync(join(dir, 'specs', 'salary', 'spec.md'), `${readSpec()}\n### Requirement: REQ-001 — Duplicate\n\nThe service SHALL duplicate.\n\n#### Scenario: Duplicate\n\n- **WHEN** it runs\n- **THEN** it fails\n`);
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(entry => entry.message === 'Duplicate Requirement ID REQ-001'));
  });

  it('rejects a design item without a level-three heading', () => {
    const dir = writeBrownfieldChange();
    writeFileSync(join(dir, 'technical-design.md'), readTechnicalDesign().replace('### API-001: Create adjustment', 'API-001 lives only in prose'));
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(entry => entry.message === 'API-001 has no matching level-three heading'));
  });

  it('rejects a design item declared under the wrong section', () => {
    const dir = writeBrownfieldChange();
    writeFileSync(join(dir, 'technical-design.md'), readTechnicalDesign().replace('## API', '## Database'));
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(entry => entry.message === "API-001 must be declared under its own section, not '## Database'"));
  });

  it('rejects an unknown reference in the map', () => {
    const dir = writeBrownfieldChange();
    editTraceability(dir, trace => { trace.tests[0].design_items = ['API-001', 'API-999']; });
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(entry => entry.message === 'TEST-001 references unknown API-999 in design_items'));
  });

  it('rejects a duplicate id inside a collection', () => {
    const dir = writeBrownfieldChange();
    editTraceability(dir, trace => { trace.files.push({ id: 'FILE-001', path: 'src/other.mjs' }); });
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(entry => entry.message === "Duplicate files id 'FILE-001'"));
  });

  it('rejects a mis-prefixed id and an unsafe file path', () => {
    const dir = writeBrownfieldChange();
    editTraceability(dir, trace => {
      trace.files.push({ id: 'ART-001', path: 'src/third.mjs' });
      trace.files.push({ id: 'FILE-003', path: '../escape.mjs' });
    });
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(entry => entry.message === "files id 'ART-001' must use FILE-<number>"));
    assert.ok(report.issues.some(entry => entry.message === "FILE-003 has unsafe file path '../escape.mjs'"));
  });

  it('requires the ARCH fields the template declares', () => {
    const dir = writeBrownfieldChange();
    editTraceability(dir, trace => {
      trace.design_items.push({ id: 'ARCH-001', kind: 'architecture', requirements: ['REQ-001'], files: ['FILE-001'], risk: 'low' });
      trace.requirements[0].design_items.push('ARCH-001');
      trace.tasks[0].design_items.push('ARCH-001');
    });
    writeFileSync(join(dir, 'tasks.md'), brownfieldTask('REQ-001, API-001, ARCH-001, FILE-001, TEST-001'));
    writeFileSync(join(dir, 'technical-design.md'), `${readTechnicalDesign()}\n## Architecture\n\n### ARCH-001: Ownership\n\n- Owner: salary-service\n`);
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(entry => entry.message === "ARCH-001 requires 'Consumers'"));
    assert.ok(report.issues.some(entry => entry.message === "ARCH-001 requires 'Transaction boundary'"));
  });

  it('requires a traceable task to state its proof command', () => {
    const dir = writeBrownfieldChange();
    writeFileSync(join(dir, 'tasks.md'), '- [ ] **1.1 Build the endpoint**：修改 `src/adjustment.mjs`\n  Refs: REQ-001, API-001, FILE-001, TEST-001\n');
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(entry => entry.message === 'Task 1.1 needs a proof command (证明：`<command>`)'));
  });

  it('requires a traceable task to name the file it changes', () => {
    const dir = writeBrownfieldChange();
    writeFileSync(join(dir, 'tasks.md'), '- [ ] **1.1 Build the endpoint**\n  Refs: REQ-001, API-001, FILE-001, TEST-001\n  证明：`node --test`\n');
    const report = validateTechnicalChange(dir);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(entry => entry.message === 'Task 1.1 must name the file it changes (src/adjustment.mjs)'));
  });
});

function editTraceability(dir, mutate) {
  const path = join(dir, 'traceability.json');
  const trace = JSON.parse(readFileSync(path, 'utf8'));
  mutate(trace);
  writeFileSync(path, JSON.stringify(trace, null, 2));
}

function appendTechnicalDesign(dir, section) {
  writeFileSync(join(dir, 'technical-design.md'), `${readTechnicalDesign()}\n${section}`);
}

function createChange() {
  const dir = mkdtempSync(join(tmpdir(), 'ssf-technical-'));
  directories.push(dir);
  return dir;
}

function writeBrownfieldChange() {
  const dir = createChange();
  mkdirSync(join(dir, 'specs', 'salary'), { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), [
    '# Proposal', '', '## Engineering Profile', '', '- **Profile**: brownfield', '- **Boundaries**: api', '',
  ].join('\n'));
  writeFileSync(join(dir, 'specs', 'salary', 'spec.md'), readSpec());
  writeFileSync(join(dir, 'technical-design.md'), readTechnicalDesign());
  writeFileSync(join(dir, 'tasks.md'), brownfieldTask('REQ-001, API-001, FILE-001, TEST-001'));
  writeFileSync(join(dir, 'traceability.json'), JSON.stringify({
    ...readTraceability('brownfield'),
  }, null, 2));
  return dir;
}

function writeStandardChange() {
  const dir = createChange();
  mkdirSync(join(dir, 'specs', 'salary'), { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), '# Proposal\n\n## Engineering Profile\n\n- **Profile**: standard\n- **Boundaries**:\n');
  writeFileSync(join(dir, 'specs', 'salary', 'spec.md'), readSpec());
  writeFileSync(join(dir, 'tasks.md'), brownfieldTask('REQ-001, API-001, FILE-001, TEST-001'));
  return dir;
}

function writeStandardArtifacts(dir) {
  writeFileSync(join(dir, 'technical-design.md'), readTechnicalDesign());
  writeFileSync(join(dir, 'traceability.json'), JSON.stringify(readTraceability('standard'), null, 2));
}

// The map is identical for both profiles; only its declared profile differs.
function readTraceability(profile) {
  return {
    schema_version: 1, profile,
    requirements: [{ id: 'REQ-001', design_items: ['API-001'], task_ids: ['1.1'], test_ids: ['TEST-001'] }],
    design_items: [{ id: 'API-001', kind: 'api', requirements: ['REQ-001'], files: ['FILE-001'], risk: 'high' }],
    files: [{ id: 'FILE-001', path: 'src/adjustment.mjs' }],
    tasks: [{ id: '1.1', requirements: ['REQ-001'], design_items: ['API-001'], files: ['FILE-001'], tests: ['TEST-001'] }],
    tests: [{ id: 'TEST-001', requirements: ['REQ-001'], design_items: ['API-001'], command: 'node --test' }],
  };
}

function brownfieldTask(refs) {
  return `- [ ] **1.1 Build the endpoint**：修改 \`src/adjustment.mjs\`\n  Refs: ${refs}\n  证明：\`node --test\`\n`;
}

function readSpec() {
  return [
    '## ADDED Requirements', '', '### Requirement: REQ-001 — Create adjustment', '',
    'The service SHALL create a salary adjustment.', '', '#### Scenario: Create adjustment',
    '- **WHEN** an authorized user submits an adjustment', '- **THEN** the service returns the new adjustment', '',
  ].join('\n');
}

function readTechnicalDesign() {
  return [
    '# Technical Design', '', '## API', '', '### API-001: Create adjustment', '',
    '- Method: POST', '- Path: /adjustments', '- Request: salary', '- Response: adjustment',
    '- Authorization: salary.write', '- Compatibility: additive', '',
  ].join('\n');
}
