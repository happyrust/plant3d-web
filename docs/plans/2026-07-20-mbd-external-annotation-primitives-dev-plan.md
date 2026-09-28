# MBD 外部标注图元开发计划

日期：2026-07-20
状态：共识已确认（grill-with-docs 会话，7 项决策），待批准后实施
目标：让尺寸标注系统满足 `rs-core/MBD`（即 `rs-mbd` 冻结的 `MbdV2PipeData` 契约）的尺寸标注渲染需求

## 1. 背景

差距分析结论：当前尺寸系统的架构位置正确（只读外部源 + 显式几何 1:1 渲染），但 MBD V2 契约的 11 种图元只接通了 LinearDim 一种；渲染内核缺少弧/圆/点原语与逐图元线型；数据通道只有按 `show_dbnum` 的离线 parquet（仅线性尺寸）；`MbdV2PipeData.meta/issues` 没有 UI。

后端排版智能（方向决策、lane 分配、PolarSystem 避让、小尺寸错层）属于 `rs-mbd` 职责，本计划**不**复刻。

## 2. 已确认决策

| # | 决策 | 结论 | 沉淀 |
| --- | --- | --- | --- |
| 1 | 交付边界 | 前端为主 + 契约先行：按冻结的 `contract.rs` 用 fixture 驱动开发，不依赖 rs-mbd 算法进度，预留联调里程碑 | 本文 |
| 2 | 领域边界 | 11 种图元共用尺寸呈现内核；术语区分「外部尺寸」（LinearDim/AngleDim）与「外部标注图元」（其余 9 种，只读、不进尺寸文档） | ADR 0041、CONTEXT.md |
| 3 | 内核扩展 | 只新增弧、点两种原生原语 + 逐图元线型（solid/dashed/dash_dot）；焊缝/坡度符号由适配层拼装；多行标签拆行 | ADR 0042 |
| 4 | 数据通道 | 契约 JSON 唯一适配入口：API 按 refno 为主通道，parquet 装载后转契约形状同入口，`MbdDimensionDto` 退役 | ADR 0043 |
| 5 | 文字尺度 | 首版屏幕像素字高，cheight 信息保留不丢；世界字高模式为后置可选项 | ADR 0044 |
| 6 | 诊断呈现 | 尺寸面板内「MBD 诊断」折叠区（按 severity 分组、refno 可定位），仅 error 弹一次 toast | 本文 |
| 7 | 里程碑切分 | 内核先行：M1 原语 → M2 适配 → M3 通道 → M4 UI → M5 联调；每个里程碑独立可验收 | 本文 |

## 3. 范围

**范围内**：呈现内核原语扩展、11 种图元契约适配、实时 API + parquet 双通道（单一契约入口）、面板分组与诊断 UI、真实样本联调验收。

**范围外**：rs-mbd 算法移植与排期；PolarSystem/避让/lane 等排版算法；世界字高模式（后置）；parquet 导出侧补齐非线性图元列（上游仓工作，仅记录依赖）；用户创建/编辑 MBD 图元（永远只读，ADR 0028）。

## 4. 里程碑

### M1 内核原语（约 3–4 人日，无上游依赖）

新增弧原语（设计空间定义 center/normal/radius/起止角，整圆为闭合弧）与点标记原语，显式图元支持逐图元线型。弧在布局阶段投影为**单条屏幕路径**（透视下自适应细分为一条 Path，保证虚线沿整条路径连续；近平行视角可退化为 canvas `ellipse`/SVG arc 命令），命中区域按分段容差生成。

涉及文件：

- `src/dimension/kernel/types.ts` — 原语与线型类型、`ExplicitLayoutInput` 扩展
- `src/dimension/kernel/geometry/`（新增弧投影/细分 helper）
- `src/dimension/kernel/layout/explicit.ts` — 显式布局扩展
- `src/dimension/viewport/canvasPainter.ts` — 弧/点/线型绘制（每弧一个 Path2D + `setLineDash`）
- `src/dimension/export/svgOverlay.ts` — SVG path 弧命令 + dash 输出
- `src/dimension/kernel/hit/hitIndex.ts`、`hitTest` — 弧/点命中
- `src/dimension/kernel/goldens.test.ts` + 新 golden fixture

验收：golden 覆盖弧/整圆/点/三种线型；SVG 快照含弧命令且虚线连续；命中测试通过；现有 38 项尺寸测试不回归。

### M2 契约适配层（约 3 人日，依赖 M1）

TS 侧 1:1 复刻冻结契约，把 11 种图元映射为外部记录，注册表按「外部尺寸 / 外部标注图元」两类分组。

涉及文件：

- `src/dimension/adapters/mbdV2Contract.ts`（新）— `MbdV2PipeData`/`MbdPrimitive` 类型，与 `rs-mbd/crates/rs-mbd/src/contract.rs` 字段一致
- `src/dimension/adapters/mbdV2ExternalAnnotations.ts`（新）— 图元 → `ExternalDimensionRecord` 映射；多行 label 拆行；WeldMark（shop/field）/SlopeMark 用弧+线+点+文字拼装；逐条 skipped 诊断
- `src/dimension/services/externalDimensionRegistry.ts` — 记录类别字段与分组快照
- `src/fixtures/mbd-v2/*.json` — 由 `cargo run -p rs-mbd-cli -- layout --case …` 导出的契约 fixture

约束：AngleDim/AidArc/AidCircle 上游字段未定型，按当前占位契约实现并在代码中标注契约版本；字段补齐后只改映射层。契约测试直接加载 rs-mbd 导出 JSON，上游契约漂移第一时间在前端测试暴露（ADR 0043）。

验收：fixture 驱动的全图元映射测试；重复 id、无效几何、未知 kind 的诊断路径测试。

### M3 数据通道（约 2 人日，依赖 M2）

- `src/api/mbdV2Api.ts`（新）— `GET /api/mbd/v2/pipe/{refno}`（plant-web-server，经 `buildBackendUrl`）
- `src/composables/useDbnoInstancesParquetLoader.ts` — parquet 行 → 契约形状转换，`MbdDimensionDto` 标记废弃
- `src/components/dock_panels/ViewerPanel.vue` — `syncMbdExternalDimensions` 重构：按 `mbd_refno`（API）/`show_dbnum`（parquet）选择通道，统一进适配层；保持现有 forceRefresh 与生命周期竞态保护

验收：CLI/浏览器真实数据冒烟（记录命令与返回）；parquet 线性尺寸路径回归不破。

### M4 面板与诊断 UI（约 2 人日，依赖 M2，可与 M3 并行）

- `src/dimension/ui/DimensionSemanticList.vue`、`DimensionPanelDock.vue` — 外部标注图元单独分组（选择/隐藏沿用注册表能力）；「MBD 诊断」折叠区按 severity 分组，带 refno 条目点击定位构件；仅 error 弹一次 toast
- `src/dimension/ui/dimensionBoundActions.ts` — 标注图元类目的动作集（select/hide-external）

验收：组件测试覆盖分组、诊断区渲染与定位动作。

### M5 联调验收（约 2–3 人日 + 联调窗口，依赖 M3/M4 与 rs-mbd 产出）

- 真实样本联调：AvevaMarineSample `mbd_refno=24381_145712` 为主样本，另取现网 BRAN 样本 ≥3 条
- 截图对比记录到 `docs/verification/`（含每种图元至少一例）
- 性能回归：外部图元计入 ADR 0040 的 2000 条可见预算，扩展 `scripts/run-dimension-browser-perf.mjs` 场景
- issues 语义抽查：与 PML wronglines 对照

验收：验证文档 + 截图 + 性能数据入库；`npm run type-check`、`npm run lint`、`npm test` 全绿。

## 5. 后置项

- 世界字高渲染模式（ADR 0044，PDMS 1:1 视觉验收时实现）
- 焊缝/坡度符号视觉精修（对照 PDMS 出图）
- parquet 导出侧补齐非线性图元列（上游仓）

## 6. 风险

| 风险 | 缓解 |
| --- | --- |
| 上游 AngleDim/AidArc/AidCircle 字段未定型 | 占位契约实现 + 契约版本标注；M5 前与 rs-mbd 同步一次契约 |
| rs-mbd Phase 0 算法未完成，M5 无真实数据 | M1–M4 全部 fixture 驱动，不阻塞；M5 时间随上游浮动 |
| 弧透视投影视觉正确性 | golden + 自适应细分阈值测试 + M5 截图验收 |
| `ExplicitLayoutInput` 扩展影响既有 bran-clearance/MBD 线性路径 | 字段全部可选、向后兼容；回归清单含 `mbdExternalDimensions`、`branExternalDimensions`、`dimensionViewport`、`createDimensionSystem` 测试 |

## 7. 验证命令

```bash
npx vitest run \
  src/dimension/kernel/goldens.test.ts \
  src/dimension/adapters/mbdV2ExternalAnnotations.test.ts \
  src/dimension/adapters/mbdExternalDimensions.test.ts \
  src/dimension/adapters/branExternalDimensions.test.ts \
  src/dimension/services/externalDimensionRegistry.test.ts \
  src/dimension/viewport/dimensionViewport.test.ts \
  src/dimension/facade/createDimensionSystem.test.ts
npm run type-check
```

## 8. 相关文档

- 差距分析与 API 说明：`docs/guides/3D_DIMENSION_ANNOTATION_API.md`
- 领域边界：`docs/plans/2026-07-19-dimension-annotation-system-migration-design.md` 第 2 节
- 决策：ADR 0041–0044；术语：`CONTEXT.md`（外部尺寸 / 外部标注图元）
- 上游契约：`rs-mbd/crates/rs-mbd/src/contract.rs`；算法背景：`rs-core/MBD/开发文档/BRAN尺寸标注算法全景文档.md`
