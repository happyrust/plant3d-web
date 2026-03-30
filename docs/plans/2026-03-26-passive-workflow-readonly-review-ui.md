# 被动流程模式下收紧 Review UI 行为说明

日期：2026-03-26

## 1. 背景

当前三维校审前端同时承载了两种语义：

1. **内部流程模式**：plant3d 内部工作台可以直接推进节点（提交、驳回）。
2. **被动流程 / 外部驱动模式**：流程推进由外部平台完成，plant3d 只负责展示当前单据状态、批注与上下文。

本次改动的目标，是把“被动模式”真正收紧成 **只读观察态**，避免用户在外部驱动场景里误用内部流程入口。

---

## 2. 本次决策

### 2.1 单一判定口径

新增公共 helper：

- `/Volumes/DPC/work/plant-code/plant3d-web/src/components/review/workflowMode.ts`

统一使用以下规则：

- `workflow_mode=manual|internal` → **内部流程模式**
- 其他值或缺省 → **被动流程 / 外部驱动模式**

判定来源优先级保持与现状兼容：

1. URL query：`workflow_mode`
2. `sessionStorage['plant3d_workflow_mode']`
3. `localStorage['plant3d_workflow_mode']`
4. embed 参数：`workflowMode / externalWorkflowMode`

### 2.2 被动模式的 UI 原则

被动模式下统一遵循：

- 可以展示流程状态
- 可以展示任务上下文、历史、附件、辅助数据、批注与测量
- 可以刷新
- **不能**在 plant3d 内主动推进流程
- **不能**暴露“我的提资单”这类内部任务列表视图

---

## 3. 落地范围

### 3.1 ReviewPanel：内部流转区改为只读状态卡

修改文件：

- `/Volumes/DPC/work/plant-code/plant3d-web/src/components/review/ReviewPanel.vue`

被动模式下：

- 不再渲染提交/驳回按钮
- 不再渲染 `WorkflowSubmitDialog` / `WorkflowReturnDialog`
- 不再触发内部 submit/return 处理函数
- workflow 区只展示：
  - 当前节点
  - 当前状态
  - 外部驱动说明
  - 刷新按钮

### 3.2 设计侧不再出现“我的提资单”

修改文件：

- `/Volumes/DPC/work/plant-code/plant3d-web/src/components/review/embedRoleLanding.ts`
- `/Volumes/DPC/work/plant-code/plant3d-web/src/components/review/embedContextRestore.ts`
- `/Volumes/DPC/work/plant-code/plant3d-web/src/components/DockLayout.vue`
- `/Volumes/DPC/work/plant-code/plant3d-web/src/components/review/DesignerTaskList.vue`

被动模式下：

- 设计角色 embed 落地不再自动打开 `myTasks`
- `openPanel / togglePanel / ensurePanel('myTasks')` 均会被拦截
- Ribbon 命令 `panel.myTasks` 被拦截
- 若旧 layout 恢复出 `myTasks`，初始化时会自动关闭
- 即便异常路径挂载到 `DesignerTaskList`，也只显示只读占位，不显示真实内部列表

### 3.3 Ribbon 与引导同步收口

修改文件：

- `/Volumes/DPC/work/plant-code/plant3d-web/src/ribbon/ribbonConfig.ts`
- `/Volumes/DPC/work/plant-code/plant3d-web/src/components/onboarding/roleGuides/designerGuide.ts`

被动模式下：

- “校审 -> 面板”组不再显示“我的提资”入口
- 设计师引导不再注入“查看我的提资”步骤

### 3.4 PMS 调试模拟器改为只读观察口径

修改文件：

- `/Volumes/DPC/work/plant-code/plant3d-web/src/debug/pmsReviewSimulator.ts`

被动模式下：

- 右侧 workflow 面板不再提供 `active / agree / return / stop` 操作入口
- 页面文案改为“流程状态镜像 / 外部驱动只读观察”
- 保留节点、状态、快照、刷新/重开能力

---

## 4. 行为矩阵

| 场景 | 内部流程模式（manual/internal） | 被动流程模式（默认 external） |
|---|---|---|
| 发起提资 | 可创建并按内部规则继续流转 | 只保存提资单数据，后续由外部系统处理 |
| reviewer 流转按钮 | 显示 | 不显示 |
| reviewer 提交/驳回弹窗 | 显示 | 不显示 |
| 我的提资单 | 显示 | 不显示 |
| Ribbon “我的提资”入口 | 显示 | 不显示 |
| PMS 调试模拟器 workflow/sync 操作 | 可用 | 只读 |

---

## 5. 对自动化脚本的影响

由于被动模式默认不再显示 reviewer 内部提交流转按钮，`extended` 自动化如果还要验证 **plant3d 内部 reviewer 提交链路**，必须显式切到内部流程模式。

为避免脚本与界面口径漂移，本次同步更新：

- `/Volumes/DPC/work/plant-code/plant3d-web/scripts/pms-plant3d-initiate-flow.ts`
- `/Volumes/DPC/work/plant-code/plant3d-web/scripts/pms-chrome-devtools-flow.ts`
- `/Volumes/DPC/work/plant-code/plant3d-web/docs/verification/pms-3d-review-integration-e2e.md`

新增约定：

- `PMS_CDP_WORKFLOW_MODE=manual|internal|external`
- 该变量会写入嵌入页的 `localStorage.plant3d_workflow_mode`
- `test:pms:cdp:extended` 若未显式设置，将自动补 `manual`

推荐命令：

```bash
export PMS_E2E_PASSWORD='********'
export PMS_EMBEDDED_SITE_SUBSTRING='123.57.182.243'
export PMS_CDP_WORKFLOW_MODE='manual'
npm run test:pms:cdp:extended
```

---

## 6. 最小验证结果

已验证：

```bash
npm test -- src/components/review/ReviewPanel.test.ts src/components/review/embedRoleLanding.test.ts
npm run type-check
npm run lint -- scripts/pms-chrome-devtools-flow.ts scripts/pms-plant3d-initiate-flow.ts src/components/review/workflowMode.ts src/components/review/InitiateReviewPanel.vue src/components/review/ReviewPanel.vue src/components/review/embedRoleLanding.ts src/components/review/embedContextRestore.ts src/components/DockLayout.vue src/ribbon/ribbonConfig.ts src/components/onboarding/roleGuides/designerGuide.ts src/components/review/DesignerTaskList.vue src/debug/pmsReviewSimulator.ts src/components/review/ReviewPanel.test.ts src/components/review/embedRoleLanding.test.ts
```

验证重点：

1. 被动流程下 reviewer 工作区不再出现内部流转按钮
2. 被动流程下设计角色不再自动落到 `myTasks`
3. Ribbon 不再显示“我的提资”
4. PMS 模拟器 workflow 面板只读化
5. `extended` 自动化在需要 reviewer 内部提交流程时可通过 `PMS_CDP_WORKFLOW_MODE=manual` 恢复旧链路

---

## 7. 后续边界

当前仍保留：

- `initiateReview / 发起提资单` 面板
- 批注、测量、附件、历史、辅助数据等非流程推进能力

如果后续要进一步收紧为：

- 被动模式下连 `initiateReview` 也不展示
- 被动模式下连发起保存也完全交给外部平台

可以继续沿用 `workflowMode.ts` 这套统一判定口径下沉，不需要重做架构。
