# 三维校审 workflow/verify API 外部接入说明

> 版本：2026-05-08  
> 适用对象：PMS、工作流平台、第三方系统集成方  
> 接口用途：在真正调用 `workflow/sync` 推进流程前，预校验当前单据是否允许执行 `active / agree / return / stop`。

## 1. 核心结论

`workflow/verify` 是三维校审外部审批链路的预校验接口。它只做校验，不写业务状态；只有当返回 `data.passed = true` 时，调用方才可以继续调用 `POST /api/review/workflow/sync`。

标准调用顺序：

1. PMS 通过 `POST /api/review/embed-url` 获取嵌入地址和 `user_token`。
2. 用户在三维校审页面完成编校审数据保存、批注处理或意见填写。
3. PMS 调用 `POST /api/review/workflow/verify` 做预校验。
4. 仅当 `data.passed = true` 时，PMS 调用 `POST /api/review/workflow/sync` 真正推进流程。
5. 如果 `data.passed = false`，PMS 应展示 `data.reason`，并按 `data.recommended_action` 处理，不应继续调用 `workflow/sync`。

## 2. 接口规格

### 2.1 URL 与方法

```http
POST {BASE_URL}/api/review/workflow/verify
Content-Type: application/json
```

`{BASE_URL}` 由部署环境提供，例如：

```text
https://model-center.example.com
```

### 2.2 认证方式

请求体中的 `token` 为必填字段，值来自 `embed-url` 返回的 `user_token`。

当前实现会校验 `token`，并可从 token claims 中补齐调用人身份。为便于排查和兼容调试环境，外部 PMS 推荐仍显式传 `actor`。

## 3. 请求体

```json
{
  "form_id": "FORM-20260508-0001",
  "token": "<user_token from embed-url>",
  "action": "agree",
  "actor": {
    "id": "JH",
    "name": "JH",
    "roles": "jd"
  },
  "next_step": {
    "assignee_id": "SH",
    "name": "SH",
    "roles": "sh"
  },
  "comments": "校对同意，提交审核",
  "metadata": {
    "source": "pms",
    "request_id": "PMS-REQ-0001"
  }
}
```

### 3.1 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `form_id` | string | 是 | PMS 与模型中心共享的单据稳定主键。必须与嵌入页使用的 `form_id` 一致。 |
| `token` | string | 是 | `embed-url` 返回的 `user_token`。verify 与后续 sync 建议使用同一个 token。 |
| `action` | string | 是 | 工作流动作。可选值：`active`、`agree`、`return`、`stop`。`query` 不支持 verify。 |
| `actor` | object | 推荐 | 当前操作人。新合同下可由 token claims 补齐，但外部调用建议显式传入。 |
| `actor.id` | string | 推荐 | PMS HumanCode，例如 `SJ`、`JH`、`SH`、`PZ`。 |
| `actor.name` | string | 否 | 操作人显示名。为空时后端可用 `id` 兜底。 |
| `actor.roles` | string | 推荐 | 当前操作人的工作流角色：`sj`、`jd`、`sh`、`pz`。 |
| `next_step` | object | 视动作而定 | 下一节点信息。`active`、`return`、`jd/sh` 节点的 `agree` 必填；`pz` 节点 `agree` 与 `stop` 不需要。 |
| `next_step.assignee_id` | string | 视动作而定 | 下一节点负责人 PMS HumanCode。 |
| `next_step.name` | string | 否 | 下一节点负责人显示名。 |
| `next_step.roles` | string | 视动作而定 | 下一节点角色：`sj`、`jd`、`sh`、`pz`。 |
| `target_node` | string | 否 | `return` 可用的目标节点字段，取值 `sj`、`jd`、`sh`。如与 `next_step.roles` 同时存在，以 `target_node` 为准。 |
| `comments` | string | 否 | 用户处理意见。verify 不写库，但会参与请求诊断；sync 时同样应传入。 |
| `metadata` | object | 否 | 调用方透传诊断字段，例如来源系统、请求号、客户端版本。 |

### 3.2 身份规则

外部调用必须使用 PMS HumanCode，不再使用旧内部测试账号。

允许格式：

```text
大写字母 / 数字 / 连字符
示例：SJ、JH、SH、PZ、A01、JH-01
```

不允许格式：

```text
proofreader_001
reviewer_001
manager_001
designer_001
admin_001
```

RUS-241 修复后，旧内部账号会被视为错误数据。若新建单据 owner 中仍出现 `proofreader_001 / manager_001`，应修复建单 payload 或数据源，不应在 verify 或前端继续做别名兼容。

### 3.3 action 与 next_step 规则

| action | 当前节点 | 调用人 | next_step 要求 | 说明 |
|---|---|---|---|---|
| `active` | `sj` | `SJ` | 必填，`roles = jd`，`assignee_id = JH` | 设计提交到校对。 |
| `agree` | `jd` | `JH` | 必填，`roles = sh`，`assignee_id = SH` | 校对同意，提交审核。 |
| `agree` | `sh` | `SH` | 必填，`roles = pz`，`assignee_id = PZ` | 审核同意，提交批准。 |
| `agree` | `pz` | `PZ` | 不需要 | 批准同意，任务进入 `approved`。 |
| `return` | `jd/sh/pz` | 当前节点 owner | 必填，目标节点必须位于当前节点之前 | 驳回到上游节点。 |
| `stop` | `jd/sh/pz` | 当前节点 owner | 不需要 | 终止流程。 |

## 4. 响应体

### 4.1 通过示例

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "passed": true,
    "action": "agree",
    "current_node": "jd",
    "task_status": "submitted",
    "next_step": "sh",
    "reason": "验证通过，可继续流转",
    "recommended_action": "proceed"
  }
}
```

### 4.2 业务阻断示例

业务阻断通常返回 HTTP 200，但 `data.passed = false`。调用方必须以 `data.passed` 为准，不能只看 HTTP 状态码。

```json
{
  "code": 200,
  "message": "agree 权限不足：当前请求人 JH 不是 checker 节点负责人 SH",
  "data": {
    "passed": false,
    "action": "agree",
    "block_code": "OWNER_MISMATCH",
    "current_node": "jd",
    "task_status": "submitted",
    "next_step": "sh",
    "actor_id": "JH",
    "owner_id": "SH",
    "owner_source": "checker",
    "expected_next_node": "sh",
    "requested_next_step": {
      "assignee_id": "SH",
      "name": "SH",
      "roles": "sh"
    },
    "reason": "agree 权限不足：当前请求人 JH 不是 checker 节点负责人 SH",
    "recommended_action": "block"
  }
}
```

### 4.3 顶层字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | number | 业务码。通过或软阻断通常为 `200`；认证/参数错误可能为 `401/400/404/500`。 |
| `message` | string | 人类可读信息。失败时可用于日志或提示。 |
| `data` | object \| null | 预校验结果。HTTP 401、严重参数错误等场景可能为 `null`。 |
| `error_code` | string | 可选。严重错误或批注门禁失败时可能出现。 |
| `annotation_check` | object | 可选。`block_code = ANNOTATION_CHECK_FAILED` 时返回批注门禁详情。 |

### 4.4 data 字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `passed` | boolean | 是否允许继续调用 `workflow/sync`。调用方必须以此字段作为放行依据。 |
| `action` | string | 本次校验的动作。 |
| `block_code` | string | 阻断诊断码，例如 `OWNER_MISMATCH`、`ANNOTATION_CHECK_FAILED`。 |
| `current_node` | string | 当前任务节点：`sj`、`jd`、`sh`、`pz`。 |
| `task_status` | string | 当前任务状态，例如 `draft`、`submitted`、`in_review`、`approved`、`cancelled`。 |
| `next_step` | string | 后端识别出的下一节点。 |
| `actor_id` | string | 当前请求人 HumanCode。 |
| `owner_id` | string | 当前节点负责人 HumanCode。 |
| `owner_source` | string | owner 来源字段：`requester`、`checker`、`reviewer`、`approver`。 |
| `expected_next_node` | string | 后端期望的下一节点。 |
| `requested_next_step` | object | 请求体中传入的下一步诊断快照。 |
| `reason` | string | 失败或通过原因。 |
| `recommended_action` | string | 调用方建议动作：`proceed`、`return`、`block`。 |

## 5. recommended_action 处理规则

| recommended_action | 含义 | PMS 应做什么 |
|---|---|---|
| `proceed` | 校验通过 | 继续调用 `workflow/sync`。 |
| `return` | 建议退回 | 不调用 `workflow/sync agree`；提示用户先退回或处理批注。 |
| `block` | 阻断 | 不调用 `workflow/sync`；展示原因并修复身份、节点、任务状态或参数。 |

## 6. 常见 block_code

| block_code | 含义 | 常见原因 | 处理建议 |
|---|---|---|---|
| `OWNER_MISMATCH` | 当前请求人不是当前节点负责人 | `actor.id` 与任务 owner 不一致 | 检查 `actor_id / owner_id / owner_source`，修正 PMS 登录人或任务 owner。 |
| `INVALID_OWNER_ID` | 任务 owner 不是合法 PMS HumanCode | 历史数据里仍有 `proofreader_001` 等旧账号 | 修复建单 payload 或清理脏数据。 |
| `INVALID_ACTOR_ID` | 当前请求人不是合法 PMS HumanCode | `actor.id` 带下划线或为空 | 改为 PMS HumanCode，如 `JH`。 |
| `ANNOTATION_CHECK_FAILED` | 批注门禁未通过 | 批注仍为 open、pending、rejected 等状态 | 查看 `annotation_check.blockers`，让用户处理或退回。 |
| `NEXT_STEP_INVALID` | 下一节点不符合当前动作 | `agree` 从 `jd` 传到 `pz`，或 `return` 目标不是上游 | 按 `expected_next_node` 修正 `next_step.roles`。 |
| `ACTOR_REQUIRED` | 无法解析调用人 | token claims 缺失且请求体未传 actor | 显式传 `actor`，或重新获取 token。 |

## 7. HTTP 状态码

| HTTP 状态 | 场景 | 调用方处理 |
|---|---|---|
| `200` + `data.passed = true` | 校验通过 | 可以继续 `workflow/sync`。 |
| `200` + `data.passed = false` | 业务阻断，例如 owner mismatch、终态、批注门禁失败 | 不要继续 sync，展示 `reason`。 |
| `400` | 参数错误，例如 action 不支持、缺少必需 next_step | 修正请求体后重试。 |
| `401` | token 无效或过期 | 重新走 `embed-url` 或重新签发 token。 |
| `404` | 单据或任务不存在 | 确认 `form_id` 是否正确、是否已创建内部 review task。 |
| `500` | 服务端错误 | 记录 `request_id/form_id/action`，交由后端排查。 |

## 8. 批注门禁说明

`workflow/verify` 会复用模型中心内部批注门禁逻辑。若未通过，响应顶层会包含 `annotation_check`：

```json
{
  "code": 200,
  "message": "存在未处理批注，不能继续流转",
  "data": {
    "passed": false,
    "action": "agree",
    "block_code": "ANNOTATION_CHECK_FAILED",
    "current_node": "jd",
    "task_status": "submitted",
    "reason": "存在未处理批注，不能继续流转",
    "recommended_action": "return"
  },
  "error_code": "ANNOTATION_CHECK_FAILED",
  "annotation_check": {
    "passed": false,
    "recommended_action": "return",
    "current_node": "jd",
    "summary": {
      "total": 3,
      "open": 0,
      "pending_review": 1,
      "approved": 2,
      "rejected": 0
    },
    "blockers": [
      {
        "annotation_id": "anno-001",
        "annotation_type": "text",
        "state_code": "pending_review",
        "state_label": "待确认",
        "refnos": ["24381/145018"]
      }
    ],
    "message": "存在待确认批注"
  }
}
```

调用方处理建议：

1. 展示 `data.reason` 作为主提示。
2. 如有 `annotation_check.blockers`，展示批注 ID、类型、状态、构件参考号。
3. 不要继续调用 `workflow/sync`。
4. 引导用户回三维校审页面处理批注，或按业务规则执行 `return`。

## 9. cURL 示例

### 9.1 SJ 发起送审 active

```bash
curl -X POST '{BASE_URL}/api/review/workflow/verify' \
  -H 'Content-Type: application/json' \
  -d '{
    "form_id": "FORM-20260508-0001",
    "token": "<user_token>",
    "action": "active",
    "actor": { "id": "SJ", "name": "SJ", "roles": "sj" },
    "next_step": { "assignee_id": "JH", "name": "JH", "roles": "jd" },
    "comments": "提交校对",
    "metadata": { "source": "pms" }
  }'
```

### 9.2 JH 校对同意 agree

```bash
curl -X POST '{BASE_URL}/api/review/workflow/verify' \
  -H 'Content-Type: application/json' \
  -d '{
    "form_id": "FORM-20260508-0001",
    "token": "<user_token>",
    "action": "agree",
    "actor": { "id": "JH", "name": "JH", "roles": "jd" },
    "next_step": { "assignee_id": "SH", "name": "SH", "roles": "sh" },
    "comments": "校对同意",
    "metadata": { "source": "pms" }
  }'
```

### 9.3 JH 驳回 return

```bash
curl -X POST '{BASE_URL}/api/review/workflow/verify' \
  -H 'Content-Type: application/json' \
  -d '{
    "form_id": "FORM-20260508-0001",
    "token": "<user_token>",
    "action": "return",
    "actor": { "id": "JH", "name": "JH", "roles": "jd" },
    "next_step": { "assignee_id": "SJ", "name": "SJ", "roles": "sj" },
    "target_node": "sj",
    "comments": "请修改后重新提交",
    "metadata": { "source": "pms" }
  }'
```

### 9.4 PZ 最终批准 agree

```bash
curl -X POST '{BASE_URL}/api/review/workflow/verify' \
  -H 'Content-Type: application/json' \
  -d '{
    "form_id": "FORM-20260508-0001",
    "token": "<user_token>",
    "action": "agree",
    "actor": { "id": "PZ", "name": "PZ", "roles": "pz" },
    "comments": "批准通过",
    "metadata": { "source": "pms" }
  }'
```

## 10. PMS 接入伪代码

```typescript
async function submitWorkflowAction(payload) {
  const verifyResponse = await postJson('/api/review/workflow/verify', payload);
  const result = verifyResponse.data;

  if (!result || result.passed !== true) {
    showError(result?.reason || verifyResponse.message || '流转校验未通过');
    logVerifyBlock({
      formId: payload.form_id,
      action: payload.action,
      blockCode: result?.block_code,
      actorId: result?.actor_id,
      ownerId: result?.owner_id,
      ownerSource: result?.owner_source,
      annotationCheck: verifyResponse.annotation_check,
    });
    return;
  }

  await postJson('/api/review/workflow/sync', payload);
  showSuccess('流程已提交');
}
```

## 11. 接入验收清单

外部 PMS 接入完成前，建议按以下清单验收：

- 新建任务时 `requester_id / checker_id / reviewer_id / approver_id` 均为 PMS HumanCode。
- `active` 请求从 `SJ/sj` 发起，`next_step.roles = jd`，`assignee_id = JH`。
- `JH/jd agree` 请求的 `next_step.roles = sh`，`assignee_id = SH`。
- `SH/sh agree` 请求的 `next_step.roles = pz`，`assignee_id = PZ`。
- `PZ/pz agree` 不传 `next_step` 也能通过并进入最终批准。
- `verify` 返回 `passed=false` 时，PMS 不再继续调用 `workflow/sync`。
- 响应中出现 `OWNER_MISMATCH` 时，PMS 能展示当前请求人与任务 owner 的差异。
- 响应中出现 `ANNOTATION_CHECK_FAILED` 时，PMS 能展示批注 blockers 并引导用户处理。
- 全链路日志记录 `form_id / action / actor.id / actor.roles / request_id`。

## 12. 最小测试用例

| 用例 | 输入 | 预期 |
|---|---|---|
| 正常 active | `SJ/sj`，`next_step = JH/jd` | `passed=true`，`recommended_action=proceed`。 |
| 正常 JH agree | 当前节点 `jd`，owner 为 `JH`，`next_step = SH/sh` | `passed=true`。 |
| owner 不匹配 | 当前节点 owner 为 `JH`，actor 为 `SH` | `passed=false`，`block_code=OWNER_MISMATCH`。 |
| 旧内部账号 | owner 或 actor 为 `proofreader_001` | `passed=false`，`block_code=INVALID_OWNER_ID` 或 `INVALID_ACTOR_ID`。 |
| next_step 错误 | `jd agree` 传 `next_step.roles = pz` | HTTP 400 或 `passed=false`，提示期望节点为 `sh`。 |
| 批注未处理 | 存在待确认或驳回批注时 agree | `passed=false`，`block_code=ANNOTATION_CHECK_FAILED`。 |
| token 过期 | 使用过期或错误 token | HTTP 401。 |

## 13. 版本说明

本说明基于 2026-05-08 当前实现整理：

- `workflow/verify` 路由：`POST /api/review/workflow/verify`。
- 请求体复用 `SyncWorkflowRequest`。
- 响应体为 `VerifyWorkflowResponse`。
- `actor` 可由 token claims 补齐，但外部 PMS 推荐显式传入。
- 身份只使用 PMS HumanCode；旧内部默认账号不再兼容。
- 业务阻断可能返回 HTTP 200 + `data.passed=false`，调用方必须读取 `passed`。
