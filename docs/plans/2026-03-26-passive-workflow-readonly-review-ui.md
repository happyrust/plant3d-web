# 被动流程模式下收紧 Review UI 行为说明

日期：2026-03-26

## 1. 背景

当前三维校审前端同时承载了两种语义：

1. **内部流程模式**：plant3d 内部工作台可以直接推进节点（提交、驳回）。
2. **被动流程 / 外部驱动模式**：流程推进由外部平台完成，plant3d 只负责展示当前单据状态、批注与上下文。

本次改动的目标，是把“被动模式”真正收紧成 **只读观察态**，避免用户在外部驱动场景里误用内部流程入口。

> 2026-04-02 补充口径：本文主要约束 **真实 plant3d 嵌入工作区** 在 passive/external 模式下的行为。  
> 当前 **仿 PMS 调试页**（`/pms-review-simulator.html`）已经演进为：外层右侧 workflow 面板可通过 `workflow/sync active / agree / return / stop` 驱动外部流程，但该能力属于 **PMS 外层调试壳**，不等于 plant3d 内部 reviewer 工作区重新开放了内部提交流转按钮。

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

补充说明：

- 这里的“不能主动推进流程”指的是 **plant3d 内部工作区** 不再渲染内部 submit/return 按钮。
- 对 **仿 PMS 调试页** 而言，外层 PMS 壳仍可在满足目标处理人与终态约束时，通过独立 workflow 面板调用 `workflow/sync` 执行动作。

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

### 3.4 PMS 调试模拟器改为“外层 workflow/sync 面板驱动”

修改文件：

- `/Volumes/DPC/work/plant-code/plant3d-web/src/debug/pmsReviewSimulator.ts`

被动模式下：

- plant3d 内部 reviewer 工作区继续不提供 `agree / return / stop` 等**内部**推进入口
- 但仿 PMS 外层右侧 workflow 面板已支持：
  - `SJ active`
  - `JH/SH/PZ agree`
  - `PZ return`
  - `SH stop`
- 上述动作统一通过 `workflow/sync` 驱动，不再先推进内部 `review_tasks/{id}/submit`
- 外层 workflow 面板同时受以下约束：
  - 已有单据优先按**真实任务指派**判断是否可操作
  - 缺失真实指派时回退到**默认测试流转映射**
  - `approved / cancelled` 终态自动只读
- 基于固定 BRAN `24381_145018` 的真实界面点击验证还已确认：
  - `JH` 阶段可以在 iframe 内同时添加 1 条批注、1 条距离测量、1 个截图附件
  - `approved` reopen 时，iframe 内会恢复批注与测量
  - iframe 内“附件材料”tab 已恢复 1 条附件条目（当前默认显示 attachment `description` / 标签）
- 页面其余区域继续保留节点、状态、快照、刷新/重开能力

---

## 4. 行为矩阵

| 场景 | 内部流程模式（manual/internal） | 被动流程模式（默认 external） |
|---|---|---|
| 发起提资 | 可创建并按内部规则继续流转 | 只保存提资单数据，后续由外部系统处理 |
| reviewer 流转按钮 | 显示 | 不显示 |
| reviewer 提交/驳回弹窗 | 显示 | 不显示 |
| 我的提资单 | 显示 | 不显示 |
| Ribbon “我的提资”入口 | 显示 | 不显示 |
| PMS 调试模拟器 workflow/sync 操作 | 可用 | 由外层 workflow 面板驱动；`SJ/JH/SH/PZ` 在命中目标处理人且未终态时可执行 `active/agree/return/stop`，否则只读 |
| BRAN `24381_145018` 数据恢复 | 不作额外区分 | `approved` reopen 时 iframe 内恢复批注/测量/附件条目，附件当前显示 description / 标签 |

补充说明：

- 上表中的 “reviewer 流转按钮 / reviewer 提交弹窗” 仅指 **plant3d 内部工作区**。
- 仿 PMS 调试页的外层 workflow 面板不受此行约束，它属于外层 PMS 壳的调试能力。

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
4. PMS 模拟器在 passive/external 下改为“外层 workflow/sync 面板 + access gate”：
   - 命中目标处理人时可操作
   - `approved / cancelled` 终态只读
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
