# MBD V2 fixtures

## `rs-mbd-cli-linear.json`

rs-mbd CLI 真实生成物（勿手改；契约漂移守卫 `mbdV2Contract.test.ts` 直接加载本文件，ADR 0043）。

- 生成命令（在 `rs-mbd` 仓根目录执行，输出原样落盘）：

  ```powershell
  cargo run -p rs-mbd-cli -- layout --fixture fixtures/p2-linear-dimensions.json --case linear-small-dimension --pretty --data-only
  ```

- 最近生成：2026-07-22。生成时 rs-mbd 基线 HEAD 为 `da23bd9`，工作树另含尚未提交的 Phase 2 布局/契约/CLI 改动及 `fixtures/p2-linear-dimensions.json`；因此不能把该 HEAD 单独视为可复现版本。
- 文件 SHA-256：`8568D3A13BFA48B33A97164754AB47AE4251A8C33B6B19A700397ECE9BF613D1`。本次重生成结果与已提交 fixture 字节一致；上游改动落库后应把基线更新为可直接检出的 rs-mbd commit。
- 内容：单个 `linear_dim`（`sub_kind=small`，文本 `80`），`geometry_space=source_mm`，`source_to_design` 为 0.001 缩放矩阵（→ 设计坐标米）。

## `full-coverage.json`

手工编写的 mapper 全 kind 覆盖样本（非线上契约权威，仅测 `mbdV2ExternalAnnotations` 的映射分支）。
