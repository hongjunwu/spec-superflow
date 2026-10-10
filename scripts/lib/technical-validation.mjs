import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseTasks } from './task-parser.mjs';
import { projectRootForChange } from './layout.mjs';
import { loadPartnerRepos } from './partner-repos.mjs';
import { findCanonicalSpecFiles, relativeSpecPath } from './spec-paths.mjs';

export const TECHNICAL_VALIDATOR_VERSION = 1;

const PROFILE_BOUNDARIES = new Set([
  'api', 'database', 'integration', 'public-model', 'permission', 'migration', 'impact',
]);
// Boundaries name the high-impact surfaces a change claims to touch. Each
// boundary that has a machine-checkable design kind must be covered by at least
// one design item, so "Boundaries: database" cannot ship with an API-only
// design. `permission` and `impact` have no dedicated kind and are declarative.
const BOUNDARY_KIND = {
  api: 'api',
  database: 'database',
  integration: 'integration',
  'public-model': 'model',
  migration: 'migration',
};
const KIND_PREFIX = {
  api: 'API', database: 'DB', model: 'MODEL', integration: 'INT', impact: 'IMPACT',
  architecture: 'ARCH', migration: 'MIGRATION',
};
// Each design kind belongs to one level-two section of technical-design.md, so a
// design item cannot silently live under the wrong heading.
const KIND_SECTION = {
  architecture: /^architecture$/i,
  api: /^api$/i,
  database: /^database$/i,
  model: /^model$/i,
  integration: /^integration$/i,
  impact: /^impact analysis$/i,
  migration: /^migration$/i,
};
// Kinds that promise an externally observable contract always need a test, not
// only when the author self-declares high risk.
const MANDATORY_TEST_KINDS = new Set(['api', 'database']);
const REQUIRED_FIELDS = {
  api: ['Method', 'Path', 'Request', 'Response', 'Authorization', 'Compatibility'],
  database: ['Columns', 'Constraints', 'Rollback'],
  impact: ['Affected callers', 'Compatibility', 'Regression'],
  architecture: ['Owner', 'Consumers', 'Transaction boundary'],
};
// A traceable task states how to prove it, and names the boundary it touches.
const PROOF_MARKER = /(?:证明|Proof)\s*[:：]\s*`[^`]+`/i;

export function readEngineeringProfile(changeDir) {
  const proposalPath = path.join(changeDir, 'proposal.md');
  if (!existsSync(proposalPath)) {
    return { profile: 'standard', boundaries: [], sectionPresent: false, errors: [] };
  }
  return parseEngineeringProfile(readFileSync(proposalPath, 'utf8'));
}

export function parseEngineeringProfile(content) {
  const normalized = String(content).replace(/\r\n?/g, '\n');
  const match = normalized.match(/^##\s+Engineering Profile\s*$/im);
  if (!match || match.index === undefined) {
    const errors = [];
    // The author clearly intended to declare a profile but the section is not
    // machine-readable. Without this diagnostic the change silently falls back
    // to standard and the failure surfaces later as a misleading
    // "profile must be 'standard'" error from traceability validation.
    if (/engineering profile/i.test(normalized) && /brownfield/i.test(normalized)) {
      errors.push('proposal.md mentions "Engineering Profile" and "brownfield" but no parseable section was found; expected a level-two heading "## Engineering Profile" containing a list item "- Profile: brownfield"');
    }
    return { profile: 'standard', boundaries: [], sectionPresent: false, errors };
  }
  const section = normalized.slice(match.index + match[0].length).split(/^##\s+/m, 1)[0];
  const profileMatch = section.match(/^\s*-\s*(?:\*\*)?Profile(?:\*\*)?\s*:\s*([^\s]+)\s*$/im);
  const boundariesMatch = section.match(/^\s*-\s*(?:\*\*)?Boundaries(?:\*\*)?\s*:\s*(.*?)\s*$/im);
  const compatibilityMatch = section.match(/^\s*-\s*(?:\*\*)?Compatibility(?:\*\*)?\s*:\s*(.*?)\s*$/im);
  const affectedSystemsMatch = section.match(/^\s*-\s*(?:\*\*)?Affected systems(?:\*\*)?\s*:\s*(.*?)\s*$/im);
  const errors = [];
  const profile = profileMatch?.[1]?.toLowerCase();
  if (!profile || !['standard', 'brownfield'].includes(profile)) {
    errors.push("Engineering Profile must declare Profile: standard or brownfield as a list item in the form '- Profile: brownfield'");
  }
  const boundaries = boundariesMatch?.[1]
    ? boundariesMatch[1].split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
    : [];
  for (const boundary of boundaries) {
    if (!PROFILE_BOUNDARIES.has(boundary)) errors.push(`Unknown engineering boundary '${boundary}'`);
  }
  if (profile === 'standard' && boundaries.length > 0) {
    errors.push('standard Engineering Profile must not declare Brownfield boundaries');
  }
  if (profile === 'brownfield' && boundaries.length === 0) {
    errors.push('brownfield Engineering Profile requires at least one boundary');
  }
  const affectedSystems = affectedSystemsMatch?.[1]
    ? affectedSystemsMatch[1].split(',').map(value => value.trim()).filter(Boolean)
    : [];
  return {
    profile: profile ?? 'standard',
    boundaries,
    sectionPresent: true,
    errors,
    // Declarative context. Kept for reviewers and future rules; no rule depends on it yet.
    compatibility: compatibilityMatch?.[1]?.trim() || null,
    affectedSystems,
  };
}

export function isBrownfieldChange(changeDir) {
  return readEngineeringProfile(changeDir).profile === 'brownfield';
}

/**
 * The technical evidence a brownfield execution plan must record so the
 * approved design stays bound to the plan. Returns undefined for standard
 * changes (their plans keep today's semantics), and throws for any change whose
 * technical artifacts are invalid so callers cannot persist a plan over them.
 */
export function technicalValidationEvidence(changeDir) {
  const report = validateTechnicalChange(changeDir);
  if (!report.valid) {
    throw new Error(`Technical validation failed: ${report.issues.map(entry => `${entry.path}: ${entry.message}`).join('; ')}`);
  }
  if (report.profile !== 'brownfield') return undefined;
  return {
    profile: 'brownfield',
    validator_version: TECHNICAL_VALIDATOR_VERSION,
    technical_contract_hash: report.technical_contract_hash,
    status: 'pass',
  };
}

/**
 * Human-readable coverage lines for a passing brownfield validation:
 *   REQ-001 -> API-001, DB-001 -> tasks 1.1, 1.2 -> TEST-001, TEST-002
 *   API-001 -> task 1.1 -> TEST-001
 */
export function formatTechnicalMapping(traceability) {
  if (!isObject(traceability)) return [];
  const requirements = Array.isArray(traceability.requirements) ? traceability.requirements : [];
  const designItems = Array.isArray(traceability.design_items) ? traceability.design_items : [];
  const tasks = Array.isArray(traceability.tasks) ? traceability.tasks : [];
  const tests = Array.isArray(traceability.tests) ? traceability.tests : [];
  const list = values => (values.length ? values.join(', ') : 'none');
  const lines = [];
  for (const requirement of requirements) {
    lines.push([
      requirement?.id,
      list(requirement?.design_items ?? []),
      list((requirement?.task_ids ?? []).map(id => `task ${id}`)),
      list(requirement?.test_ids ?? []),
    ].join(' -> '));
  }
  for (const item of designItems) {
    const owningTasks = tasks.filter(task => (task?.design_items ?? []).includes(item?.id)).map(task => `task ${task.id}`);
    const owningTests = tests.filter(test => (test?.design_items ?? []).includes(item?.id)).map(test => test.id);
    lines.push([item?.id, list(owningTasks), list(owningTests)].join(' -> '));
  }
  return lines;
}

export function technicalContractHash(changeDir) {
  const hash = createHash('sha256');
  for (const name of ['technical-design.md', 'traceability.json']) {
    const filePath = path.join(changeDir, name);
    if (!existsSync(filePath)) return null;
    hash.update(readFileSync(filePath, 'utf8'));
  }
  return `sha256:${hash.digest('hex')}`;
}

export function readTraceability(changeDir) {
  const filePath = path.join(changeDir, 'traceability.json');
  if (!existsSync(filePath)) return { value: null, error: 'traceability.json is required' };
  try {
    return { value: JSON.parse(readFileSync(filePath, 'utf8')), error: null };
  } catch (error) {
    return { value: null, error: `traceability.json is not valid JSON: ${error.message}` };
  }
}

export function validateTechnicalChange(changeDir) {
  const profile = readEngineeringProfile(changeDir);
  const issues = profile.errors.map(message => issue('proposal.md', message));
  const technicalPath = path.join(changeDir, 'technical-design.md');
  const tracePath = path.join(changeDir, 'traceability.json');
  const hasTechnical = existsSync(technicalPath);
  const hasTrace = existsSync(tracePath);
  const brownfield = profile.profile === 'brownfield';

  // A standard change without the optional technical design stays on today's
  // compact flow. With it, the artifacts must satisfy the same format.
  if (!brownfield && !hasTechnical && !hasTrace) {
    return report(profile, issues, null, null, false);
  }

  if (brownfield) {
    if (!hasTechnical) issues.push(issue('technical-design.md', 'technical-design.md is required for brownfield changes'));
    if (!hasTrace) issues.push(issue('traceability.json', 'traceability.json is required for brownfield changes'));
  } else if (hasTechnical !== hasTrace) {
    issues.push(issue('proposal.md', 'technical-design.md and traceability.json must be provided together'));
  }

  const trace = readTraceability(changeDir);
  if (trace.error && hasTrace) issues.push(issue('traceability.json', trace.error));
  if (issues.length > 0) return report(profile, issues, null, trace.value, true);
  if (!trace.value) return report(profile, issues, null, null, true);

  // Requirement↔spec binding is what makes the map a business traceability root,
  // so it stays a brownfield obligation; a standard change keeps its existing
  // spec heading format and is checked for internal consistency only.
  const requirements = brownfield ? readRequirementIds(changeDir, issues) : null;
  const headings = readTechnicalHeadings(readFileSync(technicalPath, 'utf8'));
  validateTraceability(trace.value, { requirements, brownfield }, headings, brownfield ? profile.boundaries : [], changeDir, issues);
  return report(profile, issues, technicalContractHash(changeDir), trace.value, true);
}

function validateTraceability(trace, { requirements, brownfield }, headings, boundaries, changeDir, issues) {
  if (!isObject(trace)) {
    issues.push(issue('traceability.json', 'traceability root must be an object'));
    return;
  }
  if (trace.schema_version !== 1) issues.push(issue('traceability.json', 'schema_version must be 1'));
  const expectedProfile = brownfield ? 'brownfield' : 'standard';
  if (trace.profile !== expectedProfile) {
    // A brownfield trace paired with a standard-parsed proposal almost always
    // means the proposal's Engineering Profile section exists but was not
    // recognized — point at that root cause instead of demanding the opposite.
    const hint = !brownfield && trace.profile === 'brownfield'
      ? " — the proposal's Engineering Profile parsed as 'standard'; check that proposal.md has a level-two heading '## Engineering Profile' with a list item '- Profile: brownfield'"
      : '';
    issues.push(issue('traceability.json', `profile must be '${expectedProfile}'${hint}`));
  }
  const collections = ['requirements', 'design_items', 'files', 'tasks', 'tests'];
  for (const collection of collections) {
    if (!Array.isArray(trace[collection])) issues.push(issue('traceability.json', `${collection} must be an array`));
  }
  if (issues.length > 0) return;

  const maps = Object.fromEntries(collections.map(name => [name, indexById(trace[name], name, issues)]));
  if (issues.length > 0) return;
  const allKnown = new Set([...maps.requirements.keys(), ...maps.design_items.keys(), ...maps.files.keys(), ...maps.tasks.keys(), ...maps.tests.keys()]);
  for (const id of allKnown) {
    if (!isSafeId(id)) issues.push(issue('traceability.json', `Invalid identifier '${id}'`));
  }

  const mappedRequirements = new Set(maps.requirements.keys());
  if (requirements) {
    for (const requirement of requirements.ids) {
      if (!mappedRequirements.has(requirement)) issues.push(issue('traceability.json', `${requirement} is missing from requirements`));
    }
    for (const requirement of mappedRequirements) {
      if (!requirements.ids.has(requirement)) issues.push(issue('traceability.json', `${requirement} does not exist in specs`));
    }
  }

  for (const [id, item] of maps.requirements) {
    requireIdPrefix(id, 'REQ', 'requirements', issues);
    requireReferences(item, 'design_items', maps.design_items, issues, id);
    requireReferences(item, 'task_ids', maps.tasks, issues, id);
    requireReferences(item, 'test_ids', maps.tests, issues, id);
  }

  for (const [id, item] of maps.design_items) {
    const prefix = KIND_PREFIX[item?.kind];
    if (!prefix) issues.push(issue('traceability.json', `${id} has unsupported design kind '${item?.kind}'`));
    else requireIdPrefix(id, prefix, 'design_items', issues);
    requireReferences(item, 'requirements', maps.requirements, issues, id);
    requireReferences(item, 'files', maps.files, issues, id);
    if (!headings.has(id)) issues.push(issue('technical-design.md', `${id} has no matching level-three heading`));
    else {
      validateHeadingSection(id, item?.kind, headings.get(id).section, issues);
      validateHeadingFields(id, item?.kind, headings.get(id).body, issues);
    }
  }
  for (const id of headings.keys()) {
    if (!maps.design_items.has(id)) issues.push(issue('technical-design.md', `${id} is not declared in traceability.json`));
  }

  for (const [id, item] of maps.files) {
    requireIdPrefix(id, 'FILE', 'files', issues);
    if (!isTraceableFilePath(item?.path, changeDir)) {
      issues.push(issue('traceability.json', `${id} has unsafe file path '${item?.path ?? ''}'`));
    }
  }

  // Coverage is directional and must be checked in both directions: a design
  // item nobody implements, or a controlled file no design item or task claims,
  // is exactly the drift this gate exists to stop.
  const tasksByDesignItem = new Set();
  const tasksByFile = new Set();
  const designItemsByFile = new Set();
  for (const item of maps.tasks.values()) {
    for (const ref of item?.design_items ?? []) if (maps.design_items.has(ref)) tasksByDesignItem.add(ref);
    for (const ref of item?.files ?? []) if (maps.files.has(ref)) tasksByFile.add(ref);
  }
  for (const item of maps.design_items.values()) {
    for (const ref of item?.files ?? []) if (maps.files.has(ref)) designItemsByFile.add(ref);
  }
  for (const [id, item] of maps.design_items) {
    if (!tasksByDesignItem.has(id)) issues.push(issue('traceability.json', `${id} has no mapped task`));
    const kindNeedsTest = MANDATORY_TEST_KINDS.has(item?.kind) || item?.risk === 'high';
    if (kindNeedsTest && !hasLinkedTest(id, maps.tests)) {
      issues.push(issue('traceability.json', item?.risk === 'high' && !MANDATORY_TEST_KINDS.has(item?.kind)
        ? `${id} is high risk but has no mapped test`
        : `${id} (${item?.kind}) has no mapped test`));
    }
  }
  for (const [id] of maps.files) {
    if (!designItemsByFile.has(id)) issues.push(issue('traceability.json', `${id} is not referenced by any design item`));
    if (!tasksByFile.has(id)) issues.push(issue('traceability.json', `${id} is not referenced by any task`));
  }
  for (const boundary of boundaries ?? []) {
    const kind = BOUNDARY_KIND[boundary];
    if (!kind) continue;
    if (![...maps.design_items.values()].some(item => item?.kind === kind)) {
      issues.push(issue('traceability.json', `declared boundary '${boundary}' has no ${KIND_PREFIX[kind]} design item`));
    }
  }

  const tasksPath = path.join(changeDir, 'tasks.md');
  if (!existsSync(tasksPath)) {
    issues.push(issue('tasks.md', 'tasks.md is required by traceability.json'));
    return;
  }
  const parsedTasks = indexById(parseTasks(readFileSync(tasksPath, 'utf8')), 'tasks.md', issues);
  for (const [id, item] of maps.tasks) {
    if (!parsedTasks.has(id)) {
      issues.push(issue('tasks.md', `Traceability task ${id} has no checkbox task`));
      continue;
    }
    requireReferences(item, 'requirements', maps.requirements, issues, id);
    requireReferences(item, 'design_items', maps.design_items, issues, id);
    requireReferences(item, 'files', maps.files, issues, id);
    requireReferences(item, 'tests', maps.tests, issues, id);
    const requiredRefs = new Set([
      ...(item.requirements ?? []), ...(item.design_items ?? []), ...(item.files ?? []), ...(item.tests ?? []),
    ]);
    const actualRefs = new Set(parsedTasks.get(id).refs ?? []);
    for (const ref of requiredRefs) {
      if (!actualRefs.has(ref)) issues.push(issue('tasks.md', `Task ${id} Refs is missing ${ref}`));
    }
    validateTaskBody(id, item, maps, parsedTasks.get(id).body ?? parsedTasks.get(id).text ?? '', issues);
  }
  for (const id of parsedTasks.keys()) {
    if (!maps.tasks.has(id)) issues.push(issue('tasks.md', `Task ${id} is missing from traceability.json`));
  }

  for (const [id, item] of maps.tests) {
    requireIdPrefix(id, 'TEST', 'tests', issues);
    requireReferences(item, 'requirements', maps.requirements, issues, id);
    requireReferences(item, 'design_items', maps.design_items, issues, id);
    if (typeof item?.command !== 'string' || !item.command.trim()) issues.push(issue('traceability.json', `${id} requires a non-empty command`));
  }
}

function readRequirementIds(changeDir, issues) {
  const ids = new Set();
  for (const file of findCanonicalSpecFiles(changeDir)) {
    const relative = relativeSpecPath(changeDir, file);
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const heading = line.match(/^###\s+Requirement:\s*(.*?)\s*$/i);
      if (!heading) continue;
      const id = heading[1].match(/^(REQ-\d+)\b/i)?.[1]?.toUpperCase();
      if (!id) {
        issues.push(issue(relative, `Brownfield Requirement must start with REQ-*: ${heading[1]}`));
      } else if (ids.has(id)) {
        issues.push(issue(relative, `Duplicate Requirement ID ${id}`));
      } else ids.add(id);
    }
  }
  if (ids.size === 0) issues.push(issue('specs/', 'brownfield changes require at least one REQ-* Requirement'));
  return { ids };
}

function readTechnicalHeadings(content) {
  const lines = String(content).replace(/\r\n?/g, '\n').split('\n');
  const headings = new Map();
  let section = '';
  for (let index = 0; index < lines.length; index += 1) {
    const sectionMatch = lines[index].match(/^##\s+(?!#)(.*?)\s*$/);
    if (sectionMatch) { section = sectionMatch[1]; continue; }
    const match = lines[index].match(/^###\s+((?:API|DB|MODEL|INT|IMPACT|ARCH|MIGRATION)-\d+)\s*[:—-].*$/i);
    if (!match) continue;
    const id = match[1].toUpperCase();
    let body = '';
    for (let cursor = index + 1; cursor < lines.length && !/^###\s+/.test(lines[cursor]); cursor += 1) body += `${lines[cursor]}\n`;
    headings.set(id, { body, section });
  }
  return headings;
}

function validateHeadingSection(id, kind, section, issues) {
  const expected = KIND_SECTION[kind];
  if (!expected || expected.test(section ?? '')) return;
  issues.push(issue('technical-design.md', `${id} must be declared under its own section, not '## ${section}'`));
}

function validateHeadingFields(id, kind, body, issues) {
  for (const field of REQUIRED_FIELDS[kind] ?? []) {
    const fieldPattern = new RegExp(`^\\s*-\\s*${escapeRegex(field)}\\s*:`, 'im');
    if (!fieldPattern.test(body)) issues.push(issue('technical-design.md', `${id} requires '${field}'`));
  }
}

function hasLinkedTest(designId, tests) {
  return [...tests.values()].some(test => Array.isArray(test?.design_items) && test.design_items.includes(designId));
}

// A traceable task must say how it is proven and which declared boundary it
// touches, otherwise the map's chain stops at a checkbox that proves nothing.
function validateTaskBody(id, item, maps, body, issues) {
  if (!PROOF_MARKER.test(body)) {
    issues.push(issue('tasks.md', `Task ${id} needs a proof command (证明：\`<command>\`)`));
  }
  const declared = (item?.files ?? [])
    .map(fileId => maps.files.get(fileId)?.path)
    .filter(value => typeof value === 'string' && value.trim() && !/[*?[\]{}]/.test(value))
    .map(value => value.replace(/\\/g, '/'));
  if (declared.length === 0) return;
  // A partner-repo path is `name:rest`; the task body typically names the
  // in-repo part, so match on both the full value and the part after ':'.
  const matchValues = declared.map(value => (value.includes(':') ? value.slice(value.indexOf(':') + 1) : value));
  const displays = matchValues.length > 0 ? matchValues : declared;
  if (!matchValues.some(value => body.includes(value) || body.includes(path.posix.basename(value)))) {
    issues.push(issue('tasks.md', `Task ${id} must name the file it changes (${displays.join(', ')})`));
  }
}

function indexById(items, label, issues) {
  const result = new Map();
  for (const item of items) {
    if (!isObject(item) || typeof item.id !== 'string' || !item.id.trim()) {
      issues.push(issue('traceability.json', `${label} entries require an id`));
      continue;
    }
    if (result.has(item.id)) issues.push(issue('traceability.json', `Duplicate ${label} id '${item.id}'`));
    else result.set(item.id, item);
  }
  return result;
}

function requireIdPrefix(id, prefix, label, issues) {
  if (!new RegExp(`^${prefix}-\\d+$`).test(id)) issues.push(issue('traceability.json', `${label} id '${id}' must use ${prefix}-<number>`));
}

function requireReferences(item, field, targets, issues, sourceId) {
  if (!Array.isArray(item?.[field]) || item[field].length === 0) {
    issues.push(issue('traceability.json', `${sourceId} requires at least one ${field} reference`));
    return;
  }
  for (const ref of item[field]) {
    if (!targets.has(ref)) issues.push(issue('traceability.json', `${sourceId} references unknown ${ref} in ${field}`));
  }
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim() || /[\0\r\n]/.test(value)) return false;
  const normalized = value.replace(/\\/g, '/');
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(value)) return false;
  return !normalized.split('/').includes('..');
}

/**
 * A controlled file lives either in the primary repo (a safe relative path)
 * or in a configured partner repo (`<partner-name>:<relative path>`). The
 * partner name must exist in spec-superflow.config.json so a typo cannot
 * smuggle an uncontrolled path through, and the remainder keeps the same
 * safety rules as a primary-repo path.
 */
function isTraceableFilePath(value, changeDir) {
  if (typeof value !== 'string' || !value.includes(':')) return isSafeRelativePath(value);
  const separator = value.indexOf(':');
  const partnerName = value.slice(0, separator);
  const rest = value.slice(separator + 1);
  try {
    const partners = loadPartnerRepos(projectRootForChange(changeDir));
    if (!partners.some(partner => partner.name === partnerName)) return false;
  } catch {
    return false;
  }
  return isSafeRelativePath(rest);
}

function isSafeId(value) {
  return typeof value === 'string' && /^(?:REQ|API|DB|MODEL|INT|IMPACT|ARCH|MIGRATION|FILE|TEST)-\d+$|^\d+(?:\.\d+)*$/.test(value);
}

function report(profile, issues, contractHash, traceability, applies = profile.profile === 'brownfield') {
  const errors = issues.filter(entry => entry.level === 'ERROR');
  return {
    valid: errors.length === 0,
    profile: profile.profile,
    applies,
    boundaries: profile.boundaries,
    issues,
    summary: { errors: errors.length, warnings: 0, info: 0 },
    technical_contract_hash: contractHash,
    traceability,
  };
}

function issue(file, message) { return { level: 'ERROR', path: file, message }; }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
