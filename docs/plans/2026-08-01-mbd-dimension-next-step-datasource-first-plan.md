# MBD 三维尺寸标注下一步开发计划：数据源优先（以 BRAN 24381_145018 验收）

日期：2026-08-01
性质：跨仓开发计划（rs-core 数据源 · rs-mbd 算法/契约 · plant-web-server 宿主 · 本仓呈现层）
前序：`docs/plans/2026-07-29-mbd-dimension-annotation-capability-audit.md` · `docs/plans/2026-07-30-mbd-dimension-annotation-audit-followup.md` · `rs-mbd/docs/plans/2026-07-next-migration-datasource-first.md`
验收样本：BRAN `24381_145018`（dbno 7997，项目 AvevaMarineSample）

## 0. 为什么是这份计划

7-29 能力审核与 7-30 复核已把结论钉死：**呈现层架构性就绪、端到端尚不满足，差距重心在上游**。7-30 又落地了 5 处呈现层修复（断线让字 N1、拒收理由可定位、"本分支标注不完整"警示条、空标签不占避让 N5、屏幕尺度箭头、文字朝向通道），并明确写下"本仓这一侧能做的已经做完"。

因此下一步的重心不在前端，而在**让真实 BRAN 能算出、送进来完整尺寸**。而在 rs-mbd 算法之前，还横着一个更靠前的阻塞：**数据源给的是"管跨视图"，rs-mbd/PML 要的是"成员结点视图"**。这份计划就是把这条链路按正确顺序打通，并用 `24381_145018` 做端到端验收。

## 1. 现状锚点（已核实的事实，不重复论证）

| 层 | 状态 | 证据 |
| --- | --- | --- |
| 前端尺寸系统 `src/dimension` | ✅ 生产级、双通道全接、MBD 单测 29/29、`src/dimension`+sync 250 用例全绿（7-30） | 本仓 ADR 0041/0043/0046/0048；7-30 §3.7 |
| 实时通道 `/api/mbd/v2/pipe/{refno}` | ✅ 真实链路（非占位）：`fetch_branch_segments`→`pipeline_segments_to_branch_query`→`rs_mbd::layout_branch`；至少 1 条 `LinearDim` 否则 422 | `plant-web-server/src/standalone_runtime.rs::mbd_v2_pipe_route`；7-30 §1（作废 G4） |
| rs-mbd 求解器 | ⚠️ 仅线性 MVP（member/chain/small_dim/suppress），方向为朴素叉乘 `deterministic_normal`；weld/slope/角度/Polar/调整焊/label 避让/PCOM/tee-olet 未做 | `rs-mbd/docs/ROADMAP.md` Phase 2；`rs-mbd/crates/rs-mbd/src/layout.rs` |
| 数据源 | ⛔ `fetch_branch_segments` 给"管跨(span)视图"，弯头不作独立 `adir≠ldir` 成员出现 → `split_isolines` 切不了弯 | `rs-mbd/docs/plans/2026-07-next-migration-datasource-first.md` §三 |
| `24381_145018` 真实数据 | ⛔ 当前 AMS 7997 库里是"空壳分支"：仅 1 条跨分支 `tubi_relate` 边、`pbs_owner` 直接子成员=0 → 只产出 1 条退化 `linear_dim`（text `8434.219`，`allarr=[["Head","24381_145018","Tail"]]`） | `rs-mbd/fixtures/golden/24381_145018.json`；迁移计划 §二 Stage A |
| 离线 parquet 通道 | ⛔ 磁盘无 `p_7997_mbd_dimensions.parquet`，且仅覆盖线性列（ADR 0043 已声明代价） | 全盘检索无该文件；7-29 G5 |

**一句话现状**：今天用 `mbd_refno=24381_145018` 打通到底，最多只能看到那 1 条横跨整条分支的退化尺寸线；这不是渲染 bug，而是数据源没有给出该分支的成员。

## 2. 目标（Done 定义）

以 `24381_145018` 为验收样本，把它从"1 条退化尺寸"推进到"逐段（含弯头切段）真实线性尺寸端到端可见"，并冻结第一条**真实** BRAN 金样：

1. rs-core 能对一条真实 BRAN 给出成员结点视图（`{noun, adir, ldir, apos, lpos, pos}`，弯头天然 `adir≠ldir`）。
2. rs-mbd `split_isolines` 在该真实分支上切出弯 + chain，`layout_branch` 产出 >1 条逐段 `linear_dim`（不再是 Head/Tail 退化条）。
3. `plant-web-server /api/mbd/v2/pipe/24381_145018` 返回多段真实 primitives（HTTP 200，含多条 `linear_dim`）。
4. `plant3d-web` 以 `mbd_refno=24381_145018` 打开普通三维页面，尺寸随相机旋转/缩放跟随真实锚点，"本分支标注不完整"警示条如实反映 `layout_mode`。
5. 该分支求解结果 JSON 冻结为 CLI 回归基线（rs-mbd ADR-0005），替换当前退化金样。
6. 一次真实 BRAN 视觉审阅：裁决 G9（坡度符号形状）并复核 7-30 的 4 处呈现改动实际观感。

> 若查库确认 `24381_145018` 在源模型中本就无子成员（真空壳，而非库未灌全），则目标 3–6 改挂到"经步骤 1 确认的第一条成员完整 BRAN"，并在计划里显式记录 `24381_145018` 的真实结构裁决——不为让它出图而在前端造假成员（GOAL.md 禁止项）。

## 3. 分阶段任务

### 阶段 A [阻塞·数据] 确定一份成员完整的真实管线库
- 确定哪份 SurrealDB 数据/`DbOption` 对某条真实 BRAN 灌好了完整成员（候选：`aps250160-mbd-multibran` 对应实例，或一个"确定有完整成员"的 refno + DbOption）。
- 对 `24381_145018` 直接查库核实：`{bran}.children`（PREV/NEXT 链）究竟有没有 TUBI/ELBO/BEND/ATTA 子件；区分"源模型空壳"与"库未灌全"。
- 验收：能点名一条 BRAN，其成员结点数 >1 且各成员带可解析方向。

### 阶段 B [rs-core] 新增 `fetch_branch_members`（getbranmems 等价，做法 A）
- 以 `{bran}.children` 成序（PREV/NEXT，复用已有 `get_next_prev`）为迭代基准，每个子件产出 `{noun, arrive_axis(adir), leave_axis(ldir), start(apos), end(lpos), pos}`，与 rs-mbd `BranchMember` 一一对上。
- 放宽方向兜底：主端口缺失时允许从相邻成员/几何推方向，而不是让 `core_adapter` 对 `world_dir=None/!reliable` 直接判 issue → 宿主 422。
- 备选做法 B（改动小、语义仍是"跨+补点"）：在现有 `fetch_branch_segments` 上把 ELBO/BEND/ATTA 也作为独立成员补进并各带方向。默认走做法 A。
- 验收：对阶段 A 选定分支返回成员结点序列，弯头成员 `adir≠ldir`。

### 阶段 C [rs-mbd + 宿主] 真实多成员分支验证 + 冻结金样
- `core_adapter::pipeline_segments_to_branch_query`（或新增 members 入口）消费成员结点视图。
- 用真实分支验证 `split_isolines` 切弯 + chain；`layout_branch` 产出多段 `linear_dim`。
- 宿主 `/api/mbd/v2/pipe/{refno}` 对该分支返回多段 primitives；冻结第一条真实金样为 CLI 基线（替换退化的 `24381_145018.json`，基线变更显式审阅，ADR-0005）。
- 参考就绪性证据：`fixtures/p2-linear-dimensions.json::linear-elbow-two-isolines`（L 形 90° 弯 → 2 段、方向各异、0 issue）已证明"喂对数据 rs-mbd 就能切段"。

### 阶段 D [rs-mbd 算法] 按 PML 逐能力补全（数据到位后才进）
顺序：方向系统（`isoFindIsoUsedDir`/`isoGetBestDir`/`isoGetDimDir` 替换 `deterministic_normal`）→ 坡度（`getSlopes`+`dimslope`）→ 角度（`getinstallationangles`+`drawangle`）→ Polar 邻段 → 调整焊（`getadjustwelds`）→ label 避让（材料/位号作障碍）→ PCOM / tee-olet 切段。

### 阶段 E [rs-mbd 契约] 补齐前端已就绪通道所等的字段
7-30 已在前端把通道备好，缺的只是契约字段：
1. **文字朝向**：PML `ori` → 设计空间基线方向，喂 `label`/`aid_text`/`slope_mark`（前端 `labelAlong`/`along` 已就绪，给了即用）。
2. **类别覆盖声明**：显式声明"本次交付覆盖哪些图元类别"，让前端硬编码 `PARTIAL_LAYOUT_MODES=['linear_mvp']` 退休，解锁 D1 第二步（允许降级显示而非整包拒收）。
3. **角度/弧几何**（7-29 G1）：`angle_dim`/`aid_arc`/`aid_circle` 的几何字段（AIDARC 的 pos/ori/radius/stangle/sweepAngle 与本仓 `ExplicitArcInput` 1:1），补齐后映射函数直接扩展。

## 4. 验证矩阵

```powershell
# rs-mbd 侧就绪性（离线，无需库）
cargo run -p rs-mbd-cli -- layout --fixture fixtures/p2-linear-dimensions.json --case linear-elbow-two-isolines --data-only
cargo run -p rs-mbd --example verify_mapping        # 5/5 mapping==direct

# 阶段 A/B 查库与成员视图（需灌好的 SurrealDB）
#   plant-web-server --repo-root ../plant-model-gen --config db_options/DbOption-<populated>
curl http://localhost:3100/api/mbd/v2/pipe/24381_145018   # 期望：多段 linear_dim，非 Head/Tail 退化

# 前端回归（本仓，离线）
npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts   # 基线 250 全绿
npm run type-check

# 端到端（真实浏览器）
#   dev server + 上述 plant-web-server + SurrealDB，URL: ?output_project=AvevaMarineSample&show_dbnum=7997&show_refno=24381_145018&mbd_refno=24381_145018&data_source=backend&backendPort=3100
```

## 5. 风险与取舍

- **R1 24381_145018 可能是真空壳**：若源模型确实无子成员，它不是有效的多段验收样本。缓解：阶段 A 先查库裁决；必要时改挂第一条成员完整 BRAN，并显式记录裁决。禁止前端造假成员兜底（GOAL.md）。
- **R2 方向兜底放宽引入错误方向**：放宽后 rs-mbd 可能对不可靠方向产出错误尺寸。缓解：兜底方向标 `reliable=false` 并进 issue，金样人工审阅把关。
- **R3 金样漂移**：真实金样一旦冻结，rs-mbd 算法迭代会改变坐标。缓解：ADR-0005 基线变更显式审阅，用"布局容差"（≤1mm / ≤0.1°）判定语义对齐而非像素复刻。
- **R4 跨仓协作顺序**：阶段 B/C 在 rs-core/rs-mbd，阶段 E 在 rs-mbd 契约；前端仅在契约字段到位后扩展映射。需按 A→B→C→(D‖E) 推进，D 与 E 数据到位后可并行。

## 6. 相关文档
- 本仓：ADR 0028/0041/0042/0043/0044/0046/0048；`docs/plans/2026-07-29-mbd-dimension-annotation-capability-audit.md`、`docs/plans/2026-07-30-mbd-dimension-annotation-audit-followup.md`
- rs-mbd：`docs/ROADMAP.md`、`CONTEXT.md`、`docs/plans/2026-07-next-migration-datasource-first.md`、`docs/adr/0005-acceptance-fixtures-golden-batch.md`、`fixtures/golden/24381_145018.json`
- 需求事实源：`rs-core/MBD/markpipe/object/isobran.pmlobj`（`getbranmems`/`getisolines`）、`isoline.pmlobj`、`isoori.pmlobj`
