# 进度

## 2026-05-07 22:30 — 计划立项

- 阅读 RUS-244 issue 标题 + 既有代码（plant-model-gen 后端 / plant3d-web 设计端面板 / 仿 PMS 入口）。
- 完成根因分析（F1–F8，见 findings.md），确认"workflow_sync 不写 evidence" 是唯一一条直连根因；task_id 切片、annotation_check 门禁等候选已被排除。
- 提交方案 B 设计草案（task_plan.md），用户已选定 B 并要求先做计划 + 仿 PMS 回归基线。

## 2026-05-07 23:30 — 基线（BL）数据采集

- **BL-1**：本地 SurrealDB（ws://127.0.0.1:8020 / NS 1516 / DB AvevaMarineSample）直查：
  - `review_workflow_history` 中 `action='return'` 共 **36 次**，distinct task = **35**；
  - `review_records` 共 **14 行**，distinct task = **14**；
  - **35 - 14 = 21 个被驳回过的 task 完全没有 review_records 数据**，这就是 RUS-244 的受害集合。
- **BL-2**：仿 PMS `bun run test:pms:simulator -- --cases=return` 启动并仍在跑，backend.log 已捕获每个新建 form 在 `[WORKFLOW_SYNC] action=active` 完成后 `records=0`，与"workflow_sync 主路径不写 review_records"完全吻合。
- **BL-3**：`docs/plans/2026-05-07-rus-244-evidence-snapshot/artifacts/baseline/pms-simulator-artifacts/` 留档 backend.log / contract-smoke.log / screenshots/return.png。
- 详细数据写入 `findings.md` B1–B5 节，作为 Phase 0 的硬证据。

## 待办

| Phase | 项 | 状态 |
|---|---|---|
| 0.1 | 仿 PMS return 场景拿基线（log + 截图） | ✓ 完成（simulator 仍在后台收尾，已拿到关键 `records=0` 证据） |
| 0.2 | SurrealDB 直查 review_records / review_annotation_states / review_tasks | ✓ 完成（35 vs 14 对比） |
| 0.3 | 浏览器以 SJ 身份打开被驳回单据复现面板空 | 由用户在审核环节自行验证（已有 21 个候选 task 可作为复现样本） |
| 0.4 | 用户审核 plan + 基线，批准后进 Phase 1 | ⬅️ **当前**，等待用户决策 |
