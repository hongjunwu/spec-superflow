# Examples

Example changes and artifact sets live here.

## Included Examples

- `add-dark-mode`
  - A net-new UI capability example that shows feature delivery from proposal to execution contract.
- `refactor-auth-boundary`
  - A brownfield backend refactor example that shows how to stabilize a scattered auth flow without expanding into a full auth redesign.
- `brownfield-salary-adjustment`
  - A Brownfield `planned` example (`Engineering Profile: brownfield`) with `technical-design.md` + `traceability.json`: the traceability gate maps `REQ-001` through design items, files, tasks and tests.
- `verification-risk-ownership.md`
  - A curated evidence matrix showing the end-to-end owner and fast contract for each retained verification risk.

## Reading Order

For any example, read:

1. `README.md`
2. `proposal.md`
3. `specs/`
4. `design.md`
5. `tasks.md`
6. `execution-contract.md`

For `brownfield-salary-adjustment`, read `technical-design.md` and `traceability.json` between steps 4 and 5; it has no `execution-contract.md` because a v2 change uses its approved execution plan instead.

`npm run validate` validates every example in this directory, including the technical gate for the brownfield one.

## Planned Future Examples

- `ship-web-ui-v2`
