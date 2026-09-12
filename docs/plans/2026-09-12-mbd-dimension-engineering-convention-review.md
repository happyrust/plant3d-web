# 三维 MBD 管道尺寸标注 · 工程标注习惯对照评估（Oracle GPT-6 两轮 + 本仓核对）

日期：2026-09-12  
状态：评估结论，待用户拍板；未改业务代码  
前置：`docs/plans/2026-09-12-mbd-linear-dim-visual-optimization-plan.md`（QW1–QW3 / S2 / S3 已落地，commit `597034f`）  
评估对象：BRAN `24381_145018` 的 18 条 `linear_dim` 在自由相机三维视口里的当前效果（固定相机远景 / 近景截图，见 `%TEMP%\plant3d-mbd-debug\s3-panel-viewer-on.png`、`s3-k12-near.png`）

## 0. 证据来源与可信度

| 轮次 | Oracle 会话 | 附件 | 模型证据 | 打折说明 |
| --- | --- | --- | --- | --- |
| 1 | `mbd-dim-engineerin-convention` | brief + 5 张截图 + wire JSON + `explicit.ts` / `theme.ts` / `mbdV2ExternalAnnotations.ts` / `scenePainter.ts` / `isodim.rs` + 方案文档（约 77.7k token） | `requested=gpt-6 → resolvedLabel=Latest, thinking=Pro, verified=yes` | **46 s、输出约 1.9k token**；结构完整但多为「保持现状、交给 S1/S4」，标准条款全部标「待核」 |
| 2 | `mbd-dim-convention-round2` | 第一轮摘要 + 三题追问 brief + 新增事实（`label_anchor` 在线上、`extension_lines` 即 `dim_dir`、行距 1.2·cheight、逐条线长÷标签宽） | 同上 | **41 s、输出约 1.8k token**；给出了可实现的规则与阈值，标准条款仍多「待核」 |

因此：**标准条款以本文 §1 的独立核实为准**（GB/T 4458.4-2003 原文、ISO 129-1:2018 §4.1.1 / §5.7.2 / §5.7.3 预览版原文）；Oracle 的规则建议只采纳能对照本仓源码与样本数据成立的部分，修正处在 §3 逐条标出。

## 1. 标准依据（已核实 / 待核）

| 规则 | 出处（已核实原文） | 对自由相机三维视口的适用判断 |
| --- | --- | --- |
| 线性尺寸数字**一般注写在尺寸线上方，也允许注写在尺寸线的中断处** | GB/T 4458.4-2003 §4.3.1（图 17） | 「中断处」在国标里是**允许**的注法，不是违规；「上方」是默认 |
| 数字方向：方法 1 沿尺寸线方向、尽量避开图示 30° 范围；方法 2 非水平尺寸的数字可水平注写在**中断处**；一张图样尽量统一一种 | GB/T 4458.4-2003 §4.3.2（图 18–21） | 当前「沿线 + 翻到可读半圈」= 方法 1；edge-on 时回落屏幕水平 = 方法 2；两者混用在三维里不可避免，但应有确定性切换判据 |
| 尺寸数字**不可被任何图线通过**，否则应将该图线断开 | GB/T 4458.4-2003 §4.3（图 23；条款号按手册转载，**待核原文**） | 当前用文字框打断尺寸线（`explicit.ts::labelClearance`）满足此条 |
| 尺寸值应**与尺寸线平行、置于尺寸线上方且靠近中点**，字底与尺寸线间距 ≥ 2× 线宽；不得被任何线穿过，不可避免时**断开尺寸界线而不是尺寸线** | ISO 129-1:2018 §5.7.2（Annex A） | ISO 明确偏向「上方」而非「中断」；这是当前效果与 ISO 的**唯一实质偏离** |
| 所有尺寸 / 符号 / 注释文字**在尺寸线上方、从图纸底部可读**；竖排从右侧可读；朝向按文字中心判定 | ISO 129-1:2018 §4.1.1 | `engineeringTextRotation` 的「可读半圈」对应此条；三维里以屏幕为「图纸」 |
| 空间不足时数值可放在尺寸线**延长线上方（终端外侧）**，或经引线放到参考线上 | ISO 129-1:2018 §5.7.3 a) b) | 求解器 `sub_kind=small` 把文字外置到 `dimension_end + (0.96 + 0.48)·cheight`，正是 a) 的写法 |
| 尺寸值只表示一次；小数分隔符用逗号（ISO） | ISO 129-1:2018 §4.1.1 | 逗号不适用（国内工程习惯用点，E3D 输出也是点）；「只表示一次」由求解器保证（每 isoline 一条 running dimension） |
| 三维图样中线性尺寸数字**字头应向上** | GB/T 4458.4 新版征求意见稿 §4.2.3（团体标准平台预览，**待核正式版本号**） | 直接支持当前「翻到可读半圈」的做法 |
| ASME Y14.5-2018 unidirectional：数值水平、置于尺寸线中断处 | 条款号**待核** | 当前「中断」效果最接近 ASME 风格 |
| AVEVA isoDraft / E3D 轴测图：文字在尺寸线上方、沿线 | 经验习惯，**待核**（PML isoDim 里 `label_anchor` 只是沿线位置，`isodim.rs::make_segment` 取线中点） | 求解器没有输出「文字在线上方」的偏移，Web 端若要复刻需自定义法向偏移（见 §3.1） |
| ASME Y14.41-2019 / ISO 16792：三维标注应位于标注平面、可读性随视角调整、边缘视角时可隐藏或翻转 | 条款号**待核** | 支撑 §3.2 的 edge-on 退化规则 |

## 2. 现状逐项对照（按当前截图 + 源码）

| 项 | 现状（代码 / 数据） | 判定 | 依据 |
| --- | --- | --- | --- |
| 文字与尺寸线 | 标签钉在 `label_anchor`（线中点），文字框处打断尺寸线 | **GB 允许 / ASME 标准 / ISO 偏离（ISO 要上方）** | §1 前四行 |
| 文字方向 | 沿尺寸线（`labelAlong = end − start`）+ `engineeringTextRotation` 翻到可读半圈；投影退化时回落水平 | 符合（GB 方法 1 → 退化为方法 2） | GB §4.3.2、ISO §4.1.1 |
| 字高 | `meta.cheight_mm` 深度投影，夹 11–18 px；远景全部落到 11 px | 合理；**不是**图纸字高换算（ISO 3098 2.5/3.5/5 mm 系列不适用于屏幕） | Oracle 两轮一致 |
| 箭头 | 契约 `arrow_lines` 开放 V 形，长 0.96·cheight、半宽 0.28·cheight（半角 ≈ 16°），屏幕下限拉伸 | 符合（ISO 129-1 §5.4 允许开放 / 闭合 / 实心终端，**角度条款待核**） | ADR 0048 / 0056 |
| 尺寸界线 | 契约 `extension_lines` 从管体点到尺寸线端点**恰好止于尺寸线**，无超出 | **轻微偏离**：GB/ISO 图纸习惯尺寸界线略超出尺寸线（GB 约 2–3 mm，**条款待核**） | 可做呈现层 quick win（§4 Q3） |
| 尺寸线行位 | `od + 1.2·cheight·(row−1)`，主尺寸离管轴一个 OD，三维实体管把线盖住 | 图纸语义正确（单线轴测），三维呈现偏离；**不改求解器** | 方案文档 §3 O1 |
| 尺寸链 | 每 isoline 一条 running dimension，main / atta 两行 | 符合 isoDraft 语义；不合并 | Oracle C7、C9 |
| 数值格式 | 契约 `text` 原样（`1834.19` 两位小数、`1352`，无单位） | 符合 E3D；**不在 Web 改写**（校审依据） | Oracle C6 |
| 颜色 / 线宽 | 尺寸线深橙 `#c2410c` 1.2 px、文字深灰 `#111827` 1.5 px 描边、用户尺寸洋红 | 三维校审可接受；图纸标准（同一细实线）不适用于屏幕 | QW2 实测 |
| 被遮挡 / 背面 | `depthTest=false` 全部穿透 | engineering overlay 合理；缺 inspection 模式 | S4 |
| 密集簇 | LOD：atta 远景隐、短线（线长 < 1×标签宽）隐；`567.89 / 900.51` 成对相压未解 | 第一阶段正确；缺成对确定性隐藏 | S1 |
| 选中 / 悬停 | 尺寸有 hovered / selected 样式角色；BRAN 选中高亮与尺寸色已分开 | 符合 | QW2 |

## 3. 专题结论（Oracle 建议 → 本仓核对 / 修正）

### 3.1 文字位置：中断处 vs 外侧上方

- Oracle 两轮一致：**engineering 默认保持「中断处」**。理由：`label_anchor` 只是沿线位置，Web 自定义「上方」要引入法向偏移；本仓核对后补充两点：
  - 契约里**已经有**「远离管体」法向：`n = normalize(extension_lines[0].to − extension_lines[0].from)` 即求解器 `dim_dir`（`isodim.rs::make_segment` 的 `normal`），无需新字段。
  - 但行距只有 1.2·cheight 而字高 1·cheight：若文字整体外移 d = 0.7·cheight（半字高 + 0.2 间隙），到下一行尺寸线只剩 0.5·cheight，加上 `labelPaddingPx` 后**必然侵入 row 2**（Oracle 第二轮算得一致）。所以「统一外侧上方」在 main + atta 两行并存时不可行，除非只对单行尺寸启用。
- Oracle 第二轮另提「atta 无碰撞时沿 n 外移 0.35·cheight」——**不采纳**：这是 Web 侧搬动 solver 标签，与 QW1 / S1「不搬动、只决定显隐」的口径冲突，且 0.35·cheight 不足半字高，文字仍压线。
- **结论**：保持中断处；把「文字在线上方（ISO 5.7.2 风格）」列为 S1 `layoutAuthority` 之后的可选呈现模式，仅在「该尺寸所在 isoline 只有一行」且 n 的屏幕投影长度 ≥ 0.5×字高时启用，否则回落中断处；两种状态由相机确定性决定。

### 3.2 视向退化（edge-on）

- 采纳 Oracle 第二轮判据：`projection_ratio = 屏幕投影长度 / (设计长度 / worldPerPixelAt(labelAnchor))`（即透视缩短系数），`< 0.15` 视为 edge-on。
- 处理：**不隐藏整条**（尺寸仍有工程意义），文字回落屏幕水平（GB 方法 2），箭头投影 < 2 px 时省略（现有 `explicitArrowLine` 已把投影为点的翼丢掉，只需把阈值从 EPSILON 提到 2 px）。
- 修正：Oracle 提议的 `|dot(view_dir, pipe_dir)| > cos θ` 不用（尺寸线方向不一定沿管轴；用屏幕投影统一判定）。

### 3.3 短线阈值分级与成对相压（S1 `declutterPolicy`）

- 现状：`lodMinLineToLabelRatio = 1` 一刀切。今日实测 1 → 1.2 无效果（阈值落在 1.21 / 1.25 之间，见方案文档 S3 段）。
- Oracle 第二轮建议分级：`≥ 1.5` 正常、`0.8–1.5` 允许显示、`< 0.8` 候选隐藏、`< 0.5` 强制隐藏。本仓核对：本样本里只有 `173`（0.50）会被强制隐、`402`（1.08）与 `907.52`（1.21）本就因 atta 远景被隐，所以分级本身**不改变本样本远景**；它的价值在于把 0.8–1.5 区间交给成对规则处理，而不是继续调 k。
- 成对相压算法（采纳，作为 S1 的具体化）：
  1. 候选对 = 旋转标签框相交（`labelBounds` + 旋转角，已在 `LayoutResult` 里）；
  2. 胜负顺序固定：`tier`（main > atta）→ 线长÷标签宽大者胜 → `id` 字典序；
  3. 迭代到无相交（A 压 B、B 隐后 B 不再压 C）；用屏幕网格（格边 = max(标签宽, 标签高)）做候选，2k 记录时 O(n·k)；
  4. 败者写 `derived.lodHidden = 'overlap'`，不移动、不合并；
  5. 与现有规则的先后：`secondary-far` → `short-line` → `overlap`（自身不可读优先于与人冲突）。
- 验收：`24381_145018` 远景 `567.89 / 900.51` 只隐一条且 main 优先保留；两次布局隐藏集合与顺序完全一致；2k 记录 p95 ≤ 16 ms。
- 本仓注记：现有 `resolveLabelCollisions.ts` 是「搬动 + 补引线」式避让，MBD 已 pinned 不参与；新规则应是独立的 `declutterPolicy`，不复用它的搬动逻辑。

### 3.4 inspection 模式（S4）

- 遮挡判定：采纳「对 `label_anchor` 做一次相机射线求交」（方案 B）：`hit + ε < dist(camera, anchor)` 即遮挡，ε = max(0.5 mm, 2 px 的世界尺寸)；**不读深度缓冲**（overlay 与模型 pass 的深度目标 / MSAA 不可控）、**不用 AABB**（弯头 / 阀门误判多）；粒度 = 整条尺寸记录。
- α：engineering 1.0（现状）；inspection 可见 0.65 / 被遮挡 0.35；不隐藏（校审时背面尺寸仍需确认）。默认 engineering（用户群是 E3D 校审工程师，轴测图阅读优先）。
- 入口：与 S5 三态开关合并成「MBD 显示模式：Engineering / Inspection」。
- 本仓注记：射线求交对象是 DTX 管体网格；每次相机 settle 后对 ≤ 数十条 MBD 记录各做一次 raycast 在性能门内，但 2k 记录时需要按帧预算分批。

### 3.5 其它专题（Oracle 与本仓一致，直接采纳）

- 字高保持 11–18 px；不做 ISO 3098 字高换算。
- 箭头保持契约开放 V 形；不改实心。
- 数值不改写、不加单位；ATTA 子尺寸未来可降字重（不改 `text`）。
- 与 isoDraft 必须一致：尺寸值、main/atta 归属、running dimension 分段、`label_anchor` 沿线位置；可变：可见性（LOD）、颜色、inspection 淡化、交互过滤。
- 尺寸线贴管：不做屏幕偏移；靠 S4 inspection、管体半透明 / 线框辅助模式。

## 4. 建议清单（按「直观、符合习惯」收益排序）

| # | 建议 | 类型 | 改动点 | 验收 |
| --- | --- | --- | --- | --- |
| Q1 | **成对相压确定性隐藏**（§3.3，`lodHidden='overlap'`） | 结构性 · S1 具体化，不动契约 | 新增 `kernel/layout/declutterPolicy.ts`；`layoutViewport.ts` 在逐条布局后调用；`types.ts` 增 `'overlap'` | 固定相机 `567.89 / 900.51` 只隐一条；两次布局一致；perf 门 |
| Q2 | **edge-on 退化**（§3.2：文字回落水平、箭头 < 2 px 省略） | quick win（≤ 1 天） | `explicit.ts::textRotation` / `explicitArrowLine` | 单测：投影比 < 0.15 → 旋转 0；固定相机侧视截图 |
| Q3 | **尺寸界线超出尺寸线**：沿 `to − from` 方向在屏幕上超出 `theme.extensionOvershootPx`（现有常量 10 px，或按字高 0.3·cheight 取小） | quick win（呈现层，不改契约几何） | `explicit.ts::explicitSceneLines` 对 `part='extension'` 加超出 | 单测 + 截图；SVG 导出同步 |
| Q4 | **inspection 模式**（§3.4） | 结构性 · S4 | `scenePainter.ts` 增模式与 α；新增 `viewport/mbdOcclusion.ts`（raycast） | 近景被遮挡尺寸 α 0.35；engineering 与现状逐像素一致 |
| Q5 | 短线阈值分级（0.5 / 0.8 / 1.5）替代一刀切 k | 随 Q1 一起做 | `theme.ts` 三档常量；`explicit.ts::lodHiddenReason` | 本样本远景不变；中景多留一档 |
| Q6 | 「文字在线上方」可选模式（仅单行 isoline） | S1 之后 | `explicit.ts` 新增 `labelPresentation`；用 `extension_lines` 法向 | 固定相机对比；不侵入相邻行 |

不做：改 `isodim.rs` 行位 / 字高 / 箭头 / `label_anchor`；重录 golden；Web 按视向平移尺寸线；改写契约 `text`。

## 5. 待拍板

1. 是否接受「中断处」作为 engineering 默认（GB 允许、ASME 标准、ISO 偏离），把「上方」留作 Q6 可选模式。
2. Q1–Q3 的实施顺序（建议 Q1 → Q2 → Q3，Q1 是 S1 的第一块）。
3. inspection α（0.65 / 0.35）与默认模式（engineering）。
4. 尺寸界线超出量取 10 px 固定还是 0.3·cheight 投影取小。
