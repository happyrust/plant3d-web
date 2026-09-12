# 自动 MBD 管道长度尺寸（linear_dim）三维显示效果优化方案

日期：2026-09-12  
状态：QW1 / QW2 / QW3、S2 第一步、S3 第一 + 第二步已于 2026-09-12 落地（各段内附实施与验证记录）；QW4、S1、S4、S5 待排期  
关联：已批准开发计划（协同决策 d-438）的 PR3 结构化 coverage、PR4 `occupancy.rs`、PR6 布局权威收口  
基线证据：`docs/verification/mbd-pipe-live-baseline-2026-09-12.md`（阶段 0 live 基线 PASS）

## 1. 现状与证据

### 1.1 实测环境

- 隔离 gen-model `http://127.0.0.1:18084`（`D:\Rust\target\debug\aios-database.exe`，build
  `0.1.23+ge2202349247a…dirty`，配置 `gen-model/verification/mbd-live-20260912/isolated-18084-config.toml`，
  embedded-mem），health `ok` / core `ready`；既有 `:8022` 进程未动。
- 普通 `plant3d-web :3101`，页面：

  ```text
  /?output_project=AvevaMarineSample&show_refno=24381_145018&mbd_refno=24381_145018
    &mbd_kinds=linear_dim&gm_backend=http://127.0.0.1:18084&mbdBackend=http://127.0.0.1:18084
  ```

- `mbd_kinds` 是本日新增的调试过滤（`src/composables/useMbdExternalSync.ts::parseMbdKindFilter`）：
  在契约校验与原子拒绝之后只把列出的 kind 送进画家，过滤事实写进诊断 notes。

### 1.2 样本数据（BRAN `24381_145018`）

- `GET /api/mbd/v2/pipe/24381_145018` → 200，约 135 ms；77 图元：18 `linear_dim`（`sub_kind` 为 `main` /
  `atta`，无 `small`、无 `reference`）、7 `slope_mark`、21 `aid_line`、3 `aid_text`、14 `label`、14 `leader_line`；
  `issues=[]`；`meta.cheight_mm=27`、`layout_mode=isodim_main`、`source_to_design=S(0.001)`。
- 模型：dbnum 7997，12 refno，22 个 DTX 对象，13 168 三角。
- 过滤后画面：18 条 `source=mbd` 记录，category 全为 `dimension`，用户 `DimensionDocument=0`。
- 求解器行位可从数据反推：同一直段的 atta 行与 main 行相差 32.4 mm = `1.2 × cheight(27)`，
  即 `offset = od + 1.2·cheight·(row−1)`（`plant-mbd/crates/plant-mbd/src/isodim.rs:577`），主尺寸离管轴一个外径。

### 1.3 截图观察（两张，同一相机；文件暂存 `%TEMP%\plant3d-mbd-debug\`）

| # | 现象 | 直接证据 |
| --- | --- | --- |
| O1 | 尺寸线几乎贴着管道走，远景与管体重叠 | 行位 `od + 1.2·cheight·(row−1)`；本 BRAN 外径几十 mm |
| O2 | `show_refno` 使 BRAN 处于选中态，洋红高亮（`0xff4fd8`）与尺寸线洋红（theme `external: '#ff1aff'`）同色系，第一张几乎分不清 | `ViewerPanel.vue` `selectionColor: 0xff4fd8`、`selectionStore.setSelectedRefno(showRefno)`；`kernel/theme.ts:55-62` |
| O3 | 第二次布局时 `2640.89 / 1340.05 / 758.89 / 2515.13` 等标签被推离尺寸线并自动补了竖直引线 | `resolveLabelCollisions.ts`：MBD `linear_dim` 未 pinned → 参与自动避让，四个屏幕方向 × 8 px 步进、最多 9 个候选，搬动后 `moveLabel` 自动插引线 |
| O4 | 阀门端一簇 9 条短段（1650 / 2640.89 / 1902.35 / 1340.05 / 1352 / 567.89 / 402 / 900.51 / 173）远景不可读 | 每条 isoline 一条 running dimension（PML 语义），Web 无 LOD |
| O5 | 文字固定 13 px 屏幕字高，箭头翼 13 px 下限拉伸；求解器字高 `cheight_mm=27` 是模型 mm | `theme.ts:45-48`；`explicit.ts:191-217`；`isodim.rs:104-107,308` |
| O6 | 背面 / 被遮挡处的尺寸全部穿透显示 | `viewport/scenePainter.ts:476-477` `depthTest:false, depthWrite:false` |

关于 O3 的一个保留意见：两张截图之间的差异是在脚本里 `notifyViewerChanged()` 两次得到的；第一帧很可能在
相机矩阵尚未随渲染刷新时就完成了布局（未定位，见 §7）。**但设计问题独立于此**：只要 MBD `linear_dim`
参与 Web 避让，标签就不受求解器 `label_anchor` 约束，且随相机转动被反复推开、引线时有时无。

## 2. Oracle 复核记录

- 会话：`mbd-linear-dim-visual-optimization`（Oracle 0.20.0，browser 引擎，附件：本方案 §1 的 brief、两张截图、
  真实 wire JSON、`isodim.rs` / `layout.rs` / `mbdV2ExternalAnnotations.ts` / `explicit.ts` /
  `resolveLabelCollisions.ts` / `theme.ts`）。
- **模型证据须打折**：Oracle 记录 `requestedKey=gpt-6-pro; resolvedLabel=Latest; thinking=Pro`，
  全程 42 s、输出约 1.96k token，Oracle 自己也提示「Large browser Pro run completed quickly … verify the stored
  model selection evidence」。因此下面只采纳其中能对照源码复核成立的论点，行号按本仓实际修正：
  - 采纳：MBD `linear_dim` 的 `labelPinned` 为 false（`mbdV2ExternalAnnotations.ts:173`
    `labelPinned: category !== 'dimension'`）是标签被 Web 搬动的直接原因；对照 parquet 通道的旧适配器
    `mbdExternalDimensions.ts:143` 是 `labelPinned: true`，两条通道行为不一致。
  - 采纳：O1 是「2D isometric 语义放进自由相机 3D 视口」的根本错配，不是求解器 bug；不得为截图效果改
    `isodim.rs` 行位公式或六条 golden。
  - 采纳：屏幕字高与 `cheight` 脱钩是远景不可读的根因之一；但方案应先用契约里**已有**的 `meta.cheight_mm`，
    Oracle 建议的「逐图元 cheight 字段」属于后续 consumer-first 扩展。
  - 采纳：密集簇不做合并（各尺寸语义不同），走分级显示 / LOD，并需要契约字段（`importance` 或复用 `sub_kind`）。
  - 修正：Oracle 引用的 `isodim.rs:661 / 1482` 应为 `:577`（行位）与 `:1398-1411`（箭头几何）。
  - 修正：Oracle 建议的 `labelPinned: category === 'dimension' ? role === 'external' : true` 语义混乱；
    本方案统一为「MBD 来源的记录一律 pinned」（与 parquet 通道一致），再由 PR6 的 `layoutAuthority` 取代。

## 3. 分层诊断

| 现象 | 归属层 | 根因 | 优先级 |
| --- | --- | --- | --- |
| O3 标签被推开 / 引线跳变 | Web 内核（避让） | V2 mapper 未 pin 尺寸标签；`resolveLabelCollisions` 以屏幕四方向搬动 solver 锚点并自动补引线 | P0 |
| O1 尺寸线贴管 | 语义错配（2D isoDim → 3D） | PML 行位 `od + 1.2·cheight·(row−1)` 面向单线 isometric，3D 实体管在远景把它盖住 | P0（方案层面），实现放 PR6 |
| O5 远景不可读 / 近景过剩 | Web 内核（主题常量） | `textHeightPx=13` 固定，未使用 `meta.cheight_mm`；箭头翼下限 13 px 独立于字高 | P1 |
| O4 短段簇 | Web 内核 + 契约 | 无 LOD / importance；每条 isoline 一条 running dimension 是正确语义 | P1 |
| O2 颜色混淆 | 交互 / 主题 | 选中高亮与 external 尺寸同色系；`show_refno` 强制选中 | P2（quick win） |
| O6 背面穿透 | 画家 | `depthTest=false` 是工程 overlay 约定，缺少检视模式 | P2 |

## 4. 方案

### 4.1 Quick win（1–2 天，不动契约、不动 solver golden）

**QW1 · MBD 记录一律 `labelPinned: true`** —— 2026-09-12 已落地（用户批准后本会话实施）

- 实施与验证：`mbdV2ExternalAnnotations.ts::explicitRecord` 改为 `labelPinned: true`；mapper 单测改为断言
  pinned、重叠副本保持同一 `labelBounds` 且无 leader；`npx vitest run src/dimension …` 51 文件 / 263 用例通过，
  eslint 0，type-check 新增 0。Chrome 固定相机连拍（24381_145018，18 条 linear_dim）：帧 A / 帧 B（中间清除
  选中并两次 `notifyViewerChanged()`）`labelBounds` 逐条相同、18/18 pinned、leader 0 → 标签不再跳。代价如预期：
  密集簇的标签在远景真实重叠，交给 S2 / S3。
- 改动：`src/dimension/adapters/mbdV2ExternalAnnotations.ts::explicitRecord`，`labelPinned: true`
  （与 `mbdExternalDimensions.ts:143` 一致）。pinned 记录仍会写入 occupancy，用户尺寸会绕开它们。
- 效果：标签固定在求解器 `label_anchor`（尺寸线中点，`labelClearance` 仍会在标签框处打断尺寸线），
  不再出现自动引线；同一相机下布局幂等。
- 验收：`mbdV2ExternalAnnotations.test.ts` 断言 `layout.labelPinned === true`；
  `kernel/__snapshots__/goldens.test.ts.snap` 若含经 V2 mapper 的 MBD 用例，其 `labelPinned` 由 false→true
  属有意变更、需重录并在 PR 里说明；
  固定相机连拍两帧 `viewport.getLayouts()` 的 `labelBounds` 逐字相同（可加进 `e2e/dimension-mbd-v2-fixture.spec.ts`）。
- 风险：密集簇的标签会真实重叠（不再被推开）——这是把问题交还给 §4.2 的 S3，而不是用不确定的搬动掩盖。
- 回退：恢复 `category !== 'dimension'`。

**QW2 · 尺寸线颜色与选中高亮分离** —— 2026-09-12 已按 a 落地，最终 `external` / `external-reference` → `#c2410c`（深橙）

- 实施与验证：`kernel/theme.ts` 两个角色换色，`theme.test.ts` 新增颜色钉子；`npx vitest run src/dimension`
  通过，eslint 0。同一固定相机对比两轮：第一轮深青 `#0e7490` 与洋红选中高亮可区分，但**未选中态**压在默认蓝色
  管体上几乎同色（放大截图确认），比原洋红差；第二轮改深橙 `#c2410c`，蓝管、洋红高亮、浅色背景三种底色上
  尺寸线与箭头翼均清晰，采用。用户尺寸 `normal` 仍为 `#ff1aff`，文字色不变。
- 改动（二选一，建议 a）：a) `kernel/theme.ts` 为 `external` / `external-reference` 换成与 `0xff4fd8`
  拉开的颜色（例如深青 `#0e7490` 或深蓝 `#1d4ed8`），文字色保持 `#111827`；b) 保持洋红，改
  `ViewerPanel.vue` 选中高亮色。a 不碰 DTX 选择器，影响面只在尺寸主题。
- 验收：`theme.test.ts` 更新常量；SVG 导出中 `stroke` 颜色变化；选中 BRAN 的截图里尺寸线与高亮可区分。
- 风险：用户已习惯洋红尺寸；`external-reference` 的虚线样式不受影响。

**QW3 · 「加载但不选中」的调试入口 + kind 过滤进面板** —— 2026-09-12 已落地

- 实施与验证：`ViewerPanel.vue` `show_refno` 路径新增 `show_refno_select=0`（缺省仍选中）；
  `DimensionPanelDock.vue` 在 MBD 通道同步后显示「MBD 图元类别」块：11 个 kind 勾选（`Record<MbdPrimitive['kind'],…>`
  钉全契约）、「只看长度」「全部」按钮，改 URL `mbd_kinds` 并派发 `popstate`，走 ViewerPanel 既有
  `handleMbdLocationChange` 重新同步；仅剩一个类别时禁止再取消。`DimensionPanelDock.test.ts` +2 用例，
  `src/dimension/ui` 17/17，eslint 0；`e2e/dimension-mbd-v2-fixture.spec.ts` 2/2。Chrome 实测（24381_145018，
  `show_refno_select=0`）：`selectedObjectIds=0`、管体不高亮；勾 `slope_mark` → 25 条、「全部」→ 77 条且 URL
  去掉参数、「只看长度」→ 18 条，URL 与勾选状态同步。每次切换会重新拉一次 payload（PR2 控制器可缓存）。
- 改动：`ViewerPanel.vue` 的 `show_refno` 路径增加 `show_refno_select=0`（或独立参数）跳过
  `selectionStore.setSelectedRefno`；`DimensionPanelDock.vue` MBD 诊断区增加 kind 勾选（读写
  `mbd_kinds`，触发 `handleMbdLocationChange` 同一条 `popstate` 路径），不再要求手改 URL。
- 验收：`useMbdExternalSync.test.ts` 已覆盖过滤；面板勾选后 `externalRegistry` 记录数与 kind 计数一致；
  URL 无参数时行为不变。
- 风险：面板改动需跟 `mbd-diagnostics` 现有 E2E 断言对齐。

**QW4 · 调试截图基线**

- 把本日两张截图与 URL、payload 摘要归档到 `docs/verification/`（含相机参数），作为 QW1/QW2 前后对比的
  固定相机基线；不做像素 golden。

### 4.2 结构性改动（对号 d-438）

**S1 · 布局权威（PR6）**

- `ExternalDimensionRecord` 增 `layoutAuthority: 'solver' | 'screen'` 与 `declutterPolicy`；MBD 记录为
  `solver`；`layoutViewport` 对 `solver` 记录跳过 `resolveLabelCollisions`，只让它们占位。QW1 的
  `labelPinned` 是它的过渡实现，S1 落地后由 authority 决定 pinned。
- 如保留任何 Web 侧搬动，只允许沿该尺寸线的屏幕法向 ±n 步，且候选顺序确定（按 id），不用屏幕四方向。
- 验收：solver golden 不变；Web 固定相机快照；`perf:dimensions:kernel` 不退化。

**S2 · 屏幕字高随 `cheight` 自适应（Web 内核）** —— 2026-09-12 第一步已落地（只用 `meta.cheight_mm`，不动契约）

- 实施：`ExplicitLayoutInput.textHeightM?`（设计空间字高，米）；mapper 由 `meta.cheight_mm` 经同一 `source_to_design`
  变换得到并挂到每条 MBD 记录；`layoutExplicit::resolveTextHeightPx` 用 `projector.worldPerPixelAt(labelAnchor)`
  做深度相关、与朝向无关的投影（对应 PML 图纸上的 cheight），夹在 `theme.sourceTextHeightMinPx/MaxPx = 11/18`；
  标签打断框、多行文字行距、箭头翼下限（仅对声明了字高的来源）随同一字高取值。用户尺寸与未声明字高的来源仍是固定 13 px。
- 验证：`explicit.test.ts` +2（100/500/1000 px/m → 11 / 13.5 / 18 px；翼下限 11 / 13.5 / 1:1 25.9 px）、mapper +1
  （source_mm 27 mm → 0.027 m，null → 无，design_m 仍按 mm）；`src/dimension` 50 文件 / 258 用例通过，eslint 0，
  type-check 新增 0（顺手修掉 `layoutViewport.ts` 一条基线内 `noUncheckedIndexedAccess` 错误）。Chrome 固定相机：
  远景 18 条全部落到 11 px 下限（原 13 px），翼 11 px；拉近阀门端后同一画面里字高 11 → 17.19 px 随深度变化。
- 观察：远景下投影字高只有 2–3 px，全部被下限接住，重叠只比 13 px 时略缓解；S2 的收益在中近景（字随模型缩放、
  翼与字保持求解器比例），远景密集簇仍要靠 S3 分级。下限是否下调到 9–10 px 待用户拍板。
- 原设计：`LayoutContext` 增 `textHeightPx` 的来源策略：external 记录按 `meta.cheight_mm`（已在契约）经
  `designToWorld` + 相机投影得到屏幕高度，夹在 `[minPx, maxPx]`（初值 11–18 px，待实机样本定）；用户尺寸
  维持 13 px。箭头翼下限与标签打断长度随同一字高取值（保持 ADR 0056 的「下限」语义，不重生成箭头）。
- 顺序：先 Web（读 `meta.cheight_mm`，缺省回落 13 px），后续再走 consumer-first 增加逐图元 `cheight_mm`
  （`sepSmallDim` 缩字后的组字高目前契约里没有，见 `isodim.rs` 头注）。
- 验收：`explicit.test.ts` 新增近 / 远两个投影用例；固定相机截图对比；`perf` 门不退化。
- 风险：字高随距离变化会改变标签打断长度，需要检查 `trimLineAgainstRotatedRect` 在极短尺寸线上的表现。

**S3 · 密集簇分级显示（PR3 coverage + 契约字段 + PR4 occupancy）** —— 2026-09-12 第一步已落地（Web 内核 LOD，不动契约）

- 实施：`ExplicitLayoutInput.lod?: { tier?: 'primary' | 'secondary'; hideShort?: boolean }`（按输入 opt-in，测量等来源不受
  影响）；`layoutExplicit::lodHiddenReason`：`secondary` 在来源字高投影 < `sourceTextHeightMinPx`（远景）时整条隐藏；
  `hideShort` 在尺寸线投影长度 < `theme.lodMinLineToLabelRatio(=1)` × 标签宽时整条隐藏；隐藏 = `emptyLayout` 并在
  `derived.lodHidden` 记原因（`'secondary-far' | 'short-line'`），不进画家、不进 SVG、无 hit。mapper 只给 `linear_dim`
  打标：`sub_kind=atta` → secondary，其余 primary；`sub_kind=small` 不做短线隐藏（solver 已把文字外置）。用现有
  `sub_kind` 即可，暂不需要契约新增 `importance`。
- 验证：`explicit.test.ts` +2、mapper +1；`src/dimension` 50 文件 / 261 用例通过，eslint 0，type-check 新增 0。
  Chrome 固定相机（24381_145018，18 条）：远景 18 → **11 条绘制 / 7 条隐藏**（6 条 atta `secondary-far`：480 / 1257.56 /
  1035.51 / 907.52 / 1650 / 402；1 条 `short-line`：173），阀门端簇从 9 条降到 5 条；拉近阀门端后 13 条绘制（近处的
  402 / 173 回来，远处 5 条 atta 仍隐藏）。
- 观察：远景可读性明显改善；阀门端仍有 567.89 / 900.51 轻微相压。后续可选：第三级（近景才显示 label / aid）
  仍按原设计走 `mbd_kinds` 或契约 `importance`。
- `lodMinLineToLabelRatio` 1 → 1.2 试验（同日，同一固定相机，**已还原为 1**）：逐条量了「尺寸线投影长度 ÷ 标签宽」——
  173 = 0.50（已隐）、402 = 1.08 / 907.52 = 1.21（atta，已隐）、758.89 = 1.25、900.51 = 1.35、1340.05 = 1.49、
  567.89 = 1.49、其余 ≥ 1.84。k = 1.2 落在 1.21 与 1.25 之间，远景仍是 11 绘 / 7 隐，一条都没多隐，567.89 / 900.51
  照旧相压；近景 13 绘 / 5 隐也不变。要靠这条规则分开那一对得 k ≈ 1.5，但会连带隐掉 758.89 与 1340.05 两条主尺寸——
  短线阈值是长度门槛，不是成对避让，无法只针对相压的两条；那一对留给 S1 的 `declutterPolicy`（solver 权威记录重叠时
  按确定顺序隐去其中一条，不搬动）。
- 第二步（同日）· 面板统计 + 关闭开关：`DimensionViewport.subscribeLayouts` 新增「每次完整重布局后回调本批 `getLayouts()`」
  的缝（仅换样式的重绘不触发）；`DimensionPanelDock.vue` 在「MBD 图元类别」块下显示
  「LOD 隐藏 N 条（atta 远景 X / 短段 Y）」，只统计 `source=mbd` 记录的 `derived.lodHidden`；「分级显示（LOD）」勾选框
  同 QW3 一样只改 URL（`mbd_lod=0` = 关）并派发 `popstate`，由 `useMbdExternalSync` 在过滤之后剥掉 mapper 打的 `lod`
  提示（内核对每条尺寸照常出图），并在诊断 notes 写一行 `mbd_lod=0：已关闭分级显示（LOD）…`；关闭时面板改显
  「已关闭，每条尺寸照常出图」。验证：`DimensionPanelDock.test.ts` +1（按原因计数、不计用户尺寸、开关来回改 URL）、
  `useMbdExternalSync.test.ts` +1（剥 `lod` + notes）；`src/dimension/ui` + `useMbdExternalSync` + `src/dimension/viewport`
  + `kernel/layout` 16 文件 / 87 用例通过，eslint 0，type-check 新增 0，`e2e/dimension-mbd-v2-fixture.spec.ts` 2/2。
  Chrome 固定相机（24381_145018，`show_refno_select=0&mbd_kinds=linear_dim`）：开 → 内核 11 绘 / 7 隐（6 `secondary-far`
  + 1 `short-line`），面板「LOD 隐藏 7 条（atta 远景 6 / 短段 1）」；勾掉 → URL `mbd_lod=0`、18 条记录全部无 `lod`、
  18 绘 / 0 隐、面板「已关闭…」、诊断 notes 含 `mbd_lod=0`；再勾上 → 参数移除、7 隐恢复；三步相机位置不变。
- 原设计：不合并尺寸。三级：远景只显示 `sub_kind=main`；中景显示 main + atta；近景全部展开。阈值以
  「投影后尺寸线长度 < 标签宽度 × k」判定，而不是相机距离。
- 需要契约提供 `importance`（或复用 `sub_kind` 并在 `meta.coverage` 里声明）——先 Web parser 接受可选字段，
  再 Rust 契约 mirror，再 producer；PR4 `occupancy.rs` 提供 solver 侧占位后，才考虑让 solver 输出分级建议。
- 验收：fixture 扩 `full-coverage.json` 增 `importance`；固定相机远 / 中 / 近三帧记录数递增。

**S4 · 画家双模式：engineering / inspection**

- `ThreeSceneDimensionPainter` 增 `inspection` 模式：保持 `depthTest=false` 但按深度做淡化（被遮挡尺寸
  α 降到 0.35 左右），而不是直接开启深度测试（会让尺寸被管体吃掉）。默认仍为 engineering。
- 验收：`dimension-canvas-smoke.spec.ts` 增模式切换断言；性能门。

**S5 · 交互三态**

- MBD 显示三态：关 / 按 BRAN 显示 / 按 kind 过滤；与 PR2 自动同步控制器（选中 BRAN + 显式开关）合并设计，
  `mbd_refno` / `mbd_kinds` URL 参数保留为调试入口。

### 4.3 不做（No-Go）

- 不改 `isodim.rs` 行位 / 字高公式，不为截图效果重录六条 solver golden（ADR 0003 / 0006）。
- 不在 Web 端按视向平移尺寸线（破坏确定性且与 solver 权威冲突）；贴管问题走 S1/S4 的呈现策略与后续
  Polar-lite lane，而不是屏幕偏移。
- 不把 Rust 求解逻辑移到前端；不让 MBD 进用户 `DimensionDocument`。

## 5. 最小改动清单（每条 ≤ 1 天）

1. QW1：`mbdV2ExternalAnnotations.ts` `labelPinned: true`，更新 mapper 单测与 kernel 快照；固定相机连拍两帧
   `labelBounds` 相同。预期：第二张截图里 `2640.89 / 1340.05 / 758.89 / 2515.13` 的竖直引线消失，标签回到尺寸线中点。
2. QW2：`theme.ts` external 颜色改为与选中高亮可区分的颜色，更新 `theme.test.ts`；选中 BRAN 截图中尺寸线可辨。
3. QW3（前半）：`show_refno` 不选中的开关；同一 URL 加参数后 `scene.selectedObjectIds` 为空、尺寸照常出图。

## 6. 验收矩阵

| 项 | 单测 / 快照 | E2E / 固定相机 | golden |
| --- | --- | --- | --- |
| QW1 | mapper + kernel snapshot | 两帧 `labelBounds` 相同 | solver 不变 |
| QW2 | theme.test | 截图可辨 | 不涉及 |
| QW3 | sync 过滤已覆盖 | 选中集为空、记录数一致 | 不涉及 |
| S1 | viewport 单测 | 固定相机快照 | solver 不变 |
| S2 | explicit 近 / 远用例 | 截图对比 + perf 门 | Web kernel 快照重录 |
| S3 | full-coverage fixture | 三帧记录数 | contract_guard 同步 |
| S4 | painter 单测 | canvas smoke | 不涉及 |

## 7. 待决问题（需用户拍板）

1. QW2 选 a（改尺寸主题色）还是 b（改选中高亮色）。
2. S2 的屏幕字高夹取区间初值（建议 11–18 px），以及是否对用户尺寸也启用。
3. O3 两帧差异的直接触发条件是否需要单独定位（怀疑首帧布局用了未刷新的相机矩阵）；若 QW1 落地后固定相机
   连拍稳定，可不再追。
4. 是否把本日截图归档进 `docs/verification/`（约 1.7 MB PNG）。
