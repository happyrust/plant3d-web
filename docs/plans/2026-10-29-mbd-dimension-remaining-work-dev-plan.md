# MBD 三维尺寸标注：剩余工作开发计划（2026-10-29）

- 性质：开发计划（现行）。**本文件只是计划，不改代码。**
- 取代关系：合并 [`2026-10-28-mbd-3d-dimension-annotation-audit-and-plan.md`](2026-10-28-mbd-3d-dimension-annotation-audit-and-plan.md)（下称「审计计划」）与 [`2026-10-29-mbd-dimension-robustness-dev-plan.md`](2026-10-29-mbd-dimension-robustness-dev-plan.md)（下称「健壮性计划」）的**剩余工作**；两份旧文件已冻结为审计结论 + 执行日志，状态表见审计计划 §12.4，门禁数字只记审计计划 §14。
- 对照口径：plant3d-web `12f4bb1e`（T7.6 入库后）、`vendor/plant-mbd` `63d566e`、gen-model `src/mbd` `1caf3a84`；任务编号沿用审计计划 §7（T0–T6）、§13.2（T3.3a–T3.6）、§13.3（T5.x）与 §13.10（T7.x），本文只给工作包编号 W0–W5。
- 2026-10-29 已拍板的四条裁决见 §5 D1–D4；待拍板的 D5–D7 在对应工作包动手前定。

## 0. 一句话

已完成的部分（前端呈现层重构、契约容错、angle_dim 产出、polar 数值层与参考系层）不再动；剩下的是 **polar 接入（T3.4–T3.6）、求解器五件（T5.3–T5.7）、契约扩展六项（原 T4.1–T4.6）、量化与 e2e 覆盖（T0.3 / D1 / E3）、视觉裁决（T6.1–T6.5）**，外加一个很小的收口包 W0。按 W0 → W1 ∥ W2 前三件 ∥ W4 → W2 后两件 ∥ W3 → W5 的顺序推进。

## 1. 现状与依据（只列与剩余工作直接相关的事实）

| # | 事实 | 证据 |
| --- | --- | --- |
| F1 | polar 数值层 19 个文件（`kernel/layout/polar/numeric/**`）与参考系层 3 个文件（`polar/reference/{types,isoSheet,camera}.ts`）已入库，**目录外零消费者**，`kernel/index.ts` 未导出 polar | 审计计划 §12.7 / §13.11 / §13.14；提交 5c7ee980、3f298e7c |
| F2 | `mbd_polar` 在 `src/` 全源码零命中；`layoutViewport.ts:47-108` 的 pass 序列里没有 polar | 2026-10-29 grep |
| F3 | 求解器停在 `63d566e`：`angle.rs` 已产出（0b89b76）、`PPoint.bore` 已透传（gen-model 1caf3a84）；`IssueCategory::Avoidance` 零产出、`split_isolines.rs:242-248` 仍输出 `PCOM not implemented`、`weld.rs` 无 `plus` | 审计计划 §13.3 |
| F4 | 原 T4.1–T4.6 契约扩展一项未动：`meta.coverage` 在 adapters 零命中；`PARTIAL_LAYOUT_MODES = ['linear_mvp', 'isodim_main']` 的兜底仍在 `DimensionPanelDock.vue` | 审计计划 §12.1 的 T2.2 行、§12.4 |
| F5 | 契约已按 ADR 0055 D7 走通过一次完整三步（`AidText.text_height_mm`：前端 1a40b46a → plant-mbd 63d566e），流程可复用 | 审计计划 §13.10 |
| F6 | 性能：`docs/verification/` 下没有任何 MBD 规模实测；`e2e/dimension-perf.spec.ts` 默认 skip | 审计计划 §5.1 |
| F7 | 健壮性计划只剩 D1（layoutMs 量化）与 E3（`e2e/mbd-robustness.spec.ts`） | 健壮性计划 §9 第四轮 |
| F8 | T7.6（LOD 阈值拆分 + 退化四边形回退，12f4bb1e）与 T3.3b/c（3f298e7c）入库时都没有门禁数字；当前 HEAD 的真实 vitest 数字未知 | 审计计划 §14 第 10–13 行 |
| F9 | 2026-10-29 对齐期间工作区正有另一路在改 polar 目录（非本计划产物，未登记、未提交）：`polar/numeric/{arc.ts, arc.test.ts}`（新）、`polar/numeric/{index.ts, isoDirections.ts, isoDirections.test.ts}` 与 `polar/reference/{types.ts, isoSheet.ts, isoSheet.test.ts, camera.ts, camera.test.ts}`（改）；观察期间文件集还在增长 | `git status`（2026-10-29 两次快照） |

## 2. 目标与完成定义

1. `?mbd_polar=1` 打开时，MBD 记录走 polar 布局（2D 模式与 PML 原 case 逐值一致；3D 模式无 NaN、无越界、屏幕校验后不重叠）；默认关闭，关掉即现状。
2. plant-mbd 对 T5.3–T5.7 各有一份被审阅重录的金样差异记录；`cargo test --workspace`、`cargo fmt --check`、`golden diff` 全绿。
3. 原 T4.1–T4.6 六项契约字段每项都走完「前端可选 → mirror → producer」三步，`contract_guard` 回环通过；`PARTIAL_LAYOUT_MODES` 兜底随 `meta.coverage` 退休。
4. `docs/verification/` 下有 500 / 2k 规模的 `layoutMs` / `paintMs` P50 / P95 记录；`e2e/mbd-robustness.spec.ts` 在 novideo 配置下绿。
5. T6.1–T6.5 各有落地记录或明确的「不做」裁决（进 ADR）。
6. 每个工作包落地后在审计计划 §14 追加一行门禁数字；`npm run type-check` 始终新增 0 / 已消失 0。

## 3. 阶段与依赖

```
W0 收口与基线（小，先做）
 │
 ├─ W1 polar 接入：W1-1 T3.4 → W1-2 T3.5 → W1-3 T3.6
 │     │
 │     └─ W2-4 T5.3 occupancy（吃 W1-1 的算法口径）→ W2-5 T5.7
 ├─ W2 求解器：W2-1 T5.5 ∥ W2-2 T5.6 ∥ W2-3 T5.4（与 W1 并行，不同仓）
 ├─ W3 契约扩展：W3-1 T4.1 coverage → W3-2 T4.5 source_version → W3-3 T4.2 cheight_mm → W3-4 T4.3 ori → W3-5 T4.4 object_refno → W3-6 T4.6 isoline 列表（与 W1 并行；W1-3 不依赖 W3）
 ├─ W4 量化与覆盖：W4-1 T0.3 + D1（早做，W5-5 的前提）；W4-2 E3
 └─ W5 视觉裁决：W5-1 T6.1 → W5-2 T6.4 → W5-3 T6.2 ∥ W5-4 T6.3 → W5-5 T6.5（依赖 W4-1）
```

| 工作包 | 仓 | 可并行 | 前置 |
| --- | --- | --- | --- |
| W0 | plant3d-web | — | 无 |
| W1 | plant3d-web | 内部串行 | W0-4（arc.ts 归属定了再动 polar 目录） |
| W2 | plant-mbd（+ gen-model 仅 T5.3 若需宿主字段） | W2-1 / W2-2 / W2-3 互相并行、与 W1 并行 | W2-4 需 W1-1 |
| W3 | plant3d-web → plant-mbd → gen-model | 每项内部三步串行；项与项可并行 | 无 |
| W4 | plant3d-web | 两项并行 | 无 |
| W5 | plant3d-web | 见图 | W5-5 需 W4-1 |

## 4. 工作包

### W0 收口与基线（无功能代码）

| ID | 内容 | 验收 |
| --- | --- | --- |
| W0-1 | 在 HEAD 上跑一次 S2 全量 vitest + `npm run type-check`，把数字填进审计计划 §14 第 12 / 13 行（T7.6 与当前 HEAD） | §14 不再有「待跑」 |
| W0-2 | T7.6 的前后对比：固定相机下 `24381_145018` 远 / 中 / 近三档截图（基于 12f4bb1e 与其父提交各一组），落 `docs/verification/mbd-lod-declutter-2026-10-29/`；确认 `theme.test.ts` 钉住 `lodSecondaryMinPx = 0` / `lodDetailMinPx = 18` | 目录存在、含相机参数；钉子用例存在 |
| W0-3 | T3.3b / T3.3c 复核：对照审计计划 §13.12 逐条核 `orthogonal` 返 null 的兜底取法、反平行分支、`mainDimDir` 恒 `null`、`kind` 取值，结果补进 §13.14 | §13.14 的「补记的边界」段被实测结论替换 |
| W0-4 | 工作区卫生：等 F9 那路 polar 改动停下来后定归属——若是 T3.4 的前置（arc 工具 + 参考系接口调整）就作为 W1-1 的第一个提交并在审计计划 §13 记一行，否则单独登记；它改了 3f298e7c 刚入库的 `reference/*`，W0-3 的复核要对着改完的版本做；`.archify/` 已 ignore（89a5aeeb） | `git status --short` 只剩在做的工作包文件；§13 有该批次的行 |

### W1 polar 接入（T3.4 → T3.5 → T3.6）

| ID | 任务 | owned_paths | 验收 |
| --- | --- | --- | --- |
| W1-1 | **T3.4** `getBestPosAndOri` 14 步 + `balance` + `getDirAndCha` + `getResult`，参考系（`PolarReference`）注入；**`place()` 返回排序候选列表**（审计计划 §13.13 的关键依赖），不只返回单个最优；超 600 行按步骤拆文件 | `kernel/layout/polar/place.ts`（+ 拆出的子模块）+ `.test.ts` | 2D 模式（`isoSheetReference`）用 PML 原 case 逐值一致（含 §13.2 的 X1–X3 三处偏差处理）；3D 模式（`cameraReference`）无 NaN、无越界；不改 numeric / reference 目录的既有导出 |
| W1-2 | **T3.5** 屏幕校验层：投影 → 像素净空 → 按候选列表降级；`LabelOccupancy` 从 `resolveLabelCollisions.ts:64-131` 提取到 `kernel/collision/occupancy.ts`（原调用方改为引用，行为不变）；重叠判定复用 `convexQuadsOverlap` + T7.6 的 `quadBracketsLabel` | `kernel/layout/polar/screenGuard.ts` + `.test.ts`、`kernel/collision/occupancy.ts`、`kernel/collision/resolveLabelCollisions.ts` | 构造重叠 case 断言降级后不重叠；`resolveLabelCollisions` 既有用例与 goldens 快照 0 变动 |
| W1-3 | **T3.6** 接入：`ExplicitLayoutInput.polar`（纯数据）进 kernel 类型；`layoutViewport` 在 `authority='solver'` 且带 polar 输入时走 polar 布局；URL `mbd_polar=1` 读在 `useMbdExternalSync`（与 `mbd_3d` 同构，flag 不进 kernel）；`kernel/index.ts` 导出 polar barrel | `kernel/types.ts`、`kernel/viewport/layoutViewport.ts`、`adapters/mbdV2ExternalAnnotations.ts`、`composables/useMbdExternalSync.ts`、`kernel/index.ts` | 默认关闭时全部既有快照不变；打开时 `24381_145018` / `24383_91813` 固定相机 A/B 截图落 `docs/verification/`；D5 的开关默认值在此之后才讨论 |

### W2 求解器补全（plant-mbd，T5.3–T5.7）

每项的固定流程（审计计划 §13.7）：实现 → `cargo fmt` → `cargo test --workspace` → `golden diff` 逐条审阅 → 备份 → `golden record --force --note <原 note>` 逐份重录 → 再跑 `cargo test --workspace` 与 `golden diff` → 在 plant-mbd 单独提交，并在审计计划 §13 追加一行（文件、差异面、金样影响）。

| ID | 任务 | 依据 | 验收 |
| --- | --- | --- | --- |
| W2-1 | **T5.5** 调整焊附加串 ` +len`（`!plusstring = ' +' & string(!adjustlen)`） | PML `lindim.pmlobj:78-86`、`:322-359` | 含调整焊的 fixture 其 `linear_dim.text` 带 ` +len`；无调整焊的 6 份金样 `text` 不变 |
| W2-2 | **T5.6** PCOM 切管件 | `split_isolines.rs:242-248`、PML `isobran.pmlobj` | `"P1: PCOM not implemented"` issue 消失；新增含 PCOM 的 toy fixture |
| W2-3 | **T5.4** 小尺寸拆行的 `pluslen` 项 + `MIN_DIM_LENGTH_MM` 抑制复核 | `isodim.rs:1294-1391`、PML `lindim.pmlobj:370-463` | 短段不再一律 elide；`:1318` 的长度式含 pluslen |
| W2-4 | **T5.3** Polar 避让 `occupancy.rs`（算法口径以 W1-1 的 TS 实现为准，两边共用 PML 原 case 金样） | `layout.rs:302`、PML `polarsystem.pmlobj:1028-1296` | `IssueCategory::Avoidance` 开始产出；密集簇金样（`24383_91813`）差异逐条审阅 |
| W2-5 | **T5.7** 跨段让位的另一半 `addtopreornextpolarsystem`（pre/next 双向 + `angle>160 && dis<od*15` 三跳） | `isobran.pmlobj:3184-3235`；已实现一半见 `isodim.rs:507-546` | 相邻直段尺寸不互相压；依赖 W2-4 的 polarsystem 概念 |

### W3 契约扩展（原 T4.1–T4.6，后置；2026-10-29 裁决保留）

每项都按 ADR 0055 D7 三步：① 前端 `mbdV2Contract.ts` 接受可选字段 + 用例（fail-closed 不变）→ ② plant-mbd `contract.rs` mirror（`serde default` + `skip_serializing_if`）+ `contract_guard` 穷举补字段 → ③ producer 产出 + 金样重录。每步单独提交，顺序不可反（R2）。

| ID | 任务 | 消费方（给了就用） | 验收 |
| --- | --- | --- | --- |
| W3-1 | **T4.1** `meta.coverage: string[]`（本次交付覆盖的 kind） | `DimensionPanelDock.vue` 的不完整警示条改读 coverage，删 `PARTIAL_LAYOUT_MODES` 兜底 | 警示条按实际缺失显示；`PARTIAL_LAYOUT_MODES` 全仓零命中 |
| W3-2 | **T4.5** `meta.source_version { dbnum, sesno, databases }` | 面板显示数据时点；可与时间轴功能的版本口径对齐 | 面板可见；缺字段时不显示、不报错 |
| W3-3 | **T4.2** 逐 isoline 的 `cheight_mm`（`sepSmallDim` 缩字后的组字高） | 替代前端 11–18 px 夹取时的全局 `cheight_mm`；与 T7.1 的 `AidText.text_height_mm` 的关系按 D7 定 | 同一 BRAN 不同 isoline 字高可不同 |
| W3-4 | **T4.3** `label` / `aid_text` / `slope_mark` 的设计空间基线方向（PML `ori`） | 前端 `labelAlong` / `along` 通道 | 给了即用；未给时行为不变 |
| W3-5 | **T4.4** 每个 primitive 的 `object_refno` | 点尺寸跳构件不再解析 id 字符串 | 跳转用例 |
| W3-6 | **T4.6** 直段结构（`isoline` 列表：index、成员、字高、od） | 前端按直段分组 / 折叠 | 面板分组用例 |

### W4 量化与覆盖（T0.3 / D1 / E3）

| ID | 任务 | 验收 |
| --- | --- | --- |
| W4-1 | **T0.3 + D1 合并**：用 `src/debug/dimensionPerf.ts:179-206` 的 60 帧脚本与 `dimensionViewport.ts` 的 `onFrame` 指标，在 `24381_145018`（小）/ `24381_146979`（大）两条 BRAN 与一个 2k 记录合成场景上记录 `layoutMs` / `paintMs` 的 P50 / P95；**不改渲染逻辑** | `docs/verification/mbd-perf-baseline-2026-xx-xx/README.md` 含机器、相机、三次重复的数字；作为 W5-5 的基线 |
| W4-2 | **E3** `e2e/mbd-robustness.spec.ts`：`?mbd_refno` 指向含「未知 kind + 一条非法图元」的 mock 分支，断言 `?mbd_partial=1` 下仍有标注且角标可见、默认下整包拒绝且角标可见 | `npx playwright test --config=playwright.novideo.config.ts e2e/mbd-robustness.spec.ts` 绿 |

### W5 视觉裁决与收尾（T6.1–T6.5）

| ID | 任务 | 验收 |
| --- | --- | --- |
| W5-1 | **T6.1** 真实 BRAN 视觉审阅，裁决 G9（坡度符号：PML 三角形 vs Web 线 + 箭头） | 结论进 ADR；截图落 `docs/verification/` |
| W5-2 | **T6.4** QW4 固定相机截图基线（含相机参数），复用 `e2e/dimension-doc-screenshots` 生成器 | 基线归档，后续 W1-3 / W5-3 / W5-4 的 A/B 都对着它比 |
| W5-3 | **T6.2** Q5 短线阈值分级（0.5 / 0.8 / 1.5） | 本样本远景不变；中景多留一档 |
| W5-4 | **T6.3** Q6「文字在线上方」可选模式（仅单行 isoline） | 固定相机对比；不侵入相邻行 |
| W5-5 | **T6.5** 2k 记录分帧预算 | 相对 W4-1 基线 P95 不退化；`DIMENSION_PERF_GATE=1 npx playwright test e2e/dimension-perf.spec.ts` 通过 |

## 5. 决策

| # | 决策 | 状态 |
| --- | --- | --- |
| D1 | T7.6（LOD 阈值拆分 + 退化四边形回退）保留，登记为独立任务并单独提交（12f4bb1e），不并入健壮性计划 | **已定**（2026-10-29） |
| D2 | 原 T4.1–T4.6 契约扩展保留，作为后置工作包 W3 | **已定**（2026-10-29） |
| D3 | 审计计划不拆文件，顶部加冻结指针、只修状态；本文为现行计划 | **已定**（2026-10-29） |
| D4 | 一份现行计划合并两份旧计划的剩余工作 | **已定**（2026-10-29） |
| D5 | `mbd_polar` 何时改为默认开：建议条件 = W1-3 的 A/B 截图通过 + 3D 模式无 NaN / 越界 + W4-1 口径下 P95 不退化 ≥ 10 % | 待定，W1-3 完成后拍板 |
| D6 | T5.3 occupancy 与 T3.4 的算法口径谁先定：建议**前端 T3.4 先**（PML 原 case 金样已在 TS 侧），Rust 侧照金样对齐 | 待定，W1-1 动手前拍板 |
| D7 | W3-3 `cheight_mm` 与 T7.1 的 `AidText.text_height_mm` 的关系：建议 `cheight_mm` 为 isoline 级缺省、`text_height_mm` 为 primitive 级覆盖，前端取后者优先 | 待定，W3-3 动手前拍板 |

## 6. 风险

| # | 风险 | 处置 |
| --- | --- | --- |
| R1 | polar 3D 行为不如现状，用户认为「退步」 | 开关默认关（D5）；W5-2 的截图基线先于 W1-3 落地，A/B 有对照 |
| R2 | 契约三步顺序反了被 ADR 0046 fail-closed 整包拒收 | W3 每步单独提交，`contract_guard` 回环；不改默认 fail-closed |
| R3 | `golden_regression` 全红被当成回归 | 它是闸门（审计计划 §13.7）：逐条 `golden diff` 审阅后 `record --force --note` |
| R4 | 同一工作区多路并行，计划外改动混入提交（2026-10-29 已发生两次：T7.6 批次、F9 的 arc.ts） | 每个工作包提交前 `git status --short` 按文件白名单；计划外改动先登记再提交 |
| R5 | 门禁数字再次分叉 | 只写审计计划 §14；范围缩写 S0 / S1 / S2 必须注明 |
| R6 | `type-check` 基线 440 条，新代码踩既有坑 | 每个工作包验收含「新增 0 / 已消失 0」；不改基线放行 |
| R7 | W1-1 单文件超 600 行、14 步难以评审 | 按步骤拆子模块；每步有独立用例；PML 原 case 金样是唯一真值 |

## 7. 验收命令

> 本计划不代跑测试；每个工作包由执行者本机跑，数字只追加到审计计划 §14。vitest 必须从大写盘符路径启动（健壮性计划 §2）。

```powershell
# 前端（S2 口径）
cd 'D:\work\plant-code\old\plant3d-web'
npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts src/api/mbdV2Api.test.ts src/utils/refnoKey.test.ts
npm run type-check            # 新增 0 / 已消失 0（基线 440 条 / 127 文件）
npx eslint <触及文件>
npx playwright test --config=playwright.novideo.config.ts e2e/dimension-*.spec.ts e2e/mbd-robustness.spec.ts
$env:DIMENSION_PERF_GATE='1'; npx playwright test --config=playwright.novideo.config.ts e2e/dimension-perf.spec.ts   # W5-5

# 求解器
cd 'D:\work\plant-code\old\vendor\plant-mbd'
cargo fmt --check
cargo test --workspace
cargo run -p plant-mbd-cli -- golden diff
cargo run -p plant-mbd-cli -- layout --fixture fixtures/p3-installation-angles.json --verbose
```

## 8. 不做的事

- 不改 ADR 0046 的默认 fail-closed；宽容只在 `?mbd_partial=1` / 面板开关下（健壮性计划第三轮的边界）。
- 不把 MBD 文字改成世界尺度（ADR 0044）；不改 plant-mbd 的行位公式 / 字高 / `label_anchor`（六条金样是正确结果）。
- 不在 Web 侧重新发明版面：polar 接入后仍是「求解器决定、前端 1:1 画」，前端 polar 只在 `mbd_polar=1` 的 A/B 路径与屏幕校验层里。
- 不做设备 / 土建 / 建筑（契约是管道专属，需单独立项）。
- 不重写审计计划 §7 / §13 的历史文字；状态只改 §12.4 与追加 §13.x / §14。
- 不为一次性联调新增独立 `*.test.ts`（仓规）；polar 纯数值层与 W1-1 的 PML 金样是例外。

## 9. Plannotator 门禁记录

- 首轮（2026-10-29）：`{"decision":"approved"}`（无批注）。`.planning/2026-10-29-mbd-dimension-remaining-work/.gate-result.json`。本计划自此为已批准版；D5 / D6 / D7 仍待拍板，分别在 W1-3 完成后、W1-1 与 W3-3 动手前定。
