# PRD · 三维 MBD 管道标注对齐参考图效果

日期：2026-09-12  
作者：协同组「标注」指挥官 / 产品经理（fable-5-1-17）；实施 fable-5-1-31（T1 / T2 / S1）、T3 收尾 fable-5-1-95  
状态：**T1 / T2 + S1 成对去重已于 2026-09-12 落地**（ADR 0057；D1–D4 按效果图取 a，用户「继续未完的部分，不必重问」授权）；T0 以 `%TEMP%` 脚本 + `docs/verification/mbd-3d-dimension-presentation-2026-09-12/` 归档代替；**T3（标签块 / 引线 / 方框）同日落地**（ADR 0058，§9.2）；**标签体避让管件包围盒与三维尺寸线 2026-09-13 落地**（ADR 0059，§9.3）；**SVG 导出对齐视口（AC3 的 SVG 半边）2026-09-13 补齐**（§9.4）；**inspection 显示模式（用户路径第 5 步 / S4）2026-09-13 落地**（ADR 0061，§9.5）。实施与验证记录见 §9。  
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

## 9. 实施记录（2026-09-12）

### 9.1 T0–T2 + S1（fable-5-1-31）

原协同组成员已下线，T0–T2 与 S1 成对去重由接手会话一并实施（未拆活）。口径与效果图 README 逐条一致，细节见 ADR 0057。

- **内核** `src/dimension/kernel/layout/dimension3d.ts`（新）：`layoutDimension3d` 以 `h = max(cheight, theme.dimension3d.textFloorPx · worldPerPixel)` 为单位在设计空间重建尺寸线（`surface + 1.2h + row·1.7h`）、尺寸界线（`surface + 0.15h` → 线外 `0.3h`）、实心三维箭头（`0.9h`、半角 18°）、三维平面内的文字（`SceneGlyphRun.frame`，线上方 `0.3h`，从左向右 / 竖排向上可读）；文字放不下时箭头翻外、数字放延长线外（求解器 `small` 沿用）；平面与视线接近平行回落屏幕水平文字；S3 的 `secondary-far` / `short-line` 原样适用。`explicit.ts` 遇到 `dimension3d` 直接转交。
- **成对去重** `src/dimension/kernel/layout/declutterPolicy.ts`（新）：`layoutViewport` 在 `resolveLabelCollisions` 之前调用，文字投影四边形 SAT 相交 → 按 main > atta → 线长÷文字宽 → id 隐去败者（`lodHidden: 'overlap'`），不搬动。
- **画家** `scenePainter.ts`：带 `frame` 的字形按字高单位描线后映射成三维锚点（无像素偏移），先画光晕再画加粗笔画（`theme.dimension3d.textStrokeWidthPx = 2`、`textHaloWidthPx = 1.4`、白色）；孤立短笔画（LFF 小数点 0.5/9 字高）拉长到 0.12 字高保证可见。`sceneGeometry.ts` 把带 frame 的字形投影为精确四边形包围盒 + 平面近似（SVG / 碰撞用）。
- **主题** `theme.ts`：`dimension3d` 常量块；`external` / `external-reference` → `#c81e1e`（图纸红）；`selected` → `#16a34a`（让出纯红）。
- **适配层** `mbdV2ExternalAnnotations.ts`：有组 `cheight` 且恰有两条尺寸界线的 `linear_dim` 带 `dimension3d`（管中心点 = 尺寸界线 `from`，方向 = 尺寸界线方向，`surfaceM` = 本分支尺寸界线长度下四分位，`row` 按 `1.2·cheight` 反推，`small` → `outside`）；原位几何与 `arrowLines` 保留。
- **开关** `useMbdExternalSync.ts` `?mbd_3d=0` 剥掉 `dimension3d` 并写诊断 notes；`DimensionPanelDock.vue` 新增「三维标注呈现」勾选，LOD 统计增加「相压」。
- **验证**：单测 53 文件 / 288 通过（新增 `dimension3d.test.ts` 7、`declutterPolicy.test.ts` 3、painter / mapper / sync / panel 各 +1）；eslint 0；type-check 新增 0；`e2e/dimension-mbd-v2-fixture.spec.ts` 2/2；Chrome 固定相机远 / 近景截图与统计见 `docs/verification/mbd-3d-dimension-presentation-2026-09-12/README.md`（远景 11 绘 / 7 隐，11 条三维文字、22 个实心箭头；近景 12 绘 / 6 隐；`mbd_3d=0` 回到原位平面呈现）。
- **验收对照**：AC1 ✓（远景尺寸线到管轴 241–543 mm，管表面 114 mm）；AC2 ✓（文字在线上方 0.3h，行距 1.7h）；AC3 ✓ 视口（SVG 当日仍为三条描边，2026-09-13 补齐为填充多边形，见 §9.4）；AC4 ✓；AC5 ✗（T3 未做，见 9.2）；AC6 ✓（契约 / 数值 / 分段 / 沿线位置不变，golden 未动）；AC7 ✓（同相机多次运行统计逐字相同）；AC8 ✓；AC9 ✓（`docs/verification/…`）。

### 9.2 T3 标签块 / 引线 / 方框（代码为交接前遗留的未提交工作树，fable-5-1-95 复核、实机验证、补文档并提交）

口径与效果图 README 规则 6 一致，细节见 ADR 0058。

- **内核** `src/dimension/kernel/layout/tagBillboard.ts`（新）：`planTagBillboard` 按文字行数用 `theme.tag`（卡片 / 方框 11 px、药丸 10 px、行距 1.5、内边距 7 / 4 px）算出屏幕定尺的标签体，锚在三维点上（引线目标或求解器标签位置），首选方向 = 管外 `away` 方向（没有则取求解器引线方向）叠加向上偏置，standoff = 常量 + 0.35·max(宽, 高)；给出一圈候选位（0 / ±30° / ±60° / ±90° / ±135° / 180°，再 ×1.6 standoff），整块在屏内的排前面。`materialize` 生成 `scene-fill` 体 + 边框 / 方框描边 + 引线（到最近的体边）+ 圆点 + 逐行左对齐字形，全部挂在同一个三维锚点上带屏幕偏移，相机动时整块刚性跟随。`placeTagBillboards`（`layoutViewport` 在成对去重之后、移动式避让之前调用）把其它可见标签当障碍，按卡片 → 方框 → 药丸、同类按 id 依次取第一个不相压的候选位，全部被占回首选位；同一视图结果确定。
- **类型 / 主题** `types.ts`：`ExplicitTagInput`（style / lines / target / away / dot）、`SceneFill`（三角扇填充，投影成一条闭合 path 保持场景↔投影图元 1:1）、`SceneTone`（`tag-fill / tag-text / tag-muted-text / tag-border / tag-frame / tag-leader`）、LOD 新增 `detail` 级与 `detail-far` 原因、`derived.tag`。`theme.ts`：`tag` 常量块、`resolveTagToneColor`（hovered / selected 仍用角色高亮色）、`resolveTagToneStrokeWidth`。
- **画家** `scenePainter.ts`：第三个绘制对象 `dimension-scene-fills`（`renderOrder − 1`，画在所有描边之下），tone 决定颜色 / 线宽，`fillVertexCount` 进统计与局部重着色校验。`sceneGeometry.ts`：`sceneFill`、tone 透传。`svgOverlay.ts`：tone 走标签调色板，`tag-fill` 输出 `fill` 而非描边。
- **适配层** `mbdV2ExternalAnnotations.ts`：`pairLeaders` 把每条 `leader_line` 配进它的 `label`（`<label id>:leader` 命名优先，再按引线起点 = 标签位置，每条只用一次），配对后的引线不再单独成记录（77 → 63 条）；`classifyTag` 按 plant-mbd 的 id 约定分类（`:tag:connection:` 卡片 + 圆点、`:tag:name:` 方框、`:tag:elbo:` 药丸 `secondary` 且只有 `PE` 行是中景行、`:tag:branch-name` 药丸 `detail`），其它生产者按文字（`X / Y / PE` 行 = 卡片，否则方框）；`awayFromPipe` 只在该点恰有一条尺寸的尺寸界线扎根时给出管外方向；坡度标记与 skew 辅助线 / 文字打 `detail`。
- **开关 / 面板** `useMbdExternalSync.ts`：`mbd_3d=0` 同时剥掉 `tag`，notes 文案补「标签按原位文字出图」；`DimensionPanelDock.vue`：LOD 统计增加「细节」计数，开关文案补「标签卡片带引线」。
- **验证**（本会话实跑）：单测 54 文件 / 299 通过（`tagBillboard.test.ts` 7、mapper +3、painter +1、面板 +1、facade 绘制对象 2 → 3）；eslint 16 个相关文件 0；`npm run type-check` 基线外唯一新增为他人未提交的 `src/measurement/kernel/pickDerivation.test.ts`；`e2e/dimension-mbd-v2-fixture.spec.ts` 2/2；真实 Chrome 全类别固定相机三视角统计与截图见 `docs/verification/mbd-3d-dimension-presentation-2026-09-12/README.md`「标签 billboard」段（远景 4 标签绘 / 10 隐、0 相压；中景 1 处换位；近景药丸与细节辅助出现；重复运行逐字相同）。
- **验收对照**：AC5 ✓（connection tag 多行左对齐、行距一致、引线从体边指向管端并带圆点；name tag 黑框方框；弯头 PE 药丸远景按 LOD 隐藏、`mbd_lod=0` 可关，显示时与尺寸数字不相压——实测三视角标签↔尺寸数字相压 0）；AC6 / AC7 / AC8 保持 ✓（契约与 golden 未动；重复统计逐字相同；回归全绿）。**未覆盖**：标签体不避让管件几何与三维尺寸线本身（→ §9.3 已补）；分支名药丸在本样本未到显示阈值。

### 9.3 标签体避让管件包围盒、三维尺寸线与坐标 gizmo（用户 2026-09-12 23:21「近景尾端卡片不再压在阀体上」、09-13「把坐标 gizmo 覆盖层也交给内核当障碍」；代码为交接链上遗留的工作树，2026-09-13 复核、补候选圈与不出屏规则、实机验证并提交）

细节见 ADR 0059。

- **宿主缝** `facade/createDimensionSystem.ts`：`DimensionViewerAdapter.queryLayoutObstacles?(region: DesignBox): LayoutObstacle[]` 与 `getLayoutOverlays?(): ScreenRect[]`（都可选；都没有就只让开数字 / 标签 / 描边）。`adapters/dtxDimensionViewerAdapter.ts` 用 `getDtxLayer` 实现前者：设计空间区域 → 场景世界盒 → `DTXLayer.collectObjectBoundsIntersecting(worldBox, { visibleOnly: true })`（新，局部毫米 AABB 一次相交测试、只回可见对象）→ 每个盒子 8 角点经「毫米→场景」「设计→场景」同一对矩阵回到设计空间；用 `getOverlayElements` 实现后者：DOM 元素的客户端矩形按容器左上重定原点。`DtxViewer` 给 ViewportGizmo 命中区挂 `dtx-viewport-gizmo` 类、`getGizmoElement()` 交出；`ViewerPanel.vue` 接 `getDtxLayer` 与 `getOverlayElements`（坐标 gizmo）。
- **内核** `kernel/geometry/obstacleGeometry.ts`（新：凸包、多边形面积、矩形裁剪、矩形∩凸多边形面积、线段在矩形内长度）；`kernel/layout/tagBillboard.ts`：`tagObstacleRegion`（候选包络反投到锚点深度 ± 包络对角线）、`projectObstacleOutline`（8 角点投影凸包，相机后 / 远平面外丢弃）、`dimensionStrokes`（其它布局的 line / path 段）、`collectTagObstacles`；`placeTagBillboards` 先取零侵入的候选位，没有则取加权侵入面积最小者（数字 / 已放标签 / 视口覆盖层 4、描边 4 px 带 2、构件凸包 1 / px²，1e-6 px² 内先到者赢）；候选位扩为四圈（standoff × 1 / 1.6 / 2.4 / 3.4），有整块在屏内的候选位时只在其中挑（不为躲障碍出屏）。`layoutViewport.ts` / `dimensionViewport.ts` 透传 `obstacles`。
- **验证**（本会话实跑）：单测 56 文件 / 317 通过（`obstacleGeometry.test.ts`、`tagBillboard.test.ts` 14、`dtxDimensionViewerAdapter.test.ts` 2、facade +1）；eslint 0；type-check 本改动新增 0；e2e fixture 2/2；真实 Chrome 三视角统计与截图见 `docs/verification/mbd-3d-dimension-presentation-2026-09-12/README.md`「标签避让管件包围盒、尺寸描边与视口覆盖层」段——中景尾端卡片与位号从阀体上换到手轮上方 / 阀体右侧（与构件凸包重叠 0），近景两者离开阀体本体（阀门凸包盖住右半画布，取最少侵入位），远景位号方框让开右上角 gizmo 落到画布顶部中央，三视角标签体内描边 0、标签↔数字 / 标签↔标签 / 标签↔gizmo 0，重复运行与宿主帧循环结果逐字相同。
- **验收对照**：AC5 补齐「不压管件几何、不压坐标 gizmo」；AC6 / AC7 / AC8 保持 ✓。**未覆盖**：障碍是包围盒凸包而非网格轮廓（透视近景凸包大于本体）；引线不避让构件与覆盖层。

### 9.4 SVG 导出对齐视口（2026-09-13，fable-5-1-41；接手 fable-5-1-17 交接记录后按「继续未完的部分」补 AC3 的 SVG 半边）

- **投影快照** `kernel/geometry/sceneGeometry.ts`：带 `frame` 的三维文字投影时多带 `perspective`（文字平面 `(0,0) (1,0) (1,1) (0,1)` 字高单位四点的屏幕像）；`kernel/types.ts` `ScreenGlyphRun.perspective?`。透视相机把平面映到屏幕是单应，`kernel/geometry/homography.ts`（新，Heckbert 单位正方形 → 四边形，平行四边形退化为仿射）让导出无需相机即可精确复现透视文字。
- **共用字形** `kernel/glyph/glyphTrace.ts::traceFramedGlyphRun`（从 `scenePainter.ts` 搬入内核）：画家与 SVG 用同一批单位笔画（含小数点拉长到 0.12 字高）。
- **导出** `export/svgOverlay.ts`：按场景图元 ↔ 投影图元的对应（`scene-triangle` ↔ 三条边，其余 1:1）走一遍，实心箭头输出闭合填充 `<path>`（契约 `arrow_lines` 的开放 V 翼仍为描边），三维文字先光晕后 2 px 粗体笔画（`data-text-plane="3d"`），不再用平面旋转近似；对不上或无场景图元时退回逐条序列化。
- **验证**：单测 58 文件 / 329 通过（`homography.test.ts` 4、`glyphTrace.test.ts` 3、`svgOverlay.test.ts` +4：填充箭头 / 开放翼保持描边 / 单应文字 + 光晕 / 透视缩短）；eslint 0；type-check 本改动新增 0；e2e fixture 2/2；真实 Chrome 无后端链路（gen-model 本轮未运行）注入 `pipe-iso-sample.json` + `cheight_mm=60`：5 条 `dimension3d` → SVG `filledArrows=10 / text3d=5 / halos=5 / rotated=0`，栅格化与视口对照见验证 README「SVG 导出对齐视口」段（`svg-export-*.png` / `.svg`）。
- **验收对照**：AC3 ✓（视口 + SVG 均为填充多边形）；AC6 / AC7 / AC8 保持 ✓（布局与画家几何未变，goldens 未动）。**未覆盖**：SVG 里被遮挡 / 深度关系仍与视口一样穿透显示（→ §9.5 inspection 只作用于视口画家，SVG 导出不带 α）。

### 9.5 inspection 显示模式（2026-09-13，fable-5-1-41；用户路径 §5 第 5 步「切换 engineering / inspection，被遮挡尺寸淡化（S4）」）

用户 2026-09-13 21:1x 拍板：默认 engineering 不变，inspection 下被遮挡尺寸 α 0.35 / 可见 0.65，对 label_anchor 做相机射线求交，入口放尺寸面板。细节见 ADR 0061。

- **内核** `kernel/layout/occlusionPolicy.ts`（新）：完整布局后对每条画出的记录取探测点（尺寸：第一条字形的三维锚点；标签 billboard：也探锚点，但把它点名的构件 `derived.tag.subject`——`classifyTag` 从 id 的 `tag:elbo|name|connection:<refno>` 读出、经 `ExplicitTagInput.subject` 随布局落地——作为 `hints.subject` 交给宿主，宿主跳过该构件自己的 piece 与包着锚点的体；`connection:Head` / `Tail` / `branch-name` 点不出构件，当时退回探卡片屏幕中心在锚点深度上的点（2026-09-14 改为同样探锚点、只带 `onModel` 去掉包着锚点的体，见 §9.8）。锚点在被点名的构件体内，裸探锚点会让卡片从任何方向都淡，实机第一轮已撞上；一律探卡片则标签几乎不淡，用户 2026-09-13 22:15 拍板「被点名构件本身被挡才淡」），从其像素的近平面点向探测点发一条线段问宿主 `OcclusionSource.isSegmentBlocked(from, to, ε, hints?)`，ε = max(0.5 mm, 2 px·worldPerPixel)，结果写 `derived.occluded`；`layoutViewport` options 多 `occlusion` / `displayMode`，只在 inspection 下跑。
- **画家 / 视口** `scenePainter.ts`：逐顶点 `batchAlpha`（描边 / 实心箭头 / 标签填充），`layoutAlpha` 按模式取 1 / 0.65 / 0.35，材质 `transparent` 只在 inspection 下打开；`dimensionViewport.ts` `setDisplayMode` / `getDisplayMode`（dirty reason `display-mode`）。
- **宿主缝** `DimensionViewerAdapter.isSegmentBlocked?(from, to, ε, hints?)`；DTX 适配器用 `collectObjectBoundsIntersecting` 筛候选、`raycastObject` 逐三角求交（真实网格）；带 `hints.subject` 时跳过 `o:<refno>:<n>` 里 refno 相同的 piece（`refnoOfDtxObject`），并对每个够近的命中从锚点前 ε 处再向前发一条射线、穿得出去的是包着锚点的体，也跳过。
- **面板** `DimensionPanelDock.vue`：「显示模式」单选（Engineering / Inspection），URL `mbd_mode=inspection`，直接调 viewport、不派发 `popstate`；检视模式下显示「被遮挡 N 条 / 可见 M 条」。
- **验证**：单测 59 文件 / 338 通过；eslint 0；type-check 本改动新增 0；e2e fixture 2/2；真实 Chrome 无后端链路把 demo 立方体放大挡在相机与 `2084` 之间：inspection 只有 `2084` 淡到 0.35、其余 0.65，对面看回 0.65，切回 engineering 复原，切换不重拉 payload（验证 README「inspection 显示模式」段，`inspection-*.png`）。
- **实机对照（同日补，三轮）**：BRAN 24381_145018 + live gen-model `:18122`，三个相机：正面淡 `900.51`、背面淡 `1834.19` 与阀门位号 `Copy-of-1RCS002VP`（阀门原点被直管 `o:24381_145018:5` 挡住）、阀门簇中景淡 `900.51` / `173`（尺寸都是数值文字在管子另一侧的三维尺寸），再布局逐条相同，inspection 完整布局 3–5 ms。标签取法：裸探锚点误标（第一轮）→ 一律探卡片一张不淡（第二轮 `9de9e60`）→ 探锚点但排除被点名构件（第三轮，现口径），独立射线复核 6/6 与内核一致；ELBO 近景补验 9 弯头 × 14 方向 124 个视图，自己的 piece 挡在锚点前的 46 个里 26 个亮 / 20 个被别的 piece 挡住而淡，独立复核 124/124 一致（验证 README「实机对照」小节，`inspection-real-*.png`、`inspection-real-b-probe.json`、`inspection-real-elbo-probe.json`）。单测 59 文件 / 343 通过。
- **未覆盖**：2k 记录的分帧预算；SVG 导出不带 α（导出仍是工程图样）；「包着锚点的体」用「锚点前 ε 处向前再发一条射线能穿出」判定，凹体（弯头、绕回来的管段）在锚点前后各穿一次时会被当成包着锚点而不算遮挡，本样本没有这种相机。

### 9.6 文字绘制：胶囊 SDF 解析抗锯齿 + 圆头接头 + 深度去重（2026-09-14，fable-5-1-54；用户「把文字的绘制改得更清晰」，拍板 A + B）

- **画家** `viewport/scenePainter.ts`（ADR 0062）：每段描边四边形向四周多伸 w/2 + 1 设备像素，片元按胶囊距离算覆盖率、羽化 1 设备像素（`uFeatherPx = 1 / dpr`，`dimensionViewport` 把 `projector.dpr` 传给 `resize`）——LFF 折线接头因此圆润无缺口，边缘平滑且不依赖 MSAA（选中构件走 OutlinePass 时整帧在 `gl.SAMPLES = 0` 的 render target 里，此前文字全是硬边）。实心（覆盖率 ≥ 0.999）与羽化两遍共享几何：`dimension-scene-lines` / `dimension-scene-line-edges`，都用 `gl_FragDepth` 写近平面常量深度（描边 1e-5、三维文字白边 2e-5）并以 LESS 测试，对模型恒通过、对自身只画第一次——inspection 的 α < 1 不再在接头叠成深色斑点。
- **主题** `kernel/theme.ts`：`textStrokeWidthPx` 1.5 → 1.8，`tag.pillTextHeightPx` 10 → 11。
- **验证**：单测 59 文件 / 344 通过（painter +1，四个绘制对象）；eslint 0；type-check 本改动 0；实机同位置 3× 放大前后对照（卡片 / 三维数字 / 药丸 / inspection 淡化）见验证 README「文字绘制」小节，`text-aa-before-*.png` / `text-aa-after-*.png`。
- **顺带核出**：inspection 的 α 0.65 在线性空间混合 + ACES 后视觉上接近 α 0.2（旧画家亦然）→ 同日用户拍板重定为 0.92 / 0.80（实机扫值反查，文字上呈现约 63 % / 36 % 的对比；ADR 0061「α 重定」段，验证 README「inspection α 重定」小节，决策 d-386 取代 d-354）。

### 9.7 全管道扫描（2026-09-14，fable-5-1-54 起、61 接手；用户「继续测试其他管道的三维尺寸标注，把所有的管道都测一遍」）

- **范围**：遍历项目树得 2693 个 BRAN，2469 个有 MBD payload（224 个 422 是后端按契约拒绝的非路由容器 / 无几何成员）。**内核全跑**（Node，临时 vitest 用例，跑完删除）：每条 payload 解析 → 映射 → 布局（far 1.7× / mid 0.6× / close 0.25× 三距离 × engineering / inspection × 再布局）→ SVG；**实机抽样** 52 条（真实 Chrome，far / behind 两相机 × 两模式，截图 + pageerror）。读数与文件见验证 README「全管道扫描」段（`all-pipes-*.json/png`）。
- **结果**：far 2469 / 2469 全过（非有限数 0、SVG NaN 0、再布局逐条相同、屏内标签命中 26 070 / 26 070；解析诊断 0、原子拒绝 0；payload 3901 条 issue 全是后端 warning）；实机 52 条两模式 α / 确定性 / 复原全对，inspection 完整布局最大 37 ms（407 条记录）。
- **撞出两件待拍板**：① `buildHitIndex` 与 `resolveLabelCollisions` 的 64 px 网格不裁视口——close 435 / 2469（17.6 %）、mid 33 条会爆格子（真机 = `RangeError` / 卡死 / OOM），且**每条管加载期**记录先于几何到达、在默认相机下布局的那一帧也会撞（实机 3 / 52 条 pageerror，一条拖了 30 s 一条尺寸都画不出）；② `weld_mark` 的探测点在管轴焊点上，inspection 下 27/27 判遮挡（抽样遮挡 flag 的 73 % 是焊缝标记，项目 334 个 BRAN / 1238 个焊缝标记受影响）。两项当时记在 ADR 0061「已知边界」与验证 README，未改代码——见 §9.8。

### 9.8 全管道扫描撞出的两件事修掉（2026-09-14，fable-5-1-69；用户交接「继续未完的部分，不必重问」）

- **两张 64 px 网格裁视口**（ADR 0040 早已要求「视口裁剪、有界碰撞」）：`buildHitIndex(layouts, cellSizePx, bounds?)` / `resolveLabelCollisions(inputs, bounds?)` 的格子范围先与「视口外扩一格」相交，`layoutViewport` 传入 `projector` 的视口；屏外区域不登记（命中索引只答屏内点），屏外标签不占位不被搬，非有限坐标得空范围。不在上游剔除相机背后的记录（近景时同一条记录一半在背后一半在屏上）。
- **焊缝标记与标签同一遮挡口径**：`…:weld:mark:<refno>` 的 `<refno>` 是 E3D WELD 构件（gen-model 画成管外径短圆盘），`weldSubject` 读成新增的 `ExplicitLayoutInput.subject` → `derived.subject` → `occlusionProbe` 探锚点并交给宿主缝；WELD 自己的 piece 与包着焊点的直管 / 管件不算遮挡，只有别的几何挡在前面才淡（ADR 0061「焊缝标记」段）。
- **验证**：单测 59 文件 / 351 通过（+7）；内核全跑 **2469 / 2469 × far / mid / close 全过**（0 flag，96 s；上轮超限的 33 mid / 435 close 视图不裁时要 1e6–3.3e12 格，裁后网格 ≤ 1.7 ms，屏内标签命中 25 969 / 15 106 / 8646 全中）；实机 3 条加载期 `RangeError` **3 → 0**；`24381_146979` 焊缝标记遮挡 **27 → 4**，与独立射线逐条一致，剩 4 个都是别的焊缝盘 / 直管 / 套筒挡在焊点前；参照管 `24381_145018` 三相机标签与尺寸 flag 逐条不变。用户认可 d-402 后 52 条实机抽样 inspection 重跑：遮挡 flag far 95 → 36（焊缝 69 → 8）、behind 91 → 30（焊缝 71 → 8），78 个焊缝标记 10 % 判遮挡且挡体都在焊点前 15–33 cm，其它记录的遮挡集合与上轮逐条相同（两条例外是上轮自己在默认相机 / 少装一个对象的状态下抓的），pageerror 0。读数与文件见验证 README「修复复验」小节。
- **端点卡片换探测点 + `subject` 放宽（同日，用户「给无 subject 的卡片换探测点」）**：无 refno 的 tag（`connection:Head` / `Tail`、`branch-name`）不再探卡片中心，改探锚点并带 `OcclusionProbeHints.onModel`（宿主只排除包着锚点的体）；`tagSubject` 对 plant-mbd 所有 `…:tag:<kind>:<refno>` 读 refno（`bend` / `atta` / `elevation` / `tee` 此前没有 subject）。两条小管 Tail 卡片两相机 1 → 0 淡；参照管三相机不变；52 条抽样 far 遮挡 flag 36 → 69（tag 7 → 40：bend 14 / atta 8 / Head–Tail 7 / elevation 5 / tee 1 是此前「探卡片几乎永远不淡」的几类按口径转淡）、behind 30 → 37，4 条管全部 tag 独立射线复核逐条一致、挡体都是别的构件（45 mm–3.6 m）。ADR 0061 标签段改写；决策 d-417 取代 d-386。
- **仍留**：药丸云观感；`bend` 卡片按文字分成 `card`（无 LOD、远景也画），与 `elbo` 药丸不是一档，呈现分类的事（→ §9.9 已归成同一档）。

### 9.9 `bend` 与 `elbo` 归成同一档呈现（2026-09-14，fable-5-1-7；用户「回三维标注把 bend 卡片与 elbo 药丸归成同一档呈现」）

- **分类**：`classifyTag` 给 `…:tag:bend:<refno>` 与 `…:tag:elbo:<refno>` 同一个类 `ELBOW_TAG`——无边框药丸、不带圆点、`secondary` LOD、只有 `PE` 行是主行（角度、弯曲半径都是近景 `detail` 行）。此前 `bend` 没有分支，落到「按文字」规则，`PE` 行被当成坐标块 → 卡片 + 圆点、无 LOD、任何距离都画。改代码前先量了规模：全项目 plant-mbd tag 里 **bend 5185 个、elbo 1637 个**（3.2 倍），1227 / 2469 条管带 bend，远景「卡片云」大半是它们。
- **药丸几何**：两行以上的药丸首末行的字帽角会落在半圆端外（三行 6 px 出头），`planTagBillboard` 的药丸左右内边距改取「半圆在首行字帽线处的内缩」与 `pillPaddingPx` 的较大者（`pillEndInsetPx`）；一行不变，两行 +1.3 px / 边，三行 +6.3 px / 边。
- **验证**：单测 59 文件 / 354 通过（+1：三行药丸几何；分类用例加 bend，四类 refno 用例 bend `card` → `pill`）；eslint 0；type-check 改动文件 0 新增。内核全跑 2469 条 × far / mid / close 改前 / 改后各一趟（0 flag）：far 画出的 tag **15 737 → 10 803**（−31 %）、文字行 38 898 → 23 824（−39 %），bend 画出 5185 → 251 / 926 / 2315（far / mid / close），elbo 与其它 6 类逐类逐数相同。实机三条弯管多的管（dbnum 7999）五个相机改前 / 改后同相机对照：far 画出的 tag 49 → 30 / 25 → 12 / 23 → 10，bend 全部 `secondary-far`；弯管前 1 m 处一颗 `PE` 药丸（与同距离弯头药丸同样式）、0.45 m 处三行药丸，首末行留在半圆内；inspection 遮挡 flag 随之 far 7 → 1 / 1 → 0 / 6 → 2；pageerror 0；atta / connection / branch-name / elbo 各视图逐条与改前相同。读数与图见验证 README「`bend` 与 `elbo` 归成同一档呈现」。ADR 0058 分类句与效果图 README 规则 6 同步。决策 **d-490**。
- **仍留**：`elevation`（821）/ `tee`（155）两类单行 `PE` 标高 tag 仍按文字规则落成卡片 + 圆点、无 LOD，是否也归进药丸档另拍；「药丸云」观感（弯头 / 弯管药丸只在 ~1 m 内出现）。
