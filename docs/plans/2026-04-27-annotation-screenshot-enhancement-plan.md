# 三维校审批注截图增强开发计划

> 日期：2026-04-27
> 状态：核心开发完成
> 目标：让批注截图在创建、审查、设计处理、附件生命周期中使用同一套数据模型和展示入口。
> 当前进度：Phase 1 - Phase 6 已完成；localStorage base64 离线兜底明确暂缓。

## 1. 当前结论

当前实现已经具备截图上传、附件删除 API、批注 `screenshot` 类型和 `setAnnotationScreenshot()` 等基础能力，但路径还没有闭合：

1. `AnnotationPanel.vue` 截图成功后只写 cloud 顶层 `thumbnailUrl` / `attachmentId`，没有写 `record.screenshot`。
2. `normalizeCloudAnnotationRecord()` 只归一化 `rec.screenshot`，不会把历史 `thumbnailUrl` 自动迁移为 `screenshot`。
3. `AnnotationWorkspaceItem` 没有截图字段，导致审查工作区、表格、设计师处理面板无法复用同一数据。
4. `useScreenshot.ts` 已有 `sourceAnnotationId` 入参，但上传时没有作为 FormData 元数据传给服务端。
5. `ReviewAttachmentUploadOptions` 已有 `description`，但缺少 `sourceAnnotationId`；带进度上传和普通上传都需要保持一致。
6. 错误类型已经变为 `principle | general | drawing`，但部分 UI 仍使用旧的 `critical | severe | normal | suggestion` 文案和筛选。

## 2. 设计决策

### 2.1 Canonical 字段

后续以 `record.screenshot: AnnotationScreenshot` 作为唯一主路径：

```ts
type AnnotationScreenshot = {
  url: string;
  attachmentId?: string;
  name?: string;
  capturedAt?: number;
};
```

`CloudAnnotationRecord.thumbnailUrl` 和 `CloudAnnotationRecord.attachmentId` 仅作为历史兼容字段保留。写入时短期镜像，读取时优先 `screenshot`，再 fallback 到旧字段。

### 2.2 截图时间

优先使用服务端附件返回的 `uploadedAt` 作为 `capturedAt`。如果返回缺失，则使用截图开始时的 `Date.now()`。

### 2.3 附件清理

不把异步删除直接塞进 `useToolStore` 的同步删除函数。新增 UI/service 层删除编排：

1. 删除前读取 `getAnnotationScreenshot(type, id)?.attachmentId`。
2. 先删除本地批注，保证用户操作响应。
3. 后台调用 `reviewAttachmentDelete(attachmentId)`。
4. 失败时 toast 提示，保留后端孤儿附件由后续清理任务处理。

重拍截图时也应清理旧附件，避免只删除批注时才清理。

## 3. 开发阶段

### Phase 1：统一截图数据模型（P0，约 2h，已完成）

目标：任何批注类型都能通过 `getAnnotationScreenshot(type, id)` 读到截图。

改动：

| 文件 | 任务 |
|---|---|
| `src/types/auth.ts` | 增加/确认 `normalizeAnnotationScreenshot()` 对 `{ url }`、`{ thumbnailUrl }` 的兼容能力 |
| `src/composables/useToolStore.ts` | 新增内部 helper，从任意批注 record 解析 canonical screenshot；cloud legacy 字段 fallback 到 `thumbnailUrl` / `attachmentId` |
| `src/composables/useToolStore.ts` | 调整 `normalizeCloudAnnotationRecord()`，把旧 `thumbnailUrl` 归一化进 `screenshot` |
| `src/composables/useToolStore.ts` | 调整 `setAnnotationScreenshot()`，写入 `screenshot`；对 cloud 同步镜像 `thumbnailUrl` / `attachmentId` |
| `src/composables/useToolStore.ts` | 调整 `clearAnnotationScreenshot()`，清空 `screenshot`；对 cloud 同步清空 legacy 字段 |
| `src/components/tools/AnnotationPanel.vue` | 截图成功后改为调用 `setAnnotationScreenshot('cloud', annotationId, screenshot)` |

验收：

- 新截图后，cloud record 同时有 `screenshot.url` 和兼容字段 `thumbnailUrl`。
- 旧数据只有 `thumbnailUrl` 时，`getAnnotationScreenshot('cloud', id)` 仍能读到 URL。
- text / rect / obb 也能通过同一 getter 写入和读取截图。

### Phase 2：上传元数据与截图返回结构（P0，约 1.5h，已完成）

目标：截图附件在服务端可按来源批注追踪。

改动：

| 文件 | 任务 |
|---|---|
| `src/api/reviewApi.ts` | `ReviewAttachmentUploadOptions` 增加 `sourceAnnotationId?: string` |
| `src/api/reviewApi.ts` | `reviewAttachmentUpload()` 和 `reviewAttachmentUploadWithProgress()` 都向 FormData 写入 `sourceAnnotationId` |
| `src/composables/useScreenshot.ts` | 调用上传 API 时传入 `{ sourceAnnotationId, description, fileType: 'annotation_screenshot' }` |
| `src/composables/useScreenshot.ts` | 生成并返回可构造 `AnnotationScreenshot` 的时间信息，优先使用 `attachment.uploadedAt` |
| `src/components/tools/AnnotationPanel.vue` | description 使用错误类型 + 批注标题，例如 `原则错误 - 管线间距不足` |

验收：

- 上传请求 FormData 包含 `taskId`、`sourceAnnotationId`、`description`、`type`。
- 截图写入后 `screenshot.capturedAt` 有稳定值。
- 不破坏 `captureAndUpload(taskId, 'name.png')` 旧调用方式。

### Phase 3：扩展审查工作区截图展示（P1，约 3h，已完成）

目标：审查和处理链路都能看到批注截图。

改动：

| 文件 | 任务 |
|---|---|
| `src/components/review/annotationWorkspaceModel.ts` | `AnnotationWorkspaceItem` 增加 `screenshot?: AnnotationScreenshot` 和 `thumbnailUrl?: string` 派生字段 |
| `src/components/review/AnnotationWorkspace.vue` | 列表卡片和详情卡片展示缩略图；点击打开大图预览 |
| `src/components/review/AnnotationTableView.vue` | 增加“截图”列或紧凑缩略区域；点击打开大图 |
| `src/components/review/DesignerCommentHandlingPanel.vue` | 设计师批注卡片展示同一缩略图 |
| `src/components/review/ReviewCommentsTimeline.vue` | 接收 screenshot prop 或内部按 type/id 读取；在时间线顶部展示截图入口 |

验收：

- 同一批注在工作区列表、详情、表格、设计师处理面板展示同一张图。
- 无截图时 UI 不占用明显空间。
- 缩略图点击可预览大图，且不会触发行选择/定位的误点击。

### Phase 4：错误类型视觉统一（P1，约 2h，已完成）

目标：截图与新的错误类型（原则错误 × / 一般错误 △ / 图面错误 ○）在同一卡片中表达。

改动：

| 文件 | 任务 |
|---|---|
| `src/components/review/annotationWorkspaceModel.ts` | 替换旧 `critical/severe/normal/suggestion` 优先级映射 |
| `src/components/review/AnnotationTableView.vue` | 替换旧 severity 筛选项和标签文案 |
| `src/types/auth.ts` | 复用或补齐错误类型 label / symbol / tone helper |
| 截图展示组件 | 缩略图角标显示 `×` / `△` / `○`，边框颜色与错误类型一致 |

验收：

- 所有审查 UI 不再出现旧的 A/B/C、紧急/高/中/建议文案。
- 未设置错误类型时显示“未标记”，不影响截图展示。
- CSV 导出如包含错误类型，应使用新文案。

### Phase 5：附件生命周期管理（P2，约 2h，已完成）

目标：减少服务端孤儿截图附件。

改动：

| 文件 | 任务 |
|---|---|
| `src/api/reviewApi.ts` | 复用现有 `reviewAttachmentDelete(attachmentId)` |
| `src/components/tools/AnnotationPanel.vue` 或删除入口组件 | 删除批注时调用统一删除编排 |
| `src/composables/useToolStore.ts` | 保持删除函数同步，必要时新增只读 helper 获取删除前截图 |
| 截图重拍入口 | 重拍成功后清理旧 attachment；失败不清旧图 |

验收：

- 删除带截图批注时，发起附件 DELETE 请求。
- 重拍成功后，旧附件被清理，新截图保留。
- DELETE 失败不会阻断本地批注删除，但会提示用户。

### Phase 6：上传体验优化（P3，约 1.5h，已完成）

目标：补齐用户反馈，不扩大核心风险。

改动：

| 文件 | 任务 |
|---|---|
| `src/composables/useScreenshot.ts` | 保留全局 `uploadProgress`，必要时暴露当前 `sourceAnnotationId` |
| `src/components/tools/AnnotationPanel.vue` | 当前截图中的批注显示进度态和禁用重入 |
| 截图重拍入口 | 已有截图时弹确认 |

暂缓：

- localStorage base64 离线兜底暂不进入本轮开发。该方案有体积、隐私和同步冲突风险，后续单独设计。

## 4. 验证计划

### 静态检查

- `npm run type-check`
- `npm run lint`

### 重点手工验证

1. 在云线批注上点击添加截图，确认 UI 出现缩略图。
2. 刷新页面或重新进入任务，确认截图仍可通过 `screenshot` 读取。
3. 打开批注工作区、批注表格、设计师处理面板，确认同一张截图一致展示。
4. 重拍截图，确认新图替换旧图，旧附件触发删除。
5. 删除批注，确认附件 DELETE 请求发出。
6. 对无截图批注、无错误类型批注、旧 `thumbnailUrl` 数据分别验证兼容展示。

### 建议补充的最小自动化

| 文件 | 覆盖点 |
|---|---|
| `src/composables/useToolStore` 相关测试 | legacy `thumbnailUrl` 归一化、setter 镜像、clear 同步 |
| `src/composables/useScreenshot.test.ts` | upload options 透传 `sourceAnnotationId` / `description` |
| `src/components/review/annotationWorkspaceModel.test.ts` | workspace item 派生 `screenshot` / `thumbnailUrl` |
| `src/components/review/AnnotationTableView.test.ts` | 有截图时显示缩略图入口 |

## 5. 风险与边界

1. 后端若暂不识别 `sourceAnnotationId`，前端仍可追加 FormData 字段，但需要确认不会被服务端拒绝。
2. 历史 cloud 数据存在顶层 `thumbnailUrl`，必须兼容读取；不建议做一次性破坏性迁移。
3. `useToolStore` 删除函数被多处同步调用，附件删除应放在调用层编排。
4. 错误类型旧枚举残留会影响筛选、排序和展示，需要与截图 UI 同步收敛。
5. localStorage 离线截图不是本轮必须项，避免把 P0 数据统一任务扩大成缓存系统。

## 6. 推荐执行顺序

1. Phase 1 + Phase 2 合并为第一批开发，先打通数据写入和元数据上传。
2. Phase 3 单独开发展示面，避免 UI 改动和数据改动混在一起。
3. Phase 4 紧跟 Phase 3，统一错误类型视觉和表格筛选。
4. Phase 5 最后处理删除/重拍清理，降低对现有删除调用方的影响。
5. Phase 6 视时间补充，只做进度态和重拍确认，不做离线缓存。

## 7. 开发记录

### 2026-04-27 Phase 1 + Phase 2

已完成：

- `useToolStore` 支持从 cloud legacy `thumbnailUrl` / `attachmentId` 归一化出 canonical `screenshot`。
- `setAnnotationScreenshot('cloud', ...)` 写入 `screenshot` 时同步镜像 `thumbnailUrl` / `attachmentId`。
- `clearAnnotationScreenshot('cloud', ...)` 同步清空 canonical 与 legacy 字段。
- `CaptureOptions` 支持 `description` / `fileType`，`captureAndUpload()` 上传时透传 `sourceAnnotationId` / `description` / `type`。
- `captureAndUpload()` 返回值补充 `capturedAt`，优先使用附件 `uploadedAt`。
- `AnnotationPanel.vue` 云线批注截图入口改为调用 `setAnnotationScreenshot()`，并上传错误类型 + 批注标题描述。

验证：

- `npm test -- src/composables/useToolStore.screenshot.test.ts src/composables/useScreenshot.test.ts`
- `npm run type-check`
- `ReadLints` 检查相关修改文件无诊断错误。

### 2026-04-27 Phase 3 - Phase 5

已完成：

- `AnnotationWorkspaceItem` 增加 `screenshot` / `thumbnailUrl` 派生字段，兼容 cloud legacy 截图。
- `AnnotationWorkspace.vue` 在列表、详情和时间线入口展示批注截图，并支持大图预览。
- `AnnotationTableView.vue` 在宽屏表格行与紧凑卡片中展示缩略图，并支持大图预览。
- `ReviewCommentsTimeline.vue` 接收并展示当前批注截图入口。
- 表格筛选、排序、CSV 导出、工作区错误类型选项统一到 `principle` / `general` / `drawing`。
- 删除 text/cloud/rect 批注时异步清理截图附件；cloud 重拍成功后异步清理旧附件。

验证：

- `npm test -- src/components/review/annotationTableSorting.test.ts src/components/review/AnnotationTableView.test.ts src/components/review/annotationWorkspaceModel.test.ts src/composables/useToolStore.screenshot.test.ts src/composables/useScreenshot.test.ts`
- `npm run type-check`
- `ReadLints` 检查相关修改文件无诊断错误。

### 2026-04-27 Phase 6

已完成：

- `AnnotationPanel.vue` 解构并使用 `uploadProgress`，在截图上传中显示进度条。
- 已有截图的 cloud 批注重拍前弹出确认，避免误覆盖。
- localStorage base64 离线兜底继续暂缓，不纳入本轮实现。

验证：

- `npm test -- src/components/review/annotationTableSorting.test.ts src/components/review/AnnotationTableView.test.ts src/components/review/annotationWorkspaceModel.test.ts src/composables/useToolStore.screenshot.test.ts src/composables/useScreenshot.test.ts`
- `npm run type-check`
- `ReadLints` 检查 `AnnotationPanel.vue` 无诊断错误。
