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
| W5-1 | **T6.1** 真实 BRAN 视觉审阅，裁决 G9（坡度符号：PML 三角形 vs Web 线 + 箭头） | 结论进 ADR；截图落 `docs/verification/` |
| W5-2 | **T6.4** QW4 固定相机截图基线（含相机参数），复用 `e2e/dimension-doc-screenshots` 生成器。**状态（2026-10-29）**：已裁决**新建** `e2e/dimension-camera-baseline.spec.ts`（`66c78f0e`，388 行 + README 231 行），不改既有生成器——后者是 demo 模式 + 四种用户尺寸图形，且 `scripts/check-dimension-doc-screenshots.mjs` 按写死的 CASES 与 HEAD 逐字节比对，塞进真实 BRAN + 三档会破坏那个门禁的契约；复用它的取景写法（`dimension-doc-screenshots.spec.ts:140-185`）。设计：同一 target 下 `far`（直接读自动 fit 后的相机，不重算）/ `mid`（×0.4）/ `near`（×0.2，不取 0.15——0.15 深入包围盒内易贴管件或被 near 平面切），相机参数落 `<OUT_DIR>/<refno>/cameras.json` 侧车（`tiers.<tier>.{scale,position,target,up,fov,near,far,records,drawn,lodHidden}`），产物归档 `docs/verification/dimension-camera-baseline-2026-10-29/`。**同一份生成器顺带解锁 W0-2**：`DIMENSION_CAMERA_BASELINE_BASE_URL` 指向另一个 worktree 的 dev server + `DIMENSION_CAMERA_BASELINE_OUT_DIR` 指不同目录，即可对 `12f4bb1e^` 与当前树各出一组 before / after。**真实出图仍待 gen-model 后端 18084 在线**（2026-10-30 核查：18084 拒绝连接，dev server 3101 活着）| 基线归档，后续 W1-3 / W5-3 / W5-4 的 A/B 都对着它比 |
| W5-3 | **T6.2** Q5 短线阈值分级（0.5 / 0.8 / 1.5） | 本样本远景不变；中景多留一档。**已实现（2026-10-30）**：`theme.lodMinLineToLabelRatio` 改成 `{ primary: 0.8, secondary: 0.5, detail: 1.5 }`，`lodShortLine` 按 `tier` 取值，未声明按 primary；数值门禁绿（S2 81/709、type-check 439/126 新增 0）。**视觉 A/B 仍待后端**，详见 §11.1 |
| W5-4 | **T6.3** Q6「文字在线上方」可选模式（仅单行 isoline） | 固定相机对比；不侵入相邻行。**已实现 kernel 侧（2026-10-30）**：`ExplicitLayoutInput.labelPresentation?: 'interrupted' \| 'above'`，缺省等于现状（逐字段不变）；`above` 抬 11 px（字高 13）且线不切段，多行标签自动回落；「不侵入相邻行」落成 `labelBounds` 相交断言，并据此得出**行距须 ≥ 2.96 字高**（现有 1.5 字高不够）。**未接 MBD mapper**，线上行为零变化；固定相机 A/B 待后端。详见 §11.2 |
| W5-5 | **T6.5** 2k 记录分帧预算 | 相对 W4-1 基线 P95 不退化；`DIMENSION_PERF_GATE=1 npx playwright test e2e/dimension-perf.spec.ts` 通过。**门禁口径已修（2026-10-30）**：删掉测错东西的 `updateP95Ms ≤ 16`，改成 `settle(20)` 的 `layoutP95Ms` / `paintP95Ms` 不退化判据；layout 的 16 ms 由内核基准守住（p95 3.746 ms，达标）。门禁实测 1 passed。**分帧本身未做**，`paintP95Ms` 53.40 仍是主要成本；生产档基线采不到（R9）。详见 §11.3 |

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
| R9 | **生产档性能页是坏的**：`public/dimension-perf.html:13` 指向 `/src/debug/dimensionPerf.ts`，`public/` 原样拷进 `dist/`，`vite.config.ts:154-157` 的 `build.rollupOptions.input` 也没这个页面 | 生产档基线目前采不到；要采先把性能页做成构建入口（独立一小刀，未做）。在此之前所有浏览器档数字都注明是 dev 档 |

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
| 18 | 待提交 | W5-5 门禁口径修正：`settle(20)` 不退化断言替换 `updateP95Ms ≤ 16` + 内核基准数字 + R9 | 门禁 1 passed (4.4s)；内核基准 p95 3.746 ms |

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

**仍未做的一半**：固定相机 before / after 逐像素比对（`docs/plans/2026-09-12-mbd-dimension-engineering-convention-review.md:105` 的「固定相机对比」）要 W5-2 生成器 + gen-model 后端 18084，当前后端不在线。上面钉住的是几何行为，不是画面。**另外 `above` 目前没有接到 MBD mapper**——`mbdV2ExternalAnnotations.ts` 不产生这个字段，所以线上行为零变化，这是有意的：接不接、接到哪个开关（面板选项 / URL 参数 / 全局默认）是产品决策，留到 W5-4 的视觉验收之后再定。

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

1. **生产档基线拿不到**（`README` 已知口径问题第 8 条）：`public/dimension-perf.html:13` 写的是 `<script src="/src/debug/dimensionPerf.ts">`，而 `public/` 被原样拷进 `dist/`，`vite.config.ts:154-157` 的 `build.rollupOptions.input` 也没有这个页面。**生产构建下这个性能页是坏的**，所以「生产档 p95」目前无法采集。要做就得先把它做成真正的构建入口——独立一小刀。
2. **分帧本身**：`paintP95Ms` 53.40 是这一档的主要成本（`layoutP95Ms` 只有 16.70）。W5-5 的落地形态应该是「把 paint 拆到多帧」或「减少每帧重绘的记录数」，判据是**分帧后单帧 p95 ≤ 16 ms 且总帧数不超过 2 倍**（否则只是把成本摊长，交互变卡）。**这一条仍未动代码。**

**R5（门禁默认 skip 会漏到线上）仍未解决**：`test.skip(process.env.DIMENSION_PERF_GATE !== '1', ...)` 保持原样。接不接 CI 是决策，不是实现细节——本轮未动。

### 11.4 未决问题（2026-10-30 更新：U1 / U4 已自决，U2 / U3 待办）

用户 2026-10-30 明确指示**不使用 CT 窗口**，因此 §11 原定的四条裁决由本会话自己拍：

| # | 问题 | 结论 |
| --- | --- | --- |
| U1 | Q5 三档 0.5 / 0.8 / 1.5 与 tier 的对应关系 | **已自决并实现**：secondary 0.5 / primary 0.8 / detail 1.5，未声明按 primary。理由与后果见 §11.1，行为由单测钉住（`e419a2f6`） |
| U4 | `labelPresentation` 放 kernel 契约还是 MBD mapper 层 | **已自决**：放 kernel 的 `ExplicitLayoutInput`（`types.ts`）。理由：`above` 要沿**屏幕法向**抬，mapper 层拿不到投影；放 kernel 是唯一不重复实现投影的地方。字段可选 + 默认等于现状，风险有界。**故意不接 mapper**，线上零变化（`e419a2f6` 之后这一刀） |
| U2 | 是否把 `updateP95Ms` 断言换成 `settle` 分位（会让门禁直接变红） | **已自决并实现**：换成 `settle(20)` 的 `layoutP95Ms` / `paintP95Ms`，判「不高于基线 × 1.2」。门禁**没有变红**——同日实测 16.70 / 53.40，低于基线。见 §11.3 |
| U3 | 基线要不要在**生产构建**上重测 | **部分自决**：生产档**拿不到**（`public/dimension-perf.html` 指向 `/src/debug/dimensionPerf.ts`，生产构建下页面是坏的，README 第 8 条）。改用两个替代锚点：ADR 口径的内核基准（layout+collision p95 = 3.746 ms，达标）+ dev 档 `settle(20)` 的不退化判据。**要真拿生产档数字，得先把性能页做成构建入口——独立一小刀，未做** |

**U2 / U3 的最终结论**：layout 的 16 ms 预算由内核基准守住（p95 3.746 ms）；浏览器门禁改判「不退化」。上轮基于 dev 浏览器读数推断的「layout 超预算」是错的，已在 §11.3 更正。

