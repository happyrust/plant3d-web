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

## `source-to-design-translation.json`

手工编写的 `source_to_design` **列主序约定钉子**（`mbdV2ExternalAnnotations.test.ts` 加载）。

- 矩阵为 `T(10,20,30)·Rz(90°)·S(0.001)` 的**列主序** 16 元素数组（THREE
  `Matrix4.fromArray` 布局，平移在下标 12–14）。现网 manifest 至今只有对角缩放
  矩阵（转置不变），本 fixture 专门带旋转+平移，使行主序误读会得到错误坐标而
  被测试拦下。
- 任何生产侧（plant-model-gen manifest、plant-web-server 透传、rs-mbd
  `LayoutRequest.source_to_design`）引入非对角矩阵时，必须按列主序序列化；
  约定同步记录于 rs-mbd `docs/field-dictionary.md`。
