# 任务简报：生成 004 tasks.md 任务拆解

仓库：`d:\work\plant-code\plant3d-web`（用绝对路径读写；你的当前工作区可能是 rs-core，不影响）。

## 前置

本任务依赖同计划 dm / contracts / plan 三个节点的产物。开始前先确认这些文件已存在并通读：

- `specs/004-model-version-timeline/spec.md`
- `specs/004-model-version-timeline/plan.md`
- `specs/004-model-version-timeline/research.md`
- `specs/004-model-version-timeline/data-model.md`
- `specs/004-model-version-timeline/contracts/version-timeline-ui-contract.md`
- `specs/004-model-version-timeline/quickstart.md`
- `specs/004-model-version-timeline/research/` 两份事实清单

格式严格参照 `specs/002-bran-flow-direction/tasks.md`（先读它，学习任务编号/分组/依赖/并行标记写法）。

## 产出（只新建这一个文件）

`specs/004-model-version-timeline/tasks.md`：

- 按 Phase 1（US1 时间线面板 + US2 树内差异）→ Phase 2（US3 历史快照 + 3D 联动）→ Phase 3（US4 双树对比 + US5 刻度条）分组；组内先基础设施（api 封装 / store）后 UI
- 每个任务：编号 T001…、标题、涉及文件相对路径、验收标准（关联 FR-xxx / SC-xxx）、依赖任务、可并行标记 [P]
- 包含测试任务：`src/components/model-version/VersionTimelinePanel.test.ts` 等新组件 vitest 测试；modelVersionApi 单测（覆盖 410/404 分支）；模型树差异应用/清除回归
- 收尾任务：`npm run type-check`、`npm run lint`、`npx vitest run` 相关文件
- 注明本 feature 不改 `src/components/review/`，无需跑双胞胎面板回归套件
- 结尾附 Dependencies 总览与建议实施顺序

## 约束

- 不要修改其它任何文件。
- 完成后 `report_task(done)` 附一句话摘要。
