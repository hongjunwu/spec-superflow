# Capability Spec

## ADDED Requirements

### Requirement: REQ-001 — Create salary adjustment

The system SHALL create a salary adjustment that records the salary before and after the change.

#### Scenario: Authorized adjustment

- **WHEN** a caller with the `hr.salary.adjust` permission submits an adjustment with a client request id
- **THEN** the system records the adjustment and returns its id with the before and after values

#### Scenario: Repeated request

- **WHEN** the same client request id is submitted twice
- **THEN** the system returns the recorded adjustment instead of creating a second one
