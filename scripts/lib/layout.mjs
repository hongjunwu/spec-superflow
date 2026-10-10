// scripts/lib/layout.mjs — single source of truth for the OpenSpec-style
// directory layout. A project keeps its published baseline and its active
// changes under one parent directory:
//
//   <projectRoot>/openspec/changes/<change>/     active change artifacts
//   <projectRoot>/openspec/specs/<capability>/   published baseline
//
// The change-internal layout (specs/<capability>/spec.md inside a change
// directory) is unchanged and owned by spec-paths.mjs.
import { dirname, join, resolve } from 'node:path';

export const OPENSPEC_DIR = 'openspec';
export const CHANGES_SUBDIR = 'changes';
export const SPECS_SUBDIR = 'specs';

export function openspecRoot(projectRoot) {
  return join(projectRoot, OPENSPEC_DIR);
}

export function changesRoot(projectRoot) {
  return join(openspecRoot(projectRoot), CHANGES_SUBDIR);
}

export function baselineSpecsRoot(projectRoot) {
  return join(openspecRoot(projectRoot), SPECS_SUBDIR);
}

export function baselineSpecFile(projectRoot, capability) {
  return join(baselineSpecsRoot(projectRoot), capability, 'spec.md');
}

/**
 * Resolve the project root that owns a change directory.
 * Standard layout: <root>/openspec/changes/<change> — the change's parent is
 * "openspec/changes", so the root is three levels up from the change dir.
 * A change directory not named "changes" stays self-contained: its parent is
 * the project root.
 */
export function projectRootForChange(changeDir) {
  const absoluteChangeDir = resolve(changeDir);
  const changesDir = dirname(absoluteChangeDir);
  return basenameOf(changesDir) === CHANGES_SUBDIR
    ? dirname(dirname(changesDir))
    : dirname(absoluteChangeDir);
}

function basenameOf(value) {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? '';
}
