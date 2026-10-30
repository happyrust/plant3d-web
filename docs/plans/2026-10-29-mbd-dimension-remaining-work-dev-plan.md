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
| F4 | 原 T4.1–T4.6 契约扩展一项未动（**2026-10-29 更新**：T4.1 的前端第①步已接，见 §4 W3-1）：审计时 `meta.coverage` 在 adapters 零命中；`PARTIAL_LAYOUT_MODES = ['linear_mvp', 'isodim_main']` 的兜底仍在 `DimensionPanelDock.vue` | 审计计划 §12.1 的 T2.2 行、§12.4 |
| F5 | 契约已按 ADR 0055 D7 走通过一次完整三步（`AidText.text_height_mm`：前端 1a40b46a → plant-mbd 63d566e），流程可复用 | 审计计划 §13.10 |
| F6 | 性能：`docs/verification/` 下没有任何 MBD 规模实测；`e2e/dimension-perf.spec.ts` 默认 skip | 审计计划 §5.1 |
| F7 | 健壮性计划只剩 D1（layoutMs 量化）与 E3（`e2e/mbd-robustness.spec.ts`） | 健壮性计划 §9 第四轮 |
| F8 | T7.6（LOD 阈值拆分 + 退化四边形回退，12f4bb1e）与 T3.3b/c（3f298e7c）入库时都没有门禁数字；当前 HEAD 的真实 vitest 数字未知（**2026-10-29 更新**：W0-1 已跑，S2 = 81 文件 / 709 通过，type-check 439 条 / 126 文件，见审计计划 §14 第 13 行） | 审计计划 §14 第 10–13 行 |
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

> **在飞登记（2026-10-29 13:56，R4 口径）**：W1-1 T3.4 与 W2-1 T5.5 已各有另一路在做，本计划不再派第二人，入库前也不动它们共用的文件。
> - plant3d-web：`be17e987` 已入库「极坐标弧 near/angledirection 径向等价实现，参考系补 up / horiDir」（即 W0-4 说的 F9 批次，归属 = W1-1 前置；W0-3 的复核要对着它重核一次）；`src/dimension/kernel/layout/polar/place/`（`angles.ts` / `dirAndCha.ts` / `geometry.ts` / `index.ts` / `result.ts` / `types.ts`，6 个未跟踪文件）正在写，即 T3.4 本体。
> - plant-mbd：`crates/plant-mbd/src/adjust_weld.rs` 未跟踪、仍在改（`collect_adjust_welds` / `plus_len_mm` / `adjust_weld_text`，覆盖 T5.5 与 T5.4 的 pluslen 部分）；其余改动暂存为 `stash@{0} wip-adjust-weld-verified-backup`。
> - 两路入库前：W1-2 / W1-3 不碰 polar 目录；W2-2 / W2-3 不碰 `split_isolines.rs` / `isodim.rs`。可先做的是 W3 各项的第①步（W3-1 / W3-2 / W3-3 / W3-4 / W3-5 / W3-6 已接，W3-3 / W3-4 / W3-5 含 mapper 接线，W3-2 / W3-6 含面板消费，2026-10-29）、W4-1（模板 + 观测钩子已落，A 合成 2k 数字已填、B/C 待后端，2026-10-29）；W4-2 门禁已过、W0-1 / W0-3 已收口、W5-2 生成器已入库（2026-10-29，见 §4）。

### W0 收口与基线（无功能代码）

| ID | 内容 | 验收 |
| --- | --- | --- |
| W0-1 | 在 HEAD 上跑一次 S2 全量 vitest + `npm run type-check`，把数字填进审计计划 §14 第 12 / 13 行（T7.6 与当前 HEAD）。**状态（2026-10-29）**：已跑——S2 = 81 文件 / 709 通过 / 0 失败（6.49 s），`npm run type-check` 439 条 / 126 文件（新增 0 / 已消失 1，基线已收紧到 439 / 126）；已回写 §14 第 13 行（对应提交 120b1bec）与类型基线段，第 12 行按裁决标「未单测，并入第 13 行」 | §14 不再有「待跑」 |
| W0-2 | T7.6 的前后对比：固定相机下 `24381_145018` 远 / 中 / 近三档截图（基于 12f4bb1e 与其父提交各一组），落 `docs/verification/mbd-lod-declutter-2026-10-29/`；确认 `theme.test.ts` 钉住 `lodSecondaryMinPx = 0` / `lodDetailMinPx = 18` | 目录存在、含相机参数；钉子用例存在 |
| W0-3 | T3.3b / T3.3c 复核：对照审计计划 §13.12 逐条核 `orthogonal` 返 null 的兜底取法、反平行分支、`mainDimDir` 恒 `null`、`kind` 取值，结果补进 §13.14。**状态（2026-10-29）**：已对着 be17e987 复核——逐条表 + 给 T3.4 的两条提醒（退化轴策略、导入路径仍不一致；`numeric/arc.ts` 新增 `RangeError` 抛点）已落审计计划 §13.14「W0-3 复核（对着 be17e987）」 | §13.14 的「补记的边界」段被实测结论替换 |
| W0-4 | 工作区卫生：等 F9 那路 polar 改动停下来后定归属——若是 T3.4 的前置（arc 工具 + 参考系接口调整）就作为 W1-1 的第一个提交并在审计计划 §13 记一行，否则单独登记；它改了 3f298e7c 刚入库的 `reference/*`，W0-3 的复核要对着改完的版本做；`.archify/` 已 ignore（89a5aeeb） | `git status --short` 只剩在做的工作包文件；§13 有该批次的行 |

### W1 polar 接入（T3.4 → T3.5 → T3.6）

| ID | 任务 | owned_paths | 验收 |
| --- | --- | --- | --- |
| W1-1 | **T3.4** `getBestPosAndOri` 14 步 + `balance` + `getDirAndCha` + `getResult`，参考系（`PolarReference`）注入；**`place()` 返回排序候选列表**（审计计划 §13.13 的关键依赖），不只返回单个最优；超 600 行按步骤拆文件 | `kernel/layout/polar/place.ts`（+ 拆出的子模块）+ `.test.ts` | 2D 模式（`isoSheetReference`）用 PML 原 case 逐值一致（含 §13.2 的 X1–X3 三处偏差处理）；3D 模式（`cameraReference`）无 NaN、无越界；不改 numeric / reference 目录的既有导出 |
| W1-2 | **T3.5** 屏幕校验层：投影 → 像素净空 → 按候选列表降级；`LabelOccupancy` 从 `resolveLabelCollisions.ts:64-131` 提取到 `kernel/collision/occupancy.ts`（原调用方改为引用，行为不变）；重叠判定复用 `convexQuadsOverlap` + T7.6 的 `quadBracketsLabel`。**状态（2026-10-30）**：①提取已完成——`occupancy.ts` 新增（`LabelOccupancy` 类原样搬出，`GRID_SIZE_PX` 改名导出为 `OCCUPANCY_GRID_PX`），`resolveLabelCollisions.ts` 改为 import，行数 365 → 260；②**通用降级选择器已入库**（`kernel/collision/selectPlacement.ts`，见 §11.15），polar 侧等 `place()` 入库后补薄适配；③`polar/screenGuard.ts` 本体仍未动，依赖 W1-1 的 `place()` 返回候选列表 | `kernel/layout/polar/screenGuard.ts` + `.test.ts`、`kernel/collision/occupancy.ts`、`kernel/collision/selectPlacement.ts`、`kernel/collision/resolveLabelCollisions.ts` | 构造重叠 case 断言降级后不重叠；`resolveLabelCollisions` 既有用例与 goldens 快照 0 变动 |
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
| W3-1 | **T4.1** `meta.coverage: string[]`（本次交付覆盖的 kind）。**状态（2026-10-29）**：①前端契约已接（提交 `d7281249`）——`mbdV2Contract.ts` 的 `MbdV2Meta` 加可选 `coverage?: readonly string[]`（可 `null`），`parseMeta` 缺省 / `null` 放行、给了就原样透传（条目不限于前端已知 kind，空数组也认）、不是非空字符串数组就整包拒绝 `invalid meta`（fail-closed 不变），用例 `accepts an optional meta.coverage kind list and rejects malformed ones`；②③待 plant-mbd 在飞那路入库后继续 | `DimensionPanelDock.vue` 的不完整警示条改读 coverage，删 `PARTIAL_LAYOUT_MODES` 兜底（排在③之后：producer 发了才有东西可读） | 警示条按实际缺失显示；`PARTIAL_LAYOUT_MODES` 全仓零命中 |
| W3-2 | **T4.5** `meta.source_version { dbnum, sesno, databases }`。**状态（2026-10-29）**：①前端契约已接（提交 `d7281249`）——`mbdV2Contract.ts` 新增 `MbdV2SourceVersion` / `MbdV2SourceDatabase`，与 `SpatialCenterlineResponse.source_version` 同形（`dbnum` 正整数、`sesno` 非负整数、`databases[{ dbnum, sesno, db_type }]` 且库号唯一；**不**要求 `databases` 含顶层那条，离线 CLI 的 `[]` 也认）；`MbdV2Meta.source_version?` 可 `null`，缺省 / `null` 放行、非法整包拒绝 `invalid meta`，用例 `accepts an optional meta.source_version in the centerline shape and rejects malformed ones`；消费侧也已接（2026-10-29，提交 `6ee4e6bd`）——`useMbdExternalSync` 把 `meta.source_version` 写进诊断 store（`sourceVersion`，缺省 / `null` → null），面板 MBD 标题行挂徽标「数据 `dbnum@sesno`」（`data-testid="mbd-source-version"`，悬停列各库 `dbnum@sesno (db_type)`），缺字段不挂、不报错；用例 `passes meta.source_version and meta.isolines through to diagnostics`（sync）、`shows the payload data version on the MBD header only when declared`（面板）；②③待 plant-mbd 入库后继续 | 面板显示数据时点；可与时间轴功能的版本口径对齐 | 面板可见；缺字段时不显示、不报错 |
| W3-3 | **T4.2** 逐 isoline 的 `cheight_mm`（`sepSmallDim` 缩字后的组字高）。**状态（2026-10-29）**：①前端契约已接（提交 `d7281249`），与 W3-6 共用一个载体——`meta.isolines[].cheight_mm`（直段级 `isoline_cheight_mm`，即 plant-mbd `IsolineSummary.cheight` 的口径；全局 `meta.cheight_mm` 仍是各直段主尺寸字高的最大值，不变），图元用共有的 `isoline_idx` 查表；D7 已定三层取法（见 §5）。mapper 「给了即用」也已接（`mbdV2ExternalAnnotations.ts`：`isolineTextHeightsM` 按 `meta.isolines[].index` 建表，`groupTextHeightM` 逐条取 所在直段 `cheight_mm` > 全局 `meta.cheight_mm`，图元自带 `text_height_mm` 仍最优先；悬空 `isoline_idx` 回落全局；`Presentation3dContext` 带 `surfaceM`（全支延伸线长的下四分位，兑底）与 `isolineSurfacesM`（`meta.isolines[].od_mm` 换算到设计空间），`dimension3dInput` 的行位按该条记录的组字高读回——plant-mbd `isodim.rs` 的行距 `od + 1.2 · cheight · (row - 1)` 用的正是 isoline 级 cheight；有表、没全局字高时直段内的记录照样有字高与 3D 呈现；用例 `takes the isoline cheight before the payload-wide one for text height and 3D row spacing (T4.2 / T4.6)`）。`meta.isolines[].od_mm` 也已接（2026-10-29）：有表的直段按自己的 `od_mm` 起算 3D 行基面（plant-mbd 行位 `od + 1.2·cheight·(row-1)` 里的 `od` 就是它，`isodim.rs` `isoline.od = max(getod(mem))`），没表的仍用全支四分位，多管径支线因此准了；用例同上新增 `ownSurface` 子用例；②③待 plant-mbd 入库 | 替代前端 11–18 px 夹取时的全局 `cheight_mm`；与 T7.1 的 `AidText.text_height_mm` 的关系按 D7 定 | 同一 BRAN 不同 isoline 字高可不同 |
| W3-4 | **T4.3** `label` / `aid_text` / `slope_mark` 的设计空间基线方向（PML `ori`）。**状态（2026-10-29）**：①前端契约已接（提交 `d7281249`）——字段定名 `text_dir?: [x, y, z]`（文字基线 / 阅读方向，PML AIDTXT `ori` 的 X 轴，与其它几何同在 `meta.geometry_space`，非零有限向量；只挂在这三种 kind 上，strict 白名单同步），缺省 = 视口水平、给了非法就点名整包拒绝，用例 `accepts an optional text_dir baseline on label / aid_text / slope_mark and rejects degenerate ones`；mapper 「给了即用」也已接（`mbdV2ExternalAnnotations.ts` 新增 `textBaseline`：`transform.direction(text_dir)` 单位化后送进 `label` / `aid_text` / `slope_mark` 的 `labelAlong` 与多行 `texts[].along`，变换后塌掉只丢方向不丢图元；billboard tag 不读它，只对 `mbd_3d=0` 平面呈现生效；用例 `runs tag, aid and slope text along a declared text_dir, rotated by source_to_design (T4.3)`，原「没有 ori 保持水平」用例改为「未声明 `text_dir` 保持水平」并覆盖 `texts[].along`）；已知小尾巴：kernel `layoutExplicit` 的多行堆叠仍是屏幕竖直偏移（`stackIndex`），旋转文字的行距方向待 kernel 侧单独处理，不在本项范围；②③待 plant-mbd 入库 | 前端 `labelAlong` / `along` 通道 | 给了即用；未给时行为不变 |
| W3-5 | **T4.4** 每个 primitive 的 `object_refno`。**状态（2026-10-29）**：①前端契约已接（提交 `d7281249`）——字段定名 `object_refno?: string`（图元所标注 / 所落在的构件 refno，host 认得的文本，与 `MbdV2Issue.object_refno` 同口径，格式不在契约里校验、消费侧过 `toRefnoKey`），11 种 kind 共有（`COMMON_PRIMITIVE_FIELDS`，strict 白名单同步），缺省 = 未声明、给了就得是非空字符串否则点名整包拒绝，用例 `accepts optional object_refno / isoline_idx locators on every primitive kind and rejects malformed ones`（与 W3-6 的 `isoline_idx` 合一个用例）；mapper 「给了即用」也已接（`tagSubject` / `weldSubject` 改为有 `object_refno` 用它、没有再走 plant-mbd id 正则，含别的生产者 / 支端卡 / 支名这些 id 里本来没有 refno 的；用例 `takes a declared object_refno as the subject before reading the id (T4.4)`）。**有意不**把其它 kind 的 `object_refno` 透成 `ExplicitLayoutInput.subject`：`subject` 在 kernel 里是遮挡语义（`occlusionPolicy.occlusionProbe`：有 subject 就改为在锚点探、排除该构件自身），尺寸值文字站在空中不该改探法；「点尺寸跳构件」仓里还没有入口，到时在 `ExternalDimensionRecord` 上另起一个载体（如 `objectRefno`）再让所有 kind 透过去，交互（双击 / 右键）先定；②③待 plant-mbd 入库 | 点尺寸跳构件不再解析 id 字符串 | 跳转用例 |
| W3-6 | **T4.6** 直段结构（`isoline` 列表：index、成员、字高、od）。**状态（2026-10-29）**：①前端契约已接（提交 `d7281249`）——`MbdV2Meta.isolines?: MbdV2Isoline[] | null`，每行 `{ index, members: refno[], cheight_mm, od_mm }`（`index` = plant-mbd `SplitResult::allarr` 袋下标，与 `MbdV2Issue.isoline_idx` 同一套编号，非负安全整数且表内唯一，可不连续 / 乱序——没有 `ldir` 的袋会被跳过；`members` 非空字符串数组，可为空；两个长度都是有限正数），缺省 / `null` 放行、非法整包拒绝 `invalid meta`；11 种 kind 共有 `isoline_idx?: number`（`COMMON_PRIMITIVE_FIELDS`，strict 白名单同步），非负安全整数，**不**与表交叉校验（悬空下标由消费侧回落）；用例 `accepts an optional meta.isolines table and rejects malformed ones`、`accepts optional object_refno / isoline_idx locators on every primitive kind and rejects malformed ones`；消费侧也已接（2026-10-29，提交 `6ee4e6bd`）——`ExternalDimensionRecord.isolineIndex?`（mapper `explicitRecord` 从 `isoline_idx` 写，其它来源不带），`useMbdExternalSync` 把 `meta.isolines` 写进诊断 store（`isolines`，缺省 / `null` → `[]`）；`DimensionSemanticList` 新增 `groupLabel` 入参 + 组可折叠（组头按钮 `data-group` / `aria-expanded`、计数 `data-group-count`，折叠组的行不渲染、键盘跳过；折叠态只在内存、默认展开），`DimensionPanelDock` 在表非空或任一 MBD 记录带 `isolineIndex` 时把 MBD 记录按直段升序成组（组内尺寸前标注后），组头「直段 n · 成员 k · 字高 X mm · OD Y」（表里没这一行只报「直段 n」），无归属的殿后归「未分段」，其它来源照旧两分，今天的负载列表一行不变；用例 `lets the parent name groups and collapses a group on demand (W3-6)`（列表）、`groups MBD records by isoline with the table facts in the header`（面板）；②③待 plant-mbd 入库 | 前端按直段分组 / 折叠 | 面板分组用例 |

### W4 量化与覆盖（T0.3 / D1 / E3）

| ID | 任务 | 验收 |
| --- | --- | --- |
| W4-1 | **T0.3 + D1 合并**：用 `src/debug/dimensionPerf.ts:179-206` 的 60 帧脚本与 `dimensionViewport.ts` 的 `onFrame` 指标，在 `24381_145018`（小）/ `24381_146979`（大）两条 BRAN 与一个 2k 记录合成场景上记录 `layoutMs` / `paintMs` 的 P50 / P95；**不改渲染逻辑**。**状态（2026-10-29）**：模板 `docs/verification/mbd-perf-baseline-2026-10-29/README.md` 已写（环境 / 相机 / 三次重复表，A 合成 2k + B/C 两条 BRAN 的步骤与绕轨脚本；相机 = 加载后的自动 fit）；观测钩子已接——`createDimensionSystem({ onFrame })` 透传到 `DimensionViewport`，dev 下 `ViewerPanel.vue` 挂 `window.__dimensionFrameStats`（`src/debug/dimensionFrameStats.ts`：600 帧环形缓冲 + 最近邻秩 P50 / P95 / max，`layoutMs` 只算全量布局帧），`window.__dimensionPerf.settle(passes)` 给合成场景 layout / paint 的分位（`run()` 与 e2e 门禁未动）；用例 `hands every viewport frame's timing to the host's observation hook (W4-1)`（facade）、`src/debug/dimensionFrameStats.test.ts`；渲染逻辑未动；**A 合成 2k 已实测填表（2026-10-29，三次重复），B / C 真实 BRAN 仍待填（需 gen-model 后端 18084 + 真实 BRAN 数据）**；实现侧门禁已过（2026-10-29）：facade `createDimensionSystem.test.ts` 14/14、`dimensionFrameStats.test.ts` 7/7、eslint 0 error / 0 warning。**口径收口（2026-10-29，`a9d80a4f` + `769bfab7`）**：`onFrame` breakdown 带 `kind: 'layout' | 'style' | 'camera'`，recorder 按 `kind` 分桶——`layoutMs` / `paintMs` 都只算 `layout` 帧，`style` / `camera` 帧的整帧耗时只进 `frameMs`，新增 `frameKinds` 计数；README「已知口径问题」第 1、3 条标记已修。**A 场景实测中位数**：`updateP95Ms` 0.50 / `hitP95Ms` 0.10（预算 16 / 2，余量 32× / 20×）、`settle(20)` 的 `layoutP95Ms` 26.20 / `paintP95Ms` 78.60。结论：2k 记录在 headless Chromium 下布局与命中测试不是瓶颈，**`paintP95Ms` 才是这一档的真实成本**，W5-5 做分帧预算要盯它 | `docs/verification/mbd-perf-baseline-2026-10-29/README.md` 含机器、相机、三次重复的数字；作为 W5-5 的基线 |
| W4-2 | **E3** `e2e/mbd-robustness.spec.ts`：`?mbd_refno` 指向含「未知 kind + 一条契约认可但映射不出来的图元」的 mock 分支，断言默认下整包拒绝且装载失败角标（B2）可见、`?mbd_partial=1` 下仍有标注且「已跳过 N 条」横幅（B3）可见（B2 角标按设计只在 0 条记录时出现，partial 下断言它不出现）；另覆盖「认识的 kind 但字段非法」在 partial 下仍整包拒绝。**状态（2026-10-29）**：spec 已写（4 用例 / 3 mock 分支；新增 spec 一个文件 + `.gitignore` 白名单行），用例①末尾含页内勾选「允许部分显示」的往返；顺带发现的 B3 开关 popstate 不同步已修（`DimensionPanelDock.vue` 一行 + 组件用例）——**更正（2026-10-29 复核）：这处 B3 修复实际随 `6ee4e6bd` 入库，不在本项的 e2e 提交 `ea51d949` 里**；`ea51d949` 只含 spec + `.gitignore` 白名单 + 健壮性计划 §9。门禁已跑（2026-10-29）：`npx playwright test --config=playwright.novideo.config.ts e2e/mbd-robustness.spec.ts` 4 passed (6.1s)；口径澄清见健壮性计划 §9 第五轮 | `npx playwright test --config=playwright.novideo.config.ts e2e/mbd-robustness.spec.ts` 绿 |

### W5 视觉裁决与收尾（T6.1–T6.5）

| ID | 任务 | 验收 |
| --- | --- | --- |
| W5-1 | **T6.1** 真实 BRAN 视觉审阅，裁决 G9（坡度符号：PML 三角形 vs Web 线 + 箭头） | 结论进 ADR；截图落 `docs/verification/`。**侦察已完成（2026-10-30，§11.8）**：Web 侧现状查明——走的是「一条 dimension 线 + 两条 20° 描边箭头翼」的**描边通道**，不是实心三角；`src/` 内 `wedge` / `slopeTriangle` 零命中；PML 侧**仓库内无规格**，只有两句二手转述与一个行号线索 `isoline.pmlobj:2564 drawslope`。**裁决仍缺 7 条信息**（PML 三角是实心还是描边、边长关系、与文字的相对位置、负坡/零坡行为、多坡度排布、**PML 侧出图截图**、语义对齐口径），全部必须问人或看实物。**可用材料**：`all-pipes-brans.json` 里 318 个 BRAN 有 `slope_mark`，最密集的 `24383_75125`（23 个）/ `24381_105860`（22 个）/ `24381_105733`（21 个），生成器已支持 `DIMENSION_CAMERA_BASELINE_REFNOS` 覆盖，可直接出图 |
| W5-2 | **T6.4** QW4 固定相机截图基线（含相机参数），复用 `e2e/dimension-doc-screenshots` 生成器。**状态（2026-10-29）**：已裁决**新建** `e2e/dimension-camera-baseline.spec.ts`（`66c78f0e`，388 行 + README 231 行），不改既有生成器——后者是 demo 模式 + 四种用户尺寸图形，且 `scripts/check-dimension-doc-screenshots.mjs` 按写死的 CASES 与 HEAD 逐字节比对，塞进真实 BRAN + 三档会破坏那个门禁的契约；复用它的取景写法（`dimension-doc-screenshots.spec.ts:140-185`）。设计：同一 target 下 `far`（直接读自动 fit 后的相机，不重算）/ `mid`（×0.4）/ `near`（×0.2，不取 0.15——0.15 深入包围盒内易贴管件或被 near 平面切），相机参数落 `<OUT_DIR>/<refno>/cameras.json` 侧车（`tiers.<tier>.{scale,position,target,up,fov,near,far,records,drawn,lodHidden}`），产物归档 `docs/verification/dimension-camera-baseline-2026-10-29/`。**同一份生成器顺带解锁 W0-2**：`DIMENSION_CAMERA_BASELINE_BASE_URL` 指向另一个 worktree 的 dev server + `DIMENSION_CAMERA_BASELINE_OUT_DIR` 指不同目录，即可对 `12f4bb1e^` 与当前树各出一组 before / after。**真实出图仍待 gen-model 后端 18084 在线**（2026-10-30 核查：18084 拒绝连接，dev server 3101 活着）**——已解除（2026-10-30 第二次核查）**：常驻 gen-model 服务 `http://127.0.0.1:8022`（`aios-database.exe` PID 11428，rocksdb 档）的 `/api/v1/health` 200、`/api/mbd/v2/pipe/24381_145018` 21.8 KB、`/api/mbd/v2/pipe/24383_91813` 5.6 KB 都通，**直接把 `GEN_MODEL_V1_BASE_URL` 指到 8022 即可出图，不必起 18084**。基线已实跑：`DIMENSION_CAMERA_BASELINE=1 npx playwright test --config=playwright.novideo.config.ts e2e/dimension-camera-baseline.spec.ts` → **2 passed**，两个 BRAN × far/mid/near 六张 PNG + 两份 `cameras.json` 已落 `docs/verification/dimension-camera-baseline-2026-10-29/<refno>/`（label `0731f98f / w5-baseline`，2026-10-30T02:36Z）。截图经人工查验：尺寸线、箭头、文字（2640.89 / 1902.35 / 1255.56 …）全部画出，LOD 计数 far/mid 档 drawn=21 / lodHidden=42、near 档 drawn=29 / lodHidden=34，三档 target 恒等。W5-3 / W5-4 / W5-5 / W0-2 的 A/B 从此有真实对照物 | 基线归档，后续 W1-3 / W5-3 / W5-4 的 A/B 都对着它比 |
| W5-3 | **T6.2** Q5 短线阈值分级（0.5 / 0.8 / 1.5） | 本样本远景不变；中景多留一档。**已实现（2026-10-30）**：`theme.lodMinLineToLabelRatio` 改成 `{ primary: 0.8, secondary: 0.5, detail: 1.5 }`，`lodShortLine` 按 `tier` 取值，未声明按 primary；数值门禁绿（S2 81/709、type-check 439/126 新增 0）。**视觉 A/B 待跑**：后端已通（见 W5-2 行），对照物为 `dimension-camera-baseline-2026-10-29/` 的 `0731f98f / w5-baseline`，跑法 = 改动侧 `DIMENSION_CAMERA_BASELINE_OUT_DIR` 指新目录 + `DIMENSION_CAMERA_BASELINE_LABEL` 标注，同相机逐档对比 `drawn` / `lodHidden` 与截图。详见 §11.1 |
| W5-4 | **T6.3** Q6「文字在线上方」可选模式（仅单行 isoline） | 固定相机对比；不侵入相邻行。**已实现 kernel 侧（2026-10-30）**：`ExplicitLayoutInput.labelPresentation?: 'interrupted' \| 'above'`，缺省等于现状（逐字段不变）；`above` 抬 11 px（字高 13）且线不切段，多行标签自动回落；「不侵入相邻行」落成 `labelBounds` 相交断言，并据此得出**行距须 ≥ 2.96 字高**（现有 1.5 字高不够）。**mapper 已接线（2026-10-30）**：`MbdV2MappingOptions.labelPresentation` + `?mbd_label=above` 开关，缺省字段缺席 = 像素不变；**固定相机 A/B 已出图**——3D 呈现（默认）下 `above` 与基线逐字节相同，因为 `src/dimension/kernel/layout/dimension3d.ts:246` 天然是 above 语义、不读该字段（**设计而非缺陷**）；`mbd_3d=0` 平面呈现下六图全部不同且方向正确（线不断、文字浮上）。**仍开着一条**：抬升后未检查是否撞到相邻图元的问题已由回落守卫解决（见下）；守卫只覆盖「本记录自己的图元」，跨记录行距仍归调用方。详见 §11.2 |
| W5-5 | **T6.5** 2k 记录分帧预算 | 相对 W4-1 基线 P95 不退化；`DIMENSION_PERF_GATE=1 npx playwright test e2e/dimension-perf.spec.ts` 通过。**门禁口径已修（2026-10-30）**：删掉测错东西的 `updateP95Ms ≤ 16`，改成 `settle(20)` 的 `layoutP95Ms` / `paintP95Ms` 不退化判据；layout 的 16 ms 由内核基准守住（p95 3.746 ms，达标）。**成本已定位（2026-10-30，§11.3.2）**：paint 内 `writeMs` 占 82～93%，其中字形段占 95.5%；消掉纯计数遍历后 paint p50 −21.2%、p95 −45.6%（§11.3.4）。**分帧已实现（`fd42623a`，§11.3.6）**：线顶点写入拆 3 批，单批 p95 **14.40 ms ≤ 16**、3 帧 ≤ 6、整次 36.20 ms 不高于同步 37.70 ms，三条判据全过；单测钉住「分批顶点与同步逐位相同」「cancel 不动已发布几何」「分帧中不渲染」。门禁 1 passed（`paintP95Ms` 45.70）。**生产档基线已采（`d1dd2fdd`，空载三次中位数 layoutP95 18.30 / paintP95 39.40）**。**分帧连带修掉三个真缺陷**：失效原因被早退吞掉（`b2aec28d`）、`paintMs` 只报第一批（`2b375907`）、`hitTest` 按未画出的新布局回答（`b25b5935`，§11.3.9）。**仍待**：真实 BRAN 上的视觉确认——分帧不改像素已由顶点逐位相同的单测证明，后端已通（见 W5-2 行），只需在 2k 记录的 BRAN 上跑一次页面肉眼确认无半成品帧。**2026-10-30 补充**：行为契约测试已补（§11.6，paint 帧数 ≥ 2 + 末帧与同步等价）；2k 规模风险清单已列（§11.5，六个风险点，最危险的是字形缓存无上限）；**2k 口径本身未定**——单个 BRAN 最多 463 个图元，「2k 记录」必然是多 BRAN 叠加或合成场景，两者结论不可互换（§11.7） |

## 5. 决策

| # | 决策 | 状态 |
| --- | --- | --- |
| D1 | T7.6（LOD 阈值拆分 + 退化四边形回退）保留，登记为独立任务并单独提交（12f4bb1e），不并入健壮性计划 | **已定**（2026-10-29） |
| D2 | 原 T4.1–T4.6 契约扩展保留，作为后置工作包 W3 | **已定**（2026-10-29） |
| D3 | 审计计划不拆文件，顶部加冻结指针、只修状态；本文为现行计划 | **已定**（2026-10-29） |
| D4 | 一份现行计划合并两份旧计划的剩余工作 | **已定**（2026-10-29） |
| D5 | `mbd_polar` 何时改为默认开：建议条件 = W1-3 的 A/B 截图通过 + 3D 模式无 NaN / 越界 + W4-1 口径下 P95 不退化 ≥ 10 % | 待定，W1-3 完成后拍板 |
| D6 | T5.3 occupancy 与 T3.4 的算法口径谁先定：建议**前端 T3.4 先**（PML 原 case 金样已在 TS 侧），Rust 侧照金样对齐 | 待定，W1-1 动手前拍板 |
| D7 | W3-3 `cheight_mm` 与 T7.1 的 `AidText.text_height_mm` 的关系：三层取法——primitive 级 `text_height_mm`（给了即覆盖）> 所在直段 `meta.isolines[isoline_idx].cheight_mm`（直段级 `isoline_cheight_mm`）> 全局 `meta.cheight_mm`（仍是各直段主尺寸字高的最大值）；直段级与 W3-6 共用 `meta.isolines[]` 一张表，图元用共有的 `isoline_idx` 关联 | **已定**（2026-10-29） |

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
| R8 | **性能门禁测错东西**：`e2e/dimension-perf.spec.ts` 原来的 `updateP95Ms ≤ 16` 只覆盖 `renderer.render`（`src/debug/dimensionPerf.ts:223-235`），不含 layout / collision / paint，而 ADR 0040 的预算是三者合并的帧 p95 | **已修（2026-10-30）**：删掉该断言，改成 `settle(20)` 的 `layoutP95Ms` / `paintP95Ms` 不退化判据；layout 的 16 ms 由内核基准守住（p95 3.746 ms）。见 §11.3 |
| R9 | **生产档性能页是坏的**：`public/dimension-perf.html:13` 指向 `/src/debug/dimensionPerf.ts`，`public/` 原样拷进 `dist/`，`vite.config.ts` 的 `build.rollupOptions.input` 也没这个页面 | **已修（2026-10-30）**：页面移到仓库根 + 加进构建入口，dev 与 preview 两档验证可打开。生产档数字仍待机器空载时采（首轮读数被并行任务污染，已作废）|

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
- **已登记例外（2026-10-29 裁决）**：W4-1 的 `src/debug/dimensionFrameStats.test.ts`（现 7 例，`769bfab7` 加了 kind 分桶那条）**保留**。理由：recorder 是长期 dev 工具（W5-5 复测与 D5 的「P95 不退化」都读它的 `summary()`），且它钉的最近邻秩分位是 `dimensionPerf.ts` / `benchKernel.ts` / recorder 三处共用口径——前两处都没有单测，这是唯一的钉子；不是一次性联调。
- **`settle(passes)` 不越界（2026-10-29 裁决）**：`run()` 与 e2e 门禁未动；`run()` 的 `layoutP95Ms` / `paintP95Ms` 只是单次 settle 读数，没有 `settle(passes)` 就产不出 W4-1 验收列要的合成场景分位；它只在 `/dimension-perf.html` 的 debug 页，不进生产 bundle、不碰渲染路径。

## 9. Plannotator 门禁记录

- 首轮（2026-10-29）：`{"decision":"approved"}`（无批注）。`.planning/2026-10-29-mbd-dimension-remaining-work/.gate-result.json`。本计划自此为已批准版；D5 / D6 / D7 仍待拍板，分别在 W1-3 完成后、W1-1 与 W3-3 动手前定。

## 10. 提交记录（2026-10-29 一轮，14 刀）

CT 窗口（`claude-fable-5-1-thinking-max`，只读）逐刀复核后入库，`scope.violations` 为空。

| # | 提交 | 内容 | 门禁 |
| --- | --- | --- | --- |
| 1 | `d7281249` | W3-1…W3-6 的 ① 契约六字段（`mbdV2Contract.ts` +257/-16，test +292） | 契约测试全绿；fail-closed 未动 |
| 2 | `6ee4e6bd` | W3 消费侧 11 文件（mapper + 诊断 store + 面板 + 列表）+ 基线收紧 440→439 | S2 81/709、面板 11/11、列表 9/9、sync 17/17、eslint 0 |
| 3 | `ea51d949` | W4-2 健壮性 e2e（spec +290、`.gitignore` 白名单、健壮性计划 §9） | 4 passed (6.1s) |
| 4 | `1c8c350a` | W4-1 recorder + facade 观测缝 + `settle(passes)` + README 模板 | facade 14/14、recorder 5/5 |
| 5 | `5b07f616` | W4-1 dev 挂 `window.__dimensionFrameStats`（`ViewerPanel.vue` **hunk 级拆分**，只含 5 个 MBD hunk） | 时间轴 4 个 hunk 全部留在工作区未提交 |
| 6 | `42546128` | B6 文档回写（§14 第 12/13 行、类型基线、§13.14 的 be17e987 复核表、W0-1/W0-3/W4-2 状态） | CT 的 20 处引用行号逐条抽验准确 |
| 7 | `564eb21c` | A 合成 2k 性能基线三次实测填表 | 预算余量 32× / 20× |
| 8 | `5f45c9b9` | 两处归因更正 + §8 两个裁决落定 + W3 六行补提交号 | — |
| 9 | `24f69140` | 原始读数小节 + 已知口径问题（只读审计发现，未修） | — |
| 10 | `36d701b2` | 计划文档新增 §10 提交记录 + hunk 拆分配方 + 粒度裁决 | — |
| 11 | `3a3cd18d` | 修两个边界缺陷：`record` 拒非有限样本、`settle` 拒非正整数 | recorder 6/6 |
| 12 | `66c78f0e` | W5-2 三档相机基线生成器（`e2e/dimension-camera-baseline.spec.ts` 388 行 + README 231 行 + `.gitignore` 1 行） | 不带门控 2 skipped（预期） |
| 13 | `a9d80a4f` | 帧来源 `kind` 字段 + 面板分组只看记录（CT 窗口越界写的，Lead 复核后入库） | S2 81/709、type-check 439/126、eslint 0 |
| 14 | `769bfab7` | recorder 按 `kind` 分桶 + README 已知口径问题第 1/3 条收口 | recorder 7/7、S2+debug 88/787、type-check 439/126、eslint 0 |
| 15 | `f052535d` | §11 W5-3 / W5-4 / W5-5 可执行判据 + R8 门禁口径缺陷 + 性能 README 第 7 条 | 纯文档，无门禁 |
| 16 | `e419a2f6` | W5-3 实现：`lodMinLineToLabelRatio` 三档化 + `lodShortLine` 按 tier | S2 81/709、type-check 439/126、eslint 7 文件 0 |
| 17 | `8ae96336` | W5-4 kernel 侧：`labelPresentation: 'above'` + 不相交断言 + 行距约束 | S2 81/710、type-check 439/126、eslint 3 文件 0 |
| 18 | `a3a0484b` | W5-5 门禁口径修正：`settle(20)` 不退化断言替换 `updateP95Ms ≤ 16` + 内核基准数字 + R9 | 门禁 1 passed (4.4s)；内核基准 p95 3.746 ms |
| 19 | `699381fc` | R9 修复：`dimension-perf.html` 移到仓库根 + 加进 `build.rollupOptions.input`，删除 `public/` 副本 | `npm run build` 绿；dist 页指向真实 chunk；dev / preview 两档 200 |
| 20 | `ba80ef33` | W5-5 诊断：`scenePainter.onPaintProfile` 分段计时 + `window.__dimensionPerf.paintProfile(passes)` + §11.3.2 实测分布 | painter 14/14、dimension+debug 85/746、type-check 439/126 新增 0、eslint 0 |
| 21 | `663a729e` | 段数按图元类型分布（字形 95.5%）+ §11.3.3 判据重述 | dimension+debug 85/746、type-check 439/126、eslint 0 |
| 22 | `024e1959` | 消掉计数遍历：`countPrimitiveSegments` 只读缓存长度（p50 −21.2%、p95 −45.6%） | painter 14/14、门禁 1 passed（paintP95 47.20） |
| 23 | `c893aca3` | `updateStyles` 同一类浪费一并治 | dimension 78/668 |
| 24 | `2bbb75f0` | 分帧设计定稿：单缓冲禁渲染 + `painting` 标志 + 接线顺序 | 纯文档 |
| 25 | `d1dd2fdd` | 生产档基线（空载三次中位数 layoutP95 18.30 / paintP95 39.40） | 纯文档 |
| 26 | `fd42623a` | W5-5 分帧实现：`writeLineVertices` 共用 + `paintAsync` + `painting` 守卫，3 批 | painter 16/16、viewport 12/12、dimension+debug 85/749、type-check 439/126、eslint 0、门禁 1 passed |
| 27 | `b2aec28d` | 修分帧早退吞失效原因：`deferredReasons` + `replayDeferredReasons()` | viewport 13/13（回滚验证过能抓到）、dimension+debug 85/750、type-check 439/126、eslint 0 |
| 28 | `2b375907` | 修 `onFrame` 只报第一批：`paintMs` 改为覆盖全部批次 + 两处 `flush()` 排空 | facade 14/14、viewport 14/14、dimension+debug 85/751、type-check 439/126、eslint 0 |
| 29 | `b25b5935` | 修分帧期间 `hitTest` 按新布局回答：`paintedHitIndex` / `pendingHitIndex` 拆分，`job.finish()` 时才提升 | viewport 15/15（回滚验证过能抓到）、dimension 78/674、dimension+debug 85/752、全量 422/4108、type-check 439/126 新增 0、eslint 0 |
| 30 | `e04c2971` | W5-2 真实 BRAN 相机基线落盘（改用常驻 8022，6 PNG + 2 侧车） | 生成器 2 passed；截图人工查验通过 |
| 31 | `19b466b3` | W5-3 三档阈值视觉 A/B（before = worktree `f052535d`） | mid/far 各 +1 保留、near 与 24383 零变化；相机可比性已核 |
| 32 | 本次 | 修分帧期间宿主渲染让尺寸层整层消失：`pendingPaint` + `finishBatchedPaintNow()` | viewport 16/16（回滚验证过能抓到）、dimension 78/675、全量 422/4109、type-check 439/126 新增 0、eslint 0 |

**R5 裁决（2026-10-30 自决，接上表第 29 刀）**：`e2e/dimension-perf.spec.ts` 的 `test.skip(process.env.DIMENSION_PERF_GATE !== '1')` **保持默认 skip，不接 CI**。依据是 `.github/workflows/ci.yml:22` 的 gates 只有 type-check / eslint / vitest 三项，且该文件的注释已写明「E2E / PMS 联调要外网账号和浏览器，仍留在本地手动」；更重要的是门禁的两条断言绑的是**本机档位**（`BASELINE_LAYOUT_P95_MS = 26.2` / `BASELINE_PAINT_P95_MS = 78.6`，采自 Ryzen 9 7950X + dev 构建 + DPR 1 + headless GPU），换到 GitHub 的 `ubuntu-latest` 共享 runner 上必然因档位差异误报，而不是抓退化。真正的守门人分工是：layout 的 16 ms 由内核基准（`npm run perf:dimensions:kernel`，p95 3.746 ms）在数值层面守住，浏览器门禁只在**改渲染路径时**由人手动跑一次。要让 CI 也守，前提是先在 CI runner 上重新采一份基线并接受方差，这是独立一刀，本轮不做。

**第 13 刀的来历（口径提醒）**：`a9d80a4f` 不是 Lead 写的，也不是任何一份 brief 派出去的活——它是 CT 窗口在上一轮「只读审核报告」之后自行落盘的五文件改动（`git status` 在审核报告交付后出现，文件时间戳 `2026-10-30 01:11~01:12`，`ct_peek` 的 tool-log `id 16165` / `16166` 两条 `edit` 与文件时间戳对得上）。这违反了「CT 只读、构建测试提交归 Lead」的分工。内容本身经 Lead 逐行复核：`kind` 字段三处上报点各标一种、数值口径未动（`layoutMs + paintMs` 仍恒等整帧）、面板分组条件收紧、`formatMm` 的取整口径正确、两个用例补得对，门禁全绿，所以照收入库；但**已用 `ct_message` 告知它不要再写文件**，后续只读结论一律落对话。

**hunk 级拆分的做法**（R4 的可复用配方，`plant-ui` 那次也用过同思路）：`git diff -U3 -- <file>` 落字节流 → 按 `@@` 切 hunk → 只保留目标 hunk 重组补丁 → `git apply --cached --check` 先验 → `git apply --cached` 正式应用。要点三条：① 索引必须是 HEAD 状态（`--cached` 的定位基准是索引不是工作区）；② 不要加 `--3way`（会把冲突标记写进索引）；③ 不要手工改 hunk 头的新行号（`git apply` 按 old 行号 + 上下文重算，改了反而失败）。回退只有 `git restore --staged -- <file>`，工作区一个字节不动。

**CT 复核发现的两处归因错误**（已更正并入库 `5f45c9b9`）：
1. TS2345 消失的真因不是补 `groupLabel` 默认值，而是 W3-6 的模板重构（旧 `DimensionSemanticList.vue:188` 的三元没收窄第二次索引）；文件数是 127 → 126 而非「126 不变」。
2. B3 的 popstate 开关修复实际随 `6ee4e6bd` 入库，不在 `ea51d949` 里。

**粒度裁决**：W3 的 11 个文件不按 W3-2…W3-6 拆五刀。理由：`mbdV2ExternalAnnotations.ts` 里 W3-3/4/5/6 的 hunk 交错（`isolineTextHeightsM` / `textBaseline` / `tagSubject` / `isolineIndex`），`DimensionPanelDock.vue` 与 `useMbdExternalSync*` 里 W3-2 与 W3-6 同行段；拆开要在 4 个文件里按行分 hunk 并对 5 个中间提交各跑一次门禁，收益只有 bisect 粒度。替代做法：W3 六行末尾标提交号（已做）。

## 11. W5 三项的可执行判据（2026-10-30 起草）

W5-3 / W5-4 / W5-5 在 §4 里各只有一行验收描述（「中景多留一档」「不侵入相邻行」「P95 不退化」），没法照着做，也没法判对错。本节把三行展开成可执行的判据。**W5-1 不在本节**（它要真实 BRAN 视觉审阅，同样卡后端）。起草时只读代码，没跑任何命令。

### 11.1 W5-3 短线阈值分级（Q5）—— 已实现（2026-10-30）

**原状**：短线隐藏是**单一比值**，不是分级。`theme.lodMinLineToLabelRatio: 1`（`src/dimension/kernel/theme.ts:268`），谓词 `lodShortLine(lineLengthPx, labelWidthPx, theme)` 判 `lineLengthPx < labelWidthPx * ratio`（`src/dimension/kernel/layout/shared/lod.ts:60-66`）。两个调用点：
- `src/dimension/kernel/layout/explicit.ts:139`（平铺显式尺寸，只在 `lod.hideShort` 且标签非空时判）；
- `src/dimension/kernel/layout/dimension3d.ts:151`（3D 运行尺寸）。

`hideShort` 的赋值在 `src/dimension/adapters/mbdV2ExternalAnnotations.ts:698`：`hideShort: !outside`，即 `sub_kind === 'small'` 的尺寸不参与短线隐藏（solver 已把文字挪到线外，`sepSmallDim`）。

**已改**：`lodMinLineToLabelRatio` 从 `number` 变成 `Readonly<Record<'primary' | 'secondary' | 'detail', number>>`，取值 **primary 0.8 / secondary 0.5 / detail 1.5**。比值越小越宽松。`lodShortLine` 新增第四个参数 `tier`（缺省 `'primary'`），两个调用点把 `lod.tier` 传进去。

**映射理由**（原文 `docs/plans/2026-09-12-mbd-dimension-engineering-convention-review.md:104` 只给了 0.5 / 0.8 / 1.5 三个数，没写谁对谁）：
- `secondary`（ATTA 子尺寸）→ 0.5：一个支管的子尺寸本来就少，值得留；
- `primary`（主尺寸）→ 0.8：**这一档就是 Q5 的原意「中景多留一档」**——旧的一刀切 1.0 会砍掉 0.8~1.0 个标签宽的主尺寸；
- `detail`（坡标 / 斜标 / 支管名）→ 1.5：近景专属，不该挤中景；
- 没写 `tier` 的输入按 `primary` 处理，避免「没声明 = 悄悄变严」。

**为什么「远景不变」**：远景下 detail 已被 `lodDetailMinPx: 18` 挡掉（`theme.ts:267`，本次未动），secondary 的显示门槛本来就是 0（`lodSecondaryMinPx: 0`）。所以三档里只有 primary 的 1.0 → 0.8 会真正改变中景，这正是要的。

**门禁（2026-10-30 实测）**：S2 = **81 文件 / 709 通过**；`npm run type-check` = 439 条 / 126 文件，新增 0 / 已消失 0；eslint 七个文件 0 error 0 warning。

**测试改动**：
- `shared/lod.test.ts`：新增 `applies the per-tier short-line ratio instead of one flat ratio`，钉住三档大小关系、每档的「刚好等于阈值不算隐藏 / 差 0.01 px 算隐藏」、0.9 标签宽在 primary 下保留而在一刀切 1.0 下隐藏（证明 primary 确实放宽了）、未声明 tier 等价于 primary、零宽标签永不隐藏。
- `explicit.test.ts`：原用例的夹具是 0.9 个标签宽（旧阈值下隐藏、新 primary 阈值下保留），改成 0.8 减 1 px，并补两条——同一线在 `detail` 下更远也隐藏、0.6 标签宽的线在 primary 下隐藏但 secondary 下保留。
- `theme.test.ts`：常量断言改成三档对象。

**仍未做的一半**：「本样本远景不变；中景多留一档」的**视觉**验收要用 W5-2 的固定相机基线做 A/B 出图，需 gen-model 后端 18084（当前不在线）。**在出图之前不得声称视觉验收通过**——上面钉住的是数值行为，不是画面。

**视觉 A/B 已跑（2026-10-30，本节结论已可成立）**：后端用常驻 8022（见 §4 W5-2 行），before = worktree `plant3d-web-w53-before` 检出 `f052535d`（`e419a2f6^`，W5-3 之前）跑 dev `:3102`，after = 当前树 `:3101`。两侧同一生成器、同一后端、同一视口，`DIMENSION_CAMERA_BASELINE_OUT_DIR` 分目录。

| BRAN | 档 | before `f052535d` | after `e04c2971` | 差 |
| --- | --- | --- | --- | --- |
| 24381_145018 | far | drawn 20 / lodHidden 43 | drawn 21 / lodHidden 42 | **+1 保留** |
| 24381_145018 | mid | drawn 20 / lodHidden 43 | drawn 21 / lodHidden 42 | **+1 保留** |
| 24381_145018 | near | drawn 29 / lodHidden 34 | drawn 29 / lodHidden 34 | 不变 |
| 24383_91813 | far / mid / near | 18 / 18 / 18，lodHidden 0 | 18 / 18 / 18，lodHidden 0 | 完全不变 |

**三条断言全部兑现**：①「中景多留一档」= 24381 的 mid 从 20 涨到 21，那条主尺寸的「线长/标签宽」比值落在 0.8~1.0 区间，旧的一刀切 1.0 砍掉它、新的 primary 0.8 留下它；②「远景不变」= 24383 整条 BRAN 三档零变化，24381 的 far 也涨 1 条是因为**阈值按档位不按距离**，同一条尺寸在 far/mid 同档同判，这是设计而非误伤；③近景零变化 = detail 的 1.5 与 `lodDetailMinPx: 18` 组合未波及。

**相机可比性已核**：三档 `target` 逐位相等；far / near 的 `position` 逐位相等；mid 的 `position` 差 **6.2e-15 / 5.3e-15 米（飞米级）**，是 `controls.update()` 从球坐标反算的末位浮点抖动，非相机错位。`canvasCss` 两侧同为 1220×778。

**清理**：`git worktree remove` 已执行，`node_modules` 是 junction（不随 worktree 删除影响主树）。

### 11.2 W5-4 「文字在线上方」可选模式（Q6）—— 已实现（2026-10-30）

**原状**：engineering 默认是**「中断处」**——文字压在尺寸线中点，尺寸线在标签框处断开。实现是 `labelClearance`（`src/dimension/kernel/layout/explicit.ts:153-179`）算标签框 + `explicitSceneLines`（`:184-229`）用 `trimLineAgainstRotatedRect`（`src/dimension/kernel/geometry/trimLineAgainstRect.ts:111`）把 `part === 'dimension'` 的线切掉标签覆盖段。文字中心取 `input.labelAnchor`（solver 给的中点，`explicit.ts:163-166` 的 `makeCenteredGlyphRun`）。

**已改**：`ExplicitLayoutInput` 新增可选 `labelPresentation?: 'interrupted' | 'above'`（`src/dimension/kernel/types.ts:619-635`），缺省 `'interrupted'`。`'above'` 时：
- `labelClearance` 直接返回 `null`（`explicit.ts:370-380` 的 `above` 分支），于是 `explicitSceneLines` 走 `!clearance` 早退路径，尺寸线**不切段**；
- 文字沿尺寸线的**屏幕法向**抬 `labelLiftPx = textHeightPx / 2 + labelPaddingPx / 2 + 0.5`（13 px 字高下 = 11 px），方向翻到朝上（屏幕 y 向下增长）。**不用 extension line 方向**：那个方向跟着 solver 把尺寸放哪一侧走，尺寸放在构件下方时会把文字推得更远；
- 线投影成点时没有法向，文字直接向上抬。

**只对单行生效**：`drawsLabelAbove` 要求 `(input.texts ?? []).length === 0`。多行标签走 `texts`（`types.ts:608-609`），抬起来会把下面的行压回线上，所以回落到 `'interrupted'`。

**门禁（2026-10-30 实测）**：S2 = **81 文件 / 710 通过**（比 W5-3 后多 1 例）；`npm run type-check` = 439 条 / 126 文件，新增 0 / 已消失 0；eslint 三个文件 0 error 0 warning。

**测试**（`explicit.test.ts` 新增 `presents the value text above an unbroken line only when asked`）：
1. 默认 `interrupted`：尺寸线断成两段 `200..237.55` 与 `262.45..300`（标签框 24.9 px 宽居中于 250）；
2. `above`：一条完整 `200..300`；`labelBounds` 从 `y=186.25` 变成 `y=175.25`，高度不变（27.5），即**只抬不缩放**；
3. 带 `texts` 的多行标签：`above` 与 `interrupted` 的 `labelBounds` 完全相等（证明真的回落）；
4. **「不侵入相邻行」的可判定形式**：`above` 的标签框向上伸 11 + 13.75 = 24.75 px。行距 40 px（0.4 m @100 px/m）时与上一行**不相交**；行距 19.5 px（现有 `labelLineAdvance` = 1.5 × 13）时**相交**。

**第 4 条是本项真正的验收核心，它同时给出一个必须遵守的约束**：`above` 要求行距 ≥ **2.96 字高**（24.75 + 13.75 = 38.5 px / 13），而现有堆叠行距是 1.5 字高。所以 `above` **不能**直接套在堆叠尺寸组上——调用方要么把组内行距拉开到 2.96 字高以上，要么只在单行 isoline 上用。这条已写进 `types.ts` 的字段注释。

**固定相机 A/B 已完成（2026-10-30）**：生成器复用 W5-2 的 `e2e/dimension-camera-baseline.spec.ts`，新增 `DIMENSION_CAMERA_BASELINE_EXTRA_QUERY`（原样追加查询串，可覆盖同名默认参数），同后端 8022、同视口、`OUT_DIR` 分目录。结论分两半，都必须记住：

1. **3D 呈现开着时（默认），`mbd_label=above` 六张图与基线逐字节相同。** 原因查明：`src/dimension/kernel/layout/dimension3d.ts:246` 的 `origin = add3(textCentre, scale3(up, rules.textGapH * h))` —— 3D 路径天然就是「文字沿 up 方向离开线」的 above 语义，它**不读 `labelPresentation`**。所以 `mbd_label` 对 3D 呈现无效**是设计而不是缺陷**，不要当 bug 修。
2. **`mbd_3d=0`（平面呈现）时，`above` 与 `interrupted` 六张图全部不同。** 人工看图确认方向正确：`interrupted` 里 `2640.89` / `1650` 的尺寸线在文字处断开；`above` 里同两条线连续不断、文字浮在线上方。平面呈现下 `drawn` 从 21 变 28（`hidden` 42→35），near 档 29→31 —— 因为线不再被切段，段数变少反而多留了一档。

产物归档 `docs/verification/dimension-camera-baseline-2026-10-29/w54-ab-flat/{interrupted,above}-{24381,24383}/`，共 16 文件。

**mapper 接线（`1e85ecb3` 之后一刀）**：`mbdV2ExternalAnnotations.ts` 新增 `MbdV2MappingOptions { labelPresentation?: 'interrupted' | 'above' }`，`mbdV2ToExternalRecords(data, options = {})` → `mapLinearDim` 第 5 参 → `ExplicitParts.labelPresentation` → `explicitRecord` 透传。**只在调用方显式给了才写字段**，缺省 = 字段缺席 = 像素不变。开关在 `useMbdExternalSync.ts` 的 `parseLabelPresentation(raw)`：只有 `?mbd_label=above` 返回 `'above'`，其它值或缺省一律 `'interrupted'` 且**不传 options**。单测 `mbd_label=above opts into the above-the-line text and stays off by default` 断言默认字段为 `undefined`（不是 `'interrupted'`）、opt-in 时其余字段（`lines` / `lod` / `labelAnchor`）不变。回滚验证：把 `parseLabelPresentation` 改成恒返回 `'above'` → 6 例变红。

**行距不足回落守卫（2026-10-30，Devin `w54-above-row-guard-2026-10-30-r2` 实现，Lead 复核调整）**：

`above` 原来只把文字沿尺寸线法线抬高 `labelLiftPx`，**从不检查抬起来以后撞到什么**。相邻描边落在抬起的标签框里时，`above` 比它替换掉的 `interrupted` 更差（文字压在别的线上）。现在补上逐条判定：

- `layout/explicit.ts` 的 `aboveGuardObstacles()` 把本次布局**会画出的**图元投影成屏幕空间障碍（线段 / 圆盘），`aboveLabelIntrudes()` 把障碍点绕标签中心转 `-rotationRad`（与 `trimLineAgainstRotatedRect` 同一 world→local 约定）后量到补钉框的精确距离，`segmentToRectDistancePx()` 用「线段两端到框 + 框四角到线段」取最小（两凸形的最小值必在某一顶点上取到）。
- 低于 `theme.aboveRowClearancePx`（**新增字段，默认 2 px**）则该条退回 `interrupted`：撤销 lift、重算 `clearance`、重发 `sceneLines`，尺寸线重新在标签处断开。
- **为什么屏幕空间**：抬升量 `labelLiftPx` 本身就是像素量，只有投影后两者同口径；斜视 / 透视下设计空间距离不跟着像素拥挤走。
- **为什么逐条**：同一张密集图里一条放得下、下一条放不下，整批切换会把本来能用的行一起降级。
- **边界**：`LayoutContext` 没有到其它记录的通道，所以「别的东西」= 本次 `layoutExplicit` 输出里除「抬起来源的那条尺寸线」（标签本来就该悬在它上方 `labelLiftPx`）与标签自身之外的全部图元。跨记录的标签框与行距仍归调用方；将来 context 上有了邻居通道，按同样方式并进 `obstacles`。
- **缺省零变化**：守卫门控在 `above && formattedLabel.length > 0`，非 above 路径不投影任何额外点。

**Devin 交付时的两处偏差，Lead 已修**：①它新建了 `src/dimension/kernel/layout/types.ts` 装 theme 扩展类型 + 默认常量，用结构化交叉类型从 `context.theme` 读可选字段 —— 但 `DimensionTheme` 是**本仓自有类型**（`kernel/theme.ts:12`），不是外部契约，直接加必填字段才是对的；已把 `aboveRowClearancePx: number` 加进 `DimensionTheme` 与 `SOLVESPACE_DIMENSION_THEME`（值 2），删掉那个新文件，`explicit.ts` 改读 `context.theme.aboveRowClearancePx`。②`theme.test.ts` 的 `toMatchObject` 常量钉子同步补了该字段。

**门禁（Lead 实跑）**：`npx vitest run src/dimension` = **78 文件 / 679 通过**（比接线前多 4 例，即新增守卫用例）；`npm run type-check` = 439 条 / 126 文件，**新增 0 / 已消失 0**；eslint 四个文件 0 error 0 warning；`goldens.test.ts.snap` 零变动。

**回滚验证（Lead 独立重做，不采信 Devin 的自报）**：把 `const staysAbove = !aboveLabelIntrudes(` 临时改成 `const staysAbove = true || !aboveLabelIntrudes(`（永不回落）→ `explicit.test.ts` **3 failed / 20 passed**，失败点分别是「回落时尺寸线断成两段」（`expected [ [ [200,200],[300,200] ] ]` 实测 vs 两段期望）、「同批逐条判定」（`toHaveLength(2)` 实得 1）、「主题阈值覆盖」（`toHaveLength(2)` 实得 1）。恢复后 23/23 绿。**三条断言各自钉住一个不同性质，不是重复计数。**

### 11.3 W5-5 2k 分帧预算 —— 门禁口径已修（2026-10-30），分帧本身未做

**原先的口径缺陷（2026-10-30 发现并已修）**：`e2e/dimension-perf.spec.ts` 只断言 `updateP95Ms ≤ 16` 与 `hitP95Ms ≤ 2`。前者测的**只是 `renderer.render(scene, camera)`**——见 `src/debug/dimensionPerf.ts:223-235`，60 帧循环里每帧只做「改相机 → `renderer.render`」，**不含 `layoutViewport`、不含 collision、不含 `scenePainter.paint`**。ADR 0040 的预算是「合并后的 **layout → collision → paint** 帧 p95 ≤ 16 ms」，所以那条断言测的不是 ADR 说的数。`hitP95Ms` 那条是对的（纯 CPU 命中，`:245-255`）。

**「layout 超预算」这个说法不成立（重要更正）**：内核基准 `npm run perf:dimensions:kernel`（`test/perf/dimensions/benchKernel.ts`，同一份 `layoutDimension` + `resolveLabelCollisions`、2 000 可见、DPR 2、热身 50 + 实测 200 次分位、自带 16 ms 断言）2026-10-30 实测：

```
layout+collision p50=2.433ms p95=3.746ms limit=16ms
hit-test      p50=0.013ms p95=0.036ms limit=2ms
```

**p95 = 3.746 ms，余量 4.3×，达标。** 这是 ADR 口径下最接近的可运行度量。所以 layout 与命中测试都不是瓶颈；先前基于 dev 浏览器读数（`settle(20)` 的 26.20 + 78.60）推断「layout 一项就超预算」是错的——那是 dev 构建 + DPR 1 + headless GPU 上传混在一起的结果，与 ADR 参考环境（DPR 2）不可横向比。

**已改（门禁断言）**：`e2e/dimension-perf.spec.ts` 现在
1. 保留 `hitP95Ms ≤ 2`（ADR 同口径）；
2. **删掉** `updateP95Ms ≤ 16`（测错东西），改成在 `run()` 之后调 `settle(20)`，断言 `layoutP95Ms ≤ 26.2 × 1.2` 与 `paintP95Ms ≤ 78.6 × 1.2`——基线取 `docs/verification/mbd-perf-baseline-2026-10-29/README.md` 的 `settle(20)` 三次中位数，判「不退化」而不是对 16 ms 硬卡（档位不同，硬卡会误报）；
3. 加 `DIMENSION_PERF_BASELINE_WRITE=1` 出口，换机器时用它打出新基线再更新常量，**不得为放行而调大**。

**实测（2026-10-30，本机）**：门禁通过（1 passed / 4.4 s）。同日读数 `settle(20)` = `layoutP95Ms` **16.70** / `paintP95Ms` **53.40**，比 10-29 基线（26.20 / 78.60）更低——说明那天的读数偏保守，基线留着不动（宁可松一点也不误报），但 W5-5 做分帧时应以今天这组为工作参考。

**仍有两件事没做**：

1. ~~**生产档基线拿不到**~~ → **页面已修（2026-10-30）**：`public/dimension-perf.html` 移到仓库根的 `dimension-perf.html` 并加进 `vite.config.ts` 的 `build.rollupOptions.input`，构建后 `dist/dimension-perf.html` 指向真实的 `assets/dimensionPerf-*.js`，dev 与 `vite preview` 两档都验证能打开。**但生产档数字仍未采到**：首轮在 preview 上跑三次，`layoutP95Ms` 19.30 / 20.80 / 26.90、`paintP95Ms` 83.80 / 79.80 / 106.20，方差过大已作废——测量时另一路正跑两个 `playwright test e2e/version-scrub-perf.spec.ts` + `playwright install` + 30 个 Chrome，CPU 30%。要采须等机器空载。
2. **分帧本身**：`paintP95Ms` 53.40（dev 档空载读数）是这一档的主要成本（`layoutP95Ms` 只有 16.70）。W5-5 的落地形态应该是「把 paint 拆到多帧」或「减少每帧重绘的记录数」，判据是**分帧后单帧 p95 ≤ 16 ms 且总帧数不超过 2 倍**（否则只是把成本摊长，交互变卡）。**这一条仍未动代码**，原因与下一步见下。

### 11.3.1 分帧为什么还没动手（2026-10-30 判断）

**先说结论：现在盲改 `scenePainter.ts` 不合适。** 三条理由：

1. **不知道 paint 内部哪一段贵。** `paint()`（`src/dimension/viewport/scenePainter.ts:1002` 起）的 53 ms 里，已知至少四段成本：① 第一遍 `visitSegments` 只数 `segmentCount`（`:1011-1015`，纯计数）；② `ensureCapacity` + 取 12 个 buffer 视图（`:1019-1035`）；③ 第二遍 `visitSegments` 逐 primitive 写 4 个顶点 / 段（`:1068-1109`）；④ `glyphCaches` 的 miss 填充（`visitPrimitiveSegments` 的 `scene-glyph-run` 分支会调 `font` 取字形）。**没有分段计时，分帧该切哪一刀是猜的**——切错地方只会把成本摊长，正好撞上「总帧数不超 2 倍」那条判据。
2. **分帧会改渲染时序，而 W5-2 / W5-3 / W5-4 的视觉 A/B 都还没做。** 现在改，等后端上线后一次要比对三件事（分帧、短线三档、文字在线上方），任何一个像素差异都定位不到是哪一刀引入的。
3. **`scenePainter.ts` 是渲染核心，1355 行，没有独立的视觉门禁。** 单测能钉住 buffer 内容，钉不住「看起来对不对」。

**正确的下一步顺序**：

1. **先加分段计时（诊断，不改行为）**：在 `paint()` 里对上面四段各打一次 `performance.now()`，只在 dev 探针下收集（与 `window.__dimensionFrameStats` 同思路，生产不挂）。目标是拿到「② / ③ / ④ 各占多少」的实测分布。这一步的产出是数字，不是代码行为变化。
2. **按分布选策略**：
   - 若 ③ 写顶点占大头 → 分帧的正确形态是**按 layout 分批写**：把 `layouts` 切成 N 批，每帧写一批，N 帧后一起上传并 `requestRender`。判据是单帧 p95 ≤ 16 ms、N ≤ 2。
   - 若 ④ 字形缓存 miss 占大头 → 不是分帧问题，是**缓存预热**问题：把 miss 摊到空闲帧，或对已布局的记录提前填充。
   - 若 ① 计数遍历占大头 → 直接消掉这一遍（用上界估算容量 + 写完后截断），根本不需要分帧。
3. **分帧实现完成后再做视觉 A/B**，与 W5-3 / W5-4 分开比对。

**在拿到分段计时之前，这一项的状态是「等诊断」，不是「等排期」。** 诊断本身是一小刀独立工作。

### 11.3.2 分段计时已落地，实测分布出来了（2026-10-30）

诊断钩子已实现并入库（`scenePainter.ts` 的 `onPaintProfile` + `dimensionPerf.ts` 的 `window.__dimensionPerf.paintProfile(passes)`）。设计要点：回调**没挂就不取时间戳**，生产路径零开销；钩子是只读观测，不参与绘制决策。

**实测（2026-10-30，dev 档 `127.0.0.1:3101`，1920×1080，`settle(5)` 预热后 20 次，2 000 条同屏可见）：**

| 段 | p50 | p95 | p50 占比 |
|---|---|---|---|
| `countMs`（① 纯计数遍历） | 7.900 | 10.100 | 14.3% |
| `writeMs`（③ 写 4 顶点/段） | **45.300** | **69.100** | **82.2%** |
| `trianglesMs`（箭头三角） | 1.500 | 2.900 | 2.7% |
| `fillsMs`（标签底） | 0.400 | 1.200 | 0.7% |
| 四段合计 | 55.100 | 83.300 | 100% |

同次 `settle(20)` 的 `paintP50Ms` = 52.800，与四段合计 55.100 对得上（差 2.3 ms 是 `setBlending` 与 map 分配）。**段数 211 651，即 846 604 个线段顶点。**

**结论：主成本是 ③ 写顶点，占 82.2%；④ 字形缓存 miss 已排除**——`countMs` 那遍用同一个 `glyphCaches` 且先跑，write 遍必然全命中，所以 `writeMs` 里没有字形展开成本。§11.3.1 的 ④ 分支（缓存预热）**不适用**。

**但 §11.3 那条「总帧数不超 2 倍」的判据在当前基线下自相矛盾**，必须改口径：

- 按 p95 算，消掉 `countMs` 后 write 仍是 69.1 ms，分 2 帧 = **34.6 ms/帧**，离 16 ms 差 2.2 倍。
- 要单帧 ≤ 16 ms 需要 **5～6 帧**，即总帧数是 5～6 倍，不是 2 倍。
- 所以「单帧 ≤ 16 ms」与「总帧数 ≤ 2 倍」不能同时成立。原判据假设 paint 只有 30 ms 上下，与实测 53～83 ms 不符。

**正确口径**：分帧的目标不是把 paint 塞进 16 ms，而是**把单帧的主线程占用压到不丢帧的水平**（16.7 ms 内完成一次 rAF 回调），允许在后续帧补齐。因此判据应改为「**首帧（可见帧）p95 ≤ 16 ms**，剩余帧在 ≤ 6 帧内补齐，且补齐期间用户可交互」。这条要在动手前先写进 §11.3 替换原判据。

**下一个可省点（未做，需视觉 A/B）**：`writeMs` 里每个段调两次 `offsetVertex`（`scenePainter.ts:538`），每次都新建 `{anchor, offsetPx:[...]}` 对象；211 651 段 = **423 302 次临时对象分配**，而 `writeStrokeVertex` 只是解引用。改成直接传 anchor + offset 标量可省掉这批分配，语义零变化。这是「减少每帧成本」而非分帧，收益待测。

**段数按图元类型的分布（2026-10-30 补测，`segmentsByKind`）**：

| 图元类型 | 段数 | 占比 |
|---|---|---|
| `scene-glyph-run` | 202 108 | **95.5%** |
| `scene-marker` | 3 674 | 1.7% |
| `scene-line` | 3 197 | 1.5% |
| `scene-path` | 2 672 | 1.3% |
| `scene-triangle` | 0 | 0%（走三角缓冲，不产生线段） |

**这条分布把分帧的切法定死了**：`writeMs` 的 83.5% 里，95.5% 的段来自字形，不是线框。所以

- 分帧必须**按 layout 分批**（字形属于某个 layout 的 `scene-glyph-run`），而不是按图元类型分批——按类型切会出现「尺寸线先出来、文字几百毫秒后才到」。
- 「缓存预热」分支彻底排除：`countMs` 那遍已在同一个 `glyphCaches` 上跑过，write 遍全命中，字形**取形**成本为零，成本全在**写顶点**。
- 优化字形顶点写入（例如把 `offsetVertex` 的临时对象消掉、或对整段字形做一次批量写入）比动分帧结构更划算，因为它同时降低总工作量——而分帧只是摊平。

### 11.3.4 消掉计数遍历（2026-10-30 已实现，收益实测）

§11.3.1 的 ① 分支（「计数遍历占大头就直接消掉」）已落地。原第一遍 `visitSegments` 走完整的 `visitPrimitiveSegments`，**对每一段都构造两次 `offsetVertex` 对象**（`scenePainter.ts:538`），只为了把一个数加一——2k 可见下是 40 万次临时对象分配，全被扔掉。

改成 `countPrimitiveSegments`（`scenePainter.ts:708` 起）：只读缓存长度，不构造任何顶点。三个非字形分支直接算：`scene-line` 恒 1、`scene-path` = `(n−1) + 闭合`、`scene-marker` = cross 2 / 圆 20；字形两分支读 `caches.unit` / `caches.screen` 的长度（并顺带预热，供 write 遍全命中）。`finish(vertexCount)` 本来就只设 drawRange，所以容量不需要提前精确知道。

**实测（同机同日，dev 档，20 次，2 000 可见）：**

| 段 | 改前 p50 / p95 | 改后 p50 / p95 |
|---|---|---|
| `countMs` | 7.300 / 10.200 | **1.100 / 2.000** |
| `writeMs` | 42.400 / 70.500 | **38.100 / 45.300** |
| `trianglesMs` | 1.200 / 1.700 | 1.000 / 1.400 |
| `fillsMs` | 0.500 / 0.700 | 0.300 / 0.400 |
| **paint 合计** | **51.400 / 83.300** | **40.500 / 45.300** |

**p50 −21.2%，p95 −45.6%。** `writeMs` 的 p95 掉得比消掉的 `countMs` 还多（70.5 → 45.3），因为不再有 40 万次临时对象触发 GC 抖动。两次独立测量一致（40.5 / 39.8）。

**等价性证据**：`segmentsByKind` 在改动前后逐项相同（`scene-glyph-run` 202 108、`scene-marker` 3 674、`scene-line` 3 197、`scene-path` 2 672），说明计数公式与原遍历对每个图元类型给出同一个数；painter 14 例全绿（含逐顶点值断言），dimension + debug 85 文件 / 746 例全绿。

**门禁**：`DIMENSION_PERF_GATE=1 npx playwright test e2e/dimension-perf.spec.ts` → 1 passed (4.2s)，`paintP95Ms` 53.40 → **47.20**（基线 78.6 × 1.2 = 94.32，余量仍在）。

**同一刀还治了 `updateStyles`**（`c893aca3`）：它为了数顶点也走完整遍历，同样只为拿一个数就构造全部顶点。改成 `countPrimitiveSegments` 后，悬停 / 选中的增量重着色路径不再有这批分配。dimension 全量 78 文件 / 668 例绿。

**剩余成本**：`writeMs` 现在 p50 37.7 / p95 39.7，占 paint 的 **93.5%**，是纯顶点写入，没有可再省的重复计算。往下只能分帧（§11.3.3 的判据）。

### 11.3.5 分帧的设计约束（2026-10-30，实现前的定稿）

分帧不是「把循环切成 N 段」那么简单，两个硬约束必须先解决：

1. **单缓冲会让中间帧露出半成品。** `lineBuffers` 是单份 `BufferGeometry`，分批写就是逐批覆盖同一块显存。中途任何一次渲染都会画出「只画了一部分的尺寸线」——比卡一下更糟。
2. **双缓冲内存不可接受。** 2k 可见下 846 604 顶点 × 12 个属性 × 4 字节 ≈ **67.7 MB**，双缓冲 135 MB。

**定稿方案：分帧期间禁止渲染，完成后一次性 `requestRender()`。** 依据是宿主的渲染模型——`ViewerPanel.vue:3328-3331` 的 `requestRender()` 只是置 `needsRender = true` 再 `scheduleFrame()`，**不是常驻渲染循环**（`renderFrame` 在 `:3333`，由 rAF 调度且检查 `isRendering`）。所以只要分帧期间不 `requestRender`，就不会有任何一帧被画出来，单缓冲分批写是安全的。

**但有一个竞态必须堵**：分帧期间用户拖相机，`DimensionViewport.updateCamera` 会调 `this.input.requestRender?.()`（`dimensionViewport.ts:235`），那一帧就会渲染出半成品。因此 `DimensionViewport` 需要一个 `painting` 标志，`render()` 入口在 `painting` 为真时直接返回（与现有 `if (!this.projector) return;` 同位置），相机失效只记入 `InvalidationSet`，等分帧完成后再消费。

**接线顺序（实现时照此）**：

1. `scenePainter` 增加 `paintAsync(layouts, theme, displayMode, onComplete): SceneDimensionPaintJob`，内部用注入的 `requestFrame`（缺省 `requestAnimationFrame`）每帧写一批 layout；`advance()` 返回是否写完，`finish()` 才 `finish()` 三个 buffer 并置 `dimensionRanges`。
2. `dimensionViewport` 的 layout 分支改调 `paintAsync`，置 `this.painting = true`，`onComplete` 里清标志并 `requestRender()`。
3. `render()` 开头加 `if (this.painting) return;`。
4. 批大小按 §11.3.3 的判据定：首帧 p95 ≤ 16 ms。当前 `writeMs` p95 39.7 ÷ 16 ≈ **3 批**（每批约 13 ms），落在「≤ 6 帧补齐」内。
5. 单测钉三件事：分批后顶点内容与同步 `paint()` 逐位相同；`finish()` 之前 `dimensionRanges` 不变；`cancel()` 不改变已发布几何。

**为什么还没实现**：`scenePainter.ts` 是 1 486 行的渲染核心，分帧要动 `paint()` 主体 + `dimensionViewport` 的渲染时序，而 **W5-2 / W5-3 / W5-4 的视觉 A/B 都还没做**（等后端 18084）。§11.3.1 第 2 条的理由仍然成立：现在改时序，等后端上线后一次要比对四件事（分帧、短线三档、文字在线上方、相机基线），任何像素差异都定位不到来源。**这不是排期问题，是归因问题**——设计已定稿，等视觉 A/B 的窗口。

### 11.3.6 分帧已实现并通过三条判据（2026-10-30）

§11.3.5 的设计已落地。

**实现**：`scenePainter.ts` 把线写入抽成 `writeLineVertices(layouts, from, to, startVertex, …)`，同步 `paint()` 与新的 `paintAsync()` 共用这一份代码——这是「分批结果与同步逐位相同」的结构保证，不是靠两处逻辑对齐。`paintAsync()` 返回 `SceneDimensionPaintJob`（`advance` / `finish` / `cancel` / `remaining`）：`advance()` 每帧写一批，`finish()` 才 `finish()` 三个 buffer 并置 `dimensionRanges`。

**接线**：`dimensionViewport.ts` 的 layout 分支改调 `startBatchedPaint()`，批大小 `ceil(layouts / 3)`；`painting` 为真时 `render()` 入口直接返回；新增 `requestRenderWhenPainted()`，`setProjector` 与 `setDesignToWorld` 两处直接 `requestRender` 都改走它——否则相机动一下就会把半成品画上屏。新布局到来时先 `cancelFrame` 掉在飞的旧作业（否则两批交错写同一缓冲）。

**实测（dev 档，`paintFramed(10, batches)`，2 000 可见，每批单独计时）**：

| 批数 | 单批 p50 | 单批 p95 | max | 整次 p50 |
|---|---|---|---|---|
| 2 | 15.60 | **24.00** | 24.10 | 37.70 |
| **3** | **12.70** | **14.40** | 15.60 | 36.20 |
| 4 | 9.60 | 10.40 | 12.80 | 35.90 |
| 6 | 6.50 | 7.40 | 9.10 | 35.80 |

**按 §11.3.3 三条判据逐项判**（取 3 批）：

1. 首帧预算：单批 p95 **14.40 ms ≤ 16 ms** ✓
2. 补齐帧数：**3 帧 ≤ 6 帧** ✓
3. 不退化：整次 36.20 ms vs 同步 `paint()` 的 37.70 ms，**总工作量没有增加** ✓

**2 批不合格**（p95 24.00 > 16），所以 3 批不是随手取的，是实测下界。再多批（4 / 6）虽然单批更小，但每多一帧就多一次 rAF 往返，而收益已经饱和（35.90 / 35.80 与 36.20 差在噪声内），因此停在 3。

**单测钉住三条性质**（`scenePainter.test.ts` +2 例、`dimensionViewport.test.ts` +1 例）：

- `batches the same vertices as the synchronous paint, publishing only on finish`：40 条记录、批大小 7（不整除），6 批写完；每批后 `drawRange` 仍是 0，`finish()` 后三个 mesh 的**全部顶点属性逐位等于**同步 `paint()` 的结果。
- `leaves the published geometry untouched when a batched paint is cancelled`：`advance(5)` 后 `cancel()` 再 `finish()`，已发布几何与 `getStats()` 一字不变。
- `does not render while a batched paint is only partly written`：分帧中途触发 `setProjector` + `flushProjection`，`requestRender` **一次都不多调**；排空后恢复。

**测试设施修正**：`dimensionViewport.test.ts` 的 `flush()` 原来只跑一个回调，分帧要连跑 3 帧，改成默认排空队列（可传 `maxFrames` 观察中间态）。这是设施问题，不是实现缺陷。

**门禁**：`DIMENSION_PERF_GATE=1 npx playwright test e2e/dimension-perf.spec.ts` → 1 passed，`paintP95Ms` 45.70。**注意探针页走的是同步 `paint()`**（`dimensionPerf.ts:243`），所以门禁数字不受分帧影响，它守的是「同步路径没退化」；分帧收益只在真实视口体现，用 `paintFramed` 单独量。

**仍未做视觉 A/B**：分帧改变了绘制时序，但**像素内容应当零变化**（顶点逐位相同已由单测证明）。真实 BRAN 上的视觉确认仍要等后端 18084，与 W5-2 / W5-3 / W5-4 一起做。

### 11.3.7 分帧的第三个缺陷：早退会吞掉失效原因（2026-10-30 修）

§11.3.6 的 `render()` 早退有个隐蔽后果：`DimensionViewportScheduler` 是**先 `consume()` 再调 `onFrame`**（`invalidation.ts:63-68`），所以早退时那批失效原因已经被从队列里取走了。直接 `return` 等于把它们永久丢弃——分帧期间改主题、换文档、动相机都会静默失效，分帧结束后画面停在旧内容。

**修法**：早退时把原因收进 `deferredReasons`，分帧收尾的 `replayDeferredReasons()` 逐个 `invalidate()` 放回队列。旧作业被新布局作废时直接清空（那次调用本身已是全量布局，原因已被满足），`dispose()` 也清空。

**这条测试写错过三次，值得记下来**，因为它暴露了「测试绿但抓不到 bug」的典型陷阱：

1. 第一版用单条记录 → 批大小 `ceil(1/3) = 1`，一批就写完，**早退分支根本走不到**。回滚修复后测试仍绿。
2. 第二版加 12 条记录让分帧真的跨 3 帧，但只断言「最终主题被应用」→ `setTheme` 自己会 `invalidate`，scheduler 重新调度，掩盖了丢弃。回滚后仍绿。
3. 第三版改成断言**中间那一帧没跑 `layoutViewport`**（证明早退确实发生）**且**排空后多跑一次布局（证明原因被留住）。回滚修复后如期变红：`expected 2 to be greater than 2`。

**教训**：验证「守卫有没有生效」的测试，必须同时断言「守卫被走到」和「守卫之后状态被补救」，只断言最终结果会被其它路径掩盖。修复与测试都用回滚验证过（`dimensionViewport.ts` 临时改成 `void reasons;`，测试变红，再恢复）。

**验证**：`dimensionViewport.test.ts` 13/13、dimension + debug 85 文件 / 750 例全绿、type-check 439/126 新增 0、eslint 0。

### 11.3.8 分帧让 `onFrame` 的 `paintMs` 失真（2026-10-30 修）

分帧把一次全量绘制的成本摊到 3 帧，但 `onFrame` 仍在 `startBatchedPaint()` 返回后立刻上报——那时只写完第一批。结果是 **recorder 收到的 `paintMs` 只有单批的 ~13 ms，而真实总成本是 ~38 ms，低估近 3 倍**。W4-1 的整条基线（以及依赖它的「P95 不退化」判据）都建立在这个数上，所以这不是精度问题，是口径错误。

**修法**：`startBatchedPaint(frameStartedAt, layoutCompletedAt)` 接收计时起点，内部定义 `report()`，在**最后一批写完**（`job.finish()` 之后）才调用；同步降级路径（`remaining() === 0`）也走同一个 `report()`。`paintMs = completedAt - layoutCompletedAt` 覆盖全部批次。

**测试**：用可控时钟（`vi.spyOn(performance, 'now')`，每帧前进 10 ms）驱动 12 条记录 → 3 批 → 断言 `paintMs > 20`。回滚修复（把 `report()` 挪到批次循环之前）后如期变红：`expected [...] to have a length of 1 but got 2`——上报变成 2 次，正好暴露「第一批就报」。

**连带修正**：`createDimensionSystem.test.ts` 的 `flush()` 与 `dimensionViewport.test.ts` 的同名工具一样，原来只跑一个回调；分帧后必须排空队列，否则「等 `onFrame` 被调用」的循环在 layout 完成时就退出了，上报还没发生。两处都改成默认排空（可传 `maxFrames`）。

**这条也说明一件事**：分帧改动会波及所有「一次 paint 就上报」的观测口径。W4-1 的 recorder 是长期工具，它的数字变了要当成回归对待，不能只看测试绿。

### 11.3.10 分帧期间宿主渲染让尺寸层整层消失（2026-10-30 修）

**问题**：`renderOverlay` 只有 `disposed` 一个守卫，而宿主在**每帧**渲染后无条件调它（`ViewerPanel.vue:3301` / `:3304`（`renderFrame` 路径）与 `:3394` / `:3397`（另一条渲染路径），共四处 `renderDimensionOverlay`）。`paintAsync` 起手不设 `drawRange`，而 `ReusableGeometry.ensureCapacity` 在**增长容量**时会 `new BufferGeometry()` 换一块新缓冲（`scenePainter.ts:359-393`），新几何的 `drawRange` 默认 `Infinity`。

所以分帧的 1～2 帧里，只要相机在动（用户拖一下、惯性滑动、`controls` 的阻尼帧），宿主那帧就会：
- 若容量没变 → 画出上一帧遗留的 `drawRange` 加一半新顶点；
- 若容量变了 → 按 `Infinity` 画出整块**未初始化**的顶点（垃圾三角形）。

两种都是可见缺陷。§11.3.5 当时写的「单缓冲禁渲染」只挡住了 `render()` 里的 `requestRender`，**漏掉了宿主这条无条件调用路径**。

**修法**：`renderOverlay` 入口若 `painting` 为真，先调 `finishBatchedPaintNow()` 把剩余批次**一次写完**（`while (!job.advance(batch)) {}` → `finish()`），再照常画。这等价于「这一次分帧退化成同步」：多花一帧时间，但画面与几何永远一致。

**为什么不是直接 `return`**：宿主这帧的主场景已经画完了，尺寸层这个 pass 若跳过，那帧就是**整层消失**（空白闪烁）。半成品与空白都不接受，而「这一次不分帧」是唯一不产生可见异常的选择。代价有界——只在「用户在分帧的 1～2 帧窗口内动了相机」时发生，正常浏览时 `advance()` 早已排空。

**实现**：新增字段 `pendingPaint: { job, batchLayouts, finish } | null`，把原先内联在 `step()` 里的收尾逻辑提成 `finish()` 供两条路径共用（帧循环走完 / 宿主提前要）。`dispose()` 与「新布局作废旧作业」两处都要清 `pendingPaint`，否则 `finishBatchedPaintNow` 会去推进一个已作废的作业。

**测试**（`finishes the batched paint before drawing when the host renders mid-batch`）：12 条记录 → `flush(1)` 停在第一批之后 → 调 `renderOverlay` → 断言 ① `renderer.render` 被调用 1 次（画了）② `cancelled` 有且只有 1 条（队列里那帧被取消，改同步写完）③ 收尾后 `hitTest` 按刚画出的那帧回答。

**回滚验证**：把守卫改回 `if (this.painting) return;`，测试如期变红 —— `expected "vi.fn()" to be called 1 times, but got 0 times`，即 `renderOverlay` 一次都没画，正是「整层消失」那个现象。

**教训（第三次同类）**：分帧的守卫必须覆盖**所有**「几何被读出去」的出口，不只是自己发起的 `requestRender`。这次漏的是宿主主动拉的那条。审计分帧/异步写入类改动时，正确做法是先列出「谁会读这块缓冲」，再逐个确认。

**验证**：`dimensionViewport.test.ts` 16/16、`npx vitest run src/dimension` 78 文件 / 675 例全绿、全量 `npm test` 422 文件 / 4109 通过、type-check 439/126 新增 0、eslint 0。

**实机零影响证据（2026-10-30）**：修复后在真实 BRAN 上重跑 W5-2 生成器（8022 后端），两个 BRAN × 三档的 `records` / `drawn` / `lodHidden` 与修复前**逐项相同**（24381：21/21/29 条 drawn，42/42/34 条 lodHidden；24383：18/18/18，0 隐藏），且 **六张 PNG 的 SHA256 与修复前的归档逐字节相同**。这证明守卫只改变「分帧窗口内宿主提前渲染」那一条路径的处理方式，静态画面一个像素没动。

**关于「肉眼确认」的做法说明**：原计划想用 `readPixels` 逐帧采样画布，数「尺寸色像素」是否在某帧掉到 0。两次尝试都超时——headless 下 `gl.readPixels` 读整块或降采样窗口都会把页面拖死（整块 120 帧 > 400 s，320×180 降采样仍 > 300 s），且 `__dtxViewer` 之外的内部挂载点（`dimensionSystem`）没有暴露到 `window`，取不到 `overlayScene` 直接数 `drawRange`。最终改用两条**确定性**证据替代：① 单测断言「分帧中途 `renderOverlay` 会先把剩余批次写完」（回滚能变红）；② 修复前后截图 SHA256 逐字节相同（无副作用）。这两条合起来覆盖了原判据要证明的东西，比不稳的像素采样更可靠。若日后要真做逐帧像素比对，前提是给页面加一个只读的 `window.__dimensionOverlayDebug`（暴露 `painting` 与三个 mesh 的 `drawRange`），那是独立一小刀，未做。

**验证**：`createDimensionSystem.test.ts` 14/14、`dimensionViewport.test.ts` 14/14、dimension + debug 85 文件 / 751 例全绿、type-check 439/126 新增 0、eslint 0。

### 11.3.9 分帧期间 `hitTest` 按新布局回答（2026-10-30 修）

**问题**：`hitIndex` 与 `layouts` 都在 layout 完成时换新（`dimensionViewport.ts:612-614`），但像素要等分帧写完才更新。中间 1～2 帧里用户点到的是**新布局的命中区域、旧画面的像素**——命中的东西屏幕上根本还没出现。消费方是 `ViewerPanel.vue` 的右键测量菜单，表现就是「右键点空处却弹出了某个尺寸的操作菜单」。

**修法**：把索引拆成两份。`pendingHitIndex` 在 layout 完成时接新结果，`paintedHitIndex` 只在 `job.finish()` 发布几何的那一刻提升（同步降级路径 `remaining() === 0` 也提升，否则小图会一直用旧索引）。`hitTest()` 只读 `paintedHitIndex`；`dispose()` 两份一起清空。

**为什么不在分帧期间直接禁用命中**：`ViewerPanel` 把 `hitTest` 返回 `null` 当成「点在空白处」，会走打开新测量的分支。禁用命中等于把误命中换成误操作，方向反了。按已画出的那一帧回答才是屏幕状态的正确镜像。

**测试（第三次才写对，前两次空过）**：
1. 第一版探针点写死 `[960, 540]`。测试投影器只有 400×400，`buildHitIndex` 按 `bounds` 裁剪单元，这个点根本不在任何单元里 → 两次 `hitTest` 都是 `null`，`if (hit)` 守卫把断言整个跳过，**回滚修复仍绿**。
2. 第二版改成「命中结果前缀必须是 `before`」，但两份文档几何不同（`b` 的 x 从 1 改成 2），探针点落在其中一份外面 → 仍然 `null`，仍然空过。
3. 定稿：两份文档**几何完全一致、只有 id 前缀不同**，探针点取自**已画那一帧的 `hitRegions[0]`**（`segment` 取 `from`，`rect` 取左上角），并先断言「这个点确实能命中 `before-1`」再往下走。回滚修复后如期变红：`expected 'after-1' to be 'before-1'`。

**教训（与 §11.3.7 同一类）**：几何类测试的探针点不能手写，必须从被测对象自己的输出里取；并且要有一条「探针有效」的前置断言，否则「两次都返回 null」会让整条测试静默失效。空过的测试比没有测试更危险。

**验证**：`dimensionViewport.test.ts` 15/15、`npx vitest run src/dimension` 78 文件 / 674 例全绿、type-check 439/126 新增 0、eslint 0。

### 11.3.3 W5-5 判据重述（2026-10-30 自决，动手前置条件）

§11.3 原文的判据是「**分帧后单帧 p95 ≤ 16 ms 且总帧数不超过 2 倍**」。§11.3.2 的实测证明这两条在当前基线下**不能同时成立**：光 `writeMs` 的 p95 就有 69.1 ms，分 2 帧是 34.6 ms/帧，要压到 16 ms 需要 5～6 帧。原判据隐含假设 paint 只有 30 ms 上下，与实测 53～83 ms 不符。

**自决：判据改为下面三条，替换原判据。** 理由：分帧的目标不是把整次 paint 塞进一帧，而是**让主线程每帧都还能回到 rAF**，允许后续帧补齐内容；判据要能表达「不卡」，而不是「一帧画完」。

1. **首帧预算**：分帧后**第一帧**的 paint p95 ≤ 16 ms（这一帧只做 `countMs` + 首批写入，必须轻）。
2. **补齐帧数**：从首帧到内容完整 ≤ **6 帧**（≈100 ms @60 Hz）。依据是 §11.3.2 的 p95 合计 83.3 ms ÷ 16 ms ≈ 5.2，取整到 6。**这一条替代原来的「≤ 2 倍」**——2 倍是拍的数字，没有实测支撑。
3. **不退化**：门禁 `settle(20)` 的 `paintP95Ms` 仍须 ≤ 78.6 × 1.2（§11.3 已入库的断言保持不动）。分帧把工作摊到多帧，但**总工作量不得增加**，所以这条仍然守得住。

**追加约束（不许绕）**：分帧期间**不得出现半成品可见帧**。单缓冲分批写会让中间帧渲染出只画了一部分的尺寸线——那比卡一下更糟。因此分帧必须配合「写完整批后才 `requestRender`」或双缓冲，二者择一，在实现前先写清选哪个及内存代价（双缓冲在 211 651 段 × 4 顶点 × 12 个属性下要翻倍显存，需先算）。

**R5（门禁默认 skip 会漏到线上）**：**已裁决，保持默认 skip 不接 CI**，理由与替代守门人见 §10 第 29 刀下方的「R5 裁决」段。

### 11.4 未决问题（2026-10-30 更新：U1 / U4 已自决，U2 / U3 待办）

用户 2026-10-30 明确指示**不使用 CT 窗口**，因此 §11 原定的四条裁决由本会话自己拍：

| # | 问题 | 结论 |
| --- | --- | --- |
| U1 | Q5 三档 0.5 / 0.8 / 1.5 与 tier 的对应关系 | **已自决并实现**：secondary 0.5 / primary 0.8 / detail 1.5，未声明按 primary。理由与后果见 §11.1，行为由单测钉住（`e419a2f6`） |
| U4 | `labelPresentation` 放 kernel 契约还是 MBD mapper 层 | **已自决**：放 kernel 的 `ExplicitLayoutInput`（`types.ts`）。理由：`above` 要沿**屏幕法向**抬，mapper 层拿不到投影；放 kernel 是唯一不重复实现投影的地方。字段可选 + 默认等于现状，风险有界。**故意不接 mapper**，线上零变化（`e419a2f6` 之后这一刀） |
| U2 | 是否把 `updateP95Ms` 断言换成 `settle` 分位（会让门禁直接变红） | **已自决并实现**：换成 `settle(20)` 的 `layoutP95Ms` / `paintP95Ms`，判「不高于基线 × 1.2」。门禁**没有变红**——同日实测 16.70 / 53.40，低于基线。见 §11.3 |
| U3 | 基线要不要在**生产构建**上重测 | **部分自决**：生产档**拿不到**（`public/dimension-perf.html` 指向 `/src/debug/dimensionPerf.ts`，生产构建下页面是坏的，README 第 8 条）。改用两个替代锚点：ADR 口径的内核基准（layout+collision p95 = 3.746 ms，达标）+ dev 档 `settle(20)` 的不退化判据。**要真拿生产档数字，得先把性能页做成构建入口——独立一小刀，未做** |

**U2 / U3 的最终结论**：layout 的 16 ms 预算由内核基准守住（p95 3.746 ms）；浏览器门禁改判「不退化」。上轮基于 dev 浏览器读数推断的「layout 超预算」是错的，已在 §11.3 更正。

### 11.5 2000 条规模上的分帧风险清单（2026-10-30 只读侦察）

当前分帧的全部实测都在 **63 条 / 18 条** 的真实 BRAN 上做（`24381_145018` / `24383_91813`，段数 211 651、顶点 846 604）。按 2000 条外推之前，先把这条路径上会先炸的点列清楚。**这一节只报事实与风险，不含方案。**

**先说清一个口径错误**：`211 651 段 / 846 604 顶点` 不是 63 条真实 BRAN 的数字，而是 `src/debug/dimensionPerf.ts:88-92` 的**2000 条合成场景**（`VISIBLE_USER = 1_500` + `VISIBLE_EXTERNAL = 500`）。所以「105.8 段/条」是合成场景的平均值，真实 MBD 记录的单条段数**没有入库记录**，外推必须按「段/条」重算。

| # | 风险 | 证据 | 用户可见表现 |
| --- | --- | --- | --- |
| 1 | `glyphCaches.screen` **无上限、无淘汰**（`scenePainter.ts:680-689`），key 含浮点 `capHeightPx` 与 `rotationRad`，真实数据下几乎每条记录都是新 key；淘汰点只有 `:1710-1711` 的 `dispose()` | 单次全量布局新增 2 000～6 000 条 key × 约 120～150 B ≈ **8～30 MB**；相机连续拖动每秒数十次 → 秒级 0.5～1.8 GB | 拖相机十几秒后内存暴涨、GC 长停顿，最终 `RangeError: Invalid array buffer length` 或标签页 OOM |
| 2 | 真实记录段数远超 105.8 段/条时，容量跨到 2^21 / 2^22（`ensureCapacity` 按 2 的幂倍增，`scenePainter.ts:341-345`） | 200 段/条 → 160 万顶点 → capacity 2 097 152 → line 缓冲 **100 MB**；300 段/条 → **201 MB**。单批 p95 按 51 μs/千顶点线性外推：14.4 → 27 → 41 ms | 3 帧补齐变成 3 次连续掉帧，外加一次 100 MB 量级的 `Float32Array` 分配停顿 |
| 3 | `paintAsync` 起手**不主动把 `drawRange` 归零**，只有 `ensureCapacity` 真的增长时才顺带设 `(0,0)`（`:360` 早退分支不动 drawRange）。`dimensionViewport.ts:219-220` 的注释声称「起手就归零」，**与代码不符** | 容量已够时（第二次及以后的所有布局），`drawRange` 保持上一帧发布时的完整计数，而顶点缓冲正被逐批覆盖 | 若守卫失效，画的是「前几批新顶点 + 剩余旧顶点」的混合体 —— 尺寸线错乱成新旧两套交叠的乱线，比空白更难判断 |
| 4 | `finishBatchedPaintNow()` 的 `pendingPaint === null` 分支（`dimensionViewport.ts:723-729`）只把 `painting = false` 就返回，**不补写、不 replay**；`step()` 里 `job.advance()` 一旦抛异常（`:702`），`painting` 会永久停在 `true` | 此后 `render()` 全部早退、`requestRenderWhenPainted()` 全部丢弃、`renderOverlay` 每帧在 `while (!advance())` 里再抛一次 | 尺寸层永久冻结在抛异常前那一刻，任何主题 / 文档 / 相机变更都不再上屏，控制台每帧刷异常 |
| 5 | `writeLineVertices` 写顶点**无边界检查**（`scenePainter.ts:1493-1504` 直接下标写）；`countPrimitiveSegments` 与 `visitPrimitiveSegments` 一旦对某个图元给出不同段数，写入就越界 | typed array 越界写**不抛异常、静默丢弃** | 「部分尺寸线缺一段」，没有任何报错。当前两者一致（marker 圆 20、framed glyph `unit.length * 2`），但这是隐式契约，没有断言守着 |
| 6 | `startBatchedPaint` 取消旧作业时**没有调用 `job.cancel()`**，且 `step` 闭包无 job 身份校验（`dimensionViewport.ts:655-663` / `:699-707`） | 旧 `step` 若在 `cancelFrame` 未生效时被调用，会先抹掉新 job 的 `paintFrameId`，然后两个 job 交错推进 `lineVertexIndex` | 极端情况下（快速连续拖相机 + 一次布局跨 3 帧）出现一帧顶点错乱的尺寸线，或画面停在上一布局几帧 |

**按可能性排序，最可能先炸的三个**：

1. **字形缓存无上限**（必然发生，只要拖相机）。验证：dev 环境绕轨 10 秒，Chrome Memory 快照对比两次的 `Map` retained size；或临时在 `scenePainter.ts:688` 后打 `caches.screen.size`，观察它随相机移动单调上升且永不回落。
2. **真实记录段数超标**。验证：在真实 BRAN 上读 `window.__dimensionPerf.paintProfile(20)` 的 `segmentCount` 与 `segmentsByKind`（钩子已在 `src/debug/dimensionPerf.ts:336-379`），把 `segmentCount / 记录数` 与 105.8 对比；同时 `paintFramed(10, 3)` 看 `batchP95Ms` 是否仍 ≤ 16。
3. **分帧窗口内 `painting` 卡死或混合缓冲上屏**。验证：在 `renderOverlay`（`dimensionViewport.ts:225`）与 `finishBatchedPaintNow`（`:723`）各加一行 `console.assert(this.painting === (this.pendingPaint !== null))`，2000 条规模下反复快速拖相机 30 秒，捕捉断言失败；并录屏逐帧检查拖动过程中是否出现「新旧两套尺寸线交叠」或「只剩箭头和标签底、线消失」的单帧。

**下一步的真实 2k BRAN 从哪来**：`docs/verification/mbd-3d-dimension-presentation-2026-09-12/all-pipes-brans.json` 记录了全项目 **2 693 个 BRAN / 2 469 个 HTTP 200**，带每个的 `primitives` 与按类型的 `kinds` 计数。其中 `linear_dim` 最多的是 `24381_105860`（463 primitives / 75 linear_dim），`slope_mark` 最多的是 `24383_75125`（341 / 23）。**要凑 2000 条记录得选多条 BRAN 同屏，单个 BRAN 最多只有 463 个图元** —— 这一点先要定清「2k 记录」的口径是单 BRAN 还是多 BRAN 叠加，否则验证目标本身就是错的。

### 11.6 分帧的行为契约测试（2026-10-30）

分帧此前只有「四条缺陷各自一条回归测试」，缺一条**正面**的结构契约：批大小和批数可以随性能预算调整，但「中间帧不发布几何」「末帧与同步 `paint()` 等价」这两件事一变就是回归。

新增 `keeps every batch unpublished until the last one lands`（`dimensionViewport.test.ts:516-620`）：40 条记录、逐帧推进，断言 ①布局帧 `drawRange.count === 0`；②每个 paint 中间帧 `drawRange.count === 0`（实测值，`ReusableGeometry.ensureCapacity` 换新几何时 `setDrawRange(0,0)`，只有 `finish()` 才写真值）；③**paint 帧数 ≥ 2**；④末帧 `position` 前 `lineVertexCount * 3` 个浮点与独立 `ThreeSceneDimensionPainter` 同步 `paint()` 逐位相同，且两边 `drawRange.count` 相等。

**写这条测试时踩到一个会让整条契约空过的坑（重要）**：第一版把「帧数 ≥ 2」数成**总帧数**。但 layout 本身就是一帧，所以哪怕批大小被改成 `layouts.length`（一批写完），总帧数仍然是 2，断言照样通过。实测证据：正常批大小下 `frames=4 / midPaintSamples=3`；改成单批后 `frames=2 / midPaintSamples=1`，而**两种情况下中间帧的 `drawRange.count` 都是 0**——中间帧断言也拦不住。定稿改成**只数 paint 帧**（先 `flush(1)` 单独消化 layout 帧并断言此时未发布），下界 2。回滚验证如期变红：`分帧必须让 paint 本身跨帧：paint 只有一帧说明一批就写完了，契约没被走到: expected 1 to be greater than or equal to 2`。

**这是本轮第四次「测试空过」**（前三次见 §11.3.7 / §11.3.9 / §11.3.10）。共同形态是：**断言的量与实现的可变部分耦合**（帧数含 layout 帧、探针点手写、只断言终态不断言中间态）。定稿的写法是「先把不可控的部分单独消化掉，再对真正要钉的量设下界，并额外断言这个量被真的观测到了」。

**验证**：`dimensionViewport.test.ts` 17/17、`npx vitest run src/dimension` 78 文件 / **680 通过**、eslint 0。

### 11.7 W5-5 的剩余一件事：2k 记录规模上的真实确认

分帧的正确性（顶点逐位相同、中间帧不发布、宿主提前渲染先写完）已由单测钉住，像素零变化已由真实 BRAN 截图 SHA256 逐字节相同证明。**仍缺的是「2k 记录同屏」这个规模本身**：现有真实 BRAN 只有 63 条 / 18 条记录，而 §11.5 列出的六个风险全部只在 2k 量级才显形（尤其是字形缓存无上限那一条，拖相机十几秒就会涨到 GB 级）。

**要先定清口径**：单个 BRAN 最多只有 463 个图元（`24381_105860`），所以「2k 记录」必然是多 BRAN 叠加或合成场景。这两个口径的结论不能互换——合成场景的段数分布（105.8 段/条）与真实 MBD 记录无关，真实记录单条段数可能高一个数量级。**在这个口径定下来之前，不要拿合成场景的读数当「2k 真实 BRAN 通过」的证据。**

**口径实测（2026-10-30，两条独立的量法，结论以第二条为准）**：

第一次是按 `all-pipes-brans.json` 的 `kinds` 计数，只数了「会产生独立 `DimensionRecord`」的三类（`linear_dim` + `slope_mark` + `weld_mark`）：

| 量（**错误口径**） | 值 |
| --- | --- |
| 单 BRAN 最多记录数 | 97（`24381_105860`，图元 463） |
| 全部 2 469 个 BRAN 记录合计 | 18 045 |
| 平均每 BRAN | 7.3 条 |

**这个口径是错的。** 走一遍 `mbdV2ExternalAnnotations.ts:943-1057` 的分支就明白：`label` / `aid_text` / `aid_line` / `leader_line` / `aid_point` / `aid_arc` / `aid_circle` / `angle_dim` **每一个都产出记录**（`explicitRecord(...)`），不是只有那三类。所以「记录数」几乎等于「图元数」。

第二次直接跑 mapper（`npx tsx .planning/probe-2k-batches.ts`，从 8022 拉真实数据、`mbdV2ToExternalRecords` 的 `records.length`）：

| 量（**真实口径**） | 值 |
| --- | --- |
| 单 BRAN 最多记录数 | **422**（`24381_105860`，466 图元） |
| 次高 | 410（`24381_105733`）、314、311、297 |
| 32 个最大 BRAN 合计 | 7 934 条记录 / 8 923 图元 |
| 平均每 BRAN（32 个里） | 247.9 条 |
| **凑到 ~1 700 条记录** | **只需 5 个 BRAN** |
| 凑到 2 000 条记录 | 约 6 个 BRAN |

所以「2k 记录」在真实数据里**不需要 32 个 BRAN 叠加**，5～6 个就够。一个管道包带 5 个 BRAN 是常规用法，**这个量级是真实可达的业务场景，不是极端压测**。

### 11.7.1 2k 量级的实测读数（2026-10-30）

`npx tsx .planning/probe-2k-batches.ts`（`PROBE_BRAN_COUNT=5`，5 BRAN / 1 707 条记录 / 1920×1080 dpr=2 / Ryzen 9 7950X）：

| 量 | 值 |
| --- | --- |
| 布局 + 碰撞 p50 | 2.69 ms（32 BRAN / 7 934 条时 p95 47.7 ms） |
| 段数合计 | 397 480（32 BRAN）/ 约 85 000（5 BRAN 外推） |
| **每条记录段数** | **均值 50.1**、采样 p50 = 0、p95 = 353、max = 371 |
| 段数按类型（32 BRAN） | `scene-glyph-run` 393 463（**98.99%**）、`scene-line` 3 137、`scene-marker` 748、`scene-path` 132、`scene-triangle` 0 |
| 线顶点数（32 BRAN） | 1 589 920 → capacity **2 097 152（正好 2^21）** → 线缓冲 **96 MB** |
| 冷缓存 paint p50 / p95（5 BRAN） | 59.8 / 79.7 ms |
| **热缓存 paint p50 / p95（5 BRAN）** | **32.2 / 47.3 ms** |
| 冷缓存 paint p50 / p95（32 BRAN） | 289 / 327 ms |
| 热缓存 paint p50 / p95（32 BRAN） | 146 / 187 ms |
| 跑完后的字形缓存 | `{screen: 264, unit: 61}`（5 BRAN）/ `{screen: 1178, unit: 297}`（32 BRAN） |

**三条重要结论**：

1. **`p50 = 0` 的段数分布说明「记录数」不是成本单位。** 一半以上的记录（`aid_point` / 空 label 之类）零段或极少段；成本集中在少数带字形的记录上（p95 = 353 段、max = 371）。所以按「条数」定批大小是错的量。
2. **99% 的段来自字形**。这解释了为什么热缓存把 paint 从 59.8 ms 降到 32.2 ms（−46%），也说明 §11.10 的字形缓存量化是这一轮收益最大的一条。
3. **32 BRAN / 7 934 条记录会撞上 2^21 容量边界**（1 589 920 顶点 → capacity 2 097 152 → 96 MB 线缓冲）。这是 §11.5 风险 2 的真实形态，不是假想。

**分帧批大小实测（5 BRAN / 1 707 条记录，热缓存，单批增量）**：

| 批数 | 批大小 | 单批 p50 | 单批 p95 | 单批 max | 总计 p50 |
| --- | --- | --- | --- | --- | --- |
| **3（当前实现）** | 569 | **10.4 ms** | **13.0 ms** | 13.0 ms | 30.9 ms |
| 4 | 427 | 6.3 ms | 10.1 ms | 10.1 ms | 28.8 ms |
| 5 | 342 | 5.7 ms | 9.9 ms | 9.9 ms | 28.9 ms |
| 6 | 285 | 6.3 ms | 9.5 ms | 9.5 ms | 32.6 ms |
| 8 | 214 | 5.1 ms | 9.0 ms | 9.6 ms | 43.8 ms |
| 12 | 143 | 1.7 ms | 8.3 ms | 8.9 ms | 37.8 ms |

**当前 `ceil(n/3)` 在 2k 记录上达标**（p95 13.0 ms ≤ 16 ms），且批数最少、总帧数最少（3 帧补齐，远好于 §11.3.3 判据的 6 帧上限）。**不需要改批大小。**

但**32 BRAN / 7 934 条记录的极端情况不达标**：3 批时单批 p95 是 67.9 ms（冷缓存）／需要 24 批以上才能压到 12.25 ms。那是 4 倍于 2k 的量级，是否属于目标场景需要业务确认（一个管道包通常不会有 32 个 BRAN）。

**量法上的一个坑（记下来）**：第一版扫描把 `startedAt` 放在循环外，`perBatch.push(now - startedAt)` 推的是**累计时间**而不是单批增量，读出来的「p95」是第 N 批的累计值，看起来像每批都很贵（batches=48 时 p50 报 79.85 ms，实际单批只有 0.15 ms）。**批耗时必须量增量。**

**复现方式**（脚本一次性、不入库）：从 8022 拉 `/api/mbd/v2/pipe/{refno}`，`mbdV2ToExternalRecords` → `normalizeExternalDimension` → `layoutDimension` → `resolveLabelCollisions` → `ThreeSceneDimensionPainter.paint` / `paintAsync`，`PROBE_BRAN_COUNT` 控制叠加几个 BRAN。两次独立运行的结果：3 批 p95 分别为 13.0 / 13.9 ms，热缓存 paint p50 32.2 / 27.7 ms，可复现。

**结论落定**：

- 「2k 记录」= **5～6 个 BRAN**，是常规业务场景，不是极端压测。此前的「32 个 BRAN」是错口径导致的误判。
- 当前 `ceil(n/3)` 的批大小在 2k 记录上**达标**（p95 13.0～13.9 ms），**不需要改**。
- 32 BRAN / 7 934 条记录（4 倍量级）不达标，且会撞 2^21 容量边界（96 MB 线缓冲）。**是否属于目标场景待业务确认**——一个管道包通常不带 32 个 BRAN。
- 99% 的段来自字形，热缓存是必答题（§11.10 已做）。

### 11.8 W5-1 G9 坡度符号 —— 侦察结论（2026-10-30），裁决材料已备齐，裁决本身待做

W5-1 要裁决 G9：PML 用三角形，Web 用线 + 箭头。裁决前先把 Web 侧现状摸清。

**数据流（8 步，全部核实）**：`src/api/mbdV2Api.ts:136` `fetchMbdV2PipeData`（路径 `:144` `/api/mbd/v2/pipe/{refno}`）→ `src/components/dock_panels/ViewerPanel.vue:2864` 注入 `fetchPipeData` → `src/composables/useMbdExternalSync.ts:184` 取包、`:188` `mbdV2ToExternalRecords` → `src/dimension/adapters/mbdV2ExternalAnnotations.ts:899` 映射（坡度分支 `:1057-1071`）→ `useMbdExternalSync.ts:220` `replaceExternalSource('mbd', …)` → `createDimensionSystem.ts:337-339` → `dimensionViewport.ts:543` → `layoutViewport.ts:47,76` → `layoutDimension.ts:74` → `layout/explicit.ts:386` `layoutExplicit`（笔画在 `:426-431`）→ `viewport/scenePainter.ts` 的 scene-line / scene-triangle 两条通道。

契约来源 `mbdV2Contract.ts:305-317` `MbdV2SlopeMark`（`text` / `start` / `end` / 可选 `text_dir`），校验 `:588-592`，strict 白名单 `:617` `slope_mark: ['text','start','end','text_dir']`。

**当前符号形状**：`mbdV2ExternalAnnotations.ts:1057-1071` 输出 `lines: [{ from: start, to: end, part: 'dimension' }]` + `arrowLines: slopeArrowLines(start, end)`，`labelAnchor` 取中点，`lod: { tier: 'detail' }`。箭头翼由 `:229-251` 生成，常量在 `:65-66`：`SLOPE_ARROW_LENGTH_RATIO = 0.08`、`SLOPE_ARROW_HALF_ANGLE_RAD = 20°`，即「翼长 = 0.08 × 字高、半张角 20°」。

**关键事实：走的是描边通道，不是实心三角**。`arrowLines` 在 kernel 里是描边（`layout/explicit.ts:299-325` `explicitArrowLine` → `makeSceneLine(..., 'arrow', …)`，即 `SceneLine`）。实心三角走另一条路（`ExplicitArrowInput` → `explicit.ts:327-349` `explicitArrow` → `makeFilledSceneArrow`，`sceneGeometry.ts:287-321`，`kind: 'scene-triangle'`），**坡度完全没用这条路**——`explicitRecord` 的 `arrows` 字段压根没给（`mbdV2ExternalAnnotations.ts:319-321` 只在非空时才写）。

**三角形在 Web 侧零痕迹**：`src/` 内搜 `wedge` / `slopeTriangle` / `slope_triangle` **零命中**；`triangle` 的命中全是无关项（`scenePainter.ts:286-334` 的 TRIANGLE_* shader、`genModelV1Api.ts:2755` 的 `triangle_count` 网格面数、room-clip / clearance 的三角面求交）；`G9` 只在 docs 里出现。

**PML 三角形在仓库内无规格**。全仓只有两句二手转述：`docs/plans/2026-07-29-mbd-dimension-annotation-capability-audit.md:49` 与 `docs/plans/2026-10-28-mbd-3d-dimension-annotation-audit-and-plan.md:111`（后者给出唯一行号线索 `isoline.pmlobj:2564 drawslope`）。ADR 侧只有「由适配层拼装、不加专用原语」的决定（`docs/adr/0042-…:3`），没有形状定义。本机 `D:\work\plant-code\old` 下 `rs-server` / `gen-model` / `vendor-mdb` 均无 `MBD/markpipe` 目录。

**现有测试钉住了什么**：只有 mapper 层一条形状断言会红——`src/dimension/adapters/mbdV2ExternalAnnotations.test.ts:652-655`（`lines` 长度 1、`arrowLines` 长度 2）。同文件 `:614-633`（`lod === { tier: 'detail' }`）、`:289-299` / `:301-350`（`text_dir` 与 `labelAnchor`）语义相关。**不会红**：`explicit.test.ts:180-235`（arrowLines 像素下限，自造输入）、`shared/lod.test.ts:53-95`、`kernel/__snapshots__/goldens.test.ts.snap`（搜 `slope` 零命中，golden 里没有坡度）、`SlopeAnnotation.test.ts` / `SlopeAnnotation3D.test.ts`（测旧类；`SlopeAnnotation3D` 在 `ViewerPanel.vue:150` 被 import 但全仓无 `new SlopeAnnotation3D`，是死引用）。

**可配置性**：形状**硬编码**在 mapper 的模块级常量（`:64-66`，焊缝半径也在同一处，说明「符号几何归适配层」是既定做法），不走 theme。最小侵入挂点已经存在：`MbdV2MappingOptions`（`:60-62`）+ `?mbd_label=above` 那套 `parseXxx` 模板（`useMbdExternalSync.ts:117-119`）可原样复制成 `parseSlopeSymbol`。若要走实心三角，kernel 现有 explicit 输入没有对应原语（`types.ts:150` `ScreenMarkerShape` 只有 `'circle' | 'cross'`，`ExplicitLayoutInput` 无 fill 字段），需额外成本；用描边三角（三条 `lines` 或三条 `arrowLines`）则无需碰 kernel。

**裁决 G9 仍缺的 7 条信息（仓库内查不到，必须问人或看 PML 实物）**：

1. PML `drawslope`（`isoline.pmlobj:2564` 附近）的实际几何：三角形**实心还是描边**、边长与 `cheight` / 管径的关系、直角三角形还是等腰、斜边是否就是 slope 线、箭头尖朝哪端。
2. 三角形与 `slope X%` 文字的相对位置（文字在三角形内 / 上方 / 旁边；是否随 `ori` 旋转）。
3. 坡度符号是否依附 `aid_line`（`…:slope:rise:…` 的两腿）：现有 fixture 把 `slope:rise` 当独立 `aid_line`，但 PML 里三角的两条直角边是否由 solver 单独输出、还是仅由 `slope_mark` 的 start/end 隐式确定——仓内无法判定。
4. 负坡 / 零坡（水平管、`i=0%`）时 PML 画什么：三角形退化？只出文字？
5. 多段同直段多个 `slope_mark` 时的排布与重叠规则（PML 是否走 polarsystem 避让）。
6. **一份真实 BRAN 的桌面端出图截图**作为判据物：现有 `docs/verification/mbd-3d-dimension-presentation-2026-09-12/` 与 `dimension-camera-baseline-2026-10-29/` 只有 Web 侧截图，**没有 PML 侧对照图**。
7. 裁决归属口径：`2026-07-29-…audit.md:97` 写「按 rs-mbd『语义对齐』词条不要求像素复刻，留金样人工审阅裁决」，但没写清「语义对齐」是否允许形状不同——这条要么引用 rs-mbd 原文，要么由人拍。

**可用的视觉材料**：`all-pipes-brans.json` 里 **318 个 BRAN 有 `slope_mark`**（合计 1 467 个），最密集的是 `24383_75125`（23 个）、`24381_105860`（22 个）、`24381_105733`（21 个）——W5-1 出图直接用这三个，比现在两个基线 BRAN（0 个坡度）合适。生成器已支持 `DIMENSION_CAMERA_BASELINE_REFNOS` 覆盖。

### 11.9 `DimensionTheme` 传递链路审计（2026-10-30，只读）

给 `DimensionTheme` 加必填字段 `aboveRowClearancePx` 之后，必须确认这条链路上没有一处会把它丢掉。**结论：不存在能产出缺字段 theme 对象的路径。**

| 环节 | 位置 | 形态 | 会不会丢字段 |
| --- | --- | --- | --- |
| 类型定义 | `src/dimension/kernel/theme.ts:12`（字段在 `:94` 附近） | `Readonly<{…}>` | — |
| 唯一字面量构造 | `theme.ts:278` `SOLVESPACE_DIMENSION_THEME: DimensionTheme` | 完整对象字面量 + 类型注解 | 少字段编译期就报错，`:303` 已含 `aboveRowClearancePx: 2` |
| 可选注入点 | `facade/createDimensionSystem.ts:138` `theme?: DimensionTheme` | 透传 | `:192` `?? SOLVESPACE_DIMENSION_THEME` 兜底 |
| 视口存引用 | `viewport/dimensionViewport.ts:196-197` / `:168` | 只存引用 | 无解构 |
| layout 上下文 | `dimensionViewport.ts:620-625` → `kernel/viewport/layoutViewport.ts:53-56` `{...baseContext}` | spread 透传 | 无白名单筛选 |
| 分派与缓存键 | `kernel/layout/layoutDimension.ts:18` `WeakMap<LayoutContext['theme'], …>` | 按引用做 key | 不复制 |
| 消费点 | `layout/explicit.ts:656` `context.theme.aboveRowClearancePx` | 直接读 | — |

**运行期覆盖只有 `setTheme(theme: DimensionTheme)`（`dimensionViewport.ts:297-300`），收完整类型不是 `Partial`，全仓无 `updateTheme` / `patchTheme` / 浅合并入口；生产代码零调用者**（唯一调用在 `dimensionViewport.test.ts:369`）。

**测试与调试脚本里的 theme 全部是 spread `SOLVESPACE_DIMENSION_THEME`**（`dimensionViewport.test.ts:365-368`、`dimension3d.test.ts:230`、`tagBillboard.test.ts:287-291` / `:634`、`explicit.test.ts:849-852` 等），没有一份手写完整字面量，因此不会触发「缺字段」类型错误——**反过来说，也没有任何测试在编译期钉住这个新字段**。真正的钉子只有两处：`theme.ts:278` 的 `: DimensionTheme` 注解（编译期）+ `theme.test.ts` 的 `toMatchObject` 里那一行（运行期，本轮已补）。

`ViewerPanel.vue` **不构造也不传 `DimensionTheme`**：唯一的 `createDimensionSystem` 调用（`:2934-2953`）没有 `theme` 字段；该文件里所有 `theme` 标识符都是显示主题（`DisplayTheme` / `SGL_LOOK_PRESETS`），与 `DimensionTheme` 无关。

**唯一的理论缺口在外部注入面**：`createDimensionSystem.ts:138` 若被宿主用 `as DimensionTheme`、`JSON.parse` 反序列化或从 `any` 赋值绕过类型检查，就能塞进缺字段对象。TS 在正常对象字面量写法下会拦住，当前仓库内也没有这样的调用者。

### 11.10 字形缓存：量化 key + 上界 + 最旧淘汰（2026-10-30）

§11.5 风险 1 的修法。**这一条是六个风险里唯一「只要拖相机就必然发生」的**，所以先修它。

**两个缺陷叠加才致命**：

1. **key 含未量化的浮点**。旧 key 是 `[capHeightPx, rotationRad, text].join(':')`。`capHeightPx` 由投影后的像素高度算出、`rotationRad` 由 `atan2` 算出，两者末位每帧都在抖；`join` 又用 JS 默认的数字转字符串（最短往返表示），末位一抖整个字符串就变。于是**每个 key 几乎只被用一次**，`Map` 只增不命中——缓存不但不省算力，还纯亏内存。
2. **`Map` 无上限无淘汰**。唯一的清理点是 `dispose()`（`scenePainter.ts:1710-1711`）。单次全量布局新增 2 000～6 000 条 key × 约 120～150 B ≈ 8～30 MB；拖相机每秒数十次全量布局 → **秒级到 GB**，用户可见的是内存暴涨、GC 长停顿、`RangeError: Invalid array buffer length` 或标签页 OOM。

**改动**（`src/dimension/viewport/scenePainter.ts`）：

- 新增 `screenGlyphCacheKey(primitive)`：`capHeightPx` 量化到 **0.01 px**、`rotationRad` 量化到 **1e-4 rad**（≈0.006°），再拼 `text`。
- 新增 `cachedScreenGlyphSegments(font, primitive, caches)`：命中直接返回，未命中先 trace；若 `size >= screenMaxEntries` 则先删 `keys().next().value`（`Map` 按插入序迭代，第一个就是最旧的）再 `set`。`visitPrimitiveSegments` 与 `countPrimitiveSegments` 两个调用点都改走它，保证「数段数」和「写顶点」看到的是同一份缓存内容——**这两处不一致就是 §11.5 风险 5 越界写的成因**，现在两者共用一个入口，天然对齐。
- 新增 `SCREEN_GLYPH_CACHE_MAX_ENTRIES = 8_192`（推导：约 3 个字形 run/记录 × 2 000 记录 ≈ 6 000，取下一个 2 的幂留余量）；`GlyphCaches` 从 `Readonly<{screen,unit}>` 改为可变记录并加 `screenMaxEntries` 字段，两个调用点共享同一上限。
- 新增只读 `getGlyphCacheStats(): { screen, unit }` 与 `screenGlyphCacheMaxEntries` 的 get/set（生产默认 8 192，测试可压小以验证淘汰）。

**为什么量化不会改变画面**（实测，不是推断）。`glyphSegments()` 把 LFF 轮廓按 `capHeightPx / font.capHeight` 缩放，量化 0.01 px 在局部坐标里被再缩一次，落到屏幕上的位移更小。用 `offsetPx` 属性逐顶点量（`position` 恒为 anchor，**量不出字形差异**，这是写测试时的第一个坑）：

| cap height 差 | `offsetPx` 最大差 |
| --- | --- |
| 13 → 13.004（同桶） | 0.0033 px |
| 13 → 13.05（跨桶，0.05 px） | 0.0417 px |
| 13 → 13.4 | 0.334 px |
| 13 → 26 | 10.84 px |

0.01 px 的量化步长下，桶内最大偏差 0.0033 px，远小于 DPR=2 时的半设备像素（0.25 CSS px）；而真正的差异（0.4 px 字高、翻倍字高）量级大两三个数量级，量化不会把它们并到一起。

**为什么淘汰用 FIFO 而不是 LRU**：`Map` 的插入序天然是 FIFO，命中不刷新顺序。稳定视角下同一批 key 持续命中，不需要「热度」判定；一旦视角变化，整批 key 全部作废重算，FIFO 与 LRU 的行为几乎一致。真要做 LRU 得在每次命中时 `delete` + 重新 `set`，反而给热路径加写操作。

**测试**（`scenePainter.test.ts` 新增 4 条）：

1. `quantizes the screen-glyph cache key so near-identical runs share one entry` —— 13 vs 13.004 / 0.5 vs 0.50004 → 缓存 1 条。
2. `keeps screen-glyph cache entries apart across quantization buckets` —— 差 0.05 px → 2 条（钉住「不许量化过头」）。
3. `evicts the oldest screen-glyph cache entries once the cap is reached` —— 上限 8、插 12 个不同桶 → 恰好剩 8。
4. **`draws sub-bucket jitter from the shared trace, within half a device pixel`** —— 这条是主会话补的。前三条只钉住「缓存条数」，**没有一条钉住「共用一个 trace 之后画出来的东西还是对的」**：把量化改成「所有字高都量化成 13」也能让前三条里两条通过。这条从被测对象自己的 `offsetPx` 输出取探针，先断言「0.4 px 字高差必须被量出来 > 0.1」（探针有效性前置），再断言同桶共享的第二条与它独占绘制时的差 < 0.01 px。

**回滚验证（主会话独立重做三处，不采信 worker 自报）**：

| 改坏的方式 | 结果 |
| --- | --- |
| key 退回未量化浮点 | 测试 1 红（`expected 2 to be 1`）、测试 4 红 |
| `if (caches.screen.size >= caches.screenMaxEntries)` → `if (false)` | 测试 3 红（`expected 12 to be 8`） |
| `Math.round(capHeightPx * 100) / 100` → `Math.round(capHeightPx)`（量化过头） | 测试 2 红（`expected 1 to be 2`）、测试 3 红（`expected 2 to be 8`） |

**门禁**：`scenePainter.test.ts` 20/20、`npx vitest run src/dimension` 78 文件 / **684 通过**（基线 680 + 4 新增）、全量 `npm test` 422 文件 / 4119 通过 / 1 todo、eslint 0、`goldens.test.ts.snap` 零变动。

**`npm run type-check` 的 2 条新增不属于本轮**：`src/viewer/versionBrowseBridge.ts` 与 `.test.ts` 本轮未动，报错是 `VersionBrowseApi` 缺 `browseLayerReady`——工作区里另一路未提交的 `src/viewer/modelUnitCompareController.ts` 刚给对应接口加了该字段。**不得为放行改基线**，等那一路提交后应自动消失。

**仍未解决的**：这个上界只挡住「key 无限增长」，挡不住「单次布局本身就有 6 000 条 key 全部未命中」。首次进入新视角仍要 trace 一遍全部字形——那是必要计算，不是缺陷；但 §11.5 风险 2（真实记录段数超标）与风险 3～6（分帧窗口内的状态机与越界写）都还没修。

### 11.11 分帧状态机：异常自愈 + 作业身份校验（2026-10-30）

§11.5 风险 4 与风险 6 的修法。**这两条叠加起来的后果是「尺寸层永久冻结 + 控制台每帧刷异常」，比缺一段线严重得多**，所以排在字形缓存之后立刻修。

**风险 4 的两条路径**（都在 `dimensionViewport.ts`）：

1. `step()`（`:703-734`）先 `this.paintFrameId = null`，再 `job.advance(batchLayouts)`。若 `advance` 抛出（见 §11.12 的两条真实抛点），`paintFrameId` 已经是 null —— 没有下一帧了；`painting` 仍是 true，`pendingPaint` 仍非 null。此后 `render()` 永远早退并把失效原因堆进 `deferredReasons`，`requestRenderWhenPainted()` 永远丢弃，`renderOverlay()` → `finishBatchedPaintNow()` → `while (!pending.job.advance(...))` 再抛一次。**尺寸层冻结在抛异常前的画面，没有任何自愈路径。**
2. `finishBatchedPaintNow()` 的 `pendingPaint === null` 分支只把 `painting = false` 就 `return`，既不 `replayDeferredReasons()` 也不 `requestRender()`。这一帧攒下的失效原因丢失，且没人请求重绘。

**风险 6**：`startBatchedPaint()`（`:652-663`）取消旧作业时只调了 `cancelFrame`，**没调旧 job 的 `cancel()`**；`step` 闭包也不校验自己还是不是当前作业。宿主若用 rAF 且回调已入队，`cancelFrame` 拦不住：旧 `step` 会先 `this.paintFrameId = null`（**抹掉新作业刚登记的帧 id**），再继续推进旧 job 的 `lineVertexIndex` —— 两个 job 交错写同一块顶点缓冲，而 `finish()` 只在最后一批发布，所以乱序直接上屏。

**改动**（`src/dimension/viewport/dimensionViewport.ts`，+32/−2）：

- **A1** `step()` 的 `job.advance()` 包 try/catch。抛出时：`console.error` 记一条带 `layouts.length` 与错误对象的上下文 → `job.cancel()` → `painting = false` → `pendingPaint = null` → `replayDeferredReasons()` → `input.requestRender()` → `return`（不再 `requestFrame`）。**异常不向上抛**：宿主的 rAF 回调每帧抛一次会让整个 viewer 停摆（`ViewerPanel.vue:3417-3419` 的 `scheduleFrame()` 会被跳过）。
- **A2** `finishBatchedPaintNow()` 的 `pendingPaint === null` 分支补 `replayDeferredReasons()` + `input.requestRender()`。
- **A3** `startBatchedPaint()` 在 `cancelFrame` 之后、`pendingPaint = null` 之前调 `this.pendingPaint?.job.cancel()`。`cancel()` 的语义是「已发布几何保持上一次的好状态」（`scenePainter.ts:1385-1387`），所以作废旧作业不会破坏画面。
- **A4** `step` 闭包第一行（在 `this.paintFrameId = null` **之前**）加 `if (this.pendingPaint?.job !== job) return;`。旧回调即使真跑了也不能碰新作业的状态。

**为什么 A3 与 A4 都要**：A3 让旧作业的 `advance` 变成 no-op（`cancelled` 标志），A4 让旧回调根本不执行。单靠 A3，旧 `step` 仍会把 `paintFrameId` 抹成 null —— 新作业登记的帧 id 丢失，本帧不会再有 `requestFrame`，只能等宿主下一次 `renderOverlay` 补救。单靠 A4，旧作业的 `advance` 在别的路径上（`finishBatchedPaintNow` 的 `while`）仍可能被调用。两者互补。

**测试三条**（`dimensionViewport.test.ts` +202）：

1. `recovers the paint state machine when a paint batch throws` —— 用 `vi.spyOn(painter, 'paintAsync')` 塞一个 `advance` 抛错的假作业。断言：`flush(1)` 不抛出；`job.cancel` 被调用；`console.error` 收到那个错误对象；`requestRender` 被调用；`paintFrameId === null` 且 `pendingPaint === null`；**恢复真 painter 后一次新的 `setDocument` 能重新产出非零 `drawRange.count`**（这一条才是「painting 真的回 false 了」的实证，不能只看字段）。
2. `does not let a superseded paint job callback touch the new job` —— 两份文档 9 条 vs 12 条记录（批次切点错开，交错写入才会落在新作业的发布区间内）。构造「旧作业还在飞时新布局已开始」的窗口（把 `painting` 拨回 false 让 `render()` 能走到 `startBatchedPaint`），断言旧作业 `cancel` 被调用、`pendingPaint.job` 仍是新作业、`painting` 仍为 true，末态 `position` 前 `lineVertexCount * 3` 个浮点与独立 painter 同步 `paint()` **逐位相同**，且 `drawRange.count` 相等。
3. `still requests a render when the overlay draws in a painting state without a job` —— 直接构造 `painting = true` / `pendingPaint = null` / `deferredReasons` 有一条的半状态，调 `renderOverlay`，断言 `requestRender` 次数增加且 `callbacks` 队列变长（`replayDeferredReasons` 真的把原因排回去了）。

**回滚验证（主会话独立重做五处，不采信 worker 自报）**：

| 改坏的方式 | 结果 |
| --- | --- |
| 删掉 A4 身份校验 | 测试 2 红：`expected undefined to be { …(4) }`（旧 `step` 跑 job A 的 `finish()`，把 job B 的登记抹了） |
| catch 里改成 `throw error`（等于没有 try/catch 的净效果） | 测试 1 红：`expected [Function] to not throw an error but 'Error: advance boom' was thrown` |
| catch 里保留 `job.cancel()` 但删掉全部状态复位 | 测试 1 红：`expected "vi.fn()" to be called at least once`（`requestRender` 没被调） |
| 只删 `this.painting = false;` 这一行 | 测试 1 红：`expected 0 to be greater than 0`（后续 `setDocument` 产不出几何——`painting` 卡死的直接证据） |
| 删掉 A3 的 `job.cancel()` | 测试 2 红：`expected "cancel" to be called at least once` |
| 删掉 A2 的两行补救 | 测试 3 红：`expected 1 to be greater than 1` |

**门禁**：`dimensionViewport.test.ts` 20/20、`npx vitest run src/dimension` 78 文件 / **687 通过**（基线 684 + 3 新增）、全量 `npm test` 422 文件 / 4123 通过 / 1 todo、eslint 0。

**这一轮没有修**：§11.5 风险 3（`paintAsync` 起手不主动归零 `drawRange`，`dimensionViewport.ts:219-220` 的注释与代码不符）与风险 5（`writeLineVertices` 无边界检查）——**下一节已修**。

### 11.12 绘制缓冲的两条防线：`drawRange` 起手归零 + 段数越界截断（2026-10-30）

§11.5 风险 3 与风险 5。

**风险 3 的事实**（实测，不是推断）。`paintAsync` 起手的 `lineBuffers.ensureCapacity(lineVertexCount)` 只在**容量真的增长**时返回 true 并换新 `BufferGeometry`；`ensureCapacity` 的早退分支 `if (required <= this.capacity) return false;`（`scenePainter.ts:360`）不动 `drawRange`。新几何在 `:389` 设了 `setDrawRange(0, 0)`，但**容量不变时 `drawRange` 保留上一次 `finish()` 发布的值**。实测：

```
after paint           drawRange = {"start":0,"count":240}
after paintAsync start drawRange = {"start":0,"count":240}
after first advance   drawRange = {"start":0,"count":240}
```

后果：容量不变时（绝大多数情况，新布局顶点数不超过历史峰值）顶点缓冲正被逐批从 index 0 覆写，`drawRange` 却仍指向上一帧的长度。守卫若失效，画出来的是「新批次前缀 + 旧几何尾部」按旧 count 混合的垃圾。**防线要放在产生坏数据的一侧**，不能只靠 `renderOverlay` 的守卫。

- **3a**（`scenePainter.ts`）：`paintAsync` 在 `ensureCapacity` 之后**无条件**调 `this.lineBuffers.clear()`（就是 `setDrawRange(0, 0)`）。三角形与填充缓冲在 `publishLineBatch` 里同样加 `clear()`——那两遍目前是同步的、不会有机会被渲染，但加上之后「写入中的缓冲不可见」这条性质就不再依赖调用时机。
- **3b**（`dimensionViewport.ts`）：把 `renderOverlay` 上方那段与代码不符的注释改成事实陈述（只在容量增长时换空几何；容量不变时 `drawRange` 仍指向上一次的索引数，而顶点已被从头部覆写）。

**副作用与取舍**：`cancel()` 的语义从「已发布几何原样保留」变成「线层空白、三角形/填充仍是上一帧」。原注释写「abandoned job cannot corrupt the last good frame」，现在更准确的说法是「abandoned job blanks the stroke layer instead of corrupting it；下一次 paint 恢复完整帧」。这是**用一帧空白换掉混合顶点**，因为混合顶点看起来像画面坏了，空白看起来像还没画完。`cancel` 只在「上一次分帧还没写完就又来了新布局」这一种情况下被调用（`startBatchedPaint`），正常浏览走不到。

**风险 5 的事实**。`writeStrokeVertex` 直接按下标写 12 个 typed array，无任何上界判断。`Float32Array` 越界写**静默丢弃、不抛异常**（规范里 `IntegerIndexedElementSet` 对无效索引直接返回 true），所以段数算多了的表现是「部分尺寸线缺一段」，没有任何报错。逐分支对照 `countPrimitiveSegments` 与 `visitPrimitiveSegments`，**唯一不一致的是 `scene-path` 且 `points.length === 0`**：count 返回 `(0 − 1) + 0 = −1`，visit 返回 0 次。

- **5a**：`countPrimitiveSegments` 的 `scene-path` 分支改成 `Math.max(0, points.length − 1)`。
- **5b**：`visitSegments` 的 `visit` 回调入口加段级检查 `if (!fitsWithin(lineVertexIndex, 4, capacityVertices)) { overflowed = true; return; }`。`ReusableGeometry` 新增只读 `get vertexCapacity()`。**段级而不是顶点级**：4 个顶点在同一回调里连续写，一次比较足够；2k 可见规模下每帧省约 120 万次比较。
- **5c**：截断后 `paint()` 与 `paintAsync()` 都**发布实际写入数**（不是预算数）并 `console.warn` 一条带 `expected` / `written` / `layouts` 的日志。**不抛异常**——抛出去会走到 §11.11 的 `step()` try/catch，虽然不再冻结，但「因为段数算错就整帧不画」比「缺最后几段线」更糟。代价：`ranges` 里后续布局的 `lineEnd` 会指向不存在的顶点，`updateStyles` 的长度校验持续返回 `false`，退化成每次整幅 `paint()` —— 画面正确，只是慢。

**测试五条**（`scenePainter.test.ts` +158）：

1. `clears the line drawRange when a batched paint starts without capacity growth` —— 先 `paint()` 30 条布局（容量定型），再 `paintAsync()` 同一批（走「不换几何」分支），断言起手、每个中间帧 `drawRange.count === 0`，`finish()` 后等于正确值。
2. `counts an empty scene-path as zero segments, matching the visit pass`。
3. `truncates a line write at buffer capacity instead of writing past it` —— 用 `miscountedLayout()`（`scenePrimitives` 是个 getter：count 那遍看到 2 点路径，之后看到 17 点）制造「count 少算 15 段」的现场；缓冲的 16 顶点下限只容得下 16 段里的前 4 段，断言告警参数 `{expected: 4, written: 16, layouts: 1}`、`lineVertexCount === 16`、`drawRange` 换算后是 24。
4. `publishes only the written vertices when a batched paint truncates` —— 同一现场走 `paintAsync()`。
5. `bounds a segment quad write against the line buffer capacity` —— `fitsWithin` 的边界值。

**第二次「测试空过」（本轮第五次）**：第 2 条初版只断言 `lineVertexCount === 0` 与 `drawRange === 0`。把 5a 改回 `points.length − 1` 之后**它仍然通过**——因为 5c 让发布数改用「实际写入数」，count 算成 −1 之后写入仍是 0 个顶点、发布仍是 0，**症状被下游完全掩盖**。定稿改成从 `onPaintProfile` 的 `segmentCount` 与 `segmentsByKind` 取探针（那是 count 那遍唯一的直接输出），回滚后如期变红：`expected -1 to be +0`。

**回滚验证（主会话独立重做五处）**：

| 改坏的方式 | 结果 |
| --- | --- |
| 删 `paintAsync` 里的 `lineBuffers.clear()` | 测试 1 红（`expected 840 to be +0`）、`leaves the published geometry untouched when a batched paint is cancelled` 也红（`expected 1260 to be +0`） |
| `scene-path` count 改回 `points.length − 1` | 测试 2 红（`expected -1 to be +0`） |
| `fitsWithin` 的 capacity 换成 `Infinity`（等于没有检查） | 测试 3 红（告警没被调用）、测试 4 红（`expected 64 to be 16`） |
| `paint()` 改回 `finish(lineVertexCount)` | 测试 3 红（`expected 4 to be 16`） |
| `paintAsync()` 的 `finish` 改回传 `lineVertexCount` | 测试 4 红（`expected 4 to be 16`） |

**门禁**：`scenePainter.test.ts` 25/25、`npx vitest run src/dimension` 78 文件 / **692 通过**、全量 `npm test` 422 文件 / 4128 通过 / 1 todo、eslint 0、`npm run type-check` 439/126 新增 0。

**至此 §11.5 的六个风险里，1（字形缓存）、3（`drawRange`）、4（状态机卡死）、5（越界写）、6（作业交错）已修；只剩 2（真实记录段数超标）需要真实 2k 规模的数据，见 §11.7 的口径统计。**

### 11.13 `job.advance()` 真会抛异常的两条路径（2026-10-30，只读侦察）

§11.11 的 A1 不是纯理论防御——`advance()` 确实会抛。把 `paintAsync` 起手计数与 `writeLineVertices` 两条路径逐个点查过，**真正会抛的只有两处**，其余「看起来会抛」的地方都不抛：

| 检查点 | 位置 | 判定 |
| --- | --- | --- |
| `lineBuffers.array(name)` | `scenePainter.ts:395-399`、`:1507-1518` | **不抛**。`specs`（`:319-332`）与 12 次 `array()` 调用名逐一对应，`ensureCapacity` 用同一份 `specs` 重建 attribute（`:364-372`），`getAttribute` 永远命中 |
| typed array 越界写 | `:1521-1546`、`:1417-1435` | **不抛**，静默丢弃（见下） |
| `layouts[index]!` 越界 | `:1550`、`:1422` | **不抛、不可达**。`to = Math.min(layouts.length, written + count)`，`index ∈ [from, to)` |
| `layoutAlpha` | `:1552`、`:1424` → `:851-860` | 只在主题缺 `inspection.occludedAlpha` 时抛 `TypeError`；§11.9 已证明不存在缺字段 theme 路径 |
| `createColorResolver` / `srgbComponents` | `:1519`、`:833-836` | **不抛**。`new Color(hex)` 对未知模型/非法 hex 只 `console.warn` 并保持白色（`node_modules/three/src/math/Color.js:236-269`）；`theme.colors[role] ?? theme.colors.normal` 取不到时 `Color.set(undefined)` 走 `if (value && value.isColor)` 为假，什么也不做 |
| `strokeWidthPx` / `resolveTagToneStrokeWidth` | `:1564`、`theme.ts:436-453` | **不抛**，switch 无 default 时返回 `undefined` → `Math.round(undefined)` 得 `NaN`，静默写进 buffer |
| **`font.trace()` / `font.getWidth()`** | `:447`、`:450` → `lffParser.ts:259-297` | **会抛，第一条真实路径**。`getGlyph` 是惰性的（首次遇到该字符才解析），抛点：`lffParser.ts:39`、`:47`、`:66`、`:69`、`:123`（contour 语法）、`:212`（无 U+FFFD 替代字形）、`:216`（递归字形引用）、`:229`（非法字形引用） |
| **`dashCode`** | `:1558` → `theme.ts:471-477` | **会抛，第二条真实路径**，但生产链路上够不到（详见 §11.14）。`STYLE_LINE_DASH[lineStyle]` 对非枚举真值返回 `undefined`，随后 `dash.length`（`:553`）抛 `TypeError`。`lineStyle` 在**类型层**无运行时校验：`types.ts:461` `ExplicitArcInput.style`、`:468` `ExplicitMarkerInput.style`、`explicit.ts:596/605` |

**两条路径的可达性不同**：`font.trace()` 的抛点全部是「字体文件本身有问题」（LFF 解析），属于部署期缺陷，一旦触发就是**每个含该字符的字形 run 都抛**；`dashCode` 的抛点是「拿到非枚举的 `lineStyle`」，但它需要一条**绕过 MBD 契约解析器**的路径才能送达——`mbdV2Contract.ts:422` 的 `isOptionalAidLineStyle` 用 `AID_LINE_STYLES`（`:394`）做白名单，未知值让整条图元判 `invalid`（`:660`）→ 按 ADR 0046 整包拒绝；`mbdV2ExternalAnnotations.ts:213` 的 `lineStyleFrom` 是第二道白名单，未知值回落 `undefined`。所以「后端加一个 style 值」的症状是**整包拒绝 + 面板报错**，不是 `TypeError`。

**为什么把这两条写在这里而不是另开一节修**：A1 的 try/catch 已经把「抛了会怎样」从「永久冻结」降级为「这一帧作废 + 记一条日志 + 下一次失效照常重跑」。要根治得在**入口**做校验，那属于输入契约层，不该塞进绘制状态机里。`lineStyle` 那条已在 W5-6 收口（§11.14）。

### 11.14 W5-6 `lineStyle` 白名单 —— 收口（2026-10-30）

**先修正 §11.13 的一个判断**。原文说 `dashCode` 的风险是「后端加一个 style 值就触发，不需改代码」。逐条查过链路后，**这个描述对生产路径不成立**：

| 关卡 | 位置 | 未知 `style` 的行为 |
| --- | --- | --- |
| ① MBD 契约 | `mbdV2Contract.ts:422` `isOptionalAidLineStyle` + `:394` `AID_LINE_STYLES` | 该图元判 `invalid`（`:660`）→ 按 ADR 0046 **整包拒绝** |
| ② mapper | `mbdV2ExternalAnnotations.ts:213` `lineStyleFrom` | 未知值 → `undefined`（回落角色样式） |
| ③ 契约测试 | `mbdV2Contract.test.ts:335-348` | `dotted` / `dash-dot` / `DASHED` / `''` / `null` 全部断言 `ok: false` |

也就是说，后端新增一个 style 值，症状是**整包拒绝 + 面板报错**（可见、可诊断），不是静默 `TypeError`。② 单独看也够：它覆盖 `aid_line` / `aid_arc` / `aid_circle` 三类唯一的 `style` 来源。

**但类型层确实没有兜底**，这是真正要修的缺口：`ExplicitArcInput.style`（`types.ts:461`）、`ExplicitMarkerInput.style`（`:468`）、`ExplicitLayoutInput.lines[].style`（`:593`）都只是类型标注。任何不经解析器组装布局的路径（调试页 `dimensionPerf.ts`、演示页 `dimensionKernelDemo.ts`、未来的合成场景、或 ① ② 被 `partial: true` 放宽时）都能把任意字符串送进 `resolveDimensionLineDash`。实测确认它会抛：

```
role=normal style="dotted"   -> THROW TypeError: Cannot read properties of undefined (reading 'length')
role=normal style="DASHED"   -> THROW TypeError
role=normal style=7          -> THROW TypeError
role=normal style="dash_dot" -> THROW TypeError
role=normal style=""         -> [] (len=0)      // 假值，走 if 分支外
role=normal style=null       -> [] (len=0)
```

**修法**（`theme.ts` `resolveDimensionLineDash`，+18/−2）：把 `STYLE_LINE_DASH[lineStyle]` 的结果先接成 `readonly number[] | undefined`，`undefined` 时**退化为「没有显式样式」，由语义角色决定**，并 `console.warn` 带出样式值与角色。这样：

- 三个已知样式的图案**一字不变**（`solid` `[]`、`dashed` `[6,4]`、`dash-dot` `[8,3,2,3]`）；
- 未知值不再抛，画面按角色画（`invalid` → `[7,3]`、`external-reference` → `[6,4]`、`normal` → 实线）；
- 不静默：日志里能认出是哪个值、哪个角色；
- 假值（`''` / `null` / `0` / `false`）仍走原来的 `if (lineStyle)` 短路，**不触发告警**——它们本来就不是「未知样式」。

**为什么选「按角色」而不是「按实线」或「按报错」**：①按实线会让 `invalid` / `external-reference` 这类语义虚线悄悄变实线，视觉上「看起来对了但意思错了」，比不画更难发现；②按角色等于复现 mapper 的 no-style 默认（C6 的口径），与「这个图元没声明样式」完全同义；③报错就是 A1 要消除的那类「一条坏记录冻住整层」，与 §11.11 的结论直接冲突。

**新增 4 条测试**（`theme.test.ts`，此前 `resolveDimensionLineDash` **零覆盖**）：

| 测试 | 钉住什么 |
| --- | --- |
| `gives each known line style its own pattern` | 三个图案互不相同（全映射成 `[]` 也能过「不抛」，但那是把虚线画成实线） |
| `lets an explicit style win over the role` | 显式样式优先（ADR 0042），缺省时角色必须接上 |
| `falls back to the role instead of throwing` | 6 个非法值不抛 + 兜底走角色 + 告警含值与角色 |
| `keeps a falsy but present line style falling through` | `''`/`null`/`0`/`false`/`undefined` 走角色且**不告警** |

**回滚验证（四处，全部如期变红）**：

| 改坏的方式 | 结果 |
| --- | --- |
| 兜底删掉，改回 `return STYLE_LINE_DASH[lineStyle]` | 测试 3 红（`TypeError: Cannot read properties of undefined`） |
| 兜底保留但删 `console.warn` | 测试 3 红（`expected "vi.fn()" to be called at least once`） |
| 兜底成 `styleDash ?? [4, 4]`（凭空造虚线） | 测试 3 红（`expected [4,4] to deeply equal []`） |
| 已知样式也吞成 `[]` | 测试 1、2、3 红（3 条） |

**门禁**：`theme.test.ts` 10/10、`npx vitest run src/dimension` 78 文件 / **696 通过**（上轮 692，+4 即本轮新增）、全量 `npm test` 422 文件 / **4132 通过** / 1 todo、eslint 0、`npm run type-check` **439/126 新增 0**。

**仍未收口的一条**：`font.trace()` 的 LFF 解析抛点（§11.13 第一条路径）。它属于部署期缺陷，A1 已把后果降级为「该帧作废 + 日志」，要根治得在字形解析层做「坏字形退化成不画该 run」，那是另一条独立的活。

### 11.15 W1-2 通用降级选择器 `selectPlacement`（2026-10-30）

**为什么抽这一层**。`resolveLabelCollisions.ts:240-248` 的降级循环与 polar 放置层 T3.5 要做的事形状相同、判据不同：

| | 候选从哪来 | 「行不行」怎么判 |
| --- | --- | --- |
| 标签避让（`resolveLabelCollisions`） | 围绕原位按 `DIRECTIONS` × `steps` 现算 | `LabelOccupancy.overlapsAt` |
| polar 屏幕校验（T3.5） | `place()` 的 `candidates`（已按 `score` 升序） | 投影后的像素净空 |

把两者塞进一个函数只能靠回调透传候选生成，那就等于没抽。所以 `selectPlacement` 抽的是**共同骨架**：「按顺序试、第一个通过者胜出、全不过就退回兜底或报错」。候选产生与判据都留在调用方。

**为什么不放 `polar/`**：polar 目录是另一路（T3.4）的在飞产物，W1-2 不得碰（§3 的入库顺序约束）。`selectPlacement` 的入参是结构化最小接口，不 import 任何 polar 类型，所以放 `kernel/collision/` 由两边共用；等 `place()` 入库后在 polar 侧补薄适配。

**契约**（`kernel/collision/selectPlacement.ts`）：

- `selectPlacement(candidates, accept, options?) → { chosen, index, outcome, tried }`
- **不排序**：入参顺序就是优先级（`place()` 已按 `score` 升序、`DIRECTIONS` 是写死优先级）。再排一次会覆盖调用方意图。
- **不改入参**：返回原对象引用。
- **兜底三态**：`options` 无 `fallback` 键 → 全拒时返回 `candidates[0]`（候选序即优先级，最差也比不画强）；`fallback: T` → 返回它，`index: -1`；`fallback: null` → 抛 `NoAcceptablePlacementError`，把「没有可接受位置」的判断权交回调用方。
- **空候选表**：无 `fallback` 或 `fallback: null` 时抛，`tried: 0`；给了 `fallback: T` 时返回它。消息与 `tried` 区分「压根没候选」（编排错误）与「候选都撞了」（数据/密度问题）——两者处理方式完全不同。
- `onReject` 只在被拒的候选上调用（被接受的那个不进），用于诊断。

**新增 10 条测试**（`selectPlacement.test.ts`），钉住：取第一个而非最后一个、跳过被拒并报 `tried`、全拒时缺省兜底取首项、显式 `fallback` 的 `index: -1`、`fallback: null` 抛错且消息含 `all 2 candidates were rejected`、空表与全拒可区分、`onReject` 拿到真下标且不覆盖接受项、不改入参、结构化 `bounds` 判据可用、首项通过时不调 `onReject`。

**回滚验证（三处，全部如期变红）**：

| 改坏的方式 | 结果 |
| --- | --- |
| 删 `if (hasFallback) throw`（`fallback: null` 静默回落首项） | 测试 5 红 |
| 循环改成从末尾往前（取最后一个可接受项） | 测试 1、5、7 红（3 条） |
| 删 `onReject?.(candidate, index)` 调用 | 测试 7 红 |

**门禁**：`selectPlacement.test.ts` 10/10、`npx vitest run src/dimension` 79 文件 / **706 通过**（上轮 696，+10 即本轮新增）、全量 `npm test` **423 文件 / 4142 通过 / 1 todo**、eslint 0（`Array<T>` 写法被 `@typescript-eslint/array-type` 抓到，已改 `T[]`）、`npm run type-check` **439/126 新增 0**。

**下一步**：`place()` 入库后，在 `polar/screenGuard.ts` 里用 `selectPlacement(placeResult.candidates, fitsInViewport)` 接上，判据是「投影包围盒 + 像素净空」；`LabelOccupancy` 直接复用（已在 `kernel/collision/occupancy.ts`）。


