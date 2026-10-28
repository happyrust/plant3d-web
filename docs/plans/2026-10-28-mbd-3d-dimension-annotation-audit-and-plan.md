# MBD 三维尺寸标注：实现审核与重构开发计划

- 日期：2026-10-28
- 性质：实现审核 + 差距分析 + 完整开发计划（本轮无代码变更）
- 参照基准：`D:\work\plant-code\old\vendor\MBD`（PML/E3D，需求事实源）· `vendor/plant-mbd`（Rust 求解器 + 冻结契约）· `gen-model`（宿主路由）
- 被审对象：`src/dimension/**`、`src/api/mbdV2Api.ts`、`src/composables/useMbdExternalSync.ts`、`src/composables/useMbdDiagnosticsStore.ts`

## 0. 本轮的方法与限制（先声明，避免误读结论强度）

| 项 | 状态 |
| --- | --- |
| 侦察方式 | 5 个并行子代理：内核布局层 / vendor PML 算法 / 后端契约链路 / PML 朝向与避让 / 门禁与未完成项；全部只读，未改任何文件 |
| CT 主脑复核 | **未完成**。4 个 CT 窗口（`bc-5716c2fd…` / `bc-cbe95b28…` / `bc-1d0a7c54…` / `bc-247197f3…`）以 `claude-fable-5-1-thinking-max` 派单，全部返回 `model_usage_exhausted`（配额耗尽），无输出 |
| `plannatator` | **本环境不存在**。`where.exe plannatator`、`~/.factory/skills`、`~/.factory/tools`、MCP 工具清单、`D:\work` 全盘均无。计划改用本文件的人工编排格式，结构与 plannatator 的「阶段 → 任务 → 验收」一致 |
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
| T2.1 / C3 `layoutAuthority` | **已落地**，见 §12.6 |
| T1.1–T1.7 | **已落地**，见 §12.7 |
| T2.3 / C6 `aid_line.style` | **已落地**，见 §12.7 |
| T3.1 / T3.2 polar 纯数值层 | **已落地**，见 §12.7 |
| T3.3–T3.6 / T4 / T5 / T6 | 未开始 |

### 12.6 B4：`layoutAuthority`（T2.1 / C3，已落地）

**修法与计划原稿的偏差**：原稿写「`layoutViewport` 按 authority 分工」，实际 **kernel 一行未改**——`solver` 的语义就是现有的 `labelPinned: true`（`resolveLabelCollisions.ts:324-331`：pinned 只 `occupancy.insert` 占位、不进 `automatic` 候选，因此不移动、不补引线）。所以字段只在记录层显式化，由唯一归一入口折算成布尔送进内核，`goldens.test.ts.snap` 不变。

| 文件 | 内容 |
| --- | --- |
| `src/dimension/adapters/normalizeExternalDimensions.ts` | 新增 `ExternalLayoutAuthority = 'solver' \| 'screen'`；`ExternalDimensionRecord` 增可选 `layoutAuthority?`（缺省由 `layout.labelPinned` 推导）；新增 `externalLayoutAuthority(record)`；`normalizeExternalDimension` 在 `...record.layout / id / role` 之后追加 `labelPinned: externalLayoutAuthority(record) === 'solver'`（显式字段压过布尔） |
| `src/dimension/adapters/normalizeExternalDimensions.test.ts`（新） | 6 条：缺省推导两向、显式两向压过布尔、归一保留 record 的 id/role 且几何不动、`externalDimensionCategory` 缺省值 |
| `src/dimension/adapters/mbdV2ExternalAnnotations.ts` | `explicitRecord` 返回值增 `layoutAuthority: 'solver'`（`labelPinned: true` 保留）；parquet / PR6 措辞的注释改写为 authority 口径；「older parquet rows」→「older payload rows」 |
| `src/dimension/adapters/mbdV2ExternalAnnotations.test.ts` | 新增断言：MBD 记录全部 `layoutAuthority === 'solver'` 且归一后 `labelPinned` 全 true |

**向后兼容**：7 个既有生产者一行未改——缺省推导把 `bran-clearance` / `pipe-information` 等 `labelPinned: false` 折成 `screen`、MBD 的 `true` 折成 `solver`，归一结果与改前逐位相同。

**门禁**：`npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts` → **60 文件 / 379 通过**（+7）；`npm run type-check` 新增 0；`npx eslint`（4 个文件）0 问题。


### 12.5 本轮发现的范围外改动（需单独处置）

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
