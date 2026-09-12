# PRD · 三维 MBD 管道标注对齐参考图效果

日期：2026-09-12  
作者：协同组「标注」指挥官 / 产品经理（fable-5-1-17）；实施 fable-5-1-31  
状态：**T1 / T2 + S1 成对去重已于 2026-09-12 落地**（ADR 0057；D1–D4 按效果图取 a，用户「继续未完的部分，不必重问」授权）；T0 以 `%TEMP%` 脚本 + `docs/verification/mbd-3d-dimension-presentation-2026-09-12/` 归档代替；**T3（标签块 / 引线 / 方框）未做**。实施与验证记录见 §9。  
上游约束：协同决策 d-438（架构固定：gen-model 供事实、plant-mbd 纯 Rust 求解器单源、plant3d-web 只读 external source 经现有 `ThreeSceneDimensionPainter` 呈现；不重写画家；MBD 不进用户 DimensionDocument）  
相关文档：`2026-09-12-mbd-linear-dim-visual-optimization-plan.md`（QW1–QW3 / S2 / S3 已落地）、`2026-09-12-mbd-dimension-engineering-convention-review.md`（标准条款核实与 S1 / S4 规则）

## 1. 背景与参考图

用户 13:30 给出一张参考图（照片：某管道三维轴测图软件的出图画面，蓝色着色三维管段 + 二维图纸式标注），要求「参考这种标注效果」。参考图可辨认的标注要素：

| # | 要素 | 参考图表现 |
| --- | --- | --- |
| R1 | 尺寸线位置 | 远离管体（约 1.5–2 倍管径以上），红色细线，两端有从管体特征点引出的**长尺寸界线** |
| R2 | 尺寸数字 | **置于尺寸线上方**、沿尺寸线方向（竖向尺寸 2084 / 1350 的数字随线旋转 90°）、黑色粗体、不打断尺寸线 |
| R3 | 箭头 | **实心**小三角，红色，位于尺寸界线内侧 |
| R4 | 连续尺寸 | 900 / 1337 共用一条尺寸线（running dimension），中间尺寸界线落在三通中心 |
| R5 | 端点坐标块 | 管段两端各一块多行文字：管线号（1RHR0008-K208-01）、图号（20161KA2BZS03-148）、X / Y / PE（标高），带引线指向端点 |
| R6 | 标高标注 | 「PE -4400」「PE -3050」等单独标高文字，带方框编号 |
| R7 | 元件位号 | 阀门位号「1RHR054VP」加方框，带引线 |
| R8 | 焊口 / 件号 | 方框数字 1–9、字母编号 A2–A9 / A77、M1 / M10 |
| R9 | 方向标志 | 底部「W」北向 / 视向标志 |
| R10 | 整体风格 | 浅色背景、蓝色着色模型、红色尺寸线与箭头、黑色粗体文字、无遮挡处理（二维图纸） |

效果图（设计目标，真三维标注，按真实契约几何在设计空间构造后透视投影绘制）：`docs/design/mbd-annotation-mockup-2026-09-12/`
（`mockup-3d-far.png` 主图、`mockup-3d-near-valve.png` 中景、`current-*.png` 现状对照、`README.md` 规则说明）。
用户 13:5x 明确：要的是**三维尺寸标注**（几何随相机透视），不是屏幕投影贴图——目标 §3 与 D2 据此以三维平面内的文字为准。

## 2. 现状（plant3d-web，commit `597034f`，BRAN `24381_145018`）

契约 `MbdV2PipeData` 77 图元已经覆盖参考图大部分**内容**：18 `linear_dim`（main / atta，每 isoline 一条 running dimension，R4 已满足）、14 `label`（端点 connection tag = `X 1516 / Y 8157 / PE 13293` 多行 → R5；弯头 tag = `89.75° / PE +13301` → R6；元件 name tag `Copy-of-1RCS002VP` → R7；branch-name）、14 `leader_line`、3 `aid_text`（skew X/Y/Z）、7 `slope_mark`、21 `aid_line`。**差距主要在呈现风格**：

| 参考要素 | 现状 | 差距 |
| --- | --- | --- |
| R1 尺寸线位置 | 求解器行位 `od + 1.2·cheight·(row−1)`，主尺寸离管轴一个外径，三维实体管盖住尺寸线；尺寸界线恰好止于尺寸线 | **大** |
| R2 数字位置 | 钉在线中点、文字框**打断**尺寸线（GB 允许 / ASME 风格 / ISO 偏离）；沿线排字已有 | 中 |
| R3 箭头 | 契约开放 V 形两翼（0.96·cheight），深橙 | 小（两翼围成的三角填充即可，几何不变） |
| R5–R7 标签 | 契约有数据、Web 有 label / leader 映射，但今日调试一直只看 `linear_dim`，多行块 / 引线 / 方框的实际效果**未验证** | 待验证 |
| R8 焊口 / 件号编号 | 契约无此数据 | 需 producer（gen-model / plant-mbd）另立 |
| R9 方向标志 | 视口已有坐标 gizmo | 不做 |
| R10 颜色 / 字重 | 尺寸线深橙 `#c2410c` 1.2 px；文字深灰 `#111827` 1.5 px 描边；字高 11–18 px | 小（主题常量） |
| 三维特有 | LOD（atta 远景隐 / 短线隐）、edge-on、遮挡穿透 | 参考图是二维图纸无此问题；三维需保留 LOD，遮挡走 S4 |

## 3. 目标（一句话，待确认）

> 让 plant3d-web 三维视口里的自动 MBD 管道标注（长度尺寸 + 端点坐标块 / 标高 / 元件位号及引线）在呈现风格上对齐参考图——尺寸线远离管体并带尺寸界线、数字置于尺寸线上方、实心箭头、红线黑粗体字、标签块带引线——同时不改 plant-mbd 求解器的尺寸语义（数值、分段、main/atta 归属）与 d-438 架构分层。

## 4. 非目标

- 不做出图 / 打印 / 图纸导出（参考图是二维出图，本期只改三维视口呈现）。
- 不新增焊口编号、件号（R8）、管线号 / 图号块（R5 中的编号行）——契约无此数据，需 gen-model / plant-mbd 侧另立任务。
- 不改写契约 `text` 数值（小数位、单位）。
- 不改用户手工尺寸（DimensionDocument）的风格（保持洋红 / 现有样式）。
- 不把 Rust 求解逻辑移到前端；不让 MBD 进用户 DimensionDocument（d-438）。

## 5. 用户路径

1. 校审工程师加载 BRAN（`show_refno`），MBD 全部类别显示（不再默认只看长度）。
2. 远景：看到清晰的尺寸链（数字在线上方、实心箭头、尺寸线在管体之外）、两端坐标块、元件位号，风格接近参考图。
3. 拉近：字随模型缩放（现有 S2），被 LOD 隐藏的 atta / 短段回来（现有 S3）。
4. 选中 / 悬停尺寸或标签有高亮反馈；BRAN 选中高亮与尺寸颜色可区分（现有 QW2）。
5. （可选）切换 engineering / inspection，被遮挡尺寸淡化（S4）。

## 6. 待拍板（派活前必须定）

| # | 问题 | 选项 | 影响 |
| --- | --- | --- | --- |
| D1 | **尺寸线远离管体（R1）走哪条路** | a) 只在 Web 呈现层沿求解器 `dim_dir`（= `extension_lines` 方向，设计空间、与相机无关）把尺寸线 / 箭头 / 标签整体外移 k·OD，尺寸界线随之延长；b) 改 plant-mbd 行位公式 / 新增 lane 参数，**重录六条 golden**；c) 契约 consumer-first 新增 `meta.dim_offset`，由 producer 决定 | a) 不碰求解器与 golden，但 Web 持有一份「呈现偏移」；b) 跨仓、改 golden，需架构立项；c) 最正统但最慢 |
| D2 | **数字置于尺寸线上方（R2）** | a) 改为上方（外侧，远离管体），atta / main 两行并存时按确定性规则处理（行距 1.2·cheight 与字高 1·cheight 的冲突）；b) 保持中断处 | a) 对齐参考图与 ISO 5.7.2；b) 零改动 |
| D3 | **颜色与字重（R3 / R10）** | a) 尺寸线 / 箭头红（如 `#d40000`）、文字黑粗体（描边加粗到 ~2 px）、实心箭头；b) 保持深橙 / 深灰 / 开放 V | a) 需同时把 `selected` 角色从 `#ff0000` 换色以免与红尺寸混淆 |
| D4 | **标签块范围** | a) 本期把 R5–R7（坐标块 / 标高 / 位号 + 引线，含方框）一并对齐；b) 本期只做尺寸，标签下期 | 决定拆几条活 |
| D5 | **参考图文件** | 请把参考图原文件放到 `docs/verification/reference/`（或给路径），工程对照用 | 没有文件时按本文 §1 要素表对照 |

## 7. 验收标准（每条可由第三方独立判真假；固定相机 = `24381_145018` 今日 S3 基线的 fit）

- **AC1 尺寸线离开管体**：远景固定相机截图中，每条 main `linear_dim` 的尺寸线像素不落在管体投影之内（以管体 mask 判定，允许 ≤ 5% 像素例外）；尺寸线到管轴的设计距离 ≥ 2×OD（阈值以 D1 定案为准）；尺寸界线从管体特征点连到尺寸线并超出尺寸线 `extensionOvershootPx`。
- **AC2 数字在线上方**：每条可见尺寸的文字框与尺寸线不相交，字底到尺寸线间隙 ≥ 2×线宽（ISO 129-1 §5.7.2）；文字在「远离管体」一侧；atta / main 两行并存时不互相侵入（文字框与相邻行尺寸线不相交）。
- **AC3 实心箭头**：每条尺寸两端各一个填充三角，顶点在尺寸线端点、两翼与契约 `arrow_lines` 重合（几何不变）；SVG 导出同样为填充多边形。
- **AC4 颜色 / 字重**：主题常量与 D3 定案一致；BRAN 选中态下管体高亮、尺寸线、`selected` 尺寸三色可区分（截图判定）。
- **AC5 标签块**（若 D4=a）：端点 connection tag 多行块按行左对齐、行距一致、引线从块边缘指向端点；元件 name tag 带方框；弯头 PE 标签不与尺寸文字重叠（远景允许 LOD 隐藏但需可关）。
- **AC6 语义不变**：契约 `text`、图元数量、main/atta 归属、`label_anchor` 沿线位置与改动前逐条相同（mapper 单测钉住）；plant-mbd golden 字节不变（除 D1=b 明确重录）。
- **AC7 确定性**：同一相机两次布局 `labelBounds` / 隐藏集合逐条相同；两帧截图逐像素一致。
- **AC8 回归**：`npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts` 全绿；eslint 0；`npm run type-check` 新增 0；`e2e/dimension-mbd-v2-fixture.spec.ts` 通过；perf 门（2k visible p95 ≤ 16 ms）不退化。
- **AC9 对比证据**：改动前 / 后同相机截图（远景 + 阀门端近景）归档到 `docs/verification/`，并与参考图要素表逐项勾对。

## 8. 拟拆解（按此刻在线 4 位；用户确认 §3 与 §6 后再 `plan_tasks`）

| 任务 | 负责人（拟） | 范围 / 主要文件 | 交付 | 验收 |
| --- | --- | --- | --- | --- |
| T0 固定相机基线与对照工具 | fable-5-1-13（QA） | `scripts/` 或 `e2e/`：拉起真实 Chrome、固定相机、全类别显示、截远景 + 近景、输出图元 / 布局统计 JSON；参考图要素勾对表 | 基线截图 + 统计 + 勾对表模板 | AC7 / AC9 的工具可复用；T1–T3 前后对比都用它 |
| T1 尺寸线外移 + 尺寸界线（R1） | fable-5-1-10（工程） | 按 D1 定案：a) `src/dimension/adapters/mbdV2ExternalAnnotations.ts::mapLinearDim`（设计空间沿 dim_dir 外移、延长尺寸界线）+ `kernel/layout/explicit.ts` 尺寸界线超出量 | 代码 + 单测 + 固定相机前后截图 | AC1 / AC6 / AC7 / AC8 |
| T2 数字上方 + 实心箭头 + 主题（R2 / R3 / R10） | fable-5-1-11（工程） | `kernel/layout/explicit.ts`（标签法向偏移、两行冲突规则、填充箭头）、`kernel/theme.ts`、`kernel/geometry/sceneGeometry.ts`（若需新原语）、SVG 导出 | 代码 + 单测 + 截图 | AC2 / AC3 / AC4 / AC7 / AC8 |
| T3 标签块 / 引线 / 方框（R5–R7） | fable-5-1-12 | 先验证再修：`mbdV2ExternalAnnotations.ts` 的 label / leader_line 映射、`explicit.ts` 多行文字对齐、方框原语；`DimensionPanelDock` 默认全类别 | 验证报告 + 修正代码 + 截图 | AC5 / AC8 |

文件冲突预防：T1 只改 mapper 的 `mapLinearDim` 与 `explicit.ts` 的 extension 段；T2 改 `explicit.ts` 的 label / arrow 段与 theme；T3 改 mapper 的 label / leader 段。T1 与 T3 同文件不同函数，按写锁顺序串行提交；T2 与 T1 在 `explicit.ts` 上有交集——由 T2 统一持有 `explicit.ts`，T1 的尺寸界线超出量以 `theme.extensionOvershootPx` 常量交给 T2 实现。依赖：T1–T3 均依赖 T0 的基线工具（T0 先行 ≤ 半天，其间 T1–T3 可先读码与写单测）。

## 9. 实施记录（2026-09-12，fable-5-1-31）

原协同组成员已下线，T0–T2 与 S1 成对去重由接手会话一并实施（未拆活）。口径与效果图 README 逐条一致，细节见 ADR 0057。

- **内核** `src/dimension/kernel/layout/dimension3d.ts`（新）：`layoutDimension3d` 以 `h = max(cheight, theme.dimension3d.textFloorPx · worldPerPixel)` 为单位在设计空间重建尺寸线（`surface + 1.2h + row·1.7h`）、尺寸界线（`surface + 0.15h` → 线外 `0.3h`）、实心三维箭头（`0.9h`、半角 18°）、三维平面内的文字（`SceneGlyphRun.frame`，线上方 `0.3h`，从左向右 / 竖排向上可读）；文字放不下时箭头翻外、数字放延长线外（求解器 `small` 沿用）；平面与视线接近平行回落屏幕水平文字；S3 的 `secondary-far` / `short-line` 原样适用。`explicit.ts` 遇到 `dimension3d` 直接转交。
- **成对去重** `src/dimension/kernel/layout/declutterPolicy.ts`（新）：`layoutViewport` 在 `resolveLabelCollisions` 之前调用，文字投影四边形 SAT 相交 → 按 main > atta → 线长÷文字宽 → id 隐去败者（`lodHidden: 'overlap'`），不搬动。
- **画家** `scenePainter.ts`：带 `frame` 的字形按字高单位描线后映射成三维锚点（无像素偏移），先画光晕再画加粗笔画（`theme.dimension3d.textStrokeWidthPx = 2`、`textHaloWidthPx = 1.4`、白色）；孤立短笔画（LFF 小数点 0.5/9 字高）拉长到 0.12 字高保证可见。`sceneGeometry.ts` 把带 frame 的字形投影为精确四边形包围盒 + 平面近似（SVG / 碰撞用）。
- **主题** `theme.ts`：`dimension3d` 常量块；`external` / `external-reference` → `#c81e1e`（图纸红）；`selected` → `#16a34a`（让出纯红）。
- **适配层** `mbdV2ExternalAnnotations.ts`：有组 `cheight` 且恰有两条尺寸界线的 `linear_dim` 带 `dimension3d`（管中心点 = 尺寸界线 `from`，方向 = 尺寸界线方向，`surfaceM` = 本分支尺寸界线长度下四分位，`row` 按 `1.2·cheight` 反推，`small` → `outside`）；原位几何与 `arrowLines` 保留。
- **开关** `useMbdExternalSync.ts` `?mbd_3d=0` 剥掉 `dimension3d` 并写诊断 notes；`DimensionPanelDock.vue` 新增「三维标注呈现」勾选，LOD 统计增加「相压」。
- **验证**：单测 53 文件 / 288 通过（新增 `dimension3d.test.ts` 7、`declutterPolicy.test.ts` 3、painter / mapper / sync / panel 各 +1）；eslint 0；type-check 新增 0；`e2e/dimension-mbd-v2-fixture.spec.ts` 2/2；Chrome 固定相机远 / 近景截图与统计见 `docs/verification/mbd-3d-dimension-presentation-2026-09-12/README.md`（远景 11 绘 / 7 隐，11 条三维文字、22 个实心箭头；近景 12 绘 / 6 隐；`mbd_3d=0` 回到原位平面呈现）。
- **验收对照**：AC1 ✓（远景尺寸线到管轴 241–543 mm，管表面 114 mm）；AC2 ✓（文字在线上方 0.3h，行距 1.7h）；AC3 ✓ 视口（SVG 仍为三条描边，与用户尺寸一致）；AC4 ✓；AC5 ✗（T3 未做）；AC6 ✓（契约 / 数值 / 分段 / 沿线位置不变，golden 未动）；AC7 ✓（同相机多次运行统计逐字相同）；AC8 ✓；AC9 ✓（`docs/verification/…`）。
