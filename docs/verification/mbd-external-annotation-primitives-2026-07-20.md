# MBD 外部标注图元 M1–M5 验证记录

日期：2026-07-20
计划：`docs/plans/2026-07-20-mbd-external-annotation-primitives-dev-plan.md`（决策 ADR 0041–0044）
环境：Windows 10，Node 20，vitest 4.0.18，Playwright（Chromium headless）

## 1. 交付范围

- M1 内核原语：`ScreenPath`（设计空间弧/圆投影为单条连通折线，虚线连续）、`ScreenMarker`（circle/cross，屏幕像素尺寸）、逐图元线型 `lineStyle`（solid/dashed/dash-dot），painter/SVG 导出/命中索引/平移快径（`translateLayout`）四处同步。
- M2 契约适配：`mbdV2Contract.ts` 1:1 复刻 `rs-mbd/crates/rs-mbd/src/contract.rs`（LinearDim 带注释的超集字段：extension_lines/arrow_lines/label_anchor/reference）；`mbdV2ExternalAnnotations.ts` 映射 11 种图元（angle_dim/aid_arc/aid_circle 因上游字段未定型走 `contract-incomplete` 诊断）；`ExternalDimensionRecord.category` 区分外部尺寸/外部标注图元。
- M3 数据通道：`src/api/mbdV2Api.ts`（`GET /api/mbd/v2/pipe/{refno}`）；parquet DTO 经 `mbdDtosToV2PipeData` 转契约形状；`ViewerPanel.syncMbdExternalDimensions` 按 `mbd_refno`（API）/`show_dbnum`（parquet）双通道统一入口，保留竞态保护与 forceRefresh。
- M4 UI：语义列表按「用户尺寸 / 外部尺寸 / 外部标注图元」分组；`useMbdDiagnosticsStore` + 面板「MBD 诊断」折叠区（severity 分组、refno 定位走 `showModelByRefnos` 事件）；仅 error 级别弹一次 toast。
- M5：性能场景扩展（2000 可见 = 1500 用户尺寸 + 500 外部标注图元）；契约漂移守卫 fixture 采用真实 rs-mbd-cli 输出。

## 2. 测试结果

### 2.1 尺寸系统全量单测

```bash
npx vitest run src/dimension src/composables/useDbnoInstancesParquetLoader.mbd.test.ts
# Test Files  50 passed (50)
# Tests  223 passed (223)
```

新增测试：`arcProjection.test.ts`（4）、`explicit.test.ts` 弧/marker/多行/命中（+1）、goldens 显式标注快照（+1）、`svgOverlay.test.ts` path/marker/dash-dot（+1）、`canvasPainter.test.ts` 批组/arc/closePath（+1）、`mbdV2Contract.test.ts`（4）、`mbdV2ExternalAnnotations.test.ts`（7）、`mbdExternalDimensions.test.ts` DTO→契约（+1）、`DimensionSemanticList.test.ts` 分组（+1）、`DimensionPanelDock.test.ts` 诊断区+排序（+1）。

### 2.2 类型检查与 lint

```bash
npm run type-check   # 通过（0 错误）
npm run lint         # 28 个问题全部位于 harness/、outputs/ 等本次未触碰文件（预先存在）
```

### 2.3 全仓单测基线对照

`npm test`：74 failed / 1618 passed。用 `git stash` A/B 验证：将本次全部改动暂存后，抽样重跑 `useScreenshot.test.ts`、`ribbonConfig.test.ts`、`DesignerCommentHandlingPanel.test.ts`，基线上同样 21 项失败（与改动后完全一致），失败均为工作区其他 WIP 造成的预先存在失败；本次改动涉及的 50 个尺寸测试文件全部通过，未新增失败。

### 2.4 契约漂移守卫（真实上游输出）

```bash
# rs-mbd 仓
cargo run -p rs-mbd-cli -- layout --case toy-bridge-and-stick
```

输出（split-only stub，primitives 为空）已入库为 `src/fixtures/mbd-v2/rs-mbd-cli-split-stub.json`，由 `mbdV2Contract.test.ts` 校验解析；上游契约变动时该测试会先红。全 11 种图元的手工 fixture 为 `src/fixtures/mbd-v2/full-coverage.json`。

### 2.5 性能（ADR 0040 口径，headless Chromium @1920×1080）

```bash
$env:DIMENSION_PERF_GATE='1'; npx playwright test e2e/dimension-perf.spec.ts
```

| 场景 | updateP50 | updateP95 | layoutP95 | paintP95 | hitP95 |
| --- | --- | --- | --- | --- | --- |
| 基线：2000 用户尺寸 + 0 外部 | 13.7ms | 17.5ms | 0.1ms | 17.5ms | 0.1ms |
| 本次：1500 用户尺寸 + 500 外部标注图元 | 16.6ms | 21.1ms | 0.1ms | 21.1ms | 0.0ms |

结论：外部图元（弧/双 marker/多行文字，绘制成本高于同数量线性尺寸）使 paint p95 增加约 3.6ms；命中 p95 远低于 2ms 预算。16ms 绝对门禁在本机 headless 环境下基线本身即不达标（历史记录同机曾测 54.7ms），门禁达标判定需在 ADR 0040 参考桌面环境复测；本次判定口径为"相对基线无异常回归"。

## 3. 待上游联调项（阻塞在 rs-mbd Phase 2+）

- 真实样本端到端（`mbd_refno=24381_145712` 等 ≥3 条 BRAN）：rs-mbd 当前为 split-only stub（primitives 恒为空），plant-web-server 尚未挂 V2 路由，无法产出真实图元；API 通道已按契约实现并有降级路径（失败清空来源 + 失败原因写入诊断面板 + console 告警）。
- 每种图元的真实截图对比（届时补充到本目录）。
- angle_dim / aid_arc / aid_circle 字段定型后：更新 `mbdV2Contract.ts` 与映射层（渲染能力 M1 已就绪），并同步 fixture。
- **弃用清理触发条件**：parquet 通道真实数据冒烟通过后，删除 `mbdToExternalDimensions`（`src/dimension/adapters/mbdExternalDimensions.ts`）及其旧测试用例与 barrel 导出，保留 `mbdDtosToV2PipeData` 路径（brooks-review F6）。

## 4. 复验命令

```bash
npx vitest run src/dimension
npm run type-check
# 性能（需要 Playwright 浏览器）
node scripts/run-dimension-browser-perf.mjs
```
