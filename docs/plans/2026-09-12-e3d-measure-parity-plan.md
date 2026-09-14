# E3D 3.1 测量功能对齐方案（Measure parity）

日期：2026-09-12  
状态：Plannotator 已批准（2026-09-12 14:46，`{"decision":"approved"}`，无附注；开放问题 Q1–Q6 按各阶段开工前的 `record_decision` 逐条定）  
范围：`plant3d-web` 测量（Measurement）；数据供给侧涉及 `gen-model`（`/api/v1`）与 `vendor/e3d-model`  
依据：E3D 3.1 PMLLIB 源码（`gphmeasure.pmlfrm` / `gphanglemeasure.pmlfrm` / `gphdimension.pmlobj` / `edgpickpacket.pmlobj` / `edgpicktype.pmlobj` / `edgposcntrl.pmlobj` / `edgsettings.pmlfrm`）、已采运行时 golden（`docs/verification/e3d-measurement-runtime-golden-capture.md` §1–§11）、现有源码（`src/composables/useXeokitMeasurementTools.ts`、`src/measurement/**`、`src/components/tools/Measurement*.vue`）  
承接：`docs/plans/2026-09-11-measurement-clearance-dimension-convergence-plan.md`（D1–D5 冻结决策、M3「E3D Measure 参考系语义」继续有效，本方案不改它们）

## 0. 目标与口径

用户口径：**E3D 有的测量功能我们也要有，而且交互模式要保持接近。**

本方案把这句话落成三件可验收的事：

1. **能力清单闭合**：以 E3D 3.1 产品里**用户可达**的测量入口为准（不是 PML 里存在但没有 UI 入口的方法），逐条列出，逐条给 Web 现状与差距。
2. **交互对齐**：对齐的是 E3D Measure 的**行为契约**——两步 / 三步取点状态机、提示文案的结构（`Measure distance start (Snap) Snap :`）、拾取过滤器 × 拾取类型的组合、窗体常驻与重复测量、Keep dimensions 生命周期、结果表行与格式、辅助图形出现规则、错误 / 取消的分层行为。**不复制** E3D 窗口布局、PowerWheel、Positioning Control 工具条的像素样式。
3. **每条 parity 声明都有运行时 golden**：沿用 §1 证据规则——静态 PML 推导只能写 `static_expectation`，宣称「与 E3D 一致」必须有 E3D 3.1 实机观察（PID 注入宏 + 截图 + trace），Web 侧对应 vitest golden 或 Playwright 实机走查。

### 非目标（延续上一计划 §2，并明确本方案不碰的）

- 面积 / 体积测量（E3D 产品无用户级入口）。
- Positioning Control 的 **Offset**（E/N/U、Plane、Distance & Direction、From Surface）与 **Working plane / grids**：那是定位（移动 / 创建元素）能力，不是测量；但它们的**拾取类型**（Snap / Mid-Point / Fraction …）会进入测量取点，见 §1.5、Phase A。
- Design aids（GPHLINE / GPHPLANE / grids）作为**可创建对象**：Web 没有 Aid 系统，本方案只把「Aid 类拾取」列为差距，是否建 Aid 系统另立决策（§7 Q3）。
- Query 命令族（`Q POS`、`Q DIST`…）：命令行查询，不属于 Measure 窗体交互。

## 1. E3D 3.1 测量能力清单（基线）

### 1.1 用户可达入口

| 入口 | 载体 | 说明 |
| --- | --- | --- |
| Measure Distance | `!!gphMeasure`（`gphmeasure.pmlfrm`） | 两点距离；选项 Keep dimensions / Show linear dimension / Perpendicular to / wrt；Units（Unit type：Default / Metric / Imperial；Display Unit） |
| Measure Angle | `!!gphAngleMeasure`（`gphanglemeasure.pmlfrm`） | 三点角（root / first / second）；Unit：Default / Degrees / Radians / Gradians；Decimal Places（缺省 2）；Keep Dimension；wrt |
| Measure / Measure Shortest（定位偏移菜单） | `edgsettings.pmlfrm` → `EDGPACKET.defineMeasure('distance' \| 'shortest')` | Offset 各轴输入框的右键菜单：量一段距离或两组 graphics 的最短距离填进偏移值。`shortest` 用 `gmfLine.shortest(from, to)`，两端是 `stdGraphics` 拾取 |
| Measure angle between lines | `EDGPICKPACKET.measureLineAngle / measureLineAngleArc` | 两条 EDGE（facet edge）之间的角；产品 UI 是否可达 = G6-04 待采 |

### 1.2 Measure Distance 窗体契约（已采 golden 的部分标 ✓）

- 状态机：`start → end → start`，窗体常驻，完成一次立即接受下一次（G1-05 ✓）。
- 提示：`Measure distance start (Snap) Snap :` / `… end …`；Perpendicular 下 `Measure perpendicular distance start/end`（G4 ✓）。括号里是**拾取类型**（Snap / Distance / Mid-Point …），冒号前是**拾取过滤器**（Snap = Any…）。
- 结果表（标准）：`Distance`、三个 Offset（World：E/N/U；普通 WRT：U/V/W；GENSEC：非负投影）、`Direction`（罗盘字串，GENSEC 仍按 World）（G1/G3 ✓）。
- 结果表（Perpendicular）：`Distance / Vertical / Horizontal / Direction`，`wrt` 静默回 `/*`、控件禁用（G4-06 ✓）。
- 辅助图形：直接线 + 正交分解，Show linear 开启时只有 `int(sum) ≠ int(length)` 才画分解；0.1 mm 抑制（G2-01～03 ✓，决策 d-534）。Perpendicular：直接线 + Vertical / Horizontal 两腿。
- Keep dimensions：一个窗体一个 aid 号（`aidNumbers.add('Measuring')`）。开启时每次测完 `draw(aidNumber, false)` 累积；关闭时 `replace()` 只剩最新一条，**勾掉那一下就 `clearAids()`**（`keepAids()` 回调，不等下一次测量），关窗 `tidy()` 也只在关闭时清；缺省 false，开关状态在进程会话内随窗体成员记忆（`gphmeasure.pmlfrm` 139–142 / 171 / 224 / 247 / 509，G2-04/05 运行时 **未采**）。
- Units：Unit type 切 Metric / Imperial 重排 Display Unit 列表，记忆上一次选择（`lastMetricSelection / lastImperialSelection`）；格式 `!!distanceFmt`（2 位小数去尾零，`0mm` 无负零，G1-04 ✓）。
- 错误：Perpendicular 零距离 `alert.warning('Perpendicular distance is 0')`；无效 WRT 静默回 World（G3-03 ✓）。

### 1.3 Measure Angle 窗体契约

- 三点顺序 root / first / second；结果 `Angle / Direction1 / Direction2`（wrt 帧）；只报 minor 角、无 reflex；0° / 180° / 重合点 `alert.error`（G6-01～03 ✓）。
- Unit（Default / Degrees / Radians / Gradians）+ Decimal Places（缺省 2）；Keep Dimension；wrt。
- 两线夹角（EDGE × EDGE）：`LINEANGLE`（回 REAL）/ `LINEANGLEARC`（回 ARC 画弧）。

### 1.4 Shortest（`gmfLine.shortest`）

两组 graphics（点 / 线 / 平面 / 圆弧）的最短距离与 witness 点对：点点、点线、点面、线线（平行 / 相交 / 异面）、线面、面面（平行 / 相交）。有限 / 无限范围语义、非唯一最近点对的 witness 选择 = G5 **未采**。

### 1.5 拾取层（Positioning Control，测量取点共用）

- **拾取过滤器**（`EDGPICK`）：Any · Element · Aid · Pline · Ppoint · Screen · Graphics · External。
- **拾取类型**（`EDGPICKTYPE`）：Snap · Distance（沿线走一段）· Mid-Point（Proportion 0.5）· Fraction（1/n）· Proportion（0–1）· Intersect · Exact（光标点）。缺省 Snap + Element。
- `snap()` 按拾中类型派生位置：`3D_LINE` · `ELEMENT`（`edgTypes.attribute(noun).snap()`，**只有 SCTN / GENSEC / PANEL 等结构类实现了它，其余 `handle any` 回落元素原点**——2026-09-13 核对，d-336；早先写的「盒角 / 圆柱轴端 / 面中心」不是 E3D 行为）· `PLINE` · `PPOINT` · `DPOINT` · `TUBING`（管身轴线点）· `DESIGNAID`（POSITION / ARC / LINE / PLANE / 各类 grid）· `GRAPHICS`（facet 边 → 线、facet → 平面）· `PIN`。
- `Significant Snaps` 开关（`intermediate`）：吸到显著点还是任意点。
- 这一层同时喂 Perpendicular to（目标线 / 面来自 `getLine()/getPlane()`：PLINE / PPOINT 轴、GRAPHICS 边 / 面、Aid LINE / PLANE）与 Shortest（`stdGraphics` from / to）。

## 2. Web 现状对照

✓ 已有且有 golden；◐ 已有但缺 golden 或只覆盖子集；✗ 没有。

| # | E3D 能力 | Web 现状 | 证据 / 位置 |
| --- | --- | --- | --- |
| 1 | 两点距离 + Distance / Offset×3 / Direction | ✓ | `computeDistanceMeasurementResult`，G1 golden；结果 Inspector |
| 2 | wrt：World / 普通元素 U-V-W / GENSEC / 无效回退 | ✓ | `ReferenceFrameResolver`，G3-01～05；`e3dRotatedWrt.golden.test.ts` |
| 3 | Show linear + 正交分解闸门 + 0.1 mm 抑制 | ✓ | `worldDistanceAidPlan.ts`，G2-01～03，d-534 |
| 4 | Keep dimensions 生命周期（关窗 / 切工具 / 重开） | ◐ | **行为已对齐（2026-09-14，Web `3701208`，Phase B 切片 1）**：`distanceKeepDimensions` 原本只在下一次测量落地时隐藏旧图形，现补上 E3D 的另两处时机——勾掉当场收（`keepAids()` → `clearAids()`）、`deactivate()`（关窗 / 切工具）时 Keep 关着才收；都走可见性开关（E3D `aidNumbers.hide()`），记录不删。实机 S1–S4 + 单测状态机全过（golden MD §19）。已知偏离（用户拍板保留 Web 口径，决策 `d-437`）：缺省 true（E3D false）、开关记在 localStorage（E3D 只在进程会话）、Web 独有的 `keepMeasurementAnnotation` 一层、收的范围是整张距离测量列表（E3D 是本窗体 aid 号）。**◐ 只因 G2-04/05 运行时 golden 未采** |
| 5 | Units：Metric / Imperial + Display Unit + 记忆 | ✓（公制）· 英制有意不做 | **会话级 Units 框已落地（2026-09-14，Web `12ad607` + `2e9d354`，Phase B 切片 3，决策 `d-483`）**：Unit type 两档 Default / Metric × Display Unit（Millimetres / Centimetres / Metres），记住上次选的那一档、Default 档下拉禁用并回落全局单位设置（= E3D `!!distanceFmt`）；纯内核 `src/measurement/units/measurementUnits.ts` 的 FORMAT 表逐格对应 `comformats.pmlobj` 1301–1356，结果表与画布尺寸文字同一套格式（E3D `setUpForm()` 把 `measureFormat` 同时给结果表和 `GPHDIMENSION`）。实机四档对同一条 23787.9639 mm 的换算 Δ ≤ 0.036 mm（各档取整余量），记忆与持久化走通（golden MD §21）。**英制（Inch / Feet & Inches / Feet）用户拍板不做**（Q4）——E3D 那三个 FORMAT 的参数记在 golden MD §21，要加回来照着填 |
| 6 | Perpendicular to：点→线 / 面 / 点退化、World 帧、零距离告警 | ◐ | `perpendicularDistance.ts` + `perpendicularTargetProvider.ts`，G4 全部 ✓。目标 provider 按 E3D `GMFARC.perpendicularToPoint` 的分支序（`getLine()` → `getPlane()` → 点）接了：P-Point 轴、PLINE 线（实机 ✓，golden MD §17）、Graphics 边（`direction` + `segment`，标签用候选自己的名字）与 Graphics facet 面（`facet-plane`）、圆面关键点、Element 的 P1 → P2 `line()` 操作数（golden MD §16）。**余 Aid**（Q3 未拍板，无 Aid 系统）；Graphics 边 / 面当垂距目标的实机走查未单独采 |
| 7 | 三点角 Angle / Direction1 / Direction2 / 拒绝 0°·180° | ◐ | `threePointAngle.ts` 内核 + golden（G6-01～03）；UI 用旧 `computeAngleDegrees`，内核**未接线**；无 Direction1/2 行 |
| 8 | 角度 Unit（Degrees / Radians / Gradians）+ Decimal Places | ✗ | 只有度 + 全局 precision |
| 9 | 两线夹角（LINEANGLE） | ✗ | 无 EDGE 拾取；G6-04 未采 |
| 10 | Shortest（graphics × graphics） | ✗ | 现有 clearance / 最近点是采样近似（上一计划 §3.2），不是 `gmfLine.shortest` 语义；G5 未采 |
| 11 | 拾取过滤器：Ppoint | ✓ | `ptset` 源；2026-09-12 起经 `ModelSource.keypoints` 走 gen-model `element/ptset`（d-559），实机 表面点 → P-Point 轴线 走通 |
| 12 | 拾取过滤器：Element | ✓ | E3D 3.1 Element × Snap 对 CYLI / BOX / ELBO / VALV 等一律回落**元素原点**（`edgpicktype` ELEMENT 分支 `handle any → item.position`；只有 SCTN / GENSEC / PANEL 等结构类实现 `snap()`），Web 的 `position`（Item 原点）即是；`primitive_key_point`（盒角 / 轴端）是 legacy parquet 带来的 Web 增强，v1 **不补 API**（Q5 2026-09-13 拍板，d-336）。**Element 拾中的元素当 Intersect / Perpendicular 操作数按 E3D `line()` 转 P1 → P2 ✓（2026-09-14，`79b199c`）**：CYLI / CONE / SNOU / DISH / PYRA / NOZZ（`src/measurement/kernel/elementLine.ts`），ptset 的 P1 / P2 优先、无点的设计基本体从 DTX 局部包围盒 × 放置矩阵派生（截面对中才认；带 XOFF / YOFF 的 SNOU / PYRA 不派生），实机 CYLI × CYLI / CYLI × CONE 交点与 Perpendicular 垂足 Δ ≤ 0.001 mm（golden MD §16）。SCTN / GENSEC 的 `line()` 是截面 PLINE 线 → #13（`element/plines`，2026-09-14 ✓） |
| 13 | 拾取过滤器：Pline | ✓ | **gen-model-v1 供给 ✓（2026-09-14，gen-model `a00565522` + Web `c2e3d97`，d-394）**：`POST /api/v1/element/plines` 复用 e3d-model 建型材实体的截面链给 SCTN / GENSEC 每条目录 p-line 的 `PLSTART → PLEND` 世界线（cut 端点另给，只在真斜时出现）；前端摊成与 legacy `semantic_snap_points` 同形的端点候选配成线，再加一条线候选（控制点 = p-line 上离光标射线最近处）——光标落在梁中段就拾中整条 p-line：Snap 近端 / Mid-Point 等沿线 / Intersect 当 LINE / Perpendicular to 以它为目标（E3D `EDGPLINE.snap` / `edgsctn.snap → this.line`）。实机 14 根 SCTN 的 JUSL 线 = POSS → POSE、cut 端点 728 处核对 0 不符、网格在 p-line 标架的包围盒差 ≤ 0.001 mm；Snap / Mid-Point / Intersect / Perpendicular Δ 0.000 mm（golden MD §17）。legacy 仍走 `semantic_snap_points`。**E3D Pick Settings「Sections & Walls」✓（2026-09-14 12:55，gen-model `df61072cc` + Web `648f957`，切片 7）**：Pline 端点 Uncut / Cut（`EDGPLINE.cut`，Cut 取 `PLSTCUT → PLENCUT`）与 Significant Snap Points 三档（Fittings / Joints / Nodes = SCTN 名下 FITT / SJOI+SUBJ / SNOD 投到 p-line 上分段，服务端 `snap_points` 给成员位置），缺省与 `EDGPLINE` 构造一致全关；实机 Cut × Snap 起点 = PLSTCUT、Nodes × Snap 吸到节点 Distance = ZDIS、Mid-Point 各段中点 Δ 0.000（golden MD §18）。缺：GENSEC 弧 SPINE |
| 14 | 拾取过滤器：Graphics（facet 边 / 面）、Screen、Aid、External | ◐ | **Graphics ✓（2026-09-13）**：`mesh_graphics` 点源从已加载网格派生绘制边（线）/ 面（平面），只在 Graphics 过滤器下参与；实机 `面 → 边` 距离走通（golden MD §12）。Screen ✓（= `mesh_pick_point`）。Aid / External 占位灰掉 |
| 15 | TUBING 轴线点、DPOINT | ◐ | **TUBING ✓（2026-09-13）**：`tubing_axis` 点源从直管对象的局部包围盒 × 放置矩阵派生管身轴线，两端吸到邻接 P-Point（`src/measurement/tubing/tubingAxis.ts`），按 E3D `EDGTUBING` 走线候选（Snap 近端 / Cursor 交点 / Mid-Point 等沿线 / Intersect 转 LINE），Any / Element 放行；实机 `轴线 → 轴线` Snap 与 Mid-Point 两条距离走通、校正端点与 E3D ELBO 145031 P1 差 0.001 mm（golden MD §14）。ATTA 按 E3D `line()` 跳过：gen-model 本就不在非 SPKBRK 的 ATTA 处断管，SPKBRK 断开的两段前端合并（`mergeTubingAxisAcrossPassThrough`，golden MD §15）。DPOINT ✗ |
| 16 | 拾取类型：Snap / Exact | ✓ | 拾取层 `pickType` Snap / Cursor；点候选、线候选（`GMFLINE` 近端 / 控制点）、面候选（射线 ∩ 平面）三类几何均接内核 |
| 17 | 拾取类型：Distance / Mid-Point / Fraction / Proportion / Intersect | ◐ | 全部已接：Distance / Mid-Point / Fraction / Proportion 走 `pickDerivation.ts`（PLINE 线、Graphics 边、P-Point Distance 偏移）；Intersect 走 `intersectPickSession.ts` 两 / 三次子拾取（线 × 线 / 线 × 面 / 面 × 面 × 第三项，E3D 2,870 / 2,874 分型），实机 `ELBO 边 × VALV 边` 出交点（golden MD §13）；**◐ 只因 G8 运行时 golden 未采** |
| 18 | Significant Snaps 开关 | ◐ | 拾取层 `significantSnaps`（覆盖条开关 + 提示尾巴 `Snap`），线候选带 `intermediates` 时按段派生；无 E3D 实机对照 |
| 19 | 提示文案结构 `<命令> <步> (<拾取类型>) <过滤器> :` | ◐ | `formatMeasurementPrompt`：`距离测量 · 第 2/2 步 选择终点 (Mid-Point) Snap : ELBO P-Point #1`（E3D `EDGSTATE.prompt()` 结构，过滤器不进提示与 E3D 一致）；文案矩阵（Phase E）未对照 |
| 20 | 窗体常驻 / 连续测量 / Repeat / ESC 分层 / 右键 | ◐ | **ESC / 关窗的 E3D 口径已采到（2026-09-14，静态源，golden MD §20）**：Esc 走 `EDGCNTRL.canvasPick(…,'ESCAPE') → escape()`，**没有分层**——跑 `packet.closeAction()`（= `gphMeasure.tidy()`）、收回本包 aid 号、`tidyForms()`、把上一层包 `reinstatePacket` 回来，停在哪一步都一样；关窗 `gphMeasure.close()` = `tidy()` + `edgCntrl.remove(description)`，对当前包即 `retrieve()`，与 escape 只差跑 `continue` 还是 `escape` 动作（测量包两者都没设 → 等价）。窗体常驻 / 连续测量来自 `packet.remove = FALSE` → `setOldPacket()`，Web 一致。Web 的四层 Esc 保留为增强（决策 `d-444`），第 ④ 层等价于 E3D 的 Esc（含 `deactivate()` 的 tidy，`d-437`）。**余右键**：E3D 拾取中的右键在原生 GUI（`EDGPICK.applyToView → view.setInMode`），静态源不可见，待 trace；Web 的右键是对已画尺寸弹菜单 |
| 21 | 标高点 / 高差 | Web 独有 | E3D Measure 无此模式（用 Query），保留，不列 parity |

## 3. 差距分级

- **P0（不补就不能说「E3D 有的我们都有」）**：#10 Shortest、#9 两线夹角、#17 拾取类型、#14 Graphics 边 / 面拾取（它同时解锁 Perpendicular 与 Shortest 的目标 provider）、#13 在 gen-model-v1 下的 PLINE 供给（#12 Element 显著点 2026-09-13 核对为非 E3D 口径，撤出 P0，d-336）。
- **P1（功能在、契约缺角）**：#4 Keep 生命周期、#5 Units 矩阵、#7 角度内核接线 + Direction1/2、#8 角度单位 / 小数位、#19 提示结构、#20 分层取消。
- **P2（可选 / 需拍板）**：#15 DPOINT（TUBING 已于 2026-09-13 前端派生落地）、Aid 拾取、External。

## 4. 分阶段方案

每个阶段 = 范围 → 改动（前端 / 后端）→ golden gate → 验收。阶段内部按「先采 E3D golden，再写内核 + vitest golden，再接 UI，再实机走查」推进（与 §1 证据规则一致）。

### Phase A · 拾取层对齐（拾取过滤器 × 拾取类型）

**范围**：#12 #13 #14 #16 #17 #18 #19。

**进度（2026-09-13）**
- 切片 1（快照 `9d34701`，用例对齐 `51b6933`）：两维模型 `src/measurement/pick/pickLayerModel.ts`（过滤器 8 / 类型 7、可用性、
  E3D 提示结构）、拾取类型内核 `src/measurement/kernel/pickDerivation.ts`、样式仓 V9 持久化、候选准入 `measurementPickLayerAdmits`、
  PLINE 端点配成线（`attachPlineSegments`）、提示条 `formatMeasurementPrompt`。
- 切片 2（`001b302`）：Graphics provider `src/measurement/graphics/meshFeatureGraphics.ts` + `mesh_graphics` 点源；`Any` 改按
  E3D `stdAny`「Element, Ppoint or Pline」口径；Perpendicular `facet-plane` provider；拾中细节高亮。实机走通 `面 → 边`（golden MD §12）。
- 切片 2b（`6ca770a`）：覆盖条设置弹层的过滤器 × 拾取类型 radio 组、取值输入、Significant snaps 控件（切片 1 漏掉的模板）。
- 切片 3（`e91b30e`）：Intersect 两 / 三次子拾取状态机 `src/measurement/kernel/intersectPickSession.ts` + 工具接线（子拾取、交点预览、
  `Intersection[n]` 提示、Esc 第一档、换类型重置）。实机 `ELBO 边 × VALV 边` 出交点（golden MD §13）。
- ADR 0060「测量拾取层对齐 E3D Positioning Control」已落（`docs/adr/0060-align-measurement-pick-layer-with-e3d-positioning-control.md`）：
  两维模型、Any = Element / Ppoint / Pline（+ 表面点）、Graphics 网格派生、Intersect 分型三条口径与被否决的替代。
- 切片 4（2026-09-13）：TUBING 轴线前端派生——纯内核 `src/measurement/tubing/tubingAxis.ts`（局部包围盒 × 放置矩阵 → 轴线；两端吸邻接 P-Point）
  + `tubing_axis` 点源（特征类 `tubing`，Any / Element 放行，`rayHit` 按孔径边缘入围）+ loader 的直管登记（noun `TUBI` / `is_tubi`）+ 轴线高亮。
  实机 `轴线 → 轴线` Snap 4568 mm / Mid-Point 3242 mm，校正端点 = E3D ELBO 145031 P1（golden MD §14）。
- 切片 4 补（2026-09-13 22:49）：TUBING 轴线跨 ATTA——`mergeTubingAxisAcrossPassThrough` 把在 ATTA 处断开的共线直管段接成 E3D `EDGTUBING.line`
  的一条线（OLET 等非 ATTA 零长构件不穿过）；点集响应透传构件 noun（`PtsetResponse.noun` → `PtsetSceneCandidate.noun`）以认出没有几何的 ATTA。
  实机核对：gen-model 本就跳过非 SPKBRK 的 ATTA / STIF / BRCO（`cata_model.rs`），BRAN 24381_145018 的 6 个 ATTA 全在直管轴线内部、本库 169 个 ATTA
  无 SPKBRK——合并只在预制分段处起作用，以单测 + 页内内核实机坐标复算为证；跨 ATTA 直管 Snap / Mid-Point 与 E3D 线端点 / 中点差 0.000 mm（golden MD §15）。
- 切片 5（2026-09-14 00:44，`79b199c`）：Element 元素当 Intersect / Perpendicular 操作数——纯内核 `src/measurement/kernel/elementLine.ts`
  （E3D `edgTypes.attribute(noun).line()` 的 noun 表 CYLI / CONE / SNOU / DISH / PYRA / NOZZ → P1 → P2；无 ptset 点的设计基本体按局部包围盒规则从
  DTX 局部帧几何 × 放置矩阵派生：圆柱 / 锥 / 碟「对中且圆」、棱锥「对中」）+ 工具接线（候选 / 命中挂 `elementLine`，只做操作数不改 Snap；
  没候选胜出时光标命中的元素本身就是 ELEMENT 拾取 → 转线；Perpendicular 目标线 = 元素 P1 → P2，垂足在精确线上不标近似）。实机 CYLI × CYLI /
  CYLI × CONE 交点、Perpendicular to CYLI / DISH 垂足与解析 P1 / P2 全部 Δ ≤ 0.001 mm，DISH / PYRA 接受、BOX 拒收不消耗（golden MD §16）。
- 切片 6（2026-09-14 03:46，gen-model `a00565522` + Web `c2e3d97`，决策 d-394）：Pline 过滤器接 gen-model-v1——服务端 `POST /api/v1/element/plines`
  （`gen-model-ptset-api/src/web_service/plines.rs`，spec §4.11.2：复用 e3d-model 建型材实体的截面链，目录 PSTR 每条 PLIN 的 (PX, PY) 经 JUSL 对齐 / LMIRR
  镜像放进截面标架再乘世界矩阵 → `PLSTART → PLEND` 世界线；`PLSTCUT / PLENCUT` 另给 `start_cut / end_cut`，只在与平头端点差 > 0.01 mm 时出现；GENSEC 只接
  直 SPINE）+ 前端（`keypointSource.primitiveKeypoints` 打它、`elementPlinesToKeypointCandidates` 摊成端点候选、`buildPlineLineCandidates` 每条线加一条线候选、
  Perpendicular 目标标签用 p-line 自己的名字）。实机 STRU 24381_177298 的 14 根 SCTN：JUSL 线 = `world_transform`·POSS / POSE Δ 0.0000、cut 端点 728 处
  0 不符、DTX 网格在 p-line 标架的包围盒与 p-line 极值差 ≤ 0.001 mm（含 BANG 155、25° 斜切）；Pline × Snap 近端 / Mid-Point / Any 放行 / Ppoint 不放行 /
  Intersect NA × NA / Perpendicular to PLINE 全部 Δ 0.000 mm，PANE 提示服务端 reason（golden MD §17）。
- 切片 7（2026-09-14 12:55，gen-model `df61072cc` + Web `648f957`）：E3D Pick Settings「Sections & Walls」——**Pline End Position**（`EDGPLINE.cut`：Uncut 取
  `PLSTART → PLEND`，Cut 取 `PLSTCUT → PLENCUT`，整条线换了所以 Snap / 沿线派生 / Intersect / Perpendicular 全随之，平头端不变）与 **Significant Snap Points**
  三档（`EDGPLINE.fitting / joint / node`：`snapLine` 把 SCTN 名下 FITT / SJOI+SUBJ / SNOD 投到 p-line 上、光标所在那一段才是作用线，只在 Significant snaps 开着时）。
  服务端 `element/plines` 加 `snap_points`（成员 + kind + ZDIS + 世界位置，SJOI / SUBJ 没有 ZDIS 沿属主链取 SNOD 的，FITT 走 `section_fitting_placement`；修了
  模板无 ZDIS 的成员把响应打成 500）；前端 `plineCut / significantSnapPoints` 进拾取层模型（缺省全关 = `EDGPLINE` 构造）、`attachPlineSegments` 的 cut 挪端点 +
  `intermediates` 分段、覆盖条设置弹层新控件。实机 SCTN 24381_177315（25.5° 斜切起端、SNOD + SJOI ZDIS 435.56）：Cut × Snap 起点 = PLSTCUT（离 PLSTART 23.847）、
  Cut × Mid-Point = 斜切线中点、Nodes × Snap Distance 435.560 = ZDIS、Nodes × Mid-Point 两段各自中点、Significant snaps 关 / 只勾 Fittings 回整条线、只勾 Joints
  同点分段——全部 Δ 0.000 mm（golden MD §18）。
- **未完**：GENSEC 含弧 SPINE 的
  `arc()` 与 GENSEC 的 cut 端点（本库无 GENSEC 样本，直 SPINE 分支运行时未验）；FITT 档只有单测（本库无 FITT）；带 XOFF / YOFF 的 SNOU / PYRA 的斜 P1 → P2（要
  `element/attributes` 或服务端给设计基本体合成 P1 / P2，本 EQUI 无样本）；STIF / BRCO 处按 E3D 截断（gen-model 穿过它们、E3D `line()` 不跳，本库无样本）；
  G7 / G8 / G9 运行时 golden（E3D 需在跑）。

**前端**
- `useMeasurementPickSources` 重构成两维：**过滤器**（对齐 E3D：Any / Element / Ppoint / Pline / Graphics / Screen；Aid / External 先占位灰掉）× **拾取类型**（Snap / Exact / Mid-Point / Fraction / Proportion / Distance / Intersect）。现有 4 个点源映射：`ptset`→Ppoint、`position`+`primitive_key_point`→Element、PLINE 关键点→Pline、`mesh_pick_point`→Screen/Exact；新增 Graphics。
- 拾取类型内核（纯函数，`src/measurement/kernel/pickDerivation.ts`）：Mid-Point / Fraction / Proportion 作用在「有两个端点的拾中几何」（PLINE、TUBING 轴、Graphics 边、P-Point 间线）；Distance 沿拾中线从近端走 d；Intersect 取两次拾取的线 / 面交点。
- Graphics provider（前端本地，从已加载网格派生）：facet 边（二面角阈值）→ 线段，facet → 平面（三角形所在面，合并共面片）；拾取时给 `line` / `plane` 几何供 Perpendicular / Shortest 用。这是 E3D `GRAPHICS` 拾取的等价物，不需要后端。
- 提示条改成 E3D 结构：`垂距测量 · 第 2/2 步 (Mid-Point) Ppoint : ELBO P-Point #1`。
- 覆盖条 / 面板：过滤器与拾取类型两组开关，`Significant snaps` 一档。

**后端（gen-model，`feature/element-ptset-api` 之后）**
- ~~`POST /api/v1/element/keypoints`：Element 显著点（对齐 `edgTypes` 各 noun 的 snap 点：盒角 / 面中心 / 圆柱轴端 / 圆环轴点 …）~~ **不做（Q5 2026-09-13 拍板，d-336）**：
  E3D 3.1 Element × Snap 对基本体 / 管件一律 `handle any` 回落元素原点，「盒角 / 面中心 / 圆柱轴端」不是 E3D 口径；`GeneratedElement` 只有 `solid` / `parts`（逐基本体网格）/
  `world` / `primitive_instance`（仅纯 BOX / CYLI），吐基本体清单 + 放置矩阵是 3–5 d 后端且与 d-536 RefNo 原生路由改同一批持久化面。要这体验另立 Web 增强，
  走前端从 DTX 放置矩阵派生（BOX / CYLI 元素精确）。E3D 真多出来的两件：`element/plines`（下一条）与 Element 拾中元素的 P1 → P2 `line()` 操作数（前端，**2026-09-14 已做**，`79b199c`：目录件用 ptset 的 P1 / P2，设计基本体在 gen-model-v1 下没有点、从 DTX 局部帧几何派生，切片 5）。
- `POST /api/v1/element/plines`：型材 PLINE（`e3d-model::section` 已求 SPRO/SREC PLINE 位置，暴露 start/end + 方向）——**2026-09-14 已落地**
  （gen-model `a00565522`，spec §4.11.2；Web `c2e3d97` 接线；d-394；golden MD §17）。
- TUBING 轴线点：由前端从 records 的隐式管身（`is_tubi`）+ 邻接 P-Point 派生，或服务端在 `element/ptset` 的 `members` 里附管身端点——Phase A 先前端派生
  （**已落地 2026-09-13**：直管对象局部包围盒 × 放置矩阵给轴线，端点吸 ptset 缓存里的邻接 P-Point；服务端不需改）。

**golden gate**
- G7-01～04（重叠候选胜出、PLINE / EDGE / PLANE / TUBING 实际捕捉几何、约束后是否仍在 feature、相机变化后重算）。
- 新增 **G8 拾取类型**：同一条 PLINE / 边上 Mid-Point / Fraction 3 / Proportion 0.25 / Distance 100mm 的位置字串；Intersect 两边交点。
- 新增 **G9 Element × Snap 回元素原点**（原「Element 显著点」按 d-336 改题）：对 BOX / CYLI / DISH / CTOR / ELBO / VALV 各做一次 Element × Snap，位置应等于 `Q POS`（元素原点）；SCTN 应落在截面 PLINE 线上。

**验收**：vitest 内核 golden 全绿；实机走查「Mid-Point of PLINE → Graphics 面」一条距离、「Ppoint → Graphics 边」一条 Perpendicular。

### Phase B · Measure Distance 窗体收口

**范围**：#4 #5 #6（provider 扩展）#20。

- ~~Keep dimensions 生命周期：按 G2-04/05 采到的行为落地（关窗 / 切工具 / 重开各自清什么留什么），vitest 状态机用例。~~
  **切片 1 ✓（2026-09-14 13:32，Web `3701208`）**：E3D 进程不在跑，改按 `gphmeasure.pmlfrm` 源码定口径（同 Phase A 的 `static_expectation` 走法）——
  勾掉 Keep 当场 `clearAids()`、关窗 `tidy()` 只在 Keep 关着时清、开着时图形留在视口、重开时开关按会话记忆。Web 补了前两处时机（原本只在下一次测量
  落地时隐藏旧的），vitest 状态机用例 + 实机 S1–S4 全过，golden MD §19。缺省值与 localStorage 记忆按用户 2026-09-14 拍板保留 Web 口径（已知偏离）。
  G2-04/05 运行时 golden 仍欠，等 E3D 起来补采（决策 `d-437`）。
- ~~Units：测量会话级 Unit type（Default / Metric / Imperial）+ Display Unit（mm / cm / m / in / ft-in …）+ 上次选择记忆，优先级高于全局设置（上一计划 M3 PR3.2）；格式矩阵（尾零、英制分数）先采 golden。~~
  **切片 3 ✓（2026-09-14 15:02，Web `12ad607` + `2e9d354`，决策 `d-483`）**：E3D 进程仍不在跑，格式矩阵改从 `comformats.pmlobj` 1301–1356 的 FORMAT
  参数定口径（同切片 1 / 2 的 `static_expectation` 走法），公制这三档有 G1-04 实测兜底（`MM` = `!!distanceFmt`，dp 2 去尾零、`0mm` 无负零）。落地：纯内核
  `src/measurement/units/measurementUnits.ts`（Display Unit 的 token / label 照搬 rText / dText、FORMAT 表逐格、上次选择记忆、公制渲染）、
  样式仓 V9 的 `measurementUnits`（缺省 Default = E3D 构造值，输出与改动前逐字相同）、结果表两个 row builder 与画布 `formatDistance` 共用同一个 format、
  测量面板顶上的 Units 框。实机四档 + 记忆 + 刷新持久化全过（golden MD §21）。**英制按 Q4 拍板不做**（先做过一版又撤了，E3D 那三个 FORMAT 的参数留在 §21）。
- Perpendicular to 目标 provider 接 Phase A 的 Graphics 边 / 面与 PLINE；面板「点→无限线 / 面」文案沿用。
- ~~ESC / 右键 / 关窗分层：采 E3D 行为后对齐（当前 Web 的 Esc 分层保留，只调差异）。~~
  **切片 2 ✓（2026-09-14 13:50，只读源、无代码改动）**：E3D 的 Esc 与关窗口径从 `edgcntrl` / `edgstate` / `gphdimension` 源码采到——Esc 没有分层，一下整包退并跑
  `tidy()`；关窗与 Esc 在测量这条命令上等价；窗体常驻来自 `packet.remove = FALSE`。Web 第 ④ 层已等价（`deactivate()` 含 tidy，切片 1），前三层保留为增强（决策
  `d-444`）。右键仍要 E3D 运行时 trace（原生 GUI，PML 不可见）。golden MD §20。

**golden gate**：G2-04/05、Units 矩阵（Metric / Imperial × 4 个 Display Unit × 尾零 / 负零）、ESC / 右键 / 关窗三态各一条 trace。

### Phase C · Angle

**范围**：#7 #8 #9。

- `threePointAngle.ts` 接入 UI：结果表加 `Direction1 / Direction2`（wrt 帧罗盘字串，`labelXYZ/ENU/UVW` 口径），0° / 180° / 重合点走 `alert.error` 等价提示并回到第 1 步。
- 角度 Unit（Degrees / Radians / Gradians）+ Decimal Places（缺省 2），测量会话级。
- 两线夹角：Phase A 的 Graphics 边 provider 就位后，新增「两边角」子模式（`LINEANGLE` 回 REAL，`LINEANGLEARC` 画弧）；入口是否要做取决于 G6-04（若 E3D 产品 UI 不可达，只做内核 + 隐藏入口）。

**golden gate**：G6-04；角度 Unit × Decimal Places 格式矩阵；两线夹角 3 组（相交 / 平行 / 异面）。

### Phase D · Shortest

**范围**：#10。

- 内核 `src/measurement/kernel/shortestDistance.ts`：`shortest(A, B)`，A / B ∈ {点, 线(段/无限), 平面(片/无限), 圆弧}；回距离 + witness 点对 + 退化标记（平行 / 重合 / 非唯一）。范围语义按 G5-01～04 采到的为准，不预设有限 / 无限。
- 入口：E3D 里 Shortest 挂在偏移菜单（G5-05 待采）。Web 放进距离模式的第三个子模式「最短距离」（两次 Graphics / Ppoint / Pline 拾取），结果表 `Distance / Vertical / Horizontal / Direction` + 两个 witness；辅助图形画 witness 线。
- 与 clearance 的关系：Shortest 是**用户取两组几何的精确最短距离**；clearance 仍是构件对构件的服务端 nearest-points（上一计划 D1）。UI 文案区分，不互相冒充。

**golden gate**：G5-01～05 全部；Web vitest 与 E3D 逐组对账（容差 1e-3 mm）。

### Phase E · 交互细节与文案矩阵

- 提示文案矩阵（每模式 × 每步 × 拾取类型 × 过滤器）与 E3D 逐条对照，落 `docs/verification/e3d-measure-prompt-matrix.md`。
- 窗体常驻 / 重复测量 / 连续测量 / Repeat / aid 编号（Keep 累积的图形可逐条删）。
- 命令提示位置：E3D 在命令行 + 窗体标题；Web 在覆盖条 + 底部状态，结构一致即可。

### 数据供给总表（gen-model-v1 缺省源）

| 点源 | 现状 | 方案 |
| --- | --- | --- |
| P-Point（含成员） | ✓ `element/ptset`（今日落地，41 点 golden） | — |
| Element 显著点 / 基本体关键点 | — 不做（d-336） | E3D Element × Snap = 元素原点，已有 `position`；显著点是 Web 增强，Q5 拍板不补后端 |
| PLINE | ✓ `element/plines`（2026-09-14，gen-model `a00565522`，golden MD §17）+ `snap_points`（Pick Settings 三档的分段成员，gen-model `df61072cc`，golden MD §18） | — （余：GENSEC 弧 SPINE） |
| Graphics 边 / 面 | ✗ | 前端从网格派生，无后端 |
| TUBING 轴线点 | ✓ 前端派生（2026-09-13，golden MD §14） | 无后端；直管放置矩阵 + `element/ptset` 邻接 P-Point |
| Aid | ✗ | 需 Aid 系统，另立决策 |

## 5. Golden 采集矩阵（新增 / 待补）

| 组 | 用例 | 采法 |
| --- | --- | --- |
| G2 | 04 / 05 Keep 生命周期 | 注入宏 + 截图（关窗 / 切工具 / 重开） |
| G5 | 01～05 Shortest | `gmfLine.shortest` 注入各几何组合；G5-05 用产品 UI 走一遍偏移菜单 |
| G6 | 04 两线夹角入口 | 产品 UI 可达性 + `measureLineAngle` 注入 |
| G7 | 01～04 拾取候选 | 真实鼠标拾取（重叠区）+ `!!edgCntrl.pickData` |
| G8（新） | 拾取类型 Mid-Point / Fraction / Proportion / Distance / Intersect | `!!edgPosCntrl.setPickType(n)` 后真实拾取 |
| G9（新） | Element × Snap 回元素原点 | 对 BOX / CYLI / DISH / CTOR / ELBO / VALV 各做 Element × Snap，对照 `Q POS`；SCTN 对照截面 PLINE 线（d-336 改题） |
| G10（新） | Units / Angle 格式矩阵 | 切 Unit type / Display Unit / Decimal Places 逐格读结果表 |

采集方法沿用 §8 / §11：运行中 E3D（PID 32452）`exec_clr_method.py` 注入 `.pmlmac`，`printwindow-capture.ps1` 后台截图，trace 入 `e3d-measurement-runtime-golden/`，`capture-*.json` 加 case。

## 6. 验收与 Go / No-Go（更新 §5）

- **Parity 声明**只在 §2 表全部为 ✓ 时成立；每一行 ✓ 的依据是 E3D golden case id + Web 测试文件。
- 拾取层：G7 + G8 + G9 通过 → 可宣称「拾取过滤器 × 拾取类型与 E3D 一致」。
- Shortest：G5 通过前 No-Go（沿用）。
- 角度：G6-01～03 已过；两线夹角随 G6-04 单独审批。
- 每阶段结束更新 `e3d-measurement-runtime-golden-capture.md` 与本文件 §2。

## 7. 开放问题（需拍板）

- **Q1 顺序**：建议 A → B → C → D → E（拾取层是 Perpendicular / Shortest / 两线夹角的共同前置）。是否接受 Shortest 排在角度之后？
- **Q2 Positioning 的拾取类型**：Distance / Fraction / Proportion 需要输入框（E3D 在 Positioning Control 工具条上）。Web 放覆盖条的「更多设置」弹层，还是独立小工具条？
- **Q3 Aid 拾取**：E3D 的 GPHLINE / GPHPLANE 设计辅助（G4-01/02 golden 就是靠它采的）在 Web 没有对应物。要不要做一个最小 Aid 系统（用户画辅助线 / 面供测量），还是明确不做？
- ~~**Q4 Imperial**：是否需要英制（ft-in 分数）显示？不需要则 Units 只做 Metric 矩阵 + Display Unit。~~
  **已拍板 2026-09-14 15:05（决策 `d-483`）：不做英制，Units 只留 Default / Metric。** 切片 3 里先按 §0 口径实现过一版
  （`12ad607`，出 `936.17/32in` / `78'-0.17/32"` / `78.045ft`，串型只能是 `static_expectation`——FORMAT 参数出自 PML，渲染在 E3D 内核），
  用户判定用不上后整组撤掉（`2e9d354`）。E3D 那三个 FORMAT 的逐格参数留在 golden MD §21，要加回来照着填；
  `normalizeMeasurementUnitSelection` 把旧配置里的 `unitSystem: 'imperial'` 打回 Default。
- **Q5 后端排期**：`element/keypoints` 需要改 e3d-model 暴露基本体放置矩阵，是本方案最大的后端工作量；与 gen-model 当前 RefNo 原生路由计划（d-536）并行是否可接受？
  **已拍板 2026-09-13（d-336）**：不做 `element/keypoints`——E3D 3.1 Element × Snap 对基本体 / 管件回落元素原点，显著点不是 E3D 口径；排 `element/plines`
  （后端 ~1 d，只读 `section` 已有结果，不碰 GeneratedElement / 持久化、与 d-536 不撞；**2026-09-14 已做**，gen-model `a00565522` + Web `c2e3d97`，d-394，golden MD §17）
  + Element 拾中 CYLI / NOZZ 的 P1 → P2 `line()` 操作数（前端 ~0.5 d；**2026-09-14 已做**，`79b199c`，
  实测 gen-model-v1 的设计基本体 ptset 无点，P1 / P2 改从 DTX 局部帧几何派生，golden MD §16）。
- **Q6 两线夹角**：若 G6-04 采出「产品 UI 不可达」，是否仍做（作为 Web 增强）？

## 8. 交付物

- 代码：`src/measurement/kernel/{pickDerivation,shortestDistance}.ts` + golden 测试；`src/measurement/units/measurementUnits.ts`（**已落地** `12ad607`，Phase B 切片 3）；`useMeasurementPickSources` 两维模型；Graphics provider；Inspector / OverlayBar 改动；gen-model `element/plines`（**已落地** `a00565522`；`element/keypoints` 不做，Q5 / d-336）。
- 文档：本文件 §2 随阶段更新；golden MD 新增 §12+；`e3d-measure-prompt-matrix.md`；ADR「测量拾取层对齐 E3D Positioning Control」。
- 决策：每阶段结束 `record_decision`，取代本方案里对应的开放问题。
