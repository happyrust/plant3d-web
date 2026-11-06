# MBD 三维尺寸标注：剩余工作开发计划（2026-11-06）

- 性质：开发计划（现行）。**本文件只是计划，不改代码。**
- 承接关系：接 [`2026-10-29-mbd-dimension-remaining-work-dev-plan.md`](2026-10-29-mbd-dimension-remaining-work-dev-plan.md)（下称「10-29 计划」）的**剩余工作**。10-29 计划的 W0 / W1 / W2 前三件 / W3 前三步 / W4 / W5-2 / W5-3 / W5-4 已完成，本文件不再重述其过程细节，只写仍未做完的部分。
- 对照口径：plant3d-web `d10aae8d`（`6417dbd6` T3.6b 之后）、`vendor/plant-mbd` `cb046f7`、gen-model `68a78ea7f`（`refactor`）。
- 编号：本文件用 N0–N6 表示工作包，避免与 10-29 计划的 W0–W5 混淆。引用旧编号时写全（如「W3-1」）。
- 并行计划（2026-11-07）：[`2026-11-07-mbd-all-annotation-types-port-dev-plan.md`](2026-11-07-mbd-all-annotation-types-port-dev-plan.md)（#103，工作包 M0–M8）负责支架 / 土建 / 设备与管道缺失尺寸，并**接管 N2-2 / N4-1 的极坐标口径**：摆位改为求解器唯一实现（M2a），前端 `polar/place/**` 视复测结果退役。其余工作包不重叠。

## 0. 一句话

polar 的数值层、参考系层、屏幕校验层、同管累积障碍与 producer 数据已全部落地并通过实测；实测结论是**「不转默认、只在平面呈现生效」**。剩下的是三件收尾（契约消费侧、polar 平面呈现的三个根因、文档收口）、两件求解器补齐（T5.3 / T5.7）、两件必须人拍的视觉裁决（G9 坡度符号、310 BRAN 房间的分帧口径）。

## 1. 现状与依据（只列与剩余工作直接相关的事实）

| # | 事实 | 证据 |
| --- | --- | --- |
| F1 | 极坐标放置全链已入库：`place/` 数值层 + `reference/` 参考系层 + `screenGuard` + `selectPlacement` + 同管累积障碍 + 只读诊断 | `5c7ee980`、`be17e987`、`3f298e7c`、`9eafa763`（T3.6a）、`6417dbd6`（T3.6b） |
| F2 | 契约六项（T4.1–T4.6）三步中**①②③全部落地**：前端契约 `d7281249`、plant-mbd mirror `fff0f6e`、producer `cb046f7` | 三个提交；`contract_guard` 7 例 |
| F3 | **W3-1 的消费侧未做**：`PARTIAL_LAYOUT_MODES` 仍在 `src/dimension/ui/DimensionPanelDock.vue:65`（用到 `:395`、模板 `:1003-1010`），`meta.coverage` 只在契约层解析（`mbdV2Contract.ts:100/721/738`），**没有进诊断 store、面板不读** | 2026-11-06 检索 |
| F4 | **W3-2 的 producer 仍是 `None`**：`plant-mbd/layout.rs:137`、`:294` 两处 `source_version: None`；宿主已有 `BranchReadVersion { dbnum, sesno, databases }`（`gen-model/src/mbd/branch_query.rs:166-171`、`:527-531`），但 `layout_pipe`（`src/mbd/mod.rs:36-48`）用的是 `branch_query` 而非 `branch_query_with_diameters`，**版本号没进 `LayoutRequest`**（`plant-mbd/layout.rs:40-52` 无该字段） | 两侧源码 |
| F5 | W3-3 / W3-4 / W3-5 / W3-6 的消费侧已在 `6ee4e6bd` / `c2a913d3` 落地：直段字高表（`mbdV2ExternalAnnotations.ts:184/203`）、3D 行基面（`:651/678/684/718`）、`sourceVersion` / `isolines` 进诊断（`useMbdExternalSync.ts:304-305/422-423`）、`object_refno` 优先于 id 正则 | 源码 |
| F6 | **W3-4 有一条已登记的 kernel 尾巴**：多行文字旋转时行距方向仍是屏幕竖直（`src/dimension/kernel/layout/explicit.ts:694` 的 `stackIndex * lineAdvancePx`） | 10-29 计划 W3-4 行 |
| F7 | **polar 第二轮实测结论：不转默认（D5）**。两条金样 BRAN 上 `polarRecordCount` 从 0 变成 12 / 2，polar 真实触发；非有限值 0、pageerror 0、paint P95 +4.5～4.7%（在 10% 线内）；但 `24381_145018` 远景标签重叠 **2 → 39 对**，`24383_91813` 的 2 条 label 三档全部降级回原位 | `docs/verification/mbd-polar-ab-2026-11-06-r2/README.md` |
| F8 | **同日已改（工作区未提交）**：polar 只在 `mbd_3d=0` 下生效——`useMbdExternalSync.ts` 新增 `polarApplied = polarEnabled && presentation3dDisabled`，删掉 `polarReplacesTag`，三维呈现下开 `mbd_polar=1` 与默认逐字段相同 | 工作区 `git diff`；复测见 r2 README「修正」节 |
| F9 | polar 平面呈现的三个根因（r2 README「根因」节，**均未修**）：① `layoutViewport.ts:258` 的 `polarOccupancy` 只装本帧其它 polar 候选，同管 `linear_dim` 的 `dimension3d` 文字框不进占用网格；② `polarReplacesTag` 删掉后，polar 记录不再进 billboard 避让轮，且 `layoutAuthority='solver'` 下 `resolveLabelCollisions` 只占位不移动，**摆完没有任何一步解冲突**；③ `resolvePolarAnchor` 把 `labelAlong` 换成 `guard.chosen.textOri.x`，多行行距未随之旋转 | r2 README；`layoutViewport.ts:231/258/314` |
| F10 | 求解器剩余两件未动：`IssueCategory::Avoidance` 在 `plant-mbd` 全仓**零产出**（只有 `contract.rs:124` 的定义）；`addtopreornextpolarsystem` 的 pre/next 双向只实现了一半（`isodim.rs:541-560` 的 `carried_occupancy` 单向传递） | 2026-11-06 检索 |
| F11 | **多 BRAN 同屏已完整落地并跑通**：编解码 `mbdRefnoParam.ts`、同步层并发取数 + id 前缀 `71d1f3c6`、诊断聚合、面板多值输入、模型树右键「加入视图」；真实后端 e2e 三条 BRAN 跨两库 247 条标注 / 85 个几何对象 / `loadedDbnos=[7997,7999]`，回归用例 `e2e/multi-bran-show-refno.spec.ts` 已入库 | `docs/verification/multi-bran-e2e-2026-11-02/README.md` |
| F12 | **310 BRAN 房间的分帧口径仍待裁决**：19 206 条记录、1 330 567 段，按 `SEGMENT_BUDGET_PER_FRAME = 40 000` 切出 **48 批**（单批 p95 14.3 ms，旧 3 批单批 p95 183.5 ms）；「0.8 秒逐批长出来」vs「先画前 N 个 BRAN」是两种产品行为 | 10-29 计划 §11.17 |
| F13 | W5-1 G9 坡度符号：Web 侧现状已出图（三 BRAN × 三档，`docs/verification/w5-1-slope-symbol-web-2026-10-30/`），确认走「线 + 20° 描边箭头翼」而非实心三角；**裁决仍缺 PML 侧出图截图 + 6 条形状信息** | 10-29 计划 §11.8 |
| F14 | W5-5 的数值门禁已过（分帧三条判据全绿、`DIMENSION_PERF_GATE=1` 通过），**仍缺真实 2k 记录上的肉眼确认**；且「2k 记录」口径本身未定（单 BRAN 最多 463 图元） | 10-29 计划 W5-5 行、§11.7 |
| F15 | 前端类型基线 **0 条**（`900f8682` 从 440 收紧），按「新增 0」判定 | `scripts/type-check.mjs` 输出 |
| F16 | 本机 `node` 不在默认 PATH（在 `E:\Program Files\nodejs\node.exe`），`npm run` 的脚本内 `node` 会解析失败；需显式加 PATH 或直接调 `node.exe` | 2026-11-06 实测 |

## 2. 目标与完成定义

1. `meta.coverage` 成为面板「标注不完整」警示的唯一数据源，`PARTIAL_LAYOUT_MODES` 全仓零命中；`meta.source_version` 由 producer 真实下发并在面板可见。
2. polar 的定位被文档固化：**默认关、只在 `mbd_3d=0` 生效**；平面呈现下「摆完解冲突」与「行距随文字旋转」两件事要么修好并给出 A/B，要么明确裁决为不做（进 ADR）。
3. T5.3 / T5.7 各有一份被审阅重录的金样差异；`cargo test --workspace`、`cargo fmt --check`、`golden diff` 全绿。
4. G9 与「310 BRAN 分帧口径」各有明确裁决（做 / 不做 / 换成什么），不再挂着「待裁决」。
5. `docs/verification/` 下的 polar 两轮证据目录、`w5-1-slope-symbol-web-2026-10-30/`、`multi-bran-e2e-2026-11-02/` 全部入库。
6. 每个工作包落地后 `npm run type-check` 新增 0 / 已消失 0；S2 口径 vitest 与求解器门禁数字写进 §9。

## 3. 阶段与依赖

```
N0 收口（先做，无功能代码）
 │
 ├─ N1 契约消费侧：N1-1 coverage → N1-2 source_version（跨三仓）
 ├─ N2 polar 收尾：N2-1 D5 落地 → N2-2 平面三根因（可选，需裁决）
 ├─ N3 视觉裁决：N3-1 G9（需人） ∥ N3-2 2k 真实确认
 ├─ N4 求解器剩余：N4-1 T5.3 → N4-2 T5.7（N4-1 吃 N2-2 的算法口径，若 N2-2 不做则以前端 T3.4 为准）
 ├─ N5 多 BRAN 规模化：N5-1 分帧口径裁决（需人） → N5-2 落地
 └─ N6 文档收口（贯穿，最后一刀）
```

| 工作包 | 仓 | 可并行 | 前置 |
| --- | --- | --- | --- |
| N0 | plant3d-web / plant-mbd | — | 无 |
| N1 | plant3d-web → plant-mbd → gen-model | N1-1 ∥ N1-2 | N1-2 需宿主改动 |
| N2 | plant3d-web | 内部串行 | N2-2 需人裁决 |
| N3 | plant3d-web | 两项并行 | N3-1 需 PML 截图；N3-2 需 N5-1 的口径 |
| N4 | plant-mbd（+ gen-model 若需字段） | 内部串行 | N4-1 吃 N2-2 口径 |
| N5 | plant3d-web | 内部串行 | N5-1 需人裁决 |
| N6 | plant3d-web | — | 全部落地后 |

## 4. 工作包

### N0 收口与入库（无功能代码）

| ID | 内容 | 验收 |
| --- | --- | --- |
| N0-1 | 提交 F8 的门禁改动：`useMbdExternalSync.ts`（`polarApplied` + 删 `polarReplacesTag` + 诊断文案）与 `useMbdExternalSync.test.ts`（三维呈现下 `mbd_polar=1` 与默认逐字段相等；`mbd_3d=0&mbd_polar=1` 才挂 polar）。**这是把「polar 不误伤三维呈现」这一结论钉进代码的唯一一刀** | `npx vitest run src/composables/useMbdExternalSync.test.ts` 27/27；S2 87 文件 / 858 通过；type-check 新增 0；eslint 0。**已提交 `6f962666`** |
| N0-2 | 提交两轮 polar A/B 证据：`docs/verification/mbd-polar-ab-2026-11-06/`（6.3 MB / 33 文件，第一轮空转记录）与 `mbd-polar-ab-2026-11-06-r2/`（12.9 MB / 65 文件，第二轮真实触发 + 修正复测）。两轮都未进 `.gitignore` | 两个目录完整入库；README 保留原始结论（第一轮「零触发」的错判也留着，不删）。**已提交 `1e878753`**：r2 的 `diag-after/` 删掉 15 张与 `diag/` 字节相同的截图，目录 8.7 MB |
| N0-3 | 补登 10-29 计划的过时状态：W1-3（T3.6a / T3.6b）、W3①②③、D5 结论。只改状态不重写历史文字 | 10-29 计划 §4 W1-3 / W3 行、§5 D5 行各有一句指向本文件 |
| N0-4 | 把 `docs/verification/w5-1-slope-symbol-web-2026-10-30/` 与 `docs/verification/multi-bran-e2e-2026-11-02/` 一并入库（都是已完成的取证，未提交） | `git status` 里这两目录不再出现 |

### N1 契约消费侧收尾（F3 / F4）

| ID | 任务 | owned_paths | 验收 |
| --- | --- | --- | --- |
| N1-1 | **W3-1 消费侧**：`meta.coverage` 进诊断 store（`useMbdExternalSync.ts` 的 `MbdDiagnostics`，多源时按源顺序取第一个非空或取并集——**先定口径再写**），`DimensionPanelDock.vue` 的 `incompleteLayoutMode` 改读 coverage：把「已知 kind 全集」减去 coverage 得到缺失 kind，缺失非空才显示警示条并列出缺失 kind 名；删 `PARTIAL_LAYOUT_MODES`（`:65`、`:395`、模板 `:1003-1010`）。多源场景：任一源缺 kind 就报，文案注明是哪几个 BRAN | `src/composables/useMbdExternalSync.ts`、`src/dimension/ui/DimensionPanelDock.vue`、两者 `.test.ts` | `PARTIAL_LAYOUT_MODES` 全仓零命中；`coverage` 全 11 种时警示条不出现；缺 `aid_arc` 时警示条列出该 kind；缺字段（老后端）时退回旧行为还是静默——**需先裁决**，建议「缺字段 = 不报」（fail-open 于 UI，fail-closed 于契约） |
| N1-2 | **W3-2 producer 第三步**：宿主 `layout_pipe` 改用 `branch_query_with_diameters`（或另取 `source_version`），把 `BranchReadVersion` 通过新方法 `LayoutRequest::with_source_version(...)` 传进求解器；`layout.rs:137/294` 两处 `source_version: None` 改成从 `req` 取。`databases` 里 `db_type` 用宿主已有的字段，不新造 | `gen-model/src/mbd/mod.rs`、`gen-model/src/mbd/branch_query.rs`（若需导出）、`vendor/plant-mbd/crates/plant-mbd/src/layout.rs`（+ `contract.rs` 若需 `LayoutRequest` 新字段）、金样 6 份 | 6 份金样差异**只含** `meta.source_version` 一个新增字段（脚本核对去掉后逐值相等）；面板 MBD 标题行的「数据 dbnum@sesno」徽标在真实后端下出现；求解器与宿主两侧门禁全绿 |

### N2 polar 收尾（F7 / F8 / F9）

| ID | 任务 | 验收 |
| --- | --- | --- |
| N2-1 | **D5 结论落地为文档 + ADR**：`mbd_polar` **保持默认关**，且**只在 `mbd_3d=0` 下生效**。理由写清三条：远景重叠 2 → 39（屏幕校验看不到 `dimension3d` 文字框）、`24383_91813` 全程降级（摆完不解冲突）、多行行距未随旋转。同时记录「polar 不进入三维呈现」的取舍：三维呈现里标签是 billboard 卡片，有自己的避让轮，polar 接进来只会把卡片换成压在数值上的平面文字 | 新 ADR（编号顺延）或 10-29 计划 §5 D5 行的正式结论；`?mbd_polar=1` 的行为与 N0-1 的代码一致 |
| N2-2 | **平面呈现的三个根因**（**需先裁决做不做**，见 §5 Q2）：<br>① 占用网格预先装入已布局的 `dimension3d` 文字框与已摆好的卡片——`layoutViewport.ts:258` 的 `polarOccupancy` 除了 polar 候选，还要吃本帧非 polar 记录的 `labelBounds`；<br>② 摆完之后补一轮解冲突：`layoutAuthority='solver'` 下 `resolveLabelCollisions` 只占位不移动，需要给 polar 记录开一个「允许移动」的口子；<br>③ 多行文字旋转时同步旋转行距方向（与 F6 的 `explicit.ts:694` 是同一处） | ①+② 合并后 `mbd_3d=0&mbd_polar=1` 的重叠对数不高于 `mbd_3d=0`（r2 现状 far 71 → 93，目标 ≤ 71）；③ 的多行标签旋转后行距沿文字基线，A/B 截图证明不再错位堆叠；三项各自有单测 |

### N3 视觉裁决与真实验证（F13 / F14）

| ID | 任务 | 验收 |
| --- | --- | --- |
| N3-1 | **G9 坡度符号裁决**（**需人提供 PML 侧出图截图**）：Web 侧现状已出图，缺的是 PML 对照物与 6 条形状信息（实心/描边、边长与字高关系、直角三角形还是等腰、斜边是否就是 slope 线、箭头尖朝哪端、负坡零坡行为、多坡度排布）。材料已备齐：`all-pipes-brans.json` 里 318 个 BRAN 有 `slope_mark`，最密的 `24383_75125`（23）/ `24381_105860`（22）/ `24381_105733`（21），生成器支持 `DIMENSION_CAMERA_BASELINE_REFNOS` 覆盖 | 裁决进 ADR：要么按 PML 改成实心三角（需在 kernel 加 explicit 输入原语，成本记清），要么明确「语义对齐允许形状不同」并引用 rs-mbd 原文 |
| N3-2 | **W5-5 的真实 2k 确认**：在真实 BRAN 上跑一次页面肉眼确认无半成品帧（分帧不改像素已由顶点逐位相同的单测证明）。**前置是 N5-1 的「2k 记录」口径**——单 BRAN 最多 463 图元，2k 必然是多 BRAN 叠加或合成场景，两者结论不可互换 | 截图 + `__dimensionFrameStats.summary()` 读数；`DIMENSION_PERF_GATE=1 npx playwright test --config=playwright.novideo.config.ts e2e/dimension-perf.spec.ts` 绿 |

### N4 求解器剩余两件（F10）

| ID | 任务 | 依据 | 验收 |
| --- | --- | --- | --- |
| N4-1 | **T5.3** Polar 避让 `occupancy.rs`。算法口径以 N2-2 的 TS 实现为准；若 N2-2 裁决为不做，则以前端 `kernel/layout/polar/place/` + `screenGuard` 的现有实现为准。两边共用 PML 原 case 金样 | `layout.rs:237` 的 `carried_occupancy`、PML `polarsystem.pmlobj:1028-1296` | `IssueCategory::Avoidance` 开始产出；密集簇金样（`24383_91813`）差异逐条审阅；金样只新增 `issues` 条目，图元不动 |
| N4-2 | **T5.7** 跨段让位的另一半 `addtopreornextpolarsystem`：pre / next 双向 + `angle>160 && dis<od*15` 三跳。现有只实现单向（`isodim.rs:541-560` 的 `carried_occupancy` 把上一段的方向传给下一段） | `isobran.pmlobj:3184-3235` | 相邻直段尺寸不互相压；依赖 N4-1 的 polarsystem 概念 |

### N5 多 BRAN 规模化（F12）

| ID | 任务 | 验收 |
| --- | --- | --- |
| N5-1 | **分帧口径裁决**（**需人拍**）：310 BRAN 房间（19 206 条 / 48 批）接受「0.8 秒逐批长出来」，还是加一层「先画前 N 个 BRAN、其余按需」。两条路的产品行为不同，不能替用户选 | 裁决进 ADR；若选「先画前 N 个」，N 的取值与「其余按需」的触发方式一并定 |
| N5-2 | 按 N5-1 的裁决落地。若选「逐批长出来」，只补一条「分帧期间画面状态」的可见提示（可选）；若选「先画前 N 个」，需要新增一层 BRAN 优先级 + 按需加载 | 310 BRAN 房间下首帧 ≤ 16 ms；`getLayouts()` 最终条数不变；有 e2e 或探针读数 |

### N6 文档收口

| ID | 内容 | 验收 |
| --- | --- | --- |
| N6-1 | 10-29 计划顶部加承接指针（本文件为现行），状态表按 N0-3 更新 | 指针存在 |
| N6-2 | 审计计划 `2026-10-28-…audit-and-plan.md` 追加 §13.19（T3.6b + producer 落地）、§13.20（polar 两轮实测与 D5）、§14 门禁表新行 | 只追加，不改历史文字 |
| N6-3 | `docs/notes/README.md` 索引补本文件；若新增 ADR 一并登记 | 索引可见 |

## 5. 待裁决问题

| # | 问题 | 建议 | 归属 |
| --- | --- | --- | --- |
| Q1 | N1-1：老后端缺 `meta.coverage` 字段时，面板警示条怎么办 | 缺字段 = 不报（UI fail-open），契约仍 fail-closed | **已定（2026-11-06）**：分两刀。先接 coverage、缺字段时退回 `PARTIAL_LAYOUT_MODES` 兜底（部署窗口里老后端仍在跑）；宿主部署带 coverage 之后再删兜底，届时缺字段 = 不报。比对集合取管道应有的 8 种（不含按设计不产出的 `aid_arc` / `aid_circle` / `aid_point`，否则警示条永远亮着） |
| Q2 | **N2-2 做不做**：polar 在平面呈现下继续修（占位网格 + 解冲突 + 行距旋转），还是就此冻结在「默认关、仅平面、有已知缺陷」 | 建议**先不做**。理由：`mbd_3d=0` 本身是调试呈现，不是生产路径；polar 已确认不进三维呈现；修这三条要动 kernel 的避让语义（`layoutAuthority` 的口子），风险大于收益。若要修，按 ①②③ 顺序，每项单独 A/B | **已裁决（2026-11-06，用户）：做**。做法不开 `layoutAuthority` 口子：① 两遍布局，先布局非 polar 记录、把其文字框装进 `polarOccupancy`，polar 选位就避开它们（同时覆盖 ② 的主要情形）；③ polar 只改锚点、不改 `labelAlong`，不旋转就不错行 |
| Q3 | **N3-1 G9**：坡度符号是否必须与 PML 像素一致 | 取决于「语义对齐」的定义，需 rs-mbd 原文或人拍 | **需人 + PML 截图** |
| Q4 | **N5-1**：310 BRAN 房间的分帧口径 | 需人拍产品行为 | **已裁决（2026-11-06，用户）：两条都做**。① 接受逐批画出，但分帧中途动相机不再同步写完：画家改前后台双缓冲，宿主渲染画上一帧完整结果，换相机就取消本轮按新相机重排；② 先只画前 32 个 BRAN（URL 顺序，`mbd_limit` 覆盖），面板「再加载 / 全部加载」 |
| Q5 | N4-1 的算法口径来源：跟 N2-2 的 TS 实现，还是跟现有 `place/` + `screenGuard` | 若 Q2 选「不做」，跟现有实现（这也是 10-29 计划 D6 的结论） | 依赖 Q2 |

## 6. 风险

| # | 风险 | 处置 |
| --- | --- | --- |
| R1 | N1-2 跨三仓改动（宿主 → 求解器 → 前端），任一侧顺序反了会编译失败 | 顺序固定：求解器先加 `LayoutRequest` 可选字段（默认 `None`，金样不变）→ 宿主填值 → 金样重录。每步单独提交 |
| R2 | 金样重录把真实回归掩盖成「新增字段」 | 每份都用脚本核对「去掉新增字段后逐值相等」，不只信 `golden diff` 的通过/失败 |
| R3 | N2-2 动 kernel 避让语义会波及所有显式尺寸 | 若做，`layoutAuthority` 的「允许移动」口子必须是**新开关且默认关**，既有快照 0 变动 |
| R4 | 本机 `node` 不在默认 PATH，`npm run <script>` 内的 `node` 会失败（F16） | 跑前端门禁时显式 `$env:PATH = "E:\Program Files\nodejs;$env:PATH"`，或直接调 `node.exe` 跑脚本 |
| R5 | 工作区持续有并发进程改动并提交（RVM 线、model-tree、increment、ui/ 等） | 提交前 `git status --porcelain` 按文件白名单；只 `git add` 自己的路径 |
| R6 | polar 的验证目录共 19.2 MB，入库会显著增大仓库 | N0-2 前确认一次体积；若过大，PNG 只保留 far/mid/near 三档各一组代表图，`diag.json` 全留（数据是结论的唯一证据） |
| R7 | 裁决类工作（Q2/Q3/Q4）挂在「等人」上，容易长期空转 | 本计划把裁决与落地分成两步：裁决没下来就只做 N0 / N1 / N4-2 这些不依赖裁决的部分 |

## 7. 验收命令

> 本计划不代跑测试；每个工作包由执行者本机跑。vitest 必须从大写盘符路径启动。

```powershell
# 前置（F16）
$env:PATH = "E:\Program Files\nodejs;$env:PATH"

# 前端
cd 'D:\work\plant-code\old\plant3d-web'
node node_modules/vitest/vitest.mjs run src/dimension src/composables/useMbdExternalSync.test.ts src/api/mbdV2Api.test.ts src/utils/refnoKey.test.ts
node scripts/type-check.mjs            # 新增 0 / 已消失 0（基线 0 条）
node node_modules/eslint/bin/eslint.js <触及文件>
node node_modules/@playwright/test/cli.js test --config=playwright.novideo.config.ts e2e/dimension-*.spec.ts e2e/mbd-robustness.spec.ts
$env:DIMENSION_PERF_GATE='1'; node node_modules/@playwright/test/cli.js test --config=playwright.novideo.config.ts e2e/dimension-perf.spec.ts   # N3-2

# 求解器
cd 'D:\work\plant-code\old\vendor\plant-mbd'
cargo +stable fmt --check
cargo +nightly-2026-10-25 test --workspace
cargo +nightly-2026-10-25 clippy --workspace --all-targets    # 只允许既有 2 条
cargo +nightly-2026-10-25 run -p plant-mbd-cli -- golden diff

# 宿主
cd 'D:\work\plant-code\old\gen-model'
cargo +nightly-2026-10-25 check -p aios-database --bin aios-database
```

## 8. 不做的事

- 不改 ADR 0046 的默认 fail-closed；宽容只在 `?mbd_partial=1` / 面板开关下。
- 不把 MBD 文字改成世界尺度（ADR 0044）；不改 plant-mbd 的行位公式 / 字高 / `label_anchor`（六条金样是正确结果）。
- **不把 `mbd_polar` 转默认**（F7 已证伪）。
- 不把 polar 接回三维呈现，除非 Q2 裁决要求（届时必须防住逐帧在卡片与平面文字之间来回切——r2 实测某些角度 12 条全部降级）。
- 不重写 10-29 计划与审计计划的历史文字；状态只改状态行、结论只追加。
- 不为一次性联调新增独立 `*.test.ts`（仓规）；polar 纯数值层与 N4-1 的 PML 金样是例外。

## 9. 门禁基线（2026-11-06，只增不减）

| 仓 | 命令 | 基线 |
| --- | --- | --- |
| 前端 | `node node_modules/vitest/vitest.mjs run src/dimension/kernel/layout/polar` | **20 文件 / 246** |
| 前端 | `node node_modules/vitest/vitest.mjs run src/dimension src/composables/useMbdExternalSync.test.ts src/api/mbdV2Api.test.ts src/utils/refnoKey.test.ts` | **87 文件 / 858** |
| 前端 | `node scripts/type-check.mjs` | **0 条**，新增 0 / 已消失 0 |
| 前端 | `eslint <触及文件>` | 0 error / 0 warning |
| 求解器 | `cargo +nightly-2026-10-25 test --workspace` | **138 + 3 + 7 + 1 + 10 + 7** 全绿 |
| 求解器 | `cargo +stable fmt --check` | 通过 |
| 求解器 | `cargo +nightly-2026-10-25 clippy --workspace --all-targets` | **2 条**既有（`angle.rs` manual_contains、`thiserror` unused dep） |
| 求解器 | `cargo +nightly-2026-10-25 run -p plant-mbd-cli -- golden diff` | **6/6** |
| 宿主 | `cargo +nightly-2026-10-25 check -p aios-database --bin aios-database` | 通过 |

## 10. 已完成的对照（避免重复劳动）

| 原编号 | 内容 | 落地 |
| --- | --- | --- |
| W0-1…W0-4 | 基线 / LOD 前后对比 / T3.3 复核 / 工作区卫生 | 见 10-29 计划 |
| W1-1 | T3.4 `getBestPosAndOri` + `place()` 候选列表 | `be17e987`、`5c7ee980` |
| W1-2 | T3.5 屏幕校验层 + `occupancy` 提取 + `selectPlacement` | `3f298e7c`、`59554218` |
| W1-3 | T3.6 接入（T3.6a label / T3.6b 同管累积障碍 + 诊断） | `9eafa763`、`6417dbd6` |
| W2-1…W2-3 | T5.5 调整焊 + T5.6 PCOM 切段 + T5.4 pluslen | `5bef17f`、`8f19cdf`、`41ae234` |
| W3 ①②③ | T4.1–T4.6 契约六项 | `d7281249`、`6ee4e6bd`、`c2a913d3`、`fff0f6e`、`cb046f7` |
| W4-1 / W4-2 | 性能基线 / 健壮性 e2e | 10-29 计划 |
| W5-2 | 固定相机基线生成器 + 真实出图 | `66c78f0e`、`e04c2971` |
| W5-3 | 短线阈值分级（primary 0.8 / secondary 0.5 / detail 1.5） | `e419a2f6` |
| W5-4 | 「文字在线上方」+ 撞邻回落守卫 | `8ae96336`、`5846a50e` |
| W5-5（数值部分） | 分帧预算三条判据 | `fd42623a` + 三个连带修复 |
