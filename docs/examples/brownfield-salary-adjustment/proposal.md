# Proposal

## Why

HR needs an auditable salary adjustment endpoint. The change touches an existing public API, adds a table, and changes the employee details response, so it needs an engineering design and a traceability map before implementation starts.

## What Changes

- Add `POST /api/salary/adjustments` with authorization, idempotency and an additive response.
- Add the `salary_adjustment` table and its additive migration.
- Add `salaryInfo` to the existing employee details response without changing current fields.

## 非目标

- No change to payroll calculation.
- No change to existing salary query semantics.

## 验收条件

- An authorized caller creates an adjustment and receives the before/after values.
- Existing callers of the employee details endpoint keep working unchanged.

## 主要风险

- Existing consumers may reject unknown response fields; the impact item records the compatibility promise.

## Engineering Profile

- **Profile**: brownfield
- **Boundaries**: api, database, public-model
- **Compatibility**: existing fields and their meanings stay unchanged; new fields are additive
- **Affected systems**: employee-service, payroll-service, hr-web
