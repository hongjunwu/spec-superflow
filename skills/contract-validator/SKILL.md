---
name: contract-validator
description: Enforce the Brownfield traceability gate and block incomplete plans from reaching approval or execution. Invoke after technical-designer and impact-analyzer, and any time a Brownfield plan is revised or its design changes.
---

# Contract Validator

## Bundled runtime

Before executing a CLI line below, replace its leading `SSF` with `node "<plugin-root>/scripts/spec-superflow.mjs"`; `<plugin-root>` is the absolute directory two levels above this file. Never run `SSF` literally or call an `ssf` from `PATH`.

The validator decides whether a Brownfield plan is complete enough to present for approval. It reports; it does not negotiate, and it never rewrites evidence to reach a passing state.

## When To Use

After `technical-designer` and `impact-analyzer` have produced `technical-design.md` and `traceability.json`, before the single approval, and again whenever the design, map or tasks change during execution.

## Process

### 1. Run the gate

Run `SSF validate <change-dir>`. For a Brownfield change the report includes a coverage mapping, for example:

```text
REQ-001 -> API-001, DB-001 -> task 1.1, task 1.2 -> TEST-001, TEST-002
API-001 -> task 1.1 -> TEST-001
```

### 2. Interpret the failures

Every failure names the artifact and rule. The gate blocks on: a `REQ-*` missing from the map; a design item no task implements; a controlled file no design item or task references; an `API-*` or `DB-*` item without a test; a declared boundary without a matching design item; unknown, duplicate or mis-prefixed IDs; unsafe file paths; a task `Refs:` line that disagrees with the map; a missing required field in a design heading.

### 3. Report, then hand off or block

- Passing: report the mapping and hand off to `workflow-start` for the single approval that covers proposal, specs, design, technical design, traceability and tasks.
- Failing: report each rule and the artifact to fix, and route the work back to the owning skill. Do not present the plan for approval while any rule fails.

### 4. Re-validate after approval

Approval binds the design into the execution plan. Confirm the binding with `SSF execution show <change-dir>`: a Brownfield plan records the validator version and the technical contract hash, and any later edit to `technical-design.md` or `traceability.json` invalidates that plan until it is re-approved.

### 5. Check execution evidence

During execution, a passing review requires the recorded Git range to touch only mapped files, and no open conflict may exist for the current plan. Record a conflict with `SSF technical conflict record` instead of approving a review that would hide an unmapped change.

## Boundaries

- Never edit `technical-design.md`, `traceability.json` or specs to satisfy the gate on the user's behalf; changes to the approved design need a new approval.
- Never treat a failing gate as a warning, and never paraphrase a failure as success.
- Do not add decision points or a second approval: this is a gate inside the existing planned flow.

## Self-Review

1. The last run of `SSF validate <change-dir>` passed on the current artifacts, not an earlier snapshot.
2. The mapping shown to the user matches the map on disk.
3. Any open conflict is reported as blocking, with its task and affected IDs.

## Exception Handling

- Malformed artifacts: report the parser error and route back to the skill that owns the file.
- Missing artifacts: list the absent files and stop; a Brownfield plan cannot be approved without them.
- Validation failure: keep the failure text verbatim in the report so the next reader can reproduce it.
- User interruption: re-run the gate before resuming; an artifact may have changed since the last report.
