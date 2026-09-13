# MBD 长度尺寸三维标注呈现 · 实机验证（2026-09-12）

对应：ADR 0057（长度尺寸）、ADR 0058（标签 billboard，见下「标签 billboard」段）、ADR 0059（标签避让管件包围盒、尺寸描边与视口覆盖层，见下同名段）、PRD `docs/plans/2026-09-12-mbd-annotation-reference-style-prd.md`、效果图 `docs/design/mbd-annotation-mockup-2026-09-12/`。

## 环境

- plant3d-web dev `http://127.0.0.1:3101`（Vite HMR），隔离 gen-model `http://127.0.0.1:18084`（embedded-mem，`AvevaMarineSample`）。
- 真实 Chrome（Playwright `channel: 'chrome'`），视口 1920×1080、DPR 2；BRAN `24381_145018`（18 条 `linear_dim`：11 main / 7 atta，`cheight_mm=27`）。
- URL（只看长度尺寸，不选中管体）：

  ```text
  /?output_project=AvevaMarineSample&show_refno=24381_145018&show_refno_select=0
    &mbd_refno=24381_145018&mbd_kinds=linear_dim
    &gm_backend=http://127.0.0.1:18084&mbdBackend=http://127.0.0.1:18084
  ```

- 固定相机 = 效果图同一套 fit（`maxDim × 1.7`，`position ≈ (8.33, −11.36, 6.81)`，target 原点）；近景 = 阀门端簇 fit ×2.8。

## 结果（`viewport.getLayouts()` 逐条统计）

| 视角 | 记录 | 绘制 | 隐藏（原因） | 三维文字 | 实心箭头 | 文字外置 | 投影字高 px | 管轴→尺寸线 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 远景 | 18 | 11 | 7（atta 远景 6 / 短段 1：`173`） | 11 / 11 | 22 | 758.89 / 1340.05 / 567.89 / 900.51 | 12.2–13.9 | row 0 ≈ 241–298 mm，row 1 ≈ 426–543 mm（管表面 114 mm，`h` 由 13 px 下限决定） |
| 近景（阀门端） | 18 | 12 | 6（atta 远景 6） | 12 / 12 | 24 | 173 | 12.4–15.7 | row 0 ≈ 176–232 mm，row 1 ≈ 267–384 mm |
| `mbd_3d=0` | 18 | — | — | 0（全部回到平面呈现） | 0 | — | — | 求解器原位（114.3 / 146.7 mm） |

- 两次同相机运行统计逐字相同（远景 / 近景各跑 3 次）。
- 无 `pageerror`；控制台仅有与尺寸无关的 3 条 gen-model 400。
- 单测：`npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts` → 53 文件 / 288 通过；eslint 0；`npm run type-check` 新增 0（当日基线外唯一新增 `src/measurement/kernel/pickDerivation.test.ts` 为他人未提交文件）；`e2e/dimension-mbd-v2-fixture.spec.ts` 2/2。

## 截图

| 文件 | 说明 |
| --- | --- |
| `3d-far.png` | 远景：尺寸线离开管体、尺寸界线超出、实心箭头、数字在三维平面里沿线排布（`2652` / `1902.35` 竖排向上可读） |
| `3d-near-valve.png` | 阀门端近景：字高随 cheight 放大，`173` 文字外置 |
| `3d-near-valve-cluster.png` | 近景局部放大：粗体黑字 + 白色光晕压在管体上仍可读，小数点可见 |
| `flat-far-mbd_3d=0.png` | 同相机 `mbd_3d=0`：求解器原位平面呈现（对照 / 回退） |

## 标签 billboard（PRD T3，同日补验；ADR 0058）

同一 URL 去掉 `mbd_kinds`（全类别 77 图元），脚本 `pw-tag-verify.mjs` + `tag-stats.js`（`%TEMP%\plant3d-mbd-debug`），同一套 fit 与阀门端 zoom。
14 条 `leader_line` 各配进自己的 `label` 记录（先按 `<label id>:leader` 命名、再按引线起点 = 标签位置配对），记录数 77 → 63。

| 视角 | 标签 | 绘制（卡片 / 方框 / 药丸） | 隐藏（原因） | 换位 | 标签↔标签 / 标签↔尺寸数字相压 | 细节辅助隐藏 | 尺寸（绘 / 隐） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 远景（fit ×1.7） | 14 | 4（3 / 1 / 0）：头端 `X 1516 / Y 8157 / PE 13293`、顶部 `X 9201 / Y 9147 / PE 18747`、尾端 `接 Copy-of-RCS0014-1R43013新 / X 9770 / Y 10220 / PE 18665`、位号 `Copy-of-1RCS002VP` | 10（弯头药丸 9 `secondary-far` / 分支名 1 `detail-far`） | 0 | 0 / 0 | 31（坡度 7 + skew 文字 3 + 辅助线 21） | 11 / 7（不变） |
| 阀门端中景（×2.8） | 14 | 4（3 / 1 / 0） | 10 | 1（`X 9201` 让开 `2640.89`，取第 3 个候选位） | 0 / 0 | 31 | 12 / 6 |
| 阀门端近景（×1.2） | 14 | 6（3 / 1 / 2）：药丸 `PE +18657`、`90° / PE +18665`（角度行在投影字高 ≥ 18 px 时才出现） | 8（7 `secondary-far` / 分支名 `detail-far`） | 2 | 0 / 0 | 25（`slope 0.4%` 等 6 条已显示） | 12 / 6（`402` 为 `overlap`） |

- 每个绘出的标签都带引线；填充多边形数 = 卡片体 + 卡片圆点 + 方框体（远景 7、近景 9）。
- 锚点在视口外的标签（中景 `X 1516`、近景 `PE +18657`）整体落在视口外，是预期行为（候选位先按「整块在屏内」排序，全都不在时保持首选位）。
- 远景 / 中景各重复 2 次统计逐字相同；无 `pageerror`。
- 单测 `npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts` → **54 文件 / 299 通过**（新增 `tagBillboard.test.ts` 7，mapper +3，painter +1，panel 文案 +1）；eslint 16 个相关文件 0；`npm run type-check` 基线外唯一新增仍是他人未提交的 `src/measurement/kernel/pickDerivation.test.ts`；`e2e/dimension-mbd-v2-fixture.spec.ts` 2/2。

| 文件 | 说明 |
| --- | --- |
| `tags-far.png` | 远景全类别：三张坐标卡片 + 位号方框，引线到管端并带圆点；弯头药丸、坡度 / skew 辅助按 LOD 隐去 |
| `tags-near-valve.png` | 阀门端中景：`X 9201` 卡片让开 `2640.89` 换到第 3 个候选位 |
| `tags-close-valve.png` | 阀门端近景：弯头药丸 `90° / PE +18665` 出现，`slope 0.4%` 等细节辅助显示 |

## 标签避让管件包围盒、尺寸描边与视口覆盖层（2026-09-13 补验；ADR 0059）

同一 URL（全类别），脚本 `pw-tag-obstacles.mjs` + `tag-probe.js`（`%TEMP%\plant3d-mbd-debug`）。相机：远景 = 场景盒 fit ×1.7；阀门簇 = 与位号标签目标点最近的构件（`o:24381_145035:21`）包围盒外扩 0.3 m 内的 2 个构件的并集盒，中景 fit ×2.8、近景 fit ×1.2。窗口 1920×1080 / DPR 2，三维画布 1210×800 CSS px。
探针用纯 JS 独立复现内核的屏幕几何（凸包 / 矩形裁剪 / 线段 slab），对 `viewport.getLayouts()` 里每个绘出的标签体量：与**可见构件投影凸包**的重叠面积、体内**尺寸描边**（其它布局的 line / path 段）长度、与尺寸数字 / 其它标签的相压；构件凸包取 `DTXLayer.getAllObjectsWithBounds()` 中可见对象的场景包围盒 8 角点投影。每个视角：同相机连跑 2 次 + 宿主帧循环自行重排一次，三者签名相同才算稳定；再把 `viewport.input.obstacles` 置空（只让开数字 / 标签 / 描边）对照一次并恢复。

| 视角 | 标签绘 / 隐 | 避让开：换位（候选位序号，10 个一圈） | 标签体 ∩ 构件凸包 px² | 体内描边 px | 标签↔数字 / 标签↔标签 | 避让关（对照）：∩ 构件凸包 px² |
| --- | --- | --- | --- | --- | --- | --- |
| 远景（×1.7） | 4 / 10 | `X 9201` → 10（第 2 圈）、位号 `Copy-of-1RCS002VP` → 18（第 2 圈，画布顶部中央 x 759–921，整块在屏内、不压 gizmo）、尾端 `接 …` → 4；`X 1516` 首选位 | 0 / 0 / 0 / 0 | 0 | 0 / 0 | `X 9201` 5344、位号 4407、`接 …` 2738（且压 gizmo 3133） |
| 阀门端中景（×2.8） | 4 / 10 | `X 9201` → 1、位号 → 23（第 3 圈，阀体右侧）、`接 …` → 20（第 3 圈，手轮上方） | 0 / 0 / 0 / 0 | 0 | 0 / 0 | 位号 5596、`接 …` 18481（压在阀杆上） |
| 阀门端近景（×1.2） | 6 / 8 | `PE +18657` → 10、`90°` → 9、位号 → 34（第 4 圈）、`接 …` → 25（第 3 圈，管段上方左下）；`X 1516` / `X 9201` 首选位 | 0 / 0 / 0 / 0 / 1392 / 6384（阀门凸包 5128 + 管段 `…:9` 1256） | 0 | 0 / 0 | `90°` 4459、位号 5596、`接 …` 20664、`PE +18657` 54 |

- 三视角 `identicalRuns` / `frameLoopAgrees` / 截图签名一致均为 true；无 `pageerror`；尺寸绘 / 隐与「标签 billboard」段相同。
- 中景是用户点名的场景：尾端卡片从阀杆上（18481 px²）换到手轮上方、位号从阀体上换到阀体右侧，两者与构件凸包重叠 0。近景阀门包围盒的投影凸包盖住画布右半，四圈里没有零侵入的位置，取加权侵入最小者：卡片与位号都离开了黄色阀体本体（截图），剩余重叠是透视下凸包大于本体的空白边缘；`90°` 药丸从压在管段 / 弯头上换到管外。
- 「不出屏」规则的实测依据：两圈候选位 + 无此规则时，远景位号方框为躲开阀门凸包取到第 18 号候选位，x 1102–1264 超出 1210 px 画布、右缘被裁；加规则后取第 17 号（x 1045–1207）整块在屏内，但落在右上角坐标 gizmo 底下。
- **视口覆盖层**（同日稍后）：宿主把 ViewportGizmo 的命中区 div（`.dtx-viewport-gizmo`，探针实测 `{x 1110, y 10, 100 × 100}`）按容器坐标交给内核当障碍矩形（权重同数字），远景位号方框从第 17 号换到第 18 号（画布顶部中央）、与 gizmo 重叠 0；避让全关的对照里尾端卡片的首选位压 gizmo 3133 px²。中景 / 近景三张图的标签体坐标与加覆盖层之前逐字相同（gizmo 附近本来没有候选位）。探针对每个标签体另量 `overlayPx2`（∩ `.dtx-viewport-gizmo` 矩形），三视角避让开时全 0。
- **全被挡住时的两种策略**（`theme.tag.blockedFallback`，探针用 `viewport.setTheme` 切换、同一页面同一相机）：只有阀门端近景有区别——A `least-intrusion`（默认）：尾端卡片取第 25 候选位（第 3 圈，管段上方左下，∩ 凸包 6384 px²）、位号取第 34（第 4 圈，回路内左侧，1392 px²，引线 ≈ 430 px）；B `first-ring`：尾端卡片留在首选位（第 0，压在阀杆上 20664 px²，引线 ≈ 120 px），位号因卡片让出而找到零侵入的第 35 候选位（第 4 圈，左下 `90°` 药丸旁，引线 ≈ 350 px）。远景 / 中景两种策略逐字相同。截图 `tags-obstacles-close-valve.png`（A）/ `tags-obstacles-close-valve-first-ring.png`（B）。默认值 2026-09-13 13:46 用户拍板**保持 A `least-intrusion`**（不压构件本体优先，接受引线变长），B 留作主题开关。
- 单测 `npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts` → **56 文件 / 318 通过**（`obstacleGeometry.test.ts` 新增、`tagBillboard.test.ts` 15：障碍 / 加权侵入 / 覆盖层 / 不出屏 / 外圈引出 / first-ring 回退、`layoutViewport` 障碍源透传、`dtxDimensionViewerAdapter.test.ts` 新增 2：覆盖层重定原点 / 包围盒角点经矩阵回设计空间、facade +1：`queryLayoutObstacles` 与 `getLayoutOverlays` 各被问一次）；eslint 相关 13 文件 0；`npm run type-check` 基线外新增 8 条全在他人在飞文件（`useDtxTools.*.test.ts`、`useXeokitMeasurementTools.ts`、`dtxDimensionSnapPort.ts`、`pickDerivation.test.ts`），本改动 0；`e2e/dimension-mbd-v2-fixture.spec.ts` 2/2。

| 文件 | 说明 |
| --- | --- |
| `tags-obstacles-far.png` | 远景：四个标签与构件凸包、描边、数字、坐标 gizmo 均无重叠；位号方框整块在屏内（画布顶部中央，让开了右上角的 gizmo） |
| `tags-obstacles-near-valve.png` | 阀门端中景：尾端卡片在手轮上方、位号在阀体右侧，都不再压阀体 |
| `tags-obstacles-near-valve-boxes-off.png` | 同相机、只让开数字 / 标签 / 描边的对照：尾端卡片压在阀杆上、位号压在阀体上（改动前的效果） |
| `tags-obstacles-close-valve.png` | 阀门端近景 · 策略 A `least-intrusion`（默认）：阀门凸包盖住右半画布，卡片与位号取加权侵入最小的位置，离开阀体本体（引线变长） |
| `tags-obstacles-close-valve-first-ring.png` | 同相机 · 策略 B `first-ring`：尾端卡片留在首选位（压在阀杆上、引线短），位号找到左下零侵入位 |
| `tags-obstacles-close-valve-boxes-off.png` | 同相机对照：卡片压在阀杆上、位号压在阀体上 |

## 已知未做

- 管件障碍是包围盒 8 角点的投影凸包，不是网格轮廓：透视近景里凸包明显大于本体，标签可能压在凸包的空白边缘，或在没有零侵入位置时以最少重叠压在本体上；引线不是障碍、可以穿过阀体。
- 分支名药丸（`detail` 级）在本样本三个视角都没到显示阈值。覆盖层只登记了坐标 gizmo；三维画布容器之外的浮层（工具条、面板）与标签不相压，不在其中。
- `surfaceM` 取本分支尺寸界线的下四分位（= 求解器最内行 `od`）；本样本 DTX 管体视半径略大于该值，尺寸界线起点略在管体轮廓内。
- ~~SVG 导出把三维文字近似为按投影字高 / 基线角旋转的平面字形（无透视缩短）；实心箭头在 SVG 中仍为三条描边（与用户尺寸一致）。~~ 2026-09-13 已补齐，见下「SVG 导出对齐视口」段。

## SVG 导出对齐视口（2026-09-13 补验）

`DimensionSystem.exportSvg()`（尺寸面板「导出 SVG」）此前对三维呈现只有平面近似：`scene-triangle` 实心箭头投影成三条边、SVG 里画成描边三角；三维文字用投影字高 + 基线角的平面字形旋转代替，没有透视缩短。改法（未改布局与画家的几何，只改投影快照的一格与导出）：

- `kernel/geometry/sceneGeometry.ts::projectFramedGlyph` 在投影快照的 `glyph-run` 上多带一格 `perspective`：文字平面上 `(0,0) (1,0) (1,1) (0,1)`（字高单位，x 沿基线、y 向上）四个点的屏幕像。透视相机把一个平面映到屏幕就是一个单应（`kernel/geometry/homography.ts`，Heckbert 单位正方形 → 四边形；平行四边形退化为仿射），所以导出无需相机就能把字形笔画精确送到屏幕，直线仍是直线。
- `kernel/glyph/glyphTrace.ts::traceFramedGlyphRun`：三维文字的单位字形笔画（含小数点拉长到 0.12 字高）从画家里搬进内核，画家与 SVG 共用，两边画的是同一批笔画。
- `export/svgOverlay.ts`：按场景图元与投影图元的对应关系（`scene-triangle` ↔ 三条边，其余 1:1，与 `resolveLabelCollisions` 同一约定）逐条走：实心箭头输出一条闭合 `<path … Z>` 填充（`stroke="none"`，颜色 = 角色色），源自契约 `arrow_lines` 的开放 V 翼仍是描边；带 `perspective` 的文字先画白色光晕 `<path data-part="label-halo">`（宽 `textStrokeWidthPx + 2·textHaloWidthPx` = 4.8 px），再画 2 px 粗体笔画 `<path data-part="label" data-text-plane="3d">`，不再用 `transform="rotate(…)"`。快照里没有场景图元、或两列对不上时退回逐条序列化（与改前相同）。

**实机**：gen-model（`:8022` / `:18084`）本轮都没在跑，改用 e2e 同一条无后端链路（`page.route` 注入 `src/fixtures/mbd-v2/pipe-iso-sample.json` + `meta.cheight_mm=60`，demo 页 `dimension_demo=1&dtx_demo=primitives&model_source=legacy`，真实 Chrome 1600×1000，斜视相机），脚本 `pw-svg-export-41.mjs`（`%TEMP%\plant3d-mbd-debug`）。23 条记录全部绘出：5 条 `dimension3d`（10 个实心箭头、5 条三维文字，投影快照 5 条带 `perspective`）、6 个标签 billboard（6 个填充体）、22 条平面文字。导出的 SVG（78.5 KB）：`filledArrows=10 / arrowStrokes=0 / text3d=5 / halos=5 / flatLabels=22 / rotated=0 / tagFills=6`，`pageerror` 0；`e2e/dimension-mbd-v2-fixture.spec.ts` 2/2。栅格化对照见下表：2084 竖排向上、900 / 1337 / 484 沿线并带与视口相同的透视缩短，箭头为实心三角。单测 `npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts` → **58 文件 / 329 通过**（新增 `homography.test.ts` 4、`glyphTrace.test.ts` 3、`svgOverlay.test.ts` +4）；eslint 相关 9 文件 0；`npm run type-check` 基线外新增 5 条全在他人在飞文件（`useDtxTools.*.test.ts`），本改动 0。

| 文件 | 说明 |
| --- | --- |
| `svg-export-viewer.png` | 视口（真实 Chrome，demo 页 + 注入样本）：实心箭头、三维文字、标签卡片 |
| `svg-export-rasterized.png` | 同一帧 `exportSvg()` 的 SVG 在白底上栅格化：箭头填充、文字透视与视口一致 |
| `svg-export-sample.svg` | 导出的 SVG 原文件（可直接打开 / 检查 `data-part` / `data-text-plane`） |

## inspection 显示模式（2026-09-13 补验；ADR 0061）

同一条无后端链路（demo 页 + 注入 `pipe-iso-sample.json`、`cheight_mm=60`，真实 Chrome 1600×1000），脚本 `pw-inspection-41.mjs`（`%TEMP%\plant3d-mbd-debug`）。遮挡体：demo 页自带的 DTX 立方体（`demo:0`，原本 1 mm）经 `setObjectMatrix` 放大到 0.5 m、放到相机与 `2084` 数值文字连线的 45% 处（对象包围盒同步改写、`recompile()` 后渲染出来），因此它只挡住 `2084` 的探测点，别的尺寸与标签都不在它后面。demo 页没有挂尺寸面板，模式经 `viewport.setDisplayMode` 直接切（面板单选 → viewport 的路径由 `DimensionPanelDock.test.ts` 钉住）。

| 状态 | 画出 | `derived.occluded` | 描边缓冲里出现的 α | 三种材质 `transparent` |
| --- | --- | --- | --- | --- |
| engineering（默认） | 23 | 全部无 | {1} | false / false / false |
| inspection · 立方体在相机与 `2084` 之间 | 23 | `2084` = true，其余 22 条 = false | {0.35, 0.65} | true / true / true |
| inspection · 同相机再布局一次 | 23 | 逐条相同 | {0.35, 0.65} | — |
| inspection · 相机换到对面（立方体在 `2084` 背后） | 23 | 全部 false | {0.65} | true |
| 切回 engineering | 23 | 全部无 | {1} | false |

- 切换全程 `/api/mbd/v2/pipe/**` 只请求了 1 次（模式不走 `popstate` 重同步）；`pageerror` 0。
- 单测 `npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts` → **59 文件 / 338 通过**（`occlusionPolicy.test.ts` 4：探测点取法 / ε 取大 / 每条画出的记录一条射线且从近平面出发 / 确定性；theme +1；painter +1：描边 / 箭头 / 填充三套缓冲的 α 与 `transparent` 随模式切换、`updateStyles` 保住淡化；adapter +1：设计→世界、候选按线段包围盒筛、ε 内命中不算、退化线段与无射线图层不阻挡；facade +1：只在 inspection 下调缝、切回即清 flag；panel +1：单选直接调 viewport、URL `mbd_mode`、不派发 popstate、遮挡统计只数画出的 MBD 记录）；eslint 相关 16 文件 0；`npm run type-check` 基线外新增 5 条仍全在他人在飞的 `useDtxTools.*.test.ts`，本改动 0；`e2e/dimension-mbd-v2-fixture.spec.ts` 2/2。

| 文件 | 说明 |
| --- | --- |
| `inspection-engineering.png` | engineering：红色立方体挡在 `2084` 前，尺寸照旧全画、穿透 |
| `inspection-occluded-2084.png` | inspection：`2084` 整条（数字 / 尺寸线 / 箭头 / 尺寸界线）淡到 0.35，其余 0.65 |
| `inspection-near-side.png` | inspection · 对面看：立方体在 `2084` 背后，`2084` 回到 0.65 |

### 实机对照：BRAN 24381_145018（2026-09-13 21:44 / 22:0x / 23:5x 三轮）

后端：live gen-model `http://127.0.0.1:18122`（`aios-database.exe` debug 构建，从 `gen-model-model-cache` 工作树起，分支 `codex/model-projection-cache` = gen-model-refactor `655285ce8` 合入的那条线；gen-model-refactor 自己的工作树没有实例在跑，`:8022` DOWN），项目 AvevaMarineSample，页面 `?output_project=AvevaMarineSample&show_refno=24381_145018&mbd_refno=24381_145018&gm_backend=…18122&mbdBackend=…18122`，真实 Chrome 1920×1080 @2x，脚本 `pw-inspection-real-41.mjs`（`%TEMP%\plant3d-mbd-debug`，复用 `tag-probe.js` 的相机助手）。63 条 MBD 记录、22 个 DTX 对象；三个相机：远景（`fitBox(sceneBox, 1.7)`）、同一距离从背面看、阀门簇中景（`fitBox(valveCluster, 2.8)`）；每个相机 engineering → inspection → 同相机再布局一次 → 截图。

**第一轮（探测点 = 第一条字形的三维锚点，提交 `02bbb8e` 的取法）**暴露一个系统性误判：标签 billboard 的锚点就在它点名的构件上或构件里（阀门原点、管端中心），射线从任何方向过去都先打到那个构件自己，所以 `Copy-of-1RCS002VP`（阀门位号）从正面、背面都被标遮挡，`X 1516 …` / `接 Copy-of-RCS0014-1R43013新` 这些坐标卡片也一样——卡片明明浮在空白处（`inspection-real-far-anchor-probe.png`）。ε 只能吸收「锚点恰在管面上」的浮点差，吸收不了「锚点在构件体内」的半个构件。

**第二轮（提交 `9de9e60`：`occlusionProbe` 对标签一律改探卡片——卡片屏幕中心在锚点深度上的反投影点；尺寸不变）**卡片不再误标，但三个相机没有一张标签淡化：ADR 0059 的放置本来就让卡片避开可见构件的包围盒凸包，卡片中心几乎总在空白处。用户 22:15 拍板要的是「**被点名的构件本身**被别的几何挡住时标签淡」（B），不是「卡片所在处有更近的几何」（A）。

**第三轮（现口径：标签探锚点，但把它点名的构件交给宿主排除）**：`classifyTag` 从 id 读 refno（`tag:elbo:<refno>` / `tag:name:<refno>` / `tag:connection:<refno>`）作 `subject`，随布局落到 `derived.tag.subject`；`occlusionProbe` 对带 `subject` 的标签探锚点并把 `{ subject }` 交给 `isSegmentBlocked`；DTX 适配器跳过 `o:<refno>:<n>` 里 refno 相同的 piece，以及「从锚点前 ε 处向前再发一条射线还能穿出去」的包着锚点的体。`connection:Head` / `Tail` 两张端点卡片与 `branch-name` 没有 refno，仍探卡片。同脚本、同三个相机（`inspection-real-54`）：

| 相机 | 画出 | 第一轮 `occluded=true`（裸探锚点） | 第二轮（一律探卡片） | 第三轮（探锚点排除被点名构件） | α 集合 | 再布局逐条相同 | inspection 布局耗时（3 次，ms） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 远景 | 15 | `900.51`、`X 1516`(卡片)、`Copy-of-1RCS002VP`、`接 Copy-of-RCS0014-1R43013新` | `900.51` | **`900.51`** | {0.35, 0.65} | 是 | 3.5 / 4.1 / 4.1 |
| 背面 | 13 | `1834.19`、`X 9201`(卡片)、`Copy-of-1RCS002VP` | `1834.19` | **`1834.19`、`Copy-of-1RCS002VP`** | {0.35, 0.65} | 是 | 3.2 / 3.7 / 4.2 |
| 阀门簇中景 | 16 | `900.51`、`173`、`X 1516`(卡片)、`Copy-of-1RCS002VP`、`接 Copy-of-RCS0014-1R43013新` | `900.51`、`173` | **`900.51`、`173`** | {0.35, 0.65} | 是 | 5.3 / 5.0 / 4.0 |

- 被淡化的尺寸都是数值文字站在管子另一侧的三维尺寸：`900.51` 是阀前那段（正面看文字在管后，背面看就亮了），`1834.19` 是尾段（正面亮、背面被管体挡），`173` 是阀门法兰处的短尺寸（中景里文字在法兰后）。正面 / 背面各自淡掉的是不同的一组——这正是「背面尺寸淡化、不隐藏」要的结果。
- 第三轮唯一新增的淡化是**背面看的阀门位号 `Copy-of-1RCS002VP`**：从背面相机看，阀门 `24381_145035` 的原点被下游那根直管 piece `o:24381_145018:5` 挡住（`inspection-real-behind.png` 里蓝色管子横在黄色阀体前）。正面与阀门簇中景射线上只有阀门自己的 piece，位号亮。
- **独立复核**（`pw-inspection-b-probe-54.mjs` → `inspection-real-b-probe.json`）：在页内用 `DTXLayer.raycastObject` 自己重发同一条射线（近平面点 → 锚点，ε 同内核取法），逐个候选列出命中距离、是否 `subject` 自己的 piece、是否包着锚点，再独立下结论——三个相机 × 2 张带 `subject` 的标签 = 6 例，与内核的 `derived.occluded` **6/6 一致**。远景：`X 9201`（`24381_145032`）只打到 `o:24381_145032:19`（命中距离 = 射线长，锚点就在它表面）；`Copy-of-1RCS002VP` 只打到 `o:24381_145035:21`（比锚点近 0.16 m，即第一轮误标的那半个阀体）。背面：`Copy-of-1RCS002VP` 打到 `o:24381_145018:5`（比锚点近 3.0 m，真遮挡）与 `o:24381_145035:21`（自己）。中景：两张都只打到自己的 piece。端点卡片 `X 1516`（Head）裸探锚点时射线会先打到管口 piece `o:24381_145018:8`（比锚点近 74 mm = 管半径）——它没有 refno 可排除，正是要留在卡片取法上的原因。
- engineering 三个相机全部 α = 1、三种材质 `transparent=false`、`occluded` 全无；切回 engineering 复原（`restored.alphas=[1]`）；全程 `/api/mbd/v2/pipe/**` 请求 2 次（三轮都是 2 次；三个相机来回切模式一次都没多拉）；`pageerror` 0（两个脚本都是）。

| 文件 | 说明 |
| --- | --- |
| `inspection-real-far.png` | 第三轮 · 远景 inspection：只有 `900.51` 淡到 0.35，四张卡片 0.65 |
| `inspection-real-far-anchor-probe.png` | 第一轮 · 同一相机：`Copy-of-1RCS002VP` / `X 1516` / `接 …` 卡片被误标遮挡 |
| `inspection-real-behind.png` | 第三轮 · 背面：`1834.19`（尾段在管体后）与 `Copy-of-1RCS002VP`（阀门在直管后）淡到 0.35，其余 0.65 |
| `inspection-real-valve-mid.png` | 第三轮 · 阀门簇中景：`900.51`、`173` 淡到 0.35 |
| `inspection-real-result.json` | 第三轮逐相机原始读数（相机位姿、engineering / inspection 两态、耗时、签名） |
| `inspection-real-b-probe.json` | 第三轮独立射线复核：逐相机、逐标签的候选命中（距离、subject、encloses、hides）与独立结论 |

**未覆盖**：2k 记录时每条一次射线的耗时未量（本样本 63 条记录 / 15–16 条画出，inspection 完整布局 3–5 ms）；「包着锚点的体」用「锚点前 ε 处向前再发一条射线能穿出」判定，凹体（弯头、绕回来的管段）在锚点前后各穿一次时会被当成包着锚点而不算遮挡，本样本三个相机没有这种情形；弯头标签（`tag:elbo`）本样本远 / 中景全被 LOD 收起，第三轮没有一张画出来，`subject` 排除对 ELBO piece 的效果未实测。
