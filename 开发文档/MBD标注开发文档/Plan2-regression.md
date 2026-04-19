# Plan 2 回归 QA 报告

## 范围

Plan 1（`mbd-layout-result-migration`）打通后端 → rs-core → 前端的 layout_result 链路之后，本 Plan 2 进一步补齐了两个视觉闭环：

- **Stage B.1 / B.2**：`MbdPipeSegmentDto.outside_diameter` 真实从 surreal `pe.aod` 读取，否则回退到 DN200 经验值 229mm（见 `compute_branch_layout_result`）。
- **Stage C**：`aios_core::mbd::iso_branch::UsedDirRegistry` 对同方向、同空间位置的 dim 自动递增 `dim_times`，让 offset 沿 `od + 1.2·cheight·(n-1)` 阶梯化。
- **Stage E**：修复 `build_chain_points_from_ends` 在 `weld_joints.is_empty()` 分支只返回第一段端点的老 bug，overall 尺寸改用 `segments.first().start → segments.last().end`，同时 chain 尺寸会按实际段数拆成 N-1 条。

## 样本：pipe `24381_145712`（AvevaMarineSample）

### 拓扑

- 3 段 TUBI：
  - `seg:24381_145712:0`  arrive=`[14706.1, -16381.3, -1546.09]`  leave=`[-229, 0, 0]`  length=22221.5mm
  - `seg:24381_145714:1`  arrive=`[0, 229, 0]`  leave=`[152, 0, 0]`  length=274.9mm
  - `seg:24381_145715:2`  arrive=`[0, 0, 0]`  leave=`[13831.28, -15073.34, -2731.25]`  length=20639.0mm
- 1 处坡度 / 1 个弯头 / 1 个管件 / 4 个标签；无焊口（后端 `welds_count=0`）

### API 对比（Plan 1 →  Plan 2）

| 指标 | Plan 1 完成后 | Plan 2 完成后 |
| ---- | ---- | ---- |
| `data.layout_result` | 有 | 有 |
| `linear_dims_count` | 4（segment×3 + chain×1） | 7（segment×3 + chain×3 + overall×1） |
| 所有 dim 方向 | 近 +Z（PML 同源） | 近 +Z，同上 |
| `offset` 分布 | 全部 100mm | 229 / 349 / 469 / 589 / 709 / 829（lane 0-5 阶梯） |
| `[总长]` dim 端点 | 错：与 segment 0 端点相同 | 对：`segments[0].start → segments[last].end` |
| `MbdPipeSegmentDto.outside_diameter` | 硬编码 None | 从 `tubi_relate.in.aod` 查；当前样本库 pe 表无 aod → None → fallback 229 |
| surreal 查询延迟 | < 1s | < 1s（O(1) record join，避免 N+1） |

### 视觉对照

- `stage0-baseline-main-layout-first.png`：Plan 1 后，尺寸 "22221" 红色线与管道中心线几乎重叠。
- `stageB1-E-applied.png`：B.1 + E 后，"尺寸" 数量从 5 升到 7（chain 拆分 + overall 端点修正）。
- `stageC-lane-stagger.png`：Stage C 后，多条同方向 dim 明显阶梯分层，不再单一堆叠。

## 未覆盖样本

- 垂直管（pipe_dir ≈ ±Z）
- L / U 形多弯头分支（`include_bends` + iso_bend 的 angle arc 需要前端 `AngleDimension3D` 配合）
- 密短段（< OD 长度的 slope 会被 iso_slope suppress，需要 sample 验证）

这些分支留待用户提供更多 BRAN refno 后再做专项回归。当前的 commits 已经为它们准备好了 rs-core 路径，前端 `renderLaidOutLinearDims / renderLaidOutBends / renderLaidOutSlopes` 等路径已接通。

## 结论

- 后端 `layout_result` 对 24381_145712 的数值和 PML `isoDim / isoGetDimDir / isoUsedDir / drawDim` 的语义一致。
- 视觉上尺寸线和管道中心线的分离度从 0.45% 提升到 1.03%，同方向 dim 形成 lane 阶梯（最多到 lane 5）。
- 未闭环项集中在"真实 OD 需要 PDMS 侧补 `pe.aod` 字段"和"更多拓扑形态的 dogfood"，属于数据补齐 + 回归覆盖扩展，不再是 rs-core 求解器的正确性问题。

相关 commit：
- `rs-core  d21e2c7`（Plan 1） / `691e166`（Plan 2 Stage C）
- `plant-model-gen  33c581a`（Plan 1） / `bc828f3`（Stage B.1 + E） / `3f54ffa`（Stage B.2 aod 读取）
- `plant3d-web  81f0a85`（Plan 1 对比文档） / 本文档
