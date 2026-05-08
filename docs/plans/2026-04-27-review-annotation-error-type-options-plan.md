# 三维校审批注错误类型三选项改造计划

日期：2026-04-27  
范围：`plant3d-web` 三维校审批注处理区、批注表格、批注错误标记保存接口，以及 `plant-model-gen` 对应后端契约。  
目标选项：`原则错误`、`一般错误`、`图面错误`。

## 1. 背景与现状

当前批注处理里的“错误标记/优先级设置”实际复用了 `AnnotationSeverity`：

- 前端类型：`AnnotationSeverity = 'suggestion' | 'normal' | 'severe' | 'critical'`。
- 前端展示：`critical/severe/normal/suggestion` 被显示为 `A · 紧急`、`B · 高`、`C · 中`、`建议`，部分区域又映射为 `紧急/高/中/低`。
- 后端接口：`PATCH /api/review/annotations/{annotationId}/severity?type=...` 只接受 `suggestion|normal|severe|critical|null`，并写入 `review_annotation_severity`。

这与当前产品语义不一致。用户需要的是“批注错误类型判断”，不是严重度或优先级；可选项应收敛为：

- `principle_error`：原则错误
- `general_error`：一般错误
- `drawing_error`：图面错误

## 2. 改造原则

1. 语义优先：新增/重命名为“错误类型”，避免继续用 severity/priority 误导后续开发。
2. 选项唯一来源：三项枚举只定义一次，UI、排序、筛选、API payload、测试共享同一组常量。
3. 契约明确：前端和后端都只接受三项合法值；非法值返回明确错误或本地归一化为未设置。
4. 兼容可控：如果当前分支尚未发布，可直接替换旧 severity 语义；若已有线上数据，则提供旧值到新值的迁移/展示兜底。
5. UI 文案一致：把“严重度/优先级/错误标记”统一为“错误类型”，除非业务明确需要保留“错误标记”作为表头。

## 3. 影响面

### 3.1 前端类型与工具函数

文件：

- `src/types/auth.ts`
- `src/types/auth.severity.test.ts`
- `src/composables/useAnnotationSeveritySync.ts`

计划：

- 新增 `AnnotationErrorType`、`ANNOTATION_ERROR_TYPE_VALUES`、`isAnnotationErrorType()`、`normalizeAnnotationErrorType()`、`getAnnotationErrorTypeDisplay()`。
- 将当前 `getAnnotationSeverityDisplay()` 相关显示改为错误类型显示。
- 将保存 composable 从 `useAnnotationSeveritySync.ts` 迁移或重命名为 `useAnnotationErrorTypeSync.ts`。
- 若暂不大规模重命名，可先保留旧文件名作为过渡，但导出的业务 API 应使用 error type 命名。

### 3.2 Store 与批注记录模型

文件：

- `src/composables/useToolStore.ts`
- `src/components/review/annotationWorkspaceModel.ts`

计划：

- 批注记录字段从 `severity?: AnnotationSeverity` 改为 `errorType?: AnnotationErrorType`。
- `updateAnnotationSeverity()` 改为 `updateAnnotationErrorType()`。
- 工作台 item 字段从 `severity/priorityLabel/priorityTone` 收敛为 `errorType/errorTypeLabel/errorTypeTone`。
- 排序逻辑不再按严重度排序，改为按错误类型固定顺序或仅作为筛选维度。

建议顺序：

1. `principle_error`
2. `general_error`
3. `drawing_error`
4. 未设置

### 3.3 批注处理 UI

文件：

- `src/components/review/AnnotationWorkspace.vue`
- `src/components/review/ReviewPanel.vue`
- `src/components/review/DesignerCommentHandlingPanel.vue`

计划：

- 将“优先级设置”区域改为“错误类型”。
- 描述文案改为“请选择当前批注对应的错误类型”。
- 按钮只展示三项：`原则错误`、`一般错误`、`图面错误`。
- 删除或替换 `低/中/高/紧急` 相关文案。
- 事件从 `update-severity` 改为 `update-error-type`。

### 3.4 批注表格与导出

文件：

- `src/components/review/AnnotationTableView.vue`
- `src/components/review/annotationTableSorting.ts`
- `src/components/review/annotationTableExport.ts`
- `src/components/review/annotationTableClipboard.test.ts`
- `src/components/review/annotationTableExport.test.ts`
- `src/components/review/AnnotationTableView.test.ts`

计划：

- 表头从“错误标记”或“严重度”统一为“错误类型”。
- 筛选下拉改为：
  - 全部错误类型
  - 原则错误
  - 一般错误
  - 图面错误
- 表格 pill 显示三类错误，不再显示 `A/B/C` 和优先级标签。
- CSV/复制导出字段同步改为“错误类型”。

### 3.5 API 契约

前端文件：

- `src/api/reviewApi.ts`

后端文件：

- `/Volumes/DPC/work/plant-code/plant-model-gen/src/web_api/review_api.rs`

推荐契约：

- 新增或替换接口：`PATCH /api/review/annotations/{annotationId}/error-type?type={annotationType}`
- Body：`{ "error_type": "principle_error" | "general_error" | "drawing_error" | null }`
- Response：`{ success, error_type, updated_at, error_message? }`

后端持久化建议：

- 新表/新 record：`review_annotation_error_type`。
- 字段：`annotation_id`、`annotation_type`、`error_type`、`updated_at`。
- 若当前分支未上线，可直接把旧 `review_annotation_severity` 替换为新语义，避免双写和兼容层。
- 若已有线上数据，保留旧字段读取兜底，并制定一次性迁移：
  - `critical`/`severe` 需要产品确认映射，不建议默认映射为原则错误。
  - `normal` 可临时映射为一般错误。
  - `suggestion` 没有等价项，建议迁移为未设置或由人工复核。

## 4. 开发阶段

### Phase A：确认枚举和契约命名

产出：

- 确认内部枚举值：`principle_error | general_error | drawing_error`。
- 确认后端字段名使用 `error_type`。
- 确认是否需要兼容旧 `severity` 数据。

完成标准：

- 前后端字段、接口、显示文案三者一致。
- 旧值处理策略明确，不在实现中隐式猜测。

### Phase B：前端类型与本地状态改造

产出：

- 新增错误类型 helper。
- Store、workspace model、表格 pipeline 改用 `errorType`。
- 删除 UI 里的优先级/严重度映射。

完成标准：

- 批注详情中只出现三项错误类型。
- 批注列表、筛选、排序、导出均使用错误类型。

### Phase C：后端接口与持久化改造

产出：

- 后端只接受三项错误类型。
- 前端 `reviewApi` 调用新接口或新 payload。
- 保存失败时仍保持前端乐观更新回滚能力。

完成标准：

- 非法值返回 400，并提示合法选项。
- 合法值可保存、清空、再次读取恢复。

### Phase D：批注流程联调

覆盖场景：

- 新建批注后未设置错误类型。
- 设置为原则错误、一般错误、图面错误分别保存。
- 切换错误类型后表格和详情同步更新。
- 重新打开任务后错误类型仍可恢复。
- 错误类型不影响“已修改/不需解决/同意/驳回”的批注处理状态流转。

### Phase E：文档与验收归档

产出：

- 更新相关验证文档，记录三项错误类型的 UI 截图或 simulator 输出。
- 如果 simulator 仍有环境阻塞，至少完成前后端 HTTP JSON 契约验证记录。

## 5. 建议验证

前端：

```bash
npm run type-check
```

建议补充的定向回归：

```bash
npm test -- src/types/auth.severity.test.ts src/composables/useToolStore.severity.test.ts src/components/review/annotationWorkspaceModel.test.ts src/components/review/AnnotationTableView.test.ts
```

后端：

- 按项目规则启动 `web_server`，使用 HTTP JSON `POST/PATCH/GET` 验证新接口。
- 不为 `web_server` 运行 Rust test。

E2E：

```bash
PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator
```

若 simulator 卡住，先保留本次错误类型改造的 API smoke 证据，再继续按 E2E 稳定化计划定位。

## 6. 风险与待确认

1. 旧 severity 数据是否已经进入真实环境：如果已经进入，需要迁移策略；如果没有，建议直接替换，避免长期兼容负担。
2. “原则错误 / 一般错误 / 图面错误”是否是互斥单选：当前按单选计划；若未来允许多选，需要改为数组字段。
3. 错误类型是否参与门禁：当前计划不参与 `reviewAnnotationCheck` 门禁，仅作为批注分类属性。
4. 表格排序是否仍需要保留：错误类型不是严重度，建议只筛选不强调排序；如保留排序，应使用固定业务顺序。
