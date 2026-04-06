# 仿 PMS 调试页 UI Handoff

## 1. 目标

这份文档用于把当前“仿 PMS 调试页”的实现口径，直接交给另一个会话或 UI 实现者继续做界面与交互优化。

本轮已经确认的核心目标有两个：

1. 仿 PMS 页面要像一个稳定的 **PMS 风格调试壳**，而不是随意拼接的 debug 页面。
2. 点击 **新增 / 查看 / 重开** 打开 plant3d 时，必须直接进入正确工作区，**不能再掉回项目选择页**。

当前这条链路已经修到可用状态，后续 UI 工作应建立在现有合同之上，不要回退底层行为。

---

## 2. 当前产品口径

### 2.1 页面定位

仿 PMS 页面是一个**独立调试页**，不是主应用 dashboard 的正式业务页。

入口：

- `/Volumes/DPC/work/plant-code/plant3d-web/pms-review-simulator.html`

当前职责：

- 快速切换 PMS 测试用户（`SJ / JH / SH / PZ`）
- 展示真实 review 列表
- 以 iframe 打开真实 plant3d 嵌入页
- 围绕同一 `form_id` 做新增、查看、重开、跨用户重开与刷新恢复调试
- 在底部/侧边显示最小但够用的诊断信息

### 2.2 不要改掉的核心体验

后续 UI 调整可以美化、重排、增强可读性，但不能破坏以下行为：

1. 顶部项目选择必须来自真实 `/api/projects`
2. 默认项目必须优先落到 `AvevaMarineSample`（若存在）
3. 点击「新增」后不能再要求手动选择 Project
4. iframe 最终 URL 必须保持 token-primary
5. 跨角色围绕同一 `form_id` 重开必须成立
6. external/passive 下，外层 workflow 面板必须继续支持 `workflow/sync active / agree / return / stop`
7. `approved / cancelled` 终态与“目标不是当前用户”的场景，必须自动落到 readonly
8. 固定 BRAN `24381_145018` 的数据恢复链不能回退：
   - `JH` 阶段可真实添加 1 条批注、1 条距离测量、1 个截图附件
   - `approved` reopen 时，iframe 内必须恢复批注与测量
   - iframe 内“附件材料”tab 当前至少恢复 1 条附件条目（当前显示 attachment `description` / 标签）

---

## 3. 页面结构建议

### 3.1 顶部区域

建议保留这些信息区块：

1. **当前模块标题**
   - 如：`设计交付 / 三维校审单`
2. **当前 PMS 用户快捷切换**
   - `SJ / JH / SH / PZ`
3. **项目选择**
   - 当前是 select，下拉项来自 `/api/projects`
4. **工具栏动作**
   - 新增
   - 查看
   - 重开当前
   - 重开最近
   - 刷新
   - 删除 / 清空（如果保留，只能按当前真实逻辑控制可用性）

### 3.2 主区布局

建议仍保持三块主区：

1. **PMS 风格列表区**
2. **iframe 工作区**
3. **诊断 / workflow 状态区**

如果后续要重新设计布局，优先级建议是：

- 列表和 iframe 同时可见
- 角色/项目/当前 form 状态始终可见
- 诊断区不喧宾夺主，但不能消失

### 3.3 诊断区定位

诊断区应是“联调支撑信息”，不是正式业务主视图。

建议保留：

- 当前 PMS 用户
- 当前工作流角色
- 当前 taskId / formId
- 打开来源（新增 / 查看 / 重开）
- 当前 workflow 节点 / 状态
- 当前 iframe URL 摘要
- project / output_project / token claims 命中信息

不建议把诊断区做成：

- 复杂配置面板
- 第二套业务操作入口
- 与真实工作台竞争主视觉层级

---

## 4. 当前 API / 字段合同

### 4.1 项目列表

来源：

- `GET /api/projects`

用途：

- 仿 PMS 顶部项目下拉
- embed-url 请求体里的 `project_id`

重要约束：

- 这里的项目值必须是真实模型项目
- 不能再用 `PROJECT-EMBED-001` 这种伪业务号充当模型项目

### 4.2 embed-url

来源：

- `POST /api/review/embed-url`

仿 PMS 调用时使用：

- 当前 PMS 用户
- 当前工作流角色
- 当前真实项目
- 必要时带 `form_id`

关键约束：

- 请求体里的 `project_id` 必须是真实项目路径/标识
- 最终 iframe URL 不再回流 `project_id / user_id / user_role`

### 4.3 verify

来源：

- `POST /api/auth/verify`

作用：

- 由 `user_token` 还原 `claims.projectId / claims.userId / claims.formId / claims.role`

UI 需要理解的事实：

- **用户身份与角色**以 verify 后的 claims 为准
- **自动选项目**也以 `claims.projectId` 为准

### 4.4 workflow/sync

来源：

- `POST /api/review/workflow/sync`

作用：

- `action=query`：按 `form_id + token + actor` 恢复 reviewer/designer 工作区上下文
- `action=active / agree / return / stop`：由外层 PMS workflow 面板驱动外部流程动作，并在返回快照中体现最新 `current_node / task_status / form_status`

UI 需要理解的事实：

- external/passive 下，workflow action 是 **外层 PMS 壳的能力**，不是 plant3d 内部 reviewer 面板重新开放内部流转按钮
- `pz agree` 是最终批准，不再有 `next_step`
- `return` 之后页面会先按 `workflowNextStep` 即时切换，再等待任务事实回刷收敛
- `stop` / `approved` 都属于终态，后续 reopen 必须只读

这条链路既是“刷新恢复”和“跨角色 reopen”的基础，也是 external/passive 模式下外部流程动作的事实源。

---

## 5. 关键字段语义

| 字段 | 含义 | UI 层应如何理解 |
|------|------|----------------|
| `project_id` | embed-url 请求时的项目上下文 | 只应来自真实 `/api/projects` |
| `claims.projectId` | token verify 后的可信项目标识 | 用于自动选中 plant3d 当前项目 |
| `output_project` | 前端资源输出作用域 | iframe URL 中应保留 |
| `form_id` | 单据/工作流快照主键 | 查看、重开、刷新恢复的关键锚点 |
| `user_token` | 嵌入访问主凭证 | iframe URL 必带 |
| `workflowNextStep` | workflow/sync 动作后的目标节点 | external/passive 下优先驱动当前 workflow role 与默认测试用户 |
| `taskCurrentNode` | `review_tasks.current_node` 的事实节点 | 用于显示内部任务当前节点，不再与 `workflowNextStep` 混为同一语义 |
| `canMutateWorkflow` | 当前用户是否允许推动这张单据 | 优先按真实任务指派；缺失时回退默认测试流转；终态强制 false |
| `accessDecisionSource` | 只读/可操作的判定来源 | 可能是 `task-assignee` / `default-assignee` / `task-terminal` |

一句话口径：

> **身份靠 token claims，资源靠 output_project，重开/恢复靠 form_id，动作推进靠 workflow/sync。**

---

## 6. 当前已固定的页面行为

### 6.1 默认项目行为

默认项目解析顺序：

1. `output_project`
2. `project`
3. `AvevaMarineSample`
4. 项目列表第一项

如果 URL 里是：

```text
?project=PROJECT-EMBED-001
```

而该值不在 `/api/projects` 列表里，则必须自动回退到真实项目，不能继续沿用。

### 6.2 最终 iframe URL 形态

当前正确形态：

```text
/review/3d-view?output_project=AvevaMarineSample&user_token=...
```

允许：

- `user_token`
- `output_project`
- 必要时带 `form_id`

不应回流：

- `project_id`
- `user_id`
- `user_role`

### 6.3 新增后的预期

点击「新增」后：

- 直接进入 plant3d 发起工作区
- 不应再弹项目选择
- 不应先掉回 dashboard

### 6.4 查看 / 重开后的预期

点击「查看 / 重开当前 / 重开最近」后：

- 应直接围绕目标 `form_id` 恢复工作区
- 不应重新要求选项目
- 不应因为切换 PMS 用户而丢失当前单据上下文

### 6.5 reviewer 刷新恢复

reviewer 已进入工作区后刷新页面：

- 应继续按 `user_token -> verify -> claims -> workflow/sync(query)` 恢复
- 不应掉回空白页、dashboard 或项目选择页

### 6.6 external/passive workflow 面板预期

对仿 PMS 调试页而言，external/passive 现在不是“只有 `SJ active`”，而是：

- `SJ`：发起态可执行 `active`
- `JH / SH / PZ`：命中目标处理人时，可分别执行 `agree / return / stop`
- `PZ agree`：作为最终批准进入 `approved`

页面需要保持以下体验：

1. **目标不是当前用户**  
   - 双击打开仍允许查看  
   - 但只能进入 `readonly`
2. **终态单据（approved / cancelled）**  
   - 当前页刷新收敛后自动只读  
   - reopen 后仍然只读
3. **return 到 `sj`**  
   - 页面会先显示 `workflowNextStep = sj`
   - 随后任务事实回刷到 `taskCurrentNode = sj`
   - `SJ` reopen 后重新进入 `initiate`

已验证的数据证据链还包括：

- 固定测试 BRAN：`24381_145018`
- `JH` 阶段真实执行：
  - 添加 1 条批注
  - 添加 1 条距离测量
  - 上传 1 个截图附件
- 最终 `approved` reopen 时：
  - iframe 内恢复批注与测量
  - iframe 内“附件材料”tab 已显示 1 条附件条目
  - 当前默认显示 attachment `description` / 标签，而不是原始上传文件名

---

## 7. UI 设计时不要破坏的规则

### 7.1 不要回退成自由输入项目

顶部项目控件可以美化，但不要回退成任意文本输入。  
因为一旦用户能随便输入伪值，整个自动选项目链路就又会坏掉。

### 7.2 不要隐藏当前项目与当前 form 的上下文

后续 UI 即使更简洁，也建议始终让用户能看见：

- 当前 PMS 用户
- 当前工作流角色
- 当前项目
- 当前 formId
- 当前打开来源

否则联调时很难判断当前 iframe 到底是谁打开的、开的是什么单据。

### 7.3 不要把诊断信息完全删掉

可以折叠、弱化、收进抽屉，但不建议完全删掉。  
这个页面本质上仍然是调试页，不是正式 PMS 生产页面。

### 7.4 不要让项目选择与 PMS 用户切换互相污染

PMS 用户切换后：

- 应刷新列表
- 可关闭当前 iframe
- 但不应把当前真实项目重置成伪值或空值

---

## 8. 验收矩阵（UI 交接版）

| 场景 | 入口 | 验收点 |
|------|------|--------|
| 新增 | `SJ -> 新增` | 直接进入发起工作区；URL 含 `user_token + output_project`；不出现项目选择页 |
| 查看 | 选中行 -> 查看 | 直接进入目标单据工作区；角色与 form 对应正确 |
| 重开当前 | 选中行 -> 重开当前 | 沿当前 `form_id` 恢复；不再次选项目 |
| 重开最近 | 切角色后 -> 重开最近 | 支持围绕同一 `form_id` 跨角色重开 |
| reviewer 刷新恢复 | reviewer 工作区中刷新 | 工作区自动恢复；不掉回 dashboard/project picker |
| external/passive 通过链 | `SJ active -> JH agree -> SH agree -> PZ agree` | 最终 `task_status/form_status/lineage.status = approved`，页面收敛到 readonly |
| external/passive 终止链 | `SJ active -> JH agree -> SH stop` | 最终 `task_status/form_status = cancelled`，reopen readonly |
| external/passive 驳回链 | `... -> PZ return -> sj` | `SJ` reopen 后重新进入 initiate |
| BRAN 数据恢复链 | `24381_145018` | `JH` 阶段可真实添加 1 批注 + 1 测量 + 1 附件；`approved` reopen 时 iframe 内恢复批注/测量/附件条目 |

---

## 9. 参考实现文件

- `/Volumes/DPC/work/plant-code/plant3d-web/pms-review-simulator.html`
- `/Volumes/DPC/work/plant-code/plant3d-web/src/debug/pmsReviewSimulator.ts`
- `/Volumes/DPC/work/plant-code/plant3d-web/src/debug/pmsReviewSimulatorLaunchPlan.ts`
- `/Volumes/DPC/work/plant-code/plant3d-web/src/App.vue`

测试与验证相关：

- `/Volumes/DPC/work/plant-code/plant3d-web/src/debug/pmsReviewSimulatorLaunchPlan.test.ts`
- `/Volumes/DPC/work/plant-code/plant3d-web/src/App.test.ts`
- `/Volumes/DPC/work/plant-code/plant3d-web/e2e/pms-review-simulator-token-only.spec.ts`
- `/Volumes/DPC/work/plant-code/plant3d-web/docs/verification/pms-3d-review-integration-e2e.md`

更完整的实现背景与问题修复说明：

- `/Volumes/DPC/work/plant-code/plant3d-web/docs/plans/2026-04-01-pms-review-simulator-project-selection-fix.md`

---

## 10. 给下一个会话的最短提示词

如果要把这份文档直接交给另一个会话继续做 UI，可以直接给它这段：

> 请基于 `docs/plans/2026-04-01-pms-review-simulator-ui-handoff.md` 继续优化仿 PMS 调试页 UI。注意不要破坏已有合同：项目必须来自 `/api/projects`，默认真实项目优先 `AvevaMarineSample`，最终 iframe URL 保持 `user_token + output_project`，点击新增/查看/重开后不能再掉回项目选择页。
