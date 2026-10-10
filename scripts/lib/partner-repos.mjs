// scripts/lib/partner-repos.mjs — controlled secondary repositories for a
// brownfield change that spans systems (e.g. a payroll backend plus its web
// frontend). The primary repo stays the sole authority for change artifacts;
// a partner repo is anchored, gated and referenced, never authoritative.
//
// Configuration lives in spec-superflow.config.json:
//
//   {
//     "partner_repos": [
//       {
//         "name": "partnerSalary-web",
//         "path": "../partnerSalary-web",            // relative to the primary repo root
//         "url": "https://git.example.com/hr/partnerSalary-web.git", // optional: clone when missing
//         "branch": "master"                          // optional: baseline branch to provision from
//       }
//     ]
//   }
//
// Provisioning semantics (idempotent, invoked at workflow start / isolate):
//   1. path missing + url configured  -> clone from url
//   2. fetch origin when a remote exists
//   3. on the baseline branch (local, else created from origin/<branch>), and
//      fast-forward only — a mid-development baseline update stays a human
//      decision and is never pulled under an agent
//   4. checkout a development branch named `<changeName>-<name>` cut from the
//      baseline; an existing development branch is resumed, never rebuilt
//   5. a partner already on its development branch is left untouched

import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { loadConfig } from './config-loader.mjs';

export const PROTECTED_PARTNER_BRANCHES = ['main', 'master'];

export function isSafePartnerName(value) {
  return typeof value === 'string'
    && value.trim().length > 0
    && !/[\\/:*?"<>|\s]/.test(value)
    && value !== '.' && value !== '..';
}

/**
 * Read and validate partner_repos from the project config. Returns [] when
 * unconfigured — every caller must treat that as "feature off".
 */
export function loadPartnerRepos(projectRoot) {
  const configured = loadConfig(projectRoot)?.partner_repos;
  if (!Array.isArray(configured) || configured.length === 0) return [];
  const seen = new Set();
  return configured.map((entry, index) => {
    const label = `partner_repos[${index}]`;
    if (!entry || typeof entry !== 'object') throw new Error(`${label} must be an object`);
    if (!isSafePartnerName(entry.name)) throw new Error(`${label}.name must be a safe single path segment`);
    if (seen.has(entry.name)) throw new Error(`${label}: duplicate partner name '${entry.name}'`);
    seen.add(entry.name);
    if (typeof entry.path !== 'string' || !entry.path.trim()) throw new Error(`${label}.path is required`);
    if (entry.url !== undefined && (typeof entry.url !== 'string' || !entry.url.trim())) {
      throw new Error(`${label}.url must be a non-empty string when present`);
    }
    if (entry.branch !== undefined && (typeof entry.branch !== 'string' || !isSafePartnerName(entry.branch))) {
      throw new Error(`${label}.branch must be a safe branch name when present`);
    }
    const path = isAbsolute(entry.path) ? resolve(entry.path) : resolve(projectRoot, entry.path);
    return {
      name: entry.name,
      path,
      url: entry.url?.trim() || null,
      branch: entry.branch?.trim() || 'master',
    };
  });
}

function git(cwd, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (allowFailure) return null;
    throw new Error(`git -C ${basename(cwd)} ${args.join(' ')} failed: ${(error.stderr || error.message || '').toString().trim()}`);
  }
}

export function partnerDevelopmentBranch(partner, changeName) {
  return `${changeName}-${partner.name}`;
}

export function partnerStatus(partner) {
  if (!existsSync(join(partner.path, '.git'))) return { exists: false };
  const head = git(partner.path, ['rev-parse', 'HEAD'], { allowFailure: true });
  return {
    exists: true,
    branch: git(partner.path, ['branch', '--show-current'], { allowFailure: true }) || null,
    head,
    dirty: Boolean(git(partner.path, ['status', '--porcelain'], { allowFailure: true })),
  };
}

/**
 * Idempotently bring one partner repo into its development state and return
 * the baseline anchor ({ branch, head }) the development branch was cut from.
 * When the partner is already on its development branch the recorded state is
 * returned untouched — provisioning never rewrites mid-development work.
 */
export function provisionPartner(partner, changeName) {
  if (!existsSync(join(partner.path, '.git'))) {
    if (!partner.url) throw new Error(`partner '${partner.name}' is missing at ${partner.path} and no url is configured to clone it from`);
    execFileSync('git', ['clone', partner.url, partner.path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }
  const status = partnerStatus(partner);
  const devBranch = partnerDevelopmentBranch(partner, changeName);
  if (status.branch === devBranch) {
    return { provisioned: false, devBranch, ...status };
  }

  const hasOrigin = git(partner.path, ['remote'], { allowFailure: true })?.split(/\r?\n/).includes('origin');
  if (hasOrigin) git(partner.path, ['fetch', 'origin', '--quiet']);

  const localBranches = new Set(git(partner.path, ['branch', '--format=%(refname:short)']).split(/\r?\n/));
  if (!localBranches.has(partner.branch)) {
    if (!hasOrigin || !git(partner.path, ['rev-parse', '--verify', `origin/${partner.branch}`], { allowFailure: true })) {
      throw new Error(`partner '${partner.name}' has no local branch '${partner.branch}'${hasOrigin ? ' and no origin/' + partner.branch : ''} to cut the baseline from`);
    }
    git(partner.path, ['branch', partner.branch, `origin/${partner.branch}`]);
  }
  git(partner.path, ['checkout', '--quiet', partner.branch]);
  if (hasOrigin) {
    git(partner.path, ['merge', '--ff-only', `origin/${partner.branch}`]);
  }
  const anchor = git(partner.path, ['rev-parse', 'HEAD']);
  const existingDev = git(partner.path, ['rev-parse', '--verify', devBranch], { allowFailure: true });
  if (existingDev) {
    git(partner.path, ['checkout', '--quiet', devBranch]);
    return { provisioned: false, devBranch, branch: partner.branch, head: anchor };
  }
  git(partner.path, ['checkout', '-b', devBranch]);
  return { provisioned: true, devBranch, branch: partner.branch, head: anchor };
}

/**
 * Direct commits a partner accumulated on a protected branch since the
 * recorded anchor — exactly the "edited master in place" scenario the gate
 * exists to catch. Commits on any other branch return [] by definition.
 */
export function protectedDirectCommits(partner, anchor, status = partnerStatus(partner)) {
  if (!status.exists || !anchor) return [];
  if (!PROTECTED_PARTNER_BRANCHES.includes(status.branch)) return [];
  return git(partner.path, ['log', '--format=%h %s', `${anchor}..HEAD`])
    .split(/\r?\n/).filter(Boolean);
}

export function provisionAll(projectRoot, changeName) {
  const partners = loadPartnerRepos(projectRoot);
  return partners.map(partner => ({ partner, result: provisionPartner(partner, changeName) }));
}
