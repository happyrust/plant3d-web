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
- 单测 `npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts` → **56 文件 / 317 通过**（`obstacleGeometry.test.ts` 新增、`tagBillboard.test.ts` 14：障碍 / 加权侵入 / 覆盖层 / 不出屏 / 外圈引出、`layoutViewport` 障碍源透传、`dtxDimensionViewerAdapter.test.ts` 新增 2：覆盖层重定原点 / 包围盒角点经矩阵回设计空间、facade +1：`queryLayoutObstacles` 与 `getLayoutOverlays` 各被问一次）；eslint 相关 13 文件 0；`npm run type-check` 基线外新增 8 条全在他人在飞文件（`useDtxTools.*.test.ts`、`useXeokitMeasurementTools.ts`、`dtxDimensionSnapPort.ts`、`pickDerivation.test.ts`），本改动 0；`e2e/dimension-mbd-v2-fixture.spec.ts` 2/2。

| 文件 | 说明 |
| --- | --- |
| `tags-obstacles-far.png` | 远景：四个标签与构件凸包、描边、数字、坐标 gizmo 均无重叠；位号方框整块在屏内（画布顶部中央，让开了右上角的 gizmo） |
| `tags-obstacles-near-valve.png` | 阀门端中景：尾端卡片在手轮上方、位号在阀体右侧，都不再压阀体 |
| `tags-obstacles-near-valve-boxes-off.png` | 同相机、只让开数字 / 标签 / 描边的对照：尾端卡片压在阀杆上、位号压在阀体上（改动前的效果） |
| `tags-obstacles-close-valve.png` | 阀门端近景：阀门凸包盖住右半画布，卡片与位号取加权侵入最小的位置，离开阀体本体（引线变长） |
| `tags-obstacles-close-valve-boxes-off.png` | 同相机对照：卡片压在阀杆上、位号压在阀体上 |

## 已知未做

- 管件障碍是包围盒 8 角点的投影凸包，不是网格轮廓：透视近景里凸包明显大于本体，标签可能压在凸包的空白边缘，或在没有零侵入位置时以最少重叠压在本体上；引线不是障碍、可以穿过阀体。
- 分支名药丸（`detail` 级）在本样本三个视角都没到显示阈值。覆盖层只登记了坐标 gizmo；三维画布容器之外的浮层（工具条、面板）与标签不相压，不在其中。
- `surfaceM` 取本分支尺寸界线的下四分位（= 求解器最内行 `od`）；本样本 DTX 管体视半径略大于该值，尺寸界线起点略在管体轮廓内。
- SVG 导出把三维文字近似为按投影字高 / 基线角旋转的平面字形（无透视缩短）；实心箭头在 SVG 中仍为三条描边（与用户尺寸一致）。
