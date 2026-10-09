# Brownfield Example: Salary Adjustment

A high-impact brownfield change: it adds a public endpoint, a table, and an additive field on an existing response. It shows the artifacts a `planned` change needs when `proposal.md` declares `Engineering Profile: brownfield`.

## Artifacts

| File | Role |
|---|---|
| `proposal.md` | Goal, non-goals, acceptance, risks, and the Engineering Profile with boundaries and compatibility claims |
| `specs/salary/spec.md` | Business requirements; `REQ-001` is the traceability root |
| `design.md` | The architectural decision and its trade-off |
| `technical-design.md` | The engineering design: `ARCH-001`, `API-001`, `DB-001`, `IMPACT-001` |
| `traceability.json` | The machine-checkable map from requirements to design items, files, tasks and tests |
| `tasks.md` | The single implementation plan; each task names its file, its `Refs:` and its proof command |

No `execution-contract.md` is written for a v2 change: the approved schema-2 execution plan replaces the handwritten contract (see `docs/brownfield-engineering-design.md` §3.2).

## Checks

```bash
ssf validate docs/examples/brownfield-salary-adjustment
```

The command prints the coverage mapping (`REQ-001 -> ... -> task 1.1 -> TEST-001`) and fails on missing coverage, unknown references, duplicate or mis-prefixed ids, unsafe paths, a design item under the wrong section, a missing required field, or a task without a proof command or a named file.

## Reading Order

1. `proposal.md`
2. `specs/salary/spec.md`
3. `technical-design.md`
4. `traceability.json`
5. `tasks.md`
6. `design.md`
