# 实现任务

## 任务

- [ ] **1.1 建立 salary_adjustment 表与约束**：修改 `services/salary/migrations/20261009_salary_adjustment.sql`，完成后同一员工同一生效日期的重复客户端请求被唯一约束拒绝
  Refs: REQ-001, DB-001, FILE-002, TEST-001
  证明：`npm --prefix services/salary test -- --test-name-pattern=adjustmentRepository`
- [ ] **1.2 实现调整写入接口**：修改 `services/salary/src/adjustment/handler.mjs`，完成后授权调用方拿到 before/after，未授权请求在写入前被拒绝
  Refs: REQ-001, ARCH-001, API-001, FILE-001, TEST-002
  证明：`npm --prefix services/salary test -- --test-name-pattern=adjustmentApi`
- [ ] **1.3 在员工详情响应中追加 salaryInfo**：修改 `services/employee/src/employee/employeeDto.mjs` 与 `services/employee/src/employee/responseMapper.mjs`，完成后既有字段与含义不变，新增字段为追加式
  Refs: REQ-001, MODEL-001, IMPACT-001, FILE-003, FILE-004, TEST-003
  证明：`npm --prefix services/employee test -- --test-name-pattern=employeeResponse`
