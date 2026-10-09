# Design

## Architecture

The salary service owns the adjustment write path. `hr-web` calls the new endpoint; `payroll-service` only reads the resulting records, so the write path stays inside one transaction boundary owned by the salary service.

## Data Flow

Request → salary service handler → validation and authorization → adjustment row plus salary snapshot in one transaction → response assembled from the persisted row.

## Error Handling

- Missing permission: rejected before any write.
- Duplicate client request id: the persisted row is returned.
- Concurrent adjustment for the same employee: the database constraint decides, and the loser is retried once.

## Trade-Offs

An additive endpoint was chosen over extending the existing salary update call, so current callers keep their exact contract and the new write path can carry its own authorization and audit fields.
