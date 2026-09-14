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

**ELBO 近景补验（2026-09-14 00:1x–00:4x，`pw-inspection-elbo-54.mjs` → `inspection-real-elbo-probe.json`）**：`tag:elbo:<refno>` 是 `secondary` 档，源字高投影 ≥ `theme.sourceTextHeightMinPx`（11 px）才画，三个标准相机一张都没画出来，所以单独把相机推到每个弯头跟前。9 个 ELBO（每个一块 DTX piece `o:<refno>:<n>`）× 14 个方向（6 轴向 + 8 对角）× 距标签目标 2.0 / 1.4 / 1.0 m 由远到近、画出即止；inspection 下读内核 `derived.occluded`，并用同一条射线在页内独立复核（同 b-probe 取法）。151 个视图里 124 个画出了 ELBO 标签（每个弯头 13–14 个方向）：

- **独立复核 124/124 与内核一致**；被标遮挡 20 个视图，每一个都能在射线上点出至少一块真正挡在前面的别的 piece（直管 `o:24381_145018:n`、相邻弯头、阀门）。
- **弯头自己的 piece 挡在锚点前面**的视图有 46 个（90° 弯头每个 4 个方向；38.55° 的 `24381_145023` 锚点就在自己体内，14/14 方向都是；最深比锚点近 152 mm）——其中 26 个再无别的几何，标签保持 0.65（`inspection-real-elbo-own-piece.png`：`24381_145019` 从对角看，自己的 piece 比锚点近 0.2 m，`89.75° / PE +13301` 亮着）；另外 20 个是自己的 piece 之外还有别的 piece 挡着，淡到 0.35（`inspection-real-elbo-hidden.png`：同一个弯头从 −X 看，被 `1834.19` 那根直管 `o:24381_145018:8` 挡住）。这就是 `subject` 排除要解决的那一档：第一轮裸探锚点在这 46 个视图里会把标签全部误标。
- 「包着锚点的体」在 ELBO 上一次都没出现（0/124）：弯头锚点是两条轴线的角点，除了弯头自己没有别的体包着它。
- **顺带撞出一个既有问题**（与本口径无关，未修）：27/151 个视图（23 个 `RangeError: Map maximum size exceeded`、4 个渲染进程卡死 > 25 s）在 `kernel/hit/hitIndex.ts::buildHitIndex` 里——近景时别的尺寸有顶点落到相机平面附近，投影坐标巨大，命中区域按 64 px 格子逐格登记时格子数以亿计。触发相机例：`24381_145023` 目标 `targetDesign` 沿 +X 2 m（`elbo-probe.json` 里 `error` / `hang` 的视图都带 `camera`）。真实用户把相机推到管件跟前也可能撞上（`pageerror` 1 次就是宿主帧循环自己那一次布局抛的），修法在 hitIndex（格子范围先与视口矩形相交、或每个区域封顶格子数），不在本线。**2026-09-14 已修**：两张网格裁视口，见「修复复验」小节。

| 文件 | 说明 |
| --- | --- |
| `inspection-real-elbo-own-piece.png` | ELBO 近景 · `24381_145019` 对角 2 m：自己的 piece 比锚点近 0.2 m，标签 0.65（排除生效） |
| `inspection-real-elbo-hidden.png` | ELBO 近景 · 同一弯头从 −X 2 m：被直管 `o:24381_145018:8` 挡住，标签 0.35 |
| `inspection-real-elbo-probe.json` | 9 弯头 × 14 方向 × 3 距离的逐视图读数（画出 / LOD / 内核 flag / 独立射线命中 / 出错相机） |
| `inspection-real-far.png` | 第三轮 · 远景 inspection：只有 `900.51` 淡到 0.35，四张卡片 0.65 |
| `inspection-real-far-anchor-probe.png` | 第一轮 · 同一相机：`Copy-of-1RCS002VP` / `X 1516` / `接 …` 卡片被误标遮挡 |
| `inspection-real-behind.png` | 第三轮 · 背面：`1834.19`（尾段在管体后）与 `Copy-of-1RCS002VP`（阀门在直管后）淡到 0.35，其余 0.65 |
| `inspection-real-valve-mid.png` | 第三轮 · 阀门簇中景：`900.51`、`173` 淡到 0.35 |
| `inspection-real-result.json` | 第三轮逐相机原始读数（相机位姿、engineering / inspection 两态、耗时、签名） |
| `inspection-real-b-probe.json` | 第三轮独立射线复核：逐相机、逐标签的候选命中（距离、subject、encloses、hides）与独立结论 |

### 文字绘制：胶囊 SDF 解析抗锯齿 + 圆头接头 + 深度去重（2026-09-14 00:5x–01:4x，ADR 0062）

起因：用户看第三轮截图觉得文字发糙。把原图按像素放大 3×（`crop.ps1`，NearestNeighbor）看到三件事：笔画边缘只有锯齿、没有过渡；LFF 折线接头是平头对平头，外角缺一块、弧线上每个接头一个小缺口；药丸 10 px 字 + 1.5 px 笔画偏细。顺带核出（`pw-text-aa-debug8-54.mjs` 在 `onAfterRender` 里读 GL 状态）：URL 带 `show_refno` 时选中构件走 OutlinePass，整帧渲染进 `gl.SAMPLES = 0` 的 render target——**这条路径上根本没有 MSAA**，`antialias: true` 不起作用，所以文字全是硬边。

改法见 ADR 0062：每段描边的四边形向四周多伸出 w/2 + 1 设备像素，片元按胶囊距离算覆盖率并羽化 1 设备像素（`uFeatherPx = 1 / dpr`）；实心（覆盖率 ≥ 0.999）与羽化两遍共享几何，都用 `gl_FragDepth` 写近平面常量深度（描边 1e-5 / 白边 2e-5）并以 LESS 测试，对模型恒通过、对自身只画第一次。主题：文字笔画 1.5 → 1.8 px，药丸字高 10 → 11 px。

同相机、同位置、同 3× 放大的前后（`pw-text-aa-54.mjs` → `%TEMP%\plant3d-mbd-debug\text-aa-54c`；真实 Chrome + RX590，2× DPR，OutlinePass 路径）：

| 文件 | 说明 |
| --- | --- |
| `text-aa-before-card.png` / `text-aa-after-card.png` | 背面相机 · 尾端坐标卡片：锯齿 + 接头缺口 → 圆润均匀的笔画 |
| `text-aa-before-dim758.png` / `text-aa-after-dim758.png` | 弯头近景 · 三维数字 `758.89`（2 px + 白边）：「9」「8」外圈的接头缺口没了 |
| `text-aa-before-pill.png` / `text-aa-after-pill.png` | 弯头近景 · 药丸 `89.75° / PE +13301`：10 px / 1.5 px → 11 px / 1.8 px |
| `text-aa-before-inspection-dim2760.png` / `text-aa-after-inspection-dim2760.png` | inspection α 0.65 · `2760.31`：旧画家接头处叠成深色斑点 → 均匀浅灰 |
| `text-aa-after-inspection-dim758.png` | inspection α 0.65 · `758.89`：三维文字（两端 w 不同）也均匀，这是改成 `gl_FragDepth` 写字面量之后的结果 |

- 单测 `npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts` → **59 文件 / 344 通过**；eslint 0；type-check 本改动 0；`pageerror` 0，着色器编译无告警（控制台里那条 `Sample Bias` 告警来自别的程序，改动前就在）。
- 调试记录（都在 `%TEMP%\plant3d-mbd-debug\text-aa-54\debug*`）：第一版用 `gl_Position.z` 写常量深度，engineering 正常、inspection 下三维文字出现随机深色斑点；逐项可视化四边形几何、覆盖率、沿 / 横坐标、半宽、羽化宽、插值 w 全部正确，最后确认是两端 w 不同的段插值出的 z/w 在 24 位深度里差 1–2 个单位、去重靠的相等被破坏；改为片元里写 `gl_FragDepthEXT` 字面量后消失。
- 一并核出：inspection 的 α 0.65 在这条管线里看起来比数字浅得多（旧画家亦然，卡片文字实测亮度 ≈ 190 / 255，像 α 0.2）——混合发生在线性空间、再经 ACES 色调映射与 sRGB 编码。随后按用户拍板重定，见下一小节。

### inspection α 重定：0.65 / 0.35 → 0.92 / 0.80（2026-09-14 01:5x，ADR 0061「α 重定」段）

`pw-inspection-alpha-54.mjs`：同一相机、inspection 模式，把 `theme.inspection` 的两个 α 一起扫过一组值，各截一张图，在页内解码后对同一批像素（α = 1 时明显比背景暗的文字像素 / 明显发红的尺寸线像素）取平均亮度，算显示空间的对比保留率 eff = (背景 − 结果) / (背景 − 不透明)。真实 Chrome + RX590，2× DPR，OutlinePass 路径（`inspection-alpha-sweep.json`）：

| θ（theme α） | 1.0 | 0.96 | 0.94 | 0.92 | 0.90 | 0.85 | 0.82 | 0.80 | 0.78 | 0.75 | 0.65 | 0.50 | 0.35 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 卡片文字（背面，1.8 px，#0f172a） | 100 % | 78 % | 70 % | **63 %** | 57 % | 45 % | 40 % | **36 %** | 34 % | 30 % | 20 % | 12 % | 8 % |
| 三维数字 `2760.31`（2 px + 白边） | 100 % | 78 % | 70 % | 63 % | 57 % | 46 % | 40 % | 37 % | 34 % | 31 % | 22 % | 14 % | 10 % |
| 三维数字 `758.89`（近景） | 100 % | 78 % | 70 % | 63 % | 56 % | 44 % | 38 % | 35 % | 32 % | 29 % | 19 % | 11 % | 6 % |
| 药丸文字（#334155，11 px） | 100 % | 81 % | 73 % | 67 % | 61 % | 50 % | 44 % | 41 % | 38 % | 34 % | 25 % | 17 % | 11 % |
| 图纸红尺寸线（#c81e1e，1.2 px） | 100 % | 87 % | 82 % | 78 % | 74 % | 65 % | 60 % | 58 % | 55 % | 51 % | 40 % | 28 % | 19 % |

- 旧值 0.65 / 0.35 在文字上只呈现 20 % / 8 %。按「可见 ≈ 65 %、被遮挡 ≈ 35 %」反查文字那三行：**`visibleAlpha` 0.92（63 %）、`occludedAlpha` 0.80（36 %）**。尺寸线在同一 α 下留得更多（78 % / 58 %）——几何比文字耐淡，两态在线上仍差 20 个百分点。
- 落地后同相机截图（`inspection-alpha-after-behind.png`）与同位置 3× 放大前后：

| 文件 | 说明 |
| --- | --- |
| `inspection-alpha-before-visible-2760.png` / `inspection-alpha-after-visible-2760.png` | 可见记录 `2760.31`：0.65（浅灰）→ 0.92（深灰，仍明显比 engineering 淡） |
| `inspection-alpha-before-occluded-1834.png` / `inspection-alpha-after-occluded-1834.png` | 被遮挡记录 `1834.19`（管体后）：0.35（几乎只剩白边）→ 0.80（读得出、明显淡于可见记录） |
| `inspection-alpha-before-occluded-frame.png` / `inspection-alpha-after-occluded-frame.png` | 被遮挡的阀门位号框 `Copy-of-1RCS002VP`：0.35 → 0.80 |
| `inspection-alpha-after-behind.png` | 背面相机全图：`X 9201` 卡片（可见）与 `Copy-of-1RCS002VP` 框（被遮挡）两档一眼可分 |
| `inspection-alpha-sweep.json` | 上表原始读数（逐相机、逐区域、逐 α 的均值亮度 / RGB / eff，含掩膜像素数） |

- 单测 `theme.test.ts` 更新（钉住 0.92 / 0.80 并断言被遮挡 < 可见）；59 文件 / 344 通过；eslint 0。

**未覆盖**：2k 记录时每条一次射线的耗时未量（本样本 63 条记录 / 15–16 条画出，inspection 完整布局 3–5 ms）；「包着锚点的体」用「锚点前 ε 处向前再发一条射线能穿出」判定，凹体（弯头、绕回来的管段）在锚点前后各穿一次时会被当成包着锚点而不算遮挡，本样本三个标准相机与 124 个 ELBO 近景视图都没有出现这种情形（ELBO 上「包着锚点的体」为 0）；`buildHitIndex` 的近景溢出（见上）当时未修——下一节全管道扫描量出了它的覆盖面，随后在「修复复验」小节修掉。

### 全管道扫描：2469 条 BRAN 内核全跑 + 52 条实机抽样（2026-09-14 02:0x–03:4x）

**范围**。`list-brans-54.mjs`（`%TEMP%\plant3d-mbd-debug`）从 `/api/v1/tree/roots` 起按 `children` 遍历整个 AvevaMarineSample 树（53 941 个结点），得 **2693 个 BRAN**，逐个拉 `/api/mbd/v2/pipe/<refno>`：**2469 个 200**（primitives 5–463，中位 25；kinds 合计 `aid_line` 27 271 / `aid_text` 11 487 / `label` 19 144 / `leader_line` 19 144 / `linear_dim` 15 340 / `slope_mark` 1467 / `weld_mark` 1238；全部 `layout_mode=isodim_main`；分库 7321 ×44、7997 ×611、7999 ×1254、8000 ×560），**224 个 422**——218 个「不是派生隐式管身的路由容器，没有管道尺寸标注」、6 个「every branch member was skipped for missing geometry」，都是后端按契约拒绝，前端按 ADR 0046 走 `loadError` 诊断，不在本轮范围。列表 `all-pipes-brans.json`。

**内核全跑**（Node，vitest 临时用例 `allPipes.sweep.test.ts`——跑完已从仓库删除，副本在 `%TEMP%\plant3d-mbd-debug`；`SWEEP_REFNOS / SWEEP_OFFSET / SWEEP_COUNT` 可切片重跑）。每条 payload 走 `parseMbdV2PipeData → mbdV2ToExternalRecords → normalizeExternalDimension → layoutViewport`（1220×806 @2x 透视相机 fov 30°，以尺寸输入的包围盒中心为目标、沿效果图同一斜视方向取 **far 1.7× / mid 0.6× / close 0.25×** 最大边长三个距离；每个相机 engineering、inspection（遮挡缝恒 `false`）、同相机再布局一次）→ `layoutResultsToSvg`。逐条检查：解析失败 / 原子拒绝 / 抛异常 / 图元、`labelBounds`、场景锚点里的非有限数 / SVG 含 `NaN|Infinity` / 再布局签名不同 / 屏内标签中心 `hitTest` 未命中。两处按 64 px 格子逐格登记的网格（`kernel/hit/hitIndex.ts::buildHitIndex`、`kernel/collision/resolveLabelCollisions.ts` 的 `LabelOccupancy`）在用例里包了一层预算护栏：先按同一公式预测格子数，> 1e6 就抛 `HitIndexBudget` / `LabelOccupancyBudget` 而不去真分配——**第一次试跑没有护栏，close 视图在 `24381_103506` 上把 4 GB 堆直接 OOM**（上一会话 02:12 起的那次全跑也是这样停在第 102 条的）。2469 条 312 s 跑完（`all-pipes-kernel-sweep.json`，逐管逐视图一行）：

| 视图 | 相机距离 / 尺寸包围盒最大边 | 跑通 | 格子预算超限（= 真机会卡死 / `RangeError` / OOM） | 其他任何失败 |
| --- | --- | --- | --- | --- |
| far | 1.7× | **2469 / 2469** | 0 | 0 |
| mid | 0.6× | 2436 | **33**（hitIndex 30、占用网格 3；尺寸范围 0.5–10 m 都有） | 0 |
| close | 0.25× | 2034 | **435**（17.6 %；hitIndex 355、占用网格 80） | 0 |

- far 视图（整条管子在视野里）：75 947 条记录，26 576 条画出（LOD 收起 `detail-far` 41 026 / `secondary-far` 4698 / `short-line` 3319 / `overlap` 328），非有限数 **0**，SVG `NaN` **0**（268 MB SVG），再布局 **2469 / 2469** 逐条相同，屏内标签中心命中 **26 070 / 26 070**；engineering 布局耗时 p50 0.4 ms / p90 1.4 ms / p99 7.2 ms / max 36 ms（`24381_103674`，142 条记录）。解析诊断 0；原子拒绝 0。
- payload `issues` 全是 `warning`（3901 条，散在 1020 个 BRAN），无 `error`：前三类都是后端的「implied tube 与两端端口不共轴、E3D 不画 tube、不出 tube 长度」（2679 条），其余是 ATTA / BEND / ELBO / WELD 偏离等轴线、Tail 与邻点跨轴等 PML 层面的数据检查——只进面板诊断，不影响出图。
- 格子超限就是上一节记的近景溢出，这次量出**它不只在近景**：mid（0.6×，整条管子基本在视野里）已有 33 条；跑通的视图里 hitIndex 格子数 close p99 67 万、max 97 万（视口本身只有 20×13 = 260 格），mid max 88 万。根因一处：布局对相机平面附近 / 相机背后的顶点不裁剪，投影坐标到 1e5–1e7 px 量级后两张网格按格子逐个登记。当时**未修**（见下「结论与待拍板」），随后在「修复复验」小节修掉。

**实机抽样**（真实 Chrome 1920×1080 @1x，RX590，`pw-all-pipes-61.mjs` → `all-pipes-browser-sweep.json`）。52 条 BRAN 分层抽样（`pick-sample-61.mjs`：4 个库按步长各取 3 / 7 / 10 / 7，payload 最大 5 / 最小 3，尺寸范围最小 3 / 最大 3，`slope_mark` / `weld_mark` 最多各 3，payload 警告最多 3，内核 mid 超限 4，参照管 `24381_145018`）。每条：`?show_refno=…&show_refno_select=0&mbd_refno=…` 加载 → 等几何 + MBD 记录 + 布局齐 → far（`fitBox(dtxBox, 1.7)`）与 behind（对面同距离）两相机 × engineering / inspection：读内核状态、3 次布局计时、截图、收 `pageerror` / console；每条 240 s 看门狗（没触发）。22 分钟。

- 52 条全部加载出几何（1354 个 DTX 对象、4133 条记录），加载 p50 14 s / p90 19 s / max 33 s；`/api/mbd/v2/pipe/**` 每次加载 2 次（50 条）、3 次（1）、4 次（1）。
- 两相机 × 两模式：非有限数 0；engineering α = {1}；inspection α = **{0.92, 0.80}**、`occluded` 无 `undefined`、再布局逐条相同 **52 / 52**；切回 engineering 复原 52 / 52。inspection 完整布局（含每条画出记录一条射线）p50 1.8 ms / p90 21 ms / **max 37 ms**（`24381_105733`：407 条记录 / 104 个对象 / 52 条画出）——最大的几条管子一次布局已经接近一帧。
- **3 / 52 条 `pageerror: RangeError: Map maximum size exceeded`（`24383_75125`、`24383_99558`、`24381_145565`），全部在加载阶段**（复跑带阶段标记 + 相机轨迹，`all-pipes-load-camera-probe.json`）：MBD 记录比 DTX 几何先到，宿主帧循环在**默认相机** `[-37.1, 13, 58.5] → [-21.93, 1.35, 29.45]`、全局模型矩阵还没就位时就把记录布局了一遍，坐标落到相机平面附近，hitIndex 格子爆掉、整次布局抛出。几何到、`fitDtxViewerToFocusBox` 之后同一批记录布局正常（三条在最终相机下都是 `behind=0 / over1e4=0`，画出 46 / 32 / 4 条）。`24381_145565` 的一次复跑里几何拖了 30 s 才到，这 30 s 内每一帧布局都抛、**一条尺寸都画不出来**，payload 被重拉了 7 次——同一根因在加载期的表现，用户端可见为控制台报错 + 尺寸迟出。
- **焊缝标记在 inspection 下全部被判遮挡**（`all-pipes-occlusion-probe-24381_146979.json`，`pw-occlusion-probe-61.mjs`）：`24381_146979`（58 个对象）far 相机画出 48 条、28 条 `occluded=true`，其中 **27 条是全部 27 个焊缝标记**（`isoline:n:weld:mark:<refno>`），第 28 条是数值文字站在管子背面的 `1032`（正确）。页内独立射线（`DTXLayer.raycastObject`，与内核 flag **48 / 48** 一致）：焊缝标记的探测点是管轴上的焊点，射线在锚点前 **24–80 mm** 先打到管壁——本管 piece（`o:24381_146979:n`）或相邻管件（弯头 `o:24381_146983:19` 等），正好一个管半径，ε（0.5 mm / 2 px）吸收不了。抽样里 far 的 95 条遮挡 flag 有 **69** 条、behind 的 91 条有 **71** 条是焊缝标记；项目里 **334 个 BRAN 带 1238 个焊缝标记**都会这样。这是第一轮标签误判（「锚点在构件体内」）的同类：`subject` 排除只挂在 `derived.tag` 上，焊缝标记不是 tag、没走它。截图 `all-pipes-weld-marks-engineering.png` / `-inspection.png`（同相机两模式：焊缝环 inspection 下全淡）。
- 极端小管（几何 20 mm、卡片 100 px）：端点卡片「探卡片中心在锚点深度的反投影点」那一点仍落在构件体内，正反两面都判遮挡（`24381_104746` / `24381_104806`，各 1 个对象 3 条记录）；边界情形，记下未动。
- 观感（都按规则画对了，未动）：管件多的长管远景是「药丸云」——`all-pipes-largest-24381_105860.png`（19 m 细管，419 条记录 / 52 条画出，几乎全是 `89.97° / 弯曲半径 / PE` 药丸 + 长引线），`all-pipes-24383_75125-behind-inspection.png`（29 m 弯管，10° 弯头药丸 + `R510.xxx-GL` 支架位号）。药丸密度没有 LOD 管。

| 文件 | 说明 |
| --- | --- |
| `all-pipes-brans.json` | 2693 个 BRAN：refno / 名称 / 库 / 状态 / 拉取耗时 / primitives / kinds / 422 类别 |
| `all-pipes-kernel-sweep.json` | 内核全跑逐管一行：记录数、范围、issue 计数、far LOD 隐藏原因，far / mid / close 各视图（错误、画出、屏内、tag、两模式耗时、hitIndex 格子数与最大坐标、命中测试、SVG 字节） |
| `all-pipes-browser-sweep.json` | 52 条实机抽样逐管读数（加载、对象数、两相机两模式状态、耗时、遮挡记录标签、pageerror / console） |
| `all-pipes-load-camera-probe.json` | 3 条 `RangeError` 管子的加载期复跑：相机轨迹（默认 → fit）、报错时刻的相机、最终相机下逐记录的独立投影（是否在相机背后 / 最大坐标） |
| `all-pipes-occlusion-probe-24381_146979.json` | 焊缝标记管的独立射线复核：逐条画出记录的内核 flag、独立结论、挡在前面的 piece 与其距锚点的距离 |
| `all-pipes-weld-marks-engineering.png` / `all-pipes-weld-marks-inspection.png` | `24381_146979` far 相机：engineering 全亮 → inspection 27 个焊缝环全部淡到 0.80 |
| `all-pipes-largest-24381_105860.png` | payload 最大的管（463 primitives）far engineering：药丸云 |
| `all-pipes-24383_75125-behind-inspection.png` | 29 m 弯管 behind inspection：3 条淡化，其余药丸 / 位号 0.92 |

**结论与待拍板（当时）**：按 far / behind 两个正常观察距离，2469 条管的解析、映射、布局、SVG、命中与 52 条实机的两模式渲染没有一处失败或非确定；两件事要人定：① 两张 64 px 网格不裁视口——近景 17.6 % 的管、中景 1.3 %、以及**每条管加载期的默认相机那一帧**都会撞上，表现为控制台 `RangeError`、渲染进程卡死或整页 OOM，修法在 `hitIndex.ts` / `resolveLabelCollisions.ts` 各一处「格子范围先与视口（外扩容差）相交」，或更上游在布局前剔除相机背后 / 近平面前的记录；② 焊缝标记的遮挡探测要不要像 tag 一样带 `subject`（本管 + 被焊的两个构件都排除）、或改探焊缝环表面点、或干脆不参与淡化——这是 d-386 口径的边界。**两件都已在下一小节修掉并复验**（用户交接时授权「继续未完的部分，不必重问」）。

### 修复复验：两张网格裁视口 + 焊缝标记带 `subject`（2026-09-14 10:1x–10:5x，fable-5-1-69）

**改了什么**。① `kernel/hit/hitIndex.ts::buildHitIndex(layouts, cellSizePx, bounds?)` 与 `kernel/collision/resolveLabelCollisions.ts::resolveLabelCollisions(inputs, bounds?)`：给了 `bounds`（视口）时，每个区域 / 标签矩形的格子范围先与「视口外扩一格（64 px）」相交再逐格登记——外扩一格保证屏内点、容差 ≤ 64 px 的命中测试与不裁时逐条相同；完全落在外面的区域不登记（命中索引对屏外点本来就不答），完全落在外面的标签既不占位也不被搬；非有限坐标得到空范围。`layoutViewport` 把 `projector` 的 `widthCssPx × heightCssPx` 传给两张网格（ADR 0040 早就要求「视口裁剪、有界碰撞」，这次把两张网格真正裁进去）；不传 `bounds` 的直接调用（单测、demo）行为不变。**没有**在上游剔除相机背后的记录：近景相机在管子里时很多记录一部分顶点在背后、另一部分正画在屏上，整条剔掉会把屏上那部分的命中一起丢掉。② 焊缝标记：`mbdV2ExternalAnnotations.ts::weldSubject` 从 `…:weld:mark:<refno>` 读出 **WELD 构件** refno（查 `/api/v1/tree/children`：`24381_146979` 的 49 个成员里 `24381_146980 / …982 / …984 …` 全是 `noun=WELD`、带 SPRE；gen-model 把它画成一段管外径的短圆盘，`o:24381_146980:17` 包围盒 43.5 × 24 × 48 mm，管 OD 48.3）→ 新增的 `ExplicitLayoutInput.subject` → `layoutExplicit` 落到 `derived.subject` → `occlusionProbe` 对带 `subject` 的记录（`derived.tag.subject` 或 `derived.subject`）探锚点并把 `subject` 交给宿主缝；DTX 适配器不改：WELD 自己的 piece 按 refno 跳过，包着焊点的直管 / 管件按「锚点前 ε 向前再穿出」排除。ADR 0061「焊缝标记」段。

**先做的干跑**（`pw-weld-subject-probe-69.mjs`，改代码前，`all-pipes-weld-subject-probe-24381_146979.json` 的 `before`）：对 `24381_146979` far 相机 27 个画出的焊缝标记，页内独立射线逐个挡体标 `isSubject / encloses / ownBran`，按拟定口径算结论——27 个裸射线全遮挡 → 带 `subject` 后 **4** 个；21 个挡在前面的直管 piece 里 18 个「包着焊点」（直管端面有盖，向前那条射线穿得出去），剩 3 个是真挡在前面的别的直管。剩下 4 个逐条看：`weld:mark:24381_147020` 从弯头 `147019` 另一腿方向看过来，射线先穿竖直直管 `o:…:3`（前 72 mm）与焊缝盘 `147018`（前 52 mm）；`147023` / `147028` 是承插 COUP（`147022` / `147027`，套筒 OD ≈ 70、长 ≈ 60 mm，两端焊缝相距 13 mm）——射线先穿另一端的焊缝盘与直管；`147002` 是 COUP `147001` 的套筒壁挡在焊缝盘前 32 mm。四个都是**别的**几何挡在焊点前，按口径该淡。

**单测**：`hitIndex.test.ts` +1（3e8 px 的线段、1e9 × 1e9 px 的矩形、屏外矩形、±∞ / NaN 坐标：屏内命中不变、屏外不答、不抛）、`resolveLabelCollisions.test.ts` +2（1e9 px 标签既不占位也不被搬、NaN 标签不动、屏内避让不变；跨视口边缘的标签只在屏内格子登记仍能挡住原点处的自动标签）、`layoutViewport.test.ts` +1（1e6 px/m 投影 + 斜向尺寸 = 尺寸线区域 6e7 格，修前 `RangeError`，修后屏内尺寸界线命中）、`occlusionPolicy.test.ts` +1 改 1（焊缝标记带 `derived.subject` 探锚点并把 subject 交给缝；tag / weld / dim 三条射线的 hints）、`explicit.test.ts` +1（`subject` 落到 `derived`）、`mbdV2ExternalAnnotations.test.ts` +1 改 1（plant-mbd id 尾段 → `subject`，别的 producer 无）。`vitest run src/dimension src/composables/useMbdExternalSync.test.ts`：**59 文件 / 351 通过**（上轮 344）。eslint 14 个改动文件 0 报错。`npm run type-check`：改动文件 0 新增（基线外剩下的 `useDtxTools.*.test.ts` ×5 `Ref<DTXLayer | null>` 不在本次改动里，与本线无关）。

**内核全跑复验**（`allPipes.sweep.test.ts` 副本，两张网格的护栏改成**观察器**：仍按原公式算「不裁时要多少格」，但一律调真实现并计其耗时；命中冒烟只探中心在屏内的标签——命中索引的契约就是屏内点；`all-pipes-kernel-sweep-after.json`）。先跑上轮超限的 **461** 条（435 close ∪ 33 mid）：461 / 461 通过，26 s。再跑全部 **2469 条 × far / mid / close**：**2469 / 2469 三视图全过，0 flag，96 s**（上轮 312 s，其中 468 个视图在护栏上抛）。

| 视图 | 跑通 | 不裁时格子数 p50 / p99 / max（> 1e6 的视图数） | 裁后网格耗时 hitIndex / 占用 max | 非有限数 / SVG NaN / 再布局不同 | 屏内标签命中 | engineering 布局 p99 / max |
| --- | --- | --- | --- | --- | --- | --- |
| far 1.7× | **2469 / 2469** | 111 / 575 / 4695（0） | 0.9 ms / 0.2 ms | 0 / 0 / 0 | 25 969 / 25 969 | 4.7 / 11.5 ms |
| mid 0.6× | **2469 / 2469** | 486 / 5.6e6 / **4.65e9**（33；占用网格 3 条到 4.6e9） | 0.9 ms / 0.2 ms | 0 / 0 / 0 | 15 106 / 15 106 | 3.6 / 5.9 ms |
| close 0.25× | **2469 / 2469** | 11 738 / 8.2e9 / **3.34e12**（435；占用网格 80 条，max 2.7e10） | 1.5 ms / 1.7 ms | 0 / 0 / 0 | 8646 / 8646 | 3.6 / 6.5 ms |

超限视图数 33 / 435 与上轮一模一样——同一批相机、同一批坐标（max |coord| close 1.6e8 px），只是这次两张网格在 ≤ 1.7 ms 内登记完屏内那几百格。far 的标签命中 26 070 → 25 969 是探针口径变严（中心在屏内）少探了 101 条，不是丢命中。

**实机复验**（真实 Chrome 1920×1080 @1x，vite dev 热更后的源码）：
- 加载期 `RangeError`（`pw-load-camera-probe-61.mjs` 原脚本复跑 3 条，`all-pipes-load-camera-probe-after.json`）：`24383_75125` / `24381_145565` / `24383_99558` **pageerror 3 → 0**；轨迹里默认相机 `[-37.1, 13, 58.5]`、几何未到那一帧照样布局了 297 / 13 / 80 条记录（画出 135 / 13 / 44），不再抛；几何到后画出 46 / 4 / 32 条与上轮相同；payload 每条 2 次。
- 焊缝标记（同 far 相机）：内核 `occluded` **27 → 4**，与干跑的独立结论 **4 / 4 同一批 id**（`all-pipes-weld-subject-probe-24381_146979.json` 的 `after`）；整管 48 条画出记录里遮挡 flag 28 → **5**（4 个焊缝 + 数值站在管背面的 `1032`，后者与上轮同），`all-pipes-occlusion-probe-24381_146979-after.json`。截图 `all-pipes-weld-marks-inspection-after.png`（与上轮 `-inspection.png` 同相机），`all-pipes-weld-marks-crop-3x.png` 是同一处焊缝 3× 放大的 engineering | 修前 inspection | 修后 inspection 三联——修前焊缝环比尺寸线淡一档，修后与 engineering 一样亮；像素统计（PIL，对 engineering 里的红色笔画像素量对背景的对比保留率）：焊缝像素修前中位 0.87 → 修后 0.97，其余红色像素（尺寸线）0.95 → 0.97 不变。
- 参照管 `24381_145018`（`pw-inspection-b-probe-54.mjs` + `pw-inspection-real-41.mjs`，与上轮 `inspection-real-54` 逐条比）：三相机 4 个标签的内核 flag **逐条相同**（`Copy-of-1RCS002VP` 仍只在 behind 淡），三相机全部记录的遮挡集合 `[900.51]` / `[1834.19, Copy-of-1RCS002VP]` / `[900.51, 173]` **逐条相同**，确定性 3 / 3，pageerror 0——tag 与尺寸的口径没被动到。

| 新增文件 | 说明 |
| --- | --- |
| `all-pipes-kernel-sweep-after.json` | 复验内核全跑逐管一行：每视图错误、画出、屏内、两模式耗时、**不裁时两张网格各要多少格**、裁后各自耗时、最大坐标、命中、确定性、SVG NaN |
| `all-pipes-weld-subject-probe-24381_146979.json` | 焊缝口径干跑（`before`：内核仍 27/27）与实装后（`after`：内核 4/27）：逐焊缝的挡体列表（isSubject / encloses / ownBran / 距锚点 mm）与两种结论 |
| `all-pipes-occlusion-probe-24381_146979-after.json` | 修后整管 48 条画出记录的内核 flag 与独立射线（原脚本，不知 subject，只作挡体清单） |
| `all-pipes-load-camera-probe-after.json` | 3 条 `RangeError` 管子修后的加载期复跑：pageerror 0、相机轨迹、最终相机下的独立投影 |
| `all-pipes-weld-marks-inspection-after.png` / `all-pipes-weld-marks-crop-3x.png` | `24381_146979` far inspection 修后整幅；同一焊缝 3× 三联（engineering / 修前 / 修后） |

**未做 / 仍留**：极端小管里端点卡片探卡片中心落在构件体内的边界情形（`24381_104746`）未动；「药丸云」观感未动；相机背后记录的二维快照（`primitives`，供 SVG / 命中）仍是把背后顶点直接投影的结果，画家走三维不受影响，命中索引现在只登记屏内部分。
