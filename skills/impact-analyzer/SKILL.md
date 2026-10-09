---
name: impact-analyzer
description: Investigate existing APIs, callers, modules, data and integrations so a Brownfield change declares its blast radius. Invoke after technical-designer for changes that alter existing behavior, and whenever a task's real code disagrees with the approved design.
---

# Impact Analyzer

## Bundled runtime

Before executing a CLI line below, replace its leading `SSF` with `node "<plugin-root>/scripts/spec-superflow.mjs"`; `<plugin-root>` is the absolute directory two levels above this file. Never run `SSF` literally or call an `ssf` from `PATH`.

Existing systems have callers you did not write. This skill finds them, writes the finding down, and keeps the affected surface visible to review and verification.

## When To Use

For a Brownfield change that adds, removes or changes an existing API, data semantic, integration, permission boundary or compatibility promise. Skip it for purely additive behavior with no existing consumer.

## Process

### 1. Search the real code

Locate every caller, implementation and configuration that depends on the behavior being changed. Read the source rather than assuming from names. Record what you actually found, not what the design hopes.

### 2. Declare impact items

Add one `### IMPACT-00N` heading per affected behavior in `technical-design.md`, with:

- `Affected callers` — who breaks or must react.
- `Compatibility` — what stays stable, what changes, and for how long.
- `Regression` — which existing behaviors must be re-verified.

Then add the matching `IMPACT-00N` entry to `traceability.json` with its requirements, files and risk.

### 3. Register any newly discovered files

A file that must change but is absent from the map is drift waiting to happen. Add a `FILE-00N` entry, connect it to the impact or design item, and reference it from the task that edits it.

### 4. Keep tasks and tests honest

High-risk impact items need a mapped test. Add or extend the `Refs:` line of the owning task so the executor sees the same boundary the map declares.

### 5. Re-run the gate

Run `SSF validate <change-dir>` and resolve every reported gap before hand-off to `contract-validator`.

## During Execution

If the real code conflicts with the approved design — an unexpected caller, a contract the design cannot satisfy, a boundary that must expand — stop that task. Do not widen scope quietly. Record the conflict and return to planning:

```bash
SSF technical conflict record <change-dir> --task <id> --summary "<conflict>" \
  --affected "REQ-001, API-001, IMPACT-001" --why "<why it needs a product or design decision>" \
  --next "<revise technical-design.md and traceability.json, then reapprove>"
```

An open conflict blocks completion and passing reviews for that plan. Revising the design and re-approving creates a new plan revision; never work around a recorded conflict.

## Self-Review

1. Every changed existing behavior has an impact item, and every impact item names real callers.
2. Compatibility statements are testable claims, not reassurance.
3. No mapped file is missing from the tasks that edit it.
4. Conflicts are recorded, not silently absorbed.

## Exception Handling

- Unparseable or missing traceability map: report it and return to `technical-designer` rather than editing fragments.
- Callers that cannot be found statically: state the search you ran and the residual uncertainty instead of claiming full coverage.
- Validation failure: fix the declared chain and re-run; do not delete the impact item that caused it.
- User interruption: impact items are durable. Re-read the map, list the remaining open questions, and resume from the first one.
