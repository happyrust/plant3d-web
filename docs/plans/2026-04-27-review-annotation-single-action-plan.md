# 三维校审批注“单次主操作”改造开发计划

日期：2026-04-27  
范围：`plant3d-web` 三维校审工作台、设计侧批注处理页、批注时间线与任务流转门禁  
配套图示：[`../verification/review-annotation-two-actions-explained.png`](../verification/review-annotation-two-actions-explained.png)

## 1. 背景与问题

当前批注处理在用户感知上像“两次操作”：

1. 在单条批注时间线里点击 `已修改 / 不需解决 / 同意 / 驳回`。
2. 页面仍要求点击 `确认当前数据`，之后才允许 `再次提交 / 流转到下一节点`。

代码层面的根因是三条持久化链路被直接暴露给用户：

- **批注状态表**：`annotationReviewStateApply()` 写 `/api/review/annotation-states/apply`。
- **确认记录**：`confirmCurrentDataSafely()` 写 `reviewRecordCreate`，保存批注/测量快照。
- **任务流转**：`submitTaskToNextNodeSafely()` / `submitTaskToNextNode()` 推进工作流。

领域模型拆分本身合理，但现在 `ReviewCommentsTimeline.vue` 在后端状态写入成功后，仍调用 `useToolStore.applyAnnotationReviewAction()` 合成本地 `reviewState`。这会进入确认记录 diff，使 `hasUnsavedPendingData` 为 true，最终被 `runReviewSubmitPreflight()` 拦截，用户必须再点一次确认。

## 2. 目标

### 2.1 用户目标

- 单条批注只暴露一个清晰主操作：提交处理结果、同意处理结果或驳回重处理。
- 批注状态成功保存后，用户不需要再为同一个状态动作点击 `确认当前数据`。
- 只有新增/修改了几何批注、测量、截图等证据时，才出现保存证据类动作。
- 任务级提交只表达“流转到下一节点”，不再承担批注状态保存语义。

### 2.2 技术目标

- 以后端 `AnnotationReviewStateView` 作为批注处理状态真源。
- 消除“后端已保存但前端仍合成本地状态”的真源分裂。
- 将“批注状态变更”和“证据快照保存”从提交门禁中区分出来。
- 保留现有后端状态表、确认记录和工作流 API，不做一次性大改后端协议。

### 2.3 非目标

- 不重写三维批注、测量工具本身。
- 不删除确认记录能力；确认记录仍用于保存几何/测量/截图等证据快照。
- 不改变 PMS/外部平台作为主流程驱动方的定位。

## 3. 目标交互

### 3.1 设计侧

在批注详情中显示一个处理表单：

- 处理结果：`已修改` / `不需解决`
- 处理说明：`不需解决` 必填，`已修改` 建议填写
- 主按钮：`提交处理结果`

提交成功后：

- 批注状态立即变为 `已修改待确认` 或 `不需解决待确认`。
- 时间线出现后端返回的处理记录。
- 如果没有新增证据，不显示 `确认当前数据` 阻塞。
- 如果有新增测量/几何/截图，则显示 `保存新增证据`。

### 3.2 校对 / 审核 / 批准侧

在设计侧已经处理后显示一个确认表单：

- 处理决定：`同意` / `驳回`
- 决定说明：`驳回` 必填，`同意` 可选
- 主按钮：`提交确认结果`

提交成功后：

- 批注状态立即变为 `已同意` / `已同意不处理` / `已驳回`。
- 任务流转按钮只检查后端批注状态是否满足门禁。

### 3.3 表格操作

`AnnotationTableView` 操作列保持两个按钮，但语义明确：

- 定位：只定位到三维模型。
- 详情：直接打开批注处理详情，不再只是选中行。

单击行仍用于选择；双击行仍可打开详情。

## 4. 方案设计

### 4.1 后端状态返回值作为真源

新增转换函数，例如：

```ts
function normalizeAnnotationReviewStateView(view: AnnotationReviewStateView): AnnotationReviewState
```

用途：

- 将 `resolutionStatus`、`decisionStatus`、`note`、`updatedBy*`、`updatedAt`、`history` 规范化为前端 `AnnotationReviewState`。
- `ReviewCommentsTimeline.vue` 调用 `annotationReviewStateApply()` 成功后，优先使用返回的 `resp.state` 更新 store。
- 若响应没有 `state`，则调用 `annotationReviewStatesQuery()` 或降级为刷新当前任务上下文。
- 仅在没有 `formId/taskId` 的离线/本地演示模式下，继续允许 `applyAnnotationReviewAction()` 本地合成。

影响文件：

- `src/api/reviewApi.ts`
- `src/types/auth.ts`
- `src/components/review/ReviewCommentsTimeline.vue`
- `src/composables/useToolStore.ts`

### 4.2 区分“状态保存”和“证据保存”

新增或调整 snapshot diff 语义：

- 当前 `buildReviewConfirmSnapshotKey()` 会把 annotation 对象里的 `reviewState` 纳入差异。
- 改造后，提交门禁使用“证据 diff”，不应因已后端持久化的 `reviewState` 阻塞。
- 可新增函数：
  - `buildReviewEvidenceSnapshotPayload()`
  - `buildUnsavedReviewEvidencePayload()`
  - `hasUnsavedEvidenceData()`

证据 diff 包含：

- 新增/修改的几何批注内容；
- 测量记录；
- 截图/附件证据；
- 不包含已经写入状态表的 `reviewState`。

影响文件：

- `src/components/review/reviewPanelActions.ts`
- `src/components/review/ReviewPanel.vue`
- `src/components/review/DesignerCommentHandlingPanel.vue`
- `src/components/review/ReviewerTaskList.vue`

### 4.3 调整任务提交门禁

`runReviewSubmitPreflight()` 的语义保持，但输入应从：

```ts
hasUnsavedBlockingData: hasUnsavedPendingData.value
```

改为：

```ts
hasUnsavedBlockingData: hasUnsavedEvidenceData.value
```

同时 `reviewAnnotationCheck()` 继续以 `formId/taskId/currentNode` 查询后端状态表，判断是否还有：

- open；
- fixed/wont_fix 但 pending；
- rejected 后未重新处理；
- 其他后端认为不可放行的状态。

注意：当前 `includedTypes` 多处只有 `['text', 'cloud', 'rect']`，如果 `obb` 已进入正式校审批注，应补齐后端与前端门禁一致性。

### 4.4 UI 文案与布局

调整文案：

- `确认当前数据` → `保存新增证据`
- `处理动作与测量证据需要先确认保存` → `新增证据需要保存；批注处理结果会自动保存`
- `处理完成后再次提交` → `流转到下一节点` 或按节点显示 `提交校对 / 提交审核 / 提交批准`

调整 `ReviewCommentsTimeline.vue`：

- 将 action note 和 action buttons 组合成一个“处理结果表单”。
- 普通评论输入保留为“补充讨论”，视觉上放在次级位置。
- `wont_fix` 和 `reject` 保持备注必填。

## 5. 分阶段实施计划

### Phase 0：确认协议与基线

产出：

- 确认 `annotationReviewStateApply()` 返回的 `state.history` 结构是否可直接映射。
- 确认 `annotationReviewStatesQuery()` 是否能按 `formId + taskId` 返回当前任务全部状态。
- 确认 `reviewAnnotationCheck()` 是否已覆盖 `obb`。

检查点：

- 记录后端响应样例。
- 若后端 `state.history` 不是前端事件结构，先落转换规则。

### Phase 1：状态真源改造

实现：

- 新增 `normalizeAnnotationReviewStateView()`。
- `ReviewCommentsTimeline.vue` 在有 `formId/taskId` 时使用后端返回状态写 store。
- 保留本地合成分支，仅用于无任务上下文的离线模式。
- 补充状态更新测试：后端返回状态时不再本地随机生成 history。

验收：

- 点击 `已修改` 后，UI 展示后端返回的状态和更新时间。
- 后端返回失败时，不更新本地状态。
- 离线 demo 模式仍可本地演示。

### Phase 2：证据 diff 与提交门禁改造

实现：

- 新增 evidence-only diff helper。
- `DesignerCommentHandlingPanel.vue`、`ReviewPanel.vue`、`ReviewerTaskList.vue` 改用 evidence diff 作为 `hasUnsavedBlockingData`。
- 保留完整 snapshot 确认记录，但不再让纯 `reviewState` 变更触发“必须确认当前数据”。

验收：

- 只点击批注状态动作，不再出现必须保存证据的阻塞。
- 新增测量或几何批注后，仍会提示保存新增证据。
- 提交流转前仍会调用 `reviewAnnotationCheck()` 做后端状态门禁。

### Phase 3：交互收敛

实现：

- `ReviewCommentsTimeline.vue` 改为主处理表单 + 次级讨论输入。
- `AnnotationTableView.vue` 的 MessageSquare 操作列按钮改为直接 `open-annotation`。
- 统一设计侧和审核侧提示文案。

验收：

- 用户从批注表格点击详情图标可直接进入处理详情。
- 设计侧主按钮语义明确，不再和普通回复混淆。
- 审核侧同意/驳回只在设计已处理后可用。

### Phase 4：回归验证

建议执行：

```bash
npm run type-check
npm run lint
npm test -- src/components/review/ReviewCommentsTimeline.test.ts src/components/review/DesignerCommentHandlingPanel.test.ts src/components/review/ReviewPanel.test.ts src/components/review/reviewPanelActions.test.ts src/review/services/commentThreadStore.test.ts
```

手工或 CDP 场景：

1. SJ 发起编校审。
2. JH 创建批注和测量。
3. JH 保存新增证据并退回设计。
4. SJ 打开退回任务，单条批注点 `已修改`。
5. 不新增证据时，确认页面不再要求 `确认当前数据`。
6. SJ 可直接流转回校对，流转前后端门禁通过。
7. JH 点 `同意` 后可继续流转。
8. JH 点 `驳回` 时必须填写原因，状态回到需设计处理。

## 6. 风险与回滚

### 风险

- 后端 `AnnotationReviewStateView.history` 与前端 `AnnotationReviewEvent` 不完全一致。
- 旧确认记录里已经包含 `reviewState`，回放时需要兼容。
- `obb` 批注若已参与正式流程，门禁类型缺失会造成状态检查遗漏。
- 外部 PMS 模式下，任务流转可能由父页面驱动，需要避免前端内部按钮误导。

### 回滚策略

- Phase 1 可通过 feature flag 或分支判断回退到本地合成状态。
- Phase 2 的 evidence diff helper 可并存，不删除旧 diff。
- UI 文案可单独回滚，不影响状态保存逻辑。

## 7. 完成标准

- 批注状态动作成功后，前端状态以后端响应为准。
- 纯批注状态处理不再触发“确认当前数据”阻塞。
- 新增证据仍然必须保存，且不会被误放行。
- 任务流转只依赖后端门禁与真实未保存证据。
- 设计侧、校审侧、表格入口的主路径文案一致。
- 关键单测和类型检查通过。
