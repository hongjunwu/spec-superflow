# Technical Design

## Architecture

### ARCH-001: Salary adjustment ownership

- Owner: salary-service
- Consumers: hr-web, payroll-service
- Transaction boundary: the adjustment row and the salary snapshot are written in one transaction

## API

### API-001: Create salary adjustment

- Method: POST
- Path: /api/salary/adjustments
- Request: employeeId, salaryAfter, reason, effectiveDate, clientRequestId
- Response: id, employeeId, salaryBefore, salaryAfter, status
- Authorization: hr.salary.adjust
- Compatibility: additive endpoint; existing salary APIs keep their request and response contract

## Database

### DB-001: New salary_adjustment table

- Columns: id, employee_id, salary_before, salary_after, reason, effective_date, client_request_id
- Constraints: unique (employee_id, effective_date, client_request_id); employee_id and effective_date are indexed
- Rollback: the migration is additive, so an application rollback stays compatible

## Model

### MODEL-001: Employee details response model

The response model gains an optional `salaryInfo` object. Every existing field keeps its name, type and meaning, and the model stays backward compatible for consumers that ignore unknown fields.

## Impact Analysis

### IMPACT-001: Employee details response

- Affected callers: hr-web, employee-web, payroll-service
- Compatibility: salaryInfo is additive; existing fields and their meanings are unchanged
- Regression: employee query, salary query, payroll calculation and authorization must keep passing
