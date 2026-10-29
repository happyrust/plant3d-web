# MBD 三维尺寸标注：实现审核与重构开发计划

- 日期：2026-10-28
- 性质：实现审核 + 差距分析 + 完整开发计划（本轮无代码变更）
- 参照基准：`D:\work\plant-code\old\vendor\MBD`（PML/E3D，需求事实源）· `vendor/plant-mbd`（Rust 求解器 + 冻结契约）· `gen-model`（宿主路由）
- 被审对象：`src/dimension/**`、`src/api/mbdV2Api.ts`、`src/composables/useMbdExternalSync.ts`、`src/composables/useMbdDiagnosticsStore.ts`

> **状态（2026-10-29 对齐）**：本文自 §12 起是执行日志，§7 的阶段表已不是现行路线。**现行计划见 [`2026-10-29-mbd-dimension-remaining-work-dev-plan.md`](2026-10-29-mbd-dimension-remaining-work-dev-plan.md)**——它合并了本文与[健壮性计划](2026-10-29-mbd-dimension-robustness-dev-plan.md)的剩余工作，门禁记录在其 §9。本文此后只追加落地记录（§13.x）与门禁基线总表（§14），不再新增任务；任务状态以 §12.4 的对齐表为准（§13.10 的 T4.1–T4.5 已改编号为 T7.1–T7.5）。

## 0. 本轮的方法与限制（先声明，避免误读结论强度）

| 项 | 状态 |
| --- | --- |
| 侦察方式 | 5 个并行子代理：内核布局层 / vendor PML 算法 / 后端契约链路 / PML 朝向与避让 / 门禁与未完成项；全部只读，未改任何文件 |
| CT 主脑复核 | **未完成**。4 个 CT 窗口（`bc-5716c2fd…` / `bc-cbe95b28…` / `bc-1d0a7c54…` / `bc-247197f3…`）以 `claude-fable-5-1-thinking-max` 派单，全部返回 `model_usage_exhausted`（配额耗尽），无输出 |
| `plannatator` | ~~本环境不存在~~ **2026-10-29 更正**：工具在 `C:\Users\dpc\AppData\Local\plannotator\plannotator.exe`（拼写是 plannotator，当时按 plannatator 搜所以没找到）；本文与健壮性计划因此都没走过门禁，现行计划（见文首）已补走，记录在其 §9。原记录：`where.exe plannatator`、`~/.factory/skills`、`~/.factory/tools`、MCP 工具清单、`D:\work` 全盘均无。计划改用本文件的人工编排格式，结构与 plannatator 的「阶段 → 任务 → 验收」一致 |
| 结论强度 | 所有 `文件:行号` 证据由子代理逐条核出，Lead 抽查了关键路径（`explicit.ts` / `dimension3d.ts` / `layoutViewport.ts` / `theme.ts` / `mbdV2Contract.ts` / `mbdV2ExternalAnnotations.ts` / `useMbdExternalSync.ts` / `declutterPolicy.ts` / `occlusionPolicy.ts`）。未做实机渲染复验 |

---

## 1. 结论先行（五条）

1. **呈现层已经工程化完成，不是半成品。** 冻结契约 11 种图元全部有完整几何字段与严格校验（`src/dimension/adapters/mbdV2Contract.ts:293-342`）；`linear_dim` 走三维标注重建（`kernel/layout/dimension3d.ts`），`label` 走屏幕定尺 billboard（`kernel/layout/tagBillboard.ts`），其余走平面显式布局（`kernel/layout/explicit.ts`）。成对去重（`declutterPolicy.ts`）、标签避让构件凸包（`tagBillboard.ts` 放置 pass）、inspection 遮挡淡化（`occlusionPolicy.ts`）、胶囊 SDF 描边（`viewport/scenePainter.ts`）都已落地并有 ADR。

2. **真正的差距不在前端呈现，而在「PML 那套确定性布局系统」完全没有被移植。** PML 有 `isoori`（朝向）+ `polarsystem`（极坐标避让）+ `lindim`（缩字/拆行）+ `isobran`（归段/跨段让位）四件套；Web 侧对应物是「求解器给什么画什么 + 屏幕空间事后去重」。这是架构级差异，不是缺几个字段。

3. **后端只产出 7/11 种图元，且四项关键信息不进 wire。** `angle_dim` / `aid_arc` / `aid_circle` / `aid_point` 有契约无产出（`plant-mbd/crates/plant-mbd/src/contract.rs:102-103` 明写「`angle.rs` 还没落地」）；直段结构、per-isoline 字高、对象关联、数据时点都不下发。Polar 避让在 Rust 侧同样未实现（`IssueCategory::Avoidance` 在 `src/` 零产出）。

4. **前端存在三处结构性技术债，会在继续加能力时放大。** ①`kernel` 与 `adapters` 的边界已被 `three` 依赖击穿（`adapters/mbdV2ExternalAnnotations.ts:1` 直接 `import { Matrix4, Vector3 } from 'three'`）；②同一语义有 3–6 份重复实现（`toScreen` 3 份、反投影 t 工具 4 份、`labelBounds` 6 份、LOD 判定 3 份）；③`layoutExplicit` 的 tag 分支经 `layoutViewport` 实际不可达（`explicit.ts:337` vs `layoutViewport.ts:67`），是死路径。

5. **推荐路线：不追 PML 的 2D 轴测口径，而是把 PML 的「算法骨架」移植成可注入参考系的模块，在 3D 视口里用相机参考系驱动，并在末端加屏幕空间校验层。** 理由见 §6.1：PML 的 `showdir` / `arc` / 角度环 / `minGapAngle` 全部是 2D 轴测假设，直接照搬在自由相机下会抖动、会误判、会飞出视口。子代理已逐条列出 12 个失效点与对策。

---

## 2. 现状架构（实测）

### 2.1 端到端链路

```
E3D .dat
  → e3d_io::DbSet
  → e3d_model::route::walk_route + CataloguePoints
  → gen-model/src/mbd/branch_query.rs           成员结点视图 BranchQueryResult（含合成隐式 TUBI）
  → plant-mbd::layout_branch
      ├─ members::branch_to_split_members         合成 Head/Tail
      ├─ split_isolines::split_isolines_pml       按方向变化切袋
      └─ layout::assemble_isodim
          ├─ isodim::layout_isoline               取点/字高/选向/行位
          ├─ slope::slope_symbol / skew_decomposition
          ├─ weld::weld_primitives
          └─ layout::place_tags → tag.rs
  → MbdV2PipeData（source_mm + 列主序 0.001 缩放矩阵）
  → GET /api/mbd/v2/pipe/{refno}                  gen-model/src/web_service/mbd.rs:58-69
  → parseMbdV2PipeData                            src/dimension/adapters/mbdV2Contract.ts:416
  → mbdV2ToExternalRecords                        src/dimension/adapters/mbdV2ExternalAnnotations.ts:757
  → ExternalDimensionRegistry.replaceSource
  → layoutViewport                                src/dimension/kernel/viewport/layoutViewport.ts:47
  → ThreeSceneDimensionPainter.paint              src/dimension/viewport/scenePainter.ts
  → DimensionViewport.renderOverlay（后处理之后、sRGB）  src/dimension/viewport/dimensionViewport.ts:169
```

### 2.2 前端分层实况

| 层 | 目录 | 职责 | 越界点 |
| --- | --- | --- | --- |
| domain | `domain/` | 用户尺寸文档、reducer、命令、锚点、权限、V5 迁移 | 无 |
| kernel | `kernel/` | 纯布局（设计空间 → 场景图元 + 屏幕快照）、主题、命中、碰撞、SVG 无关 | **纯性已被 `adapters` 侧破坏**（见下） |
| adapters | `adapters/` | 外部来源 → `ExternalDimensionRecord`；DTX 适配 | **`mbdV2ExternalAnnotations.ts:1` 直接依赖 `three`**，几何变换本应在 kernel |
| viewport | `viewport/` | Three 场景、画家、投影器、失效调度 | 合理（这层就该有 three） |
| services | `services/` | 文档会话、命令日志、外部注册表、持久化 | 无 |
| ui / interaction / export / facade | 各自 | 面板、指针、SVG、门面组装 | 无 |

`kernel` 内部 `three` 零依赖（`Grep "from 'three'" kernel/**` 无命中）；`three` 只出现在 `viewport/{viewerBindings,threeViewportProjector,scenePainter,dimensionViewport}.ts`、`facade/createDimensionSystem.ts`、`adapters/{mbdV2ExternalAnnotations,dtxDimensionViewerAdapter}.ts`。**`adapters/mbdV2ExternalAnnotations.ts` 是唯一不该有 `three` 的地方**——它只做 `source_to_design` 矩阵变换，用 `three` 的 `Matrix4/Vector3` 属于借便。

### 2.3 kernel 布局入口与图元产出

| 输入类型 | 入口 | 输出图元 |
| --- | --- | --- |
| `NormalizedDimensionInput`（用户尺寸：linear / projected / angular / radial） | `layoutDimension`（`layout/layoutDimension.ts:68`） | line / path / triangle / glyph-run / marker |
| `ExplicitLayoutInput` 平面路径 | `layoutExplicit`（`layout/explicit.ts:329`） | 同上 |
| `ExplicitLayoutInput.dimension3d` | `layoutDimension3d`（`layout/dimension3d.ts:99`） | line / triangle / glyph-run（带 frame） |
| `ExplicitLayoutInput.tag` | `planTagBillboard` → `materialize`（`layout/tagBillboard.ts:245` / `378`） | fill / path / line / glyph-run |

### 2.4 后处理 pass 顺序（`layoutViewport.ts:47-108`）

1. 逐条布局（tag 先 `planTagBillboard` 占位空 layout）
2. `declutterOverlaps` —— **只删不移**，败者 `lodHidden='overlap'`
3. `collectTagObstacles` → `placeTagBillboards` —— 标签避让存活标签 / 尺寸笔划 / 构件凸包 / 叠层矩形
4. `resolveLabelCollisions` —— **只移不删**，未 pinned 的标签 64px 网格 8 方向 × 8px 步进
5. `markOcclusion`（仅 `displayMode==='inspection'`）—— 只写 `derived.occluded`
6. `buildHitIndex`

**冲突点**：第 3 步读的是第 2 步的结果（未被第 4 步移动），所以标签摆放不会回头感知被移动的标签；顺序是一次性、非迭代的。MBD 记录一律 `labelPinned: true`（`mbdV2ExternalAnnotations.ts:211`），因此第 4 步对 MBD 只做占位不做移动——这个设计是对的，但意味着「MBD 标签永不避让 MBD 标签」，全靠第 2 步的成对去重兜底。

---

## 3. 能力矩阵：PML vs 求解器 vs Web 呈现

图例：✅ 完整 / ⚠️ 部分 / ⛔ 缺失

| PML 能力 | PML 证据 | plant-mbd 产出 | Web 呈现 | 差距归属 |
| --- | --- | --- | --- | --- |
| 直管段长（running dimension） | `isoline.pmlobj:1836-1963` `drawdim` | ✅ `linear_dim` main/atta | ✅ 三维重建 | 无 |
| 小尺寸文字外置（`sepSmallDim`） | `lindim.pmlobj:370-430` | ✅ `sub_kind='small'` | ✅ `outside` 判定 | 无 |
| 小尺寸拆行 + 逐级缩字 | `lindim.pmlobj:448-463`、`getgoodcheight.pmlfnc:11-38` | ⛔ | ⛔ | **求解器** |
| 字高随管径缩放 | `isoline.pmlobj:1689-1691` | ⚠️ 只给全局 `cheight_mm` max | ⚠️ 夹 11–18 px | 契约 + 求解器 |
| 等轴测朝向系统（`isoori`） | `isoori.pmlobj:61-97` | ⚠️ 朴素 `deterministic_normal` | ⛔ | 求解器 |
| 极坐标避让（`polarsystem`） | `polarsystem.pmlobj:1028-1296` | ⛔ | ⚠️ 屏幕网格成对去重（不同语义） | 求解器 |
| 角度尺寸（安装角 / 偏转角） | `isoline.pmlobj:2848-2938` `drawangle` | ⛔ `angle.rs` 未落地 | ✅ 映射已备（`mapAngleDim`） | **求解器** |
| 弧 / 圆 / 点辅助图元 | `aidarc/aidcircle/aidpoint.pmlobj` | ⛔ 无产出 | ✅ 映射已备 | **求解器** |
| 坡度符号 | `isoline.pmlobj:2564` `drawslope` | ✅ `slope_mark` + `aid_line` | ⚠️ 画线+箭头，PML 画三角形 | Web（G9 待裁决） |
| 斜管 XYZ 分解 | `isoline.pmlobj:2153-2332` | ✅ `aid_line` + `aid_text` | ✅ | 无 |
| 焊缝标记 | `isoline.pmlobj:3510` `drawweld` | ✅ `weld_mark` | ✅ 圆 + 现场焊十字 | 无 |
| 位号 / 标高 / 连接卡（tag） | `isoline.pmlobj:3717` `drawtag` | ✅ `label` + `leader_line` | ✅ billboard card/frame/pill | 无 |
| 材料框 + 管段号接排 | `isoline.pmlobj:4115-4133`、`4443-4447` | ⛔ 材料不是本能力输出 | ⛔ 无「框 + 右侧接排」 | 求解器 + 契约 |
| 调整焊附加串 ` +len` | `lindim.pmlobj:78-86`、`347-358` | ⛔ 未做 | ⛔ | 求解器 |
| PCOM 切管件 | `isobran.pmlobj`、`split_isolines.rs:242-248` | ⛔ 只记 issue | — | 求解器 |
| 归段 / 跨段让位 | `isobran.pmlobj:1470-1792`、`3184-3336` | ⚠️ 有 isoline 切袋，无跨段让位 | ⛔ | 求解器 |
| 绘制优先级 `insert(1)` | `isobran.pmlobj:1288-1295` | ⛔ | ⛔ | 求解器 |
| 设备定位尺寸（NS/EW/FLOOR） | `markEqui.pmlobj:975-1082` | ⛔ | ⛔ | 全链未启动 |
| 土建构件 / 孔洞 / 墙角度 | `markCivil.pmlobj:2675-2834`、`3773-3973` | ⛔ | ⛔ | 全链未启动 |
| 建筑板标高 `EL.` | `markCivil.pmlobj:5751-5760` | ⛔ | ⛔ | 全链未启动 |

**结论**：管道专业呈现层基本追平（除坡度符号形状待裁决）；角度/弧类「前端已备、后端未产」；避让/朝向/缩字/归段「两端都没有」；设备/土建/建筑「全链未启动」。

---

## 4. 缺陷清单（按严重度排序）

### 4.1 正确性

| # | 缺陷 | 证据 | 影响 |
| --- | --- | --- | --- |
| C1 | `adapters` 依赖 `three`，破坏 kernel 纯性边界 | `adapters/mbdV2ExternalAnnotations.ts:1` | 契约变换逻辑无法在 node 环境单测；与 ADR 0003「纯布局 + 薄画家」相悖 |
| C2 | `layoutExplicit` 的 tag 分支经 `layoutViewport` 不可达（`layoutViewport` 先拦截） | `explicit.ts:337` vs `layoutViewport.ts:66-75`；`tagBillboard.ts:476-483` 是薄封装 | 死路径；两条 tag 入口并存易误改 |
| C3 | `layoutAuthority` 只在注释里，未实现 | `mbdV2ExternalAnnotations.ts:209` 注释提及；全仓无该字段 | 「谁有权决定布局」靠 `labelPinned` 布尔硬编码，S1 计划项未闭环 |
| C4 | `PARTIAL_LAYOUT_MODES = ['linear_mvp']` 与后端实际 `layout_mode='isodim_main'` 不匹配 | `DimensionPanelDock.vue:45`；后端 `layout.rs:22` 恒报 `isodim_main` | **「本分支标注不完整」警示条永不触发**——角度/Polar 缺失对用户不可见 |
| C5 | `linear_dim.reference` 是死字段 | 契约 `contract.rs:124-125` 有，求解器 `isodim.rs:1454` 硬编码 `None` | 参考尺寸语义永远拿不到 |
| C6 | `aid_line.style` 后端无枚举约束、前端只校验 string | `contract.rs:159-160`；`mbdV2Contract.ts:244-246` | 后端发非法值会穿透校验，落到渲染层 default 分支 |
| C7 | `getgoodradiusfrombadradiuss` 的 `break` 被无条件覆盖 | `polarsystem.pmlobj:1003-1018` | 若照搬，角度弧会被推到极远；迁移必须修 |
| C8 | `getBestPosAndOri` Step 14 把半径区间当角度区间 | `polarsystem.pmlobj:1290` | 兜底分支产出错误角度；迁移必须修 |
| C9 | `mbdtextlen` 字长表缺 `x`/`X`，且有约 20 项重复 | `mbdtextlen.pmlfnc:12-13` | 若照搬，小写 x 宽度按 1.02 兜底，文字长度算偏 |
| C10 | `emptyLayout` 单点工厂，但 `layoutExplicit` 自建 `LayoutResult` | `linear.ts:35` vs `explicit.ts:446-457` | 新增 `derived` 字段时两处都要改，易漏 |
| C11 | `source_to_design` 与 `geometry_space=source_mm` 的联动只在前端强制 | `mbdV2Contract.ts:393` vs `contract.rs:47-48` | 后端类型层无约束，靠运行时兜底 |
| C12 | 旧 parquet 通道残留枚举与话术 | `useMbdDiagnosticsStore.ts:6`、`DimensionPanelDock.vue:711`、`mbdV2ExternalAnnotations.ts:209,540` 注释 | 通道已删（`adapters/` 下无该文件），UI 仍渲染「parquet」分支 |

### 4.2 性能

| # | 缺陷 | 证据 | 影响 |
| --- | --- | --- | --- |
| P1 | 每帧全量 `layoutViewport` → 全量 `paint`，无帧预算/分批/增量 | `dimensionViewport.ts:508-541` | 2k 记录时无上界；ADR 0061 明写「2k 记录分帧预算暂不做」 |
| P2 | 布局缓存因 `setProjector` 每次 new `ThreeViewportProjector` 而失效 | `layoutDimension.ts:16-66`、`viewerBindings.ts:81-87` | 缓存只在同一 projector 下跨 interaction 命中，跨相机零命中 |
| P3 | 命中索引与标签占位网格每帧重建 | `layoutViewport.ts:107`、`resolveLabelCollisions.ts:321` | 64px 网格两套，重复构建 |
| P4 | 画家每帧线性扫描全量写顶点 | `scenePainter.ts:1064-1200` | 无按 layout 分帧 |
| P5 | `angular` 布局自建弧采样（4° 步长）与 `arcProjection` 两套实现 | `angular.ts:49,133-192` vs `geometry/arcProjection.ts:43` | 同一语义两套精度/性能特征 |

### 4.3 可维护性

| # | 缺陷 | 证据 |
| --- | --- | --- |
| M1 | `toScreen` 三份完全相同 | `linear.ts:52-55`、`angular.ts:51-54`、`radial.ts:41-44` |
| M2 | 反投影 t 工具四份 | `linear.ts:157-167`、`angular.ts:169-181`、`radial.ts:107-117`、`explicit.ts:196-215` |
| M3 | `labelBounds = expandRect(glyph.bounds, labelPaddingPx/2)` 六份 | `linear.ts:117`、`angular.ts:122`、`radial.ts:91`、`explicit.ts:434`、`dimension3d.ts:297`、`tagBillboard.ts:444` |
| M4 | LOD 判定三份 | `explicit.ts:121-157`、`dimension3d.ts:129-155`、`tagBillboard.ts:264-271` |
| M5 | 主题常量散落硬编码 | `DEFAULT_MARKER_RADIUS_PX=4`（`explicit.ts:49`）、行距 1.5（`explicit.ts:394`）、角弧 4°（`angular.ts:49`）、角度扩展线 5px（`angular.ts:136`）、tag 候选角/环距（`tagBillboard.ts:92-132`）、标签网格 64/8（`resolveLabelCollisions.ts:15-24`） |
| M6 | 无消费者导出 | `makeOpenArrow`、`projectArcToScreenPath`、`makeScreenLine`、`alignToPixelGrid` |
| M7 | 两套字体体系并存 | 新 kernel LFF（`loadDimensionFont.ts`、`glyph/lffParser.ts`）vs 旧 `utils/three/annotation/**`（`SolveSpaceVectorFont.ts` 等） |
| M8 | kernel barrel 未导出 `dimension3d` / `tagBillboard` / `declutterPolicy` / `occlusionPolicy` / `sceneGeometry` 等 | `kernel/index.ts:1-23` | 上层无法直接测这些模块的中间产物 |

---

## 5. 性能与测试现状

### 5.1 性能

- 目标：ADR 0018 / 0040「500 可见尺寸 60fps」、2k 记录。
- 实测：`docs/verification/mbd-3d-dimension-presentation-2026-09-12/README.md` 记录 18 条 `linear_dim` 在远景/近景各跑 3 次统计逐字相同，无 `pageerror`；**没有 500 / 2k 规模的实测数字**。
- 门禁：`e2e/dimension-perf.spec.ts` 需 `DIMENSION_PERF_GATE=1` 才跑，默认 skip；`src/debug/dimensionPerf.ts:179-206` 有 60 帧循环计时脚本。
- 结论：**大场景性能未经门禁验证**，P1–P4 四项都指向同一处（无帧预算）。

### 5.2 测试

| 层 | 测试文件数 | 缺口 |
| --- | --- | --- |
| kernel | 30 | `planeBasis.ts`、`screenGeometry.ts`、`hitTest.ts`、`context.ts` 无直接用例 |
| adapters | 7 | `normalizeExternalDimensions.ts`、`normalizeUserDimensions.ts`、`pipeInformation.ts`、`archivedV5Source.ts` 无直接用例 |
| domain | 4 | `invariants.ts`、`commands.ts` 无直接用例 |
| viewport | 5 | `loadDimensionFont.ts` 无 |
| services / ui / interaction / export / facade | 6+3+2+1+1 | `PipeInformationPanel.vue`、`dimensionBoundActions.ts` 无 |
| e2e | 7 个尺寸相关 spec | 三个失配 spec 已于 2026-10-28 修复，见 §12 |


- 类型基线：`scripts/type-check-baseline.txt` 440 条签名 / 127 个文件，其中 `src/dimension/**` 占 107 条。
- 尺寸链回归命令（本轮实测，作为本计划全部门禁的对照基准）：
  - `npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts` → **58 文件 / 362 通过**，4.54s
  - `npm run type-check` → **440 条 / 127 文件；新增 0；已消失 0**

---

## 6. 重构方向（三个优先项）

### 6.1 优先项 A：移植 PML 的「算法骨架」，但把参考系做成可注入

**为什么不是直接照搬**：PML 是 2D 轴测图，`showdir` 固定、`arc` 是圆、`minGapAngle` 是常量、`angle` 是人工拍定的角宽。子代理已逐条列出 12 个在透视自由相机下失效的点（`vendor/MBD/object/polarsystem/polarsystem.pmlobj` 与 `isoori.pmlobj` 的假设 → 3D 失效 → 对策）：

| PML 假设 | 3D 失效 | 对策 |
| --- | --- | --- |
| `showdir` 固定且正交于轴 | 自由相机下连续变化，`abs(ta-90)<1` 边界抖动 | `showdir` 每帧从相机矩阵取；阈值加滞回（进 `<1`、出 `>3`） |
| 正交投影 | 同一 `goodRadius` 屏幕像素宽随深度变，「避让成功」≠「视觉不重叠」 | 末端加屏幕空间二次校验 |
| 角度环是二维圆 | 屏幕上是椭圆弧，遮挡角域不可见 | 可见角域与占用角域求交，不可见区间降权 |
| 遮挡 = 极坐标区间相交 | 前方构件遮挡后方标注，区间可能不相交 | 候选 `pos` 加 raycast / depth 惩罚 |
| 文字框是轴对齐矩形 | 透视下是梯形，AABB 低估近端宽度 | 用屏幕 OBB 或 SDF |
| `angle` 是固定角宽 | 屏幕角宽随距离/朝向剧变 | `2*atan(halfWidth / dist)` 动态算 |
| `minGapAngle` 固定 | 「看起来够宽」随 FOV/深度变 | 改用屏幕像素净空 |
| `dis` 是沿轴绝对距离 | 与屏幕上下不再单调对应 | 保留参数化，打分改屏幕量 |
| `mainDimDir` 锁死方向 | 自由视角下失去就近避让收益 | 降为软偏好（权重 3），仅显式要求时硬约束 |
| `getgoodradiusfrombadradiuss` 返回最外缘 | 3D 下标注飞出视口 | 必须修正（C7），并加 `1.5 × limitMaxDis` 上界 |
| `allMaxRadius` 初值 0 导致候选爆炸 | 每帧 O(n) 候选 | 给 `basicRadius * 15` 硬上界 |
| `getZDir` 用全局下 `d` | 自由相机下 `d` 无意义 | 用相机 up 替代 |

**设计**：新建 `src/dimension/kernel/layout/polar/`，把算法拆成三层：
1. **纯数值层**（与坐标系无关，可直接照搬）：`mergeAngles`、`angleInAngles`、`splitRange`、`weightedWeight`、`mbdTextLen`、`getGoodCheight`、`isoGetBestDir`、`isoGetHandleDimDir`。
2. **参考系层**（可注入）：`PolarReference { axis, origin, ring(axis, ref), showDir(), mainDimDir? }`；2D 模式注入轴测参考系（行为与 PML 完全一致），3D 模式注入相机参考系。
3. **屏幕校验层**：`getResult` 之后做投影 → 像素净空检测 → 必要时降级候选。

**必须同时修的三个 PML 缺陷**：C7（`break`→`return`）、C8（Step 14 用 `allAngleRanges`）、C9（字长表补 `x`/`X` 并去重）。

### 6.2 优先项 B：收口 `layoutAuthority`，让「谁决定布局」显式化

- 现在：`labelPinned: true` 硬编码（`mbdV2ExternalAnnotations.ts:211`），注释说「PR6 的 `layoutAuthority` 会显式表达同一决定」。
- 目标：`ExternalDimensionRecord` 增 `layoutAuthority: 'solver' | 'screen'`；`solver` 记录跳过 `resolveLabelCollisions`、只占位；`screen` 记录参与移动式避让。
- 触发条件（S1 原文）：等 rs-mbd 真发出避让后的结果，再把 MBD 翻回 `solver` 并允许 pinned。在此之前 `labelPinned` 是过渡实现。

### 6.3 优先项 C：清理边界与重复

- 把 `adapters/mbdV2ExternalAnnotations.ts` 的矩阵变换搬进 `kernel/geometry/affine.ts`（纯 TS 的 4×4 列主序实现，不引 `three`），`adapters` 只保留字段映射（C1）。
- 删除 `layoutExplicit` 的 tag 分支，tag 只走 `planTagBillboard`（C2）。
- 抽 `kernel/layout/shared/`：`toScreen`、`vertexOnLine`、`labelBoundsOf`、`lodHiddenReason` 各一份（M1–M4）。
- 把散落硬编码收进 `theme.ts`（M5）。
- 删死代码与无消费者导出（M6），退役 parquet 残留（C12）。

---

## 7. 开发计划（阶段 / 任务 / 验收）

> 每个任务给出：范围（owned paths）、依赖、验收命令。任务按可独立评审的粒度切分，`owned_paths` 之间不重叠，可并行。

### 阶段 0：前置对账（无代码）

| ID | 任务 | 验收 |
| --- | --- | --- |
| T0.1 | 复核 `PARTIAL_LAYOUT_MODES` 与后端 `layout_mode` 的错配（C4），确认「不完整警示条永不触发」 | 起 gen-model，`curl /api/mbd/v2/pipe/24381_145018`，确认 `meta.layout_mode` 实际值；对照 `DimensionPanelDock.vue:45` |
| T0.2 | 修复 3 个失配 e2e（`dimension-app-dev-smoke` / `dimension-canvas-smoke` / `dimension-pipe`） | `npx playwright test e2e/dimension-*.spec.ts` 全绿或显式标注 skip 理由 |
| T0.3 | 用 `24381_145018` 与 `24381_146979` 做一次 500 / 2k 规模实测，记录 `layoutMs` / `paintMs` | 落 `docs/verification/`，作为 P1 的基线 |

### 阶段 1：边界与重复清理（纯重构，不改行为）

| ID | 任务 | owned_paths | 验收 |
| --- | --- | --- | --- |
| T1.1 | 新增 `kernel/geometry/affine.ts`（列主序 4×4、点变换、方向变换、长度缩放），`adapters` 改用它，去掉 `three` 依赖 | `src/dimension/kernel/geometry/affine.ts`、`src/dimension/adapters/mbdV2ExternalAnnotations.ts` | `Grep "from 'three'" src/dimension/adapters/mbdV2ExternalAnnotations.ts` 无命中；`npx vitest run src/dimension` 全绿 |
| T1.2 | 抽 `kernel/layout/shared/screen.ts`：`toScreen` / `vertexOnLine` / `labelBoundsOf` | `src/dimension/kernel/layout/shared/`、`linear.ts`、`angular.ts`、`radial.ts`、`explicit.ts` | 单测数不变、快照不变 |
| T1.3 | 抽 `lodHiddenReason` 一份，三处改调用 | `src/dimension/kernel/layout/shared/lod.ts`、`explicit.ts`、`dimension3d.ts`、`tagBillboard.ts` | 三处 LOD 用例全绿 |
| T1.4 | 删 `layoutExplicit` 的 tag 分支与 `layoutTagBillboard` 薄封装 | `src/dimension/kernel/layout/explicit.ts`、`tagBillboard.ts` | `tagBillboard.test.ts` 全绿；`Grep layoutTagBillboard src/` 只剩测试 |
| T1.5 | 硬编码常量收进 `theme.ts`（标记半径、行距、角弧步长、角度扩展线、tag 候选参数、网格尺寸） | `src/dimension/kernel/theme.ts` + 各 layout 文件 | `theme.test.ts` 新增钉子；布局快照不变 |
| T1.6 | 删无消费者导出（`makeOpenArrow` / `projectArcToScreenPath` / `makeScreenLine` / `alignToPixelGrid`） | 对应文件 + `kernel/index.ts` | `npm run type-check` 新增 0 |
| T1.7 | 退役 parquet 残留（`MbdDiagnosticsChannel` 去掉 `'parquet'`，面板去掉分支，注释更新） | `src/composables/useMbdDiagnosticsStore.ts`、`src/dimension/ui/DimensionPanelDock.vue` | 面板测试全绿 |

### 阶段 2：契约与诊断收口（小改动，解锁后续）

| ID | 任务 | owned_paths | 验收 |
| --- | --- | --- | --- |
| T2.1 | `ExternalDimensionRecord` 增 `layoutAuthority: 'solver' \| 'screen'`，`layoutViewport` 按它分工 | `src/dimension/adapters/normalizeExternalDimensions.ts`、`kernel/types.ts`、`kernel/viewport/layoutViewport.ts`、`mbdV2ExternalAnnotations.ts` | MBD 记录 `authority='solver'`；`resolveLabelCollisions` 跳过；快照更新 |
| T2.2 | `PARTIAL_LAYOUT_MODES` 改为读契约（先做白名单补 `isodim_main` 的兜底，等 T4.1 契约字段到位后删） | `src/dimension/ui/DimensionPanelDock.vue` | 起真实后端，警示条按实际缺失显示 |
| T2.3 | `aid_line.style` 前端收紧为三值枚举校验 | `src/dimension/adapters/mbdV2Contract.ts` | 新增拒收用例 |

### 阶段 3：PML 算法骨架移植（核心，工作量最大）

| ID | 任务 | owned_paths | 验收 |
| --- | --- | --- | --- |
| T3.1 | 纯数值层：`mergeAngles` / `angleInAngles` / `splitRange` / `weightedWeight` / `mbdTextLen` / `getGoodCheight` / `isoGetBestDir` / `isoGetHandleDimDir` | `src/dimension/kernel/layout/polar/numeric/` | 逐函数单测，用 PML 原值做金样（含 `weightedWeight` 两张档位表、`splitRange` 分级网格） |
| T3.2 | 修 C7 / C8 / C9 三个 PML 缺陷，并在代码注释里写明「与 PML 原实现的差异及理由」 | 同 T3.1 | 缺陷用例（坏半径带、Step 14 兜底、小写 x 字宽） |
| T3.3 | 参考系层：`PolarReference` 接口 + 2D 轴测实现（与 PML 一致）+ 3D 相机实现 | `src/dimension/kernel/layout/polar/reference/` | 2D 实现跑 PML 原 case 逐值一致；3D 实现有单元测试（showDir 滞回） |
| T3.4 | `getBestPosAndOri` 14 步 + `balance` + `getDirAndCha` + `getResult`，参考系可注入 | `src/dimension/kernel/layout/polar/place.ts` | 2D 模式与 PML 结果一致；3D 模式无 NaN、无越界 |
| T3.5 | 屏幕空间校验层：投影 → 像素净空 → 降级候选 | `src/dimension/kernel/layout/polar/screenGuard.ts` | 构造重叠 case，断言降级后不重叠 |
| T3.6 | 接入 `layoutViewport`：MBD 记录在 `authority='solver'` 且契约带 polar 结果时走 polar 布局，否则走现有路径 | `kernel/viewport/layoutViewport.ts`、`kernel/layout/explicit.ts` | A/B 开关（URL `mbd_polar=1`）对比；默认关闭 |

### 阶段 4：契约扩展（跨仓，需与 plant-mbd 同步）

| ID | 任务 | 归属 | 验收 |
| --- | --- | --- | --- |
| T4.1 | `meta.coverage`：显式声明本次交付覆盖哪些 kind，让 `PARTIAL_LAYOUT_MODES` 退休 | 前端先接受可选字段 → plant-mbd mirror → producer | 前端 parser 接受可选；Rust `contract_guard` 回环 |
| T4.2 | 逐图元 `cheight_mm`（`sepSmallDim` 缩字后的组字高） | 同上 | 同上 |
| T4.3 | `label` / `aid_text` / `slope_mark` 的设计空间基线方向（PML `ori`） | 同上 | 前端 `labelAlong` / `along` 通道已就绪，给了即用 |
| T4.4 | 每个 primitive 的 `object_refno`（点尺寸跳构件，不再解析 id 字符串） | 同上 | 同上 |
| T4.5 | `meta` 增 `source_version`（dbnum / sesno / databases），让前端可显示/校验数据时点 | 同上 | 同上 |
| T4.6 | 直段结构（`isoline` 列表：index、成员、字高、od）下发 | 同上 | 前端可按直段分组/折叠 |

> 顺序约束（ADR 0055 的 D7 口径）：**前端先接受可选字段 → plant-mbd 契约 mirror → producer 开始产出**。顺序反了会被 ADR 0046 的 fail-closed 整包拒收，但不会画出半截。

### 阶段 5：求解器补全（跨仓，plant-mbd）

| ID | 任务 | 验收 |
| --- | --- | --- |
| T5.1 | `angle.rs`：`collect_installation_angles` + `angle_primitives`（tilt / rotation 两种，PML `getmemP3dirangle` 口径） | 新 toy fixture `p3-installation-angles.json` 8 case 全绿 |
| T5.2 | `PPoint.bore` 进宿主（P3 在 P1 轴线上时要用） | `e3d-model` `RoutePoint.bore` 带出 |
| T5.3 | Polar 避让（`occupancy.rs`） | 密集簇不再重叠；`IssueCategory::Avoidance` 开始产出 |
| T5.4 | 小尺寸拆行 + 逐级缩字（PML `lindim` 370-463） | 短段不再一律 elide |
| T5.5 | 调整焊附加串 ` +len` | `linear_dim.text` 带 plus 串 |
| T5.6 | PCOM 切管件 | `split_isolines.rs:242-248` 的 issue 消失 |
| T5.7 | 归段 / 跨段让位（PML `isobran` 3184-3336） | 相邻直段尺寸不互相压 |

### 阶段 6：视觉裁决与收尾

| ID | 任务 | 验收 |
| --- | --- | --- |
| T6.1 | 真实 BRAN 视觉审阅，裁决 G9（坡度符号：PML 三角形 vs Web 线+箭头） | 落 `docs/verification/`，结论进 ADR |
| T6.2 | Q5 短线阈值分级（0.5 / 0.8 / 1.5） | 本样本远景不变；中景多留一档 |
| T6.3 | Q6「文字在线上方」可选模式（仅单行 isoline） | 固定相机对比；不侵入相邻行 |
| T6.4 | QW4 固定相机截图基线 | `docs/verification/` 归档，含相机参数 |
| T6.5 | 2k 记录分帧预算 | `DIMENSION_PERF_GATE=1 npx playwright test e2e/dimension-perf.spec.ts` 通过 |

---

## 8. 依赖图与并行度

```
T0.1 ─┬─ T2.2 ─────────────────────────┐
T0.2 ─┤                                 ├─ T6.*
T0.3 ─┴─ T6.5                           │
                                        │
T1.1 ── T1.2 ── T1.3 ── T1.4 ── T1.5 ── T1.6 ── T1.7 ── T2.1 ── T2.3
                                                         │
T3.1 ── T3.2 ── T3.3 ── T3.4 ── T3.5 ────────────────────┴── T3.6
                                                              │
T4.1..T4.6（跨仓，可与 T3 并行，但 T3.6 依赖 T4.1）             │
T5.1..T5.7（跨仓，T5.3 依赖 T3.1-T3.4 的算法口径）──────────────┘
```

可并行：阶段 1 全部任务（不同文件）；阶段 4 与阶段 3 并行；阶段 5 与阶段 3 并行（不同仓库）。

---

## 9. 风险

| # | 风险 | 处置 |
| --- | --- | --- |
| R1 | Polar 移植后 3D 下行为与 PML 不一致，用户认为「不如现在」 | `mbd_polar=1` 开关默认关闭；A/B 截图对比；不达标就不默认开 |
| R2 | 跨仓契约改动被 fail-closed 拒收，线上标注全空 | 严格按「前端先接受可选 → 后端 mirror → producer」顺序；每步都有 `contract_guard` 回环 |
| R3 | 重构期间快照大量变更，掩盖真实回归 | 阶段 1 每个任务单独提交，快照变更必须写明原因；阶段 1 全绿后再进阶段 3 |
| R4 | `type-check` 基线 440 条，新代码容易踩既有坑 | 每个任务验收含「新增 0」；不靠改基线放行 |
| R5 | 2k 性能门禁默认 skip，问题可能漏到线上 | T0.3 先测基线，T6.5 把门禁接进 CI（至少 nightly） |
| R6 | 设备 / 土建 / 建筑全链未启动，契约 `MbdV2PipeData` 是管道专属（带 `branch_refno`） | 不在本计划范围；需要单独立项，先扩契约（`MbdV2ElementData` 或 `domain` 字段） |

---

## 10. 明确不做

- 不把 MBD 文字改成世界尺度（与本仓「三维尺寸呈现保持稳定屏幕视觉尺度」的领域定义冲突，ADR 0044 已定）。
- 不改 plant-mbd 的行位公式 / 字高 / `label_anchor`（六条 golden 是单线轴测图的正确结果）。
- 不在 Web 侧重新发明版面（求解器决定摆位、前端 1:1 画，ADR 0043 / plant-mbd ADR-0003）。
- 不迁移 PML 的 E3D 求交内核、建库流程、删除权限、`ori` 字符串 DSL、`handle any` 控制流、图纸单位串、图框图签（子代理已列 X1–X7 为明确排除项）。
- 不为一次性联调新增独立 `*.test.ts`（仓规）；Polar 纯数值层是例外——它是跨仓口径对齐的唯一手段，必须有金样单测。

---

## 11. 相关文档

- 本仓 ADR：0002 / 0003 / 0018 / 0040 / 0041 / 0042 / 0043 / 0044 / 0046 / 0048 / 0055 / 0056 / 0057 / 0058 / 0059 / 0061 / 0062 / 0063 / 0064
- 本仓计划：`2026-07-29-mbd-dimension-annotation-capability-audit.md`、`2026-07-30-mbd-dimension-annotation-audit-followup.md`、`2026-08-01-mbd-dimension-next-step-datasource-first-plan.md`、`2026-09-07-mbd-v2-angle-arc-contract-extension-design.md`、`2026-09-10-mbd-linear-dim-consume-contract-arrow-lines-plan.md`、`2026-09-12-mbd-linear-dim-visual-optimization-plan.md`、`2026-09-12-mbd-dimension-engineering-convention-review.md`、`2026-09-12-mbd-annotation-reference-style-prd.md`
- 验证：`docs/verification/mbd-3d-dimension-presentation-2026-09-12/`、`docs/verification/mbd-phase0-t441/`
- 需求事实源：`vendor/MBD/markpipe/object/{isoori,isoline,isobran,isoDim,isombdangle}.pmlobj`、`vendor/MBD/markpipe/function/iso{GetHandleDimDir,GetBestDir,GetDimDir}.pmlfnc`、`vendor/MBD/object/polarsystem/polarsystem.pmlobj`、`vendor/MBD/object/mbd/{lindim,aidarc,aidcircle,aidtext,aidpoint}.pmlobj`
- 求解器与契约：`vendor/plant-mbd/crates/plant-mbd/src/{contract,layout,isodim,slope,weld,tag,split_isolines}.rs`
- 宿主：`gen-model/src/{mbd/mod.rs,mbd/branch_query.rs,web_service/mbd.rs}`

---

## 12. 本轮已落地的改动（2026-10-28）

> 计划产出后立刻执行的第一个批次：阶段 0 的 T0.2（三个失配 e2e）＋阶段 1 的 T1.1（去 `three` 依赖）＋阶段 2 的 T2.2/C4、T1.7/C12。全部由 CT 主脑（`claude-fable-5-1-thinking-max`）复核后出 brief，Lead 落地并跑门禁。

### 12.1 改动清单

| ID | 缺陷 | 文件 | 内容 |
| --- | --- | --- | --- |
| C4 / T2.2 | 警示条永不触发 | `src/dimension/ui/DimensionPanelDock.vue` | `PARTIAL_LAYOUT_MODES` 由 `['linear_mvp']` 改为 `['linear_mvp', 'isodim_main']`；注释写明 `isodim_main` 仍只产 7/11 种图元，待契约 `meta.coverage`（T4.1）到位后整段退休 |
| C4 | 横幅零覆盖 | `src/dimension/ui/DimensionPanelDock.test.ts` | 新增用例：`isodim_main` / `linear_mvp` 必须渲染 `[data-testid="mbd-incomplete-annotation"]`；`null` 与未知模式不得渲染；`afterEach` 补 `useMbdDiagnosticsStore().clear()`（模块级单例） |
| C12 / T1.7 | parquet 通道残留 | `src/dimension/ui/DimensionPanelDock.vue` | 诊断摘要的通道文案由 `channel === 'api' ? '实时' : 'parquet'` 改为固定「实时」 |
| C12 / T1.7 | 同上（类型侧） | `src/composables/useMbdDiagnosticsStore.ts` | `MbdDiagnosticsChannel` 由 `'api' \| 'parquet'` 收窄为 `'api'`；`:11` / `:21` 注释去掉 parquet 措辞 |
| C1 / T1.1 | adapters 依赖 `three` | `src/dimension/kernel/geometry/affine.ts`（新）、`affine.test.ts`（新）、`kernel/index.ts`、`adapters/mbdV2ExternalAnnotations.ts` | 新增纯 TS 列主序 4×4：`Mat4ColumnMajor`、`isMat4ColumnMajor`、`transformPoint`（含 w 归一，运算顺序照 THREE `applyMatrix4`）、`transformDirection`（不归一化）、`transformLength`；适配器删掉 `three` 导入，改用 `import * as affine`；纯性由单测读源码断言 `not.toMatch(/from 'three'/)` |
| T0.2 | e2e 断言过时 | `e2e/dimension-app-dev-smoke.spec.ts` | ①URL 由 `?dimension_demo=1`（`src/` 已无读取点）改为 `?dtx_demo=primitives&dtx_demo_count=1`；②叠层断言改读 `viewport.overlayScene` 并额外断 `parent === null`（ADR 0064）；③菜单点击由 `getByText('尺寸标注')`（strict 违规 + hierarchical 模式未展开）改为 `[data-ribbon-tab="view"]` → `[data-command="panel.dimension"]` |
| T0.2 | e2e 断言过时 | `e2e/dimension-canvas-smoke.spec.ts` | `getSceneObjectCount()` 期望值 `2` → `4`（画家 group 固定四个 mesh：lines / lineEdges / arrows / fills） |
| T0.2 | 测试对象已删 | `e2e/dimension-pipe.spec.ts` | 删除。它依赖的 `/dimension-pipe-sandbox.html` 与 `src/debug/dimensionPipeSandbox.ts` 均不存在（`c52a8227` 删除）；且该文件**从未入库**——`.gitignore:60` 的 `e2e/*` 规则把它排除在外，属本地残留 |

### 12.2 门禁结果（实测）

| 命令 | 结果 |
| --- | --- |
| `npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts` | **60 文件 / 379 通过**（基线 58 / 362，+17 来自 `affine.test.ts` 9 条与 `normalizeExternalDimensions.test.ts` 6 条、适配器与面板各 1 条） |
| `npm run type-check` | 基线 440 条 / 127 文件；**本轮改动新增 0** |
| `npx eslint`（本轮触及的 9 个文件） | 0 问题 |
| `npx @playwright/test test e2e/dimension-canvas-smoke.spec.ts --config=playwright.novideo.config.ts` | **通过**（8.2s） |
| `npx @playwright/test test e2e/dimension-app-dev-smoke.spec.ts --config=playwright.novideo.config.ts` | **通过**（10.0s） |
| `npx @playwright/test test e2e/dimension-mbd-v2-fixture.spec.ts --config=playwright.novideo.config.ts` | **2 通过**（回归对照） |

### 12.3 环境坑（重要）

**默认 `playwright.config.ts` 的 `video: 'retain-on-failure'` 在本机会让 context teardown 超时**：测试主体已跑完，报错是 `Tearing down "context" exceeded the test timeout`。所有 dimension e2e（包括本轮未改动的 `dimension-mbd-v2-fixture`、`dimension-doc-screenshots`）都会这样失败，与本轮改动无关。验证时改用 `--config=playwright.novideo.config.ts`；要不要把录像默认关掉是独立议题。

### 12.4 未落地 / 下一批

| 项 | 状态 |
| --- | --- |
| T2.1 / C3 `layoutAuthority` | **已落地**，见 §12.5（2026-10-29 前编号为 §12.6） |
| T1.1–T1.7 | **已落地**，见 §12.7 |
| T2.3 / C6 `aid_line.style` | **已落地**，见 §12.7 |
| T3.1 / T3.2 polar 纯数值层 | **已落地**，见 §12.7 |
| ~~T3.3–T3.6 / T4 / T5 / T6~~ | ~~未开始~~（2026-10-28 的记录；下列各行为 2026-10-29 对齐后的状态） |
| T0.1 | 实质完成——C4 复核结论随 T2.2 落地（§12.1），无单独记录 |
| T0.3 性能基线 | 未做，`docs/verification/` 下无 MBD 性能记录 → 现行计划 W4 |
| T3.3a / T3.3b / T3.3c | **已落地**，见 §13.11（5c7ee980）/ §13.14（3f298e7c） |
| T3.4–T3.6 | 未开始（`mbd_polar` 全源码零命中；T3.5 只有 §13.13 的落点预判）→ 现行计划 W1 |
| §7 原 T4.1–T4.6（契约扩展） | 未开始（`meta.coverage` 在 adapters 零命中）。2026-10-29 裁决：保留 → 现行计划 W3 |
| T7.1–T7.5（§13.10 新增，原误用 T4.1–T4.5 编号） | **已落地**，见 §13.10（1a40b46a、63d566e、483713ee + 68f36d5e） |
| T7.6 LOD 阈值拆分 + 退化四边形回退（计划外批次） | **已落地**，见 §13.15（12f4bb1e） |
| T5.1 / T5.2 | **已落地**，见 §13.3 / §13.8（plant-mbd 0b89b76、gen-model 1caf3a84） |
| T5.3–T5.7 | 未开始（plant-mbd 停在 63d566e）→ 现行计划 W2 |
| T6.1–T6.5 | 未开始，无记录 → 现行计划 W5 |
| 健壮性计划 D1 / E3 | 未做 → 现行计划 W4（其余 A–E 项见该计划 §9） |

### 12.5 B4：`layoutAuthority`（T2.1 / C3，已落地）

**修法与计划原稿的偏差**：原稿写「`layoutViewport` 按 authority 分工」，实际 **kernel 一行未改**——`solver` 的语义就是现有的 `labelPinned: true`（`resolveLabelCollisions.ts:324-331`：pinned 只 `occupancy.insert` 占位、不进 `automatic` 候选，因此不移动、不补引线）。所以字段只在记录层显式化，由唯一归一入口折算成布尔送进内核，`goldens.test.ts.snap` 不变。

| 文件 | 内容 |
| --- | --- |
| `src/dimension/adapters/normalizeExternalDimensions.ts` | 新增 `ExternalLayoutAuthority = 'solver' \| 'screen'`；`ExternalDimensionRecord` 增可选 `layoutAuthority?`（缺省由 `layout.labelPinned` 推导）；新增 `externalLayoutAuthority(record)`；`normalizeExternalDimension` 在 `...record.layout / id / role` 之后追加 `labelPinned: externalLayoutAuthority(record) === 'solver'`（显式字段压过布尔） |
| `src/dimension/adapters/normalizeExternalDimensions.test.ts`（新） | 6 条：缺省推导两向、显式两向压过布尔、归一保留 record 的 id/role 且几何不动、`externalDimensionCategory` 缺省值 |
| `src/dimension/adapters/mbdV2ExternalAnnotations.ts` | `explicitRecord` 返回值增 `layoutAuthority: 'solver'`（`labelPinned: true` 保留）；parquet / PR6 措辞的注释改写为 authority 口径；「older parquet rows」→「older payload rows」 |
| `src/dimension/adapters/mbdV2ExternalAnnotations.test.ts` | 新增断言：MBD 记录全部 `layoutAuthority === 'solver'` 且归一后 `labelPinned` 全 true |

**向后兼容**：7 个既有生产者一行未改——缺省推导把 `bran-clearance` / `pipe-information` 等 `labelPinned: false` 折成 `screen`、MBD 的 `true` 折成 `solver`，归一结果与改前逐位相同。

**门禁**：`npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts` → **60 文件 / 379 通过**（+7）；`npm run type-check` 新增 0；`npx eslint`（4 个文件）0 问题。


### 12.6 本轮发现的范围外改动（需单独处置）

执行 B3 期间，工作区出现一批不在任何 brief 声明范围内的改动，来源不明（时间戳 17:26，与 B3 同批）：

- `src/viewer/camera/{cameraIntent,focusScope}.ts` + 两个 `.test.ts`（新目录）
- `src/viewer/dtx/{DtxViewer,DtxCompatViewer}.ts`、`src/viewer/dtx/DtxViewer.flyTo.test.ts`（新）
- `src/components/dock_panels/ViewerPanel.vue`、`src/composables/{useModelGeneration,usePdmsOwnerTree,useRoomClip,useRoomInfo,useRoomTree,useSpatialQuery}.ts`
- `docs/verification/dimensions/screenshots/{angular,linear,projected,radial}.png`

其中 `src/viewer/dtx/DtxViewer.flyTo.test.ts` 引入了 **2 条新增类型错误**（`TS2339` / `TS2741`，`FakeCamera` 缺 `target`），是本轮 `npm run type-check` 未达「新增 0」的唯一原因。这批改动与 MBD 尺寸标注无关，未纳入本轮验收，也未提交；提交前需单独审查或从工作区剔除。

（补充：这批 viewer 改动已于 `93c9d8c2` / `5dfd443c` 单独入库，类型错误一并修掉；`docs/verification/dimensions/screenshots/` 四张 PNG 仍单独处置。）

### 12.7 后续批次执行记录（2026-10-28 晚）

> §12.1 之后在同一工作区继续落地的第二至第五批，均未改变现有渲染行为；门禁按累计态实测。

| ID | 落地内容 | 文件 | 门禁 |
| --- | --- | --- | --- |
| T1.1 | 去 `three`：新增 `kernel/geometry/affine.ts`（列主序 4×4，`transformPoint` 照 `applyMatrix4` 的运算顺序），适配器改用它 | `kernel/geometry/affine.ts`、`adapters/mbdV2ExternalAnnotations.ts`、`kernel/index.ts` | kernel + adapters 47 文件 / 313 用例；type-check 新增 0 |
| T1.2 | `kernel/layout/shared/screen.ts`：`toScreen` / `labelBoundsOf` / `trimBoundsOf` / `backProjectedSegment` / `sceneVertexOnSegment` | `shared/screen.ts`、`linear` / `radial` / `dimension3d` / `explicit` / `angular` / `tagBillboard` | 快照既有条目 0 变动 |
| T1.3 | `kernel/layout/shared/lod.ts`：`projectedSourceTextHeightPx` / `lodSecondaryFar` / `lodDetailFar` / `lodShortLine` / `lodTierHiddenReason` | `shared/lod.ts`、`explicit` / `dimension3d` / `tagBillboard` | 同上 |
| T1.4 | 删 `layoutExplicit` 的 tag 分支与 `layoutTagBillboard` 薄封装，tag 只走 `layoutViewport` 的 plan / place 两段 | `layout/explicit.ts`、`layout/tagBillboard.ts`、`layout/tagBillboard.test.ts` | tag 用例全绿 |
| T1.5 | 布局常量收进 `theme.ts`：标记半径、行距、角弧步长、射线外伸、tag 候选/环距/侵入权重、declutter 步长；两处改为可注入参数 | `kernel/theme.ts`、`theme.test.ts`、`resolveLabelCollisions.ts`、`layoutViewport.ts` | `theme.test.ts` 新增钉子；快照不变 |
| T1.6 | 删无消费者导出：`makeOpenArrow`（含 `arrow.ts`）、`projectArcToScreenPath`、`makeScreenLine`、`alignToPixelGrid` | `geometry/arrow.ts`、`arcProjection.ts`、`screenGeometry.ts`、`projector.ts` | 全仓无残留引用 |
| T1.7 | 退役 parquet 通道残留（同 §12.1） | — | — |
| T2.3 / C6 | `aid_line` / `aid_arc` / `aid_circle` 的 `style` 收紧为 `solid` / `dashed` / `dash_dot`，未知值整包拒收 | `adapters/mbdV2Contract.ts` | 新增拒收用例 |
| T3.1 / T3.2 | PML polar 纯数值层：角度区间、`splitRange`、`weightedWeight`、`mbdTextLen`、`goodRadius`、Step 14 兜底、iso 朝向/选向、字高；修正 C7 / C8 / C9 | `kernel/layout/polar/numeric/**`（19 文件） | 9 文件 / 75 用例；目录当前无外部引用 |
| T0.2 | 两条尺寸 smoke 的断言修正（`dtx_demo`、`overlayScene`、ribbon data 属性、画家四个 mesh） | `e2e/dimension-*-smoke.spec.ts` | Playwright 2/2 |

**累计门禁（本表全部落地后实测）**：`npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts` → **70 文件 / 471 通过**；`npm run type-check` → **440 条 / 127 文件，新增 0**；`npx eslint`（触及文件）0 问题；`npx playwright test`（novideo 配置）尺寸 smoke 2/2。

**计划与实际的偏差**：§7 声称各任务 `owned_paths` 不重叠、可并行，实际 `explicit.ts` 被 T1.2 / T1.3 / T1.4 / T1.5 四个任务改到，`tagBillboard.ts` 被三个，`kernel/index.ts` 被 T1.1 / T1.6 共用一行。落地时按主题合并成独立提交（polar、契约 style、e2e、面板、T1.1+T1.6、T2.1、T1.2+T1.3、T1.4+T1.5），而不是按六个 T1 任务逐条拆。

---

## 13. 三路侦察后的可执行任务分解（2026-10-29）

> 本轮不再新增判断，只把三份侦察（polar 参考系、求解器 11 kind 产出实况、三个零产出 kind 的 PML 源）的结论固化成可派工的 brief。所有 `文件:行号` 均来自实读。

### 13.1 侦察确认的四个硬事实

| # | 事实 | 证据 |
| --- | --- | --- |
| F1 | 11 个 kind 里 **7 个有产出**，`angle_dim` / `aid_arc` / `aid_circle` / `aid_point` 零产出；6 份金样对这四个 kind **各 0 条** | `fixtures/golden/*.json` 实测 kind 分布；`contract.rs:22-23` 自述「`angle.rs` 是第 ③ 步」 |
| F2 | `angle.rs` **文件不存在**，`lib.rs` 无 `pub mod angle`，`layout.rs` 全文 `MbdPrimitive::` 命中只有 `LinearDim` | `Test-Path` 返 False；`lib.rs:27-37`；`layout.rs` |
| F3 | `aid_arc` 与 `angle_dim` 是**同一个构造点**（`isoline.pmlobj:2865` 的 `arc` 同时喂 `aidarc` L2869 与角度文字 L2904）；`aid_circle` 只出现在支架/土建路径（`suiSupport.pmlobj:2619/3209`、`instSupport.pmlobj:5024`、`markCivil.pmlobj:2256-2304/5876-5877`），管道 ISO 路径零调用；`aid_point` 在整个 `vendor/MBD` 里**没有任何自动产出点**，只有 E3D 手动工具（`mbd.uic:194-207`） | 见 §13.3 |
| F4 | polar 数值层 19 个导出**目录外零消费者**（`kernel/index.ts` 未导出 polar 路径）；参考系真实缺口是 D-a（平面正交基硬编码在 `isoHandleDimDir.ts:97-112`，不可注入）、D-b（角度零点/绕向随 D-a）、D-d（方向可见性/遮挡完全缺失）、D-e（投影/像素净空完全缺失） | 见 §13.2 |

### 13.2 阶段 3 续（polar 参考系）任务表

串行链：**T3.3a → T3.3b → T3.4 → T3.5 → T3.6**。可并行：T3.3c ∥（T3.4 金样只绑 2D）。

| ID | 内容 | owned_paths | 依赖 |
| --- | --- | --- | --- |
| T3.3a | `PolarReference` / `PolarElement` 类型 | `kernel/layout/polar/reference/types.ts`（新） | 仅 numeric |
| T3.3b | 2D 轴测 `IsoSheetReference`（照 `polarsystem.getDetail` L151-289 的 `referencedirs` / `prehoridir` 45°/135° 滞后 / `lookangle→showdir`） | `…/reference/isoSheet.ts` + `.test.ts` | T3.3a |
| T3.3c | 3D 相机 `CameraReference`（`showDir` 从 `projector.forward` 派生 + 进入 <1°/退出 >3° 滞回，挂实例不挂模块；背向候选加罚） | `…/reference/camera.ts` + `.test.ts` | T3.3a |
| T3.4 | `getBestPosAndOri` 14 步 + `balance` + `getDirAndCha` + `getResult` | `…/polar/place.ts`（超 600 行再拆）+ `.test.ts` | T3.3a + T3.3b |
| T3.5 | 屏幕校验层：投影 → 像素净空 → 按 `alldisbests`（`polarsystem.pmlobj:1273-1282`）降级；可抽出 `collision/occupancy.ts`（从 `resolveLabelCollisions.ts:64-118` 提取 `LabelOccupancy`） | `…/polar/screenGuard.ts` + `.test.ts`；`kernel/collision/occupancy.ts`（新） | T3.4（需返回排序候选列表而非单个最优） |
| T3.6 | 接入 `layoutViewport` + `mbd_polar=1`（读在 `useMbdExternalSync`，与 `mbd_3d` 同构；flag 不进 kernel，`ExplicitLayoutInput.polar` 是纯数据） | `kernel/types.ts`、`kernel/viewport/layoutViewport.ts`、`adapters/mbdV2ExternalAnnotations.ts`、`composables/useMbdExternalSync.ts`、`kernel/index.ts` | T3.3c + T3.5 |

**polar 关键裁决**（写进 T3.3 模块头）：

- 候选用角度区间（保 PML 打分对齐），验收用屏幕包围盒（`declutterPolicy.ts:72-85` 的 `convexQuadsOverlap` 现成）。**不做二选一**。
- `getgoodradius`（`polarsystem.pmlobj:683-967`）整块跳过——它依赖 E3D 求交；`getgoodradiusfrombadradiuss`（`:969-1025`）已移植为 `goodRadiusFromBadRadii`（C7 修复版）。
- `getMainDimDir`（`:347-365`）自递归版不移植，`maindimdir` 作参考系输入（软偏好，缺省 null）。
- 死代码不移植：`getBestPosAndOriold/old2`、`replenishold`、`getSplitRange`、`mergeCellAngles`、obj 内 `mergeangles`。
- 三个设计前必读偏差：**X1** `suiDirDis` 返回 `Math.abs(signed)`（`getGoodCheight.ts:52-53`），调用方又套一层 `Math.abs`（`:77`/`:86`）——14 步若需符号，此处是错误源头；**X2** `isoHandleDimDir.ts:54/62/67/75` 自建 `angleBetweenDeg/normalize/cross/dot`，与 `isoDirections.ts:1` 的 `kernel/vec.ts` 重复，且 `angleBetweenDeg` 对零向量返 0 而 `angleDeg` 返 `NaN`；**X3** `splitRange` 的 `orderRangesByBests`（`:170-184`）在 angle 模式用 `angleInAngles` 判定归属，会先把区间「认领」给更靠前的 best——移植时必须保持 PML 的入参顺序。

### 13.3 阶段 5 续（求解器）任务表

| ID | 内容 | 现状 | 依据 |
| --- | --- | --- | --- |
| **T5.1** | `angle.rs`：`collect_installation_angles` + `mem_p3dir_angle` + `build_angle` + `dir_text` + `installation_angle_primitives` | **✅ 已落地**（`plant-mbd` 提交 `0b89b76`，15 文件 +1708/−19；`angle.rs` 1019 行 + 21 条单测；`fixtures/p3-installation-angles.json` 10 个 toy case；六份金样已审阅重录） | PML `isobran.pmlobj:2563-2633` / `:2635-2757`、`isombdangle.pmlobj:35-104`、`isoline.pmlobj:2848-2958`、归属 `isobran.pmlobj:1153-1297` |
| T5.2 | `PPoint.bore` | **✅ 已落地**（求解器 `data_source.rs:25-29` `Option<f64>` + `skip_serializing_if`；`angle.rs:175-179` 的 on-axis 闸门已按 PML 语义恢复；宿主 `gen-model` 提交 `1caf3a84` 在 `branch_query.rs:667` 透传 `point.bore`，净增 1 行） | `e3d-model/src/catalogue_point.rs:169-170` 的 `CataloguePoint.bore: Option<f64>`（`PBOR` 求值结果）直接可用；`plant-mbd` 的 `PPoint` 已加字段 |
| T5.3 | Polar 避让 `occupancy.rs` | **未实现** | `IssueCategory::Avoidance` 在 `src/` 零产出；`layout.rs:302` 明写「没有 Polar 系统」 |
| T5.4 | 小尺寸拆行 + 逐级缩字 | **部分实现** | 已照搬 `sepSmallDim`（`isodim.rs:1294-1367`：1mm 去重、`changeCheightAuto` 0.7、逐对缩字 0.8、叠行 `cheight*1.2*level`）；**缺** `pluslen` 项（`:1318` 只有 `text_length_units*cheight`）；`:1387-1391` 仍按 `MIN_DIM_LENGTH_MM=0.1` 抑制极短段 |
| T5.5 | 调整焊附加串 ` +len` | **未实现** | `weld.rs` 全文无 `plus`/`adjust`；`isodim.rs` `tgrep "plus"` 零命中。PML `lindim.pmlobj:322-359`（`!plusstring = ' +' & string(!adjustlen)`） |
| T5.6 | PCOM 切管件 | **未实现** | `split_isolines.rs:242-248` 仍输出 `"P1: PCOM not implemented"` |
| T5.7 | 归段 / 跨段让位 | **部分实现（约一半）** | 已实现 `addUsedDirToNext`（PML `isobran.pmlobj:3288-3336`）：`isodim.rs:507-517` 收 `carried_occupancy` 压本段起点 `±od/2` 的 90° 占位，`:542-546` 按「与下一段管轴 >85° 才加」判据。**未实现** `addtopreornextpolarsystem`（`isobran.pmlobj:3184-3235`：pre/next 双向传递 + L3220-3234 的 `angle>160 && dis<od*15` 三跳让位），因本库无 `polarsystem` 概念 |

**T5.1 的五个已裁决偏差**（必须写进 `angle.rs` 模块头）：

1. **ATTA 近似**：PML 遍历 `pipeatta.attaobjects` 按 `objecttype` 分派（`ISOELBOPAD` 跳过、`ISOLUG/ISOPAD` 用 `object.dir`、其余 `attapos.direction(pos)`），并按 `realaod = 2·(dist(mempos,attapos)+routside)` 覆盖 aod（`isobran.pmlobj:2686`/`:2749`）。求解器没有 attaobjects 输入 → v1 用 `kind == Atta` 的 `ppoint(3).dir` 作 p3dir、自身 `outside_diameter` 作 aod（即 PML `ISOLEG` 分支的 3 参构造）。偏差：无法识别 `ISOELBOPAD`，`realaod` 偏大。
2. **`ori.ydir` 兜底**：PML `handle any` 用 `ori of $!mem` 的 `ydir` 顶替 `adir`（`:2638-2641`）；求解器无 ori → 用 `ppoint(1).dir` 近似。
3. **`showdir` 替代**：PML 用 `polarsystem.showdir`（观察向）；求解器用该 isoline 的 `dim_dir`，缺失退回 `UP`。
4. **`radius = aod × 0.7`**：PML 走 `polarsystem.getgoodradius`（E3D 求交，求解器无此能力）。常数出处是 `isoline.pmlobj:2849-2850` 被注释掉的上一代实现（`radiusaodbili = 0.7`），量级与「清出管表面 ≈ aod/2」一致，以 aod 为上界天然不飞出。备选 A（`textlen/2`）系统性偏小（PML 恒把管身加进 polar，`isoline.pmlobj:274`）；备选 C（简化 polar 只对管身建坏带）留作后续迭代。
5. **`gettext` 的 DSL 重写**：PML 用 `dir.wrt(world).string()` 的方向字符串再解析（`isombdangle.pmlobj:74-104`）。Rust 侧规则：±X/±Y/±Z 六轴逐一试，夹角 <1° 出纯轴文本；否则取 |分量| 最大的两轴 `A`/`B`，投到 (A,B) 平面与 A 的夹角 1 位小数去尾零 → `"{A} {θ}° {B}"`；分量并列按固定轴序 `X > Y > Z`。**未确认**：PML DSL 的 3 段/5 段次序约定无离线文档，本规则为自洽近似，需上线后对账。

**T5.1 的其他硬约束**：

- `AngleDim` **自带弧框架与 `leg_lines`**（`contract.rs:127-130` 明写「PML 的两个方向小字不在这里，用独立的 `aid_text`」）。**不要**另发同名 `aid_line` / `aid_arc` / 主 `aid_text`，否则前端双重绘制。
- `p3` 在 P1 轴线上（`templine.distance(p3pos) < 1`）时 PML 查 `p3 bore`，unset 或 0 才跳过（`isobran.pmlobj:2595-2600`）。**无 `PPoint.bore` 时一律按跳过处理**（偏差方向是「少产出」，安全侧）。
- 方向小字的 `textlen` 用 `chars().count() × 0.6 × (cheight/2)`（**字符数**，`isoline.pmlobj:2924`），主文字才用 `mbdtextlen`（`:2881`）。
- 方向纠正是**整体替换**不是取反：`p3dir := normalize(p3pos − nearest_on_line)`（`isobran.pmlobj:2604-2607`）。
- `start_angle_deg` 恒 0、`sweep_angle_deg` = `angle(dir1,dir2)`（`isoline.pmlobj:2863-2864`）。
- `meta.notes` 追加 `installation_angles=N`；**不改 `layout_mode`**（`contract_guard.rs:329` 只断言 `notes.len() == 1`，安全）。
- 布局失败一律**静默跳过**（PML 同款），不发 issue——否则 `layout.rs` 现有 `rules == [...]` 断言会破。

**T5.1 对 6 份金样的影响面（实测粗算，非最终结论）**：

| 金样 | 非 ATTA/ELBO/BEND 且带 P3 的成员 | 预期 |
| --- | --- | --- |
| `24381_145018` | OLET ×1、VALV ×1（p3dir 均轴对齐） | 非 ATTA 路径 0；**ATTA ×6 走近似路径，很可能新增** |
| `24383_100028` | FTUB ×14（多数 p3dir = +Z 轴对齐，2 个斜向） | 斜向 2 个可能产出 |
| `24383_76191` | 无 P3 | 0 |
| `24383_91813` | FTUB ×5（p3dir 水平斜向，`(-0.713,0.701,0)`） | 5 个可能产出 |
| `24383_99996` | FTUB ×10（2 个斜向） | 2 个可能产出 |
| `24384_26229` | VALV ×1（+Z 轴对齐）、ATTA ×6 | ATTA 路径可能新增 |

→ **必须先跑 `cargo run -p plant-mbd-cli -- golden diff` 逐条审阅差异，再由审阅方决定是否 `golden record --force`**。`golden_regression.rs` 与 `contract_guard.rs` 代码本身不改（`full-coverage.json` 已含四个零产出 kind 的实例）。

### 13.4 三个零产出 kind 的优先级（裁决：不做 live 产出）

| kind | PML 唯一产出点 | 裁决 | 理由 |
| --- | --- | --- | --- |
| `aid_arc` | `isoline.pmlobj:2869`（与 `angle_dim` 同一条 `arc`，`isoline.pmlobj:2865`） | **不单独产出** | 与 `angle_dim` 几何完全重合，同时输出会让前端画两条重合弧。ADR-0011 L44 已否决「腿拆成独立 `aid_line`」的同类做法。`aid_arc` 只在支架/土建/设备路径（本库非目标）才有独立出处 |
| `aid_circle` | `suiSupport.pmlobj:2618`（管道信息圈）、`:3202-3210`（管夹标号圈）、`instSupport.pmlobj:5024`、`markCivil.pmlobj:2256-2304/5876-5877` | **不做** | 全部属支架/土建图（`vendor/plant-mbd/AGENTS.md` 明列非目标）；且需先补「同一 BRAN 多 ATTA 合并成多行文本 + A/B/C 字母标号」这条 `tag.rs:268-287` 缺口（当前每 ATTA 单独出一个 `AttaTag`） |
| `aid_point` | **无自动产出点**（`mbd.uic:194-207` 是 E3D 手动工具；`getpolarelement.pmlobj:806-807` 只读不建） | **维持现状（契约有几何、live 不产出）** | 求解器主动造点等于伪造标注，违反 `vendor/plant-mbd/AGENTS.md`「布局失败输出 issues，不硬画错误标注」。要产出必须先让宿主透传库里的 `aidpoi` 列表（`BranchQueryResult` 加字段） |

### 13.5 派工顺序（当前生效）

```
① ✅ T5.1   angle.rs（已提交 plant-mbd 0b89b76，六份金样已审阅重录）
② ✅ T5.2   PPoint.bore 宿主透传（gen-model 1caf3a84，branch_query.rs:667 一行）
③ ✅ T7.1（原 T4.1）   前端契约扩展 AidText.text_height_mm（先接受可选字段，1a40b46a）
④ ✅ T7.2（原 T4.2）   plant-mbd mirror text_height_mm + angle.rs 下发 cheight/2 + 重录金样（63d566e）
⑤ ✅ T7.4（原 T4.4）   过期注释（DimensionPanelDock.vue:47-49）
⑥ ✅ T7.5（原 T4.5）   angle_dim golden 快照（+2 it，559 → 561）
⑦ ✅ T7.3（原 T4.3）explicit 弧像素下限（483713ee + 68f36d5e，落点 explicit.ts:341-351；561 → 564）
⑧ ✅ T3.3a（5c7ee980，564）    PolarReference 类型（前端串行链起点）
⑨ ✅ T3.3b ∥ T3.3c（3f298e7c，见 §13.14）
⑩ T3.4 → T3.5 → T3.6（→ 现行计划 W1）
⑪ T5.5（调整焊 +len）∥ T5.6（PCOM）
⑫ T5.4（pluslen 小尺寸拆行）
⑬ T5.3（occupancy）→ T5.7（跨段让位，依赖 T5.3）
```

**并行约束**：⑦ 改 `explicit.ts` + `explicit.test.ts`，⑧ 只新建 `polar/reference/types.ts`，两者无重叠可并行。⑪ 的两个侦察员互不重叠（T5.5 走 `isoline.pmlobj` / `lindim.pmlobj`，T5.6 走 `isobran.pmlobj` / `split_isolines.rs`）。

### 13.6 门禁（每条必跑，只增不减）

| 仓 | 命令 | 当前基线 |
| --- | --- | --- |
| 前端 | `cd 'D:\work\plant-code\old\plant3d-web'; npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts src/api/mbdV2Api.test.ts src/utils/refnoKey.test.ts` | **74 文件 / 561 通过**（T4.5 后） |
| 前端 | `npm run type-check` | **440 条 / 127 文件，新增 0** |
| 前端 | `npx eslint <触及文件>` | 0 问题 |
| 求解器 | `cd 'D:\work\plant-code\old\vendor\plant-mbd'; cargo test --workspace` | **113 + 5 + 1 全绿**（`angle` 模块 +21 条单测） |
| 求解器 | `cargo fmt --check` | 通过 |
| 求解器 | `cargo run -p plant-mbd-cli -- golden diff` | **6 份全 match**（2026-10-29 重录后） |
| 求解器 | `cargo run -p plant-mbd-cli -- layout --fixture fixtures/p3-installation-angles.json --verbose` | 10 case 全过，`issues=[]` |
| e2e（触及尺寸时） | `npx playwright test --config=playwright.novideo.config.ts` | 尺寸 smoke 2/2 |

### 13.7 环境坑（本轮新增）

- **`vendor/plant-mbd` 是独立 git 仓库**（HEAD `0b89b76`）。`cargo fmt --check` 与 `cargo test --workspace` 是本仓提交前的硬门禁；`angle.rs` 首版未过 fmt，Lead 已 `cargo fmt` 收敛后提交。
- **Devin 的 `edit_check` profile 无法写 `owned_paths` 之外的文件**，`request_scope` 授权也绕不过 assignment ACL。加 `PPoint.bore` 需要同时改 `tag.rs` / `isodim.rs` 的 10 处 `PPoint` 字面量——必须在 `owned_paths` 里显式列出这两个文件（并限定「只补 `bore: None`」），否则 worker 会退化成「字段加不上、闸门永久关闭」。
- **`golden_regression` 失败是设计好的闸门**，不是回归。任何改产出的 feature 都会让 6 份金样全红；正确流程是 `golden diff` 逐条审阅 → 备份 → `golden record --force` 逐份重录（**必须显式传原 `--note`**，否则 note 会丢）→ 再跑 `cargo test --workspace` 与 `golden diff`。
- **PML 源是 GBK/936**，`Read` 工具读不出中文；已转码到 `tmp/pml/`（`isobran` 6442 行、`isoline` 4941 行、`isombdangle` 110 行）与 `tmp/plantui-pml/`（13 个文件，含 `polarsystem.pmlobj` 3177 行）。转码方法：
  ```powershell
  $enc=[System.Text.Encoding]::GetEncoding(936)
  $lines=[System.IO.File]::ReadAllLines($src,$enc)
  [System.IO.File]::WriteAllLines($dst,$lines,(New-Object System.Text.UTF8Encoding($false)))
  ```
- **Devin 的 `read` profile 会拦外部路径**（`READ_OUT_OF_SCOPE`），即使 `scope` 里显式授权。必须把事实源副本放进 worker 的 cwd 或其子目录，或接受 `blocked` 状态下取 `devin_report` 的完整答案（报告本身不丢）。
- **`devin_run` 的参数必须逐个传，不能拼进 `task` 字符串**——否则整段 XML 式参数会变成 `assignment_id` 的一部分（实测）。
- **Devin 单 checkout 只能跑一个 job**（`WORKSPACE_BUSY`），跨仓任务必须串行。
- **Devin 会改变文件行尾符**：`vendor/plant-mbd` 全仓是 LF（`core.autocrlf=false`、无 `.gitattributes`），worker 用某些编辑路径会把文件写成 CRLF，导致 `git diff` 出现「−N +N 全文替换」的假差异。判定方法：`git diff --ignore-cr-at-eol --stat` 为空即纯行尾差异，直接 `git checkout -- <file>` 恢复。

### 13.8 T5.1 落地记录（2026-10-29）

**提交**：`plant-mbd` `0b89b76` — 15 文件，+1708 / −19。

| 文件 | 变更 |
| --- | --- |
| `crates/plant-mbd/src/angle.rs` | **新增 1019 行**：`InstallationAngle` 结构、`collect_installation_angles`（成员循环 + ATTA 近似循环）、`mem_p3dir_angle`（tilt / rotation 两路径 + `dissatisfy` 跳过）、`build_angle`（`anglepos` 三分支）、`dir_text`（六轴 + 两轴分解）、`goodori`（位置修正）、`installation_angle_primitives`（1 `AngleDim` + 2 `AidText`）、`assign_isoline`；21 条单测 |
| `crates/plant-mbd/src/data_source.rs` | `PPoint.bore: Option<f64>`（+4 行） |
| `crates/plant-mbd/src/layout.rs` | `assemble_isodim` 里收集 + 归段（`:172-189`）、逐段发图元（`:239-251`）、`meta.notes` 追加 `installation_angles=N`（`:265-270`）、`horizontal_tilt` 改 `pub(crate)` |
| `crates/plant-mbd/src/lib.rs` | `pub mod angle` + 4 个 re-export + 里程碑注释 |
| `crates/plant-mbd/src/contract.rs` | 5 行注释（serde 形状零变化，`contract_guard` 5/5 证明） |
| `crates/plant-mbd/src/tag.rs` / `isodim.rs` | 各 7 / 3 处 `PPoint` 字面量补 `bore: None`（唯一改动） |
| `fixtures/p3-installation-angles.json` | 新增 10 个 toy case（167 行） |
| `fixtures/golden/*.json` | 6 份重录 |

**六份金样差异（逐条审阅后重录）**：

| 金样 | `installation_angles` | primitives | 差异 |
| --- | --- | --- | --- |
| `24381_145018` | 0 | 不变 | 仅 notes |
| `24383_100028` | 0 | 不变 | 仅 notes |
| `24383_76191` | 0 | 不变 | 仅 notes |
| `24384_26229` | 0 | 不变 | 仅 notes |
| `24383_91813` | **5** | 5 → 20 | +5 `angle_dim`（均 44.5° tilt）+10 `aid_text`（`-X` / `-X 44.5° Y`） |
| `24383_99996` | **1** | 58 → 61 | +1 `angle_dim`（78° tilt，FTUB `24383_100027`）+2 `aid_text`（`-X` / `Y 12° -X`） |

**关键判断**：`24383_91813` 的 5 条角度不是误报——该 BRAN 是 5 段共线 FTUB，每段都带一个离轴 P3（`dir=(-0.713, 0.701, 0)`，作参考方向用）。PML `isobran.pmlobj:100` 的成员表注释明写「branch member, 包括tubi」，`getinstallationangles` 的 `do !mem values !this.branmems` 循环必然包含它们。原计划 §13.3 表格里「`24383_91813` 5 个可能产出」的预估命中，与实测一致。

**未落地（本轮范围外）**：`gen-model/src/mbd/branch_query.rs:663-667` 的 `catalogue_ppoints` 仍未给 `PPoint` 填 `bore`，所以 live 路径下 on-axis P3 一律按「bore unset」跳过（安全侧：少产出，不误产出）。这是 T5.2 的剩余部分。

### 13.9 前端 `angle_dim` 渲染链路核实（2026-10-29）

**判定：能画。** 弧、2 条腿、主文字、2 条方向小字四部分全链路已实现，无 TODO、无抛错分支、无 stub。

**全链路（无断点）**：

```
parseMbdV2PipeData (mbdV2Contract.ts:433)
 → mbdV2ToExternalRecords (mbdV2ExternalAnnotations.ts:755)
 → case 'angle_dim' → mapAngleDim (680)          // 弧 + 腿 + 主文字
 → case 'aid_text'  → explicitRecord (816-829)   // 2 条小字
 → useMbdExternalSync 原子校验 (167-180) → replaceExternalSource (193)
 → normalizeExternalDimension (normalizeExternalDimensions.ts:64)
 → layoutViewport (dimensionViewport.ts:541)
 → layoutDimension → layoutExplicit (layoutDimension.ts:74)
 → sampleArcToDesignAndScreenPath (explicit.ts:342)
 → scenePainter.paint (dimensionViewport.ts:556)
```

**契约层完全对齐**：`MbdV2AngleDim`（`mbdV2Contract.ts:109-116`）12 个字段与 Rust `contract.rs:131-144` 逐一对应，无缺失、无可选性差异。

**弧的生成方式**：不是在 3D 里采样现成折线，而是按 `x_axis`/`normal`/`radius` **解析构造 3D 弧**再自适应投影采样：
- 换基 + 起始角重定基到内核基底：`mbdV2ExternalAnnotations.ts:616-653`
- 自适应细分（投影中点偏离 > 0.25 px 就二分，深度 ≤ 5、点数 ≤ 257）：`arcProjection.ts:38-139`
- 闭合判定：无显式角或 `|sweep| ≈ 2π`（`arcProjection.ts:52-53`）

**三处保真偏差（按严重度）**：

| # | 偏差 | 根因 | 修复路径 |
| --- | --- | --- | --- |
| D1 | **方向小字字高被放大 2 倍**（后端 `angle.rs:495` 是 `cheight/2`，前端按主字高画） | 契约 `AidText { id, text, position }`（`contract.rs:187-191`）没有字高字段；`mbdV2ExternalAnnotations.ts:911-916` 给每条 record 统一挂 `textHeightM` | **需契约扩展 `AidText.text_height_mm`**（阶段 4 / T4.x）。前端按 id 含 `:angle:dirtext` 打折是硬编码，不做 |
| D2 | 主文字与弧、与两条小字**互不避让** | `explicit.ts:159-160` 的 `labelClearance` 只在有 `part === 'dimension'` 的**直线**时生效，弧是 `path` 不是 line；`declutterPolicy.ts:107-108` 要求 `layout.derived.declutter`（只有 `dimension3d.ts:301` 产生）；`resolveLabelCollisions.ts:329-332` 对 pinned 只登记占位不移动 | 后端已按 PML 摆位（`angle.rs:472-477` / `:510-521`），正常不撞；密集角度会撞。修复需给 explicit 弧加按角区间的文字避让（T3.5 的屏幕校验层可复用） |
| D3 | **无最小弧半径钳制**，相机拉近时弧退化成几像素 | `theme.ts:272 minArcRadiusPx: 15` / `:275 arcChordMaxStepDeg` / `:276 angularRayOvershootPx` 只被 `angular.ts` 使用，`explicit.ts` / `arcProjection.ts` 完全没读 | 在 `mappedArc:636-637` 之后按 `worldPerPixelAt(center)` 抬到 15 px |

**两处视觉缺口（记录，不算 bug）**：弧与腿同色同线宽（`scenePainter.ts:489-500` 都取 `dimensionStrokeWidthPx` 与 `colors.external`，PML 原图也是同色）；角度弧无箭头（`mapAngleDim:692-698` 不设 `arrows`/`arrowLines`）。

**测试覆盖缺口**：无 `angle_dim` 的 golden 快照（`goldens.test.ts:161-197` 只有全圆与 90° 弧）；无「主文字 + 2 条 `aid_text` 同屏」联合断言；无小半径弧退化测试。

**两处过期注释待修**：`DimensionPanelDock.vue:48`（称 `angle_dim`「有契约无产出」）、`mbdV2Contract.ts:6-8`（同类表述）——后端 `angle.rs` 已落地，两处均需改为「`aid_arc` / `aid_circle` / `aid_point` 无 live 产出方」。

### 13.10 由 §13.9 新增的任务（T7.1–T7.5，前端 + 求解器）

> **编号更正（2026-10-29）**：本表原用 T4.1–T4.5，与 §7 阶段 4 的契约扩展任务（meta.coverage / cheight_mm / ori / object_refno / source_version / isoline 列表）撞号，导致后者从状态表里消失。现改为 **T7.1–T7.5**；本节下文正文里的「T4.x」均指本表的 T7.x，§7 的原 T4.1–T4.6 仍指契约扩展（状态见 §12.4）。

| ID | 内容 | owned_paths | 依赖 | 优先级 |
| --- | --- | --- | --- | --- |
| **T7.1**（原 T4.1） | 契约扩展 `AidText.text_height_mm?: number`（前端先接受可选字段 → `plant-mbd` 契约 mirror → `angle.rs` 开始下发 `cheight/2`） | `src/dimension/adapters/mbdV2Contract.ts` + `.test.ts`、`src/dimension/adapters/mbdV2ExternalAnnotations.ts` + `.test.ts` | 无 | **✅ 已提交 `1a40b46a`** |
| **T7.2**（原 T4.2） | `plant-mbd` 侧 mirror `AidText.text_height_mm` + `angle.rs` 填 `Some(cheight/2)` + 重录金样 | `contract.rs`、`angle.rs`、`slope.rs`（编译修复）、`contract_guard.rs`、`fixtures/golden/` | T4.1 落地 | **✅ 已提交 `63d566e`** |
| **T7.3**（原 T4.3） | explicit 弧的最小像素半径（复用 `theme.minArcRadiusPx`） | **`src/dimension/kernel/layout/explicit.ts` + `.test.ts`**（见下方落点更正） | 无 | **✅ 已提交 `483713ee`（实现 + angle_dim golden）/ `68f36d5e`（3 条用例）**，解 D3；561 → 564 |
| **T7.4**（原 T4.4） | 修两处过期注释 | `src/dimension/ui/DimensionPanelDock.vue`（`mbdV2Contract.ts` 经核实无需改） | 无 | **✅ 完成** |
| **T7.5**（原 T4.5） | 补 `angle_dim` golden 快照（含主文字 + 2 条 `aid_text`） | `src/dimension/kernel/goldens.test.ts` | ✅ T4.1/T4.2 已落地 | **✅ 完成** |

**T4.3 落点更正（侦察结论，2026-10-29）**：原计划写的 `mbdV2ExternalAnnotations.ts` 的 `mappedArc` 是错的，三个候选逐条排除：

| 候选 | 判定 | 理由 |
| --- | --- | --- |
| `adapters/mbdV2ExternalAnnotations.ts` 的 `mappedArc`（`:616-681`） | **不可行** | 只有 `FrameTransform`，既无 `projector`（拿不到 `worldPerPixelAt`）也无 `theme`；其输出 `ExternalDimensionRecord.layout.arcs[].radiusM` 被 `mbdV2ExternalAnnotations.test.ts:272-289` 直接断言为 Design Space 半径，在此缩放会让契约→Design Space 的映射结果变成视图相关量 |
| `kernel/geometry/arcProjection.ts` 的 `sampleArcToDesignAndScreenPath` | **不可行** | 纯几何、签名无 theme；被 `arcProjection.test.ts:10-80` 直接单测，加下限等于改公共接口，且它是全部弧消费者的唯一采样入口 |
| **`kernel/layout/explicit.ts:341-351` 的 `scenePaths`** | **✅ 落点** | 唯一同时持有 `ExplicitArcInput` 与 `LayoutContext`（`projector` + `theme`）的地方；`EPSILON` 已在 `:19` 导入 |

**T4.3 判定条件**：只有 `arc.part === 'dimension'`（`mapAngleDim` 的角弧，求解器 `radius = aod × 0.7`）吃下限；`part: 'arc'`（`mapAidArc` / `mapAidCircle`，标模型真实圆/弧）与 `part` 未声明的旧输入（goldens、`explicit.test.ts` 现有用例、`debug/dimensionKernelDemo.ts`）保持 1:1。因此**现有全部快照与测试不变**——现有最小弧半径是 0.25 m = 25 px，高于 15 px 下限，无法守护新行为，必须新增用例。

**必须在采样之前缩放**：`sampleArcToDesignAndScreenPath` 的自适应细分按弦误差 0.25 px 决定点数（`arcProjection.ts:100-120`）；先放大 `radiusM` 再采样才是「真正 15 px 的弧」的合法细分，对已退化的 2 点折线做屏幕放大只会得到一条变长的直线段。

**T4.3 已知副作用（不修，记录）**：`angle.rs:452-456` 的腿端点是 `anglepos + dir·(radius + cheight/2)`，弧半径被抬到下限后弧沿径向外扩，腿的内端会落进弧内，出现小缝。最小改动（只缩放弧）不处理；要处理需在 mapper 里按同一比例外移腿端点，或把腿按弧半径比例重投影。`labelAnchor` 不受影响（吃契约的 `label_anchor`，`mbdV2ExternalAnnotations.ts:693`），`labelAlong` 只与角度有关。

**T4.4 落地结果**：`DimensionPanelDock.vue:47-49` 改为「11 种里的 8 种」+「`aid_arc` / `aid_circle` / `aid_point` 仍无 live 产出方；`angle_dim` 自 2026-10-29 起已由 `plant-mbd` 的 `angle.rs` 产出」。`mbdV2Contract.ts:6-8` 原文只陈述「几何自 2026-09-07 起齐备」（`every kind now has explicit geometry`），全文无「`angle_dim` 无产出」表述，**按约束不改**。ESLint 0 问题；`mbdV2Contract.test.ts` 10 + `DimensionPanelDock.test.ts` 8 = 18 通过。

**T4.5 落地结果**：`goldens.test.ts` 末尾新增 `describe('explicit angle dimension structural goldens')`，2 个 it：

1. `angle-dim` —— 结构快照。覆盖 3 条 screen line（2 条 `extension` 腿 + 1 条被 label 打断的 `dimension` 段）、1 条 `scene-path`（part `dimension`，`closed: false`）、3 条 glyph-run（`44.5°` 主文字 + `-X` + `-X 44.5° Y`）、hitRegions、labelBounds。快照新增 393 行、**0 删除**（既有 key 无改动）。
2. `angle-dim-per-record-text-height` —— 逐条 `textHeightM` 生效。**最终选值 0.12 / 0.15，不是最初设想的 0.004 / 0.008**：`createTestProjector()` 默认 `pixelsPerMetre = 100`，`worldPerPixelAt()` 恒返 `1/100`，0.004 / 0.008 投成 0.4 / 0.8 px，双双被 `theme.sourceTextHeightMinPx: 11` 钳到同一档，断言无法区分。0.12 / 0.15 投成 12 / 15 px，严格落在 `11..18` 内部，保持投影比例 1.25。字号落点字段是 `ScreenGlyphRun.capHeightPx`（`types.ts:167`），不是 `sizePx` / `fontSizePx`。

**维度全量回归：559 → 561 通过**（74 文件）。连跑两次确认无 flake。ESLint 0 问题。

**T4.5 记录的两处数据模型边界（未改类型）**：① `ExplicitTextInput`（`types.ts:485-499`）无逐条 `textHeightM`，`explicit.ts:360-378` 里主文字与 `texts` 共用同一 `textHeightPx`——真实求解器把方向小字拆成独立 record 下发（各自带 `textHeightM`），这是数据模型边界不是 bug；② `labelClearance`（`explicit.ts:152-177`）只在 `lines` 里存在 `part: 'dimension'` 时生效，角度标注的弧是 `arcs`、腿是 `extension`，所以弧不会被主文字打断——当前行为符合预期（弧本来就绕过文字）。

**契约改动顺序铁律（ADR 0055 D7）**：前端先接受可选字段 → `plant-mbd` 契约 mirror → producer 开始产出。反了会被 ADR 0046 的 fail-closed 整包拒收。**T4.1 必须先于 T4.2。**（本轮已按此顺序执行。）

**T4.1 / T4.2 落地结果**：

| 仓 | 提交 | 内容 |
| --- | --- | --- |
| 前端 | `1a40b46a` | `MbdV2AidText.text_height_mm?: number` + `isOptionalPositiveNumber` 校验；`sourceLengthToDesignM` / `textHeightToDesignM` 抽出（`groupTextHeightM` 改为调用，纯重构）；`aid_text` 分支算逐条字高；循环末尾统一覆盖改为「已有 `textHeightM` 就不覆盖」。测试 +3（74 文件 / 559 通过） |
| 求解器 | `63d566e` | `AidText.text_height_mm: Option<f32>`（`serde default` + `skip_serializing_if`）；`angle.rs` 两条方向小字填 `Some(small_cheight as f32)`；`slope.rs` 坡度腿长小字填 `None`（编译修复）；`contract_guard.rs` 穷举字面量补字段。金样重录 2 份（`24383_91813` +10 处 `4.0`、`24383_99996` +2 处 `4.0`，逐行确认只有该字段） |

**D1（方向小字 2 倍偏差）已闭合。**

### 13.11 T3.3a 落地记录（2026-10-29）

**提交**：前端 `5c7ee980` — `src/dimension/kernel/layout/polar/reference/types.ts`，124 行，纯类型。

| 导出 | 对应 PML | 说明 |
| --- | --- | --- |
| `PolarCoords { dis, angle, radius }` | `getpolarelement.getOnePointData`（`getpolarelement.pmlobj:206-221`） | 字段顺序照 PML `[dis, angle, radius]` |
| `PolarPlane { zero, normal }` | `polarsystem.pmlobj:289` 的 `ori = x is showdir and z is dir` | `zero` = 角度零点（`showdir`）、`normal` = 绕向轴（管轴） |
| `PolarReference` | `polarsystem.pmlobj:70-110` 成员子集 + `:136-149` 落值 | `origin` / `axis` / `plane` / `showDir` / `mainDimDir` / `disRange` / `basicRadius` / `isInstPipe` / `kind` |
| `PolarElement` | `polarelement.pmlobj:11-25` + `getpolarelement.pmlobj:174-204` | 三个闭区间 + `basic`；PML 的 `arc` / `line` 是构造缓存，可由 `PolarReference` 重建，不入类型 |

**关键设计**：`showDir` 与 `plane` 是**值**不是常量，整个类型 `Readonly`。这样 2D 轴测（`showDir` 一次算定）与 3D 相机（每帧重算 + 滞回）共用同一份契约，实现方每帧构造新实例。`kind: 'iso-sheet' | 'camera'` 只供诊断与 A/B 开关，不参与计算。

**明确不做**：不导出 `horidir`（PML 的独立自由度，无法从 `showDir` 反推——`showdir = arc(horidir, axis).angledirection(lookangle)`，不同 `lookangle` 给不同 `showDir` 而 `horidir` 不变）。`getresult` 的 `chardir`（`polarsystem.pmlobj:2513` 的 `textori = y is chardir and x is xdir`）由 `getresult` 现场算，不进平面。若 T3.4 发现需要 `horidir`，需要回改本契约——**这是已知的潜在缺口**。

**验证**：`npx eslint` 0 问题；`npx tsc --noEmit` 单文件 0 错误；维度全量回归 564 通过（新增文件无消费者，数字未变）。

### 13.12 T3.3b / T3.3c 派工要点（已落地 3f298e7c，记录见 §13.14）

**T3.3b `isoSheet.ts`**（`getDetail:151-292` 逐值等价）：

- 构造参数 `IsoSheetParams` 承载 PML 的 `pos` / `dir` / `limitMinDis` / `limitMaxDis` / `basicRadius` / `isinstpipe` / `lookangle` / `referencedirs` / `prehoridir` / `branlookdirection` / `fromltor` / `cenpos` / `midpos`——`PolarReference` 只有输出，没有这些构造输入，**这是契约缺口**，所以单独出一个参数结构。
- 三段必须逐值照抄：`referencedirs` 命中（`abs(angle - 90) < 60`）、`prehoridir` 的 45°/135° 滞后（**注意 `golabel /sethoridirok` 只在 `angle < 45 || angle > 135` 时触发，45..135 之间会落到 `branlookdirection` 分支**）、`lookangle → showdir`（`:258-284`）。
- `:201-223` 是 `--$(` 注释块内的死代码，整段跳过。
- `arc.angledirection(θ)` 的语义是**切线方向**（不是半径方向），符号 `-x·sinθ + y·cosθ`（CCW 关于 z），需用仓内 `arcProjection.ts` 与 `mbdV2ExternalAnnotations.ts:694-701` 的 `arcTangent` 交叉验证手性。
- `mainDimDir` 一律 `null`（PML `:292` 的 `getMainDimDir()` 是注释掉的）。
- `orthogonal` 返 null 时的兜底是本任务唯一自由裁量点，必须显式记录。

**T3.3c `camera.ts`**（`showDir` 从相机派生 + 滞回）：

- `cameraShowDir(projector, axis)`：`forward` 投影到垂直 `axis` 的平面；相机沿轴看时返 `null`，调用方保留上一帧。
- `hysteresisShowDir(previous, candidate, enterDeg = 1, exitDeg = 3)`：`< enterDeg` 采纳候选、`>= exitDeg` 切换、带内保持；`candidate === null` 保持 `previous`；`previous === null` 直接采纳候选。
- **反平行必须显式处理**：相机绕过管轴背面时夹角从 179° 跳回 0°，会导致 `showDir` 突然翻转。裁决是「夹角 > 179° 也走 `exitDeg` 分支返回 candidate」，连续性交给 T3.5 的背向候选加罚——**不在这一层做插值或符号修正**，否则会掩盖真实相机运动。
- 退化兜底：`orthogonal(axis, [0,0,1]) ?? orthogonal(axis, [0,1,0]) ?? [1,0,0]`（世界上方 → 北向 → 东向）。
- `enterDeg > exitDeg` 或任一非有限时抛 `RangeError`。
- 返回值必须满足 `dot(plane.zero, plane.normal) ≈ 0`、`|plane.zero| ≈ 1`，且**绝不改写传入的 `previous`**。

**两处共同约束**：`kind` 分别填 `'iso-sheet'` / `'camera'`；`mainDimDir` 填 `null`；不新建 barrel（留给 T3.4）；不碰对方的文件（两个 worker 在同一目录并行，`isoSheet.*` 与 `camera.*` 互不重叠）。

### 13.13 T3.5 落点预判（待 T3.4 接口裁决）

T3.5 不需要新造碰撞算法，两块现成件可直接复用：

| 现成件 | 位置 | 用途 |
| --- | --- | --- |
| `LabelOccupancy` | `collision/resolveLabelCollisions.ts:64-131` | 64 px 网格占用；含 viewport 裁剪（`:79-88`）防「投影到 1e5–1e9 px 的 sliver 把网格撑爆」——`all-pipes sweep 2026-09-14` 实测过 `RangeError: Map maximum size exceeded` |
| `convexQuadsOverlap` | `layout/declutterPolicy.ts:72-85` | 凸四边形分离轴判定；配合 `quadBracketsLabel`（`:53-58`，面积比 0.05..1.2 才可信；T7.6 引入，见 §13.15）处理近相机平面的退化四边形 |

**关键依赖**：T3.4 的 `place()` **必须返回排序候选列表**，不能只返回单个最优。理由是 T3.5 要在像素域否决候选并降级——若只给一个最优，一旦它重叠就只能整体放弃。PML 本来就有这份数据：`:1261` 的提前退出分支因 `ifAcceptableToQuit = false`（`:1163`）恒假，每个轴向单元的最优都进了 `alldisbests`，`:1273-1281` 已排序，只取 `[1]` 是**丢弃**而非「本来就没有」。

### 13.14 T3.3b / T3.3c 落地记录（2026-10-29，补记）

**提交**：前端 `3f298e7c` — 4 文件，+1049 行：`polar/reference/isoSheet.ts`（239 行）+ `isoSheet.test.ts`（218 行）、`polar/reference/camera.ts`（269 行）+ `camera.test.ts`（323 行）。

| 导出 | 位置 | 对应 §13.12 要点 |
| --- | --- | --- |
| `isoSheetReference(params: IsoSheetParams): PolarReference` | `isoSheet.ts:176` | 2D 轴测参考系；`IsoSheetParams` 承载 PML `getDetail` 的构造输入 |
| `cameraShowDir(projector, axis)` | `camera.ts:112` | 相机 forward 投到垂直管轴的平面；沿轴看返回 `null` |
| `hysteresisShowDir(previous, candidate, enterDeg, exitDeg)` | `camera.ts:176` | `DEFAULT_ENTER_DEG = 1` / `DEFAULT_EXIT_DEG = 3` 滞回 |
| `cameraReference(input)` | `camera.ts:244` | 3D 相机参考系，`kind: 'camera'` |

**补记的边界**：本记录是 2026-10-29 对齐时补的，只核对了导出、行号与提交规模，**未逐条复核** §13.12 的要点（`orthogonal` 返 null 的兕底取法、反平行分支、`mainDimDir` 恒 `null`）；提交时**没有留下门禁数字**。两项都列入现行计划 W0 的核对清单。`kernel/index.ts` 未导出，与 §13.12「不新建 barrel，留给 T3.4」一致。

### 13.15 T7.6 LOD 分层阈值拆分 + 退化四边形去重叠回退（计划外批次，2026-10-29 登记）

**来源**：工作区里一批未登记在任何计划的内核改动（12 个源码 / 测试文件，+302 / −137 行），2026-10-29 审核时发现，裁决为「保留，登记为正式任务并单独提交」。**提交：`12f4bb1e`**。

| 文件 | 内容 |
| --- | --- |
| `kernel/theme.ts` | `DimensionTheme` 新增 `lodSecondaryMinPx` / `lodDetailMinPx`；`SOLVESPACE_DIMENSION_THEME` 取 **0 / 18**。依据（源码注释）：现网 MBD 组字高 2 mm vs 27 mm，投影后 0.12 px vs 1.5 px，原先按同一投影高度门槛会把 secondary 整层藏掉 |
| `kernel/layout/shared/lod.ts` | `lodSecondaryFar` → `projectedPx < theme.lodSecondaryMinPx`；`lodDetailFar` → `projectedPx < theme.lodDetailMinPx`。secondary 阈值取 0 即**次级层不再因投影高度被隐藏** |
| `kernel/layout/tagBillboard.ts:236` | `closeUp` 改用 `theme.lodDetailMinPx` |
| `kernel/layout/declutterPolicy.ts` | 新增 `quadArea` / `quadBracketsLabel`（四边形面积与 AABB 面积比在 0.05..1.2 内才可信）；`declutterOverlaps` 在任一四边形退化时回退到 AABB 判重。依据（源码注释）：近相机平面的投影四边形退化，屏上残留 79 个重叠标签，面积比最高 1.3e5 |
| `kernel/geometry/sceneGeometry.ts`、`kernel/types.ts` | 注释（`projectTextFrameQuad` 退化情形说明） |
| 6 个测试文件 | `declutterPolicy.test.ts`（+37）、`explicit.test.ts`（213 行改动）、`lod.test.ts`、`dimension3d.test.ts`、`tagBillboard.test.ts`、`theme.test.ts` |

**决策记录**：

- 这是**渲染行为变更**（LOD 可见性 + 去重叠胜负），与健壮性计划 §7「不改渲染外观」相抵；按 2026-10-29 裁决以独立任务 T7.6 入库，不并入健壮性计划。
- 阈值 0 / 18 与 0.05..1.2 的取值来自源码注释里的现场数据，**没有** A/B 截图或量化记录。现行计划 W0 要求补一组固定相机前后对比截图，并确认 `theme.test.ts` 里的钉子覆盖这两个新字段。
- 门禁数字：入库时未跑（按会话约定由用户本机执行），**待补**到 §14。

---

## 14. 门禁基线总表（两份计划共用，只增不减）

> 本表是尺寸链 vitest 回归数字的唯一权威记录；§5.2 / §12.2 / §12.5 / §12.7 / §13.6 / §13.10 / §13.11 与健壮性计划 §2 / §9 里的数字都是它的历史切片。**各行的命令范围不同，数字不能跨范围直接比较**——这正是之前「两套计数各记各的」的根源。新批次在此追加一行，不再在各自小节另记。范围缩写：**S0** = `src/dimension src/composables/useMbdExternalSync.test.ts`；**S1** = S0 + `src/api/mbdV2Api.test.ts`；**S2** = S1 + `src/utils/refnoKey.test.ts`（§13.6 口径）。

| 顺序 | 时点 / 批次 | 范围 | 文件 / 通过 | 记录位置 | 对应提交 |
| --- | --- | --- | --- | --- | --- |
| 1 | 2026-10-28 审计基线 | S0 | 58 / 362 | §5.2 | — |
| 2 | 2026-10-28 第一批（T0.2 / T1.1 / T2.2 / T1.7）+ B4 layoutAuthority | S0 | 60 / 379 | §12.2、§12.5 | — |
| 3 | 2026-10-28 晚 累计（T1.x / T2.3 / T3.1 / T3.2） | S0 | 70 / 471 | §12.7；健壮性 §2 | — |
| 4 | 健壮性第一轮 B1 + B4 + C3 + D3（+ C1 / C2） | S1 | 71 / 487 | 健壮性 §9 | 6cb0588d |
| 5 | 健壮性第二轮 B2 + B3 | S1 | 73 / 548 | 健壮性 §9 | b29f7031 |
| 6 | T7.1 text_height_mm | S2 | 74 / 559 | §13.10 | 1a40b46a |
| 7 | T7.5 angle_dim golden | S2 | 74 / 561 | §13.6、§13.10 | 483713ee |
| 8 | T7.3 角弧下限 3 条用例 + T3.3a（纯类型，+0） | S2 | 564 通过 | §13.11 | 68f36d5e、5c7ee980 |
| 9 | 健壮性第三轮 A2–A5 | S1 | 75 / 601 | 健壮性 §9 | 5b1bdfd0（前有 ff3836af E2、47de00ac D2、f73adf91 A1 fixture） |
| 10 | T3.3b / T3.3c | — | **未记** | §13.14 | 3f298e7c |
| 11 | E1 两份适配器测试入库 | — | **未记** | 健壮性 §9 第四轮 | f76729df |
| 12 | T7.6 LOD / 去重叠 | — | **未记（待用户本机跑后补）** | §13.15 | 12f4bb1e |
| 13 | **当前 HEAD 的真实数字** | S2 | **待跑** | 现行计划 W0 | — |

**类型基线**：`npm run type-check` 自 §5.2 起始终是 **440 条 / 127 文件，新增 0 / 已消失 0**，最后一次实测在第 9 行（5b1bdfd0）；第 10–12 行之后未再实测。
