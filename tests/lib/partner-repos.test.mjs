// End-to-end coverage for the multi-repo partner feature: configuration
// parsing, provisioning (clone / baseline / development branch), the
// write-once start anchors, the completion dry-run gate, and cross-repo
// FILE references in traceability.json.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { loadPartnerRepos, partnerStatus, partnerDevelopmentBranch, provisionPartner, protectedDirectCommits } from '../../scripts/lib/partner-repos.mjs';
import { validateTechnicalChange } from '../../scripts/lib/technical-validation.mjs';

const CLI = join(process.cwd(), 'scripts', 'spec-superflow.mjs');
const directories = [];

afterEach(() => {
  while (directories.length) rmSync(directories.pop(), { recursive: true, force: true });
});

function createRoot({ partnerConfig } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ssf-partner-root-'));
  directories.push(root);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'tests@example.invalid');
  git('config', 'user.name', 'Partner Test');
  writeFileSync(join(root, 'README.md'), 'primary seed\n');
  if (partnerConfig) writeFileSync(join(root, 'spec-superflow.config.json'), JSON.stringify({ partner_repos: partnerConfig }, null, 2));
  git('add', '-A');
  git('commit', '-qm', 'primary seed');
  const changeDir = join(root, 'openspec', 'changes', 'demo');
  mkdirSync(changeDir, { recursive: true });
  return { root, changeDir, git };
}

function createPartnerRepo(path, { branch = 'master' } = {}) {
  mkdirSync(path, { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', branch);
  git('config', 'user.email', 'tests@example.invalid');
  git('config', 'user.name', 'Partner Test');
  writeFileSync(join(path, 'README.md'), 'partner seed\n');
  git('add', '-A');
  git('commit', '-qm', 'partner seed');
  return { path, head: git('rev-parse', 'HEAD'), git };
}

describe('partner-repos: configuration', () => {
  it('returns an empty list when the config has no partner_repos', () => {
    const { root } = createRoot();
    assert.deepEqual(loadPartnerRepos(root), []);
  });

  it('resolves a relative path against the primary repo root and defaults the branch', () => {
    const { root } = createRoot({ partnerConfig: [{ name: 'web', path: '../partner-web' }] });
    const partners = loadPartnerRepos(root);
    assert.equal(partners.length, 1);
    assert.equal(partners[0].name, 'web');
    assert.equal(partners[0].branch, 'master');
    assert.ok(partners[0].path.endsWith('partner-web'), `resolved path: ${partners[0].path}`);
  });

  it('rejects unsafe names, duplicates and a missing path', () => {
    const { root } = createRoot({ partnerConfig: [{ name: 'bad/name', path: '../x' }] });
    assert.throws(() => loadPartnerRepos(root), /safe single path segment/);
    writeFileSync(join(root, 'spec-superflow.config.json'), JSON.stringify({
      partner_repos: [
        { name: 'web', path: '../a' },
        { name: 'web', path: '../b' },
      ],
    }));
    assert.throws(() => loadPartnerRepos(root), /duplicate partner name/);
    writeFileSync(join(root, 'spec-superflow.config.json'), JSON.stringify({ partner_repos: [{ name: 'web' }] }));
    assert.throws(() => loadPartnerRepos(root), /path is required/);
  });
});

describe('partner-repos: provisioning', () => {
  it('cuts a development branch from the baseline and records its anchor', () => {
    const { root } = createRoot({ partnerConfig: [{ name: 'web', path: '../partner-web', branch: 'master' }] });
    const partner = { name: 'web', path: join(root, '..', `partner-web-${basename(root)}`), branch: 'master' };
    directories.push(partner.path);
    const repo = createPartnerRepo(partner.path);

    const result = provisionPartner(partner, 'demo');
    assert.equal(result.provisioned, true);
    assert.equal(result.branch, 'master');
    assert.equal(result.head, repo.head);
    assert.equal(partnerStatus(partner).branch, partnerDevelopmentBranch(partner, 'demo'));
  });

  it('is idempotent on a development branch and resumes an existing one', () => {
    const { root } = createRoot();
    const partner = { name: 'web', path: join(root, '..', `partner-web-${basename(root)}`), branch: 'master' };
    directories.push(partner.path);
    const repo = createPartnerRepo(partner.path);

    const first = provisionPartner(partner, 'demo');
    assert.equal(first.provisioned, true);
    assert.equal(first.head, repo.head);
    const second = provisionPartner(partner, 'demo');
    assert.equal(second.provisioned, false);
    assert.equal(second.head, first.head, 'an idempotent provision must not move the baseline anchor');

    repo.git('checkout', '-q', 'master');
    const resumed = provisionPartner(partner, 'demo');
    assert.equal(resumed.provisioned, false, 'an existing development branch is resumed, never rebuilt');
    assert.equal(partnerStatus(partner).branch, partnerDevelopmentBranch(partner, 'demo'));
  });

  it('clones from the configured url when the path is missing', () => {
    const { root } = createRoot();
    const seed = mkdtempSync(join(tmpdir(), 'ssf-partner-seed-'));
    directories.push(seed);
    const seeded = createPartnerRepo(join(seed, 'seed'));
    seeded.git('config', 'user.email', 'tests@example.invalid');
    seeded.git('config', 'user.name', 'Partner Test');
    writeFileSync(join(seed, 'seed', 'extra.md'), 'seed extra\n');
    seeded.git('add', '-A');
    seeded.git('commit', '-qm', 'seed extra');

    const partner = { name: 'web', path: join(root, '..', `partner-web-${basename(root)}`), url: join(seed, 'seed'), branch: 'master' };
    const result = provisionPartner(partner, 'demo');
    assert.equal(result.provisioned, true);
    assert.equal(partnerStatus(partner).branch, partnerDevelopmentBranch(partner, 'demo'));
    assert.ok(partnerStatus(partner).head, 'cloned repo has a HEAD');
  });

  it('lists direct protected-branch commits since the anchor and nothing on a development branch', () => {
    const { root } = createRoot();
    const partner = { name: 'web', path: join(root, '..', `partner-web-${basename(root)}`), branch: 'master' };
    directories.push(partner.path);
    const repo = createPartnerRepo(partner.path);
    const anchor = repo.head;

    assert.deepEqual(protectedDirectCommits(partner, anchor), [], 'clean baseline yields no violations');

    writeFileSync(join(partner.path, 'in-place.md'), 'edited on master\n');
    repo.git('add', '-A');
    repo.git('commit', '-qm', 'edit master in place');
    const commits = protectedDirectCommits(partner, anchor);
    assert.equal(commits.length, 1);
    assert.match(commits[0], /edit master in place/);

    provisionPartner(partner, 'demo');
    assert.deepEqual(protectedDirectCommits(partner, anchor), [], 'development-branch work is not a protected violation');
  });
});

describe('partner-repos: start anchors and the completion gate', () => {
  function seedChange(root, changeDir, partnerConfig) {
    writeFileSync(join(root, 'spec-superflow.config.json'), JSON.stringify({ partner_repos: partnerConfig }, null, 2));
    writeFileSync(join(changeDir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: auto\n');
    const run = args => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
    const started = run(['workflow', 'start', changeDir, '--path', 'direct', '--scope', 'partner gate coverage']);
    assert.equal(started.status, 0, started.stderr);
    return run;
  }

  it('records write-once partner anchors on workflow start', () => {
    const { root, changeDir } = createRoot();
    const partnerRel = `partner-web-${basename(root)}`;
    const partnerPath = join(root, '..', partnerRel);
    directories.push(partnerPath);
    const repo = createPartnerRepo(partnerPath);
    const run = seedChange(root, changeDir, [{ name: 'web', path: `../${partnerRel}`, branch: 'master' }]);

    const stateFile = readFileSync(join(changeDir, '.spec-superflow.yaml'), 'utf8');
    assert.match(stateFile, /partner_anchors: \{"web":"[0-9a-f]{40}"\}/);
    const firstAnchor = stateFile.match(/partner_anchors: \{"web":"([0-9a-f]{40})"\}/)[1];

    // A re-approved start after a newer baseline commit must not move the
    // anchor: write-once, exactly like review_base.
    writeFileSync(join(partnerPath, 'later.md'), 'later baseline work\n');
    repo.git('add', '-A');
    repo.git('commit', '-qm', 'later baseline work');
    const again = run(['workflow', 'start', changeDir, '--path', 'direct', '--scope', 'partner gate coverage']);
    assert.equal(again.status, 0, again.stderr);
    const after = readFileSync(join(changeDir, '.spec-superflow.yaml'), 'utf8');
    assert.ok(after.includes(`"web":"${firstAnchor}"`), 'the anchor is write-once');
  });

  it('dry-run blocks completion when a partner was edited in place on master', () => {
    const { root, changeDir } = createRoot();
    const partnerRel = `partner-web-${basename(root)}`;
    const partnerPath = join(root, '..', partnerRel);
    directories.push(partnerPath);
    const repo = createPartnerRepo(partnerPath);
    seedChange(root, changeDir, [{ name: 'web', path: `../${partnerRel}`, branch: 'master' }]);

    // After provisioning the partner sits on its development branch; the
    // violation is new work committed directly on the protected baseline.
    repo.git('checkout', '-q', 'master');
    writeFileSync(join(partnerPath, 'in-place.md'), 'edited on master\n');
    repo.git('add', '-A');
    repo.git('commit', '-qm', 'edit master in place');

    const dry = spawnSync(process.execPath, [CLI, 'workflow', 'complete', changeDir, '--dry-run', '--json'], { encoding: 'utf8' });
    const report = JSON.parse(dry.stdout);
    const check = report.checks.find(entry => entry.name === 'partner repositories');
    assert.equal(check.pass, false);
    assert.match(check.detail, /1 direct commit\(s\) on protected branch 'master'/);
    assert.match(check.fix, /development branch/);
  });
});

describe('partner-repos: cross-repo traceability FILE references', () => {
  function brownfieldChange(root, changeDir, filePath) {
    mkdirSync(join(changeDir, 'specs', 'salary'), { recursive: true });
    writeFileSync(join(changeDir, 'proposal.md'), [
      '# Proposal', '', '## Engineering Profile', '', '- **Profile**: brownfield', '- **Boundaries**: api', '',
    ].join('\n'));
    writeFileSync(join(changeDir, 'specs', 'salary', 'spec.md'), [
      '## ADDED Requirements', '', '### Requirement: REQ-001 — Create adjustment', '',
      'The service SHALL create a salary adjustment.', '', '#### Scenario: Create adjustment', '',
      '- **WHEN** a user submits', '- **THEN** it returns', '',
    ].join('\n'));
    writeFileSync(join(changeDir, 'technical-design.md'), [
      '# Technical Design', '', '## API', '', '### API-001: Create adjustment', '',
      '- Method: POST', '- Path: /adjustments', '- Request: salary', '- Response: adjustment',
      '- Authorization: salary.write', '- Compatibility: additive', '',
    ].join('\n'));
    const inRepoPath = filePath.includes(':') ? filePath.split(':')[1] : filePath;
    writeFileSync(join(changeDir, 'tasks.md'), [
      `- [ ] **1.1 Build the endpoint**：修改 ${inRepoPath}`, '',
      '  Refs: REQ-001, API-001, FILE-001, TEST-001', '  证明：`node --test`', '',
    ].join('\n'));
    writeFileSync(join(changeDir, 'traceability.json'), JSON.stringify({
      schema_version: 1,
      profile: 'brownfield',
      requirements: [{ id: 'REQ-001', design_items: ['API-001'], task_ids: ['1.1'], test_ids: ['TEST-001'] }],
      design_items: [{ id: 'API-001', kind: 'api', requirements: ['REQ-001'], files: ['FILE-001'], risk: 'high' }],
      files: [{ id: 'FILE-001', path: filePath }],
      tasks: [{ id: '1.1', requirements: ['REQ-001'], design_items: ['API-001'], files: ['FILE-001'], tests: ['TEST-001'] }],
      tests: [{ id: 'TEST-001', requirements: ['REQ-001'], design_items: ['API-001'], command: 'node --test' }],
    }, null, 2));
  }

  it('accepts a FILE path in a configured partner repo', () => {
    const { root, changeDir } = createRoot({ partnerConfig: [{ name: 'partnerSalary-web', path: '../partnerSalary-web' }] });
    brownfieldChange(root, changeDir, 'partnerSalary-web:src/api/salary.ts');
    const report = validateTechnicalChange(changeDir);
    assert.equal(report.valid, true, JSON.stringify(report.issues));
  });

  it('rejects a partner prefix that is not configured', () => {
    const { root, changeDir } = createRoot();
    brownfieldChange(root, changeDir, 'unknownRepo:src/api/salary.ts');
    const report = validateTechnicalChange(changeDir);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(entry => entry.message.includes('unsafe file path')), JSON.stringify(report.issues));
  });
});
