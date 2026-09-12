---
status: accepted
---

# MBD 长度尺寸按三维标注呈现：沿求解器 dim_dir 以字高为单位离开管体，数字与箭头落在三维平面里

MBD V2 `linear_dim`（PML isoDraft 语义的 running dimension）在自由相机三维视口里默认按**三维标注**呈现，不再把求解器为单线轴测图排的原位几何（尺寸线离管轴一个 `od`、文字打断尺寸线、开放 V 形翼）直接投到屏幕。适配层给每条带两条尺寸界线的长度尺寸打 `ExplicitLayoutInput.dimension3d`：管中心线点 = 契约 `extension_lines[i].from`，外移方向 = 尺寸界线方向（即求解器 `dim_dir`，设计空间、与相机无关），管表面距离 = 本分支最短尺寸界线（下四分位，= 求解器最内行的 `od`），行号由尺寸界线长度按 `1.2·cheight` 反推。内核 `layoutDimension3d` 以字高 `h = max(cheight, theme.dimension3d.textFloorPx · worldPerPixel)` 为单位在**设计空间**重建整条尺寸：尺寸线到管轴 `surface + 1.2h + row·1.7h`，尺寸界线从管表面外 `0.15h` 起、超出尺寸线 `0.3h`（GB/T 4458.4 / ISO 129-1 图纸习惯），实心箭头是长 `0.9h`、半角 `arrowHalfAngleDeg` 的三维三角形，数字是躺在「包含尺寸线、绕它转到面向相机」那个平面里的 LFF 字形（`SceneGlyphRun.frame`，画家把字形笔画映射成三维锚点），基线从左向右可读、竖排向上可读（ISO 129-1 §4.1.1），置于线上方 `0.3h` 而非中断处（ISO 129-1 §5.7.2）；文字放不进两个箭头之间时箭头翻到外侧、数字放到延长线外（ISO §5.7.3 a，求解器 `small` 的口径直接沿用）；平面与视线接近平行时数字回落为屏幕水平文字（GB 方法 2）。三维文字加粗并带对比色光晕（`theme.dimension3d.textStrokeWidthPx / textHaloWidthPx / textHaloColor`），压在管体上也可读。

数值、分段、main/atta 行归属、文字沿线位置（线中点 / small 的端外）**全部保留**，改的只有离管体的距离与呈现形态；plant-mbd 求解器与六条 golden 一字不动，契约不加字段。分级显示（S3，ADR 见方案文档）规则原样适用；新增成对去重 `declutterOverlaps`（S1 的第一块）：两条三维尺寸的文字投影四边形相交时按 main > atta → 线长÷文字宽 → id 的确定顺序把败者整条隐去（`derived.lodHidden = 'overlap'`），不搬动、不补引线，同一相机两帧结果相同。调试开关 `?mbd_3d=0`（尺寸面板同名勾选）剥掉 `dimension3d`，内核回到求解器原位几何的平面呈现，作 A/B 对照与回退。

这条对既有口径的两处例外要点明：（1）ADR 0056「箭头笔画以来源几何 1:1 呈现」——尺寸线已经不在契约 `arrow_lines` 所附着的位置上，翼无法跟随，三维呈现改为在文字平面内重建实心三角；契约笔画仍进 `arrowLines`，平面呈现（`mbd_3d=0`）继续 1:1 画它。（2）方案文档 §4.3「不在 Web 端按视向平移尺寸线」——本条不按视向、只沿求解器自己的 `dim_dir` 外移，方向确定、与相机无关；随相机变的只有 `h` 的屏幕下限那一项（与 S2 字高钳制同一性质），近景 `h = cheight` 时整套几何完全由契约决定。

被否决的替代：改 plant-mbd 行位公式 / 新增 lane（跨仓、重录 golden、且单线轴测图的行位本来就是对的）；契约 consumer-first 新增 `meta.dim_offset`（最正统但要等生产者，而呈现层已掌握全部输入）；屏幕空间文字沿投影线排布并向外侧偏移（用户明确要求「三维尺寸标注，不是投影」；屏幕文字在相邻行 1.2·cheight 间距下必然侵入下一行）；固定 `k·OD` 外移（远景字高被钳到 13 px 时 32 mm 的行距只剩几像素，行与行仍相压）。

依据：用户 2026-09-12 13:30 参考图与 13:47 / 14:02「要更美观的三维尺寸标注效果图，不是投影」；效果图与规则 `docs/design/mbd-annotation-mockup-2026-09-12/README.md`；PRD `docs/plans/2026-09-12-mbd-annotation-reference-style-prd.md`（D1–D4 按效果图取 a）；标准条款核实 `docs/plans/2026-09-12-mbd-dimension-engineering-convention-review.md` §1；协同决策 d-438（架构分层不变）。落地：`kernel/layout/dimension3d.ts`、`kernel/layout/declutterPolicy.ts`、`viewport/scenePainter.ts`（framed glyph）、`adapters/mbdV2ExternalAnnotations.ts`（`dimension3d`）、`useMbdExternalSync.ts`（`mbd_3d`）。
