# Notes Index

工程笔记索引（面向维护者的“为什么这样做/数据如何流动”）。

## Viewer / Annotation

- `solvespace-dimension-dataflow.md`
  - SolveSpace 风格 3D 尺寸标注：数据流与交互链路说明（store.dimensions / MBD dims）
- `mbd-rebarviz-beam-demo.md`
  - RebarViz 梁标注对标案例：访问 URL、参数说明与截图对比脚本

## MBD 全标注类型（#103）

- `../plans/2026-11-07-mbd-all-annotation-types-port-dev-plan.md`
  - 管道之外的设备 / 支架 / 土建 / 建筑标注移植计划（工作包 M0–M8）与决策表；求解器侧的字段与裁决在 plant-mbd `docs/field-dictionary.md`、`docs/MIGRATION.md`
- `../verification/mbd-equipment-display-2026-11-07/`、`../verification/mbd-support-display-2026-11-07/`、`../verification/mbd-civil-display-2026-11-07/`、`../verification/mbd-pipe-polar-display-2026-11-07/`
  - 各类型真实对象走通用端点 `/api/mbd/v2/object/{refno}` 的三档截图与重叠统计（管道含宿主字段接上后的四模式 A/B 与 EM9 仪表管）
- `../verification/mbd-perf-all-types-2026-11-07/`
  - 各类型真实对象的相机环绕性能，以及标签卡片避让改走屏幕网格前后的对比

## Verification / Debug

- `../verification/debug-ui-gate.md`
  - `debug_ui` 调试门控说明：哪些页面受控、如何在部署环境显式开启/关闭
