---
name: technical-designer
description: Turn approved business requirements into a Brownfield technical design and traceability map. Invoke for planned changes whose proposal declares Engineering Profile brownfield, before the single execution approval. Do not invoke for standard or direct changes.
---

# Technical Designer

## Bundled runtime

Before executing a CLI line below, replace its leading `SSF` with `node "<plugin-root>/scripts/spec-superflow.mjs"`; `<plugin-root>` is the absolute directory two levels above this file. Never run `SSF` literally or call an `ssf` from `PATH`.

Business requirements live in specs. This skill writes the engineering picture of how they will be implemented, so the executor works inside approved boundaries instead of improvising them.

## When To Use

Only for a planned change whose `proposal.md` Engineering Profile is `brownfield`. For `standard` or a direct change, stop: no `technical-design.md` or `traceability.json` is created, and the existing compact flow applies.

## Required Inputs

Read `proposal.md` (goal, boundaries, compatibility), the delta specs, and `tasks.md`. Check shared interfaces against the real source once. Never restate business requirements here — `REQ-*` IDs must match the spec headings exactly.

## Process

### 1. Load the templates

Read `SSF runtime asset read templates/technical-design.md` and `SSF runtime asset read templates/traceability.json`. Write both files into the change directory.

### 2. Assign stable IDs

- `REQ-00N` — copied from the delta spec Requirement headings; do not invent new ones.
- `API-00N`, `DB-00N`, `MODEL-00N`, `INT-00N`, `IMPACT-00N`, `ARCH-00N`, `MIGRATION-00N` — design items, declared as level-three headings with the fields the template lists.
- `FILE-00N` — repository-relative safe paths or explicit globs. No absolute paths and no `..`.
- `TEST-00N` — the command that proves the design item.

Every ID is unique inside its type, and its prefix must match its type.

### 3. Declare the design

Each design item carries the decisions a reviewer cannot infer from code: method, path, request, response, authorization and compatibility for APIs; columns, constraints and rollback for databases; affected callers, compatibility and regression for impact items. Declare every boundary listed in `Boundaries`; a declared `database` boundary without a `DB-*` item fails validation.

### 4. Map the chain

In `traceability.json`, connect every `REQ-*` to design items, tasks and tests; every design item to files and a task; every controlled file to a design item and a task; and every `API-*`/`DB-*` item to a test. The map is the machine-checkable truth; tasks are the human-readable view.

### 5. Mirror references into tasks.md

Add one indented `Refs:` line under each task listing the requirement, design, file and test IDs it implements:

```text
- [ ] **1.1 Create the adjustment table**：实现 DB-001
  Refs: REQ-001, DB-001, FILE-002, TEST-001
```

### 6. Validate before hand-off

Run `SSF validate <change-dir>`. On `Brownfield` changes it prints the requirement-to-test mapping and fails on missing coverage, unknown references, duplicate or mis-prefixed IDs, unsafe paths, and boundary gaps. Fix the artifacts until it passes, then hand off to `impact-analyzer` for the impact review, followed by `contract-validator`.

## Boundaries

- Do not change business requirements, acceptance scenarios or task order to make the map pass.
- Do not write implementation code, and do not create a second task list.
- Do not record approval. One approval covers proposal, specs, design, technical design, traceability and tasks, and it happens after `contract-validator`.

## Self-Review

1. Every `REQ-*` in the delta specs appears in the map exactly once, with the same spelling.
2. Every design item has a matching heading, a task and the fields its kind requires.
3. Every controlled file is reachable from a design item and a task, and is inside the repository.
4. No placeholder text, no "see code", no unbounded glob that matches the whole repository.

## Exception Handling

- Malformed or unparseable `traceability.json`: report the exact JSON error and rewrite the file from the template instead of patching fragments.
- Missing files or directories named by the map: record the file as a planned `FILE-*` entry or remove it; never leave a dangling path.
- Validation failure: treat the printed rule as the requirement, fix the artifact, and re-run. Never silence a rule by deleting its evidence.
- User interruption: the artifacts are the state. Re-read `proposal.md`, the specs and the map, then resume at the first incomplete step.
