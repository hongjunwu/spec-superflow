# Brownfield 工程施工图与可追溯执行设计

## 1. 目标

为 `spec-superflow` 的高影响 Brownfield 变更增加工程设计、影响分析和可追溯校验能力，使执行链路成为：

```text
Business requirements
        |
        v
OpenSpec specs (single business truth)
        |
        v
Technical design + traceability map
        |
        v
tasks.md (approved implementation plan)
        |
        v
Technical validation gate
        |
        v
Existing schema-v2 execution plan
        |
        v
build-executor -> code -> review -> verification
```

业务需求仍只由 OpenSpec specs 定义。技术设计描述如何修改工程对象，追溯表把需求、设计项、文件、任务和测试连接起来。执行器只能在已批准边界内实现。

## 2. 适用范围

新增能力只扩展 planned 路径中的高影响变更：

| 路径或 Profile | 技术设计 | 追溯校验 | 行为 |
|---|---:|---:|---|
| `direct` | 否 | 否 | 保持现有轻量流程 |
| planned / `standard` | 可选（一旦存在就按同一格式校验） | 可选（与技术设计成对出现；不绑定 specs 的 `REQ-*`） | 保持现有 proposal + tasks 流程；计划语义不变（不记录技术证据、不纳入 artifacts hash） |
| planned / `brownfield` | 必须 | 必须 | 进入工程施工图与校验门禁 |

`brownfield` 适用于任一以下影响：

- API 或公共 DTO 的新增、删除、语义变更。
- 数据库 schema、数据语义或迁移变更。
- 跨服务调用、MQ、缓存、第三方接口变更。
- 权限、租户隔离、审计等边界变更。
- 兼容性承诺变化。
- 已有模块、调用方或回归范围需要明确分析的改动。

## 3. 核心决策

### 3.1 Requirement ID 是追溯根

Brownfield 变更的 delta spec Requirement 标题必须带稳定 ID：

```markdown
### Requirement: REQ-001 — Create salary adjustment
```

`REQ-*` 是业务需求的唯一工程追溯根。旧规格和 standard 变更维持现有标题格式，不需要迁移：只有 brownfield 校验 delta spec 的 `REQ-*` 前缀、唯一性以及与追溯表的双向绑定。

### 3.2 不增加第二套需求或实施计划

- `specs/`：业务需求、行为和验收场景。
- `technical-design.md`：工程设计和冻结的技术边界。
- `traceability.json`：机器可校验的关系图。
- `tasks.md`：唯一实施计划。

不新增独立的 “Implementation Plan” 文档，也不为新任务恢复 `execution-contract.md`。

### 3.3 单一技术设计文档，按需展开

首版使用 `technical-design.md`，而非固定创建八个空文件。文档按需包含以下章节：

```text
Architecture
API
Database
Model
Integration
Impact analysis
Sequence
Migration
```

每个设计项必须落在与自己类型对应的二级章节下（`## Architecture`、`## API`、`## Database`、`## Model`、`## Integration`、`## Impact Analysis`、`## Migration`）；放在其他章节下会被判为错误。

当设计规模或团队协作需要拆分时，后续可以支持目录形式；首版不将文件数量作为流程要求。

## 4. 工件布局

```text
openspec/changes/<change>/
├── proposal.md
├── specs/
│   └── <capability>/spec.md
├── design.md
├── technical-design.md          # brownfield 必填；standard 可选
├── traceability.json            # brownfield 必填；standard 可选
├── tasks.md
└── .superpowers/
    └── sdd/
        ├── execution-plan.json
        └── plans/<plan-identity>/
            ├── technical-validation.json
            ├── reviews/
            └── conflicts/
```

`technical-validation.json` 与 conflict report 都是运行时证据，不是新的需求或计划真相。`technical-validation.json` 在计划写入（创建、修订、resync）时随计划落盘，内容包含 profile、validator 版本、状态、技术契约哈希、计划哈希与版本、写入时间和覆盖映射，因此读者不必重跑门禁就能看到当时的映射；两者都按计划身份隔离。

## 5. Proposal 中的工程 Profile

新 `proposal.md` 模板增加一个结构化小节：

```markdown
## Engineering Profile

- **Profile**: brownfield
- **Boundaries**: api, database, integration, public-model
- **Compatibility**: existing API fields remain backward compatible
- **Affected systems**: employee-service, payroll-service
```

规则：

- `Profile` 只能是 `standard` 或 `brownfield`。
- `standard` 不能声明 API、数据库、集成、权限、迁移或公共模型边界。
- `brownfield` 必须有 `technical-design.md` 和 `traceability.json`。
- `Compatibility` 与 `Affected systems` 是给审阅者的声明性说明，首版不做机器校验。
- `Boundaries` 中可机器校验的边界必须被对应设计项覆盖：`api`→`API-*`、`database`→`DB-*`、`integration`→`INT-*`、`public-model`→`MODEL-*`、`migration`→`MIGRATION-*`。`permission` 与 `impact` 目前没有对应类型，仅作声明。
- 没有该小节的既有 planned 变更按 `standard` 处理，确保兼容。

## 6. Technical Design 格式

`technical-design.md` 是可读的工程施工图。所有可追溯对象都使用唯一 ID，并以三级标题声明。

```markdown
# Technical Design

## Architecture

### ARCH-001: Salary adjustment ownership

- Owner: salary-service
- Consumers: employee-service, payroll-service
- Transaction boundary: salary adjustment and salary snapshot update are atomic.

## API

### API-001: Create salary adjustment

- Method: POST
- Path: /api/salary/adjustments
- Caller: hr-web
- Request: employeeId, salaryAfter, reason, effectiveDate
- Response: id, employeeId, salaryBefore, salaryAfter, status
- Authorization: hr.salary.adjust
- Idempotency: client request id
- Compatibility: additive endpoint; existing APIs unchanged

## Database

### DB-001: New salary_adjustment table

- Columns: id, employee_id, salary_before, salary_after, reason, effective_date
- Constraints: employee_id and effective_date are indexed
- Rollback: migration is additive; application rollback remains compatible

## Impact Analysis

### IMPACT-001: Employee details response

- Existing API: GET /employee/{id}
- Affected callers: hr-web, employee-web, payroll-service
- Compatibility: salaryInfo is additive; existing fields and meanings remain unchanged
- Regression: employee query, salary query, payroll calculation, authorization
```

文档可以包含更多细节，但 validator 只依赖稳定 ID、必需章节和 `traceability.json` 中的结构化关系。

必需字段在首版用于 `api`（Method、Path、Request、Response、Authorization、Compatibility）、`database`（Columns、Constraints、Rollback）、`impact`（Affected callers、Compatibility、Regression）与 `architecture`（Owner、Consumers、Transaction boundary）四类；其余类型只校验 ID、章节与引用关系。上面的示例里 `Caller`、`Idempotency` 等字段是可选补充，模板与 validator 不要求它们。

## 7. Traceability Map 格式

`traceability.json` 是 Brownfield 技术契约的机器可读部分。

```json
{
  "schema_version": 1,
  "profile": "brownfield",
  "requirements": [
    {
      "id": "REQ-001",
      "design_items": ["API-001", "DB-001", "MODEL-001", "IMPACT-001"],
      "task_ids": ["1.1", "1.2", "1.3"],
      "test_ids": ["TEST-001", "TEST-002"]
    }
  ],
  "design_items": [
    {
      "id": "API-001",
      "kind": "api",
      "requirements": ["REQ-001"],
      "files": ["FILE-001", "FILE-002"],
      "risk": "high"
    },
    {
      "id": "DB-001",
      "kind": "database",
      "requirements": ["REQ-001"],
      "files": ["FILE-003"],
      "risk": "high"
    },
    {
      "id": "IMPACT-001",
      "kind": "impact",
      "requirements": ["REQ-001"],
      "files": ["FILE-004", "FILE-005"],
      "risk": "high"
    }
  ],
  "files": [
    {
      "id": "FILE-001",
      "path": "salary-service/.../SalaryAdjustmentController.java",
      "symbols": ["createAdjustment"]
    },
    {
      "id": "FILE-003",
      "path": "salary-service/.../V20261008__salary_adjustment.sql"
    }
  ],
  "tasks": [
    {
      "id": "1.1",
      "requirements": ["REQ-001"],
      "design_items": ["DB-001", "MODEL-001"],
      "files": ["FILE-003"],
      "tests": ["TEST-001"]
    }
  ],
  "tests": [
    {
      "id": "TEST-001",
      "requirements": ["REQ-001"],
      "design_items": ["DB-001"],
      "command": "./gradlew :salary-service:test --tests SalaryAdjustmentRepositoryTest"
    }
  ]
}
```

规则：

- ID 在所属类型内必须唯一。
- ID 前缀必须匹配对象类型：`REQ`、`API`、`DB`、`MODEL`、`INT`、`IMPACT`、`FILE`、`TEST`。
- `technical-design.md` 中必须存在每个 `design_items[].id` 的标题。
- `files[].path` 必须是变更仓库内的安全相对路径或明确的 glob。
- `tasks[].id` 必须对应 `tasks.md` 中的 checkbox 任务。
- 映射表引用的是 specs 中已有的 `REQ-*`，不能创建额外业务需求。

## 8. tasks.md 格式扩展

保留现有 checkbox 解析和任务 ID，不引入第二种任务语法。每个 Brownfield 任务在正文中以固定标签引用追溯对象：

```markdown
- [ ] **1.1 创建薪资调整表与领域模型**：实现 DB-001、MODEL-001；
  Refs: REQ-001, DB-001, MODEL-001, FILE-003, TEST-001；
  证明：`./gradlew :salary-service:test --tests SalaryAdjustmentRepositoryTest`
```

Validator 从任务中提取 `Refs:`。任务仍必须包含：

- 唯一编号。
- 受影响路径或边界。
- 可观察结果。
- 验证命令。
- 对应的需求和技术设计引用。

其中可机器校验的三点在 brownfield（以及携带可选技术设计的 standard）变更中由门禁强制：唯一编号、`Refs:` 引用一致、验证命令（`证明：\`<command>\``）；此外任务正文必须出现该任务声明的受控文件路径（或文件名）。“可观察结果”由评审者阅读任务描述判断，首版不做机器校验。

`traceability.json` 是权威机器映射；`tasks.md` 的引用用于人工审阅和交叉校验。

## 9. Technical Validation Gate

新增技术校验模块和 CLI 集成。它只在 `brownfield` profile 下执行。

### 校验规则

| 类别 | 必须满足 |
|---|---|
| Requirement coverage | 每个本次 delta spec 中的 `REQ-*` 都映射到至少一个设计项、任务和测试 |
| Design coverage | 每个设计项都至少被一个任务引用（`tasks[].design_items` 反向覆盖） |
| Boundary coverage | `Boundaries` 中每个可校验边界都有对应类型的设计项 |
| Task coverage | 每个任务引用的 REQ、设计项、文件、测试 ID 都存在且与 map 一致 |
| API coverage | API 项必须有对应任务和测试（与 risk 无关）；设计文档包含 method、path、请求、响应、权限、兼容性 |
| DB coverage | DB 项必须有对应任务和测试（与 risk 无关）；设计文档包含变更类型、迁移和回滚/兼容性说明 |
| Impact coverage | 高风险影响项必须列出调用方、兼容性规则和回归范围，并映射处理任务和测试 |
| File coverage | 每个受控文件必须由至少一个设计项和至少一个任务引用 |
| Test coverage | 每个高风险需求和设计项至少有一个测试对象 |
| Reference integrity | 不允许未知、重复或前缀不匹配的 ID |
| Approval integrity | 技术设计和 map 被纳入计划哈希；批准后的改动使执行计划失效 |

### 输出

`ssf validate <change-dir>` 在通过时打印覆盖映射，失败时打印可操作的错误。

```text
Technical validation: PASS

REQ-001      -> API-001, DB-001, IMPACT-001 -> tasks 1.1, 1.2 -> TEST-001, TEST-002
API-001      -> task 1.2 -> TEST-002
DB-001       -> task 1.1 -> TEST-001
IMPACT-001   -> task 1.3 -> TEST-003
```

失败时输出可操作的错误，例如：

```text
Technical validation: FAIL

- DB-001 has no mapped test.
- TASK 1.2 references API-002, which does not exist.
- IMPACT-001 is high risk but has no regression task.
- REQ-003 exists in specs but is absent from traceability.json.
```

失败阻止 planned workflow 进入 executing。

## 10. CLI 与计划集成

`ssf validate <change-dir>` 扩展为：

- 保留 proposal/spec 的既有校验。
- 检测 proposal 的 Engineering Profile。
- 对 `brownfield` 自动执行技术校验。
- 输出业务工件和技术工件的合并报告。

`ssf workflow start <change-dir> --path planned --confirm ...` 在生成 execution plan 前调用技术校验：

```text
proposal/tasks exist
       |
       v
profile == standard? ---- yes ---> current compact flow
       |
       no
       v
validate technical-design + traceability
       |
       v
create schema-v2 execution plan
```

Execution plan 增加可审计摘要：

```json
{
  "schema_version": 2,
  "technical_validation": {
    "profile": "brownfield",
    "validator_version": 1,
    "technical_contract_hash": "sha256:...",
    "status": "pass"
  }
}
```

计划仍以总 `artifacts_hash` 判定是否陈旧。对于 Brownfield 变更，该 hash 覆盖：

```text
proposal.md
specs/**/*.md
design.md
technical-design.md
traceability.json
tasks.md
```

既有 standard 和 legacy 变更保持旧哈希语义，避免升级后意外失效。

门禁按 **Engineering Profile** 判定，而不是按计划形状判定：任何形态的执行计划（包括 `ssf execution revise` 产生的旧式计划）只要执行 brownfield 变更，都必须携带匹配的技术证据。`createPlan` 会自动写入该证据，技术校验不通过时直接拒绝创建计划；缺失、版本不符或哈希不符都视为无效计划并按 §10 的方式报告失败原因。审查与完成阶段的冲突检查同样按 profile 判定。

## 11. build-executor Guardrail

执行器在 Brownfield 任务开始前读取：

- 当前任务 ID。
- 该任务的 `REQ-*`。
- 对应技术设计项。
- 文件边界。
- 测试义务。
- 已批准的兼容性与权限约束。

执行器允许：

- 在批准范围内定位文件和符号。
- 选择局部实现细节。
- 增加契约保持的实现与测试。
- 对批准范围内代码进行局部重构。
- 调整不改变技术契约的实现顺序。

执行器必须停止并报告：

- 新增、删除或改变业务 Requirement。
- 修改 API method、path、请求、响应或错误语义。
- 改变数据库语义、迁移保证或回滚方式。
- 扩大外部服务、消息、缓存、权限或数据影响。
- 修改兼容性承诺。
- 修改未映射的生产文件。
- 发现设计与真实代码接口不一致，且修复需要改变已批准设计。

Conflict Report 写入（目录按计划身份隔离，因此一次重新批准会产生新的计划身份，旧计划下已记录的冲突不再约束新计划）：

```text
.superpowers/sdd/plans/<plan-identity>/conflicts/<task-id>-<timestamp>.md
```

报告必须包含：

```text
Task: 1.2                                  (--task)
Detected Conflict: ...                     (--summary)
Affected: REQ-001, API-001, IMPACT-001      (--affected)
Why Execution Cannot Resolve It Safely: ... (--why)
Required Next Action: ...                  (--next)
```

报告不会伪造通过结果，也不会由执行器静默扩展范围。

执行期间记录冲突会让 `ssf workflow complete` 与通过记录的最终审查都被阻止，直到重新编写技术设计并重新批准计划；`--accept-risk` 也不能绕过未解决的冲突。

## 12. Skills 设计

新增三个按需加载的 Skill：

| Skill | 职责 |
|---|---|
| `technical-designer` | 基于 specs 和现有代码编写 `technical-design.md` 与初始 `traceability.json` |
| `impact-analyzer` | 调查已有 API、调用方、模块、数据、集成与回归范围，生成或审查 `IMPACT-*` 项 |
| `contract-validator` | 执行可追溯与覆盖校验，输出通过/失败报告，并阻止不完整 Brownfield 计划进入执行 |

它们是职责模块，不是新增状态机阶段。

**落地状态**：三个 Skill 已创建，并已同步 `plugin.json`、`cmd-doctor` 的 `RUNTIME_SKILLS`、`check-version-consistency` 的 `RUNTIME_FILES`、`cmd-uninstall-codebuddy` 的卸载列表、`token-baseline` 与 README/INSTALL/平台矩阵的技能计数。`spec-writer` 与 `workflow-start` 在 brownfield 路径上把设计、影响分析和门禁交给它们；`build-executor` 仍负责按 `Refs:` 执行并在冲突时记录 Conflict Report。

推荐调用链：

```text
need-explorer
   |
spec-writer
   |
technical-designer ----> impact-analyzer
   |                          |
   +------------> contract-validator
                               |
                               v
                    one combined user approval
                               |
                               v
                         workflow-start
                               |
                               v
                         build-executor
```

一个批准点同时覆盖 proposal、specs、design、technical design、traceability map 和 tasks。

## 13. 兼容策略

- `direct` 路径完全不变。
- 既有 planned 变更没有 Engineering Profile 时按 `standard` 运行。
- legacy change 继续使用既有 `execution-contract.md` 义务；新功能不改变其恢复路径。
- 新模板默认生成 `Profile: standard`。
- `brownfield` 是前向增强，不自动迁移历史 change。
- `technical-design.md` 与 `traceability.json` 只在 brownfield profile 下纳入哈希和强制校验。

## 14. 实施顺序

当前状态：P0、P1、P2 均已落地。P2 的三个独立 Skill、runtime allowlist/安装器/平台清单，以及 `docs/examples/brownfield-salary-adjustment` 示例 change 都已完成；README、INSTALL、平台矩阵与技术计数的同步见各节说明。

### P0：技术契约与校验

1. 增加 Engineering Profile 模板与解析器。
2. 增加 `technical-design.md`、`traceability.json` 模板。
3. 实现 Requirement ID、技术设计 ID、traceability map 与任务引用解析。
4. 实现技术校验报告和 `ssf validate` 集成。
5. 为 Brownfield 变更扩展 artifact hash。
6. 在 `workflow start --path planned` 前接入阻断门禁。

### P1：执行约束

1. 在 execution plan 记录技术校验摘要。
2. 扩展 build-executor 指令，加载当前任务的映射边界。
3. 增加 Conflict Report 格式与停止规则。
4. 在最终 review 中检查未映射生产文件变更。

### P2：体验与分发

1. 新增三个 Skill 和模板。（已完成：`technical-designer`、`impact-analyzer`、`contract-validator` + `technical-design.md` / `traceability.json` 模板）
2. 更新 runtime allowlist、安装器检查和平台清单。（已完成：`ssf technical` 已进入 `SSF_SUBCOMMANDS` 与各分发一致性检查）
3. 更新 README、中文/英文文档与示例 change。（已完成：技能计数与调用链已更新，`docs/examples/brownfield-salary-adjustment` 已加入并被 `npm run validate` 覆盖）
4. 以后再评估是否支持拆分 `technical-design/` 目录和更细的 API/DB 专用格式。

## 15. 测试策略

- Requirement 标题中 `REQ-*` 的提取与重复 ID 拒绝。
- `technical-design.md` 中缺失 API、DB、IMPACT 标题的拒绝。
- `traceability.json` schema、未知引用、重复 ID、错误前缀、越界路径的拒绝。
- Requirement、设计项、任务、测试之间的覆盖检查。
- `standard`、`brownfield` 和旧 planned 变更的兼容行为。
- Brownfield 计划在技术设计或追溯表修改后失效。
- Brownfield 验证失败时 `workflow start` 不进入 executing。
- 执行器发现未映射文件或技术冲突时生成 Conflict Report。
- 安装器能将新增 Skills、模板和 runtime 校验逻辑复制至支持的平台。
- 构建、全量测试、现有 examples 的 validation 均保持通过。

## 16. 非目标

- 不把技术设计变成第二份业务需求。
- 不引入独立 Superpowers `writing-plans` 作为计划来源。
- 不改变 direct 路径。
- 不恢复新任务的手写 `execution-contract.md`。
- 不按任务数量、文件数量或子代理可用性自动扩大流程。
- 不在首版自动推断所有 API、数据库、调用方或符号关系；这些必须由技术设计和影响分析明确声明并经批准。
