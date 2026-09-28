# Workflow Verify API 接口文档

> **版本**：v1.0 &nbsp;|&nbsp; **更新日期**：2026-05-08  
> **适用对象**：外部平台集成方（PMS 等审批系统）

---

## 1. 概述

`POST /api/review/workflow/verify` 是三维编校审流程中的**预校验接口**。

**核心特性**：

- **只读**：不修改任何数据库记录，仅返回校验结果
- **闸口角色**：在调用 `workflow/sync`（真正推进流程）之前必须先调用 `verify` 进行预检
- **标准调用顺序**：`verify` → 确认 `passed=true` → `sync`

---

## 2. 接口规格

### 2.1 基本信息

| 项目 | 值 |
|------|------|
| URL | `POST /api/review/workflow/verify` |
| Content-Type | `application/json` |
| 认证方式 | 请求体中携带 `token`（通过 `/api/review/embed-url` 获取） |

### 2.2 请求体（Request Body）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `form_id` | `string` | **是** | 编校审流程主键，由 PMS 与模型中心共享的唯一标识 |
| `token` | `string` | **是** | 用户令牌，通过 `/api/review/embed-url` 接口获取（HMAC-SHA256 签名） |
| `action` | `string` | **是** | 流程动作，取值见下方 [Action 枚举](#23-action-枚举) |
| `actor` | `object` | 否* | 操作人信息，结构见下方 [Actor 对象](#24-actor-对象) |
| `next_step` | `object \| null` | 视 action | 下一步信息，结构见下方 [NextStep 对象](#25-nextstep-对象) |
| `comments` | `string` | 否 | 操作人填写的处理意见 |
| `metadata` | `object \| null` | 否 | 透传字段，用于来源追踪（如 `{ "source": "pms" }`） |

> **\* `actor` 可选说明**：当 `token` 是通过 `/api/review/embed-url` 获取的标准 JWT 时，token claims 中已包含 `user_id`、`role`、`user_name`，后端会自动推导 actor 信息，**无需显式传入 `actor`**。仅在 `debug_token` 模式（token 无 JWT claims）下才必须显式提供。推荐新集成方省略此字段。

### 2.3 Action 枚举

| 值 | 含义 | 谁能发起 | `next_step` 是否必填 |
|------|------|------|------|
| `active` | 发起送审 / 退回后重新发起 | 设计人员（SJ） | **是**，填写下一节点角色 |
| `agree` | 同意并推进到下一节点 | 校对 / 审核（JH / SH / PZ） | **是**，填写下一节点角色（PZ 终审可不填） |
| `return` | 驳回到上游节点 | 校对 / 审核 / 审定 | **是**，填写目标节点角色 |
| `stop` | 终止流程 | 任意未完结节点 | 否 |

### 2.4 Actor 对象

```json
{
  "id": "JH",
  "name": "JH",
  "roles": "jd"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `string` | **是** | PMS 人员编号（HumanCode），如 `SJ`、`JH`、`SH`、`PZ` |
| `name` | `string` | **是** | 人员显示名称 |
| `roles` | `string` | **是** | 节点角色标识，取值：`sj` / `jd` / `sh` / `pz` |

**约束**：

- `id` 必须与编校审任务中对应节点的 owner 严格一致（如 `checker_id`、`approver_id`）
- `roles` 必须与当前任务节点匹配

> **省略 `actor` 时**，后端从 token claims 自动构建：`actor.id` = `claims.user_id`，`actor.roles` = `claims.role`，`actor.name` = `claims.user_name`（空时回退到 `user_id`）。因此 `/api/review/embed-url` 请求时必须正确设置 `workflow_role` 和 `user_id`。

### 2.5 NextStep 对象

```json
{
  "assignee_id": "SH",
  "name": "SH",
  "roles": "sh"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `assignee_id` | `string` | **是** | 下一节点负责人的 HumanCode |
| `name` | `string` | **是** | 下一节点负责人显示名称 |
| `roles` | `string` | **是** | 下一节点角色，取值：`sj` / `jd` / `sh` / `pz` |

**典型流转**：

| 当前动作 | 当前节点 | `next_step.roles` |
|------|------|------|
| `active`（送审） | sj | `jd`（校对） |
| `agree`（同意） | jd | `sh`（审核） |
| `agree`（同意） | sh | `pz`（审定） |
| `agree`（终审通过） | pz | 不填或 `null` |
| `return`（驳回） | jd / sh / pz | 目标上游节点角色（如 `sj`） |

---

## 3. 响应结构

### 3.1 响应体

```json
{
  "code": 0,
  "message": "success",
  "data": { ... },
  "annotation_check": { ... }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | `number` | 状态码，`0` 表示请求处理成功（不代表校验通过） |
| `message` | `string` | 状态信息 |
| `data` | `object` | 校验结果，详见下方 |
| `annotation_check` | `object \| undefined` | 批注门禁详细结果（仅在 `blockCode=ANNOTATION_CHECK_FAILED` 时携带） |

### 3.2 Data 对象

```json
{
  "passed": true,
  "action": "agree",
  "current_node": "jd",
  "task_status": "in_review",
  "next_step": "sh",
  "reason": "",
  "recommended_action": "proceed"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `passed` | `boolean` | **核心字段**——是否允许继续调用 `workflow/sync` |
| `action` | `string` | 回显请求中的 action |
| `block_code` | `string \| undefined` | 校验失败时的诊断码，见 [BlockCode 速查](#34-blockcode-速查) |
| `current_node` | `string` | 当前任务所在节点 |
| `task_status` | `string` | 当前任务状态 |
| `next_step` | `string \| undefined` | 预期的下一节点 |
| `actor_id` | `string \| undefined` | 请求中的操作人 ID（诊断用） |
| `owner_id` | `string \| undefined` | 任务中对应节点的实际 owner（诊断用） |
| `owner_source` | `string \| undefined` | owner 来源字段名（诊断用） |
| `expected_next_node` | `string \| undefined` | 系统预期的下一节点（诊断用） |
| `requested_next_step` | `object \| undefined` | 请求中传入的 `next_step`（诊断用） |
| `reason` | `string` | 失败原因的可读描述 |
| `recommended_action` | `string` | 建议后续操作：`proceed` / `return` / `block` |

### 3.3 RecommendedAction 含义

| 值 | 含义 | 外部平台应对策略 |
|------|------|------|
| `proceed` | 校验通过，可继续调用 `sync` | 立即调用 `workflow/sync` |
| `return` | 建议先驳回处理 | 提示用户先处理待确认项（如批注），再决定是否驳回 |
| `block` | 彻底拒绝，不可继续 | 展示 `reason` 给用户，需修正数据后重试 |

### 3.4 BlockCode 速查

| blockCode | 触发原因 | recommendedAction |
|------|------|------|
| `OWNER_MISMATCH` | `actor.id` 与任务 owner 不匹配 | `block` |
| `INVALID_IDENTITY` | `actor.roles` 或 `actor.id` 未通过身份校验 | `block` |
| `NEXT_STEP_INVALID` | `next_step` 缺失或角色不匹配 | `block` |
| `ANNOTATION_CHECK_FAILED` | 批注门禁未通过（有待处理批注） | `return` 或 `block` |
| `WORKFLOW_NODE_INVALID` | 当前节点与任务实际状态不一致 | `block` |

### 3.5 AnnotationCheck 对象（批注门禁详情）

当 `block_code` 为 `ANNOTATION_CHECK_FAILED` 时，响应顶层携带 `annotation_check` 字段：

```json
{
  "annotation_check": {
    "passed": false,
    "recommended_action": "return",
    "current_node": "jd",
    "summary": {
      "total": 5,
      "open": 1,
      "pending_review": 2,
      "approved": 2,
      "rejected": 0
    },
    "blockers": [
      {
        "annotation_id": "ann-001",
        "annotation_type": "text",
        "title": "管道标注错误",
        "state_code": "open",
        "state_label": "待处理",
        "refnos": ["P-101"]
      }
    ]
  }
}
```

---

## 4. 完整调用示例

### 4.1 发起送审（SJ → JH）

**请求（推荐，省略 actor，由 token 自动推导）**：

```bash
curl -X POST 'https://<host>/api/review/workflow/verify' \
  -H 'Content-Type: application/json' \
  -d '{
    "form_id": "FORM-2026-001",
    "token": "<embed-url 返回的 user_token>",
    "action": "active",
    "next_step": {
      "assignee_id": "JH",
      "name": "JH",
      "roles": "jd"
    },
    "comments": "请校对审阅",
    "metadata": { "source": "pms" }
  }'
```

**兼容写法（显式传 actor，旧集成方或 debug_token 模式）**：

```bash
curl -X POST 'https://<host>/api/review/workflow/verify' \
  -H 'Content-Type: application/json' \
  -d '{
    "form_id": "FORM-2026-001",
    "token": "<embed-url 返回的 user_token>",
    "action": "active",
    "actor": {
      "id": "SJ",
      "name": "SJ",
      "roles": "sj"
    },
    "next_step": {
      "assignee_id": "JH",
      "name": "JH",
      "roles": "jd"
    },
    "comments": "请校对审阅"
  }'
```

**成功响应**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "passed": true,
    "action": "active",
    "current_node": "sj",
    "task_status": "draft",
    "next_step": "jd",
    "reason": "",
    "recommended_action": "proceed"
  }
}
```

### 4.2 校对同意（JH → SH）

**请求**：

```bash
curl -X POST 'https://<host>/api/review/workflow/verify' \
  -H 'Content-Type: application/json' \
  -d '{
    "form_id": "FORM-2026-001",
    "token": "<user_token>",
    "action": "agree",
    "next_step": {
      "assignee_id": "SH",
      "name": "SH",
      "roles": "sh"
    },
    "comments": "校对同意"
  }'
```

**失败响应（批注未处理完）**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "passed": false,
    "action": "agree",
    "block_code": "ANNOTATION_CHECK_FAILED",
    "current_node": "jd",
    "task_status": "in_review",
    "reason": "存在待确认批注，无法继续流转",
    "recommended_action": "return"
  },
  "annotation_check": {
    "passed": false,
    "recommended_action": "return",
    "current_node": "jd",
    "summary": { "total": 3, "open": 0, "pending_review": 1, "approved": 2, "rejected": 0 },
    "blockers": [
      {
        "annotation_id": "ann-002",
        "annotation_type": "cloud",
        "state_code": "pending_review",
        "state_label": "待审阅",
        "refnos": ["V-201"]
      }
    ]
  }
}
```

### 4.3 驳回（JH → SJ）

```bash
curl -X POST 'https://<host>/api/review/workflow/verify' \
  -H 'Content-Type: application/json' \
  -d '{
    "form_id": "FORM-2026-001",
    "token": "<user_token>",
    "action": "return",
    "next_step": {
      "assignee_id": "SJ",
      "name": "SJ",
      "roles": "sj"
    },
    "comments": "管道标注需要修正"
  }'
```

### 4.4 终止流程

```bash
curl -X POST 'https://<host>/api/review/workflow/verify' \
  -H 'Content-Type: application/json' \
  -d '{
    "form_id": "FORM-2026-001",
    "token": "<user_token>",
    "action": "stop"
  }'
```

---

## 5. 集成时序

### 5.1 标准流程：verify → sync

```
外部平台                          模型中心后端
   │                                  │
   │  POST /workflow/verify           │
   │ ──────────────────────────────> │
   │                                  │  校验身份 / 节点 / 批注
   │  { passed: true/false }          │
   │ <────────────────────────────── │
   │                                  │
   │  [仅 passed=true 时]             │
   │  POST /workflow/sync             │
   │ ──────────────────────────────> │
   │                                  │  写库、推进流程
   │  { taskStatus, currentNode }     │
   │ <────────────────────────────── │
```

### 5.2 关键规则

1. **必须先 verify 再 sync**：不能跳过 verify 直接调 sync
2. **同一 token**：verify 和 sync 必须使用同一个 token
3. **passed=false 时禁止 sync**：应根据 `recommended_action` 引导用户处理
4. **token 获取**：通过 `POST /api/review/embed-url` 接口获取，每个 form_id + 用户组合对应唯一 token

---

## 6. 节点流转路径

```
  ┌──────┐     active     ┌──────┐     agree     ┌──────┐     agree     ┌──────┐
  │  SJ  │ ─────────────> │  JD  │ ─────────────> │  SH  │ ─────────────> │  PZ  │
  │(设计) │               │(校对) │               │(审核) │               │(审定) │
  └──────┘               └──────┘               └──────┘               └──────┘
      ^                     │ │                     │ │                     │
      │      return         │ │      return         │ │      return        │
      └─────────────────────┘ └─────────────────────┘ └────────────────────┘

  任意节点 ──── stop ────> cancelled
  PZ agree（无 next_step）──> approved（终态）
```

---

## 7. 错误处理

### 7.1 HTTP 层错误

| HTTP 状态码 | 原因 | 处理方式 |
|------|------|------|
| `401` | token 无效或已过期 | 重新调用 `/api/review/embed-url` 获取新 token |
| `400` | 请求体格式错误 | 检查 JSON 结构和必填字段 |
| `500` | 服务端内部错误 | 记录日志并重试 |

### 7.2 业务层错误（HTTP 200 但 `passed=false`）

根据 `block_code` 和 `recommended_action` 的组合处理：

| block_code | recommended_action | 建议操作 |
|------|------|------|
| `OWNER_MISMATCH` | `block` | 检查操作人 ID 是否正确，对比 `actor_id` 与 `owner_id` |
| `INVALID_IDENTITY` | `block` | 检查 `actor.roles` 和 `actor.id` 是否为合法值 |
| `NEXT_STEP_INVALID` | `block` | 参照 `expected_next_node` 修正 `next_step` |
| `ANNOTATION_CHECK_FAILED` | `return` | 提示用户先处理批注，或引导执行驳回操作 |
| `ANNOTATION_CHECK_FAILED` | `block` | SJ 节点：必须先处理全部 open/rejected 批注 |
| `WORKFLOW_NODE_INVALID` | `block` | 任务状态已变更，需重新获取任务信息 |

---

## 8. 批注门禁规则

编校审流程中，批注状态直接影响 verify 结果：

| 当前节点 | 批注状态 | verify 结果 |
|------|------|------|
| SJ（设计） | 含 `open` 或 `rejected` | **阻止** active，`block_code=ANNOTATION_CHECK_FAILED` |
| SJ | 全部 `fixed` / `wont_fix` / `agreed` | 允许 active |
| JD/SH/PZ | 含 `open` 或 `rejected` | 建议驳回，`recommended_action=return` |
| JD/SH/PZ | 含 `pending` 待确认 | **阻止** agree |
| JD/SH/PZ | 全部 `agreed` | 允许继续流转 |

> **注意**：门禁仅校验 `text`、`cloud`、`rect` 三种批注类型，不包含 OBB 包围盒批注。

---

## 9. 注意事项

1. **Actor 推导**：推荐省略 `actor` 字段，由 token claims 自动推导；若显式传入，必须使用 PMS 系统中的 HumanCode（如 `SJ`、`JH`、`SH`、`PZ`）
2. **Token 有效期**：token 有时效限制，长时间操作后建议重新获取
3. **幂等性**：verify 为只读操作，重复调用安全
4. **并发**：同一 form_id 的 verify 和 sync 应串行调用，避免竞态
5. **字段命名**：后端响应使用 `snake_case`（如 `block_code`、`current_node`），部分场景也兼容 `camelCase`
