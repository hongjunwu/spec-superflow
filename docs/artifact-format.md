# Artifact Format Contract

工件格式的**权威机器契约**。所有规则直接来自校验器源码（标注了位置），`ssf validate <dir>` 按本文档执行。写工件前先读本文，不要靠报错试错。

- 校验入口：`scripts/lib/cmd-validate.mjs` + `dist/` 里的 `Validator`
- 技术校验（brownfield）：`scripts/lib/technical-validation.mjs`（`TECHNICAL_VALIDATOR_VERSION = 1`）
- 任务解析：`scripts/lib/task-parser.mjs`

---

## proposal.md

| 规则 | 级别 | 来源 |
|---|---|---|
| 必须有 `## Why` 段落（支持 `## 背景（Why）` 双语标题），正文 ≥ 50 字符，≤ 1000 字符（超出仅 WARNING） | ERROR | `src/validation/validator.ts` `validateChangeContent` + `constants.ts` |
| 必须有 `## What Changes` 段落且非空 | ERROR | 同上 |

**Engineering Profile 段落**（`scripts/lib/technical-validation.mjs` `parseEngineeringProfile`）：

- 标题必须是**二级标题**：`## Engineering Profile`（`###` 三级标题不会被识别，静默回退 standard）
- Profile 必须是列表项：`- Profile: brownfield` 或 `- **Profile**: brownfield`（值只接受 `standard` / `brownfield`，大小写不敏感）
- `standard` 不得声明 Boundaries；`brownfield` 至少声明一个
- Boundaries 枚举：`api`、`database`、`integration`、`public-model`、`permission`、`migration`、`impact`（写 `arch` 之类的缩写是未知值，直接报错）

正例（brownfield）：

```markdown
## Engineering Profile

- **Profile**: brownfield
- **Boundaries**: api, database
- **Compatibility**: 既有 /adjustments 接口保持向后兼容
- **Affected systems**: hr-web, payroll-service
```

反例（会被解析为 standard，进而产生 `profile must be 'standard'` 的误导性连锁报错）：

```markdown
### Engineering Profile        <!-- 三级标题：不识别 -->

Profile: brownfield            <!-- 不是列表项：不识别 -->
```

---

## specs/

**布局**（`scripts/lib/spec-paths.mjs`）：

- 唯一合法路径是 `specs/<capability>/spec.md`——必须是一层能力子目录
- `specs/spec.md`、`specs/foo.md`、`specs/a/b/spec.md` 全部非法

**Delta 格式**（`dist/` `Validator.validateDeltaSpec`）：

- 需求分组在 `## ADDED Requirements` / `## MODIFIED Requirements` / `## REMOVED Requirements` / `## RENAMED Requirements` 之下，至少一个 delta 段
- 每个 Requirement 必须含 `SHALL` 或 `MUST`，且至少一个 `#### Scenario:` 块（WHEN/THEN）
- 需求标题：`### Requirement: <name>`

**Brownfield 附加**（`technical-validation.mjs` `readRequirementIds`）：

- 需求名必须以 `REQ-*` 开头（`### Requirement: REQ-001 — Create adjustment`），ID 全局唯一
- 至少一个 `REQ-*` 需求

**Delta 操作语义**（`scripts/lib/spec-publication.mjs`）：delta 描述的是**对规格基线的变更**，不是对代码的变更。

- `MODIFIED` 要求已发布基线里存在同名需求；基线为空（从未规格化）时用 `ADDED`，并在需求文本中标注 `[legacy]` 表明这是对既有行为的规格化
- `ADDED` 到已有同名需求会报错；近似名（大小写/空白/标点差异）会拒绝而不是当 no-op

---

## technical-design.md（brownfield 必需）

**标题格式**（`readTechnicalHeadings`）：每个设计项一个三级标题 `### <ID>: <标题>`，ID 前缀必须是完整 kind 词——`API-001`、`DB-001`、`MODEL-001`、`INT-001`、`IMPACT-001`、`ARCH-001`、`MIGRATION-001`。写 `ARCH` 可以，写 `ARCH-1` 缺位数或 `ARCHITECTURE-001` 都不识别。

**kind 与所属二级段落**（`KIND_SECTION`）：设计项必须放在对应的 `## <Section>` 之下：

| kind | 段落 | 必填字段（列表项形式） |
|---|---|---|
| `architecture` | `## Architecture` | Owner, Consumers, Transaction boundary |
| `api` | `## API` | Method, Path, Request, Response, Authorization, Compatibility |
| `database` | `## Database` | Columns, Constraints, Rollback |
| `model` | `## Model` | — |
| `integration` | `## Integration` | — |
| `impact` | `## Impact Analysis` | Affected callers, Compatibility, Regression |
| `migration` | `## Migration` | — |

正例：

```markdown
## API

### API-001: Create adjustment

- Method: POST
- Path: /adjustments
- Request: salary
- Response: adjustment
- Authorization: salary.write
- Compatibility: additive
```

---

## traceability.json（brownfield 必需）

顶层（`validateTraceability`）：

- `schema_version: 1`；`profile` 必须与 proposal 解析结果一致（`brownfield` ↔ `brownfield`）
- 五个集合都是数组：`requirements`、`design_items`、`files`、`tasks`、`tests`

**ID 前缀规则**（`requireIdPrefix`）：`REQ-<n>`、`API-<n>`、`DB-<n>`、`MODEL-<n>`、`INT-<n>`、`IMPACT-<n>`、`ARCH-<n>`、`MIGRATION-<n>`、`FILE-<n>`、`TEST-<n>`，task id 是纯数字（`1.1`；`T1` 非法）。

**引用与双向覆盖**：

- requirement → design_items / task_ids / test_ids（各至少 1 个）
- design_item → requirements / files（各至少 1 个），且每个 design_item 必须被至少一个 task 实现（`has no mapped task`）
- `api`/`database` kind 或 `risk: "high"` 的 design_item 必须映射至少一个 TEST
- FILE 必须被至少一个 design_item **和**至少一个 task 引用
- proposal 声明的 boundary 必须有对应 kind 的 design item（`api` → API-*, `database` → DB-*, `integration` → INT-*, `public-model` → MODEL-*, `migration` → MIGRATION-*）
- technical-design.md 的每个 `### <ID>:` 标题必须在 traceability 里声明，反之亦然
- FILE 的 `path` 必须是安全相对路径（拒绝绝对路径与 `..`）；伙伴仓库的文件用 `<partner-name>:<relative-path>` 前缀（如 `partnerSalary-web:src/api/user.ts`），前缀必须与 `spec-superflow.config.json` 的 `partner_repos[].name` 一致，冒号后的部分仍走安全相对路径规则

**tasks 三处逐字同步**（最易漏）：traceability 里 task 声明的 `requirements` / `design_items` / `files` / `tests` 每个引用，都必须出现在 tasks.md 该任务条目（checkbox 行 + 缩进续行）的 `Refs:` 行里，ID 逐字一致。

---

## tasks.md

**Checkbox 格式**（`task-parser.mjs`）：

- 每个任务一行：`- [ ] **<纯数字 ID> <动词开头的交付>**：...`，ID 形如 `1.1`、`1.2`（只接受 `\d+(\.\d+)*`，`T1` 非法）
- 续行（缩进）会并入任务体：`Refs:` 行和证明行写在这里

**Brownfield 任务体**（`validateTaskBody`）：

- 必须含证明命令：`` 证明：`<command>` ``（或 `Proof:`），反引号内是命令本体
- 必须点名它修改的文件（完整路径或文件名，与 traceability 的 FILE path 对应）

正例：

```markdown
- [ ] **1.1 创建调薪接口**：修改 `src/adjustment.mjs`，新增 POST /adjustments；证明：`node --test`
  Refs: REQ-001, API-001, FILE-001, TEST-001
```

反例：ID 写 `T1`、`Refs:` 漏任何一个已声明引用、缺 `证明：` 行、任务体没点名文件——四者都会挂校验。

---

## 校验失败的排查顺序

1. 先看 **proposal.md** 的 issues（Engineering Profile 段落不识别会在这里报根因，其余错误多数是它的连锁）
2. 再看 **technical-design.md** 的标题/字段问题
3. 最后核对 **traceability ↔ tasks.md** 的逐字同步
4. 全部通过后跑 `ssf workflow complete <dir> --dry-run` 做收口预检
