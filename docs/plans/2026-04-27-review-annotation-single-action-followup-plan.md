# 三维校审批注“单次主操作”后续深化计划

日期：2026-04-27  
前置计划：[`2026-04-27-review-annotation-single-action-plan.md`](./2026-04-27-review-annotation-single-action-plan.md)  
当前状态：已完成状态真源、evidence-only diff、表格详情入口与核心文案收敛。

## 1. 已完成基线

本轮已经落地的能力：

- `ReviewCommentsTimeline.vue` 在有 `formId/taskId` 时优先使用后端 `AnnotationReviewStateView` 更新前端状态。
- `reviewApi.ts` 新增 `normalizeAnnotationReviewStateView()`。
- `reviewPanelActions.ts` 新增 evidence-only diff，纯 `reviewState` 变化不再触发“保存新增证据”阻塞。
- `ReviewPanel.vue`、`DesignerCommentHandlingPanel.vue`、`ReviewConfirmation.vue` 改用 evidence-only diff。
- `AnnotationTableView.vue` 操作列详情按钮直接打开处理详情。
- 主要文案从 `确认当前数据` 收敛为 `保存新增证据` / `流转回校对`。
- 回归验证：相关 5 个测试文件共 93 个测试通过，`npm run type-check` 通过。

## 2. 剩余问题

### 2.1 UI 仍不是完整的“单一处理表单”

当前 `ReviewCommentsTimeline.vue` 已修正状态真源，但视觉结构仍是：

- 上方一个处理备注 textarea；
- 下方多个状态按钮；
- 底部还有普通评论输入框。

这比之前可靠，但用户仍可能分不清：

- “补充讨论”是否会改变状态；
- “处理备注”属于哪一个动作；
- `已修改` / `不需解决` / `同意` / `驳回` 是否是同一个表单的提交结果。

### 2.2 后端 history 协议需要真实联调确认

前端现在支持把 `AnnotationReviewStateView.history` 映射为 `AnnotationReviewEvent[]`，但仍需要真实接口样例确认：

- 字段是否为 `operatorId/operatorName/operatorRole/createdAt`；
- 是否存在 snake_case；
- `history` 是否按时间排序；
- `reviewRound/workflowNode` 是否需要在 UI 中展示或参与过滤。

### 2.3 OBB 门禁类型仍需确认

当前多处 `reviewAnnotationCheck()` 传入：

```ts
includedTypes: ['text', 'cloud', 'rect']
```

如果 `obb` 已是正式校审批注类型，后端门禁和前端统计都应补齐 `obb`；如果 `obb` 仍是调试/可视化辅助，应在 UI 与文档里明确“不参与流程门禁”。

## 3. 目标

### 3.1 用户目标

- 批注详情中只看到一个主处理表单。
- 用户先选择处理结果，再填写说明，再点击一个主按钮。
- 普通讨论输入明显是次级能力，不会被误认为处理动作。
- 设计侧和校审侧都按同一种交互模型操作。

### 3.2 工程目标

- 将 `ReviewCommentsTimeline.vue` 的状态动作 UI 收敛为小型状态机组件或局部 composable。
- 用真实接口样例固化 `AnnotationReviewStateView` 适配规则。
- 明确 `obb` 是否进入门禁，并补齐类型定义、API 参数和测试。
- 增加一条接近真实流程的回归脚本或 E2E 检查。

## 4. Phase A：处理表单 UI 收敛

### A1. 抽出动作视图模型

新增纯函数或 composable，例如：

```ts
type ReviewActionOption = {
  action: AnnotationReviewAction;
  label: string;
  tone: string;
  requiresNote: boolean;
};

function buildReviewActionFormState(input: {
  role: UserRole | null;
  designerOnly: boolean;
  reviewState: AnnotationReviewState | null;
}): {
  mode: 'designer_resolution' | 'review_decision' | 'readonly';
  options: ReviewActionOption[];
  hint: string;
};
```

建议位置：

- 若只服务时间线：`src/components/review/reviewActionFormModel.ts`
- 若后续多组件复用：`src/review/domain/annotationReviewActionForm.ts`

测试：

- 设计侧只显示 `fixed/wont_fix`。
- 审核侧在 `open` 时只读并提示等待设计处理。
- 审核侧在 `fixed/wont_fix + pending` 时显示 `agree/reject`。
- `wont_fix/reject` 标记为备注必填。

### A2. 改造 `ReviewCommentsTimeline.vue`

目标布局：

```text
当前状态 Badge + 最近处理信息

处理结果
[ 已修改 ][ 不需解决 ]    // 设计侧
或
[ 同意 ][ 驳回 ]          // 校审侧

处理说明 / 决定说明
[ textarea ]

[ 提交处理结果 / 提交确认结果 ]

补充讨论
[ 普通评论输入框 ]
```

实现要点：

- 用 `selectedAction` 替代四个按钮直接提交。
- 主按钮调用现有 `applyReviewAction(selectedAction)`。
- `wont_fix` 和 `reject` 继续强制备注。
- 提交成功后清空 `selectedAction` 与 `actionNote`。
- 保留现有普通评论功能。

验收：

- 用户不能在未选择处理结果时提交。
- `不需解决` 无备注时提示 `请填写不需解决原因`。
- `驳回` 无备注时提示 `请填写驳回原因`。
- 普通评论不改变批注状态。

## 5. Phase B：后端状态协议联调

### B1. 获取真实响应样例

建议用当前 dev server 或后端环境抓取：

```bash
curl -s -X POST "$API/api/review/annotation-states/apply" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "formId": "...",
    "taskId": "...",
    "annotationId": "...",
    "annotationType": "text",
    "action": "fixed",
    "note": "..."
  }'
```

以及：

```bash
curl -s "$API/api/review/annotation-states?form_id=...&task_id=..."
```

记录到：

- `docs/verification/review-annotation-state-api-samples-2026-04-27.md`

注意不要提交 token 或敏感数据。

### B2. 固化 adapter 兼容性

根据样例补齐 `normalizeAnnotationReviewStateView()`：

- snake_case history 字段；
- `created_at` 字符串时间；
- 缺少 history 时用当前 state 生成只读展示还是保持空数组；
- 后端 role code 到 `UserRole` 的映射。

测试：

- `normalizeAnnotationReviewStateView` 能吃 camelCase。
- 能吃 snake_case。
- 缺 history 不崩溃。
- 非法 action 会被过滤。

## 6. Phase C：OBB 门禁决策

### C1. 先做协议决策

需要明确：

| 决策 | 含义 | 前端动作 |
| --- | --- | --- |
| OBB 参与正式校审 | OBB 批注必须进入后端状态检查 | `includedTypes` 增加 `obb`，API 类型扩展 |
| OBB 只做辅助证据 | OBB 不影响状态门禁 | UI/文档标注为辅助证据，不进入 blocker |

### C2. 若 OBB 参与门禁

改动点：

- `ReviewAnnotationCheckRequest.includedTypes` 增加 `'obb'`。
- `ReviewAnnotationCheckBlocker.annotationType` 增加 `'obb'`。
- `ReviewPanel.vue`、`DesignerCommentHandlingPanel.vue`、`ReviewerTaskList.vue` 的 includedTypes 增加 `obb`。
- 后端若尚不支持，需要先后端补齐。

测试：

- 传入 includedTypes 包含 `obb`。
- blocker 中 OBB 可被正确显示和定位。

### C3. 若 OBB 不参与门禁

改动点：

- 保持 includedTypes 不变。
- 在 `AnnotationWorkspace` / 表格类型标签中说明 OBB 是“辅助空间证据”。
- 文档更新：OBB 不阻塞流转，但可被保存为证据。

## 7. Phase D：真实流程验收

### D1. 单元回归

建议固定执行：

```bash
npm test -- src/components/review/ReviewCommentsTimeline.test.ts src/components/review/DesignerCommentHandlingPanel.test.ts src/components/review/ReviewPanel.test.ts src/components/review/AnnotationTableView.test.ts src/components/review/reviewPanelActions.test.ts
npm run type-check
```

### D2. 端到端手工路径

1. SJ 发起编校审。
2. JH 创建一条文字批注和一条测量证据。
3. JH 保存新增证据并退回 SJ。
4. SJ 打开退回任务，进入批注详情。
5. SJ 在单一处理表单中选择 `已修改`，填写说明，提交。
6. 不新增证据时，不再出现必须保存证据阻塞。
7. SJ 直接流转回校对。
8. JH 在单一处理表单中选择 `同意`，提交。
9. JH 继续流转到下一节点。

### D3. 端到端自动化候选

如果当前 PMS CDP 脚本可稳定执行，可新增或扩展：

- `scripts/pms-simulator-runner.ts`
- `npm run test:pms:cdp:extended`

重点断言：

- 批注处理状态提交后，页面不再出现旧文案 `确认当前数据`。
- 没有新增证据时，流转按钮不被 evidence diff 阻塞。
- 后端 `reviewAnnotationCheck` 仍会拦截真正未处理的批注。

## 8. 风险与顺序建议

推荐顺序：

1. **先做 Phase B**：确认后端响应，避免 UI 表单改完后发现 history 映射不稳。
2. **再做 Phase A**：在已稳定的状态真源上收敛 UI。
3. **并行确认 Phase C**：OBB 是否进门禁，这是协议决策。
4. **最后 Phase D**：真实流程验收和自动化。

主要风险：

- 后端状态表 history 缺字段，导致时间线展示不足。
- OBB 门禁前后端决策不一致，造成某些批注绕过检查。
- 外部 PMS 流程中父页面和 iframe 都有流转入口，文案需要避免重复承诺。

## 9. 完成标准

- `ReviewCommentsTimeline` 已成为单一处理表单。
- 后端状态 adapter 有真实样例和测试覆盖。
- OBB 门禁策略有明确结论并在代码/文档体现。
- SJ/JH/SH 至少一条完整退回-处理-复核路径通过。
- 旧的“同一状态动作需要再确认一次”体验不再出现。
