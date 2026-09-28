# 目标：测量时 hover 显示关键点(ptset) 并吸附捕捉

## articulated goal（1-3 句）
在 `plant3d-web` 的三维测量过程中，鼠标 hover 到构件时自动显示其关键点（ptset / P-points），并在测量光标靠近关键点时把落点**吸附**到该关键点的精确坐标，实现 CAD 式“对象捕捉”的精确测量。复用既有 ptset 数据接口与三维渲染，核心改动集中在测量取点的唯一咽喉 `pickSurfacePoint`。

## 共享理解（facts）
见 [`facts.md`](./facts.md)。

## 执行计划（plan）
见 [`plan.md`](./plan.md)。

## Done 条件
- 测量模式下 hover 构件即显示关键点，靠近时吸附到关键点并给出可视反馈；
- 落点坐标与点集面板一致；捕捉可开关；
- `usePtsetSnap` 与 `useXeokitMeasurementTools` 吸附用例单测通过；
- 大装配下流畅、无重复请求、退出即清除。

## 范围边界
仅实现“关键点捕捉”，不重构既有测量框架，不新增其它捕捉类型；关键点数据沿用现有后端接口（除非启用计划中的可选批量预取优化）。
