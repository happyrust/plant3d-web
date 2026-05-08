# 批注处理状态 API 协议确认记录

日期：2026-04-27  
来源：静态核对后端实现 `plant-model-gen/src/web_api/review_annotation_state.rs` 与 `plant-model-gen/src/web_api/platform_api/annotation_check.rs`。  
注意：本文不包含真实 token、真实用户数据或生产响应。

## 1. 后端接口

### 1.1 提交批注处理状态

接口：

```http
POST /api/review/annotation-states/apply
```

请求体使用 camelCase。后端结构体使用 `#[serde(rename_all = "camelCase")]`：

```json
{
  "formId": "FORM-1001",
  "taskId": "task-designer-1",
  "annotationId": "annot-open",
  "annotationType": "text",
  "action": "fixed",
  "note": "已完成修改"
}
```

后端允许的 `action`：

- `fixed`
- `wont_fix`
- `agree`
- `reject`

后端 `review_annotation_state.rs` 中 `is_valid_annotation_type()` 允许：

- `text`
- `cloud`
- `rect`
- `obb`

### 1.2 查询批注处理状态

接口：

```http
GET /api/review/annotation-states?form_id=FORM-1001&task_id=task-designer-1
```

查询参数支持：

- `form_id` / `formId`
- `task_id` / `taskId`

## 2. 响应结构

`apply` 成功响应：

```json
{
  "success": true,
  "state": {
    "formId": "FORM-1001",
    "taskId": "task-designer-1",
    "annotationId": "annot-open",
    "annotationType": "text",
    "workflowNode": "sj",
    "reviewRound": 2,
    "resolutionStatus": "fixed",
    "decisionStatus": "pending",
    "note": "已完成修改",
    "updatedById": "SJ",
    "updatedByName": "设计甲",
    "updatedByRole": "sj",
    "updatedAt": 1710000000999,
    "history": [
      {
        "action": "fixed",
        "resolutionStatus": "fixed",
        "decisionStatus": "pending",
        "note": "已完成修改",
        "operatorId": "SJ",
        "operatorName": "设计甲",
        "operatorRole": "sj",
        "workflowNode": "sj",
        "timestamp": 1710000000123
      }
    ]
  }
}
```

`query` 成功响应：

```json
{
  "success": true,
  "states": [
    {
      "formId": "FORM-1001",
      "taskId": "task-designer-1",
      "annotationId": "annot-open",
      "annotationType": "text",
      "workflowNode": "sj",
      "reviewRound": 2,
      "resolutionStatus": "fixed",
      "decisionStatus": "pending",
      "note": "已完成修改",
      "updatedById": "SJ",
      "updatedByName": "设计甲",
      "updatedByRole": "sj",
      "updatedAt": 1710000000999,
      "history": [
        {
          "action": "fixed",
          "resolutionStatus": "fixed",
          "decisionStatus": "pending",
          "note": "已完成修改",
          "operatorId": "SJ",
          "operatorName": "设计甲",
          "operatorRole": "sj",
          "workflowNode": "sj",
          "timestamp": 1710000000123
        }
      ]
    }
  ]
}
```

## 3. 前端 adapter 结论

前端 `normalizeAnnotationReviewStateView()` 需要兼容：

- 顶层字段为 camelCase；
- `updatedByRole` 可能是后端工作流角色码，如 `sj/jd/sh/pz`；
- `history[]` 事件没有 `createdAt`，实际使用 `timestamp`；
- `history[]` 事件没有稳定 `id`，前端应生成展示用 fallback id；
- 非法 `history.action` 应过滤，但不影响当前顶层状态展示。

已补充测试：

- `src/api/reviewApi.test.ts`
  - `normalizes backend annotation-state history entries that use timestamp`
  - `filters invalid backend history actions without dropping the current state`

## 4. OBB 门禁现状

当前源码确认：

- `review_annotation_state.rs` 的状态 API 允许 `obb`。
- `annotation_check.rs` 的门禁检查仅支持：

```rust
const SUPPORTED_ANNOTATION_TYPES: [&str; 3] = ["text", "cloud", "rect"];
```

并且 `load_effective_annotations()` 只从 `review_records` 中读取：

- `annotations`
- `cloud_annotations`
- `rect_annotations`

当前结论：

- OBB 可以作为状态表类型存在，但当前不会进入 `reviewAnnotationCheck()` 门禁。
- 前端暂不应把 `obb` 加入 `includedTypes`，否则后端会返回“不支持类型”。
- 是否让 OBB 参与正式门禁，需要后端先扩展 `annotation_check.rs` 的类型集合和 record 读取字段。
- 当前前端 UI 将 OBB 显示为 `包围盒（辅助证据）`，避免用户误以为它会阻塞任务流转。

## 5. 后续建议

1. 若 OBB 需要参与正式校审，先后端扩展 `SUPPORTED_ANNOTATION_TYPES` 与 `load_effective_annotations()`，再改前端 `includedTypes`。
2. 若 OBB 只作为辅助证据，前端文档和 UI 应明确它不阻塞任务流转。
3. 真实环境联调时，再用 dev token 抓一次实际响应，对照本文样例确认无字段漂移。
