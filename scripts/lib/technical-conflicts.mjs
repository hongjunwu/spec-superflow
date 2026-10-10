import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getPlanScopedPaths } from './sdd-overlay.mjs';
import { readTraceability, validateTechnicalChange } from './technical-validation.mjs';

export function recordTechnicalConflict(changeDir, plan, input) {
  const technical = validateTechnicalChange(changeDir);
  if (!technical.valid || technical.profile !== 'brownfield') {
    throw new Error('Technical conflicts can only be recorded for a valid brownfield plan');
  }
  const taskId = requireText(input?.taskId, 'task');
  const summary = requireText(input?.summary, 'summary');
  const why = requireText(input?.why, 'why');
  const next = requireText(input?.next, 'next');
  const traceability = readTraceability(changeDir).value;
  const task = traceability.tasks.find(candidate => candidate.id === taskId);
  if (!task) throw new Error(`Task '${taskId}' is not declared in traceability.json`);
  const affected = Array.isArray(input?.affected) ? input.affected : [];
  if (affected.length === 0) throw new Error('affected requires at least one traceability id');
  const known = new Set([
    ...traceability.requirements.map(item => item.id),
    ...traceability.design_items.map(item => item.id),
    ...traceability.files.map(item => item.id),
    ...traceability.tasks.map(item => item.id),
    ...traceability.tests.map(item => item.id),
  ]);
  for (const id of affected) if (!known.has(id)) throw new Error(`affected references unknown id '${id}'`);

  const paths = getPlanScopedPaths(changeDir, plan);
  mkdirSync(paths.conflicts, { recursive: true });
  const record = {
    id: randomUUID(), task_id: taskId, summary, why, affected, next,
    plan_hash: plan.hash, plan_revision: plan.revision, recorded_at: new Date().toISOString(),
  };
  const target = path.join(paths.conflicts, `${conflictFileName(taskId, record.recorded_at, paths.conflicts)}.md`);
  atomicWrite(target, renderConflict(record));
  return { ...record, path: path.relative(changeDir, target).split(path.sep).join('/') };
}

// <task-id>-<timestamp>.md, disambiguated only when the same task records a
// second conflict inside the same second, so a report is never overwritten.
function conflictFileName(taskId, recordedAt, directory) {
  const safeTaskId = taskId.replace(/[^0-9A-Za-z._-]/g, '_');
  const stamp = recordedAt.replace(/[:.]/g, '-');
  const base = `${safeTaskId}-${stamp}`;
  if (!existsSync(path.join(directory, `${base}.md`))) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existsSync(path.join(directory, `${candidate}.md`))) return candidate;
  }
  return `${base}-${randomUUID()}`;
}

export function listOpenTechnicalConflicts(changeDir, plan) {
  const directory = getPlanScopedPaths(changeDir, plan).conflicts;
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(name => name.endsWith('.md')).sort().map(name => {
    const record = parseConflict(readFileSync(path.join(directory, name), 'utf8'));
    return { ...record, path: path.relative(changeDir, path.join(directory, name)).split(path.sep).join('/') };
  }).filter(record => record.plan_hash === plan.hash && Number(record.plan_revision) === plan.revision);
}

export function assertTechnicalDiffMapped(changeDir, plan, base, head) {
  const technical = validateTechnicalChange(changeDir);
  if (!technical.valid || technical.profile !== 'brownfield') return;
  const traceability = readTraceability(changeDir).value;
  const patterns = traceability.files.map(file => file.path.replace(/\\/g, '/'));
  const repoRoot = execFileSync('git', ['-C', changeDir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  // realpath both sides before comparing: git resolves 8.3 short-name temp
  // dirs (CI Windows runners use C:\Users\RUNNER~1\...) while fs.tmpdir()
  // does not, and a mixed-form pair makes path.relative walk outside the
  // repo, silently disabling the change-dir exclusion below.
  const changeRelative = path.relative(realpathSync.native(repoRoot), realpathSync.native(changeDir)).split(path.sep).join('/');
  const diff = execFileSync('git', ['-C', changeDir, 'diff', '--name-only', base, head], { encoding: 'utf8' })
    .split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const unmapped = diff.filter(file => {
    const normalized = file.replace(/\\/g, '/');
    if (normalized === changeRelative || normalized.startsWith(`${changeRelative}/`)) return false;
    return !patterns.some(pattern => globMatches(pattern, normalized));
  });
  if (unmapped.length > 0) throw new Error(`Brownfield review contains files absent from traceability.json: ${unmapped.join(', ')}`);
}

function renderConflict(record) {
  const metadata = Object.entries(record).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
  return `---\n${metadata}\n---\n\n# Technical Conflict: ${record.task_id}\n\n## Detected Conflict\n${record.summary}\n\n## Affected\n${record.affected.join(', ')}\n\n## Why Execution Cannot Resolve It Safely\n${record.why}\n\n## Required Next Action\n${record.next}\n`;
}

function parseConflict(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== '---') throw new Error('Technical conflict is missing frontmatter');
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new Error('Technical conflict frontmatter is not closed');
  const record = {};
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!match) continue;
    try { record[match[1]] = JSON.parse(match[2]); } catch { record[match[1]] = match[2]; }
  }
  return record;
}

function globMatches(pattern, value) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') { source += '(?:.*/)?'; index += 2; }
      else { source += '.*'; index += 1; }
    } else if (char === '*') source += '[^/]*';
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`).test(value);
}

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) throw new Error(`${name} requires non-empty single-line text`);
  return value.trim();
}

function atomicWrite(target, content) {
  const temp = `${target}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temp, content, 'utf8');
  renameSync(temp, target);
}
