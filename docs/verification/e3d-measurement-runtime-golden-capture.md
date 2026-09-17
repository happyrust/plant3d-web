# E3D 3.1 测量运行时 Golden Capture

日期：2026-09-11  
目标：把静态 PML / IDA 结论与 E3D 3.1 实际运行行为分开记录，为 plant3d-web 的测量兼容开发提供可重复证据。

## 1. 证据规则

- 每个用例记录 E3D 可执行文件、`Core3D.dll`、`gphmeasure.pmlfrm`、`gphdimension.pmlobj` 的 SHA-256。
- 每个用例记录项目、MDB、模块、用户、COORD、单位、WRT、模型元素和点击顺序。
- 原始数值、格式化文本、辅助图形、命令提示和测量完成后的下一状态分别记录。
- 截图必须包含测量窗体、命令提示和三维视口；不能只截结果表。
- 静态 PML 推导写在 `static_expectation`，运行观察写在 `observation`，两者不得互相覆盖。
- 不能观察到的项标记 `blocked`，并给出可复现阻塞原因；不得按静态代码补值。
- 本轮只做查询、测量和 AID 显示，不保存数据库元素，不执行模型编辑命令。

## 2. 目标环境

- 产品：AVEVA Everything3D 3.1
- 项目：AvevaMarineSample（project code `ams`）
- MDB：`/ALL`
- 模块：Design
- 首选样本：BRAN `24381/145018`
- 启动入口：已修复的 shadow E3D 3.1 环境；启动时禁止刷新安装目录 DLL、禁止清理无关进程。
- 输出目录：`docs/verification/e3d-measurement-runtime-golden/`

## 3. 用例清单

### G0 · 身份与基础状态

- [x] 记录进程 PID、EXE 路径、模块版本和四个文件 SHA-256。
- [x] 记录项目、MDB、当前元素、COORD、默认距离单位。
- [x] 证明 3D 视口有模型，Measure Distance 能进入第 1 次取点状态。

### G1 · World 标准距离

- [x] G1-01：两个模型 Snap 点，记录 start/end Snap 文案（产品 UI 未导出具体 feature id）。
- [x] G1-02：记录 Distance、三个 Offset、Direction 的原文和符号。
- [x] G1-03：用独立坐标计算复核 `distance² = dx² + dy² + dz²`。
- [x] G1-04：零分量和负分量样本，确认轴标签与负零格式（`0mm`，无负零；轴标签仍为 E/N/U）。
- [x] G1-05：确认窗体保持活动以及下一次命令回到 start 状态。

### G2 · Show linear / Keep dimensions

- [x] G2-01：Show linear=true，记录直接线与正交分解线。
- [x] G2-02：Show linear=false，确认仅保留正交分解线。
- [x] G2-03：小于、等于、大于 0.1 mm 的分量，确认隐藏阈值（`between(-0.1mm,0.1mm)`；0.09 抑制、0.11 绘制、名义 0.1 落在浮点误差一侧；视口截图待补）。
- [ ] G2-04：Keep=false，完成两次测量、关闭窗体、切换工具。
- [ ] G2-05：Keep=true，完成两次测量、关闭窗体、切换工具、重新打开。

### G3 · WRT / COORD / GENSEC

- [x] G3-01：World 下记录项目 COORD 与 E/N/U 标签。
- [x] G3-02：普通 WRT 切换 U/V/W；旋转样本 EQUI `/Copy-of-RCS151MM`（Y is E）与 `/Copy-of-RCS616MD`（Y is U and Z is S 21 E）均与独立投影一致。
- [x] G3-03：无效 WRT 静默回退 World（`/*`）。
- [x] G3-04：GENSEC WRT，确认 Offset 为非负投影距离，Direction 仍按 World。
- [x] G3-05：实测 1920.14mm / 4430.67mm 投影未被 1m 截断。

### G4 · Perpendicular To

- [x] G4-01：点→线（真实 GPHLINE 设计辅助拾取 + 段内垂足 fixture）。
- [x] G4-02：点→平面（真实 GPHPLANE 设计辅助鼠标拾取 `1500mm / 0 / 1500mm / S`，与 DESIGNAID fixture 完全一致）。
- [x] G4-03：点→点退化。
- [x] G4-04：零距离返回未设 ARC（窗体走 `alert.warning`）；垂足落在有限边 / 平面片之外时按无限线、无限面投影，不截断。
- [x] G4-05：记录点退化结果的端点顺序、Distance / Vertical / Horizontal / Direction。
- [x] G4-06：进入 Perpendicular 后 dimension.wrt 静默回到 `/*`，控件文字保留旧 WRT；退出时经 `initialise()` 重新解析恢复旧 WRT。

### G5 · Shortest

> 2026-09-15 按 E3D 实际行为收口（决策 `d-616`，§32 静态 + §33 Web 实机）：方案 #10 已 ✓，下面五条只剩 E3D 侧对账补齐，不再卡任何 Web 工作。

- [ ] G5-01：点点、点线、点平面。——静态（§32）：产品入口下三种都退化成两拾中点的点点距离；`line.near` / `plane.near` 两支不可达。运行时只剩「Picking Control 字段确实被这个距离填上」一次走查。
- [ ] G5-02：平行线、相交线、异面线。——静态（§32）：不可达；代码口径已抄（无限线、平行取第一条线上拾中处）。运行时只剩 `isParallel` 容差。
- [ ] G5-03：线平面、平行平面、相交平面。——静态（§32）：不可达；代码口径已抄（不平行 → 零长；平行面那支 `posData[1].line` 未设、靠 `handle any` 退 `plane.position`）。
- [ ] G5-04：记录非唯一最近点对如何选择 witness。——静态（§32）：不可达；代码口径已抄；产品里不出 witness 图形，只写长度。
- [ ] G5-05：确认产品 UI 中实际可达的命令入口。——**静态已答（§32）**：Picking Control（`design.uic` 4168）各偏移字段右键 `Measure Shortest` + 固定直径圆辅助的直径字段；结果只填一个数，不是 Measure 功能区的测量工具。运行时只剩截图。

### G6 · Angle

- [x] G6-01：按 root / first / second 三点顺序测量。
- [x] G6-02：记录 Angle、Direction1、Direction2 和 WRT。
- [x] G6-03：0°、180°、second=first、second=root 均在内核返回未设 ARC（窗体走 `alert.error`）；0.1°/179.9° 接受；只报 minor 角，平面法向随拾取顺序翻转，无 reflex。
- [ ] G6-04：确认两图形角度测量是否为当前产品可达入口。

### G7 · Snap 候选与约束

- [ ] G7-01：PPOINT 与 Item/表面重叠，记录 hover 与 click 胜出候选。
- [ ] G7-02：PLINE、EDGE、PLANE、TUBING 各记录实际捕捉几何。
- [ ] G7-03：轴/平面/工作网格约束后，记录最终点是否仍位于原 feature。
- [ ] G7-04：模型或相机变化后点击，确认是否重算候选。

## 4. 单用例记录格式

```json
{
  "case_id": "G1-01",
  "status": "passed | failed | blocked | not_run",
  "target": {
    "product": "E3D 3.1",
    "exe_sha256": "",
    "core3d_sha256": "",
    "pml_sha256": {},
    "project": "AvevaMarineSample",
    "mdb": "/ALL",
    "module": "Design",
    "coord": "",
    "unit": "",
    "wrt": "World"
  },
  "sample": {
    "refno": "24381/145018",
    "feature_ids": [],
    "input_points": []
  },
  "steps": [],
  "static_expectation": "",
  "observation": {
    "prompt": [],
    "result_rows": [],
    "aid_geometry": "",
    "next_state": ""
  },
  "screenshots": [],
  "verdict": "",
  "blocker": null
}
```

## 5. Go / No-Go

- World 正交辅助图形：G0、G1、G2 通过后才能宣称 E3D 3.1 兼容。
- 普通元素 WRT：G3-01～G3-03 与后端 frame 数据契约同时通过。
- GENSEC：G3-04～G3-05 通过前 No-Go。
- Perpendicular：至少一个权威 LINE/PLANE provider 和 G4 通过后开放。
- Shortest：~~G5 与有限/无限范围语义确认前 No-Go。~~ 2026-09-15 按 E3D 实际行为收口（`d-616`）：产品里它是两拾中点距离，Web 距离测量 × Graphics 两击已覆盖（§32 / §33）。
- Angle 三点结果：G6-01～G6-03 通过；两图形模式单独审批。

## 6. 本轮执行记录

实际执行状态、文件身份、截图与阻塞信息写入同目录的
`capture-2026-09-11.json`。未运行项保留 `not_run`，不可删除。

## 7. 本轮执行摘要

- 已通过：G0、G1-01/02/03/05、G2-01/02、G3-01/03/04/05、
  G4-03/05、G6-01/02。
- 已做局部探针：Keep=true 的 close 回调后 AID 保留；Keep=false 回调清除 AID。
  尚未完成两次测量、切换工具和重新打开的完整生命周期序列，因此 G2-04/05
  仍保持未勾选。
- 标准距离实测：Distance `4845.41mm`；Offset
  `E -1920.14mm / N 400.28mm / U -4430.67mm`。
- Perpendicular 点退化实测：Distance `5446.6mm`；
  Vertical `5334.38mm`；Horizontal `1099.91mm`。
- 三点角度实测：`37.4013215953213°`；
  Direction1 `W 11.7755 N 66.8266 D`；
  Direction2 `W 12.9006 S 32.3892 D`。
- GENSEC `=23406/14` 实测：Offset 为
  `1920.14 / 400.28 / 4430.67mm` 非负投影距离；Direction 显示使用
  World，而同一方向在 GENSEC 中是另一组方向文字。
- 点→线/平面合成 `EDGPOSITIONDATA` 探针曾被
  `(2,754) Argument 1 to TRIM is unset` 阻断；根因是 `type='GRAPHICS'` 且
  `pLine` 未设时 `getLine()` 走入 pline 分支。

## 8. 2026-09-12 补采（02:19 真实拾取 + 10:08–10:18 运行时注入）

执行方式：E3D 主窗口当时最小化 / 被用户其它窗口遮挡，本轮不抢焦点，只通过运行中的
进程调用 UI 本身使用的 EDG action 与窗体回调（`setMeasure` /
`setPerpendicularMeasure` / `setUpForm` / `radius3PointsNoError` /
`perpendicularToPoint`），数值与判定表达式写入 trace；会弹 `!!alert` 的分支只读
代码、不触发。视口截图用 `printwindow-capture.ps1`（user32 `PrintWindow` +
`PW_RENDERFULLCONTENT`，对被遮挡窗口后台取图，不改焦点）配合 `view.limits` 临时
取景完成，取完由 `restore-after-visuals.pmlmac` 还原视图与窗体。所有宏、trace、
截图在同目录，明细见 `capture-2026-09-11.json`。

- **G4-01 真实点→线**（上一会话 02:25 完成，本轮入档）：GPHLINE 设计辅助经 EDG
  拾取，`pickData` 为 `DESIGNAID / aidType LINE / position Unset`；Distance
  `2549.51mm`、Vertical `2500mm`、Horizontal `500mm`、Direction `N 78.6901 U`。
- **G4-02 真实点→平面**（10:39–10:43，用户授权提前台）：GPHPOSITION 源球
  `E 8000 N 9000 U 16500` + 鼠标点在 GPHPLANE 轮廓线上，`pickData` 为
  `DESIGNAID / aidType LINE（轮廓图元）/ pPoint 10021 / position Unset`，
  `getLine()` 未设、`getPlane()` 命中注册的 PLANE；结果 Distance `1500mm`、
  Vertical `0mm`、Horizontal `1500mm`、Direction `S`，命令回到 start；截图
  `G4-02-real-plane-ready.png` / `-after-source.png` / `G4-02-real-point-to-plane.png`。
  与下面 fixture 同一用例完全一致。中途一次点击因窗口刚被最大化而落空，EDG 对空拾取
  不改状态。
- **G4-02 fixture / G4-04**：DESIGNAID fixture 对同一源点复现真实拾取结果逐位一致
  （2549.50975679639 / 2500.00028 / 499.99858），据此采集：平面片内 `1500mm /
  0 / 1500mm / S`、`1800mm / 0 / 1800mm / N`；平面片外 `1000mm`（无限面）；线段
  端点之外垂足 `E 12000` 不截断（无限线）；源点落在线/面上返回未设 ARC。端点带
  ~1e-3mm 漂移，来自 `radius2Points` 用格式化方向字串重建 ARC 朝向——golden 比对
  须带容差。截图 `G4-02-visual-point-to-plane.png`：平面片、源点球与一条标
  `1500mm` 的直接辅助线；Vertical 为 0 时 `draw(REAL, ARC)` 因 datum 与端点相距
  <1mm 而不画 Vertical/Horizontal 分解；窗体截图 `G4-02-visual-measure-form.png`。
- **G4-06**：进入 Perpendicular 后 `dimension.wrt` 静默变为 `/*`，Direction 按
  World 计算，禁用的 WRT 控件仍显示旧名；切回标准模式由 `initialise()` 重新解析
  控件文字，旧 WRT 自动恢复。
- **G3-02 旋转普通 WRT**：EQUI `/Copy-of-RCS151MM`（Y is E and Z is U）得
  `U -400.28 / V -1920.14 / W -4430.67mm`，Direction `S 11.7755 W 66.1215 D`；
  EQUI `/Copy-of-RCS616MD`（Y is U and Z is S 21 E）得
  `-1649.16 / -4430.67 / -1061.81mm`，Direction `S 20.416 W 12.6584 D`。
  两者与 `offset = Rᵀ·Δworld` 的独立投影最大差 2.3e-13mm；Distance 不变。
- **G2-03 0.1mm 抑制**：`offset.between(-0.1mm, 0.1mm)` 为真即抑制。0.09 → 抑制
  （截图 `G2-03-visual-dE0.09.png` 只有 `2236.07mm / N2000mm / U1000mm`），
  0.11 → 绘制（`G2-03-visual-dE0.11.png` 多出 `E0.11mm`）；名义 0.1
  （10000.1−10000 = 0.100000000000364）落在带外被绘制，−0.1 同理。结论：边界相等取决于
  浮点，测试只能断言带内 / 带外，不能断言恰在边界。
- **G1-04 零 / 负零**：0.004、−0.004、−0.00001 全部格式化为 `0mm`，无 `-0mm`；
  格式为 2 位小数并去尾零（`0.09mm`、`2000mm`、`2236.07mm`）。
- **细分线总闸门**（新发现）：Show linear 开启时，仅当
  `int(ΔE+ΔN+ΔU) ne int(length)` 才绘制正交分解；单一正向轴向测量
  （如 N +2000）只画直接线，不画分量（`G2-03-visual-axis-positive.png` 只有
  `2000mm`）；同样长度的负向（N −2000）则画分量（`G2-03-visual-axis-negative.png`
  中 `2000mm` 与 `N-2000mm` 叠在同一中点）。Show linear 关闭（orthogonalOnly）时
  分解线总是绘制。
  **决定（2026-09-12，按本轮 golden）**：Web 侧按观察到的规则原样复现，不做"改良"——
  `src/measurement/aids/worldDistanceAidPlan.ts` 新增 `shouldDrawWorldAxisBreakdown`
  （`!showDirect || trunc(sumMm) !== trunc(lengthMm)`，毫米截断前先吸掉 1e-6mm 的
  米→毫米换算噪声），`buildWorldDistanceAidPlan` 在 `showOrthogonal` 之后过这道闸门，
  `useXeokitMeasurementTools.syncFromStore` 改为把真实的 Show linear 传进去。理由：
  兼容目标是"与 E3D 3.1 逐行一致"，闸门的可观察效果（哪些辅助线出现）就是契约；负向
  单轴的重叠标签是 E3D 自身行为，要偏离它是另一条产品决策。vitest：G2-03 五行
  （0.09 抑制 / 0.11 绘制 / N+2000 无分解 / N−2000 有分解 / 3000·4000 有分解）+
  Show linear 关闭必画 + 换算噪声不翻转；`useXeokitMeasurementTools` 两条 +0.5m 单轴
  用例改为只出直接斜线。
- **G6-03 角度退化**：0°（同射线）、180°（反向射线）、second=first、second=root
  均使 `POSITION.plane()` 报 `(2,886) Plane lines derived from points are parallel`
  （或 `(2,892)` 重合点），`radius3PointsNoError` 返回未设 ARC，窗体走
  `alert.error('An angular dimension could not be constructed ...')`；
  `GPHANGLEDIMENSION.draw()` 的 `Angle 0` 分支在三点流程里不可达。0.1° / 179.9°
  正常接受并格式化为 `0.1` / `179.9`；90° 第二点在南侧时朝向翻转为
  `Y is S and Z is D`，角度仍报 90，不出现 270 反角。
- 仍为 No-Go：Shortest（G5）、Snap 候选消歧（G7）、Keep 完整生命周期
  （G2-04/05）、两图形角度入口（G6-04）。

## 9. Web 侧 golden 用例（vitest，2026-09-12）

| golden | Web 被测对象 | 测试文件 |
| --- | --- | --- |
| G2-03 0.1mm 抑制 / int(sum) 闸门 | `buildWorldDistanceAidPlan`、`shouldDrawWorldAxisBreakdown` | `src/measurement/aids/worldDistanceAidPlan.test.ts` |
| G3-02 旋转普通 WRT（两件 EQUI，Rᵀ·Δ、U/V/W、from/to 局部坐标、方向） | `ReferenceFrameResolver` + `computeDistanceMeasurementResultInFrame` + `buildDistanceMeasurementResultRows` | `src/measurement/reference-frame/e3dRotatedWrt.golden.test.ts` |
| G4-01/02/03/04/06 Perpendicular（无限线/面、World 帧、零距离、点退化） | 纯内核 `computePerpendicularDistance`（`src/measurement/kernel/perpendicularDistance.ts`）+ 目标 provider `resolvePerpendicularTarget`（P-Point 方向→无限线、圆面→无限面、否则点）+ 腿 `buildPerpendicularAidPlan`；已接入 `useXeokitMeasurementTools`（样式开关 `perpendicularTo`，结果表 `buildPerpendicularMeasurementResultRows`） | `perpendicularDistance.test.ts`、`perpendicularTargetProvider.test.ts`、`aids/perpendicularAidPlan.test.ts`、`useXeokitMeasurementTools.test.ts`（点退化 + P-Point 轴线两条流程）、`MeasurementResultInspector.test.ts` |
| G6-01/02/03 三点角度（0°/180°/重合拒绝、minor 角、法向随拾取顺序翻转、0.1°/179.9°） | 纯内核 `buildThreePointAngle`（`src/measurement/kernel/threePointAngle.ts`）；**2026-09-14 已接入 UI**（`buildAngleMeasurementResultRows` + 第三击拒收，§22） | `src/measurement/kernel/threePointAngle.test.ts`、`src/utils/xeokitMeasurementFormat.test.ts`、`src/composables/useXeokitMeasurementTools.test.ts` |

E3D 的方向字串（如 `S 11.7755 W 66.1215 D`）在用例里按 PDMS 罗盘约定换成单位向量比对；
数值容差 0.01mm（E3D 结果端点带 ~1e-3mm 的 ARC 重建漂移）。

## 10. Web 实机走查 · Perpendicular to（2026-09-12 12:28）

环境：dev server `:3101` + gen-model 0.1.22 `:8022`，`?show_refno=24381_145018`，Playwright（Chrome）
真实指针事件：测量 Dock → `距离` → 勾选 `Perpendicular to` → 自由表面模式点表面点 → 切回 E3D 模式
扫描表面像素、以工具自身的指针透镜文字确认捕捉目标 → 点击。

- **可走通的路径：表面点 → Item 原点（点退化，G4-03 语义）**。记录 `perpendicular.targetKind = point`、
  `targetLabel = Item 原点 24381_145028`；结果表 `Distance 1893mm（近似）/ Vertical 1873mm /
  Horizontal 276mm / Direction X +0.0252 · Y -0.1435 · Z +0.9893`，`wrt: World（垂距模式固定）`；
  按持久化记录的设计坐标独立复算 1893.03 / 1872.83 / 275.82mm 一致。图形：直接线 `1893 mm`
  + 竖直腿 `1873 mm` + 水平腿 `276 mm` 的直角分解。截图 `web-perpendicular-live-01-source.png`
  … `-05-legs-zoom.png`。
- **P-Point 轴线（点→无限线）在本环境走不通，不是代码问题**：当前模型包不含 `ptsets.parquet`
  与 `primitive_keypoints.parquet`（`当前模型包未包含 …，ptset 测量不可用`），语义 snap 点为空，
  运行时回退 `/api/pdms/ptset/24381_145031?dbno=7997`（:3100，standalone-real）返回
  `MODEL_REFNO_NOT_FOUND`。扫描全部 102 个表面像素时透镜只出现 `Item 原点 24381_1450xx`，
  从未出现 `P-Point`。要走真实点→线，需要带 ptsets / primitive keypoints 的模型包或可用的 ptset 服务；
  该路径目前由 `useXeokitMeasurementTools.test.ts` 的 P-Point dir=+Z 流程用例覆盖。
  → **2026-09-12 14:18 已走通**，见 §11：P-Point 改经 gen-model `POST /api/v1/element/ptset` 取，不再依赖模型包。
- 顺带确认：E3D 拾取模式下普通表面点不锁定为起点（只锁 P-Point / Item 原点），需切自由表面模式才能以
  表面点作起点。

## 11. P-Point 改走 API（gen-model `element/ptset`）+ 实机 表面点 → P-Point 轴线（2026-09-12 14:18）

**改动口径**：测量的关键点取数从「模型包 parquet」改成「API 请求」，经模型数据源端口
`getModelSource().keypoints`（`src/model-source/ports.ts` `KeypointSource`）：

- `gen-model-v1`（缺省源）：`POST /api/v1/element/ptset { refno, include_members }`（`src/model-source/genModelV1/keypointSource.ts`
  → `PtsetResponse` / `PtsetChildrenResponse`，与旧后端契约同形，`usePtsetSnap` / 可视化 / `ptsetTransform` 一行不改）。
  服务端是 gen-model 新端点（分支 `feature/element-ptset-api`，`src/web_service/ptset.rs`，spec §4.11.1）：**不经投影、不连库**，
  直读 dabacon 走 e3d-model 目录链 `SPRE → SCOM → PTRE → PTSE`（新增公开函数 `e3d_model::catalogue_point_set`），
  回局部系 mm 点 + 列主序世界矩阵。基本体 / PLINE 关键点服务端尚无接口：适配器回空并给出原因（提示条可见），P-Point 捕捉不受影响。
- `legacy`：`ptsets.parquet` 优先、`:3100 /api/pdms/ptset` 兜底，与改动前逐字相同（挪进 `src/model-source/legacy/index.ts`）。

**服务端 golden（41 个 P 点 · 0 不符）**：在运行中的 E3D 3.1（PID 32452）用 `G8-ptset-api-e3d-ppoints.pmlmac`
对 BRAN `=24381/145018` 的 5 个成员（ELBO ×2、ATTA、OLET、VALV 含手轮 PTCA 点）逐个 `Q Pn POS/DIR/BORE WRT /*`
（`G8-ptset-api-e3d-ppoints.trace.txt`），与 `element/ptset` 的局部点 × 世界矩阵逐点比对（`G8-ptset-api-compare-e3d.ps1`
→ `G8-ptset-api-compare.txt`）：**compared=41 mismatches=0，位置最大差 0.00066 mm（E3D 打印 3 位小数），
方向最大差 2.1e-5（E3D 角度打印 6 位有效数字），bore 全等**；E3D 报的 P0（元素原点）API 不列，VALV P27 两边都没有。

**Web 实机走查（dev `:3101` + 本轮构建的 gen-model `:8023`，`?show_refno=24381_145018&gm_backend_port=8023`，Playwright 真指针）**：
测量 Dock → `距离` → 勾 `Perpendicular to` → 自由表面模式取 **TUBI 表面点**（透镜「模型表面点」；已吸到 P-Point 的像素跳过）→
切 E3D 模式悬停 → 透镜 `P-Point #1` → 点击。

- 网络：3 发 `POST http://localhost:8023/api/v1/element/ptset`（`{"refno":"24381/145035"}` 等），200，VALV 31 点 / ELBO 2 点；
  没有任何 parquet / `:3100` ptset 请求。
- 记录：起点 `mesh_pick_point`（o:24381_145018:6，设计坐标 `7893.756 / 10483.003 / 15301.672 mm`），
  终点 `ptset:24381_145031#1` 轴线垂足 `7849.850 / 10499.705 / 18650.051 mm`，`perpendicular = { targetKind: 'line', targetLabel: 'P-Point #1 轴线' }`。
- 结果表：`Distance 3349mm（近似）/ Vertical 3348mm / Horizontal 47mm / Direction X +0.0131 · Y -0.0050 · Z -0.9999`，
  `wrt: World（垂距模式固定）`，面板 `Perpendicular to · 点→无限线 · P-Point #1 轴线`。
- 独立复算（用 E3D golden 里 ELBO 145031 的 P1 `E 7849.85 N 9298.628 U 18656.042`、`N 0.285797 D`）：垂足
  `(7849.85, 10499.70, 18650.05)`、距离 3348.7、竖直 3348.4、水平 47.0、方向 `(0.0131, -0.0050, -0.9999)`——与面板一致。
- 图形：直接线 `3349 mm` + 竖直腿 `3348 mm` + 水平腿 `47 mm`（`web-ptset-api-live-05-legs-zoom.png`）。
  截图 `web-ptset-api-live-01-loaded.png` … `-04-result.png`，网络与记录 `web-ptset-api-live-network.json`。
- 起点吸附一则：自由表面模式下 P-Point 到位后同样优先捕捉（与 E3D 相同），所以要拿真表面点须等 P-Point 落地后再看透镜。

未做：Primitive Key Point / PLINE 语义关键点在 gen-model-v1 下仍无 API（服务端只存烘好的网格、无基本体分解），
提示条显示原因；legacy 源照旧读 parquet。

## 12. 拾取层 Phase A · Graphics 过滤器（网格派生边 / 面）实机走查（2026-09-13 12:11）

**改动口径**（方案 `2026-09-12-e3d-measure-parity-plan.md` Phase A 切片 2，提交 `001b302` / `6ca770a`）：

- E3D `EDGPICK.stdGraphics`（`inMode = 'pickdetail'`）拾的是绘制细节：facet 边 → `3D_LINE`（`getLine()`）、facet → `PLANE`（`getPlane()`）。
  Web 从 DTX 已加载的三角网格派生（`src/measurement/graphics/meshFeatureGraphics.ts`）：边界边 / 非流形边 / 二面角 ≥ 30° 的边
  判为绘制边，度 2 顶点处的共线段合并；面取命中三角形所在平面 + BFS 共面片轮廓。新点源 `mesh_graphics`（缺省 show=false /
  snap=true / 12px）：射线 12px 内有绘制边 → 边候选（worldPos 落在边上离射线最近处，`segment` + `direction`）；否则一个面候选
  （worldPos = 命中点，`plane` + `outline`）。
- 拾取过滤器 `Any` 改按 E3D `stdAny` 口径「Standard pick interpreter for **Element, Ppoint or Pline**」（+ Web 表面点），不放行
  graphics / aid / external；Graphics 细节只在 Graphics 过滤器下参与。`Graphics` 过滤器改为可用；覆盖条设置弹层补上
  过滤器 × 拾取类型 radio 组、取值输入与 Significant snaps。
- 拾取类型内核对面候选走 `plane` 分支（所有单击类型回 射线 ∩ 平面）；Perpendicular to 新增 `facet-plane` provider（E3D `getPlane()` 分支）。

**证据等级**：以下 Web 行为均为 `static_expectation`（依据 `edgpick.pmlobj` `stdAny` / `stdGraphics` 注释与 `edgpicktype.pmlobj` `snap()`
的 `GRAPHICS` 分支）；E3D 运行时 golden **G7-02（EDGE / PLANE 实际捕捉几何）与 G8（拾取类型）本轮未采——E3D 3.1 进程不在运行**，
不得据此宣称「与 E3D 一致」。

**Web 实机走查**（dev `:3101` + gen-model `:8023`，`?show_refno=24381_145018&gm_backend_port=8023`，Playwright 真指针；
临时 spec 已删）：测量 Dock → `距离` → 设置弹层 → 拾取过滤器 `Graphics`（摘要行 `Graphics · Snap`）→ 10px 步长扫描模型区 →
以覆盖条提示文字确认捕捉目标 → 点面、点边。

- 提示条：切 Graphics 前 `距离测量 · 第 1/2 步 选择起点 (Snap) Snap : 等待捕捉（P-Point / Item 原点）`，切后
  `… : 等待捕捉（网格边 / 面（Graphics））`——过滤器不放行的点源不再算「已开」。
- 扫描 132 个像素：面候选 4（`TUBI 面`）、边候选 4（`TUBI 边`）、另见 `VALV 边 · Snap` / `ELBO 边 · Snap`（Snap 把控制点吸到边的近端，
  派生标记 `· Snap`）；P-Point / Item 原点在 Graphics 过滤器下**一次都没出现**（`Any` 不放行 graphics、`Graphics` 不放行 ppoint / element 的对偶）。
- 记录（`web-graphics-live-records.json`）：起点 `graphics:o:24381_145018:7:facet:0`（`mesh_graphics` / `面`，设计坐标
  `7885.979 / 10314.785 / 18694.671 mm`），终点 `graphics:o:24381_145018:5:edge:43`（`边`，`7800.357 / 11758.915 / 16892.524 mm`）。
- 结果表：`Distance 2311mm / Offset X -86mm / Y +1444mm / Z -1802mm / Direction X -0.0371 · Y +0.6249 · Z -0.7798 / 起点 → 终点 面 → 边`，
  列表条目带 `近似`（`mesh_graphics` 归 `model-surface` / approximate，网格是渲染细分不是设计曲面）。
  独立复算：Δ = (−85.62, +1444.13, −1802.15) mm，|Δ| = 2311.0 mm，方向 (−0.0371, 0.6249, −0.7798)——与面板一致。
- 截图 `web-graphics-live-01-pick-layer-popover.png`（弹层控件）、`-02-hover-facet.png`、`-03-hover-edge.png`、`-04-result.png`；
  扫描日志 `web-graphics-live-scan.txt`。
- 单测：`meshFeatureGraphics.test.ts` 13 条（盒 12 棱 / 矩阵 / 共线合并 / 非流形不合并 / 8 段圆柱母线 vs 36 段只剩圆周 / 面片 / 退化）、
  `pickLayerModel.test.ts` 8 条（Any / Graphics / Element+Cursor 放行表、提示 token、归一化）、`buildGraphicsPickCandidates` 3 条、
  `MeasurementOverlayBar.test.ts` 拾取层控件 1 条；测量相关 vitest 30 文件 / 322 用例过。

未做：`element/keypoints` / `element/plines` 服务端接口（gen-model-v1 下 Element 显著点 / PLINE 仍无供给）；TUBING 轴线点前端派生；
G7 / G8 / G9 运行时 golden。Intersect 流程见 §13。

## 13. 拾取层 Phase A · Intersect 拾取类型（两 / 三次子拾取求交）实机走查（2026-09-13 12:47）

**改动口径**（提交 `e91b30e`）：E3D `EDGPICKTYPE.intersect` + `EDGSTATE.minor`——一个测量位置由多次子拾取求交得到。
纯状态机 `src/measurement/kernel/intersectPickSession.ts`：子拾取按 E3D 分型转 LINE / PLANE（段 → 线、面 → 平面、P-Point /
基本体轴 → POINTVECTOR 线、裸点 → 拒收不消耗）；首项入栈、提示推到 `Intersection[2]`；两项求交，两面要第三项（`Intersection[3]`）；
线 × 线 / 线 × 面平行 → `(2,870)` 只丢失败那一击；三面无唯一交点 → `(2,874)` 会话清空；异面直线取第一条线上最近点（`LINE.intersection`）。
工具侧：`pointerup` 走子拾取，凑齐才把交点（label「交点」，几何字段清空）当成这一击的测量点；已有子拾取时悬停用当前项试算交点做预览；
Esc 分层第一档「先放弃进行中的子拾取」；换拾取类型 / 过滤器重置。

**证据等级**：`static_expectation`（`edgpicktype.pmlobj` 616–960、`edgstate.pmlobj` 455–500）；**G8 Intersect 运行时 golden 未采**（E3D 未在跑）。

**Web 实机走查**（同 §12 环境，Playwright 真指针；临时 spec 已删）：设置弹层 → 过滤器 `Graphics` + 拾取类型 `Intersect`（摘要 `Graphics · Intersect`）。

- 提示条：`距离测量 · 第 1/2 步 选择起点 (Intersection[1]) Snap : 等待捕捉（网格边 / 面（Graphics））`。
- 子拾取 1 点 `ELBO 边` → **不落点**，提示变 `… 第 1/2 步 … (Intersection[2]) Snap : ELBO 边`（`web-intersect-live-02-after-subpick-1.png`）。
- 悬停另一条 `VALV 边` → 透镜 / 提示给 `VALV 交点（预览）`；点击 → 交点成为起点，提示 `… 第 2/2 步 选择终点 (Intersection[1]) Snap : …`
  （`web-intersect-live-03-intersection-start.png`），下一测量点的子拾取序号回到 1。
- 扫描日志 `web-intersect-live-scan.txt`（16 个边像素样本）。
- 单测：`intersectPickSession.test.ts` 12 条；`useXeokitMeasurementTools.test.ts` 新增 3 条（Graphics 边 / 面落点 + Any 不放行、线 × 线两次子拾取
  出角点 + `(2,870)` 保留首项 + Esc 分层、面 × 面 × 线 `(2,874)` 清空 + 换类型重置）。

## 14. 拾取层 Phase A · TUBING 轴线（前端从直管放置矩阵派生 + 端点吸邻接 P-Point）实机走查（2026-09-13 21:30）

**改动口径**：E3D `EDGTUBING`（`edgtubing.pmlobj`）把隐含管当**一条线**拾：`line(dbRef, 'LEAVE')` 从构件 `lPosition` 到下一个非 ATTA 成员的
`aPosition`（注释明说用邻接构件的到达位置而不是隐含管长，「handles bad alignment between components correctly」）；`snap()` = 拾取线 ∩ 管线后取
**近端**，`exact()` = 交点本身，`distance / proportion / fraction` = `GMFLINE` 从交点起算，`intersect` 把它当 LINE 操作数；3.1 的 `lineExtended` 就是
`line`，Significant Snaps（`extended`）对 TUBING 不起作用。Web 没有分支拓扑，但有画出来的直管：

- 纯内核 `src/measurement/tubing/tubingAxis.ts`：`tubingAxisFromBounds`（局部包围盒 × 放置矩阵 → 轴线段 + 半径；对 gen-model 直管 = 局部圆柱
  半径 1、`z ∈ [0, 1]`，矩阵缩放 `(r, r, L)` 米）、`refineTubingAxisEnds`（两端各吸到容差内最近的邻接 P-Point，一点只服务一端，吸成零长即放弃）、
  `tubingEndTolerance`（max(设计 2 mm, 5 % 半径)）。
- 新点源 `tubing_axis`（特征类 `tubing`；缺省 show=false / snap=true / 18 px / priority 25，介于 P-Point 20 与 Item 原点 30 之间）：射线命中直管对象
  （loader 登记 noun `TUBI` / gen-model `is_tubi`）时产出**一条线候选**——控制点 = 轴线上离射线最近处（`EDGTUBING.exact`），`segment` = 整条轴线，
  `direction` = 轴向，标 `rayHit`（E3D 在管身任何位置都回 TUBING，所以候选按孔径边缘入围，光标离轴线更近时用真实投影距离；孔径内的 P-Point 仍赢）。
  拾取类型内核照线候选走：Snap 近端、Cursor 控制点、Mid-Point / Fraction / Proportion / Distance 沿轴线、Intersect 转 LINE；Perpendicular to 得到轴向 provider。
- 过滤器准入：**Any 与 Element 放行、Pline / Ppoint / Graphics 不放行**——E3D 只在元素类拾取模式（`pany` / `pick`）经 `EDGPICKDATA.viewData` 的
  `data[1] = 'TUBING'` 回隐含管，`stdPline`（`inMode = 'pline'`）不拾它。用户 2026-09-13 14:27 的措辞是「管身轴线段进 Pline 类候选」，这里按「线类候选
  （有两端点的拾中几何，与 PLINE 同一派生路径）」实现、**归 Element 特征类而不是 Pline 过滤器**，属有意偏离；用户 22:05 确认「照 E3D 维持 Any / Element 放行、Pline 不放行」（决策 `d-318`，ADR 0060（4））。
- 标签裸给「轴线（<起点 P-Point> → <终点 P-Point>）」，命令条按既有规则补元素类型 → `TUBI 轴线（ELBO P-Point #1 → ELBO P-Point #2） · Snap`；
  拾中的整条轴线在场景里高亮（同 Graphics 细节）。

**证据等级**：`static_expectation`（`edgtubing.pmlobj` 149–228 / 308–334 / 589–604、`edgpicktype.pmlobj` 358 / 509 / 739 / 1019 / 1165 / 1306、
`edgpickdata.pmlobj` 35 / 92）；**G7-02 TUBING 实际捕捉几何运行时 golden 未采**（E3D 未在跑）。唯一能对上 E3D 数字的是 §11 已采的
ELBO 145031 P1（见下「独立复算」）。

**Web 实机走查**（dev `:3101` + gen-model `:8023`（`%TEMP%\ptset-api-run`，本轮重新拉起），`?show_refno=24381_145018&gm_backend_port=8023`，
Playwright 真指针；临时 spec 已删）：测量 → `距离`（缺省 `Any · Snap`）→ 按 `getObjectGeometryData` 局部包围盒识别 11 根直管对象
（`o:24381_145018:0…10`，半径 57.15 mm，长 416～2556 mm）→ 悬停最长两根的轴线中点 → 两击 → 换拾取类型 / 过滤器复验。

- 提示条：`距离测量 · 第 1/2 步 选择起点 (Snap) Snap : 等待捕捉（P-Point / Item 原点 / 管身轴线（TUBING））`；悬停直管 →
  `… : TUBI 轴线（ELBO P-Point #1 → ELBO P-Point #2） · Snap`（两端都吸到了邻接 ELBO 的 P-Point；`web-tubing-live-01-hover-axis.png`）。
- **Any × Snap**：起点直管 `o:…:7` 近端、终点直管 `o:…:6` 近端 → `Distance 4568mm / Offset X -0mm / Y -1189mm / Z -4410mm /
  Direction X -0.0001 · Y -0.2603 · Z -0.9655`（`web-tubing-live-02-snap-result.png`）。记录设计坐标：起点 `7849.850 / 11636.248 / 18644.385 mm`，
  终点 `7849.610 / 10447.460 / 14234.126 mm`。
- **Any × Mid-Point**：同两根直管 → `Distance 3242mm / Offset X -0mm / Y -20mm / Z -3241mm / Direction X -0.0001 · Y -0.0062 · Z -1.0000`
  （`web-tubing-live-03-hover-midpoint.png`、`-04-midpoint-result.png`）；起点 `7849.850 / 10467.438 / 18650.214 mm`，终点 `7849.610 / 10447.460 / 15408.741 mm`。
- **Cursor**：标签不带派生标记 `… (Cursor) Snap : TUBI 轴线（ELBO P-Point #1 → ELBO P-Point #2）`。
- **对偶**：`Pline` → `等待取点`（v1 下无 PLINE 点源，轴线不出现）；`Graphics` → `TUBI 面`（网格面，轴线不出现）；`Ppoint` → `等待捕捉（P-Point）`；
  `Element` / `Any` → 轴线。
- 网络：2 发 `POST :8023/api/v1/element/ptset`（`24381/145018` 与 `include_members`），P-Point 落地后端点校正生效。
- 记录 `web-tubing-live-records.json`（两根直管的场景坐标轴线 + 两条记录），扫描日志 `web-tubing-live-scan.txt`。

**独立复算**：
- Snap：Δ = (−0.240, −1188.788, −4410.259) mm → |Δ| = 4567.7 mm，方向 (−0.0001, −0.2603, −0.9655)——与面板一致。
- Mid-Point：Δ = (−0.240, −19.978, −3241.473) mm → 3241.5 mm，方向 (−0.0001, −0.0062, −1.0000)——一致。
- 直管 `o:…:7` 的另一端 = 2 × 中点 − Snap 端 = `(7849.850, 9298.628, 18656.043)`，与 §11 E3D 实机 `Q P1 POS` 的 ELBO 145031 P1
  `E 7849.85 N 9298.628 U 18656.042` 差 0.001 mm（E3D 打印 3 位小数）——校正后的轴线端点就是 E3D 的 P-Point；轴长 2337.6 mm 与放置矩阵
  `scale.z = 2.3376` 一致（gen-model 画的直管已经落在 P-Point 上，端点校正位移 < 2 mm 容差）。

**已知偏离 / 未做**：
- ~~E3D `line()` 跳过 ATTA（管线从构件 leave 直到下一个非 ATTA 构件的 arrive），Web 的直管对象在 ATTA 处是断开的两段，各自派生轴线；
  Snap / Cursor 不受影响，Mid-Point / Fraction / Proportion 在带 ATTA 的一段上与 E3D 不同（未合并）。~~ **2026-09-13 22:48 实机核对后撤回**：
  gen-model 画直管时本就跳过非 SPKBRK 的 ATTA（§15），这根 BRAN 的 6 个 ATTA 全在直管轴线内部；SPKBRK 断开的两段现由前端合并（§15）。
- BRAN HEAD 管（`hPosition → 首个非 ATTA 成员 aPosition`）与 LEAVE 管同一处理，无区别对待。
- 测量列表条目的「近似」徽标来自 xeokit 记录缺 `provenance`（`legacy-unknown` → approximate），不是 TUBING 的精度判定（`tubing_axis` 在
  `dtxDimensionSnapPort` 归 exact）；~~该徽标对所有 xeokit 记录都亮，属既有行为~~ **2026-09-16 起距离记录按本轮算到的精度写
  `provenance`（`semantic-point-pair` / `point-to-triangle-mesh`，近似的仍不写）**，徽标与结果卡一致；角度 / 标高 / classic 记录照旧全亮（§37 (1-b)）。
- 完成一条测量后，尺寸系统在 capture 阶段接管其描边上的 `pointermove`（`viewerBindings.ts` `stopImmediatePropagation`），悬停在刚量过的
  轴线上不再刷新捕捉提示；走查时先删记录再进下一场景。
- G7-02 TUBING 运行时 golden 未采；`element/keypoints` / `element/plines` 服务端仍未做。

## 15. 拾取层 Phase A · TUBING 轴线 × ATTA（`EDGTUBING.line` 跳 ATTA：断开的直管段合成一条线）实机走查（2026-09-13 22:48）

**改动口径**（`edfb0b0`；决策 `d-331` 取代 `d-318`，ADR 0060（4）同步）：E3D `EDGTUBING.line(dbRef, 'LEAVE')` 找管线远端时 `skip if(!component.type inset('ATTA'))`——管线从构件 `lPosition`
直到**下一个非 ATTA 成员**的 `aPosition`，HEAD 管同理（`edgtubing.pmlobj` 182–228）。Web 的对应：

- 内核 `src/measurement/tubing/tubingAxis.ts`：`TubingAxisEndPoint.noun`；`TUBING_PASS_THROUGH_NOUNS = {ATTA}` / `isTubingPassThroughPoint`；
  `mergeTubingAxisAcrossPassThrough(hit, others, {tolerance, minCos = cos 0.5°, isPassThrough})`——拾中段某端校正到穿过点时，在同构件其余共线段里
  找端点相接（容差内）且伸向远侧的一段接上，从其远端继续，双向，直到端点是真构件点或无段可接（保留 ATTA 端，同 E3D 回落 `tPosition`）；
  段只用一次、多段相接取端点最近者；**非 ATTA 的零长构件（OLET arrive = leave）不穿过**——E3D 的线在它那里停。返回 `pieces`（起→止）与 `passThrough`。
- 接线 `useXeokitMeasurementTools.buildTubingAxisCandidates`：拾中段某端落在 ATTA 上才去列同构件其它直管（`listTubingObjectIds` 注入点，缺省
  loader `listDtxTubiObjectIdsForRefno`）、逐段派生 + 校正后合并；候选 id / objectId 仍是拾中段，`segment` 是合并后整条线（高亮随之整条）。
- **认出 ATTA 靠点集响应透传的 noun**：ATTA 没有几何、不在 DTX 登记里，`nounForRefno` 原先对它回 null。现在 gen-model-v1 `element/ptset`
  的 `noun` 一路带到 `PtsetResponse.noun` / `results[].noun` / `PtsetSceneCandidate.noun`，端点 noun 优先取它；`nounForRefno` 也回落到
  `ptsetResponseByRefno` 里的 noun——Ppoint 过滤器正对 ATTA 的提示从「P-Point #1」变成「ATTA P-Point #1」（E3D `Snap :ATTA`）。legacy 源为 null。

**事实核对（改变了 §14 的一条「已知偏离」）**：gen-model 画直管时**本就跳过 ATTA**——`gen-model-ptset-api/src/fast_model/cata_model.rs` ~1548：
`skip = (arrive_type == "ATTA" || "STIF" || "BRCO") && !SPKBRK`，即非预制分段（SPKBRK）的 ATTA / STIF / BRCO 不断管。实机 BRAN 24381_145018
（成员序 `ELBO ATTA ELBO ATTA ELBO ATTA ELBO ELBO ATTA ELBO ELBO ATTA ELBO OLET ELBO ATTA VALV`）：11 根直管两端全部落在**非 ATTA** 构件的 P-Point 上
（≤ 0.01 mm；HEAD 管 `o:…:8` 一端是 ELBO#1 P1、另一端 1682.9 mm 外无 P-Point = 分支 head），**6 个 ATTA 全部在某根直管轴线内部**（t 0.271–0.616，
点到轴线 ≤ 1.96 mm），落在 ATTA 上的直管端点 0 个；OLET#14 两侧是两根直管（`o:…:2` / `o:…:3`，与 E3D 一致：OLET 不跳）。本库 `search?query=ATTA`
的 169 个 ATTA 逐个查 `element/attributes`，**无一 SPKBRK = true**——运行时没有「ATTA 处断开」的样本，§14 写的「Web 直管在 ATTA 处是断开的两段」
是当时未经实机核对的假设，撤回。合并路径只在 SPKBRK 断管处起作用，证据 = 单测 + 下面「页内内核复算」。

**证据等级**：`static_expectation`（`edgtubing.pmlobj` 182–228 的 ATTA 跳过；`cata_model.rs` 的断管规则）；G7-02 TUBING 运行时 golden 仍未采。

**Web 实机走查**（dev `:3101` + gen-model `:8023`，`?show_refno=24381_145018&gm_backend_port=8023`，Playwright 真指针；临时 spec 已删）：
走查对象 = 跨 ATTA 的最长直管 `o:24381_145018:1`（2555.621 mm，轴线 ELBO#7 P1 → ELBO#5 P2，ATTA 145024 在 t = 0.616 处），悬停点取 t = 0.416
（正对 ATTA 时 ATTA 的 P-Point 在孔径内会赢，见 Ppoint 一条）。

- **Any × Snap**：悬停 → `TUBI 轴线（ELBO P-Point #1 → ELBO P-Point #2） · Snap`（标签两端都是 ELBO，ATTA 不出现；`web-tubing-atta-live-01-hover-axis-at-atta.png`）；
  点击 → 起点 `7739.697 / 10343.156 / 14082.127 mm` = 近端 ELBO#7 P1（**0.000 mm**），离 ATTA 1573.3 mm；终点取直管 `o:…:7` 中段 Snap →
  `Distance 4743mm / Offset X +110mm / Y +1293mm / Z +4562mm / Direction X +0.0232 · Y +0.2726 · Z +0.9618`（`-02-snap-result.png`），
  终点 `7849.850 / 11636.248 / 18644.385 mm`（= §14 的 ELBO 145031 侧端点）。
- **Any × Mid-Point**：同一悬停点点击 → `6812.809 / 9463.575 / 14078.142 mm` = **整条线**（ELBO#7 P1 ↔ ELBO#5 P2）的中点（**0.000 mm**），
  离「起点—ATTA」半段中点 491.2 mm、离「ATTA—终点」半段中点 786.6 mm（`-03-hover-midpoint-at-atta.png`）；终点直管 `o:…:7` 中点 →
  `Distance 4794mm / Offset X +1037mm / Y +1004mm / Z +4572mm / Direction X +0.2163 · Y +0.2094 · Z +0.9536`（`-04-midpoint-result.png`）。
- **Ppoint × Snap 正对 ATTA**：`Snap : ATTA P-Point #1`（`hoverSnapTarget.refno = 24381_145024`；`-05-ppoint-filter-atta.png`）——noun 透传生效。
- **页内内核复算**（`import('/src/measurement/tubing/tubingAxis.ts')`，实机场景坐标 + 全部成员 P-Point 带 noun）：容差 2.858 mm（5 % × 57.15）；
  把 `o:…:1` 的轴线在 ATTA 处切成两段 → 校正后 A = `ELBO P-Point #1 → ATTA P-Point #2`（noun ATTA）、B = `ATTA P-Point #2 → ELBO P-Point #2` →
  合并 `pieces ["a","b"]`、`passThrough ["ATTA P-Point #2"]`、两端与整条轴线 Δ **0.0000 mm**；OLET 两侧的 `o:…:2` / `o:…:3` 经同一函数
  **不合并**（`pieces` 只有自己，端点 `ELBO P-Point #2 → OLET P-Point #1`）。
- 记录 `web-tubing-atta-live-records.json`（成员点、11 根直管两端归属与跨越的 ATTA、两条记录、内核复算），扫描日志 `web-tubing-atta-live-scan.txt`；页面错误 0。

**独立复算**：
- Snap：Δ = (110.153, 1293.092, 4562.258) mm → 4743.25 mm，方向 (0.0232, 0.2726, 0.9618)——与面板一致。
- Mid-Point：起点 = ((7739.697 + 5885.922) / 2, (10343.156 + 8583.994) / 2, (14082.127 + 14074.156) / 2) = (6812.809, 9463.575, 14078.142)，
  与记录逐位相同；Δ = (1037.041, 1003.863, 4572.072) mm → 4794.5 mm，方向 (0.2163, 0.2094, 0.9536)——一致。

**残余偏离 / 未做**：
- gen-model 还跳过非 SPKBRK 的 **STIF / BRCO**，而 E3D 3.1 `line()` 只跳 ATTA：在这两类构件处 Web 的直管（因而轴线）比 E3D 的管线长；本库未见样本，未处理
  （要做是「按 P-Point 截断」，与本节的合并相反）。
- SPKBRK ATTA 的运行时样本缺（本库 0 个），合并只有单测与内核复算证据；G7-02 未采。
- BRAN HEAD 管与 LEAVE 管同一处理，不区分。

## 16. 拾取层 Phase A · Element 元素当 Intersect / Perpendicular 操作数（E3D `line()` = P1 → P2）实机走查（2026-09-14 00:33）

**改动口径**（`79b199c`；决策 `d-373`，Q5 拍板 `d-336` 的前端后续，ADR 0060（5）同步）：E3D `EDGPICKTYPE.intersect`（`edgpicktype.pmlobj` 631）与
`edgpositiondata.line()` 对 **ELEMENT** 类型的拾取调 `edgTypes.attribute(fullType).line(item)`；实现 `line(DBREF)` 的 handler 只有
`EDGCYLINDER`（CYLI / NCYL / SLCY / NSLC）、`EDGDISH`（DISH / NDIS）、`EDGSNOUT`（CONE / NCON / SNOU / NSNO）、`EDGNOZZLE`（NOZZ）、`EDGPYRAMID`
（PYRA / NPYR），**全部回 `pPosition[1] → pPosition[2]`**（World）；ELBO / BEND / RTOR / CTOR 只有 `arc()`，BOX / VALV / FLAN / TEE 没有 handler →
`handle any` 拒收（"Unable to convert item into a line or plane for intersection"）。Snap 不受影响——ELEMENT 的 `snap()` 对这些元素回落元素原点（§7 Q5 / `d-336`）。

- 内核 `src/measurement/kernel/elementLine.ts`：`elementHasE3dLine` / `elementLineFromPPoints(noun, points)`（ptset 的 P1 → P2）；
  `elementLineBoundsRule` / `elementLineAcceptsLocalBounds`——gen-model-v1 `element/ptset` 只解目录 PTSE，**设计基本体没有点**（本库 CYLI / CONE / DISH /
  PYRA 全部 `points = 0`，无目录的 NOZZ 也是）。gen-model 把设计基本体画在**基本体自己的局部帧**（`fast_model/mesh_primitives.rs`：CYLI 单位圆柱实例
  z ∈ [0, 1]；CONE / SNOU `gen_snout` 端环 z = ∓HEIG/2、XOFF / YOFF 两端各摊一半；DISH 底面 z = 0、顶点 z = HEIG；PYRA `gen_pyramid` 同 snout）× 放置矩阵，
  E3D 的 P1 / P2 都在两端面中心，所以**截面对中于局部原点时局部 z 向包围盒范围就是 P1 → P2**：圆柱 / 锥 / 碟要「对中且圆」、棱锥只要「对中」（相对容差 1e-3）；
  带 XOFF / YOFF 的 SNOU / PYRA 与烘在世界帧的实体（包围盒不对中）不派生。
- 接线 `useXeokitMeasurementTools`：候选 / 命中新增 `elementLine`（**只做操作数**，不把候选变成 Snap / Mid-Point 的线）；ptset 缓存的 P1 / P2 优先，
  否则按 bounds 规则从 DTX 局部包围盒 × 放置矩阵派生；同元素的表面点 / Item 原点候选挂线（Element × Intersect 下表面点当元素拾取）；没有候选胜出但要线
  （Intersect 拾取类型，或 Perpendicular to 正在等第二点）且 Any / Element 放行时，光标命中的元素本身就是 E3D 的 ELEMENT 拾取 → 转线。Intersect 操作数
  `segment` 优先、其次 `elementLine`，标签「CYLI 轴线（P1 → P2）（线）」；Perpendicular to 的目标线 = 元素 P1 → P2（过 P1，不过拾中点），
  `targetLabel`「CYLI 轴线（P1 → P2）」，垂足在精确线上时会话结果不因拾中它的表面点而标近似。

**证据等级**：`static_expectation`（`edgpicktype.pmlobj` 631 / `edgcylinder.pmlobj` 163 / `edgdish.pmlobj` 91 / `edgsnout.pmlobj` 177 / `edgnozzle.pmlobj` 164 /
`edgpyramid.pmlobj` 57 的 `line()`；`edgtypes.pmlobj` 成员表）；G8 Intersect / G4 Perpendicular 的元素操作数运行时 golden 未采。

**Web 实机走查**（dev `:3101` + gen-model `:8023`，`?show_refno=24381_159970&gm_backend_port=8023`（EQUI，1016 对象），Playwright 真指针；临时 spec 已删）：

- **后端事实 → 页内派生对照**（`element/attributes` 的 HEIG / DIAM / DTOP / DBOT / XOFF … + `element/ptset.world_transform` 解析 P1 / P2，对照页内 DTX 局部包围盒
  经 `elementLineAcceptsLocalBounds` 后的局部 z 向轴线）：SUBE 24381_160659 的 10 CYLI（HEIG 1440 / 69 / 25.4，单位圆柱 `[[-1,-1,0],[1,1,1]]`）、
  4 CONE（HEIG 48，DTOP 93 / DBOT 73，局部 `[[-46.5,-46.5,-24],[46.5,46.5,24]]`）、DISH 24381_163319（HEIG 1218 / DIAM 2400 / RADI 2436，局部
  `[[-1200,-1200,0],[1200,1200,1218]]`）、PYRA 24381_163627（HEIG 1200，XBOT 994 / YBOT 1730 / XTOP 0 楔形，局部 `[[-497,-865,-600],[497,865,600]]`）
  **全部 accepts = true、轴线两端与解析 P1 / P2 Δ ≤ 0.001 mm、P1 → P2 序**；NOZZ 24381_163651（CATR 0/0、HEIG 300）**没有 DTX 对象**（gen-model 对无目录
  的 NOZZ 不出几何），NOZZ 的 ptset 路径本库无样本。
- **Any × Intersect · CYLI × CYLI**（A = 24381_160660 HEIG 1440 轴 (0.894, 0.448, 0)，B = 24381_160663 HEIG 69 轴 (0.448, −0.894, 0)，异面垂直）：
  悬停 A → `Snap : CYLI Item 原点 24381_160660`（`web-element-line-live-01-hover-cyli-any-intersect.png`），点击 → `求交已选 1. CYLI 轴线（P1 → P2）（线），再选一项（Intersection[2]）`；
  悬停 B → `交点（预览）`（`-02-preview-intersection.png`），点击 → 起点 `−7883.924 / 8782.810 / 9992.000 mm` = A 轴上离 B 轴最近点（解析 Δ **0.001 mm**，到 A 轴 0.001 mm、到 B 轴 331.000 mm = 异面距）；
  再 B × A 反序求终点 → `−7883.924 / 8782.810 / 10323.000`（解析 Δ 0.001 mm），`Distance 331mm / Offset Z +331mm / Direction Z +1.0000`（`-03-intersect-result.png`）——两交点相距 331.000 mm = 两轴异面距。
- **Element × Intersect**：同一对，A 悬停仍 `Item 原点`、点击转 `CYLI 轴线（P1 → P2）`，交点与 Any 下**同值**（Δ 0.001 mm）。
- **Any × Intersect · CYLI × CONE**（CONE 24381_160671，烘好的局部帧网格、无 ptset 点）：悬停 CONE 即 `交点（预览）`（`-04-preview-cyli-x-cone.png`），
  点击 → 交点 Δ **0.001 mm**（CONE 轴与 B 轴共线，解析交点相同）。
- **单项操作数准入**：DISH 悬停 `轴线（P1 → P2）` → 点击 `求交已选 1. DISH 轴线（P1 → P2）（线）`（`-05-dish-operand.png`）；PYRA → `求交已选 1. PYRA 轴线（P1 → P2）（线）`；
  BOX 24381_160662 → `所选项无法转成线 / 面参与求交…（E3D: Unable to convert item into a line or plane for intersection）`，仍在 `Intersection[1]`（拒收不消耗）。
- **Perpendicular to · CYLI**：起点 B 的 `Item 原点 24381_160663`（离 A 轴 819.3 mm），终点悬停 A 表面（`-06-hover-perpendicular-target.png`）→
  `perpendicular = {line, "CYLI 轴线（P1 → P2）"}`，终点标签 `CYLI 轴线（P1 → P2）垂足`，垂足 `−7883.924 / 8782.810 / 9992.000` 到解析轴 **0.001 mm**、
  (垂足 − 起点)·轴向 0.000 mm，`Distance 819mm / Vertical 331mm / Horizontal 750mm`（解析垂距 819.336；`-07-perpendicular-result.png`）。
- **Perpendicular to · DISH**：起点 PYRA 的 `Item 原点 24381_163627`（离 DISH 轴 600.0 mm），终点悬停 DISH 表面 `轴线（P1 → P2）`（`-08-hover-perpendicular-dish.png`）→
  `perpendicular = {line, "DISH 轴线（P1 → P2）"}`，垂足 `−6708.450 / 9372.290 / 4390.000` 到 DISH 解析轴 **0.000 mm**，`Distance 600mm / Vertical 0mm / Horizontal 600mm`
  （解析 600.005；不标近似；`-09-perpendicular-dish-result.png`）。
- 记录 `web-element-line-live-records.json`（样本解析 P1 / P2、页内派生、四组交互），扫描日志 `web-element-line-live-scan.txt`；页面错误 0。

**独立复算**：A 轴 P1 (−7995.7, 8726.8, 9992) 方向 (0.894, 0.448, 0)，B 轴 P1 (−7563.4, 8143.7, 10323) 方向 (0.448, −0.894, 0)：A 上离 B 最近点 =
(−7883.924, 8782.810, 9992.000)，B 上离 A 最近点 = 同 xy、z 10323 → 异面距 331.000 mm——与两次交点逐位一致。Perpendicular：B 原点 (−7547.9, 8112.8, 10323)
到 A 轴的垂足 = 同一点 (−7883.924, 8782.810, 9992)，垂距 √(335.9² + 670.3² + 331²) = 819.34 mm；PYRA 原点 (−6172.1, 9641.2, 4390) 到 DISH 竖直轴
(x −6708.45, y 9372.29) 的垂距 √(536.3² + 268.9²) = 600.0 mm——与面板一致。

**残余偏离 / 未做**：
- 带 XOFF / YOFF 的 SNOU / PYRA：E3D 的 P1 → P2 是斜线（两端面中心），Web 从包围盒认不出偏移 → 不派生、当操作数被拒；要做需 `element/attributes`
  的 XOFF / YOFF 或服务端在 `element/ptset` 给设计基本体合成 P1 / P2（本 EQUI 内未见 SNOU，抽查的 PYRA XOFF = YOFF = 0）。
- NOZZ 只走 ptset 的 P1 / P2（目录件）；本库 NOZZ 均 CATR 0/0、无几何、无点，运行时未验。
- 元素被布尔负体切掉端面时局部包围盒 z 范围会短于 HEIG（P1 / P2 随之内缩）；本库未见样本。
- SCTN / GENSEC 的 `line()` 走 PLINE（`element/plines`），见 §17。

## 17. 拾取层 Phase A · Pline 过滤器接 gen-model-v1 `element/plines`（SCTN / GENSEC 的目录 p-line 成整条可拾的线）实机走查（2026-09-14 03:46）

**改动口径**（gen-model `a00565522` + Web `c2e3d97`；决策 `d-394`，Q5 `d-336` 排下的后端一项，ADR 0060（6）同步）：E3D `stdPline` 拾中的是一条
**p-line 线**——`EDGPLINE.line(dbRef, pline)` 缺省 `cut = false` 取 `PLSTART → PLEND`（p-line 在 POSS / POSE 截面平面上的点，World）；`snap(LINE)`
用它与光标射线求交后 `GMFLINE.snap` 取近端；Mid-Point / Fraction / Proportion / Distance 沿这条线派生；Intersect 当 LINE；Perpendicular 目标 =
`edgsctn.snap → this.line`。`edgpline.pmlobj` 的 `cut / fitting / joint / node` 缺省全 false（`edgpicksettings.pmlfrm` 才改），所以**整条
PLSTART → PLEND、不按 FITT / SJOI / SNOD 分段**就是 E3D 缺省行为。gen-model-v1 此前没有 PLINE 供给（读透形态只存烘好的网格），Pline 过滤器在 v1 下是空的。

- 服务端 `POST /api/v1/element/plines`（`gen-model-ptset-api/src/web_service/plines.rs`，spec §4.11.2）：不经投影、不连库，直读 dabacon，复用 e3d-model
  建型材实体的那条链（`section_catalogue → evaluate_section_profile → section_placement | spine_path`），把目录 `SPRF.PSTR` 里每条 PLIN 的 (PX, PY)
  先减 JUSL 对齐量、LMIRR 沿 x 镜像（与截面顶点同一函数），放进截面标架再乘世界矩阵——**线一定落在画出来的梁上**。响应：`key / offset / start / end /
  dir / length`，`start_cut / end_cut`（= `PLSTCUT / PLENCUT`：p-line 与「过 POSS 法向 DRNS」/「过 POSE 法向 DRNE」平面的交点）只在与平头端点差 > 0.01 mm
  时出现（E3D 位置本就记到 0.01 mm；DRNS 是精确方向而轴向由记到 0.01 mm 的 POSS / POSE 算出，夹角带 1e-7 ～ 1e-5 rad 记录误差——实机 24381/177301
  DRNS 恰 5°、夹角 3e-7 rad，离轴 50 mm 的 LTOS 交出偏 1.6e-5 mm 的假斜切点，按原 1e-6 mm 的门被当成真斜切给了出去，本轮改 0.01）。GENSEC 只接直
  SPINE（含弧的 E3D 走 `arc()`，回空 + reason）；不是 SCTN / GENSEC、无 SPRE、链断、无 PSTR 都是 200 空 `plines` + `reason`。
- 前端：`keypointSource.primitiveKeypoints` 打 `element/plines`，每条 p-line 摊成与 legacy `semantic_snap_points` 同形的「PLINE <key> 起点 / 终点」两个
  候选（`kind` `pline_start / pline_end`，带 `dir`），`attachPlineSegments` 配成一条线；`buildPlineLineCandidates` 再给每条线一条**线候选**（控制点 =
  p-line 上离光标射线最近处，像素距离是到线不是到端点），所以光标落在梁中段就拾中整条 p-line；服务端 `reason` 原样进 `errors`（提示条可见）。
  Perpendicular to 拾中带 `segment` 的线候选时目标标签用候选自己的名字（「PLINE NA」，去派生记号、不缀「轴线」）。`primitive_key_point` 点源的开关
  语义不变（默认 show / snap 关；Pline 过滤器要它开着），基本体显著点不给（`d-336`）。

**证据等级**：`static_expectation`（`edgpline.pmlobj` 100 `line()` / 467 `snapLine()` / 546–640 `snap()`、48–78 成员缺省；`edgsctn.pmlobj`）；
G7-02 PLINE 实际捕捉几何、G8 同一条 PLINE 的 Mid-Point 位置字串、G9 SCTN 落在 PLINE 线上三组 E3D 运行时 golden 未采。

**后端事实**（gen-model `:8024` 新构建，STRU 24381_177298「Copy-of-1516项目3.6,-22米新增钢平台模拟」的 14 根 SCTN：FRMW 177300 / 177312 / 177359 属主恒等，
177328 / 177343 的属主 STRU `ORI 0 0 −120`；SPRE 23984/111444（100 × 200 工字，26 条 p-line：NA / SDNA / LTOS / TLW / TOS / SDAT / TRW / RTOS / RTBS /
TRWB / NAR / BRWT / RBTS / RBOS / BRW / BOS / SDAB / BLW / LBOS / LBTS / BLWT / NAL / TLWB / LTBS / NARO / NALO，腹板 5.5、翼缘 8）与 23984/111399
（200 × 200）；JUSL 全 NA（177360 / 177361 未设 → 缺省 NA）；BANG 0，177360 BANG 155 立柱）：
- **JUSL 线两端 = `world_transform`·POSS / POSE**：14 根全部 Δ 0.0000 mm（含属主转了 −120° 的 6 根）。
- **cut 字段 = PLSTCUT / PLENCUT 定义**：每条 p-line 与「过 POSS 法向 DRNS」/「过 POSE 法向 DRNE」平面的交点——有字段的与交点 Δ ≤ 0.001 mm，无字段的
  交点离平头端点 ≤ 0.01 mm，**728 处 0 不符**。平头端（DRNS / DRNE 与轴向夹角 0.000°）0 条；25.5° 斜切端 20 条（offset x = 0 的 TOS / BOS / SDAT / SDAB
  不偏，水平斜切只动 x ≠ 0 的线）；0.038° 的「几乎平头」端 10 条——只有 |x| = 50 的 8 条翼缘线 + NARO / NALO 偏 50 · tan 0.038° = 0.033 mm 过门，
  |x| = 2.75 的腹板线偏 0.002 mm 不给（0.01 mm 门在这里起作用）；177361 的 DRNE (−1, 0, 0) 25° 端 20 条（LTOS 端偏 46.6 mm = 100 · tan 25°）。
- 目录侧 PX / PY 对照未做：`tree/children` 不展开目录库的 SPRF → PTSS（返回空），offset 的对齐 / 镜像口径以 `plines.rs` 单测（`place_in_section`）与下面的网格对照为证。

**页内网格对照**（`?model_source=gen-model-v1&gm_backend_port=8024&show_refno=24381_177298`，38 对象；把每根 SCTN 的 DTX 三角网格换到 p-line 标架——
origin = JUSL 线起点、ẑ = 轴向、ŷ / x̂ 由两条离轴 p-line 的 offset 解出——取包围盒，与 p-line 的 offset 极值比）：14 根**全部**右手系、x 极值 [−50, 50] /
[−100, 100]、y 极值 [−100, 100] 与网格差 ≤ 0.001 mm；z 范围 = [0, L] 或斜切端按 cut 端点延伸（177314 / 177315 / 177330 / 177331 / 177345 / 177346
z_min −23.807 / −23.847 = LTOS 的 start_cut，177361 z_max 1123.529 = end_cut，Δ ≤ 0.001 mm）；p-line 中点到网格表面 TOS / BOS / LTOS / RBOS ≤ 0.001 mm，
NA 恰为半腹板厚（2.750 / 4.000 mm）——对齐、镜像、BANG 155 与斜切一致，线就在梁上。

**Web 实机走查**（dev `:3101` + gen-model `:8024`，Playwright 真指针，`primitive_key_point` show / snap 开；临时 spec 已删）：
- **Pline × Snap**：悬停 SCTN 24381_177301（L 5757.258）腹板 40% 处 → `Snap : SCTN PLINE NA · Snap`（`web-pline-live-01-hover-pline-snap.png`），点击 →
  起点 `2892.030 / 14670.540 / 23194.210` = POSS（近端，Δ 0.000 mm）；60% 处再点 → 终点 = POSE（Δ 0.000），`Distance 5757mm / Offset X +502 / Y −5735 /
  Direction X +0.0872 Y −0.9962`，距离 = 线长 Δ 0.000，不标近似（`-02-snap-both-ends-result.png`）。
- **Pline × Mid-Point**：40% 处点击 → `3142.920 / 11802.865 / 23194.210` = 线中点 Δ 0.000（`-03-midpoint.png`）。
- **Any × Snap** 同一处 → `PLINE NA · Snap`（Any 放行 Pline；`-04-any-filter-hover.png`）；**Ppoint × Snap** 同一处 → 无捕捉（`等待捕捉（P-Point）`）。
- **Pline × Intersect**：点 177301 → `求交已选 1. SCTN PLINE NA（线），再选一项（Intersection[2]）`；悬停 177302 → `交点（预览）`（`-05-intersect-preview.png`），
  点击 → 起点 `2886.100 / 14738.323 / 23194.210` = A 的 NA 上离 B 的 NA 最近点（解析 Δ 0.000 mm，两线相交、异面距 0.000；`-06-intersect-result.png`）。
  从斜上方看时楼板 PANE 挡住 177302，提示条给服务端的 `PANE 不是 SCTN / GENSEC，没有 PLINE`，换视角后拾中。
- **Perpendicular to PLINE**：起点 177302 的 `PLINE NA` 近端（= 其 POSS，Δ 0.000），悬停 177301 → `垂距测量 · 第 2/2 步 … SCTN PLINE NA · Snap`
  （`-07-perpendicular-hover.png`），点击 → `perpendicular = {line, "PLINE NA"}`，终点标签 `PLINE NA垂足`，垂足 `2886.100 / 14738.322 / 23194.210` 到 A 的
  NA 线 0.000 mm、(垂足 − 起点)·线向 0.000 mm，`Distance 50.000` = 解析垂距 50.000，不标近似（`-08-perpendicular-result.png`）。
- **非型材**：PANE 24381_177305 上 Pline × Snap 点击 → `PANE 不是 SCTN / GENSEC，没有 PLINE`（服务端 reason 原句；`-09-pane-no-pline.png`）。
- 记录 `web-pline-live-records.json`（14 根后端事实、网格对照、五组交互），扫描日志 `web-pline-live-scan.txt`；页面错误 0。

**独立复算**：177301 POSS (2892.03, 14670.54, 23194.21) → POSE (3393.81, 8935.19, 23194.21)，|Δ| = √(501.78² + 5735.35²) = 5757.26 mm、方向 (0.0872, −0.9962, 0)
——与 `Distance 5757mm / Direction` 一致；中点 (3142.92, 11802.865)。177302 的 NA 起点 (2935.91, 14742.68) 到 177301 NA 线：x̂ = up × d = (0.9962, 0.0872, 0)，
(起点 − POSS)·x̂ = 43.88 × 0.9962 + 72.14 × 0.0872 = 50.00 mm，垂足 = 起点 − 50 x̂ = (2886.10, 14738.32)——与面板垂足、Intersect 交点同一点（177302 的 NA 延长线
穿过 177301 的 NA）。

**残余偏离 / 未做**：
- ~~E3D Pick Settings 的 `cut = true`（`PLSTCUT → PLENCUT` 当线）与 `fitting / joint / node` 分段（在 FITT / SJOI+SUBJ / SNOD 投影处把 p-line 切开取最近一段）
  未做~~——**2026-09-14 12:55 已做**（gen-model `df61072cc` + Web `648f957`），实机走查见 §18。
- GENSEC：只接单一直段 SPINE；含弧的 E3D 是 `edgPline.arc()`（GMFARC.snap），回空 + reason；GENSEC 的 DRNS / DRNE 在 SPINE 上，本期不给 cut 端点。本库无 GENSEC 样本，
  GENSEC 直 SPINE 分支运行时未验。
- Intersect / Perpendicular 悬停仍按射线首个命中的构件取候选：p-line 被楼板等挡住时要换视角（E3D 亦是拾中前景的构件）。
- 现有：P-Point 集在拉（`isPtsetPickPending`）时点击被拦一拍，即便过滤器不放行 Ppoint（Phase A 之前的门，未动）。

## 18. 拾取层 Phase A · E3D Pick Settings「Sections & Walls」：Pline 端点 Uncut / Cut 与 Significant Snap Points 三档 实机走查（2026-09-14 12:52）

**改动口径**（gen-model `df61072cc` + Web `648f957`；§17「残余」第一条收口，ADR 0060（7）同步）：E3D Positioning Control → Pick Settings →
Sections & Walls 对型材 p-line 有两组设置（`edgpicksettings.pmlfrm` → `!!edgTypes.pLine.cut / fitting / joint / node`）：
- **Pline End Position**：`EDGPLINE.cut`（`edgpline.pmlobj` 100 `line()`）——`false`「Uncut (Intersect with cutplane)」取 `PLSTART → PLEND`（POSS / POSE 截面平面上的点，
  缺省）；`true`「Cut (Use end preparation)」取 `PLSTCUT → PLENCUT`（按 DRNS / DRNE 斜切后的端点）。整条线换了，所以 Snap 两端、Mid-Point / Fraction /
  Proportion / Distance、Intersect 与 Perpendicular 目标全部随之；平头端没有 cut 点，不变。
- **Significant Snap Points**：`EDGPLINE.snapLine`（467）——只在 Significant Snaps（`edgPosCntrl.intermediate`）开着时调；三档全 false 直接回整条线；否则
  `COLLECT ALL (FITT | SJOI SUBJ | SNOD) FOR sctn`，每个成员的 `position` 用 `LINE.near` 投到 p-line 上，与两端一起按到起点的距离排序，相邻两点成段，
  `onProjected(光标点)` 的那一段就是 Snap / Distance / Proportion / Fraction 的作用线。`EDGPLINE` 构造里四个成员缺省全 false（75–78；Pick Settings 窗体显示的是
  `EDGSCTN` 的缺省 node = true，按 Apply 才拷到 pLine 上），所以 Web 缺省也全关。
- 服务端（`element/plines` 新加 `snap_points`，spec §4.11.2）：走遍 SCTN 全部后代，`kind` 按 noun 归档（FITT → fitting、SJOI / SUBJ → joint、SNOD → node，PJOI /
  SCOJ 等不算）；`zdis` 沿轴离 POSS 的距离——自己的 ZDIS，SJOI / SUBJ 的模板**没有** ZDIS，沿属主链取最近 SNOD 的（E3D 的关节挂在节点上）；`position` 世界系 mm：
  SNOD / SJOI / SUBJ 取对齐线（JUSL）上 z = ZDIS 的点，FITT 走 `section_fitting_placement`（与画出来的配件同一处）。只 SCTN 给（E3D GENSEC 分支不调 `snapLine`）。
  修了一处：`get_double("ZDIS")` 对模板里没有 ZDIS 的成员回 `UnknownAttribute`，原样上抛把整条响应打成 500（实机 24381/177315 → SJOI、177361 → LNKS），现在当
  None 继承。
- 前端：`plineCut` / `significantSnapPoints` 进 `MeasurementPickLayerConfig`（样式仓持久化、非布尔回缺省、三档按字段合并）；`attachPlineSegments(candidates,
  { cut, snapPoints, significantSnapPoints })`——`cut` 把带 `plineCut`（= `start_cut / end_cut`）的端点挪到斜切端，勾了的档投到每条 p-line 上当 `intermediates`
  （从起点排序、去重——同一 ZDIS 的 SNOD + SJOI 只分一次；落在端点上 / 超出范围的丢）；`intermediates` 走切片 4 的既有门「Significant snaps 开着时先取控制点所在
  那一段」，所以 Significant snaps 关掉三档就不起作用。覆盖条设置弹层加「Pick Settings · Sections & Walls」（Uncut / Cut 单选 + Fittings / Joints / Nodes 复选）。

**证据等级**：`static_expectation`（`edgpline.pmlobj` 48–53 成员、75–78 构造缺省、100 `line()` cut 分支、467 `snapLine()`；`edgpicksettings.pmlfrm`）；
G8「Significant Snap Points 下同一条 PLINE 的 Snap / Mid-Point 位置字串」E3D 运行时 golden 未采。

**后端事实**（gen-model `:8024` `df61072cc`，STRU 24381_177298 的 14 根 SCTN）：本库无 SNOD / SJOI / SUBJ / FITT 之外的分段成员样本（`search` 无 SNOD / SJOI / SUBJ 名字，
FITT 0 个，PJOI 60 个不算）；177315 / 177331 / 177346 各有 SNOD + 挂在它下面的 SJOI（ZDIS 435.56 / 335.56 / 435.56），177361 名下只有 LNKS。三根的 6 个点：
`|position − (POSS + ZDIS·dir)|` ≤ 1e-12 mm；投到全部 26 条 p-line 上的参数与 ZDIS 差 ≤ 8e-13 mm（前端 `LINE.near` 投影就是这一步）；0 < ZDIS < L；
其余 11 根 `snap_points: []`、无 500。

**Web 实机走查**（dev `:3101` + gen-model `:8024`，`?model_source=gen-model-v1&gm_backend_port=8024&show_refno=24381_177298`，SCTN 24381_177315：L 564.447，JUSL NA，
起端 DRNS 与轴夹 25.5°（斜切）、终端平头；从侧下方看底翼缘（楼板 PANE 在梁上方）；Playwright 真指针；`primitive_key_point` show / snap 开；临时 spec 已删）：
- **S1 缺省（Uncut）× Snap**，NA 30% → 80%：起点 `10534.120 / 3122.050 / 3050.000` = POSS、终点 `10295.590 / 2610.480 / 3050.000` = POSE，Δ 0.000 / 0.000，
  `Distance 564.447` = L，不标近似。
- **S2 Cut × Snap**，RBOS（offset (50, −100)，起端 `start_cut` 离 `start` 23.847 mm）：Uncut 下起点 = PLSTART Δ 0.000；切到 Cut 后同一光标位置起点
  `10589.514 / 3122.533 / 2950.000` = PLSTCUT Δ 0.000（离 PLSTART 23.847）；平头终端 = PLEND Δ 0.000；`Distance 588.294` = |PLEND − PLSTCUT|
  （`web-pline-settings-live-01-cut-snap-result.png`）。
- **S3 Cut × Mid-Point**，RBOS：`10465.210 / 2855.942 / 2950.000` = (PLSTCUT + PLEND)/2 Δ 0.000（离 Uncut 中点 11.923；`-02-cut-midpoint-result.png`）。
- **S4 Nodes × Snap**，NA（Uncut）：悬停 80% 处 `Snap : SCTN PLINE NA · Snap`（`-03-nodes-snap-hover.png`），点击 → 起点 `10350.056 / 2727.293 / 3050.000`
  = 节点在 NA 上的投影（POSS + 435.56·dir）Δ 0.000（离 PLEND 128.887——缺省整条线时近端是它）；30% 处 → 终点 = POSS；`Distance 435.560` = ZDIS
  （`-04-nodes-snap-result.png`）。
- **S5 Nodes × Mid-Point**：30% 处 → `10442.088 / 2924.671` = [0, ZDIS] 段中点、80% 处 → `10322.823 / 2668.886` = [ZDIS, L] 段中点，Δ 0.000 / 0.000，
  `Distance 282.224` = L / 2（`-05-nodes-midpoint-result.png`）。
- **S6 Nodes 勾着但 Significant snaps 关**：80% 处 Snap 回 PLEND Δ 0.000（三档不起作用，E3D `intermediates` 门）。
- **S7 只勾 Fittings**（本构件无 FITT）：整条线，80% 处 = PLEND；**S8 只勾 Joints**：挂在节点上的 SJOI 同一处分段，80% 处 = 节点 Δ 0.000。
- 覆盖条设置弹层：「Pick Settings · Sections & Walls」Uncut 选中 / Cut 未选、Fittings 关 / Joints 开 / Nodes 关（S8 之后的状态；`-06-pick-settings-ui.png`）。
- 扫描日志 `web-pline-settings-live-scan.txt`；页面错误 0。每次结果面板的 `origin` 就是第一击那一点、`distance` = |target − origin|（脚本内核对）。

**独立复算**：177315 POSS (10534.12, 3122.05) → POSE (10295.59, 2610.48)，|Δ| = √(238.53² + 511.57²) = 564.45，dir (−0.4226, −0.9063, 0)；节点 = POSS + 435.56·dir
= (10350.06, 2727.29) ✓；RBOS 起端 25.5° 斜切在离轴 50 mm 处偏 50 · tan 25.5° = 23.85 mm ✓（§17 的 z_min −23.847 同一数）；Cut 线长 564.447 + 23.847 = 588.294 ✓。

**残余偏离 / 未做**：
- FITT 档只有单测（本库无 FITT）；FITT 位置走 `section_fitting_placement`（POSL 线上 z = ZDIS + DELP），投到 p-line 后只剩沿轴分量，与 E3D `LINE.near(fitt.position)` 同一结果。
- E3D `snapLine` 不丢超出 p-line 范围的成员（按无符号距离排、可能把 Snap 给到 p-line 外）；Web 丢——实际没有成员放在 p-line 之外，差别不可达。
- GENSEC 分支照 E3D 不分段、也没有 cut 端点（§17 残余第二条不变）。

## 19. Phase B · Measure Distance 窗体 Keep dimensions 生命周期（勾掉当场收、关窗按开关收）实机走查（2026-09-14 13:32）

**改动口径**（Web `3701208`；方案 §2 #4 / Phase B 第一条）：E3D 的 Keep dimensions 是窗体上一个 toggle 配一个 aid 号（`gphmeasure.pmlfrm`）：
- 构造 139–142 `keepAids.val = false`、`keepAidMeasure = false`；150 `aidNumber = !!aidNumbers.add('Measuring')`，**一个窗体一个号**。
- 每次测完 `setUpForm() → preview()`（509）：`keepAidMeasure` 真 → `dimension.draw(aidNumber, false)` 往同一个号上再画一条（累积）；假 →
  `!!aidNumbers.replace(aidNumber, dimension)` 换掉（只剩最新一条）。
- `keepAids()` 回调（247）：**勾掉当场** `clearAids()` = `!!aidNumbers.hide(aidNumber)`——不等下一次测量，而且是 hide 不是删。
- `close() → tidy()`（194 / 224）：`keepAidMeasure` 假才 `clearAids()`，真则关窗后图形留在视口；close 另把 `Define a linear dimension` /
  `Define perpendicular linear dimension` 两条 edg 从栈上摘掉。
- `initialise()`（171）重开时 `keepAids.val = keepAidMeasure`：开关跟着窗体成员在进程会话内记忆。

Web 这一侧 `distanceKeepDimensions`（测量面板「保留已完成尺寸图形（Keep Dimensions）」）原本只在**下一次测量落地**时隐藏旧的（`useXeokitMeasurementTools`
两处 add 路径），勾掉当场不动、退出测量也不动。本片补两处时机：勾掉（true → false）当场 `hideKeptDistanceDimensions()`；`deactivate()`（= 关窗 / 切工具）
时 Keep 关着才收。两处都走 `updateXeokitMeasurementVisible(id, false)`，记录留在列表里可以再打开——对应 E3D 的 hide 语义。

**已知偏离**（用户 2026-09-14 13:26 拍板「缺省维持 Web 口径，勾掉只收不删」，决策 `d-437`）：
- 缺省值不跟 E3D：E3D `keepAids` 构造缺省 false，Web `distanceKeepDimensions` 缺省 true（Web 的测量标注是可管理对象，不是一次性 aid）。
- 记忆范围不同：E3D 只在窗体成员（进程会话）里记，Web 存 localStorage，跨页面刷新仍记得。
- `keepMeasurementAnnotation`（第二击要不要落成持久标注）是 Web 独有的一层，E3D 没有对应物——E3D 每次测完都画 aid，Web 的临时结果就是那条 aid。
- E3D「一个窗体一个 aid 号」在 Web 没有对应作用域：收的是距离测量列表里的全部（与既有「下一次测量隐藏旧的」同一集合），评审导入的测量标注也在内。

**证据等级**：`static_expectation`（`gphmeasure.pmlfrm` 139–142 / 150 / 171 / 194 / 224 / 247 / 509–517 源码阅读，不是运行时观测）；G2-04 / G2-05 运行时
golden 仍未采（E3D 进程不在跑，采集矩阵 §5 保留）。与 golden 对不上时改 Web、改这里的措辞。

**Web 实机走查**（dev `:3101`，`?model_source=gen-model-v1&gm_backend_port=8024`，未加载模型；两条距离记录直接灌进 store——本条查的是开关时机与作用范围，
拾取本身 §17 / §18 已走过；临时 spec 已删）：
- S0：两条记录 `visible` 均为真，Keep 开着。
- S1：在测量面板真点掉「保留已完成尺寸图形（Keep Dimensions）」→ 两条当场 `visible=false`，记录仍是 2 条（`web-keep-dimensions-live-01-unchecked.png`）。
- S2：再勾上，收起来的不会自己回来（E3D 的 aid hide 之后要重新画才有）。
- S3：手动把其中一条放回可见、Keep 开着退出测量 → 仍可见（E3D `tidy()` 不动）。
- S4：Keep 关着退出测量 → 两条一并收起，记录仍是 2 条。
- 页面错误 0。

**单测**：`useXeokitMeasurementTools.test.ts`「Keep Dimensions 勾掉当场收起已画尺寸；关窗按 Keep 决定收不收，记录都留着」覆盖 S1–S4 的状态机；既有
「关闭 Keep Dimensions 后只隐藏旧距离图形，不删除历史记录」覆盖下一次测量时的替换路径。46 用例全绿。

**残余 / 未做**：G2-04 / 05 运行时 golden 未采；Phase B 其余三项未动——#5 Units 会话级单位待 Q4（英制 Inch / Feet & Inches / Feet 做不做）拍板，
#6 的 Aid 目标 provider 待 Q3，#20 ESC / 右键 / 关窗分层见 §20。

## 20. Phase B · ESC / 关窗 / 右键的 E3D 口径（源码对照，无代码改动）（2026-09-14 13:50）

**E3D ESC 是「一下退到底」，没有分层。** 视口按 Esc → 视图 gadget 回调 `EDGCNTRL.canvasPick(view, 'ESCAPE')`（`edgcntrl.pmlobj` 908，911–913 只测这一个
mode）→ `escape()`（779）：
1. 取 `state.packet.escape`（测量包没设，见下）；
2. 跑 `state.packet.closeAction()`（794）——测量包的 `close` 是 `!!gphMeasure.tidy()`，也就是 **Keep 关着时 `clearAids()`**（§19）；
3. `!!aidNumbers.remove(state.packet.aidNumber)`（800）收回**本包**的 aid 号（`EDGSTATE.action` 506 在每个 major pick 之间打的 `AID TEXT` 标签就挂在它上面，
   与窗体自己那个 `Measuring` 号是两回事）；
4. `tidyForms()`（803）把该包的拾取类型窗体收掉；
5. 新建 `EDGSTATE` 并 `reinstatePacket(stack.remove(1))`（806–807）把栈上的上一层包恢复回来——通常就是导航；
6. `setModeState()`（826）。

**不管停在哪一步都走这一条**：第 1 步、第 2 步、Intersect 的第 2 / 第 3 次子拾取中间，Esc 都是整包放弃。`edgpicktype.pmlobj` 778 / 796 / 813 / 821 那几句
`…Select another item or escape to abort the operation` 是「可以按 Esc 放弃**整个操作**」的提示，不是「Esc 只退子拾取那一步」——Web 代码注释里引的就是这句，引偏了。

**关窗与「测完一次」的口径**（`gphdimension.pmlobj` 594 `edit()` / 641 `editPerpendicular()`）：测量包 `packet.close = '!!gphMeasure.tidy()'`（616 / 658）、
`packet.remove = FALSE`（618 / 660）、`action = '!!gphMeasure.setMeasure(!this.return[1])'`、`escape` / `continue` 都没设。于是：
- 测完一次 → `EDGSTATE.action()` 走到底、`remove` 为假 → `setOldPacket(packet)` 从头再来 = 窗体常驻 + 连续测量（G1-05 ✓，Web 一致）。
- 关窗 `gphMeasure.close()`（`gphmeasure.pmlfrm` 194）= `tidy()` + `edgCntrl.remove('Define a linear dimension')` / `remove('Define perpendicular linear dimension')`。
  `remove(description)`（`edgcntrl.pmlobj` 595）对当前包就是 `retrieve()`（716），与 `escape()` **只差一件事**：`retrieve` 跑 `continue` 动作、`escape` 跑 `escape` 动作
  ——测量包两个都没设，所以 Esc 与关窗在测量这条命令上等价。

**Web 现状与偏离**（用户 2026-09-14 13:50 拍板保留，决策 `d-444`）：
- Web 的 Esc 分四层（`useXeokitMeasurementTools.reset()`）：① Intersect 子拾取进行中 → 只丢已选的线 / 面；② 有草稿 → 取消草稿；③ 无草稿但有临时结果 → 丢结果；
  ④ 都没有 → 回 false，`ViewerPanel.exitXeokitMeasureMode()` → `deactivate()` 退出测量模式。**第 ④ 层等价于 E3D 的 Esc**（含 §19 补的 `tidy()` 语义）；①②③ 是 Web 增强。
- 保留的理由：Web 没有 E3D「在命令行重发一次命令」的回路，一下退到底会把已选的两条 Intersect 操作数、正在画的草稿、刚出的结果连同工具一起丢掉，代价比 E3D 大。
- 右键：**静态源看不到**。视口的拾取模式由 `EDGPICK.applyToView` → `view.setInMode()`（`edgpick.pmlobj` 161 / 192）交给原生 GUI，PML 侧的回调只分出 `'ESCAPE'` 一支。
  Web 现在的右键是对着**已画好的尺寸图形**弹菜单（`ViewerPanel.onViewerContextMenu`，命中 dimension 才弹，复制 / 删除等），E3D 侧语义最接近的是
  `gphdimension.edit(aidNumber)`（编辑某个 aid 号上的尺寸），不是拾取中的取消。E3D 拾取途中右键弹什么，要等 E3D 进程起来采 trace。

**证据等级**：`static_expectation`（`edgcntrl.pmlobj` 595 / 716 / 779 / 908，`edgstate.pmlobj` 436 `action()` / 506，`edgpick.pmlobj` 161，
`edgpicktype.pmlobj` 778–821，`gphdimension.pmlobj` 594 / 641，`gphmeasure.pmlfrm` 194）；ESC / 右键 / 关窗三条运行时 trace 仍未采（采集矩阵 §5）。

**本节无代码改动**：④ 层已由 §19 的 `deactivate()` 覆盖 `closeAction` 语义，其余为记录偏离。

## 21. Phase B · Measure Distance 窗体 Units（Unit type × Display Unit，英制不做）实机走查（2026-09-14 15:02）

**E3D 口径**（`gphmeasure.pmlfrm` 56–58 / 111–154 / 171–178 / 719–799 + `comformats.pmlobj` 1301–1356）：

- 窗体顶上一个 `Units` 框，两个 option：`.unitSystem`（`Unit type:`）与 `.unitDisplay`（`Display Unit:`）。
- 构造 144–147 `unitSystem.dText = ['Default', 'Metric', 'Imperial']`，`val` 停在 1；118 `measureFormat = !!distanceFmt`。
- `changeUnitType()`（719）：**Default 档**（val 1）`measureFormat = !!distanceFmt`、`unitDisplay.active = false`（下拉禁用）、`setUpForm()` 就返回；
  否则把下拉换成那一套——Metric `dText = ['Millimetres', 'Centimetres', 'Metres']` / `rText = ['MM', 'CM', 'METRE']`，
  Imperial（val 3）`dText = ['Inch', 'Feet & Inches', 'Feet']` / `rText = ['IN', 'FINC', 'FT']`，`val` 取 `lastMetricSelection` / `lastImperialSelection`
  （744–747 首次进来两个记忆都置 1），再 `selectUnitType()`。
- `selectUnitType()`（780）：`selection = unitDisplay.selection()`（rText 那一串）；val 2 / val 3 各把 `unitDisplay.val` 写回自己那一套的记忆，
  `measureFormat = COMFORMATS.distanceFormat(selection)`；最后 `setUpForm()`。
- `setUpForm()`（353）把 `measureFormat` 交给 `dimension.format` —— **结果表与画出来的尺寸图形同一套格式**。
- `COMFORMATS.distanceFormat(!unit)`（1301）公制三档：`METRE` / `CM` → `dp=3, trailZeros=false`；其余公制（含 `MM`）走 `else` → `dp=2, trailZeros=false`
  ——`MM` 这一档与 G1-04 实测的 `!!distanceFmt`（2 位小数去尾零、`0mm` 无负零）对得上。
  英制三档（本项目不做，记在这里备查）：`IN/INCH` → `units=INCH, fraction, denominator=32, inchSeparator='.', label='in'`；
  `FINC` → `units=FINCH, label='"', fraction, denominator=32, ftLabel="'-", inchSeparator='.', zeros=false`；`FT` → `dp=3, trailZeros=true`。

**Web 落地**（Web `12ad607` + `2e9d354`；方案 §2 #5 / Phase B 切片 3；决策 `d-483` 取代 `d-481`）：

- 纯内核 `src/measurement/units/measurementUnits.ts`：Unit type 两档（Default / Metric）、Display Unit 一组
  （token / label 逐字照搬 rText / dText）、`measurementDistanceFormatForUnit` 逐格对应上面那张公制 FORMAT 表、
  `applyMeasurementUnitSelection` 记住上次选的那一档、`formatMeasurementLengthMeters` 按 FORMAT 渲染（dp + trailZeros + 无负零）。
- 会话级状态 `measurementPickLayer` 旁边新增 `measurementUnits`（样式仓 V9，缺省 Default 档 / MM = E3D 构造值），
  **优先级高于全局单位设置**：Default 档才回落到全局（显示单位 + 小数位），对应 E3D 的 `!!distanceFmt`。
- 结果表（`buildDistanceMeasurementResultRows` / `buildPerpendicularMeasurementResultRows` 多一个可选 format 参数）与画布上的尺寸文字
  （`useXeokitMeasurementTools` 的 `formatDistance`）走同一个 format —— 对应 E3D `setUpForm()` 把同一个 `measureFormat` 交给结果表和 `GPHDIMENSION`。
- 测量面板结果卡顶上多一个 Units 框（`measurement-unit-system` / `measurement-display-unit`），Default 档下拉禁用并写「（随全局单位设置）」。

**英制不做**（方案 §7 Q4，用户 2026-09-14 15:05 拍板「不需要英制，Units 只留 Default / Metric」）：E3D 的 Imperial 档一度按上面那三个 FORMAT
实现过（`12ad607`，出 `936.17/32in` / `78'-0.17/32"` / `78.045ft`），但串型只能是 `static_expectation`——FORMAT 参数出自 PML，把它们渲染成字串的
是 E3D 内核（C#），PML 里看不到。用户判定用不上，这一组连同 FORMAT 里的 `fraction / denominator / inchSeparator / ftLabel / zeros` 五格一并撤掉；
E3D 那三档的参数留在本节上面，要加回来照着填即可。旧配置里存过 `unitSystem: 'imperial'` 的，`normalizeMeasurementUnitSelection` 打回 Default。

**证据等级**：`static_expectation`（上列 PML 行号）+ G1-04 实测兜底（`MM` 档就是 `!!distanceFmt`，两者一致）。
G10（Units 格式矩阵）运行时 golden 仍未采（采集矩阵 §5），但公制这三档的 dp / trailZeros 直接来自 `comformats.pmlobj`，没有推测余地。

**Web 实机走查**（dev `:3101` + gen-model `:8024`，`?model_source=gen-model-v1&gm_backend_port=8024&show_refno=24381_177298`，
Playwright 真指针点两个构件 + 真下拉换档，临时 spec 已删；38 个对象，落点 `o:24381_177301:0` 与 `o:24381_177313:8`，
同一条距离 **23787.9639 mm**）：

| 档 | 结果表 Distance | Offset X / Y / Z | Display Unit 下拉 | 图 |
| --- | --- | --- | --- | --- |
| Default | `23788mm` | `+8648mm / -9231mm / -20146mm` | 禁用，「（随全局单位设置）」 | `web-measure-units-live-01-default.png` |
| Metric × Millimetres | `23787.96mm` | `+8647.9 / -9230.63 / -20146.38mm` | Millimetres / Centimetres / Metres | `web-measure-units-live-02-metric-mm.png` |
| Metric × Centimetres | `2378.796cm` | `+864.79 / -923.063 / -2014.638cm` | 同上 | `web-measure-units-live-03-metric-cm.png` |
| Metric × Metres | `23.788m` | `+8.648 / -9.231 / -20.146m` | 同上 | `web-measure-units-live-04-metric-metre.png` |

- **Unit type 下拉实读 `[Default, Metric]`**——英制那一档在 UI 上已经没有了。
- **换算对账**（四档都是同一个 23787.9639 mm）：Default Δ 0.036、MM Δ 0.004、CM Δ 0.004、METRE Δ 0.036 mm；
  各档的 Δ 就是那一档小数位的取整余量（Default 走全局的 0 位小数，所以与 METRE 同量级）。
- **记忆**：Metric 选到 Metres → 切回 Default（`web-measure-units-live-05-back-to-default.png`，`23788mm`、下拉重新禁用）→ 再切回 Metric
  回到 `23.788m`（`web-measure-units-live-06-back-to-metric-remembers-metre.png`），与 E3D `lastMetricSelection` 同构。
- 刷新后 V9 里存着 `{"unitSystem":"metric","metricUnit":"METRE"}`，选择跨刷新还在。页面错误 0。
  逐行实读见 `web-measure-units-live-scan.txt`，数值见 `web-measure-units-live-records.json`。

**单测**：`src/measurement/units/measurementUnits.test.ts` 11 条（Unit type 两档与 Display Unit 一组的 dText·rText、记忆、Default 档下拉灰着时不落库、
FORMAT 参数逐格、公制格式矩阵含 `0mm` 无负零、旧 `imperial` 配置回 Default）；`useXeokitMeasurementStyleStore.test.ts` 一条（会话级状态持久化 + 脏值回缺省）；
`useXeokitMeasurementTools.test.ts` 一条（画布尺寸文字跟着 Units 走、Default 回落全局）。

**已知偏离 / 残余**：
- E3D 的记忆只在进程会话（窗体成员），Web 记在 localStorage 并跨刷新——与 §19 Keep dimensions 同一条已知偏离（`d-437`）。
- E3D 的 Default 档是工程当前距离格式 `!!distanceFmt`（`getCurrentUnitsByPtype('L')`），Web 这一侧对应全局单位设置（显示单位 + 小数位，留尾零）
  ——所以 Default 档的输出与本片改动前**逐字相同**，老用户看不到变化。
- Decimal Places 没做成会话级控件（E3D 的距离小数位固定在 FORMAT 里，不像角度那样有 `Decimal Places` 框）；Web 的全局小数位只在 Default 档生效。
  角度那一侧的 Unit / Decimal Places 是 Phase C #8。
- 英制：不做（见上）。§2 #5 因此按「E3D 有、我们有意不做」记，不再挂 ◐ 的英制尾巴。

## 22. Phase C · 三点角度接内核：结果表 Angle / Direction1 / Direction2 与退化三点拒收 实机走查（2026-09-14 15:12）

**背景**：`src/measurement/kernel/threePointAngle.ts` 是 2026-09-12 照 G6-01/02/03 写的纯内核，带着 13 条 golden 用例，但**一直没接 UI**（§9 那张表里就标着「尚未接入 UI」）。
在此之前 UI 走的是 `xeokitMeasurementFormat` 里自己算 acos 的 `computeAngleDegrees`：列表摘要只有三个点、没有角度值，没有 Direction1 / Direction2，
三点共线 / 重合时照样落一条测不出角的记录。本节把它接上（Web `d2e7c02`；方案 §2 #7 / Phase C 第一条；决策 `d-486`）。

**E3D 口径**（已采 golden，见 §7 / §8 与 G6-01～03）：
- 三点顺序 root / first / second；Web 草稿里对应第一击 `corner`、第二击 `origin`、第三击 `target`。
- 结果表 `Angle` / `Direction1` / `Direction2` + wrt（当时按方案 §1.3 记的三行，**§24 已按 `gphanglemeasure` 源码纠成四行**：
  `Decimal Angle` / `DMS` / `Direction1` / `Direction2`）；`Direction1` 是 root→first、`Direction2` 是 root→second 的单位方向。
  实测样本：`37.4013215953213°`、Direction1 `W 11.7755 N 66.8266 D`、Direction2 `W 12.9006 S 32.3892 D`。
- 只报 minor 角、无 reflex；平面法向随拾取顺序翻转（90° 第二点在南侧时朝向翻成 `Y is S and Z is D`，角度仍报 90）。
- 退化（0° / 180° / second=first / second=root）：`POSITION.plane()` 报 (2,886) / (2,892)，`radius3PointsNoError` 回未设 ARC，
  窗体走 `alert.error('An angular dimension could not be constructed from the data selected')`；0.1° / 179.9° 正常接受。
- `Decimal Places` 缺省 2（§1.3）。

**Web 落地**：
- `buildAngleMeasurementResultRows(root, first, second, frame, decimals = 2)`：角度取内核的 minor 角；两条臂的单位方向经 `designVectorToFrame`
  换到当前 wrt 帧、轴标签跟着帧走（与距离结果表的 Direction 行同一套写法）。内核判退化时回空数组。
- `computeAngleDegrees` 改走内核，所以列表摘要与右键「复制值」在退化三点上不再给一个没有意义的角度；角度小数位从 1 位改成 2 位，与结果表一致。
- 第三击落记录前先过一遍内核：不过就**不落记录**、丢掉草稿（= 回到第 1 步）、提示条给 E3D 那句话的等价文案。
- 测量结果卡在角度模式下改显示这三行 + 顶点 / 两臂，并把距离窗体的 Units 框收起来（E3D 的 Units 在 `gphMeasure` 上）。

**已知偏离**：
- ~~**方向仍是分量串、不是 E3D 的罗盘串**：Web 出 `X +0.3635 · Y -0.3880 · Z -0.8469`，E3D 出 `W 11.7755 N 66.8266 D`。
  这与距离结果表的 `Direction` 行是同一条既有偏离（§9 的 golden 比对就是把罗盘串换算成单位向量再比的），本节没有单独改口径——
  要改就两处一起改，另立一片。~~ **2026-09-14 17:26 两处一起改成罗盘串（§25，Web `16e9a48` + `0e5c674`，决策 `d-515`）**；下面走查里的分量串是改前的样子。
- 角度的 Unit（Degrees / Radians / Gradians）与 Decimal Places 控件没做，缺省锁在「度 + 2 位」；那是 §2 #8（Phase C 第二条）。
- 「回到第 1 步」丢的是整条草稿；E3D 是整包退回命令起点。两者在测量这条命令上等价（§20）。

**Web 实机走查**（dev `:3101` + gen-model `:8024`，`?model_source=gen-model-v1&gm_backend_port=8024&show_refno=24381_177298`，
Playwright 真指针，临时 spec 已删；38 个对象，三个落点 `o:24381_177301:0` / `o:24381_177313:8` / `o:24381_177329:16`）：

- 角度模式下测量面板**没有**距离窗体的 Units 框（`measurement-units-controls` 计数 0）。
- 第 1 击 → `finding_first_arm`，第 2 击 → `finding_second_arm`，第 3 击 → 记录 1 条、草稿清空。
- 结果表：`Angle 40.54°`（近似，三点都是模型表面点 / Item 原点）、
  `Direction1 X +0.3635 · Y -0.3880 · Z -0.8469`、`Direction2 X -0.1993 · Y -0.7379 · Z -0.6448`
  （`web-measure-angle-live-01-three-point-result.png`）。
- **对账**：由三点的设计坐标独立算出的角 `40.538564°`，与结果表的 `40.54°` 差 **0.001436°**（就是两位小数的取整余量）；
  两条 Direction 的三个分量与解析单位向量逐位差 **< 2e-4**。
- **退化**：在同一处连点三下 → 记录数仍是 1（没有新增）、草稿清空，提示条出
  `三点里有重合点，画不出角度尺寸（E3D：An angular dimension could not be constructed from the data selected）；已回到第 1 步`
  （`web-measure-angle-live-02-degenerate-rejected.png`）；随后再点一下，`draftStage` 回到 `finding_first_arm`，即真的回到了第 1 步。
- 页面错误 0。逐行实读见 `web-measure-angle-live-scan.txt`，数值见 `web-measure-angle-live-records.json`。

**单测**：`xeokitMeasurementFormat.test.ts` 5 条（三行结构与两位小数、方向随 wrt 帧换分量与标签、小数位可调、退化回空、列表摘要与复制值）；
`useXeokitMeasurementTools.test.ts` 3 条（三点不共线落记录、共线拒收回第 1 步、第三点落回顶点拒收）；内核既有 13 条（G6-01～03）不变。

**证据等级**：E3D 侧是**已采运行时 golden**（G6-01/02/03，2026-09-11/12 注入 `radius3PointsNoError` 实测），不是静态推导；
Web 侧是上面的实机走查 + vitest。余 G6-04（两图形角度入口）未采。

## 23. Phase B · Perpendicular to 以 Graphics 边（无限线）/ facet 面（无限面）为目标 实机走查（2026-09-14 15:46）

**为什么补这一节**：方案 §2 #6 的目标 provider 早就按 E3D `GMFARC.perpendicularToPoint` 的分支序（`getLine()` → `getPlane()` → 点）把
Graphics 边（`direction` + `segment`）与 facet 面（`facet-plane`）接上了（Phase A 切片 2，`001b302`），但**一直只有单测**：
§12 走的是 Graphics 过滤器下的普通两点距离（`面 → 边`），§10 / §16 / §17 走的是 P-Point 轴 / 元素轴线 / p-line 当垂距目标。
本节只补这一件事的实机证据，**没有代码改动**。

**对账办法**（不看任何内部几何，全靠可观察行为）：
1. 先把 Perpendicular **关着**，拾取层设成 `Graphics × Cursor`（Exact：边上取离射线最近处、面上取射线 ∩ 平面），
   在**同一条边**上悬停 3 个像素、**同一个面**上悬停 4 个像素，各做一次普通两点测量，把第二击的控制点读出来。
2. 末点回代验残差（第 3 点到前两点连线、第 4 点到前三点平面）——残差 0.0000 mm，说明这几次悬停确实落在同一条边 / 同一个面上，
   由它们独立定出那条无限线 / 无限面。
3. 再把 Perpendicular **开着**量一次，检查垂足落在那条线 / 面上、源点→垂足与线垂直（与面法向平行）、距离等于解析值。

**Web 实机走查**（dev `:3101` + gen-model `:8024`，`?model_source=gen-model-v1&gm_backend_port=8024&show_refno=24381_177298`，
Playwright 真指针；把最大的那根构件 `o:24381_177305:6`（包围盒对角 6.162 m）框到屏幕中央再扫像素——整屏看一片型材时
每个像素都贴着绘制边、一个面候选都采不到；临时 spec 已删）：

- 扫描：边像素 24、面像素 40（按覆盖条的悬停标签分类）。
- **边当无限线目标**：控制点 `E1 (2415.420, 9107.373, 23294.211)` / `E2 (2406.319, 9211.402, 23294.211)`，
  边方向 `(−0.087156, 0.996195, 0.000000)`；源点 `S (2684.488, 9409.125, 23326.211)`。
  结果 `targetKind = line`、`targetLabel = 边`、**Distance 296.0782 mm**；
  垂足 `(2391.265, 9383.471, 23294.211)` 到基准线 **0.0000 mm**，`(S−F)·边方向 = 3.61e-16`，
  与解析垂距 **Δ 0.0000 mm**（`web-perp-graphics-live-01-hover-edge-target.png` / `web-perp-graphics-live-02-edge-result.png`）。
- **facet 当无限面目标**：控制点三点定出的法向 `(0, 0, −1)`（这根型材的顶面），源点 `S2 (2415.420, 9107.373, 23294.211)`。
  结果 `targetKind = plane`、`targetLabel = 面 所在平面`、**Distance 32.0000 mm**、`Vertical 32mm` / `Horizontal 0mm`
  （源点正在面的下方，垂距全在竖直方向）；垂足 `(2415.420, 9107.373, 23326.211)` 到基准面 **0.0000 mm**，
  `(S−F)` 与法向的 `|sin| = 1.11e-13`，与解析垂距 **Δ 0.0000 mm**（`web-perp-graphics-live-03-hover-facet-target.png` / `web-perp-graphics-live-04-facet-result.png`）。
- 面板的 Perpendicular 信息条按 §10 的口径出「点→无限线」/「点→无限面」+ 目标名；`wrt` 显示「World（垂距模式固定）」、控件禁用（G4-06）。
- **两次结果都不标「近似」**：源点是 `mesh_graphics` 的网格点（本该归 approximate），但垂足落在精确的目标线 / 面上，
  按 §16 补的 `exactTarget` 口径整条结果不标近似。这一条与 §12「Graphics 两点距离标近似」并不矛盾——那一次两个端点都是网格点。
- 页面错误 0。逐行实读见 `web-perp-graphics-live-scan.txt`，数值见 `web-perp-graphics-live-records.json`。

**证据等级**：Web 侧是上面的实机走查；E3D 侧仍是 `static_expectation`（`edgpicktype.pmlobj` 的 `GRAPHICS` 分支 +
`GMFARC.perpendicularToPoint` 的分支序，见 §12），**G7-02（EDGE / PLANE 实际捕捉几何）运行时 golden 未采**——
这一节证明的是「Web 的 Graphics 边 / 面确实以无限线 / 无限面的语义参与垂距，数值自洽」，不是「与 E3D 逐位一致」。

**余下**：#6 只剩 Aid 类目标（GPHLINE / GPHPLANE），要 Aid 系统，Q3 未拍板（§7）。

## 24. Phase C · 角度会话级 Units（Unit 四档 × Decimal Places）与结果表补 DMS 行 实机走查（2026-09-14 15:57）

**先纠一处口径**：方案 §1.3 把角度结果表记成「`Angle / Direction1 / Direction2`」，§22 也照这个接的三行。
读 `gphanglemeasure.pmlfrm` 334–342 才看清 E3D 的 `dimensionProperties` 是**四行**：
`Decimal Angle` / `DMS` / `Direction1` / `Direction2`。G6-02 采到的是那几个**值**，行名是当时的转述。本节按源码补齐。

**E3D 口径**（`gphanglemeasure.pmlfrm` 45–54 / 95–101 / 318–410 + `comformats.pmlobj` 1240–1259）：

- `Units` 框两格：`Unit` 下拉（`add` 顺序 Default / Degrees / Radians / Gradians，构造时停在第 1 档）
  与 `Decimal Places` 文本框（构造 `setValue('2', false)`）。两个控件的回调都是 `setupForm()`。
- `Decimal Places` 只收 **0–8**：`REAL()` 转不动（非数字）走 `handle (2,441)`、越界走 `else`——
  两条都是 `setValue('2')` + `alert.error('Value must be between 0 and 8')`（328–333 / 431–434）。
- 角度格式：`!formAngleFormat = !!angleFmt`（= `angleFormat(UNIT('degree'))`，`dp 2`、degree 档 `label ''`、
  **`trailZeros false`**），然后只换 `dp`（= Decimal Places）与 `units`（下拉那个词；Default 档取工程当前角度单位名 + `s` 首字母大写）。
  单元格文本是 `!angle.string(!formAngleFormat) & ' ' & !formAngleFormat.units`（407）——**数值、一个空格、单位词**，
  所以出的是 `40.54 Degrees`，不是 `40.54°`。
- `DMS`（360–363）：`deg = int(v)`、`min = int((v−deg)×60)`、`sec = int((v−deg−min/60)×3600)`，
  三处都是**截断**，且 `v` 恒是十进制度——**与 Unit 选了什么无关**。
- 两条 Direction 的每个数字也按 Decimal Places 重新格式化（376–404，走 `!!realFmt`：只设 `dp`，`trailZeros` 是 FORMAT 缺省 = 留尾零）。

**Web 落地**（Web `b45b33b`；方案 §2 #8 / Phase C 切片 2；决策 `d-494`）：

- 纯内核 `src/measurement/units/measurementAngleUnits.ts`：四档 Unit、0–8 校验（`isMeasurementAngleDecimalsValid`）、
  度 / 弧度 / 梯度换算、`formatMeasurementAngle`（去尾零 + 单位词）、`formatMeasurementAngleDms`（截断）、
  `formatMeasurementAngleScalar`（**缺省留尾零** = `realFmt`，角度值那一格才传 `trailZeros: false`）。
- 样式仓 V9 新增 `measurementAngleUnits`（缺省 Default / 2 = E3D 构造值），`updateMeasurementAngleUnits` 把越界值打回 2。
- `buildAngleMeasurementResultRows` 出四行并吃这一档；列表摘要与右键「复制值」同源
  （复制值从 `90.00°` 变成 `90 Degrees`，与结果表一致）。
- 结果卡角度模式加 `Unit` / `Decimal Places` 两个控件，越界时原地出 `Value must be between 0 and 8`。

**Web 实机走查**（dev `:3101` + gen-model `:8024`，`?model_source=gen-model-v1&gm_backend_port=8024&show_refno=24381_177298`，
Playwright 真指针点三点 + 真控件换档，临时 spec 已删；三点落在 `o:24381_177301:0` / `o:24381_177313:8` / `o:24381_177329:16`，
由三点设计坐标独立算出的角 **40.538564°**（弧度 0.707531，梯度 45.042849））：

| Unit × Decimal Places | Decimal Angle | DMS | Direction1 | 图 |
| --- | --- | --- | --- | --- |
| Default × 2（构造值） | `40.54 Degrees` | `40° 32' 18''` | `X +0.36 · Y -0.39 · Z -0.85` | `web-angle-units-live-01-default-2.png` |
| Degrees × 4 | `40.5386 Degrees` | 同上 | `X +0.3635 · Y -0.3880 · Z -0.8469` | `web-angle-units-live-02-degrees-4.png` |
| Radians × 4 | `0.7075 Radians` | 同上 | 同上 | `web-angle-units-live-03-radians-4.png` |
| Gradians × 2 | `45.04 Gradians` | 同上 | `X +0.36 · Y -0.39 · Z -0.85` | `web-angle-units-live-04-gradians-2.png` |
| Gradians × 0 | `45 Gradians` | 同上 | `X +0 · Y +0 · Z -1` | `web-angle-units-live-06-gradians-0.png` |

- Unit 下拉实读 `[Default, Degrees, Radians, Gradians]`；三档换算与解析值逐格对上
  （`40.54` = `toFixed(2)`、`0.7075` = 弧度 `toFixed(4)`、`45.04` = 梯度 `toFixed(2)`）。
- **DMS 五档全是 `40° 32' 18''`**——按十进制度截断，不随 Unit 变（40.538564° → 40° + 0.538564×60 = 32.31' → 32' + 0.3138×60 = 18.8'' → 18''）。
- **Decimal Places 填 9**：原地出 `Value must be between 0 and 8`、输入框弹回 `2`、结果表不变
  （`web-angle-units-live-05-decimals-out-of-range.png`）。填 `0` 正常收（边界内）。
- 刷新后 V9 里存着 `{"unit":"gradians","decimalPlaces":0}`。页面错误 0。
  逐行实读见 `web-angle-units-live-scan.txt`，数值见 `web-angle-units-live-records.json`。

**单测**：`measurementAngleUnits.test.ts` 8 条（四档顺序、0–8 校验、换算、去尾零 / 留尾零两种、DMS 截断）；
`xeokitMeasurementFormat.test.ts` 3 条改写成四行 + Unit / Decimal Places 矩阵；样式仓 1 条（持久化、越界打回、脏值回缺省）。

**已知偏离 / 残余**：
- **Default 档 = Degrees**：E3D 取工程当前角度单位（`!!angleFmt.units` + `s` 首字母大写），Web 没有这一层设置，
  缺省就是度——与 E3D 在 degree 工程下的表现一致，换了角度单位的工程会不一样。
- ~~方向仍是**分量串**不是 E3D 的罗盘串（`W 11.7755 N 66.8266 D`），与距离结果表同一条既有偏离（§22）；
  Decimal Places 管的是这些分量的小数位。~~ **2026-09-14 17:26 已改成罗盘串（§25，Web `16e9a48`）**；
  Decimal Places 现在管的是罗盘串里每个角度的小数位（E3D `!!realFmt` 那条路）。上表 Direction1 列是改前的样子。
- Keep Dimension / wrt 这两格角度窗体也有，Web 走的是共用的那套（§19 / G3）。
- **证据等级**：E3D 侧 `static_expectation`（上列 PML 行号）；G10（Units / Angle 格式矩阵）运行时 golden 仍未采（采集矩阵 §5）。

## 25. Direction 改成 E3D 罗盘串——距离 / 垂距 / 角度三张结果表一起改 实机走查（2026-09-14 17:26 / 17:56 去尾巴）

**为什么现在改**：§22 / §24 都记着同一条既有偏离——Web 的 `Direction` 行是分量串（`X +0.3635 · Y -0.3880 · Z -0.8469`），
E3D 是 `DIRECTION.string()` 的罗盘串（`W 11.7755 N 66.8266 D`）。用户 2026-09-14 16:00 拍板两张表一起改（决策 `d-505`），17:3x 再拍板**三张表都不带 WRT 尾巴**（决策 `d-515` 取代 `d-505`）。

**E3D 口径**（`gphmeasure.pmlfrm` 392–404 / 661–667、`gphanglemeasure.pmlfrm` 371–404 + 已采 trace / 截图）：

- 串型 `<主轴> [<角> <次轴>] [<倾角> <U|D>]`：主轴取水平两分量里**绝对值大的那个**（第一个角 0–45°），
  正好 45° 时出 `E 45 N`（G2-03 `E 45 N 35.2644 U`，`E 45 N`）——打平给 E / W；
  水平落在轴上省掉「角 + 次轴」（G4-01 `N 78.6901 U`），在水平面里省掉倾角（G4-02 `S`），纯竖直只剩 `U` / `D`；
  距离为 0 时 `--`（394 / 663）。
- **数字是 PML REAL 的缺省字串：6 位有效数字、去尾零**，不是固定 4 位小数——`N 6.66615 W 78.3493 U`（G4-03 截图与 trace）、
  `S 20.416 W 12.6584 D`（G3-02）、`N 0.285797 D` / `E 0.238736 U`（G8 P-Point 方向）。
- 字母按当前 wrt 帧的三根轴走：G3-02 `/Copy-of-RCS151MM`（Y is E and Z is U）下同一条方向是 `S 11.7755 W 66.1215 D WRT /Copy-of-RCS151MM`，
  World 下是 `W 11.7755 N 66.1215 D WRT /*`。
- **`WRT` 尾巴**：`DIRECTION.string()` 自带 ` WRT <wrt>`。三张表里**只有 Measure Distance 的标准结果表原样显示它**
  （403 只 `.trim()`；截图 `G1-02-result.png` 的单元格就是 `W 11.7755 N 66.1215 D WRT /*`）；
  Perpendicular（666）与角度窗体（371 / 392）都 `.before('WRT')` 切掉（截图 `G4-03-perpendicular-point-result.png` /
  `G6-02-angle-result.png`）。
- 角度窗体的两条 Direction（374–385 / 394–404）：把 `.string()` 按空格拆开，能 `REAL()` 的每一段再按 `Decimal Places`
  走 `!!realFmt`（固定小数位、留尾零），字母原样——G6-02 截图 Decimal Places 2 出 `W 11.78 N 66.83 D` / `W 12.90 S 32.39 D`。
- GENSEC 当 wrt 时 Direction 按 World 算（396–399，G3-04 也这么记的）。

**Web 落地**（Web `16e9a48` 罗盘串 + `0e5c674` 去尾巴；决策 `d-515`）：

- 纯内核 `src/measurement/reference-frame/compassDirection.ts`：`formatCompassDirection(vector, { decimals?, trailZeros?, fallback? })`
  ——不给 `decimals` 就是 `.string()` 的 6 位有效数字（`formatPmlReal`），给了就先出 6 位串、`Number()` 回来再 `toFixed(dp)`
  （两次取整照 E3D 做）；从不拼 WRT 尾巴；另有 `parseCompassDirection` 给 golden round-trip 用。
- `xeokitMeasurementFormat.ts` 三处 Direction 都改吃它：距离行、垂距行都是纯串；角度行传 `decimals = Decimal Places`。
  删掉不再用的 `formatSignedScalar` 与 `formatMeasurementAngleScalar` 引用。
- **有意偏离 E3D 的一处**：E3D 标准距离表原样显示 ` WRT /*` 尾巴，`16e9a48` 起初照搬了（元素帧写 ` WRT =refno`）；用户拍板去掉——
  结果卡顶上已有一格 wrt，尾巴是重复信息，元素帧下 Web 只能写 refno、E3D 写名字也对不齐（`0e5c674`，`d-515`）。

**Web 实机走查**（Playwright 由 `webServer` 自起 dev `:3101` + gen-model `:8024`，
`?model_source=gen-model-v1&gm_backend=http://127.0.0.1:8024&show_refno=24381_177298`，自由表面 × 模型表面点、真指针三击，临时 spec 已删；
落点 `o:24381_177305:6` / `o:24381_177350:30` / `o:24381_177335:22`）：

| 表 | 设置 | Direction 单元格 | 独立对账 | 图 |
| --- | --- | --- | --- | --- |
| 距离（World） | — | `W 18.4872 S 60.8237 D` | 罗盘串按 PDMS 约定反解成单位向量，与两点设计坐标的单位差向量 Δmax **2.5e-7** | `web-direction-compass-live-01-distance-world.png` |
| 角度 | Decimal Places 2 | `Direction1 W 18.49 S 60.82 D` / `Direction2 S 14.16 W 40.56 D` | 反解 vs 两臂单位向量 Δmax **4.6e-5 / 6.0e-5**（两位小数的取整余量） | `web-direction-compass-live-03-angle-decimals-2.png` |
| 角度 | Decimal Places 4 | `W 18.4872 S 60.8237 D` | 与距离表同一条臂逐字相同；反解 Δmax < 2e-5 | `web-direction-compass-live-04-angle-decimals-4.png` |
| 角度 | Decimal Places 0 | `W 18 S 61 D` | 整数、留位 | `web-direction-compass-live-05-angle-decimals-0.png` |

- 三张表都不带 `WRT`；距离表数字逐段 ≤ 6 位有效数字。页面错误 0（产物是 17:56 去尾巴后重跑的；浮条 UI 真点「自由表面」+ 只留「模型表面点」）。
  逐行实读见 `web-direction-compass-live-scan.txt`，数值见 `web-direction-compass-live-records.json`。
- ~~**旋转 wrt 帧这一档实机没走到**：切 `DBREF 24381/177298` 时 `/api/pdms/transform/24381_177298` 回 HTTP 500（那个后端没在跑），
  帧回落 World。~~这一档由 golden 单测覆盖（下）；**§27 起 gen-model-v1 下元素 wrt 帧走 `element/ptset`，CE / Owner / DBREF 已实机**。

**单测**：`compassDirection.test.ts` 15 条——G1 `W 11.7755 N 66.1215 D`、G3-02 两件 EQUI 的 `S 11.7755 W 66.1215 D` /
`S 20.416 W 12.6584 D`、G4-01 `N 78.6901 U`、G4-02 `S`、G4-03 `N 6.66615 W 78.3493 U`（trace 坐标只到 3 位小数，第一个角只锁 `6.666x`）、
G2-03 `E 45 N 35.2644 U`、G6-02 Decimal Places 2 → `W 11.78 N 66.83 D` / `W 12.90 S 32.39 D`、G8 六条方向串 round-trip、边界与 fallback；
`e3dRotatedWrt.golden.test.ts` 加三条**逐字**断言（World 与两件 EQUI 的罗盘串，去掉 E3D 的 WRT 尾巴后逐字相同）；
`xeokitMeasurementFormat.test.ts` / `MeasurementResultInspector.test.ts` 期望改写。测量相关 83 文件 / 957 用例全过；eslint 0；type-check 与 HEAD 同。

**已知偏离 / 残余**：
- E3D 标准距离表带 ` WRT <wrt>` 尾巴、Web 不带（用户拍板，`d-515`）；元素帧下 E3D 写名字（`/Copy-of-RCS151MM`）、Web 只有 refno，也是不照搬的原因之一。
- ~~GENSEC 当 wrt 时 E3D 的 Direction 按 World，Web 的参考系模型不知道元素类型，没有特殊处理（与 §2 #2 的 GENSEC 非负投影同属未落地）。~~
  → **2026-09-14 20:02 两条一起落地**（§26，Web `3d6b16d`，决策 `d-529`）。
- **证据等级**：串型 / 位数 / 尾巴规则全部来自已采 trace 与截图（G1 / G2-03 / G3-02 / G4-01～03 / G6-02 / G8），不是静态推导；
  角度窗体 Decimal Places ≠ 2 的样子仍是 `static_expectation`（G10 未采）。

## 26. GENSEC 当 wrt：Offset 是截面标架三轴的非负投影 + Direction 按 World（方案 §2 #2 残余）夹具化实机走查（2026-09-14 20:02）

**为什么现在做**：§25 残余与方案 §2 #2 都记着 GENSEC 当 wrt 的两条 E3D 特例没落地——Web 的参考系模型不知道元素类型。
用户 2026-09-14 17:44 拍板两条一起做（决策 `d-529`）。

**E3D 口径**（`gphdimension.pmlobj` 826–856 `offsetType()`、`gphmeasure.pmlfrm` 396–399 + 已采 `G3-04-gensec-wrt.trace.txt`）：

- `!this.wrt.hardType eq 'GENSEC'` 时 `offsetType()` **不走** `offset()`（ORI 帧的带符号分量），而是先拼
  `ORIENTATION('Z IS ' + wrt.zDir.wrt(world) + ' AND Y IS ' + wrt.yDir.wrt(world))`，过 `from` 画三根轴线（`POINTVECTOR.line(1m)`），
  三个 Offset = `from` 到 `to` 在各轴线上垂足（`LINE.near`）的距离——**非负**，且轴是 GENSEC 的 `yDir` / `zDir` **截面标架**，不是 ORI
  （注释原话 "the frame of reference for GENSEC is with the Z axis in the GENSEC Z Direction"）。
- Direction 用 `.wrt(world)`（399），标签仍是 U/V/W（wrt 不是 World，413–431）。
- G3-04（`=23406/14`，`wrt_ydir_world=S` / `wrt_zdir_world=U`）：`from E 5897.18 S 9694.75 U 18669.8 WRT =23406/14` →
  `to E 6297.46 S 7774.61 U 14239.127`，显示 `1920.14 / 400.28 / 4430.67mm` + `W 11.7755 N 66.1215 D`（World），
  `direction_wrt=N 11.7755 E 66.1215 D` 不显示。ORI 帧（X = N / Y = W / Z = U）下的带符号投影是 `+400.28 / +1920.14 / −4430.67`——
  **只有截面标架（X = W / Y = S / Z = U）能对上 `1920.14 / 400.28 / 4430.67`**，所以「非负投影」不是对 ORI 分量取绝对值，轴也不同。
- Perpendicular 表（654–667）**没有** GENSEC 特例，Direction 照 `.wrt(!this.dimension.wrt)`；Web 垂距表本来就固定 World（G4-06），不动。

**Web 落地**（Web `3d6b16d`；决策 `d-529`）：

- `types.ts`：`ReferenceFrameElementData` / `ResolvedReferenceFrame` 加 `noun`（E3D hardtype，解析器大写化；**只是提示，缺了不失败帧**）
  与 `sectionBasis`（GENSEC 截面标架，解析器按同一 basis policy 正交化；解不出为 null）。
- `pdmsTransformReferenceFramePort.ts`：`fetchNoun`（缺省走当前模型数据源的树节点 `getModelSource().tree.node()`，legacy / gen-model-v1 都有 noun）
  与 transform 并发；noun 是 GENSEC 才再拉 `fetchPlines`（缺省 gen-model-v1 `element/plines`，legacy 源直接 null）→ `deriveSectionBasisFromPlines`。
  三个查询任一失败都只降级、不失败帧。
- 纯内核 `gensecSectionBasis.ts`：Web 没有 `yDir` / `zDir` 属性，但 `element/plines` 给了每条 p-line 的截面内偏移 `(x, y)`（JUSL / LMIRR 之后）
  和世界起点 `PLSTART`：`start = O + x·X + y·Y`，放置恒右手、Z = p-line 方向 → 在垂直于 Z 的平面里就是一个平面旋转，
  全部 p-line 最小二乘解角、逐条验残差（相对 1e-6；不是同一右手刚体放置 / 方向不平行 → null）。
- `xeokitMeasurementFormat.ts`：`computeDistanceMeasurementResultInFrame` 对 `isGensecReferenceFrame(frame)`
  （`kind === 'element' && noun === 'GENSEC'`）的帧：Offset = |Δ·u| / |Δ·v| / |Δ·w| 沿 `sectionBasis ?? basis`，`offsetMode: 'magnitude'`；
  Direction 直接用 World 差向量。行 builder / 列表摘要 / 「复制分量」按 `offsetMode` 不带符号。其余帧一字不变（`offsetMode: 'signed'`）。

**Web 实机走查**——**夹具化**：本库 GENSEC 0 件（d-336 记的全库 noun 计数 GENSEC 0；STRU 24381/177298 名下 BFS 也只见 SCTN），且 `:3100 /api/pdms/transform` 在 gen-model-v1
数据源下回 `MODEL_REFNO_NOT_FOUND`（元素 wrt 帧本就走不到实机，§25 同一条）。Playwright 用 `page.route` 把 BANG 155 立柱 SCTN
`24381/177360` 在其属主 `24381/177359` 的 `tree/children` 回包里改成 `GENSEC`、`/api/pdms/transform/24381_177360` 给一个 G3-04 式 ORI
（X = N / Y = W / Z = U）；**p-line 走 `:8024` 真数据，其余全真**——真 UI、浮条真点「自由表面」+ 只留「模型表面点」、真指针两击、真网格拾取
（`?model_source=gen-model-v1&gm_backend_port=8024&show_refno=24381_177298`，落点 `o:24381_177305:6` / `o:24381_177335:22`，临时 spec 已删）：

| 表 | 单元格 | 独立期望 | 图 |
| --- | --- | --- | --- |
| 距离 wrt `DBREF 24381/177360`（GENSEC，U/V/W） | `Distance 30996mm` · `Offset U 4427mm` · `Offset V 23129mm` · `Offset W 20154mm` · `Direction S 14.1643 W 40.5587 D` | 测试进程自己从 `:8024 element/plines` 解截面标架（u = (−0.9063, 0.4226, 0) 即 BANG 155、v = (−0.4226, −0.9063, 0)、w = U），\|Δ·轴\| = 4426.98 / 23128.83 / 20154.21；World 差向量罗盘串 `S 14.1643 W 40.5587 D` | `web-gensec-wrt-live-01-distance-gensec.png` / `web-gensec-wrt-live-02-result-card-gensec.png` |
| 同一次测量切回 World | `Offset X −5762mm` · `Y −22833mm` · `Z −20154mm` · `Direction S 14.1643 W 40.5587 D` | 带符号、Direction 同一串 | `web-gensec-wrt-live-03-result-card-world.png` |

- 夹具 ORI 帧（X = N / Y = W）下若仍按普通帧算会是 `−22833 / +5762 / −20154`——与显示的 `4427 / 23129 / 20154` 明显不同，
  证明走的是截面标架 + 取绝对值，不是 ORI。
- 请求计数：transform 1（夹具）、`element/plines` 1（真）、属主 `tree/children` 1（改 noun）；页面错误 0。数值见 `web-gensec-wrt-live-records.json`。
- **解法对真数据的独立核对**（`web-gensec-wrt-sctn-section-basis-live.json`）：STRU 24381/177298 名下 14 根 SCTN，`element/plines` 各 26 条 p-line
  全部解出截面标架，逐条重建起点的最大残差 **1.8e-12 mm**；13 根 BANG 0 横梁的截面 Y = Up（|v·U| = 1），BANG 155 立柱 `177360` 的截面 X
  在水平面里离 E **155.000°**（§17 记的后端事实）。`element/ptset` 的 `world_transform` 对 SCTN 是属主链矩阵（恒等 / STRU ORI），
  **不是**截面标架——不能拿它当 yDir / zDir 对。

**单测**：`e3dGensecWrt.golden.test.ts` 4 条（G3-04 逐格 `4845.41 / 1920.14 / 400.28 / 4430.67mm`、`Direction W 11.7755 N 66.1215 D`、
列表摘要 / 复制分量不带符号；同帧 noun 未知 → 普通帧 `+400.28 / +1920.14 / -4430.67`、`N 11.7755 E 66.1215 D`；GENSEC 无截面标架 →
ORI 轴上取绝对值）；`gensecSectionBasis.test.ts` 7 条（轴对齐 / 任意旋转 / 镜像已进 offset / 单轴偏移的左右手歧义 / 真左手三点拒掉 /
第三条不自洽拒掉 / 各种 null）；`pdmsTransformReferenceFramePort.test.ts` +2（noun 提示三态；GENSEC 才拉 p-line、SCTN 不拉、p-line 失败只丢截面标架）。
测量相关 85 文件 / 974 用例全过；eslint 0；type-check 与 HEAD 同（基线外只有既有 `useDtxTools.*.test.ts` 与别的会话未提交的 `bindingResolve.ts`）。

**已知偏离 / 残余**：
- 截面标架来自 p-line 反解，不是 E3D 的 `yDir` / `zDir` 属性：GENSEC 含弧 SPINE（`element/plines` 回空 + reason）或 legacy 源下拿不到 →
  回落到 ORI 帧的轴上取绝对值（三个数值与 E3D 同一组、顺序可能不同；golden 用例 `=23406/16` 记着这一档）。
- ~~真 GENSEC 未实机：本库 0 件；`:3100 /api/pdms/transform` 在 gen-model-v1 数据源下不认 refno，元素 wrt 帧本就走不到实机~~（§27 起 gen-model-v1 下
  元素 wrt 帧走 `element/ptset`，CE / Owner / DBREF 已实机；**§31 用设计模板 TMPL 15240/4 的真 GENSEC 走通**，本档的夹具只剩「斜截面（BANG 155）」这一档还没有真样本）。
- 三维标注（画布上的 X / Y / Z 尺寸线）一直是 World 分量、不随 wrt（既有，与本条无关）。

## 27. 参考系 port 跟随模型数据源——gen-model-v1 下元素 wrt 帧（CE / Owner / DBREF）实机走查（2026-09-14 20:21）

**为什么现在做**：§25 / §26 都记着「切 `DBREF` 时 `/api/pdms/transform/<refno>` 回 500 / `MODEL_REFNO_NOT_FOUND`，帧回落 World」——
`pdmsTransformReferenceFramePort` 只认 `:3100` 旧后端，而缺省数据源 2026-09-09 起是 gen-model-v1。用户 2026-09-14 20:0x 拍板补这条来源（决策 `d-533`）。

**来源对账**：`:3100 /api/pdms/transform` 的矩阵是 `aios_core::transform::get_world_mat4(refno)`（`plant-model-gen` `pdms_transform_api.rs` 58–70 兜底路径）；
gen-model-v1 `element/ptset` 的 `world_transform` 是同一口径的「局部 → 世界」列主序 mm 矩阵（平移在 12–14）。实机 EQUI `24381/109581`：
`element/attributes` 给 stored `POS (6316.57, −4741.49, 5347.89)` / `ORI (0, 0, −25)`（相对属主），ptset 给 25° 绕 Z + 平移 `(6241.68, −4737.41, 5347.89)`
——已与属主 ZONE 复合过的世界矩阵，正是参考系要的。`element/attributes` 里**没有** WPOS / WORI，别拿 stored POS / ORI 自己拼。

**Web 落地**（Web `dfb01ba`；决策 `d-533`）：

- 缺省 `fetchTransform` 按 `getModelSourceKind()` 分叉：`legacy` 原样 `pdmsGetTransform`；`gen-model-v1` 用 `genModelV1ElementPtset({ refno }).world_transform`
  + 树节点的 `owner`。ptset 404（`isNotFound`）→ `success:false`、reason `not-found`（与 legacy「element not found」同一档）；其它错误照旧 `unavailable`。
  `provenance.source = 'gen-model-v1-element-ptset'`（legacy 仍 `pdms-transform-api`）。
- owner 与 noun（§26 的类型提示）共用**同一次**树节点查询（memo 化的 lookup，一次帧解析只查一次）；树节点查不到只丢 owner / noun，不失败帧。
- 注入了 `fetchTransform` / `fetchNoun` 的调用方（单测 / 夹具）一律不碰模型数据源。`ReferenceFrameTransformResponse = TransformResponse & { source? }`。

**Web 实机走查**（**无任何 mock**：缺省 gen-model-v1 + `:8024`，`?model_source=gen-model-v1&gm_backend_port=8024&show_refno=24381_177298`，
浮条真点「自由表面」+ 只留「模型表面点」，先退出测量普通点击选中 PANE `24381/177319` 当 CE，再真指针两击测距；临时 spec 已删）：

| wrt | 状态行 | 结果表 | 独立期望（测试进程自己 POST `element/ptset` 取矩阵列 → Δ·u / Δ·v / Δ·w、帧字母罗盘串） | 图 |
| --- | --- | --- | --- | --- |
| CE（PANE `24381/177319`，ORI 绕 Z 24.4°） | `当前 CE 24381/177319 · U/V/W`，无错误 | `+4193mm / −23172mm / −20154mm` · `S 10.2557 E 40.5587 D` | `4192.62 / −23172.46 / −20154.21` · `S 10.2557 E 40.5587 D` | `web-wrt-frame-genmodel-live-03-result-card-ce.png` |
| Owner（FRMW `24381/177318`） | `当前 Owner 24381/177318 · U/V/W`，无错误 | — | 属主来自树节点；ptset 请求里有 `24381/177318` | — |
| DBREF `=24381/109581`（EQUI，ORI −25°） | `当前 DBREF 24381/109581 · U/V/W`，无错误 | `Distance 30996mm` · `+4427mm / −23129mm / −20154mm` · `S 10.8357 E 40.5587 D` | `4426.98 / −23128.83 / −20154.21` · `S 10.8357 E 40.5587 D` | `web-wrt-frame-genmodel-live-01-distance-dbref-equi.png` / `web-wrt-frame-genmodel-live-02-result-card-dbref-equi.png` |
| World（对照） | `当前 World · X/Y/Z` | `−5762mm / −22833mm / −20154mm` · `S 14.1643 W 40.5587 D` | 同 §26 | — |

- `/api/pdms/transform` 请求 **0**；`element/ptset` 请求里含 CE `24381/177319`、Owner `24381/177318`、DBREF `24381/109581`（其余是测量悬停 / 落点的 P-Point 查询）；
  页面错误 0。数值见 `web-wrt-frame-genmodel-live-records.json`。
- 顺带印证 §26：这里 EQUI 帧（−25°）的 `+4427 / −23129 / −20154` 与 §26 夹具 GENSEC 截面标架（BANG 155 = 180° − 25°）的 `4427 / 23129 / 20154` 只差符号——同一组轴线。

**单测**：`pdmsTransformReferenceFramePort.modelSource.test.ts` 5 条（v1 逐格 origin / basis / owner / source 且树节点只查一次；Owner 模式 CE → 树节点 owner → 属主 ptset；
404 → not-found、其它 → unavailable；树节点缺失只丢 owner / noun；legacy 不碰 gen-model）；`MeasurementResultInspector.test.ts` 那条 DBREF 用例钉住 legacy 源 +
本地树节点（不再有 ECONNREFUSED 噪音）。测量相关 86 文件 / 979 用例全过；eslint 0；type-check 与 HEAD 同。

**已知偏离 / 残余**：
- SCTN / GENSEC 当 wrt 的**帧**：ptset 的 `world_transform` 对型材是属主链矩阵（型材没有自己的 POS / ORI；§26 的 14 根 SCTN 全是恒等 / STRU ORI），
  与 E3D `ORI` 的派生值（Z 沿轴、Y 按 BANG）很可能不同，未对 E3D 校准；legacy 的 `:3100` 是同一个算法，不是新偏离。GENSEC 结果表不受影响
  （Offset 走截面标架、Direction 按 World，§26）。
- 元素帧的实机对账对象是 gen-model 自己的矩阵，不是 E3D 运行时 golden（E3D 不在跑）；E3D 侧的旋转帧证据仍是 G3-02 / G3-04 trace 的单测。

## 28. 会话设计辅助（Aid）：辅助线 / 面当 Aid 过滤器的拾取对象与 Perpendicular to 的目标 实机走查（2026-09-14 23:36）

**为什么现在做**：方案 §7 Q3「要不要做一个最小 Aid 系统」——§2 #6 的 Perpendicular to 只剩 Aid 类目标没接、#14 的 Aid 过滤器一直灰着。
用户 2026-09-14 20:0x 拍板做最小实现（「继续做 Q3 Aid 系统（Perpendicular to 的 Aid 类目标）」），E3D 进程不在跑，口径照 PML 源码定（`static_expectation`）。

**E3D 口径**（`gphline.pmlobj` / `gphplane.pmlobj` / `edgpick.pmlobj` 746 `stdAid` / `edgpicktype.pmlobj` / `edgpositiondata.pmlobj`）：

- **Aid LINE**（`GPHLINE`，核心对象 `LINE`）：一条有限的 `start → end`。`stdAid` 拾中回 `DESIGNAID` + aid 号；`snap()` = `GMFLINE.snap`（离拾取射线最近处 → 近端），
  `exact()` = 线上离射线最近处，Distance / Proportion / Fraction 沿线派生，`getLine()` 回那条 LINE（`edgpositiondata` 179 / 301，`LINE.near` 是无限线 → Perpendicular to 投到无限线上），
  `intersect()` 把 LINE 交出去。这些正是拾取类型内核（`pickDerivation.ts`）对带 `segment` 候选的既有契约，Aid 模块只供几何。
- **Aid PLANE**（`GPHPLANE`，核心对象 `PLANE` = 位置 + 姿态，Z 为法向）：画成 `x × y` 的矩形框（构造缺省 `x = y = 5000mm`，107–108）+ 1 mm 法向短线（319 / 324 `ZLENGTH 1mm`），
  四角在 `threeDPosition(±x/2, ±y/2)`（328–331）。各单击拾取类型一律回 `pointVector.intersection(plane)`（射线 ∩ 面），`getPlane()` 回那张 PLANE（430），`intersect()` 交 PLANE。
  E3D 只拾画出来的图形——射线要落在矩形上。
- 标签：`tag` 开着时 `Line [n]`（`gphline` 335–337）/ `Plane [n]`。编辑窗体：线 = 位置（Start / End）+ Direction + Length（`gphlineedit.pmlfrm` 77–81 / 128–131）；
  面 = 位置 + `Z is`，或「Through three points」（`gphplaneedit.pmlfrm` 83 / 89）。
- **没照搬**：Aid POSITION / ARC / 各类 grid、`detail` 文字、颜色 / 线型表、aid 文件（`definition()`）。

**Web 落地**（决策 `d-561`；CONTEXT「设计辅助」）：

- 纯内核 `src/measurement/aids/designAid.ts`：`createAidLine` / `aidLineFromDirection`（Start / Mid / End 锚点）/ `createAidPlane`（位置 + 法向 + Y 提示 + 尺寸）/
  `aidPlaneFromThreePoints`（位置 = 点 1，Y 沿 1 → 2）/ `aidPlaneCorners` / `aidLineRayHit`（异面直线最近点，夹到线段内）/ `aidPlaneRayHit`（射线 ∩ 面 + 矩形内判定，2 % 边距吃框线）/
  `nextAidNumber` / `aidDisplayName`。面的 X / Y 在只给法向时：Y = Up 在面内的投影（水平面回 North），X = Y × Z——水平面与 E3D 缺省 `Y is N / Z is U` 一致；倾斜面 E3D 自己的
  `ORIENTATION('Z is …')` 补全规则**未核对**（Web 取舍）。坐标一律设计 World 米。
- 会话仓 `useMeasurementAidStore.ts`：辅助按创建顺序编 1、2、3 …（E3D 是全局 `!!aidNumbers` 池），只在内存（E3D aid 也不落库）；增删 / 显隐 / 描述改动推 `revision`。
- 点源 `design_aid`（`buildDesignAidCandidates`）：可见辅助线 → 线候选（控制点 = 线上离射线最近处，带整条 `segment` 与 `direction`），可见辅助面 → 面候选（射线 ∩ 面且落在矩形内，带 `plane` + 四边 outline，`rayHit`）。
  **只在 Aid 过滤器下参与**（`measurementPickFilterAdmits('aid') = feature 'aid'`，E3D `stdAny` 从不拾 aid，ADR 0060 之一不变）；隐藏的辅助不出候选。缺省 `snap: true / show: false`（图形本身画在场景里，不另画十字）。
- 图形：`renderDesignAids()` 在场景里画线段 + 矩形四边 + 法向短线（短线画到短边的 10 %，为的是屏幕上看得见方向——E3D 是 1 mm，Web 取舍），品红，`noPick`，随辅助集合 / 全局模型矩阵变化重画。
- Perpendicular to：辅助线走 `getLine()` → 无限线（目标名 = 辅助自己的名字，不缀「轴线」）；辅助面走 `getPlane()` → 无限面（目标名同样是辅助名，`facet-plane` provider）。
- 面板 `MeasurementAidPanel.vue`（右侧「测量」dock 的折叠块「设计辅助（Aid）」）：新建线（两点 / 位置 + 方向 + 长度）、新建面（位置 + 法向 / 过三点 + X / Y 尺寸）、
  「填入最近一条距离 / 角度测量的点」快捷、列表（显隐 / 删除 / 清空）、「切到 Aid 过滤器」。输入按 E3D `!!distanceFmt` 用 mm。
- 拾取层：`MEASUREMENT_PICK_FILTER_AVAILABILITY.aid = available`（覆盖条 Aid 按钮不再灰），External 仍占位。

**Web 实机走查**（**无任何 mock**：缺省 gen-model-v1 + `:8024`，`?model_source=gen-model-v1&gm_backend_port=8024&show_refno=24381_177298`，浮条真点「自由表面」+ 只留「模型表面点」，
真指针；临时 spec 已删）：

1. 真距离测量两个表面点 `p1 = E 2705.624 N 11818.014 U 23326.211` → `p2 = E −7966.541 N 8249.809 U 3172.000`（mm，长 23082.9），落库后在面板「填入最近一条距离测量的两点」
   建 `Line [1]`（描述「梁上两点」），再「过起点、法向 = 起点 → 终点」建 `Plane [2]`（4000 × 4000）。列表 2 条，场景里 `measurement-design-aids` 组 6 条线段（1 线 + 4 框边 + 1 法向短线）。
2. 切 Aid 过滤器（面板按钮 → 覆盖条摘要 `Aid · Snap`，提示条 `等待捕捉（设计辅助线 / 面（Aid））`）。悬停线上 30 % 处 → `梁上两点 · Snap`，点下去 Snap 取近端 = `p1`（Δ 0.0002 mm，
   来自面板 0.001 mm 取整）；悬停面上离 `p1` 沿面内 X 1 m 处 → `Plane [2]`，点下去 = 射线 ∩ 面（离面 5e-8 m）。结果表 `Distance 1000mm · +317mm / −948mm / 0mm · S 18.4871 E 0.0000411852 U`
   = 面内 X 方向 1 m（`web-aid-live-01-distance-line-to-plane.png` / `web-aid-live-02-result-card-line-to-plane.png`）。
3. Perpendicular to 辅助线：Any 下点第三个表面点 `E −3056.8 N −11014.7 U 3172.0`，切 Aid 拾辅助线 → 垂足 `E −8293.9 N 8140.4 U 2553.8`，与「投到过 p1、方向 p2 − p1 的无限线」独立算的垂足
   Δ 4.7e-7 m（垂足在线段延长线之外——无限线口径）；结果卡 `Perpendicular to · 点→无限线 · 梁上两点`，`Distance 19868mm · Vertical 618mm · Horizontal 19858mm · S 15.2911 E 1.78301 U`
   （`web-aid-live-03-result-card-perpendicular-line.png`）。
4. Perpendicular to 辅助面：同一起点 → 垂足 `E 7942.7 N −7337.1 U 23944.4`，与「投到过 p1、法向 n 的面」Δ 6.6e-7 m；结果卡 `点→无限面 · Plane [2]`，
   `23791mm · 20772mm / 11598mm · W 18.4872 S 60.8237 D`（`web-aid-live-04-perpendicular-plane.png` / `web-aid-live-05-result-card-perpendicular-plane.png`）。
5. 页面错误 0；数值见 `web-aid-live-records.json`。「近似」标记来自起点是模型表面点，与辅助无关。

**走查时撞到的既有口径（不是 Aid 的问题，记下来免得下次再查两小时）**：尺寸图形在测量**第 1 步**（尚无草稿）对悬停有优先权——`viewerBindings` 在 canvas 捕获阶段命中尺寸（6 px）就
`stopImmediatePropagation`，门控 `setInteractionGate(() => !currentMeasurement)` 只在草稿进行中放行落点。辅助线与它所来自的那条尺寸线重合，第 1 步在线上悬停时 pointermove 到不了测量工具，
表现为「拾不到」；spec 里先删掉那条记录再拾。用户拿距离测量造辅助线后立刻在同一处拾，也会碰到这一条——要改是尺寸 / 测量的优先级口径（另议）。

**单测**：`designAid.test.ts` 12 条（线 / 面构造、锚点、三点面、帧规则、射线求交、编号命名）、`useMeasurementPickSources.designAid.test.ts` 5 条（候选、矩形内判定、隐藏跳过、
只在 Aid 过滤器下放行并胜出、会话仓编号 / revision）、`pickLayerModel.test.ts` / `MeasurementOverlayBar.test.ts` / `useXeokitMeasurementStyleStore.test.ts` 把「Aid 灰掉」改成 External。

**已知偏离 / 残余**：
- 辅助只在内存，刷新即丢（E3D 同样不持久化 aid；要留下来另立项）。
- 只有 LINE / PLANE 两类；POSITION / ARC / grid、颜色 / 线型不做。
- 倾斜面的面内 X / Y 取法是 Web 规则，未对 E3D `ORIENTATION('Z is …')` 的缺省补全核对（只影响 Offset 的 U / V 字母指向，不影响距离 / 垂足）。
- E3D 运行时 golden（stdAid 拾取、aid 的 Perpendicular 结果表）未采，E3D 不在跑。

## 29. DPOINT：设计点随 P-Point 拾中、Distance 沿方向偏移、Perpendicular to 取法向面 实机走查（2026-09-14 23:40）

**为什么现在做**：方案 §2 #15 的 DPOINT 一直 ✗（TUBING 2026-09-13 已落地）；用户 2026-09-14 20:0x 拍板「继续做 #15 DPOINT 拾取过滤器」。E3D 不在跑，口径照源码（`static_expectation`）。

**E3D 口径**（`edgpicktype.pmlobj` / `edgpositiondata.pmlobj` / `edgpickmode.pmlfnc` / `splcreatweld.pmlfrm`）：

- 数据：设计元素（EQUI / SUBE / STRU / FRMW / TMPL …）名下的 **DPSE** 装设计点 **DPCA**（直角）/ **DPCY**（柱面），各带 `NUMB` / `POS`（属主帧）/ `ORI`；在属主上表现为伪属性数组
  `DPPS[n]`（世界位置）/ `DPDI[n]`（世界方向）。
- 拾取：设计点与目录 P-Point 同一批拾取模式出来（`stdPpoint` → `data.type eq 'DPOINT'`），所以 Web 在 **Any / Ppoint** 过滤器下放行 `dpoint`，Element / Pline / Graphics / Aid 不放行。
- 派生：`snap()` / `exact()` / `proportion()` 回 `item.dpps[n]`（354–355 / 505–506 / 1161–1162）；`distance(d)` = `dpps[n].offset(dpDir[n], d)`（1011–1012）；`intersect()` = POINTVECTOR
  `(dpps[n], dpDir[n])`（733–736）；`getLine()` **没有** DPOINT 分支（回落属主元素的 `line()`，EQUI / STRU 没有），`getPlane()` 给「`position = dpps[n]`、`Z is dpdir[n]`」的面（590–593）
  → Perpendicular to 设计点 = 投到过该点、法向 = 方向的面。
- `DPDI[n]` 取 `ORI` 的 Z 轴（`edgpickmode.pmlfnc` 194–195 把 `dpps` / `dpdi` 与 `pPos` / `pdir` 同样配对）；stored `ORI` 三元组按 `Rz · Ry · Rx`（`aios_core::tool::math_tool::angles_to_ori`，
  gen-model 建 `world_transform` 的同一约定）合成；DPCY 按 DPCA 处理（`ANGL` / `BORE` 不解释）。

**Web 落地**（决策 `d-563`；CONTEXT「设计点」）：

- 纯内核 `src/measurement/dpoint/designPoints.ts`：`parseE3dTriple`（数字数组 / gen-model `display` 串 / PDMS `E 100mm N 200mm U -86mm` 字母串）、`parseDesignPointAttributes`（`NUMB` / `POS` / `ORI`）、
  `oriRotationColumns`（`Rz · Ry · Rx`）、`designPointToWorld`（属主 `world_transform` × POS → DPPS，× ORI Z 轴 → DPDI）、属主链止于 ZONE / SITE / WORL / TPWL / TMAR / GPWL / GPSE / REGI / DB。
- 加载器 `designPointLoader.ts`：悬停到叶子（有几何的元素）时沿属主链往上到 ZONE 之下逐个 host 查一次——`tree.children(host)` → DPSE → `tree.children(dpse)` → DPCA / DPCY →
  `attributes.uiAttr(point)` → 属主 `keypoints.ptset(host).world_transform`（gen-model-v1 `element/ptset` 对没有 P-Point 的 STRU 也给恒等 / 属主链矩阵）；全部 best-effort，失败只丢那一个 host。
  各节点类型走一份 `nounCache`，同一 STRU 下换叶子悬停不再重查属主（gen-model-v1 `tree.node` 要两次请求）；`24381/1` 与 `24381_1` 两种写法当同一个。
- 点源 `design_point`（`buildDesignPointCandidates`）：点候选在 `DPPS[n]`，带 `DPDI[n]` 当 `direction`（Distance 沿它偏移、Intersect 当点向量线），标签 `设计点 #n（PURP）`，
  命令条前缀属主类型；优先级 22 排在 P-Point（20）之后——目录 P-Point 正压在设计点上时仍是 P-Point 赢；缺省 `show / snap` 开。
- Perpendicular to：`design_point` 命中的 `direction` 不当轴线、当**法向**——`resolvePerpendicularTargetFromHit` 给 `plane { position: dpps, normal: dpdir }`（`facet-plane` provider），
  目标名 `设计点 #n 法向面`。
- 拾取层：`MeasurementPickFeature` 加 `dpoint`；`Any` / `Ppoint` 放行；`SOURCE_FEATURES.design_point = ['dpoint']`；提示条列它在「管身轴线」之后；记录里 `sourceInfo.source` 认 `design_point`；
  尺寸吸附语义表把它记成 `p-point / exact`。

**Web 实机走查**（**无任何 mock**：`?model_source=gen-model-v1&gm_backend_port=8024&show_refno=23714_1111`——MDS special STRU `/MDS/SPECIALS/LIGHTING/1`（库 7330），
名下 DPSE `23714/1126` → DPCA `23714/1127`：`NUMB 1 · POS (0, 0, −86) · ORI (0, 0, 0) · PURP unset`，STRU `world_transform` 恒等 → `DPPS = (0, 0, −86) mm`、`DPDI = U`；这件 special 缺省视距下只有几十像素，
spec 先把相机拉到模型跟前；临时 spec 已删）：

| 步 | 做法 | 结果 | 独立期望 | 图 |
| --- | --- | --- | --- | --- |
| 悬停 | Any × Snap，光标到 `(0, 0, −86)` 的投影处 | 标签 `设计点 #1`（命令条 `STRU 设计点 #1`） | 悬停立柱 SCTN `23714/1124` 时已沿属主链 SCTN → FRMW → STRU 查到 DPSE | — |
| Snap | 设计点 → 立柱上的表面点 | 起点 = `(0, 0, −86)`（Δ 8e-17 m）；`Distance 617mm · −109 / +9 / +608 · W 4.71118 N 79.809 U` | 两点差向量 | `web-dpoint-live-01-distance-dpoint-to-surface.png` / `web-dpoint-live-02-result-card-dpoint-snap.png` |
| Distance 500 | 拾取类型 Distance = 500 再拾设计点 | 起点 = `(0, 0, 414)` mm（Δ 0） | `dpps.offset(dpDir, 500)` = `(0, 0, −86 + 500)` | — |
| Perpendicular to | Any 下先点表面点 `(−108.9, 9.0, 521.7)`，再拾设计点 | 垂足 `(−108.9, 9.0, −86.0)`（Δ 8e-17 m）；结果卡 `点→无限面 · 设计点 #1 法向面`；`608mm · Vertical 608mm · Horizontal 0mm · U` | 表面点投到过 `(0, 0, −86)`、`Z is U` 的面 | `web-dpoint-live-03-result-card-perpendicular-dpoint.png` |

- 请求全是 `tree/ancestors` / `tree/children` / `element/attributes`（DPCA 属性只查一次）/ `element/ptset`：悬停过 10 个叶子共 53 次树请求（没有 `nounCache` 那版是 99 次——每个叶子都把 STRU / ZONE 的属主链重查一遍）；页面错误 0；数值见 `web-dpoint-live-records.json`。
- 第 2 / 3 步前同样先删掉上一条记录：它的尺寸线从设计点出发，第 1 步尺寸悬停优先会吞掉设计点处的 pointermove（§28 那条既有口径）。

**单测**：`designPoints.test.ts` 11 条（三元组三种写法、NUMB / POS / ORI、`Rz · Ry · Rx` 与 Z 轴、`world_transform` 映射、属主链止点 / 同名两种写法 / nounCache、DPSE → DPCA / DPCY 收集与排序、
无 DPSE 不查 ptset、错误不抛）、`useMeasurementPickSources.designPoint.test.ts` 3 条（候选形状与标签、Any / Ppoint 放行、Perpendicular 取法向面）、`pickLayerModel.test.ts` 的 Any / Ppoint 列表加 `dpoint`、
`useXeokitMeasurementTools.test.ts` 提示条列「设计点（DPOINT）」。测量相关 42 文件 / 505 用例全过；eslint 0；type-check 与 HEAD 同。

**已知偏离 / 残余**：
- `DPDI` = `ORI` 的 Z 轴、`ORI` 按 `Rz · Ry · Rx` 合成——都是 `static_expectation`，本库唯一的样本 `ORI (0, 0, 0)` 检验不出旋转分支；E3D 运行时 golden 未采。
- DPCY 的 `ANGL` / `BORE` 不解释（当 DPCA）。
- 悬停才加载：光标没到过某个属主的叶子之前，它的设计点不在候选里（与 P-Point 同一口径）。
- 主库 `24381` 没有 DPSE，实机用的是 MDS special 模板库 `7330`。


## 30. Angle 2 Lines（两线夹角）：Graphics 边 × 边 / 边 × 面出角度记录，平行拒收 实机走查（2026-09-15 05:33 / 05:34）

**为什么现在做**：方案 §2 #9 是 P0 里最后一条 ✗（「无 EDGE 拾取；G6-04 未采」）。Graphics 边 / 面 provider（§12）与三点角内核（§22 / §24 / §25）都在了，
两线夹角只差 `gmfArc.radius2Lines` 这一段内核和两击的接线。E3D 进程不在跑，口径照 PML 源码（`static_expectation`）；G6-04 里「产品 UI 可达性」这一问静态就能答：
`design.uic` 3538–3551 有 `AVEVA.DesignGeneral.buttonMeasureAngleLines`（Caption `Angle 2 Lines`，执行 `LINEANGLE`），4413 挂在 Design 功能区 Measure 下拉里——
它是正经 E3D 入口，方案 Q6「若 UI 不可达是否仍做」的前提不成立。

**E3D 口径**（`edgpickpacket.pmlobj` 635–651 `measureLineAngleArc`、`gmfarc.pmlobj` 802–917 `radius2Lines`、`gphanglemeasure.pmlfrm` 334–410）：

- 两击都是 `stdGraphics`：`first line` 只拾 `EDGE`，`second line or plane` 拾 `FACET EDGE`；凑齐调 `gmfArc.radius2LinesNoError(first.positionData(), second.positionData())`，
  出来的 ARC 进**同一张** Measure Angle 窗体（`gphAngleMeasure.setMeasure(arc)` → Decimal Angle / DMS / Direction1 / Direction2）。
- **两线**（855–890）：弧心 = `baseLine.intersection(referenceLine)`——共面取交点，异面取**第一条线**上离第二条最近的点（与 Intersect 拾取类型同一条 `LINE.intersection` 读法），
  平行 → `(2,870)` → `alert.error('An angular dimension could not be constructed from the data selected')`。第二条臂是第二条线**平移到弧心**、从它自己的最近点朝用户拾中的位置；
  第一条臂从弧心朝第一条线上拾中的位置（871–890 的 start / end 互换）。所以报的是两条**拾中的半线**的夹角——点另一侧得补角，这是 E3D 行为不是 bug。
- **线 + 面**（826–854）：参照线 = 基线在面上的投影。基线在面内（两端 < 0.1 mm）→ 0° 弧（半径 100 mm，X = 基线方向）；基线垂直于面（投影退化成点）→ 参照取面内方向
  （E3D 取拾中项的 `ORI` X），角 90°；否则弧心 = 基线穿过面的点，角 = 基线与其投影的夹角。基线平行于面但不在面内 → 投影与基线平行 → 同一句错误。
- **半径**（892–903）：弧心在基线段外 → 弧心到近端的距离；否则两条线较短者的一半；不低于 500 mm。ARC：X = 基线方向，Z = (弧心, 拾中 1, 拾中 2) 面的法向，`endAngle = root.angle(p1, p2)` ∈ [0°, 180°]。
- 造不出 ARC 时 E3D 整包重来（`alert.error` 后重新 `first line`）。

**Web 落地**（决策 `d-587`；CONTEXT「两线夹角」）：

- 纯内核 `src/measurement/kernel/lineAngle.ts`：`buildLineAngle(base: line, reference: line | plane)` → `{ root, angleDeg, direction1, direction2, radiusM, planeNormal, skew, gapM, inPlane }`
  或 `{ ok: false, reason: parallel-lines | line-parallel-to-plane | zero-length-line | degenerate-plane | non-finite-input }`；`lineAngleArmEnd` 给弧半径处的两个臂端点。设计 World 米。
- 入口：结果卡角度模式的 `Angle` 下拉 `Angle 3 Points / Angle 2 Lines`（`angleMeasureVariant`，样式仓 V9 持久化，缺省三点；脏值打回三点）——E3D 功能区两个按钮各起一包，Web 用一个开关。
  切换时丢掉进行中的三点草稿 / 第一条线。
- 接线 `useXeokitMeasurementTools.ts`：`two-line` 下角度模式的点击不走三点草稿——第一击必须能转成线（Graphics 边 / PLINE / 轴线 / 带方向的点，走 Intersect 的 `intersectOperandFromHit` 同一条分型路），
  不是线就提示改选；第二击线或面；凑齐 `buildLineAngle` 落一条角度记录：`corner` = 弧心、`origin` / `target` = 弧半径处的臂端、`lineAngle { kind, angleDeg, direction1, direction2, skew, inPlane, firstLabel, secondLabel }`。
  造不出 ARC → 提示条给 E3D 那句话的等价文案、丢掉第一条线回第 1 步、不落记录（同三点角退化的处理）。Esc / 点空白先只放弃第一条线；提示条 `两线夹角 · 第 1/2 步 选择第一条线` / `第 2/2 步 选择第二条线或面（第一条：…）`。
- 结果表 / 摘要 / 复制值：`buildAngleMeasurementResultRows` 带 `lineAngle` 时用记录里的角度与臂方向（只把两条臂换到 wrt 帧——0° 弧三点内核造不出），四行不变；
  结果卡多一行 `两线夹角 线 × 线 · PANE 边 × SCTN 边 · 异面：弧心取第一条线上离第二条最近的点`；列表摘要写「两线夹角 线 × 线 · 第一项 × 第二项」而不是三个点；`unifiedMeasurement` 往返保留 `lineAngle`。
- **Web 取舍**（记在 `lineAngle.ts` 头注释）：两条线（或线与面）夹角 < 0.01° 视为平行（`LINE_ANGLE_PARALLEL_TOLERANCE_DEG`）——Web 输入是 float32 网格边，设计上平行的构件回来相差 ~1e-5 rad，
  E3D 精确的 `LINE.intersection` 会拒掉，裸叉积却会把弧心算到几百公里外（实机见过 0.0004° → 弧心 762 km）；拾中点正落在弧心时保留线自己的方向（E3D 上移 100 mm 测一个无意义角）；
  线 × 面的投影臂朝拾中点的投影（E3D 取投影线的 end，同一组拾取按 facet 边的存储顺序得 θ 或 180° − θ）；基线垂直于面时面内方向取世界轴投影（E3D 取 `ORI` X）。

**Web 实机走查**（**无任何 mock**：缺省 gen-model-v1 + `:8024`，`?model_source=gen-model-v1&gm_backend_port=8024&show_refno=24381_177298`，浮条真点「自由表面」+ 只留「模型表面点」「Graphics」，
过滤器 Graphics、拾取类型 Cursor，真指针；相机先拉到最大那件跟前（缺省视距只有几十像素）；临时 spec 已删）。每一组的**独立期望**都不经过拾取层与被测内核：吸附点所在的网格边方向 / 面法向直接翻
`__dtxLayer.getObjectGeometryData()` 的三角形算出来，两条线的距离、弧心到线 / 面的距离、`90° − ∠(边, 法向)` 都是用它们独立算的。位置一律换到设计 World（场景帧与设计帧差一个平移
`(1.605, 1.351, 12.501) m`——上一轮 spec 全红就是把场景坐标直接和记录比，弧心「离线 12.6 m」）：

| 组 | 两击 | 结果表（Decimal Places 2）| 记录 | 独立期望 | 图 |
| --- | --- | --- | --- | --- | --- |
| 异面 | PANE `24381/177305` 顶面长边（`N 5° W`，U 23326.2）× SCTN `24381/177302` 边（`E 5° N`，U 23294.2，差一个板厚 32 mm） | `90 Degrees · 89° 59' 58'' · S 5.00 E · E 5.00 N` | `angleDeg 89.99956 · skew` · 弧心 `E 1925.7 N 14704.5 U 23326.2` · 半径 500 mm | 弧心在第一条线上（Δ 4e-16 m）；弧心 → 第二条线的垂线同时垂直于两条线、长 32.0 mm = 两线距离；臂 ∥ 各自的边（cos 与 1 差 < 1e-6）、朝拾中侧；DMS 按十进制度截断；Direction 串 = `formatCompassDirection(臂, 2 位)` | `web-line-angle-live-01-skew-two-edges.png` / `web-line-angle-live-01-skew-result-card.png` |
| 相交 | 同一 PANE 顶面长边 × 短边（共顶点） | `90 Degrees · 90° 0' 0'' · S 5.00 E · E 5.00 N` | `angleDeg 90.00000000000006 · skew false` · 弧心 = 共顶点 `E 1925.7 N 14704.5 U 23326.2` · 半径 504.8 mm | 弧心到两条线 Δ 5.6e-16 / 4.1e-16 m；半径 = 较短那条（1009.66 mm 短边）的一半（892–903） | `web-line-angle-live-03-crossing-two-edges.png` / `web-line-angle-live-03-crossing-result-card.png` |
| 线 ⟂ 面 | SCTN `24381/177301` 竖直边（`U`）× PANE 顶面（法向 `U`） | `90 Degrees · 90° 0' 0'' · D · E` | `line-plane · angleDeg 90 · inPlane false` · 弧心 `E 2894.8 N 14670.8 U 23326.2` · Direction2 = `E`（840–843：投影退化，面内方向取世界 X）· 半径 500 mm | 弧心既在边上又在面上（Δ 0）；第一条臂朝拾中侧（拾中点在面下 → `D`）；`90° − ∠(边, 法向)` = 90 | `web-line-angle-live-05-pierces-edge-facet.png` / `web-line-angle-live-05-pierces-result-card.png` |
| 斜交 · 平面内（10:28 补采） | LOOP3 SCTN `24381/177330` 下翼缘的水平棱（`N 29.54 E`，U 2958.0）× 邻梁 SCTN `24381/177331`（两梁 NA 成 64.54°）的竖直侧面（法向 `E 35.00 N`） | `64.54 Degrees · 64° 32' 24'' · S 29.54 W · S 35.00 E` | `line-plane · angleDeg 64.54003`（网格 64.540028 按 1e-5° 吸整，`87b8970`）`· inPlane false` · 弧心 `E −2805.4 N −10333.3 U 2958.0`（棱穿过侧面处）· 半径 500 mm（投影线太短，892–903 抬到下限） | 角 = 90° − ∠(棱, 法向) = 64.540028（网格）；设计侧两梁 NA 的锐角 64.540031（`element/plines`，差 3e-6° 是 float32 网格）；弧心在棱上 Δ 2e-16 m、在面上 Δ 6e-16 m、= 独立算的线 ∩ 面 Δ 4e-16 m；第二条臂在面内、= 棱在面上的投影、朝拾中点的投影 | `web-line-angle-live-06-oblique-edge-facet.png` / `web-line-angle-live-06-oblique-result-card.png` |
| 斜交 · 空间（10:32 补采） | 仪表支架 `/Copy-(2)-of-1RCS024CQ`（`show_refno=24381_102273`）里 `ORI 180 70 180` 倾斜的 BOX `24381/102287`（280 × 100 × 150）沿它 Z 轴的棱（`W 35.00 N 20.00 U`，仰 20°）× 水平 BOX `24381/102274` 的竖直侧面（法向 = 它的 X 轴 `E 35.00 S`） | `70 Degrees · 70° 0' 0'' · W 35.00 N 20.00 U · U`（`87b8970` 之前是 `69° 59' 59''` 与 `N 35.00 E 90.00 U`，见「补采」末条） | `line-plane · angleDeg 70`（网格 69.9999979 吸整）`· inPlane false` · 弧心 `E 10368.3 N 13988.1 U 252.6` · Direction2 = 棱在竖直面上的投影 = 精确竖直 `(0, 0, 1)` · 半径 500 mm | 角 = 90° − ∠(棱, 法向) = 69.9999979（网格）；设计侧：棱 ∥ 102287 放置矩阵的 Z、法向 ∥ 102274 的 X（`element/ptset` `world_transform`），90° − ∠(Z, X) = 70.000000（ORI 绕 Y 转 70°）；弧心在棱上 Δ 3e-16、在面上 Δ 2e-15、= 独立交点 Δ 3e-15 m | `web-line-angle-live-06b-oblique-tilted-edge-facet.png` / `web-line-angle-live-06b-oblique-tilted-result-card.png` |
| 斜交 · 管件路 · 竖直面（23:57 补采） | BRAN `24383/66662`（1WCC0073）里 30° 下倾斜管段的**管身轴线**（TUBI，`EDGTUBING.line` = ELBO `24383/66672` P-Point #1 → FLAN `24383/66671` P-Point #2）× 同一根 ELBO 的法兰端面（Graphics 面，法向 `N`） | `60 Degrees · 59° 59' 58'' · S 30.00 U · U` | `line-plane · angleDeg 59.99962 · inPlane false` · 弧心 `E 17899.7 N 308.8 U 17776.5`（管轴穿过端面处，在斜管段外的延长线上）· 半径 500 mm | 角 = 90° − ∠(管线, 法向) = 59.999583（网格法向 `(0, 1, 0)` 差 1.2e-7）；设计侧 leave / arrive 两个 P-Point 连线算得 59.999581——**不是整 60°，是设计坐标本身的量化**（见下「补采」）；弧心在管线上 Δ 1.6e-7 m、在面上 Δ 2e-17 m、= 独立算的线 ∩ 面 Δ 1.7e-7 m；第二条臂 = 管线在端面上的投影 = 精确竖直 `U` | `web-line-angle-live-06c-oblique-tubing-vertical-facet-tubing-facet.png` / `web-line-angle-live-06c-oblique-tubing-vertical-facet-result-card.png` |
| 斜交 · 管件路 · 水平面（23:58 补采） | 同一条管身轴线 × 阀门 VALV `24383/66676` 的水平面（Graphics 面，法向 `U`） | `30 Degrees · 30° 0' 1'' · N 30.00 D · N` | `line-plane · angleDeg 30.00038 · inPlane false` · 弧心 `E 17899.7 N −88.7 U 18006.0` · 半径 500 mm | 角 = 90° − ∠(管线, `(0, 0, 1)`) = 30.000419；设计侧 VALV P-Point #100 的方向也是 `U`，同值；弧心在管线上 Δ 2.8e-7 m、在面上 Δ 0、= 独立交点 Δ 4.9e-7 m；第二条臂 = 投影 = `N` | `web-line-angle-live-06d-oblique-tubing-horizontal-facet-tubing-facet.png` / `web-line-angle-live-06d-oblique-tubing-horizontal-facet-result-card.png` |
| 斜交 · **P-Point 当面** · 水平（2026-09-16 10:15 补采） | 同一条管身轴线 × VALV `24383/66676` **P-Point #100**（方向 `U`）——第二击拾的是 P-Point，按 E3D `EDGPOSITIONDATA.getPlane()` 当「过 P-Point、Z 沿其方向」的面（Any 过滤器 × Cursor，只留 P-Point 源） | `30 Degrees · 30° 0' 1'' · S 30.00 U · S` | `line-plane · angleDeg 30.00042 · inPlane false` · 弧心 `E 17899.66 N 164.188 U 17860`（管线穿过 z = 17860 水平面处）· 标签 `VALV P-Point #100（面）` | 角 = 90° − ∠(管线, `U`) = **30.000419**——P-Point 方向精确，没有网格噪声，比上一行 Graphics 面的 30.00038 更贴设计侧；弧心 = 独立算的管线 ∩ 面 Δ **2.8e-17 m**；第二条臂 = 管线在水平面上的投影 `S`（朝拾中侧） | `web-line-angle-live-06e-ppoint-plane-horizontal-valv-p100{,-result-card}.png` |
| 斜交 · **P-Point 当面** · 竖直（10:15 补采） | 同一条管身轴线 × ELBO `24383/66672` **P-Point #2**（方向 `N`——就是法兰端面的法向） | `60 Degrees · 59° 59' 58'' · S 30.00 U · U` | `line-plane · angleDeg 59.99958` · 弧心 `E 17899.66 N 308.838 U 17776.485`（= 上面「管件路 · 竖直面」那一行的弧心 `U 17776.5`，两条面重合） | 角 = 90° − ∠(管线, `N`) = 59.999581；弧心 Δ 0；第二条臂 = 投影 = `U` | `web-line-angle-live-06f-ppoint-plane-vertical-elbo-p2{,-result-card}.png` |
| ⟂ · **P-Point 当面**（10:16 补采） | 同一条管身轴线 × ELBO `24383/66672` **P-Point #1**（方向 = 管线的设计方向 `(0, −0.866025, 0.5)`）→ 面 ⟂ 管线 | `90 Degrees · 89° 59' 58'' · S 30.00 U · N 60.00 U` | `line-plane · angleDeg 89.99958` · 弧心 = P1 自己 `E 17899.66 N 232.838 U 17820.364` · Direction2 = 世界轴在面内的投影 `(0, 0.5, 0.866)`（投影退化，E3D 840–843 取 `ORI` X） | 不是整 90°：P1 的**方向**是精确 30°，而管线（P1 → P2 两枚 mm 级坐标的连线）是 30.00042°——同 23:57 补采那条「设计数据本身的量化」，E3D 拿同一对数据也是 89.9996° | `web-line-angle-live-06g-ppoint-plane-perpendicular-elbo-p1{,-result-card}.png` |
| **DPOINT 当面**（10:18 补采） | §29 那件 MDS special `23714/1111`（`show_refno=23714_1111`）：立柱 SCTN `23714/1124` 的竖直棱（Graphics 过滤器）× **设计点 #1**（DPCA `23714/1127`，`DPPS (0, 0, −86)`、`DPDI U`；第二击前换 Any 过滤器，已选的第一条线不丢） | `90 Degrees · 90° 0' 0'' · U · E` | `line-plane · angleDeg 90` · 弧心 `E 21.35 N 0 U −86`（棱所在直线 ∩ z = −86，在棱段外）· 标签 `设计点 #1（面）`、`sourceInfo.source = design_point` | 弧心 Δ 5.6e-17 m；Direction2 = 世界 X 在面内的投影 `E` | `web-line-angle-live-06h-dpoint-plane-column-edge{,-result-card}.png` |
| 线在面内 | PANE 顶面长边 × 它自己的顶面 | `0 Degrees · 0° 0' 0'' · N 5.00 W · N 5.00 W` | `line-plane · angleDeg 0 · inPlane` · 两臂同向 · 半径 100 mm（`origin − corner` = 0.1 m） | 边 ⟂ 法向（d·n = 0）且拾中点在面上；弧心在边上 Δ 1.3e-16 m | `web-line-angle-live-07-in-plane-edge-facet.png` / `web-line-angle-live-07-in-plane-result-card.png` |
| 拒收：平行 | 同一条 PANE 边点两次 | — | 不落记录；提示条 `两条线平行，画不出角度尺寸（E3D：An angular dimension could not be constructed from the data selected）；已回到第 1 步`；状态条回 `选择第一条线` | — | `web-line-angle-live-09-parallel-edges-rejected.png` |
| 拒收：线 ∥ 面 | SCTN `177301` 水平边（U 23104.6）× PANE 顶面（U 23326.2，离面 221.7 mm） | — | 不落记录；`线与面平行且不在面内，画不出角度尺寸（E3D：…）；已回到第 1 步` | d·n = 0 且离面 > 0.1 mm → E3D 850–853 投影与基线平行 | `web-line-angle-live-10-edge-parallel-facet-rejected.png` |

- 第一击后提示条 `两线夹角：已选第一条线 PANE 边，再选第二条线或面`、状态条 `第 2/2 步 选择第二条线或面（第一条：PANE 边）`，记录数不变；切到 `Angle 2 Lines` 时结果卡空态文案换成「先拾一条线，再拾一条线或一个面」。
- 页面错误 0；全部数值（含每组的独立期望、采样到的边 / 面、场景原点在设计帧的位置）见 `web-line-angle-live-records.json`。
- 每组前先删掉上一条记录：两击都不算草稿，§28 那条「无草稿时尺寸悬停优先」对两击都生效，上一条弧 / 臂压在要拾的边上时下一次拾不到。

**补采（2026-09-15 10:28 / 10:32，`87b8970` 后 10:5x 重跑）：斜交的线 × 面一般解**——上面表里「斜交 · 平面内」「斜交 · 空间」两行。

- **找模型**：用 gen-model-v1 `tree/children` 扫了 12 个 SITE（1RB / 1RC / 1RS-CIVI、1PTU-INST23、`SITE`、1WCC / 1RCV / 1RX03-PIPEBJ、1CCV-HVACHB、1RX-ELECBJ、Steel_Template_Site、MDS-Standards-Supports），
  27 643 件有几何的元素里核了 16 311 件的放置矩阵：**262 根 SCTN / GENSEC 的 NA 全是水平 / 竖直——本库没有斜撑**；轴真正倾斜（与竖直夹 5°–85°）的只有 278 件：管件（ELBO / FLAN / TEE / BEND / VALV，
  30° / 45° / 60° 的斜管段）、设备的斜筋板（BOX 200 × 20 × 200 与 PYRA，40°）、斜喷嘴（NOZZ 26° / 50°）、仪表支架里倾斜的 BOX。管件这一路没走：法兰盘面虽是平面，但第一条线要一条直棱——斜管段是圆柱网格（母线成不成「边」取决于 gen-model 的分段数，未核），
  附近也没有别的直棱构件。最后取两组：**平面内斜交**——同一棵 STRU `24381/177298` 的 LOOP3（`Copy-of-LOOP3` 三根短梁 177329 / 177330 / 177331，NA 两两成 90° / 64.54° / 25.46°，上面盖一张 PANE），
  一根梁的水平棱 × 邻梁的竖直侧面；**空间斜交**——`/Copy-(2)-of-1RCS024CQ` 仪表支架（水平 BOX + 两个 `ORI 180 70 180` 倾斜 70° 的 BOX），倾斜盒体沿 Z 的棱（仰 20°）× 水平盒体的竖直侧面，
  出来的 70° 就是 ORI 那一档，设计侧从放置矩阵算得 70.000000。
- **做法**：临时 spec 先从网格直接列出每件构件的真棱（二面角 ≥ 30°，同 Graphics provider 口径）与三角面片，按方向配出斜交的（棱, 面）对（5°–85°、不同构件、弧心离拾中点 ≤ 3 m），
  再用真指针悬停核实拾中的确是那条棱 / 那个面（`边` / `面` 标签、objectId、方向 / 法向一致），两击落记录；LOOP 的侧面被盖板挡住，换到第 5 个机位（从下往上 el −0.45）才拾到；支架那组第 4 个机位。
  两组页面错误 0；全部数值见 `web-line-angle-live-06-oblique-records.json` / `web-line-angle-live-06b-oblique-tilted-records.json`。
- **坑**：gen-model `:8024` 对这棵 STRU 的 14 个生成根缓存成了 `NoRenderableGeometry`（`cached_root_count 14 / generated_root_count 0 / publication_status empty`——05:33 那一轮还是好的），
  页面 `show_refno` 报「可见子实例为 0」一件都不画；`POST /api/v1/model/ensure` 带 `force: true` 重生成后恢复（19 实例、`publication_status ready`）。
- **网格精度带来的两处显示差异（不是内核错）→ 已修（`87b8970`，用户 10:4x 拍板）**：(1) 空间斜交组 Direction2 是棱在竖直面上的投影，几何上精确竖直，第一次跑显示 `N 35.00 E 90.00 U`——法向来自 float32 网格，
  投影出的水平分量 ~2e-9 超过 `formatCompassDirection` 的零容差 1e-10，`N 35.00 E` 是噪声；E3D 用精确几何投影会得纯 `U`。(2) 同一组 DMS `69° 59' 59''` 而 Decimal Angle `70 Degrees`：angleDeg 69.9999979 按 E3D 口径截断出 59' 59''，
  E3D 精确几何会是 `70° 0' 0''`。**修法**（Web 取舍，`lineAngle.ts` 头注释 + `LINE_ANGLE_DIRECTION_SNAP` / `LINE_ANGLE_ANGLE_SNAP_DEG`）：`finishArc` 先把两条臂里 |分量| < 1e-6 的归零再归一，再在吸过的两臂之间量角并按 **1e-5°** 四舍五入——
  角度、DMS、两条 Direction、臂端、弧面法向出自同一对吸过的臂。取 1e-5° 而不是提议里的 1e-6°：实测噪声 2.1e-6° 吸不进 1e-6° 网格（69.9999979 → 69.999998 仍是 59''），1e-5° = 0.036''，低于 DMS 分辩率、约 5× 于噪声；
  1e-6 在单位向量上约 6e-5°，远低于 0.01° 平行容差、约 25× 于分量噪声（~4e-8）。单测 `lineAngle.test.ts` +4（实机那两个值回灌：69.9999979 → 70、64.5400279 → 64.54003；70° 组回灌内核出 `U` 与 `70° 0' 0''`；精确输入不变）。
  重跑两组：空间组 `70 Degrees · 70° 0' 0'' · W 35.00 N 20.00 U · U`、`angleDeg 70`、`direction2 (0, 0, 1)`；平面内组 `angleDeg 64.54003`（结果表四格不变）。**同一套吸整 `75d15d4` 起也用于三点角内核**（`buildThreePointAngle`：两臂先吸、角在吸过的两臂之间量、弧面法向随吸过的臂；共用 `src/measurement/kernel/angleSnap.ts`）——两条角度路口径一致；G6-03 那两条 0.1° / 179.9° golden 的 9e-8° 尾巴低于网格，单测改成「差 < 1e-5° 且落在网格上」。(3) 弧半径下限 500 mm（E3D 892–903）在 280 mm 的盒体上比构件还大，截图前把相机拉远了一档。

**补采（2026-09-15 23:57 / 23:58）：管件路的斜交线 × 面**——上面表里「斜交 · 管件路」两行。环境 `?model_source=gen-model-v1&gm_backend_port=8022&show_refno=24383_66662`（`:8022` 上是 `gen-model-refactor` `1bd2cab4c` 的构建），
浮条自由表面 + P-Point / 模型表面点 / Graphics 开、Item 原点关，拾取类型 Cursor；第一击 Any 过滤器（放行 TUBING），第二击 Graphics 过滤器；临时 spec 已删。

- **为什么补**：10:28 / 10:32 那两组的第一击都是 Graphics 直棱，管件那一路当时以「斜管段是圆柱网格、附近没有直棱」搁下了。其实第一击**不必**是棱——`intersectOperandFromHit` 同样收 TUBING 轴线（§14），
  E3D `EDGTUBING.line` 本身就是一条 EDGE。本轮走的就是这一路：1WCC0073 的 BRAN `24383/66662` 里 30° 下倾的斜管段（`o:24383_66662:5`，长 541.3 mm、外径 114 mm），轴线两端吸到
  ELBO `24383/66672` P-Point #1 与 FLAN `24383/66671` P-Point #2（Δ < 0.005 mm），拾中处离设计管线 0.001 mm。
- **第二击一开始一个也拾不到（15:31 那一轮两组全红）**：拾点取的是**单个三角形的重心**。`buildGraphicsPickCandidates` 里画出来的边只要投影落在光标 `DEFAULT_GRAPHICS_EDGE_SNAP_PX = 12 px` 内就整包压过面
  （E3D `pickdetail` 同一口径），管件网格的三角形在那个视距下只有十几到几百 px²，重心离边不到 12 px——255 个候选面片一个都没拾到「面」，日志里清一色 `边 on …`。**改法**：(1) 把整片**共面片**
  （同法向 + 同平面偏移的三角形并成一片）找出来，而不是逐个三角形；(2) 第二击前相机**正对那一片**拉近（距离 = 片外扩半径 × 2.6~4），拾点取屏幕上离**片边界**最远处（实际拾中处余量 131 px / 107 px）；
  (3) 两击各用各的机位——先在管跟前拾轴线，再转到面跟前拾面，E3D 里两击之间同样可以转视角（第一条线不受影响，转完提示条仍是「已选第一条线」）。
- **拾中的面不必是瞄的那一片**：管端盘与邻接管件的法兰面在同一平面上背靠背，谁在前谁被拾中都行；判据改成「拾中的是一个面 + 法向合要求 + 与管轴斜交 5°–85° + 弧心离管 ≤ 3 m」。
  60° 那组最后拾到的是 ELBO 自己的端面（瞄的也是它），30° 那组瞄的是阀门 VALV `24383/66676` 的水平面、拾到的就是它。
- **这一组的「整数角」是 30.0004° 而不是 30°**：斜管的设计方向取 leave / arrive 两个 P-Point 的连线（`EDGTUBING.line` 就是这么定义的），而 P-Point 坐标是 mm 级存的——ELBO #1
  `E 17899.7 N 232.8 U 17820.4` → FLAN #2 `E 17899.7 N −235.9 U 18091.0`，Δ = `(0, −468.7, 270.6)`，仰角 30.00042°；P-Point 自己的**方向**倒是精确的 `(0, −0.866025, 0.5)`。
  所以结果表 DMS 是 `59° 59' 58''` / `30° 0' 1''` 而不是整 `0' 0''`——这**不是** `87b8970` 那种 float32 网格噪声（1e-5° 吸整管不着 4e-4°），是设计数据本身的量化，E3D 拿同一条 `EDGTUBING.line` 会得同一个值。
- 记录角与独立期望差 ~3.8e-5°（59.99962 / 59.999583、30.00038 / 30.000419）：前端的管身轴线从 float32 网格的放置矩阵派生、两端再吸到 P-Point（§14），P-Point 也过一道场景帧（float32）；
  这一档噪声落在 1e-5° 吸整网格上就是 3~4 格，仍远低于 0.01° 平行容差与 DMS 的 1'' 分辩率。
- **截图机位**：正对弧面（法向 = 两条臂的叉积，这两组都是 `∓E`）、偏 20° 抬高 12°、2.4 m 开外，画面中心取角平分线上 0.45R 处——两条臂都从弧心朝同一侧伸，对准弧心拍会把弧顶到画布上沿的浮条底下；
  按两件构件的并集包围盒框也不行（30° 那组的面在 1.6 m 外，整个画面只剩几十像素的管子）。拍之前把光标停到画布角上，拾取提示气泡才不压在弧上。机位参数记在 records.json 的 `shot` 里。
- 两组页面错误 0；全部数值（两端 P-Point、拾中点与屏幕余量、勘察过的机位、独立算的弧心）见 `web-line-angle-live-06c-oblique-tubing-vertical-facet-records.json` /
  `web-line-angle-live-06d-oblique-tubing-horizontal-facet-records.json`。**没有改任何产品代码**——这一轮只是把 §30 缺的管件路补齐。

**补采（2026-09-16 10:15 / 10:18，`03f4458`）：第二击拾 P-Point / DPOINT 当面**——上面表里「P-Point 当面」三行与「DPOINT 当面」一行。

- **为什么补**：残余里写着「E3D 的 `getPlane()` 对 P-Point / DPOINT 也给面，Web 只实机验过 Graphics 面」。翻 Administration 1.8 PMLLIB（`gmfarc.pmlobj` 798–917 `radius2Lines`）：它读的是 `!reference.line` / `!reference.plane`
  **两个成员**——`if (!reference.plane.unset())` 走两线，否则走线 + 面；成员由 `EDGPOSITIONDATA.line()` / `.plane()` 从 `getLine()` / `getPlane()` 填。`getPlane()`（`edgpositiondata.pmlobj` 421–608）有明确的
  `PPOINT → PLANE(pPosition[n], Z is pDirection[n])` 与 `DPOINT → PLANE(dpps[n], Z is dpdir[n])` 分支——与 §29 Perpendicular to 对设计点取法向面同一口径。E3D 那一击本身只放 `FACET EDGE`（`measureLineAngleArc`），
  Web 放行 P-Point / 设计点是扩展；此前 Web 把带方向的点走 Intersect 同一条转换（POINTVECTOR **线**），拾一枚 P-Point 就成了「线 × 它的轴线」，与 `getPlane()` 不符。
- **改法**：内核 `lineAngle.ts` 新增 `lineAngleOperandFromGeometry(geometry, role)`——线段 → LINE（带拾中位置）、面 → PLANE；**带方向的点第一击 = 过该点的线**（`getLine()`，同 Intersect；实机 `已选第一条线 VALV P-Point #100`），
  **第二击 = 过该点、Z 沿其方向的面**（`getPlane()`）。`lineAngleOperandFromHit` 按 `lineAnglePending` 传 role，点击与悬停提示同一处。单测 `lineAngle.test.ts` +3（两角色的线 / 面 / 退化；带方向的点两角色；
  §30 管件路那两组换成 P-Point 当面同值）。
- **数值**：P-Point 的方向是精确的（`U` / `N` / 30°），管线是 mm 级坐标连线（30.00042°）——P-Point 面那两组给出的正是设计侧 30.000419 / 59.999581，Graphics 面那两行差的 4e-5° 是网格法向噪声；
  弧心与独立算的管线 ∩ 面差 ≤ 2.8e-17 m。⟂ 那组 89.99958° 不是内核问题，是同一条「设计数据量化」。四组页面错误 0；记录仍标「近似」——来自第一击的 TUBING 轴线 / Graphics 棱（网格派生），与本表其它行同。
- 数值见 `web-line-angle-live-06e-ppoint-plane-records.json`（三组 P-Point）/ `web-line-angle-live-06h-dpoint-plane-records.json`（DPOINT）。

**补采（2026-09-16 12:32 采、13:09 原样重跑复现，入库的是 13:09 那一版，`0c0d9eb`）：D1 改后的提示条**——两线夹角两步都不带 `(token)` 与 ` Snap`，同一条拾取层下三点角照旧带。环境同上那组
（`?model_source=gen-model-v1&gm_backend_port=8022&show_refno=24383_66662`，`:8022` 上仍是 `gen-model-refactor` 的构建；E3D 模式 · 只留 P-Point 源 · Any 过滤器 × Cursor 拾取类型 · Significant Snaps 开），
vite 由临时 playwright 配置在 **`:3103`** 自起一台关掉 HMR 的（`:3102` 那台是别的会话 `watch: ignored` 起的，不重读改过的 `src`）；临时 spec 与临时配置跑完即删。

- **为什么补**：`0c0d9eb` 只有单测顶着（`pickLayerModel.test.ts` / `useXeokitMeasurementTools.test.ts` 各 +1），而提示条是给人看的东西，缺一张改后的实机图；且 `(Cursor)` 与 ` Snap` 分别由「拾取类型真选了 Cursor」
  和「Significant Snaps 开」喂出来，两个开关都真开着时才验得出「该没有的两段真没有」。
- **同一条拾取层下四态**（整句见 records.json 的 `prompts`；浮条状态格宽度有限，可见文字前缀是命令短名「角度」且末尾带 `…`，整句在它的 `title` 上，也印在画布底部那条提示行里——左端被竖排工具条压住一点）：

| 态 | `statusText`（工具层整句） | 图 |
| --- | --- | --- |
| 三点角（`stdPosition`，对照组） | `角度测量 · 第 1/3 步 选择角度顶点 (Cursor) Snap : 等待捕捉（P-Point / 管身轴线（TUBING） / 设计点（DPOINT））` | `web-line-angle-live-06i-prompt-no-token-00-three-point-cursor-snap.png` / `…-00-…-bar.png` |
| 两线夹角 第 1 步 | `两线夹角 · 第 1/2 步 选择第一条线 : 等待捕捉（P-Point / 管身轴线（TUBING） / 设计点（DPOINT））` | `…-01-step1-first-line.png` / `…-01-…-bar.png` |
| 两线夹角 第 2 步（第一击拾中管身轴线后） | `两线夹角 · 第 2/2 步 选择第二条线或面（第一条：TUBI 轴线（ELBO P-Point #1 → FLAN P-Point #2）） : TUBI 轴线（…）；点空白取消当前点选` | `…-02-step2-second-line-or-plane.png` / `…-02-…-bar.png` |
| 第二击落记录后回第 1 步 | `两线夹角 · 第 1/2 步 选择第一条线 : VALV P-Point #100` | `…-03-result.png` / `…-03-result-card.png` |
| 切回三点角 | `角度测量 · 第 1/3 步 选择角度顶点 (Cursor) Snap : VALV P-Point #100` | — |

- 四态都断言了不匹配 `\((Cursor|Snap|Mid-Point|Distance\[…\]|Fraction\[…\]|Proportion\[…\]|Intersection\[n\])\)`、不含 ` Snap`，浮条 `title` == `statusText`；中途换机位、悬停到 P-Point、第二击落地都不改结构。
  两线夹角只在切回三点角时恢复 `(Cursor) Snap`——同一条拾取层、同一批开关，差的只是 `positioning`。
- **顺带复走了上表「斜交 · P-Point 当面 · 水平」那一组**（管身轴线 × VALV `24383/66676` P-Point #100 当面）：`30 Degrees · 30° 0' 1'' · S 30.00 U · S`、`line-plane · angleDeg 30.00042`、弧心 `E 17899.66 N 164.188 U 17860`，
  与独立期望 `90° − ∠(管线, U)` = 30.000419° 差 7.7e-7°，悬停点与 `element/ptset` 差 3.6e-15 m——与 10:15 那次同值，这一笔改的只是提示串。页面错误 0。
- 整句与全部数值见 `web-line-angle-live-06i-prompt-no-token-records.json`。**没有改任何产品代码**。

**单测**：`lineAngle.test.ts` 17 条（共面交点 / 拾中侧决定臂向 / 斜交 60° 与补角 120° / 异面弧心与 gap / 平行拒收 / 0.01° 平行容差两侧 / 弧心在段外的半径 / 500 mm 下限 / 拾中点在弧心 /
臂端回灌三点内核同角；线 + 面一般解 / 投影臂朝拾中侧 / 线在面内 0° 弧 / 垂直 90° 与面内方向 / 平行于面拒收 / 未归一法向；退化输入），`xeokitMeasurementFormat.test.ts` 3 条（四行来自记录、0° 弧、摘要 / 复制值），
`MeasurementResultInspector.test.ts` 1 条（开关 + 两线记录渲染）、`useXeokitMeasurementStyleStore.test.ts` 1 条（V9 持久化 / 脏值）、`unifiedMeasurement.test.ts` 1 条（往返）。
测量相关 6 文件 129 用例全过；eslint 0；type-check 与 HEAD 同。

**已知偏离 / 残余**：
- E3D 运行时 golden（G6-04：`measureLineAngleArc` 注入的 ARC 与四行）未采，E3D 不在跑；上面全是 `static_expectation` + Web 实机。G6-04 的另一半「产品 UI 可达性」2026-09-16 静态答了：功能区 `Angle 2 Lines` → `gphViews.measure('LINEANGLE')`（`gphviews.pmlobj` 1301–1303）→ `GPHANGLEDIMENSION.edit('LINEANGLEARC')` → 画弧包，就是本节这条；E3D 另一条 `measureLineAngle`（`gmfAngle.betweenLines`，返回 REAL 不画弧）只服务三张设计表单的角度输入框（`dbeelementangle` 799 / `dbesrevolution` 658 / `dbeloopedit` 1716），Web 无对应入口 → 不做（矩阵 D6），两条包在同一对线上的角相等已由 `lineAngle.test.ts` 逐组钉住（差异只有平行那一档：非弧包吞错返 0）。
- ~~斜交（既非 0° 也非 90°）的线 × 面一般解只有单测——本库这组构件的网格全是正交棱；斜边要等有斜撑 / 管件的模型。~~ 10:28 / 10:32 补采两组（见上「补采」）：本库没有斜撑，
  用 LOOP3 平面内 64.54° 的短梁与仪表支架里 ORI 倾斜 70° 的盒体走通；~~管件没走（斜管段是圆柱网格、附近无直棱当第一条线）~~ 23:57 / 23:58 管件路也补上了（第一击换成 TUBING 轴线，本来就不必是直棱；见「补采（23:57 / 23:58）」）。补采撞出的 float32 网格噪声（精确竖直的 Direction2 显示成 `N 35.00 E 90.00 U`、DMS 少 1''）已在 `87b8970` 吸掉（见「补采」末条）。
- ~~第二击的 `FACET` 在 Web 是 Graphics 面（三角形面片的平面）；E3D 的 `getPlane()` 对 P-Point / DPOINT 也给面（§29），Web 这里同样走 `intersectOperandFromHit`，但只实机验过 Graphics 面。~~
  2026-09-16 10:15 / 10:18 补采：第二击的 P-Point / DPOINT 改按 `getPlane()` 当面（`03f4458`，此前是 POINTVECTOR 线），P-Point 三组 + DPOINT 一组实机走通（见「补采（10:15 / 10:18）」）。
- 两击都不进草稿，所以 Esc 第一层只放弃第一条线（E3D 整包退）——与 Intersect 子拾取同一层，方案 §2 #20 的分层口径不变。

## 31. 真 GENSEC 当 wrt：设计模板 TMPL 15240/4 的立柱 / 横杆截面标架 实机走查（2026-09-15 05:58）

**为什么现在做**：§26 把 GENSEC 当 wrt 的两条 E3D 特例（Offset = 截面标架三轴的非负投影、Direction 按 World）落了地，但实机是**夹具化**的——主库 24381 一件 GENSEC 都没有，
残余一直记着「真 GENSEC 未实机」。2026-09-14 20:33 上一会话在 gen-model 里找到了真样本：设计模板库 7048 的 TMPL `/AVEVA_Two-Bay_Top-Mounted_Panel`（`15240/4`）名下有 **5 根直 SPINE 的 GENSEC**
（`Rail_Profile 15240/5`、`Hand_Rail_Profile 15240/9`、`Post_1/2/3_Profile 15240/41 / 37 / 33`）+ 3 张 PANE，gen-model 能为它建模（14 个实例），当时跑通并采了图，但没写进本文。
本轮对着 HEAD（`c8e1f13`）重跑一遍，数字逐格相同，产物换成 05:58 这一版落库。

**数据**（全从 `:8024` 真数据来，无任何 mock）：

- `tree/children 15240/4`：GENSEC × 5、PANE × 3、DDSE / DPSE 各 1。`element/plines`：`Post_3_Profile 15240/33` **52 条** p-line（`SNFA … SNFL …`，SPINE 方向 `(0, 0, −1)` = D），
  `Rail_Profile 15240/5` **9 条**（`TOS / LTOS / LBOS / RBOS / RTOS / BOS / LEFT / RIGH / NA`，方向 `(1, 0, 0)` = E）——§17 后端只接直 SPINE 的分支，这两根就是它的运行时样本。
- `element/ptset` 的 `world_transform` 对两根都是**恒等**（模板放在原点）→ 它们的 **ORI 帧 = World**（X = E / Y = N / Z = U）。这一点让下面的对照特别干净：
  若 Web 仍按 ORI 帧算，Offset 就该是 World 那一行 `+999 / +1 / −252`（或它的绝对值）。
- 测试进程自己从这批 p-line 解截面标架（`deriveSectionBasisFromPlines`，不经过页面）：`Post_3` → u = W `(−1, 0, 0)` / v = N / w = D `(0, 0, −1)`；`Rail` → u = N / v = U / w = E。

**Web 实机走查**（`?model_source=gen-model-v1&gm_backend_port=8024&show_refno=15240_4`，浮条真点「自由表面」+ 只留「模型表面点」，真指针两击 `Post_2_Profile 15240/37` 与 `Post_3_Profile 15240/33`
的表面点，草稿 `origin E 1310.49 N −117.11 U 823.45` → `target E 2309.54 N −116.16 U 571.80`（mm，Δ = `+999.05 / +0.95 / −251.66`，长 1030.26）；参考系框输 `=15240/33` / `=15240/5` 各算一次，再切回 World；临时 spec 已删）：

| wrt | 状态条 | 结果表 | 独立期望 | 图 |
| --- | --- | --- | --- | --- |
| `DBREF 15240/33`（立柱，Z = D） | `当前 DBREF 15240/33 · U/V/W`，无 wrt 错误 | `Distance 1030mm · Offset U 999mm · Offset V 1mm · Offset W 252mm · Direction E 0.054391 N 14.1386 D` | \|Δ·u\| / \|Δ·v\| / \|Δ·w\| = 999.05 / 0.95 / 251.66；Direction = World 差向量的罗盘串；三格都不带符号 | `web-gensec-real-live-01-distance-15240_33.png` / `web-gensec-real-live-01-result-card-15240_33.png` |
| `DBREF 15240/5`（横杆，Z = E） | `当前 DBREF 15240/5 · U/V/W` | `1030mm · Offset U 1mm · Offset V 252mm · Offset W 999mm · E 0.054391 N 14.1386 D` | 0.95 / 251.66 / 999.05——同一段测量，三个数按横杆的截面轴**重排** | `web-gensec-real-live-02-distance-15240_5.png` / `web-gensec-real-live-02-result-card-15240_5.png` |
| World | `World` | `1030mm · Offset X +999mm · Y +1mm · Z −252mm · E 0.054391 N 14.1386 D` | 带符号、Direction 同一串 | — |

- **判别点**：两根 GENSEC 的 ORI 帧都是 World，所以「ORI 分量取绝对值」对立柱那一行碰巧也能给出 `999 / 1 / 252`；横杆那一行 `1 / 252 / 999` 只有截面标架（u = N / v = U / w = E）能解释——
  与 §26 用 G3-04 夹具（ORI 与截面标架差 90°）证的是同一件事，这次是真元素。Direction 三行同一串，按 World、不随 wrt（§26 口径）。
- 请求：`/api/pdms/transform` **0**（§27 起元素帧走 `element/ptset`），`element/plines` 恰好两次（`15240/33` / `15240/5`，只在 noun 是 GENSEC 时拉），`element/ptset` 只对悬停过的成员与 wrt 元素；页面错误 0。
  全部数值见 `web-gensec-real-live-records.json`。
- 结果表行名 `Distance / Offset U / Offset V / Offset W / Direction`（wrt 不是 World 时 U/V/W，§26 413–431）。

**已知偏离 / 残余**：
- 这 5 根 GENSEC 的截面标架都是世界轴的排列（SPINE 沿 D / E，BANG 0），没有 §26 夹具那种 155° 的斜截面——斜截面 + 真 GENSEC 的组合仍没有样本；含弧 SPINE 的 GENSEC 也没有。
- `Hand_Rail_Profile` / `Post_1 / Post_2` 没当 wrt 再跑（与 `Rail` / `Post_3` 同形）。
- E3D 运行时 golden（同一模板在 E3D 里的 `Q OFFSET WRT =15240/33`）未采，E3D 不在跑；§26 的 G3-04 trace 仍是唯一的 E3D 侧证据。

## 32. Shortest（方案 §2 #10 / G5）：前提清单与静态答复——E3D 3.1 里「Measure Shortest」到底是什么（2026-09-15 11:0x）

**为什么现在做**：方案 P0 只剩 #10 Shortest，一直「卡 G5」——五条 golden 一条没采（E3D 不在跑）。先把 G5 五条到底在问什么列清楚，能从 PML 源码静态答的先答（`static_expectation`），
剩下的才是真要 E3D 运行时的。结论先写在前面：**E3D 3.1 的「Measure Shortest」在产品里只是 Picking Control 偏移字段的一个右键填值助手，两次 Graphics 拾取后拿到的永远是两拾中点的距离——
`gmfLine.shortest` 里线 / 面那几段分支从产品入口进不去**。方案 §1.4 / Phase D 按「点 / 线 / 面 / 圆弧两两最短 + witness」设想的那一套，在 E3D 里并不存在。

**证据链**（`E:\reverse\e3d\msi_admin_extract\Everything3D3.1`，全部静态）：

1. **入口（G5-05）**：`design.uic` 4168 `AVEVA.DesignGeneral.ButtonSettingsPickingControl`（Caption `Picking Control`）→ `designsettingspickingcontrol.pmlcmd` 33 / 42 `show !!edgSettings`；
   Positioning Control 工具条也开它（`edgposcntrl.pmlobj` 1023–1034 `.edgSettings()`）。`edgsettings.pmlfrm`（formTitle `Picking Control`，174）里带 `Measure` / `Measure Shortest` 右键菜单的字段：
   ENU 偏移 `xENU / yENU / zENU`（244–257 → `setMeasureENU('SHORTEST', 'East' | 'North' | 'Up')` 306–328 → `measureENU` 348–365：`!line.length()` 写进该轴分量，unset → 0）、
   工作面偏移 `xPlane / yPlane`（395–403 → `setMeasurePlane` 451–475 / `measurePlane` 495–512）、Distance-Direction 偏移 `distanceDD`（542–545 → `setMeasureDD` 596–621）、
   表面偏移 `distanceSurface`（813–816 → `setMeasureSurface` 919–941 / `measureSurface` 960–970）。四处都是 `EDGPACKET.defineMeasure('shortest')`（`edgpacket.pmlobj` 1074–1076）→
   `EDGPICKPACKET.lineShortest()`（`edgpickpacket.pmlobj` 1573–1586：prompt `Measure distance`，两次 `EDGPICKTYPE.stdGraphics('from' / 'to')`，action `!!appMathLib.gmfLine.shortest(return[1], return[2])`）。
   `stdGraphics` = `EDGPICK.stdGraphics()`（`edgpick.pmlobj` 867–878，`inMode 'pickdetail'`，只拾绘制细节）。
   另一处活入口：固定直径圆辅助的 `!!edgDiameter`（`edgdiameter.pmlfrm` 69–72 菜单 / 94–120 / 167–177 写进 `diameter`），由 `EDGPACKET.defineCircle('FIXEDDIAMETER3D' | '2D')`（735–807）打开，
   钢结构 `strringcreate.pmlfrm` 65–66 两个按钮走得到（`AVEVA.Design.steelwork.uic` 1958 `HID_STRRINGCREATE`）；Aid Constructors 菜单 `aidconstructs.pmlfrm` 126 / 128 也走得到，
   但 `!!aidConstructs` 本身不在 3.1 功能区（`CommandDesignViewConstructs` 在 `design.uic` 只挂了 `GRIDS` 那一档，3641–3644）。
   **死路**：`edgoffset / edgoffsetenu / edgoffsetplane / edgoffsetsurface.pmlfrm` 四张带同一菜单的 1998 年 EDG 表单在 3.1 PMLLIB 里没有任何调用者；`EDGPACKET.defineLine('SHORTEST')`「Line shortest between」
   辅助线构造（963–966）存在，但 `aidconstructs.pmlfrm` 139–151 的 Line 菜单与 `edgtbarlines.pmlfrm` 30–35 工具条都没有它——没人调 `linePacket('shortest')`。
   **输出只有一个数**：`.measure*(LINE)` 全是 `unset → 0，否则 .length()`，没有结果表、没有 Direction / Vertical / Horizontal、不留 witness——它不是 Measure 功能区的测量工具。
2. **两次拾取进 `gmfLine.shortest` 时手里是什么**：`EDGPICKDATA.positionData()`（`edgpickdata.pmlobj` 142–206）对 Graphics 拾取**总是同时给 `position`**：`EDGE` → `line = LINE(lines[1], lines[2])` **且**
   `position = line.intersection(pickLine)`（无限边线上离拾取射线最近的点，失败退 `lines[1]`，175–181）；`FACET` → `plane = facets[1].plane(facets[2], facets[3])`（退 `facets[4]`）**且** `position = plane.intersection(pickLine)`
   （射线 ∩ 无限面，失败退 `facets[1]`，184–200）；`VERTEX` → `position = vertices[1]`（203–204）。
3. **`gmfLine.shortest`**（`gmfline.pmlobj` 800–908）的分支顺序是先看 `position`：`if(posData[1].position.set() and posData[2].position.set()) → start / end = 两个 position`（807–810）。
   两次 `stdGraphics` 拾取按第 2 条都带 `position` → **永远走这一支**；`elseif` 里的点线（813–822，`line.near`）、点面（825–834，`plane.near`）、线线（837–851）、线面（854–880）、面面（883–897）
   从产品入口**不可达**。末尾 `start.distance(end) eq 0 → return object LINE()`（unset，902–903）→ 字段写 0。

**G5 五条：能静态答的**

| 条 | 原题 | 静态答复 | 还要运行时的 |
| --- | --- | --- | --- |
| G5-01 | 点点、点线、点平面 | 产品入口下三种都退化成**点点**：距离 = 两拾中位置之差；拾中位置 = 边线上离射线最近点 / 射线 ∩ 面 / 顶点（无限边线、无限面，不裁到线段 / 三角形内）。`line.near` / `plane.near` 那两支进不去；若经 PML 直接喂无 `position` 的数据，它们是无限线 / 无限面上的垂足（与 G4-04 运行时证过的 `near` 语义同源） | 一次真实 Picking Control 走查，确认字段确实被两拾中点距离填上 |
| G5-02 | 平行 / 相交 / 异面线 | 不可达。代码口径（若可达）：平行（`DIRECTION.isParallel`）→ start = 第一条线上离拾取射线最近点（`line.intersection(pointVector)`，退 `startPosition`），end = `line2.near(start)`；不平行 → `start = line1.intersection(line2)`、`end = line2.intersection(line1)`——相交时两点重合 → 零长 → unset；异面 → 公垂线两端（`LINE.intersection(LINE)` = 本线上离另一条最近的点，与 Intersect 拾取类型同一读法）。全部无限线语义 | `isParallel` 的角度容差（PML 内建，源码看不到） |
| G5-03 | 线面、平行面、相交面 | 不可达。代码口径：线 ∥ 面（`line.direction.isParallel(line.projected(plane).direction)`）→ start = 线上拾中点、end = 投影线上的垂足；不平行 → **零长**（无限线总会穿过面，即便有限棱不到）；平行面 → `start = posData[1].line.intersection(pointVector)`——面拾取的 `line` 未设，这一句必错，`handle any` 退到 `plane1.position`，end = `plane2.near(start)`；不平行面 → 零长 | 无 |
| G5-04 | 非唯一最近点对的 witness | 不可达。代码口径：平行线取**第一条线上拾中处**（不是中点、不是端点）；平行面因上面那个 bug 取**第一个面的 `plane.position`**（`facets[1].plane(...)` 造出来的面，位置 = 第一个顶点，不是拾中点）；平行 / 相交都不出 witness 图形，只写长度 | 无（进不去） |
| G5-05 | 产品 UI 可达入口 | **可达但不是测量工具**：Picking Control（功能区 `Picking Control` 按钮 / Positioning Control 工具条）各偏移字段右键 `Measure Shortest`；固定直径圆辅助的直径字段同款。结果只填一个数 | 截一张 Picking Control 右键菜单 + 填值后的图（有 E3D 时顺手采） |

**运行时仍要采的**（G5 真正剩下的）：(a) Picking Control 走查一次，看两次 Graphics 拾取后偏移字段的值 = 两拾中点距离（这是唯一能观察到的行为）；(b) Graphics 拾取除 `EDGE / FACET / VERTEX` 之外
有没有别的 `primaryObject`（比如圆弧边）——有的话 `positionData` 不给 `position`，`shortest` 一支都进不去，`!start` 未定义会在 902 报错；(c) EDG 完成时有没有把返回的 LINE 画成临时辅助（`EDGCNTRL` 没读）。

**对方案的影响（待拍板，方案 §7 Q7）**：
- 按 E3D **实际行为**对齐：#10 的 Web 对应物 = 距离测量在 Graphics 过滤器下两击（拾中点 = 边线上离射线最近处 / 面上命中点，§12 已是这个口径）——**已经有了**；差的只是 E3D 那层「填进偏移字段」，
  Web 没有 Positioning Control 偏移字段这一层，无处可填。这样 #10 可以按「E3D 口径已覆盖、入口在 Web 无对应物」收口。
- 按 `gmfLine.shortest` 的**设计意图**做真正的线 / 面最短距离 + witness（方案 Phase D 原设想）：那是 Web 增强，E3D 里是进不去的死代码，没有 golden 可对；要做也不能叫「E3D 有的」。
- 方案 §1.4「点 / 线 / 平面 / 圆弧」里的**圆弧**是误写：`shortest` 没有 ARC 分支，`stdGraphics` 也不出 ARC。

## 33. Shortest 按 E3D 实际行为收口：Graphics 边 × 面 / 边 × 边两击的距离 = 两拾中点距离 实机走查（2026-09-15 11:24，决策 `d-616`）

**为什么现在做**：§32 静态核出 E3D 3.1 的「Measure Shortest」两次 Graphics 拾取后永远是两拾中点的距离（`positionData()` 给 EDGE / FACET 都带 `position`，`gmfLine.shortest` 先判它），
用户按方案 §7 Q7 选 (a)：**按 E3D 实际行为收口**——Web 的对应物就是距离测量 × Graphics 过滤器两击，不建线 / 面最短距离内核（决策 `d-616`）。本节给它一条可引的 Web golden：
两击的 Distance = |两拾中点|，且两拾中点正是 E3D `positionData()` 会给的位置（边线上离拾取射线最近点 / 射线 ∩ 面），独立从相机射线与网格算。

**Web 实机走查**（**无任何 mock**：`?model_source=gen-model-v1&gm_backend_port=8024&show_refno=24381_177298`，距离模式，浮条真点「自由表面」+ 只留「模型表面点」「Graphics」，过滤器 Graphics、拾取类型 Cursor，
真指针；LOOP3 那组构件，机位 el −0.45 / az 45（从下往上看）；临时 spec 已删）：

| 组 | 两击 | 结果表（Default 单位，mm） | 记录两端（设计 World，mm） | 独立期望 | 图 |
| --- | --- | --- | --- | --- | --- |
| 边 × 面 | SCTN `24381/177330` 顶面棱（`N 29.54 E`，U 3150.0）× PANE `24381/177335` 底面（法向 `D`，U 3142.0） | `Distance 335mm · Offset X +287mm · Y −171mm · Z −8mm · Direction E 30.809 S 1.37043 D` | 起点 `E −3122.6 N −10690.3 U 3150.0` = 边上拾中点；终点 `E −2835.4 N −10861.6 U 3142.0` = 面上拾中点 | \|终点 − 起点\| = 334.501 mm；起点 = 边线上离拾取射线最近点（Δ 1.0e-7 m）、终点 = 射线 ∩ 面（Δ 2.1e-8 m）——即 E3D `positionData()` 175–200 会给的两个 `position`；Offset = 差向量分量、Direction = 差向量罗盘串 | `web-shortest-graphics-live-01-edge-facet.png` / `web-shortest-graphics-live-01-edge-facet-result-card.png` |
| 边 × 边 | 同一条 SCTN 顶面棱 × PANE `177335` 底面的边（两条边**平行**，竖直相距 8 mm） | `Distance 593mm · Offset X +252mm · Y −537mm · Z −8mm · Direction S 25.1005 E 0.772503 D` | 终点 `E −2870.9 N −11227.6 U 3142.0` = 第二条边上拾中点 | \|两拾中点\| = 593.370 mm；两条**无限直线**的最短距离只有 **8.000 mm**——产品里进不去的 line-line 分支才会给它，E3D 报的就是 593（两拾中点），Web 同 | `web-shortest-graphics-live-02-edge-edge.png` / `web-shortest-graphics-live-02-edge-edge-result-card.png` |

- 结果卡多一行 `起点 → 终点 边 → 面` / `边 → 边`；记录 `approximate: true`（网格派生的 Graphics 点，§12 口径）。
- 与 E3D 的差别只在「输出去哪」：E3D 把 `.length()` 写进 Picking Control 的偏移字段、不出表；Web 出标准距离结果表（Distance / Offset X/Y/Z / Direction）。Web 多出来的三行不是偏离——它们是 E3D Measure Distance 那张表的行，
  Shortest 在 E3D 里本来就没有表可对。
- 拾中点的口径：Web Graphics 边的控制点是**线段**上离射线最近处（§12），E3D `line.intersection(pickLine)` 是**无限边线**上的最近点——光标落在线段范围内时两者相同（本节两击都在段内，Δ 1e-7 m）；光标在 12 px 吸附带内却越过线段端点时会差一段，未实机（记残余）。
- 页面错误 0；全部数值（含每击的拾取射线、E3D 口径位置、line-line 对照值）见 `web-shortest-graphics-live-records.json`。

**收口**（决策 `d-616`）：方案 §2 #10 → ✓（依据 = §32 静态 + 本节 Web 实机 + `d-616`）；Phase D 不建 `shortestDistance.ts`；E3D 那层「填进偏移字段」在 Web 无对应入口，记 N/A；
G5 运行时 golden 仍未采（E3D 不在跑），剩 Picking Control 一次走查 + 截图、`isParallel` 容差、Graphics 拾取有无 `EDGE / FACET / VERTEX` 之外的 `primaryObject`——只是对账补齐，不再卡 #10。
## 34. 最短距离（Web 增强，**不是 parity**）：结果卡 `Distance` 下拉 `Shortest` 两击出 witness 实机走查（2026-09-15 12:30，决策 `d-619`）

**这一节不是 E3D golden，标 `web_enhancement`。** E3D 3.1 产品里的「Measure Shortest」永远是两拾中点距离（§32 静态 + §33 实机，`d-616` 已按那条行为把方案 #10 收口）；
本节走的是 `gmfLine.shortest` 里**产品进不去**的那几支——用户在方案 §7 Q7 拍板 (a) 之后追加「(b) 也做一份 Web 增强」并批准动手（一页方案
`docs/plans/2026-09-15-shortest-web-enhancement-plan.md`，内核 `src/measurement/kernel/shortestDistance.ts` `fb0a24b`，接线 + 结果卡 `a2e4971`）。
E3D 侧没有可对的值，期望值只能自己算，本节用两条互不相干的路：**设计侧 pline 高度**（`element/plines`，不碰网格）与**网格几何**（原始三角形算出的棱方向 / 面法向 + 拾中位置）。

**Web 实机走查**（**无任何 mock**：`?model_source=gen-model-v1&gm_backend_port=8024&show_refno=24381_177298`，距离模式，浮条真点「自由表面」+ 只留「模型表面点」「Graphics」，过滤器 Graphics、
拾取类型 Cursor，结果卡 `Distance` 下拉真选 `Shortest（Web 增强）`，真指针；LOOP3 那组构件，机位 el −0.45 / az 45；四组都落在同一机位；临时 spec 已删）：

| 组 | 两击 | 结果表（Default 单位，mm） | 记录两端（设计 World，mm） | 独立期望 | 图 |
| --- | --- | --- | --- | --- | --- |
| 线 ∥ 线 | SCTN `24381/177330` 顶面棱（U 3150）× 同件下翼缘棱（U 2958），两条都沿 `N 29.54 E` | `Distance 192mm · Offset X 0mm · Y 0mm · Z −192mm · Direction D` | 起点 `E −3122.6 N −10690.3 U 3150.0`（= 第一条线上的拾中处）；终点 同 E / N，`U 2958.0`（= 它在第二条**无限线**上的垂足） | 设计侧 pline `TOS` 3150 − `BRWT` 2958 = **192 mm**（`element/plines`，与网格无关）；网格侧垂足 Δ ≤ 8.9e-16 m | `web-shortest-enhancement-live-01-parallel-lines{,-result-card}.png` |
| 线 × 线 · 异面 | 同一条 SCTN 顶面棱 × PANE `24381/177335` 上的一条边（也水平，但方位 `N 50.65 W`） | `Distance 8mm · Offset X 0mm · Y 0mm · Z −8mm · Direction D` | 起点 `E −2864.6 N −10235.0 U 3150.0`、终点 同 E / N，`U 3142.0`——**公垂线两端**（两条不同高的水平线，公垂线竖直） | 设计侧 SCTN `TOS` 3150 − PANE `POS` U 3142 = **8 mm**；网格侧公垂线两端 Δ ≤ 1.9e-15 m | `web-shortest-enhancement-live-02-skew-lines{,-result-card}.png` |
| 线 ∥ 面 | 同一条 SCTN 顶面棱 × PANE `177335` 底面（法向 `D`，U 3142） | `Distance 8mm · Offset X 0mm · Y 0mm · Z −8mm · Direction D` | 起点 `E −3122.6 N −10690.3 U 3150.0`（线上的拾中处，**不随拾取顺序换到面上**，内核照 E3D 856–874）；终点 同 E / N，`U 3142.0`（无限面上的垂足） | 同上 8 mm；网格侧垂足 Δ ≤ 4.4e-16 m | `web-shortest-enhancement-live-03-line-parallel-plane{,-result-card}.png` |
| 零长拒收 | 同一条 SCTN 顶面棱 × SCTN `24381/177331` 的一个**不平行**面（\|cos∠(棱, 法向)\| = 0.9029） | 无结果表 | **不落记录、不留草稿结果**（`xeokitDistanceMeasurements` 仍 0） | 无限线必穿过无限面 → 0；提示条「两项相交（或重合），最短距离为 0，不落记录（E3D `gmfLine.shortest` 回 unset LINE、字段写 0）；已回到第 1 步」 | `web-shortest-enhancement-live-04-zero-length-refused.png` |

- 结果卡：`Distance` 下拉停在 `Shortest（Web 增强）`；结果表仍是 Distance / Offset X/Y/Z / Direction 那五行（wrt 照旧生效），多一行
  `最短距离 · 线 × 面 · SCTN 边（线） × PANE 面（面） · 平行：起点取第一项上的拾中处`；`Perpendicular to` 这一档灰掉并注明「Shortest 下不适用」。第一击后提示条写「已选第一项 …，再选第二项（点 / 线 / 面）」。
- **与 §33 的对照就是 (a) / (b) 的区别**：同一组构件、同一类两击，E3D 口径（点点）给 593 mm，本节的真最短距离给 8.000 mm——差两个数量级。所以 §33 那条 parity 结论不能拿本节的数去核，反之亦然。
- 独立期望的边界（老实说清）：两击的**拾中位置**用的是 Web 自己的 Graphics 控制点（§12 口径，§33 已独立用相机射线核过它 = 边线上离射线最近点 / 射线 ∩ 面），本节独立算的是**从那两个位置往下的 witness 几何**
  （垂足 / 公垂线）与**设计侧高度**；Web 的操作数方向取自 `hit.segment` / `hit.plane`，期望侧取自原始网格三角形，两边不共用代码。
- **没有实机的**：点 × 点 / 点 × 线 / 点 × 面（要开 P-Point 源，本轮只开了 Graphics）与 面 ∥ 面（本轮机位上没凑出一对可拾的平行面）——这四支目前只有内核单测
  `src/measurement/kernel/shortestDistance.test.ts` 顶着，记残余。
- 页面错误 0；每组的结果表、记录两端、独立期望与误差见 `web-shortest-enhancement-live-records.json`。

## 35. 拾取类型（方案 §2 #17 / G8 的 Web 侧）：Distance / Fraction / Proportion / Mid-Point 沿同一条 PLINE 派生 + Intersect 面 × 面 × 面 出盒角 实机走查（2026-09-16 01:40）

**为什么现在做**：方案 §2 #17 是 P0 里最后一条 ◐，◐ 只因 G8 运行时 golden 未采。七种拾取类型 §12 / §13 起就全接了，但 gen-model-v1 真模型上实机走过的只有
Mid-Point（§14 / §15 / §17 / §18）与 Intersect 的线 × 线（§13 网格边、§16 CYLI 轴、§17 PLINE NA）——**Distance / Fraction / Proportion 一次都没实机过**，Intersect 的
三面求交（`(2,874)` 那一支）只有 `intersectPickSession.test.ts` 顶着。G8 在 E3D 侧的题目是「同一条 PLINE / 边上 Mid-Point / Fraction 3 / Proportion 0.25 / Distance 100mm
的位置字串；Intersect 两边交点」，本节就按同一组取值把 Web 侧走一遍，E3D 侧仍待采。

**E3D 口径**（`edgpicktype.pmlobj` 各类型对拾中项类型的分派、`gmfline.pmlobj` `GMFLINE.snap / distance / proportion / fraction`、`edgposcntrl.pmlobj` `loadPicks`
缺省 Distance 0 / Fraction 2 / Proportion 0.5、Mid-Point ≡ Proportion 0.5；内核 `src/measurement/kernel/pickDerivation.ts` 头注释逐条对应）：

- 线类拾中项（PLINE / TUBING / Graphics 边 / Aid 线）的**控制点** = 拾取射线与项线的交点（异面取项线上离射线最近处）；`GMFLINE` 先把**离控制点近的那一端转成 start**（`reverseSense`）。
- `Distance d`：从近端沿线走 d，**不截到线段内**；`Proportion p`：从近端走 p × 长度，控制点投影落在线段外 → 回近端；`Fraction n`：等分 `int(n)` 段，吸到离控制点最近的分点（同距取段起点，即朝近端），
  段外 → 近端；`Mid-Point` = `Proportion 0.5`。点类拾中项（PPOINT / DPOINT）除 Distance（沿 P-Point 方向偏移）外全部回它自己；面类（Graphics facet / Aid 面）回 射线 ∩ 面。
- `Intersect`：每次子拾取转 LINE / PLANE，线 × 线 / 线 × 面两项即交，**两面要第三项**（`golabel /nextPick`，提示 `Intersection[3]`），三面无唯一交点 `(2,874)`；平行 `(2,870)`。
- 提示条 token（`EDGPICKTYPE.set*`）：`Distance[100]` / `Fraction[3]` / `Proportion[0.25]` / `Mid-Point` / `Intersection[n]`，缀在 `(…)` 里，过滤器不进提示。

**证据等级**：`static_expectation`（上列 PML）+ Web 实机；**G8 运行时 golden 未采**（E3D 不在跑）。

**Web 实机走查**（**无任何 mock**：后端 `:8022` = `gen-model-refactor` `1bd2cab4c` 的构建；前四组 `?model_source=gen-model-v1&gm_backend_port=8022&show_refno=24381_177299`
（R840 房间的框架：长梁 SCTN `24381/177301` + 两根横梁 + 顶上一张 PANE），第五组 `show_refno=24381_102273`（仪表支架 `/Copy-(2)-of-1RCS024CQ`）；浮条真点「自由表面」+
P-Point / 模型表面点 开、Item 原点 关；测量面板「样式设置 → 测量点源」把 `primitive_key_point`（基本体 / PLINE 关键点）的 show / snap 打开（缺省全关，§17 / §18 同一做法——
不开的话 Pline 过滤器下提示条是「未启用任何测量点源捕捉」）；过滤器 Pline（前四组）/ Graphics（第五组）、拾取类型与取值都在设置弹层里真点 radio、真填输入框（`Distance` 填 100、
`Fraction` 填 3、`Proportion` 填 0.25）；真指针；**每一击的光标都落在 p-line 上参数 t 处的投影上**（t 由 `element/plines` 的 PLSTART → PLEND 算，与 Web 拾取层无关）；两击之间可以换机位；
临时 spec 已删）。**独立期望**都不经过拾取层与内核：PLINE 取 `element/plines` 的 `PLSTART → PLEND`（设计侧 mm → 米）按上面 E3D 口径手算；盒角 = `element/attributes` 的
XLEN / YLEN / ZLEN 半长 × `element/ptset` 的 `world_transform`。

| 组 | 提示条 token | 两击（光标落点） | 结果表（Default 单位） | 记录两端（设计 World，mm） | 独立期望 | 图 |
| --- | --- | --- | --- | --- | --- | --- |
| Distance 100 | `(Distance[100])` | SCTN `24381/177301` 的 `PLINE NA`（PLSTART `E 2892.03 N 14670.54 U 23194.21` → PLEND `E 3393.81 N 8935.19`，长 5757.258，方位 `S 5.00002 E`）：光标落在 t = 0.2 处，再落在 t = 0.8 处 | `Distance 5557mm · Offset X +484mm · Y −5536mm · Z 0mm · Direction S 5.00002 E` | 起点 `E 2900.746 N 14570.921 U 23194.21` = **PLSTART 沿线 100 mm**；终点 `E 3385.094 N 9034.809` = **PLEND 沿线倒回 100 mm**（第二击离 PLEND 近，近端换成 PLEND）；两端标签 `PLINE NA · Distance[100]` | 5757.258 − 2 × 100 = **5557.258 mm**；两端 Δ **7.4e-15 m** | `web-pick-types-live-01-distance-100{,-result-card}.png` |
| Fraction 3 | `(Fraction[3])` | 同一条 NA：t = 0.3，再 t = 0.7 | `Distance 1919mm · Offset X +167mm · Y −1912mm · Z 0mm · Direction S 5.00002 E` | 起点 `E 3059.290 N 12758.757` = **PLSTART + L/3**（等分 3 段，离 t = 0.3 最近的分点）；终点 `E 3226.550 N 10846.973` = **PLSTART + 2L/3**（近端是 PLEND，它的 L/3 分点）；标签 `PLINE NA · Fraction[3]` | L/3 = **1919.086 mm**；两端 Δ 7.4e-15 m | `web-pick-types-live-02-fraction-3{,-result-card}.png` |
| Proportion 0.25 | `(Proportion[0.25])` | 同一条 NA：t = 0.2，再 t = 0.8 | `Distance 2879mm · Offset X +251mm · Y −2868mm · Z 0mm · Direction S 5.00002 E` | 起点 `E 3017.475 N 13236.703` = **PLSTART + 0.25 L**；终点 `E 3268.365 N 10369.028` = **PLEND − 0.25 L**；标签 `PLINE NA · Proportion[0.25]` | 0.5 L = **2878.629 mm**；两端 Δ 7.5e-15 m | `web-pick-types-live-03-proportion-0.25{,-result-card}.png` |
| Mid-Point | `(Mid-Point)` | 长梁 NA t = 0.5，再北横梁 SCTN `24381/177302` 的 NA（长 1009.661）t = 0.5（横梁只有从北面 az ≈ 90° 看得到：上面盖着 PANE、东面被长梁挡） | `Distance 2982mm · Offset X −710mm · Y +2896mm · Z 0mm · Direction N 13.7746 W` | 起点 `E 3142.920 N 11802.865` = 长梁 NA 中点；终点 `E 2433.000 N 14698.685` = 横梁 NA 中点；标签 `PLINE NA · Mid-Point` | 两条 NA 中点距 **2981.570 mm**；两端 Δ 7.3e-15 m | `web-pick-types-live-04-midpoint{,-result-card}.png` |
| Intersect 面 × 面 × 面 | `(Intersection[1])` → `[2]` → `[3]` | BOX `24381/102278`（88 × 80 × 74，名下无负体）：起点 = **+X 面 × +Y 面 × +Z 面**三次子拾取，终点 = **−X 面 × +Y 面 × −Z 面**；六个面各用各的机位（正对面法向、朝盒角偏 ~23°、0.45 / 0.48 m 外），光标落在离两条相邻边各 18 mm（离盒角 25 mm）处，悬停标签 `面`、光标处网格三角形法向 = 该轴 | `Distance 115mm · Offset X −72mm · Y +50mm · Z −74mm · Direction W 35 N 40.0608 D` | 起点 `E 10371.572 N 14177.521 U 537.000`，终点 `E 10299.486 N 14227.996 U 463.000`，两端标签 `交点` | 设计盒角 `world_transform · (+44, +40, +37)` / `(−44, +40, −37)` mm：两端 Δ **1.78e-7 / 1.79e-7 m**（float32 网格在 ~10 m 处的量化）；与网格自己的顶点 Δ 1e-14 m；对角 √(88² + 74²) = **114.978 mm** | `web-pick-types-live-05-intersect-three-planes.png` / `-05-intersect-after-subpick-2.png` / `-05-intersect-result-card.png` |

- 提示条逐步：`距离测量 · 第 1/2 步 选择起点 (Distance[100]) Snap : 等待捕捉（基本体 / PLINE 关键点）` → 悬停 `… : SCTN PLINE NA · Distance[100]` → 第一击后 `第 2/2 步 选择终点 (Distance[100]) …`。
  Intersect：`… 选择起点 (Intersection[1]) Snap : 等待捕捉（网格边 / 面（Graphics））` → 第一面 `(Intersection[2]) Snap : BOX 面` + `求交已选 1. BOX 面（面），再选一项（Intersection[2]）` →
  第二面 `(Intersection[3])` + `求交已选 1. BOX 面（面）；2. BOX 面（面），再选一项（Intersection[3]）` → 第三面悬停即 `BOX 交点（预览）`，点下去交点成为起点、进入 `第 2/2 步 (Intersection[1])`；
  终点的三面同样走 `[1] → [2] → [3]`。六次子拾取之间相机换了六次，求交会话一次都没丢——与 E3D 两击之间可以转视角一致。
- 透镜（悬停）位置就已经是派生点：四组八击的悬停 `worldPos` 与独立期望差同样 ~7e-15 m；点下去落的记录与悬停一致。Distance / Proportion 两组的第二击都验到了 `reverseSense`：
  光标离 PLEND 近，派生就从 PLEND 起算。
- 数值口径：p-line 端点来自 API（float64）经场景帧往返，7e-15 m 说明这一程在 10⁴ mm 量级上无损；盒角那 1.8e-7 m 是网格 float32 的量化（三面来自网格三角形，交点正好落回网格顶点）。
  `Direction S 5.00002 E` 不是 5° 整——PLSTART / PLEND 是 mm 级存的（Δ = (501.78, −5735.35)），与 §30 管件路那个 30.0004° 同一性质，E3D 拿同一对 POSS / POSE 也会得同一个方位。
- **坑**：(1) `primitive_key_point` 缺省 show / snap 全关，开关不在浮条设置弹层而在面板「样式设置」里，不开就拾不到任何 PLINE；(2) 仪表支架 5 只 BOX 里 4 只（`102274` / `102279` / `102283` / `102287`）
  名下带 NBOX（`tree/children` 各 3 个），gen-model 网格是 44 个三角形 / 36 条绘制边的**槽形**——中段挖穿、顶 / 底面只剩 5 mm 的沿、−Y 侧中段敞开，顶 / 底面处处离绘制边 < 12 px，
  永远拾成「边」，三面求交凑不齐；换成没有负体的 `102278`（12 条绘制边）才成。这不是拾取层的问题，是构件本来就是槽（负体是设计的一部分）；(3) 面上的拾点不能取面心：
  `102278` 的 −Y 面贴着 `102274`，别的面从盒角往里 18 mm 起铺网格取第一个透镜给「面」且法向对上的点。
- 页面错误 0；全部数值（每击的 t / 机位 / 屏幕坐标 / 悬停标签、p-line 两端、六个面的法向与拾中处、独立期望与误差、逐步提示条）见 `web-pick-types-live-records.json`。**没有改任何产品代码。**

**补采（2026-09-16 08:30 / 08:31）：上面「没走到的分支」里能用真指针到达的三支**——Distance 作用在 P-Point 上、Proportion / Fraction 的控制点落在线段外回近端、Intersect 面 × 面 × **线**
（外加 线 ∥ 第一面 的 `(2,874)` 重置）。环境同上（`:8022` = `gen-model-refactor` `1bd2cab4c`，vite `:3102`）；前两支在 1RCS 的 BRAN `24381/145018`（`show_refno=24381_145018`，
ELBO `145028` P2 → ELBO `145029` P1 之间的竖直立管，DN100 · 外半径 57.15 mm · 轴长 1599.863 mm），第三支仍是 BOX `24381/102278`；浮条自由表面 + P-Point / 模型表面点 开、Item 原点 关；
过滤器 / 拾取类型 / 取值都在设置弹层里真点、真填；**独立期望仍不经拾取层与内核**：P-Point 位置与方向取 `element/ptset`，控制点参数用相机世界位置 + 光标像素自己反投影出射线再算；临时 spec 已删。

| 分支 | 过滤器 · token | 两击（光标落点） | 结果表 | 记录两端（设计 World，mm） | 独立期望 / 误差 | 图 |
| --- | --- | --- | --- | --- | --- | --- |
| Distance 作用在 P-Point | Ppoint · `(Distance[200])` | 立管两端：ELBO `145028` **P2**（方向 `U`），再 ELBO `145029` **P1**（方向 `D`）——光标落在 P-Point 自己的投影上 | `Distance 1200mm · Offset X 0 · Y 0 · Z +1200mm · Direction N 2.71502 W 90 U` | 起点 `U 17092.524` = **P2 沿自己的方向进 200**；终点 `U 18292.387` = **P1 沿自己的方向（朝下）进 200**；标签 `P-Point #2 · Distance[200]` / `P-Point #1 · Distance[200]` | 1599.863 − 2 × 200 = **1199.863**（表 1199.864）；两端 Δ 7.5e-7 / 9.0e-7 m | `web-pick-types-residual-live-01-ppoint-distance{,-result-card}.png` |
| 同上 · 斜方向 | Ppoint · `(Distance[200])` | 两只 ELBO 的另一端：`145028` **P1**（方向 `(−0.00018, −0.99999, −0.00499)`）→ `145029` **P2**（`(0, −0.99999, +0.00499)`） | `Distance 1906mm · Offset Z +1906mm · Direction E 0.00617624 S 89.9981 U` | 两端偏移量 `(−0.036, −199.997, −0.998)` / `(0.000, −199.997, +0.998)`——**严格沿各自 P-Point 方向**，0.005 的竖向分量变成了 ±0.998 mm，不是轴向吸整 | 1905.854（表 1905.856） | `…-01b-ppoint-distance-tilted{,-result-card}.png` |
| Proportion 控制点在线段外 | Element · `(Proportion[0.25])` | 第一击：相机在正东、低于管顶，**仰 60°** 0.9 m 看；光标落在**轴线延长线上 B 之上 69.3 mm**（= 0.7 · r · tan 60°）处的投影——射线打在直管 +E 表面 B 之下 29.7 mm（对象是直管，轴线候选按 `rayHit` 放行），射线与轴线无限直线的最近点却在 **B 之外**（独立反算 s = **1.04331**）。第二击：正东水平 1.6 m 看 A + 0.4 L，光标就在轴线上（s = 0.40000，近端 A） | `Distance 1200mm · Offset Z −1200mm · Direction S 2.71505 E 90 D` | 起点 = **B**（`U 18492.387`，ELBO 145029 P1 本身，不是 B − 0.25 L）；终点 = **A + 0.25 L**（`U 17292.489`）；标签 `轴线（ELBO P-Point #1 → ELBO P-Point #2）` / `… · Proportion[0.25]` | 0.75 L = **1199.897**（表 1199.898）；Δ 9.0e-7 / 4.0e-7 m | `…-02-proportion-outside-extent{,-first-click,-result-card}.png` |
| Fraction 控制点在线段外 | Element · `(Fraction[3])` | 同一对机位 / 光标 | `Distance 1067mm · Offset Z −1067mm · Direction S 2.71505 E 90 D` | 起点 = **B**；终点 = **A + L/3**（`U 17425.811`：近端 A，离 s = 0.4 最近的分点是 1/3） | 2L/3 = **1066.575**（表 1066.576）；Δ 9.0e-7 / 3.1e-7 m | `…-03-fraction-outside-extent{,-first-click,-result-card}.png` |
| Intersect 面 × 面 × 线 | Graphics · `(Intersection[1])` → `[2]` → `[3]` | 起点 = **+X 面 × +Y 面 × X 向棱 (Y+, Z−)**——这条棱**躺在第二面 +Y 里**，与第二面没有交点，与第一面 +X 交于角 (+44, +40, −37)；终点 = **+Z 面 × +X 面 × Z 向棱 (X−, Y+)**——棱 **∥ 第二面 +X**，与第一面 +Z 交于角 (−44, +40, +37)。两个面照 §35 从盒角往里 18 mm 铺点，棱从两邻面法向的角平分线方向 0.45 m 外看、光标落在棱中点 | `Distance 115mm · Offset X −72mm · Y +50mm · Z +74mm · Direction W 35 N 40.0608 U` | 起点 `E 10371.572 N 14177.521 U 463.000`，终点 `E 10299.486 N 14227.996 U 537.000`，两端标签 `交点`；第三项**悬停即 `交点（预览）`**、预览位置 = 角 | 设计盒角 Δ **1.78e-7 / 1.79e-7 m**（同 §35 的 float32 量化）；用网格自己的棱与面独立算 线 ∩ 第一面 = 记录（Δ 4e-15），线 ∩ 第二面 = **平行**（无解）——取的确是第一面；对角 √(88² + 74²) = **114.978** | `…-04-plane-plane-line{,-after-subpick-2,-preview,-result-card}.png` |
| 线 ∥ 第一面 → `(2,874)` | Graphics · `(Intersection[3])` | +X 面 × +Y 面之后点 **Y 向棱 (X−, Z+)**（棱方向 · 第一面法向 = 2e-15） | —（没有测量点落地） | 悬停仍是 `边`（预览算不出交点），点下去 `三个平面没有唯一交点，求交已重置，请重新拾取（E3D 2,874）`（当时的文案；`0c0d9eb` 起改「面 × 面 × 第三项没有唯一交点，…」——第三项是线时「三个平面」说不通，提示矩阵 D5），提示条退回 `(Intersection[1])`、仍在第 1/2 步 | 整个会话清空（E3D `!this.return.clear()`），不是只丢这一击 | `…-04-plane-plane-line-parallel-2874.png` |

- 提示条逐步（面 × 面 × 线）：`… (Intersection[2]) Snap : BOX 面` + `求交已选 1. BOX 面（面），再选一项（Intersection[2]）` → `(Intersection[3])` + `1. BOX 面（面）；2. BOX 面（面）` →
  第三项悬停 `(Intersection[3]) Snap : BOX 交点（预览）` → 点下去 `第 2/2 步 选择终点 (Intersection[1])`。六次子拾取仍是各用各的机位。
- **线段外那一击的标签不带 token**：轴线候选的控制点本来就钳在线段端点 B（`nearestPointOnSegmentToRay` 钳 [0, 1]），派生按 `GMFLINE.proportion / fraction` 又回近端 B，两者重合，
  `applyPickTypeDerivation` 就原样放行（不缀 ` · Proportion[0.25]`、不标 derived）；线段内那一击标签带 token。位置口径与 E3D 一致，只是 Web 的标签少一截。
- **坑（Any 过滤器下拾不到轴线）→ 已修（`737a02c`，用户 08:4x 拍板）**：第一轮按 Any 过滤器跑，36 个机位的透镜清一色 `模型表面点`——「模型表面点」源开着（`mesh_pick_point.snap`）时它 0 px、优先级 40，而轴线候选按 `rayHit`
  只顶在 18 px 孔径边上，光标不在轴线投影 4 px 内就输给表面点。当场换 **Element** 过滤器（E3D `stdElement` 拾到直管就是 TUBING；Web 里 Element 只在 Cursor 类型下放行表面点）一次过。
  E3D 的 Any 也不会给表面点（`stdAny` 落在直管 / 元素上回 TUBING / ELEMENT，光标下那一点只有 Cursor `exact()` 这一档），所以 **`measurementPickFilterAdmits` 改成 Any × surface 只在 Cursor 放行**，与 Element 同口径；
  连带 `attachElementLine` 把 Any × Intersect 也按 Element 的做法把表面点当元素拾取（ELBO 无 `line()` 照样拾中、由求交会话按 E3D「Unable to convert」拒收），尺寸 SnapPort 的表面候选按 Cursor 口径放行不受影响。
  单测 +2 文件（`pickLayerModel.test.ts` 准入矩阵、`useMeasurementPickSources.test.ts` 表面点 vs 轴线的解析）、18 条靠 Any × Snap 落裸表面点的夹具改 Screen 过滤器 / Any × Cursor；测量 + 尺寸 474 用例全过。
  **重跑**（08:5x，Any 过滤器 + 模型表面点捕捉开着，Playwright 在 `:3103` 自起一台关 HMR 的 vite——`:3102` 那台是 `watch: ignored` 起的，不重读改过的 src）：**第 1 个机位就拾到轴线**，
  Proportion / Fraction 线段外回 B、线段内派生与 Element 那一轮逐位相同（`1200mm` / `1067mm`，Δ 9.0e-7 / 4.0e-7 / 3.1e-7 m）；同一光标处 Any × Cursor 仍是 `模型表面点`（E3D `exact()`）。
  图 `…-02b-proportion-outside-extent-any-filter{,-result-card}.png` / `…-03b-fraction-outside-extent-any-filter{,-result-card}.png`，数值在 records.json 的 `lineExtentOverflowAnyFilterAfterFix`。
  **口径变化**：自由表面模式下 Any × Snap（缺省拾取层）不再落裸表面点——要表面点切 Cursor 类型或 Screen 过滤器；浮条那条「自由表面模式下表面点捕捉已关闭」的提示没跟着改（待拍板要不要提示「当前过滤器 × 类型不放行表面点」）。
- **数值口径 → 已修（`2dc5ad1`，用户 09:2x 拍板）**：本轮 P-Point 派生点与 API 手算差 7.5e-7 / 9.0e-7 m，不是 §34 那 3e-15——差在 P-Point **进场景那一步**：`usePtsetSnap.upsertCandidates` 优先用 DTX 登记的放置矩阵
  （`getDtxRefnoTransform`，来自 float32 网格数据）、拿不到才回落 API 的 `world_transform`（float64）；这一档 `:8022` 上拿得到，18 m 处 float32 量化就是 ~1 µm（§34 在 `:8024` 上回落到了 API 矩阵）。
  派生本身（偏移量 199.9993 / 199.9991 mm、与 API 方向夹角 7e-5°）在这个量级之内；盒角那 1.8e-7 m 同 §35。**改法**：`pickPtsetWorldTransform`——接口给了可用矩阵就用接口的，没给（旧后端 `null`）才回落 DTX，
  吸附候选与画出来的关键点十字（`usePtsetVisualizationThree`）同一取法。同一笔把 `formatCompassDirection` 接上 `angleSnap.snapUnitDirection`（归一后 |分量| < 1e-6 归零再归一，§30 `87b8970` 那一档口径），
  `N 2.71502 W 90 U` 这类噪声方位不再出现。单测 `usePtsetSnap.test.ts` +3、`compassDirection.test.ts` +1；measurement + tools + dimension 98 文件 849 用例全过。
  **重跑 P-Point Distance 两组**（09:3x，`:3103` 自起 vite）：派生点 Δ **1.9e-13 / 3.6e-15 / 3.3e-13 / 2.0e-13 m**（此前 7.5e-7～9e-7），距离 1199.862628 / 1905.854320 与独立期望逐位相同；
  纯竖直组 `Direction U`（此前 `N 2.71502 W 90 U`），斜方向组 `E 89.9981 U`（此前 `E 0.00617624 S 89.9981 U`：0.0636 mm 的 E 分量是两枚 P-Point 真实的 x 差、留着；1.8e-7 的 S 噪声吸掉）。
  图 `…-01c-ppoint-distance-after-fix{,-result-card}.png` / `…-01d-ppoint-distance-tilted-after-fix{,-result-card}.png`，数值在 records.json 的 `ppointDistanceAfterFix`。
- 页面错误 0；全部数值（每击的机位 / 屏幕坐标 / 悬停标签 / 独立反算的射线与控制点参数 s、P-Point 的 API 位置与方向、六个面的法向与三条棱的方向、逐步提示条与 2,874 文案）见
  `web-pick-types-residual-live-records.json`。**没有改任何产品代码。**

**已知偏离 / 残余**：
- G8 E3D 运行时 golden 未采（E3D 不在跑）——本节是 G8 题面的 Web 侧，E3D 侧的位置字串仍待对账；#17 的 ✓ 据此只声明「Web 按 E3D 口径落地并实机」。
- 没走到的分支：~~Distance 作用在 P-Point 上（沿 P-Point 方向偏移）、Proportion / Fraction 控制点落在线段外回近端~~、Fraction 恰在两分点正中间的同距取段起点、~~Intersect 面 × 面 × **线**（第三项是线时按 E3D 只与**第一**面求交）~~——~~都~~ 08:30 / 08:31 补采走通三支（见上「补采」）；剩 Fraction 同距那一条真指针的像素量化到不了「恰好相等」，天然只能由 `pickDerivation.test.ts` 顶着。
- **补采撞出的三处 Web 口径偏离（待拍板）**：~~(1) Any 过滤器 + 「模型表面点」捕捉开着时，表面点盖过 TUBING 轴线（E3D Any 拾直管即 TUBING，没有表面点这一档）——要么 Any 下表面点只在 Cursor 类型放行（同 Element 现状），要么让 `rayHit` 候选与表面点同权~~
  **(1) 已修 `737a02c`（08:4x 拍板）：Any 下表面点只在 Cursor 放行，同 Element；Any 重跑见上「坑 → 已修」**；
  ~~(2) P-Point 进场景优先用 float32 的 DTX 放置矩阵而不是 API 的 float64 `world_transform`，18 m 处差 ~1 µm——mm 级显示看不出，但 §34 / §35 那种 1e-15 的对账在这一档做不到~~
  **(2) 已修 `2dc5ad1`（09:2x 拍板）：接口矩阵优先、DTX 回落；重跑 Δ 回到 1e-13**；
  ~~(3) `Direction N 2.71502 W 90 U` / `S 2.71505 E 90 D`：ELBO `145028` P2 的 API 方向是 `(−1e-10, −6.3e-7, 1)`（gen-model 转 360° 的余数），A / B 两枚 P-Point 的 N 坐标也差 0.1 µm，派生 / 轴线继承了 1e-7 量级的横向分量，
  `formatCompassDirection` 的零容差 1e-10 把它当成了方位（同 §30 `87b8970` 修掉的那一类，只是这次噪声在设计数据而不在网格）~~
  **(3) 已修 `2dc5ad1`：罗盘字串归一后 |分量| < 1e-6 吸整（同 §30 口径）；重跑纯竖直组 `U`**。E3D `DIRECTION.string()` 对同一对带噪数据出什么仍未采（E3D 不在跑），Web 这一档按「精确几何会出纯 `U`」取舍。
  三处都已修，本节「已知偏离」只剩 G8 E3D 对账与 Fraction 同距那一条。
- Significant Snaps 开着且 p-line 带分段时派生只在光标所在段上做，§18 已实机（Cut × Mid-Point、Nodes × Snap / Mid-Point），本节 SCTN `177301` / `177302` 没有 FITT / SJOI / SNOD，整条线即作用线。

## 36. Perpendicular to · 零距离告警（G4-04）与点退化（G4-03 / G4-05）实机走查（2026-09-16 17:44）

**为什么补这一节**：方案 §2 #6 的 ◐ 里，「零距离告警」与「点退化」两条只有内核单测（`perpendicularDistance.test.ts` 的 `zero-distance` / `point`）顶着：
零距离从没在真模型上点出来过；点退化只有 §10（2026-09-12，legacy 源 + `:3100`，目标是 Item 原点）那一次，而 §16 起表面点在 Any / Element 下会转成元素线、
拾取层 / P-Point 取数 / 罗盘串又都改过口径。本节在 gen-model-v1 `:8022` 真模型上用真指针把两条走一遍，**没有改任何产品代码**。

**E3D 口径**（`gmfarc.pmlobj` `perpendicularToPoint` + `gphmeasure.pmlfrm` `setPerpendicularMeasure` / `perpendicularSetup`，Administration 1.8 PMLLIB，`static_expectation`）：
- 第二击按 `getLine()` → `getPlane()` → 点 的分支序转目标；`!start.distance(!end) eq 0` 就 `return object ARC()`（线 / 面：`near()` 后再判；点：两点重合也判）。
- 窗体 `setPerpendicularMeasure(!definition)`：ARC 未设 → `!!alert.warning('Cannot draw dimension line. Perpendicular distance is 0')`（**模态告警**）、`!this.dimension = object GPHDIMENSION()`（尺寸重置）、`setupForm()`；
  命令包回到 start（提示回 `Measure perpendicular distance start (Snap) Snap :`）。
- PML REAL 的 `eq` 容差是 `0.000001 × max(两值)`（AVEVA 文档「Precision of Comparisons」）——**与 0 比较时退化成精确等于 0**：设计数据里 1e-7 m 量级的偏差在 E3D 也不算零。
- 点退化：`!arc = radius2Points(!end, !start, !plane)` → `dimension.from` = **第二击的点**（垂足 / end）、`dimension.to` = **第一击的源点**（start）；结果表 `Distance / Vertical = |Δup| / Horizontal / Direction = from.direction(to) wrt World`（G4-03 trace：`from E 9897.433 … to E 9769.75 …`，
  `Direction N 6.66615 W 78.3493 U` = from → to），`distance eq 0` 时 Direction 出 `--`。
- Web 对应：内核 `computePerpendicularDistance` 的 `ZERO_DISTANCE_M = 1e-9 m`（本节实机时；`14b0d4b` 起 1e-6 m，见「已知偏离 (2)」）→ `resolvePerpendicularTargetFromHit` 回 null → `pickPointMessage = 'Perpendicular distance is 0：起点已落在目标线 / 面上，无法绘制垂距尺寸'`（`896fbbc` 起改成带 E3D 原文的那句并发 toast）、`clearCurrentXeokitDraft()`、`clearMeasurementVisualAssists()`、回第 1/2 步；
  点退化走 `resolvePerpendicularTarget` 的 `point` provider，记录 `target` = 拾中点本身，结果表 `buildPerpendicularMeasurementResultRows(origin = 源点, target = 垂足)` 的 Direction = 源点 − 垂足（垂足 → 源点，与 E3D from → to 同向）。

**Web 实机走查**（**无任何 mock**：后端 `:8022` = `gen-model-refactor` `1bd2cab4c`；Playwright 在 `:3103` 自起一台关 HMR 的 vite 供 `main` `86eb2fb`；两个场景
`?model_source=gen-model-v1&gm_backend_port=8022&show_refno=24381_145018`（1RCS BRAN 的竖直立管：ELBO `145028` **P2**（A，`E 7849.85 N 11787.489905 U 16892.523686`，方向 `U`）→ ELBO `145029` **P1**（B，`N 11787.49 U 18492.386314`，方向 `D`），轴长 1599.862628，DN100 外半径 57.15）
与 `show_refno=24381_102273`（仪表支架，BOX `24381/102278` 88 × 80 × 74、绕 Z 转 35°）；浮条真点「自由表面」+ P-Point / 模型表面点 开、Item 原点 关、拾取类型 **Snap**（E3D 缺省）、
结果卡里真点勾 `Perpendicular to`；过滤器在设置弹层里真点 radio；真指针；**独立期望不经拾取层与内核**：P-Point 位置 / 方向取 `element/ptset`，面法向取原始网格三角形；临时 spec 已删）：

| 组 | 过滤器 · 两击 | 独立期望 | Web 结果 | 图 |
| --- | --- | --- | --- | --- |
| 零距离 · 线（P-Point 自己的轴线） | Ppoint：A，再点 **同一枚 A**（`getLine()` = 过 A 沿 `U` 的轴线，源点就在线上） | 0 | **零距离**：草稿清空、不落记录、结果卡空、提示条回 `垂距测量 · 第 1/2 步 选择起点 (Snap) Snap : ELBO P-Point #2`；`pickPointMessage` 在 `clearCurrentXeokitDraft()` 被调用那一刻是 `Perpendicular distance is 0：起点已落在目标线 / 面上，无法绘制垂距尺寸`，**点完再读已是 null**，页面 DOM 里 0 处出现这句话（→ 已知偏离 (1)，`896fbbc` 修后重跑见下） | `web-perp-zero-point-fallback-live-01-ppoint-self-axis-zero.png` |
| 零距离 · 线（TUBING 轴线） | Ppoint：A；换 **Element**，光标落在立管中段轴线投影上，透镜 `轴线（ELBO P-Point #1 → ELBO P-Point #2） · Snap`（Snap 控制点吸到近端 B，到 A→B 直线 3.6e-15 m） | A 到 line(A, B) = 0（轴线两端就是 A / B） | **零距离**，同上；提示条回 `第 1/2 步 … : TUBI 轴线（ELBO P-Point #1 → ELBO P-Point #2） · Snap` | `…-02-ppoint-tubing-axis-zero.png` |
| 近零 · 线（另一枚 P-Point 的轴线） | Ppoint：A，再点 **B**（`getLine()` = 过 B 沿 `D` 的竖直线） | A 到 line(B, `D`) = **9.5029e-8 m**（A / B 的 N 坐标差 9.5e-5 mm，设计数据本身的量化）；垂足 `(7849.85, 11787.49, 16892.523686)` | **不是零距离**（> 1e-9 m，当时的阈值）：`Distance 0mm · Vertical 0mm · Horizontal 0mm · Direction S 0.0103685 W`，信息条 `点→无限线 · P-Point #1 轴线`，记录 `P-Point #2 → P-Point #1 轴线垂足`，不标近似；垂足 Δ 1.8e-15 m、距离 9.502921e-8 m 与独立值 Δ 1.6e-19（→ 已知偏离 (2)，`14b0d4b` 阈值提到 1e-6 m 后重跑改成零距离告警，见下） | `…-03-ppoint-near-zero-result{,-result-card}.png` |
| 点退化 | Ppoint：A；换 **Screen**，光标落在立管 t = 0.356 处的东侧表面，透镜 `模型表面点`（无轴向 / 面几何 → E3D 第三分支） | 记录终点 = 拾中的表面点本身（不投影）；Horizontal = 表面点到轴线的径向距离 = 管外半径 **57.15**；Vertical = 0.3556 L = 568.978；Direction = 垂足（第二击）→ 源点（第一击） | `Distance 572mm 近似 · Vertical 569mm · Horizontal 57mm · Direction W 84.2643 D`；信息条 `点→点（目标无轴向/面几何） · 模型表面点`；记录 `origin` = A（Δ 8.9e-16）、`target` = 表面点 `(7907.00007, 11787.489952, 17461.501235)`（Δ 0）、`targetKind = point`、`approximate = true`；Horizontal **57.15007**（网格 float32 Δ 7e-5 mm）、Vertical 568.978、Distance 571.841；Direction 若按源点 → 垂足会是 `E 84.2643 U`——**Web 出的是垂足 → 源点，与 E3D from → to 同向** | `…-04-point-fallback-result{,-result-card}.png` |
| 零距离 · 面（BOX 顶面 +Z，精确共面） | Graphics：起点 = +Z 面上离面心 (−26, −22) mm 处（三角形 #3），再点 **同一张面**：同一三角形 (−26, 0) / 另一三角形 #10 (−13, 22) | 起点到第二击三角形所在平面 (S − P)·n = 0 / 0 | 两次都**零距离**，同第一行 | `…-05-box-top-face-{same,other}-triangle-zero.png` |
| 零距离 · 面（BOX 侧面 +X，绕 Z 转 35°） | Graphics：起点 = +X 面 (−22, −19)（三角形 #6），再点 同一三角形 (−22, 0) / 另一三角形 #11 (−11, 19) | (S − P)·n = **−2.7e-17 / −1.9e-15 m**（DTX 顶点在构件局部帧、量级 ±44 mm，float32 量化只有 1e-9 m 量级、两张三角形仍精确共面） | 两次都**零距离** | `…-06-box-side-face-{same,other}-triangle-zero.png` |

- 提示条逐步：`垂距测量 · 第 1/2 步 选择起点 (Snap) Snap : 等待捕捉（P-Point / 设计点（DPOINT））` → 第一击 `垂距测量 · 第 2/2 步 选择目标线 / 面上的点 (Snap) Snap : ELBO P-Point #2；点空白取消当前点选` →
  零距离那一击后 `垂距测量 · 第 1/2 步 选择起点 (Snap) Snap : <光标下目标>`（E3D `setupForm()` 后回 `Measure perpendicular distance start (Snap) Snap :`）；出结果那一击后同样回第 1/2 步（窗体常驻）。
- 零距离那一击之后 `currentXeokitDistanceDraft = null`、`measurementDraftResult = null`、`xeokitDistanceMeasurements` 长度不变、结果卡回「完成一次测量后在此显示…」——与 E3D「尺寸重置 + 回 start」同一口径；六次零距离（两场景）逐次如此。
- 点退化的记录端点顺序：Web `record.origin` = 第一击（源点 A）、`record.target` = 第二击（表面点），结果卡「起点 → 终点」按拾取顺序写 `P-Point #2 → 模型表面点`；E3D `dimension.from` = 第二击（垂足）、`to` = 第一击（源点）——**两边 Direction 同向**（都是垂足 → 源点），只是「哪个叫 from」的叫法不同。
- 页面错误 0；全部数值（机位、每击的屏幕坐标 / 透镜标签 / 设计坐标、独立期望、`clearCurrentXeokitDraft` 时刻抄下的 message、逐步提示条、面上每个探点所在的三角形序号）见 `web-perp-zero-point-fallback-live-records.json`（立管）与 `…-box-records.json`（BOX）。

**证据等级**：Web 侧是上面的实机走查；E3D 侧是 G4-03 运行时 trace（点退化的四行值与 from / to）+ G4-04 fixture（`perpendicularToPoint` 对源点在线 / 面上返回未设 ARC，窗体那句告警读代码未触发）+ 上列 PML 静态口径。

**已知偏离 / 待拍板**：
- ~~**(1) 零距离告警在 Web 上没有任何可见出口**~~。`useXeokitMeasurementTools` 3767 写完 `pickPointMessage` 后，同一个处理函数里紧接着的 `clearMeasurementVisualAssists()` → `clearHoverPtset()`（905 行）又把它置回 null——从外面读到的永远是 null（本节用包一层 `store.clearCurrentXeokitDraft` 的探针才抄到那句话）；
  而且 `pickPointMessage` 在 UI 上本来就没有消费者（`rg` 只有单测在读）：指针透镜的 subtitle 只在**未吸附**时取它，而透镜未吸附时 `visible = false`，不画。用户看到的只有「草稿没了、提示条回第 1 步、结果卡空」。E3D 是模态 `alert.warning`。
  §13 / §35 记的 2,870 / 2,874、「Unable to convert…」、「求交已选…」同走这条通道，同样不可见（当时是从 `pickPointMessage` 读的）。
  **(1) 已修 `896fbbc`（用户 2026-09-16 18:0x 拍板）**：零距离分支先收草稿 / 辅助态、再 `raiseMeasurementAlert(PERPENDICULAR_ZERO_DISTANCE_MESSAGE, 'warning')`——写 `pickPointMessage` 的同时 `emitToast`（ribbon `toastBus` → `v-snackbar`，warning 4500 ms）；
  文案改成 `Perpendicular distance is 0：起点已落在目标线 / 面上，画不出垂距尺寸（E3D：Cannot draw dimension line. Perpendicular distance is 0）；已回到第 1 步`。ViewerPanel 右下角提示条的第二行在 xeokit 测量模式下改放 `pickPointMessage`
  （此前这一行只给 legacy 工具的 hoverText、xeokit 下恒空）——零距离告警之外，2,870 / 2,874、「Unable to convert…」、「已选第一项 / 求交已选…」、「P-Point 正在加载」、未命中原因等此前从未显示过的消息都从这里出；加 `max-w` 让长文案在窄画布里换行、不压左侧工具列。
  单测 `useXeokitMeasurementTools.test.ts` +1（第二击落在起点自己身上：草稿 / 临时结果清空、不落记录、`statusText` 回第 1/2 步、`pickPointMessage` 保留告警、`onToast` 收到 `{ level: 'warning' }` 一条；随后一次悬停命中把提示条那一行清掉）；98 文件 872 用例全过。
  **重跑（18:10，`:3103` 自起 vite）零距离两组**——P-Point → 自己的轴线 / TUBING 轴线、BOX +Z / +X 同一 / 另一三角形，六次点完 `pickPointMessage` 都还在、提示条第二行画出、`bg-warning` snackbar 弹出（同一句话 DOM 里 2 处），
  5.2 s 后 snackbar 自收、提示条那一行不动光标就在、再悬停命中即清（`pickSurfacePoint` 命中置 null——这正是要另发 toast 的原因）。图 `…-07-ppoint-self-axis-zero-after-fix.png` / `…-08-ppoint-tubing-axis-zero-after-fix.png` /
  `…-09-box-top-face-{same,other}-triangle-zero-after-fix.png` / `…-10-box-side-face-{same,other}-triangle-zero-after-fix.png`，数值在 `…-after-fix-line-records.json` / `…-after-fix-plane-records.json`。
- ~~**(2) 近零阈值**~~：Web `1e-9 m` 对设计数据里 1e-7 m 量级的偏差不生效，A → B 轴线出 `0mm / 0mm / 0mm / S 0.0103685 W`（一个全零的表带着由 1e-7 m 噪声定出来的方位）。E3D 的 `eq 0` 是精确零，同一对数据也不会告警、会拿两个相距 9.5e-5 mm 的点去 `radius2Points`——它最终显示什么**未采**（E3D 不在跑）。
  ~~Web 这一档要么照现状（忠于「不是零就算」），要么把阈值提到 1e-6 m（与 `angleSnap` 的分量吸整同一量级）或在距离小于显示精度时 Direction 出 `--`——待拍板。~~
  **(2) 已修 `14b0d4b`（用户 2026-09-16 18:2x 拍板）**：`computePerpendicularDistance` 的零距离阈值 1e-9 → **1e-6 m**（导出 `PERPENDICULAR_ZERO_DISTANCE_M`；与 `angleSnap` 同量级、远低于 E3D 0.01 mm 的显示精度；E3D `eq 0` 精确零是已知差别，Web 取舍）。
  单测 `perpendicularDistance.test.ts` +1（实机那 9.5029e-8 m → `zero-distance`、0.99e-6 拒 / 1.01e-6 出结果、0.1 mm 真垂距不受影响）。**重跑（18:29）**：A → B 轴线改成零距离告警（提示条第二行 + `bg-warning` snackbar，图 `…-11-ppoint-near-zero-after-threshold.png`）；
  对照 **B → A 轴线**：dirA 带 6.3e-7 的倾斜 × 1.6 m = **1.1003e-6 m**，恰在阈值之上，仍出 `0mm / 0mm / 0mm / N 0.0102931 E`（垂足 Δ 1.5e-12，图 `…-12-ppoint-b-to-axis-a-result{,-result-card}.png`）——任何固定阈值都有这一侧，1 µm 是拍板的位置；数值在 `…-after-threshold-records.json`。
- **告警覆盖面（同一轮拍板，`14b0d4b`）**：2,870 / 2,874（warning）、「Unable to convert…」、两线夹角 / 三点角「An angular dimension could not be constructed…」（error）也改走 `raiseMeasurementAlert`——提示条第二行 + toast 同一句；「求交已选…」/「已选第一条线」是状态回显、Web 独有的两线夹角拒收提示不发 toast。
  单测 `useXeokitMeasurementTools.test.ts` 四条补 toast 断言 + 新增两线夹角平行棱一条（`captureToasts` 须在 `vi.resetModules()` 后与被测模块同一轮 import）；98 文件 874 用例全过。
- (3) 结果卡「起点 → 终点」按拾取顺序、E3D from / to 按垂足 → 源点：只是叫法，Direction 已同向，不改。
- G7-02（EDGE / PLANE / TUBING 实际捕捉几何）的 E3D 运行时 golden 仍未采（要 E3D 在跑）；#6 的 ◐ 只剩这一条。

## 37. TUBING 非直管：斜管（45° / 66° / 13° / 50°）轴线派生 实机走查 + 弯管（ELBO / BEND）作为拾取对象的现状（2026-09-16 18:5x）

**为什么补这一节**：方案 §2 #15 的 TUBING 轴线（§14 / §15）实机只走过竖直立管与一根水平面内 45° 的斜管（`o:24381_145018:1`，竖向分量 0.003），
带竖向坡度的斜管一根没验过——`tubingAxisFromBounds` 靠「局部单位圆柱 × 放置矩阵」派生，矩阵带任意旋转在理论上就该成立，但端点校正、Mid-Point、垂足都没在真斜管上对过数。
另一半「弯管」：E3D 隐含管（TUBING）永远是直的，弯的是构件——`EDGELBOW` / `EDGBEND` 两个 EDG 类型**只有 `arc()`**（`edgelbow.pmlobj` 55 / `edgbend.pmlobj` 59：
`gmfArc.fillet(radius, pPosition[arrive], position, pPosition[leave])`，中心线圆弧），没有 `line()`。本节把两件都在 `:8022` 真模型上走一遍，**没有改任何产品代码**。

**E3D 口径**（`static_expectation`）：
- 斜管 = 隐含管，`EDGTUBING.line(dbRef, 'LEAVE')`：构件 `lPosition` → 下一个非 ATTA 成员的 `aPosition`，与倾角无关（§14）。
- 弯头 / 弯管作为拾取对象：`stdElement` / `stdAny` 落在 ELBO / BEND 上是 ELEMENT 拾取。Snap → `handle any → item.position`（元素原点 = 两条切线的交点，方案 §2 #12）；
  Perpendicular / Intersect 走 `EDGPOSITIONDATA.getLine()`（`edgTypes.attribute('ELBO').line` 不存在 → `handle any` → 未设）→ `getPlane()`（`edgpositiondata.pmlobj` 537：`getArc()` → `GMFARC(arc)` 的**弧所在平面**）；
  Intersect 还能拿 ARC 当操作数（`edgpicktype.pmlobj` 887 `No intersection between picked items`）。即 E3D 里「弯管的轴线」= 中心线圆弧，只服务 Perpendicular（弧面）与 Intersect（弧），Snap 不沿弧取点。
- 弧的独立算法（本节用来算 E3D 会给的数）：两条切线端点 P1（arrive）/ P2（leave）与角点 C（`POS`），内角 α = ∠(P1 − C, P2 − C)，切线长 T = |P1 − C|，**R = T · tan(α / 2)**，圆心 = C + 角平分线 · R / sin(α / 2)，
  弧面法向 = (P1 − C) × (P2 − C)。ELBO `RADI` 属性是 0（半径在元件库里），这样算出来 R = **533.000 mm**（DN350 长半径弯头 1.5 D = 533.4）、偏转角 49.8663° = `ANGL`；BEND 146110 算出 R = **133.000** = `RADI 133`、80.1463° = `ANGL`——算法与属性互证。

**Web 实机走查**（**无任何 mock**：后端 `:8022` = `gen-model-refactor` `1bd2cab4c`；Playwright 在 `:3103` 自起一台关 HMR 的 vite 供 `main` `b4209bd`；两个场景
`?model_source=gen-model-v1&gm_backend_port=8022&show_refno=24381_145117`（`/Copy-of-1RCS0040-1R80001`，DN350：OLET → ATTA → ELBO → ATTA → ELBO → …）与 `show_refno=24381_146105`
（`/Copy-of-1RCS0644-1R43015-八室建议`，DN20，RADI 133 的 BEND 串：WELD → BEND → ATTA × 2 → BEND → BEND → BEND → …）；浮条自由表面 + P-Point / 模型表面点 开、Item 原点 关；
过滤器 **Element**、类型 Snap / Mid-Point 在设置弹层里真点；真指针，光标落在轴线上参数 t 处的投影（靠两端 t = 0.18 / 0.82，Mid-Point t = 0.3 / 0.7），两击之间换机位；
**独立期望不经拾取层与内核**：管两端 = `element/ptset` 里 leave / 下一个非 ATTA 构件 arrive 的 P-Point（`element/attributes` 的 `ARRI` / `LEAV` 定哪一枚），中点 / 垂足 / 弧都由它们手算；临时 spec 已删）：

| 管 | 两端（API，设计 World mm） | 长 / 倾角 | Snap 两端两击 | Web 记录两端 Δ | 结果表 | 图 |
| --- | --- | --- | --- | --- | --- | --- |
| DN350 · OLET 145119 → ELBO 145121 | OLET P2 `(7083.92, −2552.7, 3589.84)` → ELBO P1 `(7534.509, −1586.814, 2525.121)`，中间 ATTA 145120 | **1506.517 · 44.97°**（方向 `(0.2991, 0.6411, −0.7067)`） | 透镜 `轴线（ELBO P-Point #1 → OLET P-Point #1） · Snap`（OLET 的 P1 / P2 同一位置，校正取到先匹配的 P1） | **3.6e-15 / 5.5e-15 m** | `Distance 1507mm · Offset X +451 · Y +966 · Z −1065 · Direction N 25.0092 E 44.9705 D` | `web-tubing-inclined-bend-live-01-elbo-scene-tube45-ends{,-result-card}.png` |
| DN350 · ELBO 145121 → ELBO 145123 | ELBO P2 `(7516.602, −1385.075, 2123.964)` → ELBO P1 `(7069.635, −1176.816, 1026.003)`，中间 ATTA 145122 | **1203.608 · 65.82°** | `轴线（ELBO P-Point #1 → ELBO P-Point #2） · Snap` | **4.4e-15 / 3.8e-15 m** | `1204mm · −447 / +208 / −1098 · W 24.9826 N 65.8147 D` | `…-02-elbo-scene-tube66-ends{,-result-card}.png` |
| DN20 · BEND 146107 → BEND 146110 | BEND P2 `(5298.52, 10727.68, 25634.479)` → BEND P1 `(8890.866, 10727.68, 24806.81)`，中间 ATTA 146108 / 146109 | **3686.460 · 12.97°**（XZ 面内） | `轴线（BEND P-Point #1 → BEND P-Point #2） · Snap`（两端吸到**两只 BEND** 的 P-Point） | **1.0e-14 / 1.0e-14 m** | `3686mm · +3592 / 0 / −828 · E 12.9744 D` | `…-06-bend-scene-tube13-ends{,-result-card}.png` |
| DN20 · BEND 146110 → BEND 146111 | BEND P2 `(8999.903, 10800.119, 24696.414)` → BEND P1 `(8999.92, 11096.045, 24348.051)` | **457.087 · 49.65°**（YZ 面内） | 同上 | **1.1e-14 / 7.1e-15 m** | `457mm · 0 / +296 / −348 · N 0.00330066 E 49.6529 D`（两端 x 差 0.017 mm 是设计数据，0.0033° 是真的） | `…-07-bend-scene-tube50-ends{,-result-card}.png` |

- **Mid-Point**（两根斜管各取中点）：DN350 两管 `1679mm · −16 / +789 / −1482 · N 1.16897 W 61.9784 D`，两中点 Δ **4.6e-15 / 4.5e-15 m**，与 API 中点距 1679.369 逐位相同（`…-03-elbo-scene-midpoints{,-result-card}.png`）；
  DN20 两管 `2041mm · +1905 / +220 / −698 · E 6.59883 N 20.0091 D`，Δ **1.0e-14 / 5.3e-15**，2041.130（`…-08-bend-scene-midpoints{,-result-card}.png`）。跨 ATTA 的 3686 管取的是**整条**的中点（§15 口径）。
- **Perpendicular 到斜轴线**：源点 ATTA 145120 **P3** `(7400.402, −1874.288, 2641.29)`（Ppoint 过滤器），第二击 Element 落在 45° 管身 → 垂足 `(7442.830, −1783.337, 2741.753)` = ATTA 的 P2（在轴线上 t = 0.7965）Δ **2.7e-15 m**，
  `Distance 142mm · Vertical 100mm · Horizontal 100mm · Direction S 25.0087 W 45.0295 D`，142.0042 与独立值逐位相同；信息条 `点→无限线 · 轴线（ELBO P-Point #1 → OLET P-Point #1）`（`…-04-elbo-scene-perpendicular{,-result-card}.png`）。
- 斜管这一半的结论：**倾角对派生无影响**——四根管两端全部落在邻接构件（OLET / ELBO / BEND）的 P-Point 上、误差 1e-14 m（float64 往返），中点 / 垂足同级；`refineTubingAxisEnds` 对 BEND 端点与对 ELBO 端点一视同仁。

**弯管（ELBO 145121 · R 533 / BEND 146110 · R 133，3D 弯：arrive 在 XZ 面、leave 在 YZ 面，弧面法向 `(−0.1475, −0.7538, −0.6403)`）作为拾取对象**，光标落在弧中点的投影上：

| 拾取层 | ELBO 145121 | BEND 146110 | E3D |
| --- | --- | --- | --- |
| Element × Snap | 不吸附，提示条第二行 `当前未捕捉到已启用点源：管身轴线（TUBING）` | 同 | ELEMENT 拾取 → `item.position`（角点；Web 对应 Item 原点源，本轮关着） |
| Element × Cursor | `ELBO 模型表面点` | `BEND 模型表面点` | 同上（Cursor 对元素也是 `exact()` = 光标下那一点） |
| Any × Snap / Cursor | 先 `正在读取该构件的 P-Point…`，落地后 Snap 仍无候选（弯头体上没有 P-Point / 轴线）；Cursor = 表面点 | 同 | 同上 |
| **Perpendicular 第二击落在弯管体**（源点 ATTA 145120 P3 / ATTA 146109 P3）——**修前**（`67b662a` 之前） | Element × Snap：**拾不到、草稿保留**；Element × Cursor：**点退化**到表面点 `456mm / 226 / 397 / W 39.9659 S 29.6401 U`（信息条 `点→点（目标无轴向/面几何）`，标近似） | Element × Snap：拾不到；Element × Cursor：点退化 `1271mm / 309 / 1233 / W 0.165464 S 14.0898 U` | `getLine()` 未设 → `getPlane()` = **弧面** → 源点到弧面 **76.098 mm**（ELBO）/ **7.033 mm**（BEND） |
| 同上——**修后**（`c4f20bd`，2026-09-16 19:56 重跑，→ 已知偏离 (1)） | Element × Snap **与** × Cursor 都出 **`76mm / 29 / 70 / S 40.8313 E 22.2785 D`**，信息条 `点→无限面 · ELBO 中心线弧面（P1 → P2）`，终点名 `ELBO 中心线弧面（P1 → P2）垂足`，垂足 `(7354.3604, −1821.0073, 2670.1391)` 与独立值 Δ **2.7e-15 m**，垂距 76.0983 逐位；Snap 下悬停标签 `中心线弧面（P1 → P2）`、状态条 `Snap : ELBO 中心线弧面（P1 → P2）`，Cursor 下仍是 `模型表面点` 但弧随表面点带上；不标近似 | 同：**`7mm / 5 / 5 / N 11.0734 E 39.8165 U`**，垂足 `(7732.0402, 10722.3783, 25080.0337)` Δ **4.0e-15 m**，7.0333 逐位 | 同上（Web 现在与 E3D 同口径） |

- 页面错误 0；全部数值（成员表与每枚 P-Point、四根管的 API 两端 / 方向 / 倾角、每击悬停标签与设计坐标、独立弧参数、弯管体四种拾取层的悬停状态与两次 Perpendicular 的结果）见
  `web-tubing-inclined-bend-live-elbo-scene-records.json` / `…-bend-scene-records.json`。**本节首采没有改任何产品代码**；修后重跑的数值与产物见下面「已知偏离 (1)」。

**证据等级**：Web 侧实机；E3D 侧 `static_expectation`（`edgtubing` / `edgelbow` / `edgbend` / `edgpositiondata` 上列行号）；G7-02 TUBING 运行时 golden 仍未采。

**已知偏离 / 待拍板**：

> **2026-09-17 更正（§39，跑着的 E3D 实测）→ 两条都已对齐 E3D（`dcac130`）**：下面 (1) 的前提——「ELBO / BEND 作为 Perpendicular 目标，E3D 给的是中心线弧所在的面」——**不成立**。
> `GMFARC.perpendicularToPoint` 只问 `getLine()` → `getPlane()`，而 `EDGELBOW` / `EDGCTORUS` 两张对象根本没有 `.line()` / `.plane()`，E3D 实际给的是**到拾中位置的点到点**（§39.3 逐位）。
> (1) 引的 `edgpositiondata.pmlobj` 537 是**弧 PLINE** 分支，不是 ELEMENT 分支。
> (1-b) 的 ARC 操作数这条路站得住（Intersect 确实走 `arc()`），但**圆不一样**：E3D 的弯头弧半径取目录 `parameter[2]`，那一格是外径不是弯曲半径（§39.4）。
>
> **用户 2026-09-17 拍板「两条都对齐 E3D」**，`dcac130` 已实现：① 弯管 / 环面的 Perpendicular 回退成点到点（弧只留给 Intersect）；
> ② ARC 操作数改用目录 `parameter[2]` 的圆（复刻 AVEVA 那个下标，几何上「更对」的 `parameter[3]` = 533 不用），取不到半径就没有弧。
> 下面 (1) / (1-b) 里凡是写「弧面」「R 533」的段落都以这一条为准；真 UI 复核见 §39.6。

- **(1) 弯管的「轴线」在 Web 里不存在** → **已修（`c4f20bd`，2026-09-16 19:04 拍板 / 19:56 重跑）**；**前提已被 §39.3 推翻，见上面那段更正**。修前：ELBO / BEND 作为 Perpendicular 目标，E3D 给的是中心线弧所在的**面**（`getArc()` → `GMFARC.plane`），Intersect 给 ARC 操作数；Web 的 ELBO / BEND 没有 `arc()`——Element × Snap 什么都拾不到、Element × Cursor 退化成表面点，
  两次实机分别差了 456 vs 76 mm、1271 vs 7 mm。改法：新 kernel `src/measurement/kernel/elementArc.ts`（`elementArcFromPPoints(noun, points, corner)`：noun 表 ELBO / ELBOW / BEND；两腿 `POS` → P1 / P2，内角 α，
  R = T · tan(α / 2)（T 取两腿切点长度平均），弧心 = `POS` + (u1 + u2) · T / (1 + cos α)，法向 = u1 × u2，偏转角 = π − α；不依赖 `RADI`；缺点 / 角点、切点落在角点、两腿 |sin| ≤ 1e-6 共线都回 null）；
  角点 `POS` = 点集响应 `world_transform` 的平移列（`ptsetElementOriginToScene` → `usePtsetSnap.getOrigin`，与 P-Point 同一条 float64 换算链；旧后端 `null` 矩阵 → 无原点、无弧）；
  `useXeokitMeasurementTools` 给候选 / 命中挂 `elementArc`（`attachElementGeometry`，无 `line()` 才挂弧）、无候选时的元素拾取 `elementPickAsOperand` 在 **Perpendicular 正等第二点**时给弧（Intersect 的 ARC 操作数 Web 仍没有，照旧「Unable to convert」拒收），
  `resolvePerpendicularTargetFromHit` 把它喂给 `resolvePerpendicularTarget` 的 `arc` → `circle-plane`（过弧心、法向 = 弧面法向），目标名 `ELBO 中心线弧面（P1 → P2）`、垂足按精确几何（不因拾中它的表面点标近似）。
  单测：`elementArc.test.ts` 7 条（含本节两枚实机件 → R 533.000 / 133.000、ANGL 逐位、源点到弧面 76.0983 / 7.0333）、`usePtsetSnap.test.ts` +1、`useXeokitMeasurementTools.test.ts` +1（Element × Cursor / Any × Snap / Intersect 仍拒）。
  **实机重跑**（`:8022`，`:3103` 自起 vite，真 UI 勾 Perpendicular to、Ppoint × Snap 拾 ATTA P3 → Element × Snap / × Cursor 落弯管体，光标在弧中点投影）：上表「修后」一行——ELBO `76mm / 29 / 70 / S 40.8313 E 22.2785 D`、BEND `7mm / 5 / 5 / N 11.0734 E 39.8165 U`，四次垂足 Δ ≤ 4.0e-15 m；页面错误 0。
  产物：`web-tubing-inclined-bend-live-10-elbo-scene-perpendicular-to-elbo-body-{snap,exact}-after-fix{,-result-card}.png`、`…-11-bend-scene-perpendicular-to-bend-body-{snap,exact}-after-fix{,-result-card}.png`、`…-after-fix-records.json`（独立弧参数 / 每击悬停 / 结果表 / 记录）。
  仍开着的：透镜副标题对带弧的表面点仍写「（近似）」（与 CYLI 元素线同款，垂足本身是精确的）。
- **(1-b) Intersect 的 ARC 操作数**（上一条的余项）→ **已做（`9bbb501`，2026-09-16 23:23 实机）**。E3D 口径：ELEMENT 拾取先 `line()`、未设再 `arc()`（`edgpicktype.pmlobj` 631–681）；两项里有弧时**弧永远是被求交的主体**（864–904「Make sure arc is always first」），
  `ARC.intersections(item)` → `anglePosition` 给圆上 0 / 1 / 2 个点，取离**拾中这条弧的那次射线落在弧面上的点**（`!pick.intersection(!arcPlane)`，895）最近的一个；一个都没有 → `!!alert.warning('No intersection between picked items')`（887），只丢这一击、第一项还在。
  改法：内核 `pickDerivation.ts` 新 `IntersectArcOperand` + `intersectArcWith` / `arcLineIntersections` / `arcPlaneIntersections` / `arcArcIntersections`（`ARC.intersections` 按**整个圆**算，`GMFARC.exact` 才按 `onProjected` 裁；线先投到弧面，垂直于弧面的线投成一点、落在圆上才算交），
  新失败原因 `no-arc-intersection`；会话 `intersectPickSession.ts` 的每档拒收带上 `level`（E3D 的 `alert.warning` / `alert.error`），「与弧无交点」= warning 且不消耗，**面 × 面之后的第三项是弧** → `ARC.intersection(PLANE, PLANE)` 不存在，按「转不成线 / 面」error 拒收且不消耗（不是 2,874 整包清空）；
  `useXeokitMeasurementTools` 把 `elementArc` 换成设计 World 的 ARC 操作数（`picked` = 这一击的拾取射线 ∩ 弧面，射线缺席 / 平行时退回表面点）、`elementPickAsOperand` 在 Intersect 下也给弧，操作数名分两个——Intersect 是弧本身 `ELBO 中心线弧（P1 → P2）`、Perpendicular 是它所在的面 `ELBO 中心线弧面（P1 → P2）`。
  单测：`pickDerivation.test.ts` +6、`intersectPickSession.test.ts` +4、`useXeokitMeasurementTools.test.ts` +1（原「Intersect 仍拒 ELBO」两处改口径：有放置矩阵的那枚现在成弧，没有矩阵的那枚仍「Unable to convert」）；100 文件 903 用例全过。
  **实机「弧 × 线」**（`:8022` 真模型 `/Copy-of-1RCS0040-1R80001`，`:3103` 自起关 HMR 的 vite，真 UI 真指针，浮条 Element × Intersect，光标落在弧中点投影与管身上；独立期望只用 `element/ptset` 的原始点算，不经拾取层与内核）——**弯头两条腿上的隐含管轴线与它自己的中心线弧相切**（切点 = 弯头 P1 / P2）：

| 组 | 两次子拾取 | Web | 独立期望 | Δ |
| --- | --- | --- | --- | --- |
| 弧 × 线（arrive 腿，相切） | 弯头体（`1. ELBO 中心线弧（P1 → P2）（弧）`）→ 45° 斜管管身（`TUBI 轴线（ELBO P-Point #1 → OLET P-Point #1）`） | 交点 `(7534.5084, −1586.8141, 2525.1215)`，起点名 `交点` | 同（管轴线离弧心 `gap − R = −4.9e-10 mm`，切点离 ELBO P1 0.72 µm，是模型数据不是算法） | **5.5e-15 m** |
| 弧 × 线（leave 腿，相切） | 弯头体 → 66° 斜管管身 | 交点 `(7516.6026, −1385.0755, 2123.9653)`；与上一点合成一条距离 **`449mm / −18 / +202 / −401 · N 5.07212 W 63.2122 D`**，两端都叫 `交点` | 同（`gap − R = −7.9e-10 mm`，离 P2 0.92 µm）；两切点距 449.3834 mm | **4.6e-15 m** |
| 先线后弧（换拾取顺序） | 45° 管管身 → 弯头体 | 同第一组的交点（E3D「弧永远第一」） | 同上 | **5.5e-15 m** |
| 弧 × 线（无交点） | 弯头体 → 5.77 m 长管管身 | 不落测量点；warning toast + 提示条 `所选项与弧没有交点，请改选其它项（E3D: No intersection between picked items）；求交已选 1. ELBO 中心线弧（P1 → P2）（弧），再选一项（Intersection[2]）`，状态条仍 `(Intersection[2])`，弧没被丢 | 长管投到弧面后离弧心 1736.791 mm > R 533 | — |

  页面错误 0。产物：`web-elbow-arc-intersect-live-01-arc-x-tube45-intersection.png`、`…-02-arc-x-tube66-distance{,-result-card}.png`、`…-03-line-then-arc.png`、`…-04-no-intersection-warning.png`、`…-records.json`（独立弧参数 / 三根管的两端与 `gap − R` / 每组的结果表与记录）。
  **顺带看到的「近似」chip** → **已修（`2ee0531`，用户 2026-09-16 23:3x 拍板）**。两处各错一半：
  (a) 交点命中沿用最后那一击的来源，那一击若是拾元素用的表面点（`mesh_pick_point`），`hasApproximatePoint` 就把结果判成近似——交点是**算出来的**，表面点只是个把手（与 Perpendicular 的 `exactTarget` 同一条道理）。
  改法：`intersectionHit` 给命中打 `exactPosition` → `sourceInfo.exact`，`hasApproximatePoint` 跳过带它的点。
  (b) 就算本轮算出 `approximate: false`，测量列表读的是统一层投影：`fromXeokitMeasurement` 读不到 `provenance` 一律按 `legacy-unknown` → `toLegacyApproximate` 恒 true（§14 那条「该徽标对所有 xeokit 记录都亮」）。
  改法：距离记录按本轮算到的精度写 `provenance`——两端都是语义几何 → `semantic-point-pair`（`exact-semantic`）、有一端是 Graphics 网格特征 → `point-to-triangle-mesh`（`exact-surface`）、本轮判为近似就不写（照旧 `legacy-unknown`）。三档投影回的 `approximate` 与本轮一致，不给旧记录反推精确。
  **实机复核**（同一台 `:8022` / `:3103`，真 UI 走上表第一、二组）：记录 `approximate=false`、会话结果 `false`、两端 `sourceInfo.exact=true`、`provenance semantic-point-pair / exact-semantic`，交点与独立切点 Δ ≤ 5.5e-15 m；测量列表那条只剩「距离测量 / 显示中」两枚 chip，`measurement-approximate-badge-*` 不存在；页面错误 0。
  产物：`web-intersection-exact-live-01-scene.png`、`…-02-result-card.png`、`…-03-measurement-row.png`、`…-records.json`。仍开着的是**别的**记录类型（角度 / 标高 / classic）与「拾中表面点本身」那一档，照旧 `legacy-unknown`。
- **(1-c) RTOR / CTOR 的 `arc()`** → **Intersect 已接（`2ee0531`），Perpendicular 待拍板**。环面的弧不是 fillet：`arc(dbRef)` = `gmfArc.through3Points(pPosition[1], pPosition[3], pPosition[2])`
  （`edgctorus.pmlobj` 59–68 / `edgrtorus.pmlobj` 59–68）——三枚 P-Point 本来就在中心圆上，**不要 `POS`、也不要 `RINS` / `ROUT`**。`EDGPICKTYPE.intersect` 拿的正是这个无参重载（`edgpicktype.pmlobj` 666），
  所以 Web 的 `elementArcFromPPoints` 多一条环面分支（`kind: 'torus'`，圆心 = 三点外接圆心、法向按 P1 → P3 → P2 的右手序、`sweep` = 实际扫角），照原路进 ARC 操作数；单测 `elementArc.test.ts` +4、`useXeokitMeasurementTools.test.ts` +1
  （两个交点按「拾中这条弧的射线落在圆面上的点」取近：光标在环右侧出 (2.5, 4, 6)、挪到左侧出 (1.5, 4, 6)）。
  **Perpendicular 那一路没接**：E3D 的 `getArc()` 对 ELEMENT 先试 `arc(item, refPosition)`（`edgpositiondata.pmlobj` 348），ELBO / BEND 没有这个重载才回落到 fillet，而 RTOR / CTOR **有**——它按拾中点把圆沿轴挪到那个高度、
  或换成 `RINS` / `ROUT`、或改成截面圆（`edgrtorus.pmlobj` 117–142 / `edgctorus.pmlobj` 120–177），要目录属性 `RINS` / `ROUT`，测量的悬停链路现在不取属性。给它一个中心圆面会得出 E3D 不会给的数（差到 ±HEIG/2 或整个平面换向），
  所以环面在 Perpendicular 下照旧退化成点到点（`resolvePerpendicularTargetFromHit` 只认 fillet）。要不要补（取一次 `element/attributes` 把四个分支做全）另拍。
  **2026-09-17 §39.3 / §39.5 实测收口：不用补，Web 现在这样就是对的。** `perpendicularToPoint` 根本不问 `getArc()`，而 `EDGCTORUS` 没有 `.plane()`——E3D 的环面 Perpendicular 也是**点到点**（CTOR `=24381/46880` 实测 465.988 mm，垂足 = 拾中点）；
  `arc(dbRef, POSITION)` 那四个分支只在定位 / 捕捉那一路用得上，且它挪圆时写死 `.up`（非竖轴环面会被搬出自己的平面，§39.5）。原来担心的「±HEIG/2 / 平面换向」在 Perpendicular 上不会发生。
  **本库没有 RTOR / CTOR 样本**（`:8022` 搜不到），上面全是 `static_expectation` + 单测，未实机。
- (2) Element × Snap 落在弯头体上 Web 拾不到任何东西，E3D 回元素原点——这是 §2 #12 的 Item 原点源（本轮关着、缺省也关）；要不要在 Element 过滤器下缺省放行 Item 原点，另拍。
- (3) 标签细节：轴线两端名的顺序跟的是 DTX 直管对象的局部 z 向而不是流向（`轴线（BEND P-Point #1 → BEND P-Point #2）` 实际是 146110 P1 → 146107 P2）；同一位置的 OLET P1 / P2 校正取到先匹配的 P1（E3D `line()` 用的是 leave）。位置口径都对，不改。

## 38. 提示矩阵的 E3D 运行时采集：`capture-prompt-step.pmlmac` + 首轮（四条命令第 1 步，2026-09-16 23:35–23:39）

> 对应 `e3d-measure-prompt-matrix.md` §2–§6 的 E3D 列（此前全部 `static_expectation`）。目标：E3D 3.1 shadow（`E:\reverse\e3d\shadow_e3d31_aps_all\des.exe`，PID 11900，09-15 15:17 起跑，与 §8 / G8 同一环境），主窗口最小化。
> 提示原文**不靠 OCR**：直读 `!!edgCntrl.state.prompt()`（`edgstate.pmlobj` 323–362，产品拼提示串的那个方法）和视口 inMode 上真正显示的那句（`EDGPICK.applyToView` 加 ` : ` 后写进 `!view.attribute(inMode).prompt`，`edgpick.pmlobj` 161–195）。
> **本节没有截图**：主窗口 iconic 时 `printwindow-capture.ps1` 只出 158×26 的空图；不抢焦点、不还原窗口（§8 同款约束，还原窗口要用户点头）。

### 38.1 采集宏 `capture-prompt-step.pmlmac`（同目录，已入库）

- **每步一调**：`$M "D:/work/plant-code/old/plant3d-web/docs/verification/e3d-measurement-runtime-golden/capture-prompt-step.pmlmac" <tag> [<note>]`，`tag` = 矩阵条目 + 步（`P2-01-s1`、`P3-04-s2`、`P6-02-after-alert`），`INIT` 或文件尚不存在时先写一段**会话头**。缺省参数替换成空串（实机验过：`args=[ONE]|[]`、`[]|[]`）。
- **写什么**（一块 `==== capture-prompt-step tag=… ==== end tag=…`）：`prompt=`（`prompt()` 原字）、`view[i].inMode.prompt=`（视口那句，带 ` :`）、三段原串（`state.pickPacket / pickType / pick` 的 `key / description / prompt`，BLOCK 求值前）、`state.major / minor / positioning / isPositionMode`、`!!edgPosCntrl` 的 `pickTypeIndex / pickType.description / pickTypesValue[*] / pickTypeFormat / pickIndex / pick.description / intermediate / activePlane / offset / offsetType`、`!!edgPositioning` 四个 gadget 的当前显示（`pick / pickType` 的 DTEXT、`input.val`、`wp.val`）、`!!gphMeasure.shown / perpendicularTo`、`edgCntrl.stack.size`。会话头：`PROJECT CODE / MDB / USER / ce / COORDINATE / UNIT`、`pickTypeList()` / `pickList()`、`distanceFmt / integerFmt / realFmt` 的 `dp`。
- **只读**：查询 + 写文件，不动数据库、不拾取、不改任何 gadget。每个取值都带 `handle any`，取不到写 `unset`，一处失败不影响整块。
- **落档**：`e3d-prompt-capture.trace.txt`（APPEND；写失败落 `e3d-prompt-capture.err.txt`）。
- **怎么送进 E3D**：命令行直接敲；或不动窗口、从进程外投——`python E:\reverse\e3d\e3d-license-hook\exec_clr_method.py --pid 11900 --dll E:\reverse\e3d\e3d-license-hook\E3DBootstrap_20260713_192908.dll --type E3DBootstrap.Entry --method QueueThreadedDirectMacroRawFromHost --arg '<命令>'`（多条用 `||` 分隔；回执落 `E:\reverse\e3d\e3d_direct_macro_result.txt`，看到 `RunInCurrentScope => True` 即跑完）。**用 `Raw` 变体**：`NoRefresh` 那支会先 `CloseKnownToolForms`（现只匹配 Save/Restore Views / Compare 两类窗体）并刷新，`Raw` 一律不碰，测量状态原样保留。
- **坑（已修）**：宏里不能有 `$P`——命令窗口没开时那一下 `Invoke` 在 PML 跑完**之后**抛 `InvalidOperationException`，bootstrap 依次再试 `Run` / `RunInPdms`，同一块被写三遍（23:34 那次实测）；去掉控制台输出后一调一块。

### 38.2 首轮观察（Positioning Control 基线：Snap · Significant Snaps 开 · WP 关 · Offset NONE，trace 里 `posCntrl.*` 逐项可核）

| tag | 操作（进程内 PML，与功能区按钮同一入口） | `prompt()` | 视口 inMode prompt | 三段 / 状态 | 矩阵 |
| --- | --- | --- | --- | --- | --- |
| `INIT` / `P2-00-baseline` | 空闲 | `Navigate` | `Navigate :` | packet / pickPacket / pick 都是 `stdDefault`（Default Pick），`isPositionMode` FALSE，`stack.size` 0 | — |
| `P2-01-s1` | `!!gphViews.measure('DISTANCE')` | `Measure distance start (Snap) Snap` | `Measure distance start (Snap) Snap :` | pickPacket `Standard Distance Measure`、pickType.prompt `start`、pick.prompt `Snap`；`isPositionMode` TRUE、`intermediate` TRUE、`stack.size` 1 | §2 行 1 步 1 ✓ |
| `P2-02-s1` | `!!gphMeasure.perpendicularTo.val = TRUE` + `setPerpendicular()` | `Measure perpendicular distance start (Snap) Snap` | `… start (Snap) Snap :` | pickPacket 立即换成 `Standard Perpendicular From Point Measure`；`gphMeasure.perpendicularTo` TRUE | §2 行 3 步 1 ✓（勾上那一下命令名就换） |
| `P2-02-off` | 勾掉再 `setPerpendicular()` | `Measure distance start (Snap) Snap` | 同 | 回 `Standard Distance Measure` | — |
| `P2-01-closed` | `!!gphMeasure.close()` + `hide` | `Navigate` | `Navigate :` | `stack.size` 0 | 退出回默认 ✓ |
| `P2-03-s1` | `!!gphViews.measure('ANGLE')` | `Measure angle root of angle (Snap) Snap` | `… root of angle (Snap) Snap :` | pickPacket `Standard Angle Measure`、pickType.prompt `root of angle` | §2 行 5 步 1 ✓ |
| `P2-04-s1` | `!!gphViews.measure('LINEANGLE')` | `Measure angle between lines first line` | `Measure angle between lines first line :` | pickPacket `Standard Line Angle Measure`、pickType `Standard Graphics Pick`、pick `Graphics`、**pick.prompt unset**、`isPositionMode` FALSE，同一刻 `posCntrl.intermediate` 仍 TRUE | §2 行 8 步 1 ✓ = **D1 运行时实证**：无 `(token)`、无 ` Snap` 尾巴，与 Significant Snaps 开着无关 |
| `P2-03-closed` / `P2-04-closed` | `!!gphAngleMeasure.close()` + `hide` | `Navigate` | `Navigate :` | `stack.size` 0 | 退出回默认 ✓ |

会话头（`INIT`）：`project=AMS · mdb=/ALL · user=SYSTEM · ce=* · coord=ENU · unit=MM Bore MM Distance`；
`pickTypeList = Snap|Distance|Mid-Point|Fraction|Proportion|Intersect|Cursor`（七项、顺序、无 Angle → 矩阵 §3 ✓）；`pickList = Any|Element|Aid|Pline|Ppoint|Screen|Graphics|External`（→ §4 顺序 ✓）；
缺省 `pickTypesValue[2]=0 / [4]=2 / [5]=0.5`，`distanceFmt.dp=2 · integerFmt.dp=0 · realFmt.dp=2`；`intermediate=TRUE · activePlane=FALSE · offset=FALSE · offsetType=NONE`（→ §5 缺省 ✓）。
`!!edgPositioning` / `!!gphMeasure` 在空闲时都是 `unset`（窗体还没被 load 过），进命令后 `gphMeasure.*` 有值、`!!edgPositioning` 仍 unset（本轮没开 Positioning Control 窗体）。
四条命令进出各一次，E3D 全部回到 `Navigate`、`stack.size` 0，没留任何测量状态；`e3d-prompt-capture.err.txt` 不存在（无写失败）。

### 38.3 还没采（都要真实拾取或改 Positioning Control 设置，宏已就位、一步一调）

- 各命令第 2 / 3 步（要拾中第一点 / 第一条线）；七种 token 的实际字串与 D2 三处（`P3-04`：`.input` 填 2.5 → `Fraction[2.5]`？重显几？落点在 0.5？）；过滤器八串字字相同（`P4-01`）；` Snap` 关 / ` WP` / ` Offset` 尾巴（`P5-*`，D4 实证）；§6 全部告警原文（`P6-*`，含 D5 的 `(2,874)`）。
- 截图（golden §1 要求测量窗体 + 命令提示 + 三维视口同框）：要主窗口非最小化，`printwindow-capture.ps1` 才出图。
- **→ §40（2026-09-17）**：七种 token 实串、D2 三处（结论翻案；07:36 用户拍板 (a)，`67b127b` 改掉，决策 `d-342`）、两线夹角第 2 步、距离第 2 步的步词已采成 observation，带截图；`printwindow-capture.ps1` 对这扇窗只回旧帧，截图改走 `CopyFromScreen`。**§40.6（10:3x 第三轮）**：距离第 2 步 `(Snap)` 变体、垂距第 2 步、三点角第 2 / 3 步——三条定位命令每一步都实机了；**§40.7（10:5x）**：§5 三条尾巴 Snap 关 / WP / Offset 及组合，pad WP 按钮没平面时弹 `No working plane has been defined.`。**§40.8（11:3x）**：§4 过滤器八串——真点 pad 八颗过滤器按钮，提示字字不变、亮灯与 `pickIndex` 一一对应；§38.3 只剩 §6 告警原文（`P6-*`）。

## 39. Intersect 的 ARC 操作数 / 弯管与环面的 Perpendicular：E3D 运行时采集（2026-09-17 00:0x + 06:3x）

> 走 §38 同一条路（`exec_clr_method.py --method QueueThreadedDirectMacroRawFromHost` 投进跑着的 E3D 3.1 shadow，PID 11900），五个**只读**探针（本地 PML 对象 + 查询，不写库、不拾取、不动窗体）：
> `probe-arc-sweep.pmlmac`、`probe-torus-arc-v2.pmlmac`、`probe-elbow-perpendicular.pmlmac` / `…-v3.pmlmac`、`probe-torus-perpendicular.pmlmac`、`probe-edg-dispatch-v4.pmlmac`，trace 落 `e3d-arc-operand.trace.txt`（同目录，已入库）。
> 起因是 §37 (1-b) / (1-c) 与提示矩阵 D7 本轮留下的三条 `static_expectation`。三条都采实了，另有两件**推翻了 §37 (1) 的前提**。
>
> **采集坑（第一轮全部 `getX() FALSE` 的读数由此作废，v4 重采）**：`!!edgTypes` 在这个会话里没建过（`(2,751) Variable !!EDGTYPES does not exist`）。
> `EDGPOSITIONDATA.getLine() / getPlane() / getArc()` 的每一条分支都只经 `!!edgTypes.attribute(fullType).…`，且外面裹着**吞掉一切的 `handle any`**（`edgpositiondata.pmlobj` 224–231 / 462–468 / 342–366）——
> 全局不在就一律静悄悄回 unset，**分不清「这个 EDG 类型没有这个方法」与「全局没建」**。`probe-edg-dispatch-v4.pmlmac` 先按产品自己的入口把它建起来（`EDGTYPES.globalInstance()`，`edgtypes.pmlobj` 149–164）再问一遍：
> 三条里 `getArc()` 确实由 FALSE 翻成 **TRUE**（是假象），`getLine()` / `getPlane()` 仍 FALSE（是真的——见 39.3）。
> 其余探针一律 `object EDGELBOW()` / `object EDGCTORUS()` / `object GMFARC()` 本地构造。
> PML 坑两条：不吃 `(!a + !b).string()` 与 `f(!a / 2)` 这类括号表达式上的方法调用 / 参数里的算术，先赋给变量再用；`ORIENTATION` 取轴是 `.zDir()`，
> 写成 `.zDirection()` 会以 `(2,779)` 中断整个宏（`probe-torus-arc-v2` 第一轮就断在这里，环面那半由 v4 补完）。

### 39.1 `ARC.intersections()` 按**整圆**算，并把线**投到弧面**（→ Web 口径 ✓，`static_expectation` 升级为 observation）

半径 500 的水平圆（E10000 N10000 U15000），同一个圆再切成 `startAngle 0 / endAngle 90` 的四分之一：

| 探针线 | full 360 | quarter 0–90 | 说明 |
| --- | --- | --- | --- |
| 过圆心沿 E | 2 个（角 **0 / 180**） | **2 个（角 0 / 180）** | 180° 在扫角之外照样回 → **不按弧段裁**，按整圆 |
| 弦（南 400 mm） | 2 个（233.130° / 306.870°） | **2 个** | 两个交点都在扫角外 |
| 相切（北 500 mm） | **1 个**（角 90） | — | 与 Web 的相切分支同档 |
| 不相交（北 900 mm） | **0 个** | — | 0 个才轮到 `alert.warning('No intersection between picked items')` |
| 离弧面 300 mm 的平行线 | **2 个，与共面那条同样的两点** | — | E3D 把线**投到弧面**再求交 |

`ARC.intersections(PLANE)` 存在、回 2 个；`ARC.intersections(ARC)` 对同心同半径的两个圆回 **0**。
⇒ `pickDerivation.ts` 的 `arcLineIntersections` / `arcPlaneIntersections` / `arcArcIntersections`（整圆、投影、相切、同心回空）四条口径与 E3D 一致。

### 39.2 面 × 面之后第三项是弧（矩阵 **D7**）：`(2,779) Method <ARC>.INTERSECTION(<PLANE>,<PLANE>) not found`

`edgpicktype.pmlobj` 842 那一句抛的是 **(2,779)**，旁边的 `handle (2,874)` 接不住 → PML 未处理错误往上跑。单参的 `ARC.intersection(PLANE)` 同样 not found。
Web 的取舍（按「转不成线 / 面」error 拒收、**不消耗**这一击）不变；矩阵 D7 的 E3D 侧从「未采」改成这条原文。

### 39.3 **弯管 / 环面的 Perpendicular 是点到点，不是弧面**——§37 (1) 的前提不成立（`c4f20bd` 待重看）

- `GMFARC.perpendicularToPoint`（`gmfarc.pmlobj` 1911–1939）只走 `getLine()` → `getPlane()` → 点到点三档，**从不问 `getArc()`**。
- `EDGPOSITIONDATA.getPlane()` 的 ELEMENT 分支（`edgpositiondata.pmlobj` 458–468）只调 `edgTypes.attribute(fullType).plane(item)`；实机 `EDGELBOW.plane(DBREF)` 与 `EDGCTORUS.plane(DBREF)` 都回 **`(2,779) not found`**（整个 PMLLIB 里定义 `.plane(` 的只有 assmember / edgextrusion / edgpanel / edghplanarcontour / edgpositiondata / edgrefgrid / gph* 那几张网格面 / polyline）。
- **根因不是「没建全局」**：`EDGELBOW` 整张对象只定义了 `arc(DBREF)` 与 `arc(DBREF, REAL)` 两个方法，`EDGCTORUS` 只有 `arc` 的三个重载——两边都**没有 `.line()` / `.plane()`**，
  所以无论 `!!edgTypes` 在不在，ELEMENT 分支那两句都落进 `handle any` 回 unset。v4 把全局按产品入口建起来后重采，**`getLine()` / `getPlane()` 仍是 FALSE**，只有 `getArc()` 翻成 TRUE
  （弯头 `=24381/145121` 回 centre `(7296.430, −1645.917, 2254.322)` / R 356，与 `EDGELBOW.arc(dbRef)` 同一个圆；CTOR `=24381/46880` 回 centre = POS / R 50）——而 `perpendicularToPoint` **从不问 `getArc()`**，所以结果不变。
- 直接调产品那一句（源点 = §37 的 ATTA 145120 P3 `(7400.402, −1874.288, 2641.29)`，`!!edgTypes` 建前建后两轮**逐位相同**）：

| 第二击拾中的位置 | E3D `perpendicularToPoint` 给的距离 | 垂足 |
| --- | --- | --- |
| 弧中点 `(7579.524, −1448.265, 2341.083)`（Web 实机光标落处） | **551.094 mm** | **= 拾中点本身** |
| 元素原点 `POS (7608.62, −1427.95, 2350)`（ELEMENT Snap 的回落） | **572.208 mm** | **= POS** |
| （对比）到中心线弧所在平面 | 76.0983 mm，垂足 `(7354.361, −1821.007, 2670.14)` | 与 §37「修后」Web 的逐位相同——**但 E3D 不给这个数** |

  CTOR `=24381/46880` 同样：`getPlane()` FALSE，`perpendicularToPoint` = 到拾中点的直线距离 **465.988 mm**、垂足 = 拾中点。
⇒ §37 (1) 引的 `edgpositiondata.pmlobj` 537 是**弧 PLINE** 分支，不是 ELEMENT 分支。`c4f20bd` 把弯管的 Perpendicular 改成测到弧面，方向反了：E3D 给的就是**到拾中位置的点到点**（即修前 Web 的 456 mm 那一档）。
**已回退（`dcac130`，用户 2026-09-17 拍板对齐 E3D）**：`resolvePerpendicularTargetFromHit` 不再把 `elementArc` 转成 `circle-plane`，弧只留给 Intersect；Element × Cursor 拾中弯管体 = 到那个表面点的点到点，
Any × Snap 走「Item 原点」点源 = 上表第二行的 `POS` 那一档。

### 39.4 弯头 `arc()` 取的是目录 `parameter[2]`，而那一格是**外径**不是弯曲半径——E3D 这个圆不切在 P1 / P2 上

`edgelbow.pmlobj` 58：`!radius = !dbRef.parameter[2]`，再 `gmfArc.fillet(radius, P[arrive], POS, P[leave])`——**半径是输入**，切点由半径定。
v4 把这枚弯头的目录参数原样读出来了（`=24381/145121`，`catref /ASME_B16.9/A1/TYEGESSQQ`，`RADI 0`、`ANGL 49.8663`）：

| | `parameter[1]` | `parameter[2]`（`arc()` 用的） | `parameter[3]` |
| --- | --- | --- | --- |
| 值 | 350 | **356** | **533** |
| 是什么 | 公称通径 DN350 | 外径（355.6 档） | **弯曲半径**（1.5 D = 533.4 档） |

`|POS → P1| = |POS → P2| = 247.785`，据此反推的中心线半径 = 247.785 / tan(49.8663° / 2) ≈ **532.8**，与目录 `parameter[3]` 的 533 对得上；
E3D 实际给的 **R = 356.000**、圆心 `(7296.430, −1645.917, 2254.322)`，切点落在 `(7559.120, −1534.058, 2466.966)` / `(7547.160, −1399.313, 2199.027)`，
离 POS 只有 **165.500**（P-Point 在 247.785），离 P1 / P2 各 **82.285 mm**——**E3D 的弧不经过弯头两端**，管中心线到这里是断的。
Web（`c4f20bd` 的 `elementArc.ts`，由 P1 / POS / P2 反推）给 R **533**、圆心 `(7141.212, −1754.288, 2206.751)`：**与目录声明的弯曲半径一致、切点就是 P1 / P2**。
两个圆**在同一张平面上**（所以 39.3 里 76.0983 两边一致），但不是同一个圆。
⇒ 差异的来源是 `edgelbow.pmlobj` 把目录参数的**下标取错了一格**（`EDGBEND` 那一份取的是 `!dbRef.radius`，即 RADI 真值，没有这个毛病）。
**已对齐（`dcac130`，用户 2026-09-17 拍板）**：Web 照 E3D 读同一格——新内核 `elementArcRadius.ts`（BEND → `RADI`；ELBO → `SPRE` → SPCO `CATR` → SCOM `PARA` 第 2 项），
`elementArc.ts` 的 fillet 改成按给定半径定切点（`T = R / tan(α / 2)`，`start` / `end` 是腿上的切点而不是 P1 / P2），半径取不到 / ≤ 0 就不给弧。
最后一条与 E3D 也对得上：ELBO `=24381/57393` 的 `PARA` 只有一项「0」，实机 `EDGELBOW.arc(dbRef)` 抛 `(2,888) Attempt to create invalid arc`（本篇 trace 第 105 行），两边都没有 ARC 操作数。
悬停链路从此会取一次目录属性（`elementArcRadiusCache`，按 refno + `CATR` 两级缓存，只在 Intersect 下发起）。

环面相反，**完全对上**：CTOR `=24381/46880`（`rins 40 / rout 60 / ANGL 90`）的 `arc(dbRef)` 圆心 = `POS`、R = **50** = (rins + rout)/2、扫角 = ANGL，与 Web 的 `through3Points(P1, P3, P2)` 一致（§37 (1-c)）。

### 39.5 环面的 `arc(DBREF, POSITION)` 四个分支实测：Intersect 用不上它，而它自己把圆挪错了轴

`edgctorus.pmlobj` 120–177 按「拾中点投到环面后离环心多远」四选一：落在中心线半径上（±2 % 管半径）→ 中心线圆、落在 `RINS` / `ROUT` 上 → 换成那个半径、都不是 → 换成**管截面圆**。
v4 用 CTOR `=24381/46880`（`rins 40 / rout 60`，管半径 10，轴 = S）三个拾中点实测中心线那一档：

| 拾中点 | `arc(dbRef, POSITION)` 圆心 | R |
| --- | --- | --- |
| P3，正在中心线上（面内） | `POS`（U 6615） | 50 |
| 沿轴偏 **5 mm** | U **6625** | 50 |
| 沿轴偏 **10 mm** | U **6625** | 50 |

两点：① 偏移量**不跟拾中点走**，一律 ±管半径（把圆搬到管的那张端面上）；② 搬的方向是 `!arc.position.up = !arc.position.up ± !radius`（148 / 150 行）——**写死 UP**，
而这枚环面的轴是 S，所以圆被搬出了自己的平面，几何上讲不通（AVEVA 侧的毛病，只在非竖轴环面上暴露）。
**对 Web 没有影响**：Intersect 走的是 `edgpicktype.pmlobj` 666 的 `arc(item)` 无参重载（回落那一支传的是 `pickLine`，是 LINE 不是 POSITION，`EDGCTORUS` 没有这个重载 → 被 `handle` 吞掉），
拿到的始终是中心线圆；这一支只在 `EDGPOSITIONDATA.getArc()`（`edgpositiondata.pmlobj` 349，定位 / 捕捉那一路）上出现，而 Perpendicular 不问 `getArc()`（39.3）。

### 39.6 对齐那一版（`dcac130`）的验证状态：单测 + 目录链路已核，**真 UI 实机未做**

| 项 | 结果 |
| --- | --- |
| 单测 | **185 文件 1647 用例全过**；eslint 0；type-check 新增 0。`elementArc.test.ts` 的 ELBO 那条直接对 39.4 的实测值（圆心 `(7296.430, −1645.917, 2254.322)`、R 356、切点离 `POS` 165.500、离 P1 / P2 各 82.285 mm，E3D 自带 ~3e-4 mm 的 `arcFillet` 噪声按 1e-3 mm 对） |
| 目录链路（`:8022` 真库） | `24381/145121` / `145123` → `SPRE` → `CATR /ASME_B16.9/A1/TYEGESSQQ` → `PARA 350, 356, 533` ✓；BEND `146110` → `RADI 133`（它的 `PARA` 只有「20, 26.7」两项，正好说明 BEND 不能走目录那一格）；ELBO `57393` → `PARA 0` → 无半径 → 无弧，与 E3D 的 `(2,888)` 一致 |
| **真 UI 实机** | **未做**。这一刻 `:8022` 上跑的是另一个 build（07:05 起的 `aios-database`），只有 `tree` / `element/attributes` / `search`，`element/ptset` / `element/plines` / `geom/instances` 一律 405 —— 模型加载不出来、P-Point 也拿不到，弧根本构不成。后端回来后要补的两组见下 |

后端（带 `element/ptset` 的 gen-model）回来后补跑：① Element × Intersect，弯管体 + 同一条腿上的隐含管轴线 → 交点应落在离 `POS` **165.500 mm** 的新切点（比 `9bbb501` 那一轮挪 **82.285 mm**）；
② Perpendicular to，第二击落在弯管体 → 点到点、目标名不带「弧面」（对 §39.3 表的第一行 551.094 mm 那一档）。

## 40. 提示矩阵 E3D 运行时采集·第二轮：七种 token / D2 三处 / 两线夹角第 2 步（主窗口还原、真实拾取、带截图，2026-09-17 00:0x + 06:3x–06:5x）+ 第三轮 10:3x–11:0x：距离第 2 步 `(Snap)` 变体 / 垂距第 2 步 / 三点角第 2、3 步（§40.6）、§5 三条尾巴 Snap 关 / WP / Offset（§40.7）+ 11:3x：§4 过滤器八串（§40.8）

> 接 §38.3 的清单。用户 00:00 点头「把 E3D 主窗口还原到前台」，这一轮才有截图与真实鼠标 / 键盘输入。同一台 E3D 3.1 shadow（PID 11900），同一支宏 `capture-prompt-step.pmlmac`（本轮多了 5b pad 状态 / 5c pickData 与 return / 6 dimension 三段，见宏头），trace 仍是 `e3d-prompt-capture.trace.txt`；落点核算另加只读探针 `probe-fraction-landing.pmlmac` → `e3d-fraction-landing.trace.txt`。
> 00:05–00:14 那一段是上一会话（fable-5-1-32）做的，trace 里 `P3-04-s*` / `P3-0x-*` / `P3-04-round-*` 十九块；06:36–06:53 是本会话，`*-r2-*` 十五块；10:34–10:42 是接手会话（fable-5-1-41）的第三轮，`*-r3-*` 十四块（§40.6）；10:56–11:07 同一会话续采尾巴，`P5-*` 十七块（§40.7）；11:37–11:39 同一会话再采过滤器，`P4-*` 九块（§40.8）——那一轮采完没来得及记录，截图 / 文档 / 入库与 E3D 收尾由接手会话（fable-5-1-7）15:3x 补做（`P4-r3-check` / `P4-r3-closed` / `P4-r3-final` 三块）。

### 40.1 现场与路子（这一轮新踩出来的）

- **还原窗口**：`ShowWindow(SW_RESTORE)` + `SetForegroundWindow`（hwnd 94838402，1721×927 逻辑像素 ≈ 整屏）。06:36 第一次还原后十几秒内被谁又最小化了一次（不是投宏、不是截图——两者单独重试都不复现），第二次还原后一直稳着；每次截图前先查 `IsIconic`。
- **窗体在屏外**：最小化期间 show 出来的 owned 窗体坐标停在 −21334 附近——`Positioning Control`（`!!edgNewPositioning`，hwnd 85331936，160×69）与 `!!GPHMEASURE`（hwnd 35134792，245×315）都「shown=TRUE 但看不见」，00:09 那三张截图里没有窗体就是这个原因。`SetWindowPos(SWP_NOSIZE|SWP_NOZORDER|SWP_NOACTIVATE)` 挪进视口：pad → (262,128)，Measure → (1205,128)，Measure Angle（hwnd 43649440，本来就在屏内 512,456，挡住模型）→ (1205,128)。E3D 记住了新坐标，本会话后面再 show 都在屏内。
- **截图**：`printwindow-capture.ps1`（`PrintWindow`）对这扇窗只回同一帧旧画面——00:09 的 `e3d-prompt-P3-04-s1/s2/s3-*.png` 三张字节相同（SHA-256 前缀 `172A9D6C…`，1721×927，无窗体无提示），已删。改用 `Graphics.CopyFromScreen`（合成桌面 BitBlt，进程先 `SetProcessDPIAware`），按主窗口矩形裁到屏内 → 2560×1379 物理像素，浮动窗体、提示气泡、AID 文字都在同一帧里（golden §1 的「窗体 + 提示 + 视口同框」）；脚本入库为同目录 `screen-capture.ps1`（`-Out <png> [-Hwnd]`，与 `printwindow-capture.ps1` 并列）。
- **真实输入**：`SetCursorPos` + `mouse_event` 点视口（物理像素），`SendKeys` 往 pad 输入框敲 `Ctrl+A`、`2.5`、`Enter`。
- **第三轮（10:3x）补两条**：(1) 主窗口没被最小化，但被最大化的桌面壳盖住，pwsh 里 `SetForegroundWindow` 被前台锁挡掉（`fg` 不变）——cua-driver 的 `bring_to_front`（`AttachThreadInput` 路子）一次到位，之后每次点击前 `input.ps1` 再 `SetForegroundWindow` 就都成了；(2) pad 与 `!!GPHMEASURE` 记住了上轮挪进屏的坐标（262,128 / 1205,128），**Measure Angle 窗体没记住**，`measure('ANGLE')` 又出现在 (512,456) 挡住模型，再挪一次。
- **投宏路子**（§38.1）不变，但 00:14 那条 `!!edgPosCntrl.active = FALSE` 起每条命令都是 `RunInCurrentScope threw InvalidOperationException（在创建窗口句柄之前，不能在控件上调用 Invoke）` → `Run => False (41,6) Non-existent element` → `RunInPdms => True`。**只跑一遍**（每 tag 一块，`e3d-prompt-capture.err.txt` 不存在），照用即可。
- `!!edgTypes` 本会话是 defined 的（06:45 探针：`EDGTYPES`，`.tubing` = `EDGTUBING`）——§39 说的 `(2,751)` 不在拾取这一路上；真实拾取走 `EDGPICKTYPE.fraction()` → `!!edgTypes.tubing.fraction(item, value, pointVector, intermediate)` 一路通。

### 40.2 00:0x 轮（上一会话，程序切类型，无有效截图）

Positioning pad 是停靠版 `!!edgNewPositioning`（`posCntrl.type=PAD1`，`edgposcntrl.pmlobj` 196 写死），`!!edgPositioning`（STANDARD 表单）整段会话都是 unset。切类型走 `!!edgPosCntrl.setPickType(i)`（pad 按钮的回调就是它）。

| tag | 操作 | `prompt()`（视口再缀 ` :`） | 输入框 / 状态 | 矩阵 |
| --- | --- | --- | --- | --- |
| `P3-04-s1` | `measure('DISTANCE')` | `Measure distance start (Snap) Snap` | `padForm.shown` TRUE，输入框 unset、灰 | §3 行 1 ✓ |
| `P3-04-s2-direct-2p5` | `pickTypesValue[4] = 2.5` 直写 | `… (Fraction[2.5]) Snap` | `pickTypeValue=2.5`，**输入框重显 `3`**（`!!edgFormat = !!integerFmt`，dp 0） | §3 行 4 程序路径 |
| `P3-04-s2-gadget-2p5` | 经 gadget 回读（`setInput`） | `… (Fraction[3]) Snap` | `pickTypeValue=3`，输入框 `3` | §3 行 4 **用户路径** |
| `P3-04-s3-0p4` | 直写 0.4 | `… (Fraction[0.4]) Snap` | 输入框重显 `0` | — |
| `P3-04-s4-default-2` | 回缺省 2 | `… (Fraction[2]) Snap` | 输入框 `2` | 缺省 ✓ |
| `P3-02-distance-100` | `setPickType(2)`，值 100 | `… (Distance[100]) Snap` | `!!distanceFmt`，输入框 `100mm`，`edgFormat.dp=2` | §3 行 2 ✓ |
| `P3-05-proportion-0p25` | `setPickType(5)`，值 0.25 | `… (Proportion[0.25]) Snap` | `!!realFmt`，输入框 `0.25` | §3 行 5 ✓ |
| `P3-03-midpoint` | `setPickType(3)` | `… (Mid-Point) Snap` | 输入框灰（`input.active` FALSE） | §3 行 3 ✓ |
| `P3-06-intersect` | `setPickType(6)` | `… (Intersection[1]) Snap` | `pick.prompt` 原串 `Intersection[' & !this.minor & ']` | §3 行 6 ✓ |
| `P3-07-cursor` | `setPickType(7)` | `… (Cursor) Snap` | — | §3 行 7 ✓ |
| `P3-04-round-*` | 同 gadget 路径扫 2.4 / 2.5 / 2.6 / 1.5 / 3.5 / 0.4 / 0.6 / 1.9 | `Fraction[2]` / `[3]` / `[3]` / `[2]` / `[4]` / `[0]` / `[1]` / `[2]` | REAL 格式 gadget 按 dp 0 **四舍五入回读**（.5 进位） | D2 |

七个 token 字面与矩阵 §3 全部相同；`pickTypesValue[2]=100`、`[5]=0.25` 从此留在会话里（06:36 idle 块仍是这两个值；本轮收尾已还回 0 / 0.5）。

### 40.3 06:4x 轮（本会话，窗口还原，真实拾取，带截图）

拾取对象：`/Copy-of-RCS0014-1R43012新` 的 `ELBOW 4` 的 leave 管（竖管，`!!edgTypes.tubing.line` = E 7849.61 N 10447.46，U **14234.127 → 16583.356**，长 **2349.230 mm**；`lineExtended` 同一条）。

| tag | 操作 | `prompt()` / 视口 | 状态 / 数值 | 截图 |
| --- | --- | --- | --- | --- |
| `P3-04-r2-s1` | `measure('DISTANCE')`，窗体挪进屏 | `Measure distance start (Snap) Snap :` | pad 显示，输入框灰、留着上轮的 `2`；Measure 窗体 Dist 0mm | `e3d-prompt-P3-04-r2-s1.png` |
| `P3-04-r2-s2` | `!!edgNewPositioning.pickType(4)`（pad **没有 Fraction 按钮**，只能调它的方法） | `… start (Fraction[2]) Snap :` | 输入框激活显 `2`；**pad 上 Snap 按钮仍亮**（`pickTypeTable[4]` 不存在，没有可点亮的按钮；`padForm.toggles snap=TRUE`） | `…-r2-s2.png` |
| `P3-04-r2-s3` | 键盘：点输入框、`Ctrl+A`、`2.5`、`Enter` | `… start (Fraction[3]) Snap :` | `setInput` 取到 `gadget.val` = **3**，`pickTypesValue[4]=3`，输入框重显 **`3`** | `…-r2-s3.png`、`…-r2-s3-zoom.png` |
| `P3-04-r2-s4` | 真实点竖管离下端约 42% 处（物理像素 1200,905） | `Measure distance **end** (Fraction[3]) Snap :` | `pickData.type=TUBING / tubing=LEAVE`；落点 **U 15800.28 = 2/3**（`ratio=0.666667`，三段取近端）；视口挂 AID TEXT `Measure distance start`；`major=2` | `…-r2-s4.png` |
| `P3-04-r2-s5` | 直写 `pickTypesValue[4] = 2.5` + `setPickType(4)` | `… end (Fraction[2.5]) Snap :` | 提示 2.5、**输入框重显 `3`**——三处不一致的一帧 | `…-r2-s5.png`、`…-r2-s5-zoom.png` |
| `P3-04-r2-s6` | 真实点同一根管离下端约 40%（1200,939） | 回 `… start (Fraction[2.5]) Snap :` | 落点 **U 15408.741 = 1/2**（`int(2.5)=2`）；Measure 窗体 **Dist 391.54mm**、Offs 0 / 0 / −391.54、Dire `D WRT /*`（= 2349.23 × (2/3 − 1/2) = 391.54 ✓）；视口标注 `391.54mm` | `…-r2-s6.png`、`…-r2-s6-measure-zoom.png` |
| `P3-04-r2-closed` | 值还回 2、`pickType(1)`、`gphMeasure.close()` + hide | `Navigate :` | `stack.size` 0，pad 隐 | — |
| `P2-04-r2-s1` | `measure('LINEANGLE')` | `Measure angle between lines first line :` | pad 不出现（非定位拾取）；Measure Angle 窗体 | `e3d-prompt-P2-04-r2-s1.png` |
| `P2-04-r2-s2` | 真实点竖管（1200,975），Graphics 拾取 | `Measure angle between lines second line or plane :` | `pickData.type=TUBING`、`primitiveType=GEOM`；`pick.prompt` unset、`isPositionMode` FALSE、`intermediate` TRUE；视口无文字标记 | `…-r2-s2.png`、`…-r2-s2-zoom.png` |
| `P2-04-r2-escaped` | `!!edgCntrl.escape()`（= 视口 Esc）在第 2 步 | `Navigate :` | **整条命令撤掉**，`stack.size` 0——不是回第 1 步 | — |
| `P2-04-r2-closed` | `gphAngleMeasure.close()` + hide | `Navigate :` | `stack.size` 0 | — |

### 40.4 结论

1. **矩阵 §3 七种 token 字面 ✓**（40.2）；**§2 两线夹角第 2 步 ✓**（`… second line or plane :`，无 token 无尾巴，D1 第 2 步也实证）；距离第 2 步的步词 `end` ✓（token 位当时是 Fraction，`(Snap)` 变体没单独采）。
2. **D2 翻案**：用户在 E3D 3.1 里能走到的路径（pad 输入框填 `2.5`）得到的三处是 **`Fraction[3]` / 输入框 `3` / 落三分点**——三处**一致，都是整数**，因为 `text .input is REAL format !!edgFormat` 在 Fraction 下是 `!!integerFmt`（dp 0），`gadget.val` 按格式回读已经是 3（不只是显示）。矩阵 D2 引的「E3D 原样出输入值 `Fraction[2.5]`」只在**程序直写 `pickTypesValue[4]`** 时成立，那时才有「提示 2.5 / 输入框 3 / 落点 1/2」的三处不一致。Web `e8ebc10`（决策 `d-269`）对上的是源码读出来的那条程序路径：用户填 2.5，Web 出 `Fraction[2.5]` 落二分点，E3D 出 `Fraction[3]` 落三分点——**两处都不同**，~~待用户重新拍板~~（矩阵 §7 D2 行列了 (a) 输入即四舍五入 / (b) 保持 / (c) 只改内核）。**→ 用户 2026-09-17 07:36 拍板 (a)，`67b127b` 已改（决策 `d-342` 取代 `d-269`）**：`normalizeMeasurementPickTypeValues` 对 fraction 走 `roundLikeIntegerFmt`（最近整数、.5 远离零、不夹——0 合法），提示 token 拼落库值、浮条输入框 `change` 后把落库值写回、内核不动——填 `2.5` 两边都是 `Fraction[3]` / `3` / 三分点；单测四处改口（token / V9 读回 0.4 → 0 / 输入框 2.5 → '3'、3.4 → '3' / Graphics 立方体 y = 4.2 吸三等分的 4.1667），96 文件 854 用例过、eslint 0、type-check 新增 0。浮条真 UI 实机截图未补。
3. **E3D 3.1 的 pad 没有 Fraction / Proportion 按钮**（`edgnewpositioning.pmlfrm` 55–56 按钮、128–129 映射都注释掉），`pickTypeList()` 却仍回七项；程序切到 Fraction 后 pad 上 Snap 仍亮着。Web 浮条把七种都露出来，是比 E3D 3.1 多的入口（记为 Web 增强，不算偏离）。
4. Esc 在两线夹角第 2 步是**撤掉整条命令**（Web 点空白回第 1 步，D3 一类取舍）。
5. **第三轮（§40.6）三条定位命令的后续步全部 ✓**：距离第 2 步 `(Snap)` 变体 `Measure distance end (Snap) Snap :`、垂距第 2 步 `Measure perpendicular distance end (Snap) Snap :`、三点角第 2 / 3 步 `Measure angle first point (Snap) Snap :` / `… second point (Snap) Snap :`——四条字串与矩阵 §2 的 `static_expectation` 逐字相同；每条命令最后一击之后状态**回第 1 步**（`start` / `root of angle`，`major=1`，stack 仍 1，窗体出结果），不是退出命令。矩阵 §2 三条定位命令（距离 / 垂距 / 三点角）现在**每一步**都是 `observation`；§2 只剩 `measureLineAngle`（非弧包，D6 不做）没实机。
6. **§5 三条尾巴（§40.7）**：` Snap` 关得掉（`intermediate=FALSE` → `Measure distance start (Snap) :`，`(Snap)` 是类型 token 留着）；` WP` / ` Offset` 的字串与顺序照 `edgstate.pmlobj` 345–357——`prompt()` 里 **`WP` 后面跟两个空格**（`' WP '` 自带尾空格再接 `' Snap'` / `' Offset'`），视口气泡收成一个：`… (Snap) WP Offset Snap :`；**用户路径上 pad 的 WP 按钮在没定义工作平面时只弹 `No working plane has been defined.`、按钮弹回，尾巴不出**（`edgposcntrl` 672–685），` WP` 要先在 Working Plane 表单里定义平面；本 shadow 会话里 3.1 的 Offset 入口走不通（`!!appDesMain` / `!!edgSettings` 都没加载，`offsetType('ENU')` 弹 `(2,751) Variable !!EDGSETTINGS does not exist`），尾巴是直写 `offsetType` 采到的。D4（Web 不做 WP / Offset）不变，这两条只把 E3D 的字串钉死。
7. **§4 过滤器八串（§40.8）**：在 Measure distance 第 1 步上真点 pad 的八颗过滤器按钮，`prompt()` 八次**字字不变**（`Measure distance start (Snap) Snap`，视口 `… (Snap) Snap :`）——`edgposcntrl.setPick` 1397 把旧 pick 的 `prompt`（token 词）原样带给新 pick，`edgstate.prompt()` 三段里不引用 `pick.description`；`pickIndex` 1→2→…→8→1、`state.pick.description` 与 pad 亮灯**一一对应**（每次只亮一颗）。矩阵 §4 结。顺手观察：Ppoint / Screen 下 pad 把五颗拾取类型按钮置灰（`edgnewpositioning.pmlfrm` 200 `active = not inset(5,6)`），提示里的 `(Snap) Snap` 不变；Web 浮条原来没这条联动（拾取类型的 `disabled` 只看静态 `MEASUREMENT_PICK_TYPE_AVAILABILITY`）——不进提示，属 pad UI 差异；~~没立 D 项~~ **→ 用户 15:5x 拍板立 D8、Web 跟上（`82411f9`，决策 `d-379`）**：`measurementPickTypeSelectable(filter)`，浮条在 Ppoint / Screen 下整排拾取类型 `disabled` + 一句「<过滤器> 下不起作用（E3D 同）」，类型 / 提示 / 落库不动；单测 +1 与 D8 段。

### 40.5 还没采

~~垂距 / 三点角的第 2 / 3 步、距离第 2 步的 `(Snap)` 变体~~（10:4x 第三轮已采，§40.6）；~~Significant Snaps 关 / WP / Offset 尾巴（`P5-*`）~~（10:5x–11:0x 已采，§40.7）；~~过滤器八串（`P4-*`）~~（11:3x 已采，§40.8）；§6 全部告警原文（`P6-*`，含 D5 的 `(2,874)`）。窗口还原着（前台，15:4x 由 cua-driver `bring_to_front` 再拉回一次）、pad / Measure 窗体坐标在屏内（Measure Angle 每次 show 要再挪），下一轮可直接接着采。

### 40.6 10:3x–10:4x 第三轮（接手会话 fable-5-1-41，真实 Snap 拾取，带截图）

拾取类型一直是缺省 **Snap**（`pickTypeIndex=1`，`pickTypesValue` 0 / 2 / 0.5 没动），Significant Snaps 开、WP / Offset 关——正是矩阵 §2 表头写的那个状态。拾取对象仍是 `/Copy-of-RCS0014-1R43012新`：竖管（`ELBOW 4` leave，U 14234.127 → 16583.356）、`ELBOW 4 → ELBOW 5` 那段管、右侧折线的尾管。Snap 落点 = 所点管段**离点击处最近的一端**（AID TEXT 全挂在管端 / 弯头处）。截图 `e3d-prompt-P2-0x-r3-*.png`（2560×1379，`screen-capture.ps1`）。

| tag | 操作 | `prompt()`（视口再缀 ` :`） | 状态 / 数值 | 截图 |
| --- | --- | --- | --- | --- |
| `P2-r3-s0` | idle | `Navigate` | 缺省 Snap、0 / 2 / 0.5、`intermediate` TRUE、stack 0 | — |
| `P2-01-r3-s1` | `measure('DISTANCE')` | `Measure distance start (Snap) Snap` | pickPacket `Standard Distance Measure`、`major=1`（同 §40.3 `P3-04-r2-s1`） | — |
| `P2-01-r3-s2` | 真实点竖管（1200,905） | **`Measure distance end (Snap) Snap`** | `pickType.prompt=end`、`major=2`、`pickData.type=TUBING`（ELBOW 4 leave）；Snap 落竖管**上端**，AID TEXT `Measure distance start` 挂在弯头处 | `e3d-prompt-P2-01-r3-s2.png`、`…-s2-zoom.png` |
| `P2-01-r3-s3` | 真实点竖管近下端（1200,990） | 回 `… start (Snap) Snap` | `dimension.from` U 16583.356 → `to` U 14234.127（两击各落一端）；Measure 窗体 Dist **2349.23mm**、Offs 0 / 0 / −2349.23、Dire `D WRT /*`；视口标注 `2349.23mm` | `…-s3.png`、`…-s3-measure-zoom.png` |
| `P2-02-r3-s1` | `perpendicularTo.val = TRUE` + `setPerpendicular()` | `Measure perpendicular distance start (Snap) Snap` | pickPacket 换成 `Standard Perpendicular From Point Measure`、`major=1`；窗体 `Perpendicular to` 勾上、wrt 灰 | `e3d-prompt-P2-02-r3-s1.png` |
| `P2-02-r3-s2` | 真实点竖管（1200,905） | **`Measure perpendicular distance end (Snap) Snap`** | `pickType.prompt=end`、`major=2`；Snap 落竖管上端 | `…-s2.png`、`…-s2-zoom.png` |
| `P2-02-r3-s3` | 真实点右侧折线尾管（1430,772） | 回 `… perpendicular distance start (Snap) Snap` | `pickData.item` = BRANCH 本身（尾管）；`from` E 8023.196 N 8776.253 U 13322.101 → `to` 竖管上端 U 16583.357；窗体**四行** Distance **3668.63mm** / Vertical 3261.26mm / Horizontal 1680.2mm / Direction `N 5.92997 W 62.7425 U`；视口三段标注 | `…-s3.png`、`…-s3-measure-zoom.png` |
| `P2-02-r3-closed` | 勾掉 + `gphMeasure.close()` + hide | `Navigate` | stack 0、`perpendicularTo` FALSE | — |
| `P2-03-r3-s1` | `measure('ANGLE')` | `Measure angle root of angle (Snap) Snap` | pickPacket `Standard Angle Measure`；Measure Angle 窗体出现在 (512,456)，挪到 (1205,128) | `e3d-prompt-P2-03-r3-s1.png` |
| `P2-03-r3-s2` | 真实点竖管近上端（1200,850）→ 根点 = 竖管上端 | **`Measure angle first point (Snap) Snap`** | `pickType.prompt=first point`、`major=2`；AID TEXT `Measure angle root of angle` | `…-s2.png`、`…-s2-zoom.png` |
| `P2-03-r3-s3` | 真实点竖管近下端（1200,990）→ 第一点 = 竖管下端 | **`Measure angle second point (Snap) Snap`** | `pickType.prompt=second point`、`major=3`；AID TEXT `Measure angle first point` | `…-s3.png`、`…-s3-zoom.png` |
| `P2-03-r3-s4` | 真实点 `ELBOW 4 → ELBOW 5` 管段近远端（1265,855） | 回 `… root of angle (Snap) Snap` | `pickData.item` = ELBOW 5；Measure Angle 窗体 **97.53 Degrees** / DMS `97Å° 31' 52"`（度号画成 `Å°`，窗体字符集问题，原样记）/ Direction1 `D` / Direction2 `N 0.01 E 7.53 U`（那段管不水平，上仰 7.53°）；视口弧 + `Angle 97.53` | `…-s4.png`、`…-s4-angle-form-zoom.png` |
| `P2-03-r3-closed` / `P2-r3-final` | `gphAngleMeasure.close()` + hide | `Navigate` | stack 0、AID 全清（Keep dimensions 没勾）、pad 隐、缺省 0 / 2 / 0.5 Snap 未动 | — |

**对矩阵**：§2 距离第 2 步 `(Snap)` 变体、垂距第 2 步、三点角第 2 / 3 步四行 E3D 列全部字字相同 → 改 `observation`；`Measure perpendicular distance end` 的第二击是**定位拾取**（Snap 落点），E3D 拿落点所在管的线做垂足——Web 第 2 步文案「选择目标线 / 面上的点」说的就是这一击（结构一致、文案比 E3D 多，原判不变）。命令完成后 E3D **回第 1 步继续量下一组**（stack 仍 1、窗体留着），与 §40.3 距离那条一致；Web 完成后也停在同一模式等下一组，一致。trace 里每块 `state.return.size=0`、`pickData.position=Unset`——`getReturn()` 在两击之间也是空的，落点只能从 `gphMeasure.dimension.from/to`（距离 / 垂距）或 AID TEXT 位置（三点角）反推，与 §40.3 用 `probe-fraction-landing.pmlmac` 读 `pickPacket.return[i].position` 的路子不同（本轮没跑探针）。

### 40.7 10:5x–11:0x 尾巴三条（`P5-*`，Measure distance 第 1 步上切开关，带截图）

`EDGSTATE.prompt()`（`edgstate.pmlobj` 345–357）在定位模式下按 **WP → Offset → Snap** 的顺序缀尾巴：`activePlane` → `' WP '`（**自带尾空格**）、`offsetType ne 'NONE'` → `' Offset'`、`intermediate` → `' Snap'`，最后 `trim()` 只剪两端。开关的用户入口：Significant Snaps 在 Pick Settings 表单（`!!edgSettings`，回调 `edgsettings.pmlfrm` 1031–1040 = `!!edgPosCntrl.intermediate = !this.snap.val` + `!!edgCntrl.state.updatePrompt()`），WP 是 pad 右上那颗按钮，Offset 是功能区 Offset 开关（`offsetToggle`，要 `!!appDesMain`）。本 shadow 会话里 `!!edgSettings` / `!!appDesMain` / `!!edgPositionOffset` / `!!edgWorkingPlane` 都没加载（探针 `defined()` 全 FALSE），所以 Snap / Offset 两条按回调体直写状态再 `updatePrompt()`；WP 既走了程序路（`activePlane(TRUE)`）也走了用户路（真点 pad 按钮）。trace `P5-*` 十七块（其中 `P5-02-r3-wp-on` 两块，见下）。

| tag | 操作 | `prompt()` | 视口气泡 | 截图 |
| --- | --- | --- | --- | --- |
| `P5-00-r3-s1` | `measure('DISTANCE')`，缺省 | `Measure distance start (Snap) Snap` | `… (Snap) Snap :` | — |
| `P5-01-r3-snap-off` | `intermediate = FALSE` + `updatePrompt()` | **`Measure distance start (Snap)`** | `… (Snap) :` | `e3d-prompt-P5-01-r3-snap-off.png`、`…-zoom.png` |
| `P5-01-r3-snap-on` | `intermediate = TRUE` + `updatePrompt()` | `… (Snap) Snap` | `… (Snap) Snap :` | — |
| `P5-02-r3-wp-on` | **程序路** `!!edgPosCntrl.activePlane(TRUE)`（708：只置位 + `displayPlane()` → `updatePrompt()`，不查有没有平面） | **`Measure distance start (Snap) WP  Snap`**（`WP` 后**两个空格**） | `… (Snap) WP Snap :`（gadget 回读只剩一个空格） | `e3d-prompt-P5-02-r3-wp-on.png`、`…-zoom.png` |
| `P5-02-r3-wp-off` | `activePlane(FALSE)` | `… (Snap) Snap` | `… (Snap) Snap :` | — |
| `P5-03-r3-offset-on` | `!!edgPosCntrl.offsetType('ENU')`（1142：置 `offsetType`，再跑 `offsetForms[2]` = `!!edgSettings.editENU(…)`） | `Measure distance start (Snap) Offset Snap` | **仍是旧的** `… (Snap) Snap :`——`editENU` 撞 `(2,751) Variable !!EDGSETTINGS does not exist`，`handle ANY`（1160）挡不住那张 **Warning** 模态框，1174 的 `updatePrompt()` 要等 OK | `e3d-prompt-P5-03-r3-offset-warning.png`、`…-zoom.png` |
| `P5-03-r3-offset-on-updated` | 点掉 OK，`updatePrompt()` | `… (Snap) Offset Snap` | `… (Snap) Offset Snap :` | — |
| `P5-04-r3-wp-offset-snap` | WP + Offset + Snap 三开 | **`Measure distance start (Snap) WP  Offset Snap`** | `… (Snap) WP Offset Snap :` | `e3d-prompt-P5-04-r3-wp-offset-snap.png`、`…-zoom.png` |
| `P5-04-r3-wp-offset-nosnap` | 三开再关 Snap | `… (Snap) WP  Offset` | `… (Snap) WP Offset :` | `…-nosnap-zoom.png` |
| `P5-05-r3-wp-off-again` | `activePlane(FALSE)`（Offset 仍开、Snap 关） | `… (Snap) Offset` | `… (Snap) Offset :` | — |
| `P5-05-r3-defaults` | `offsetType = 'NONE'`（直写成员，绕开 `offsetForms[1]` 那张 alert）+ `intermediate = TRUE` + `updatePrompt()` | `… (Snap) Snap` | `… (Snap) Snap :` | — |
| `P5-02-r3-wp-click`（块没落下，见下） | **用户路**：真点 pad 的 Working Plane 按钮（物理 620,245），没定义工作平面 | — | 弹 **Warning `No working plane has been defined.`**（`edgposcntrl` 672–685 GADGET 重载：`workPlane.unset()` → 按钮 `val = false` 弹回 + `!!alert.warning`，`activePlane` 不动） | `e3d-prompt-P5-02-r3-wp-click-warning.png`、`…-zoom.png` |
| `P5-02-r3-wp-click-after` | 点掉 OK | `… (Snap) Snap`（`activePlane` FALSE、pad `wp=FALSE`） | `… (Snap) Snap :` | — |
| `P5-r3-closed` / `P5-r3-final` | `gphMeasure.close()` + hide | `Navigate` | `Navigate :` | — |

**结论**：(1) ` Snap` 尾巴 = Significant Snaps，关掉只去尾巴，`(Snap)` 类型 token 留着；(2) ` WP` 在用户路上**要先有工作平面**——pad 按钮在没平面时只弹 `No working plane has been defined.` 并弹回，尾巴不出；程序直写 `activePlane(TRUE)` 才在没平面时出 ` WP`；(3) 三条尾巴的字面与顺序照源码：`… (Snap) WP  Offset Snap`（`prompt()` 里 WP 后两个空格，视口收成一个）；(4) D4（Web 不做 WP / Offset）不变——Web 的 ` Snap` 开关（`pickLayer.significantSnaps`）与 E3D 同义、字面相同。

**坑**：(a) 程序里给 pad 的 toggle 按钮赋 `!!edgNewPositioning.wp.val = TRUE` **会触发它的回调**，走的就是上面那条 GADGET 重载——弹两张 `No working plane has been defined.`（置 TRUE 一张、`val = false` 弹回再一张），而且模态框把投进去的整条命令序列卡住，OK 之后才继续跑（所以 `P5-02-r3-wp-on` 有 10:57:55 / 11:01:09 两块，第二块是被卡住的那半截醒过来又置了一次 TRUE）；切 WP 只调 `activePlane(BOOLEAN)`。(b) 模态 Warning 期间再投的命令有的会丢（`P5-02-r3-wp-click` 那块没落下），点掉 OK 后要重采一次。(c) 点 OK 的物理坐标 (1280,724) 与 3D 视口重叠——对话框不在时那一下会变成一次定位拾取，点前先 `EnumWindows` 确认有 `Warning` 窗口。(d) 顺手拿到两条 §6 之外的告警原文：`No working plane has been defined.`（`!!alert.warning`）与 PML 错误框 `(2,751)   Variable !!EDGSETTINGS does not exist`。

### 40.8 11:3x 过滤器八串（`P4-*`，Measure distance 第 1 步上真点 pad 的八颗过滤器按钮，带截图）

**路子**：全走用户路——pad（`edgnewpositioning.pmlfrm` 39–46）八颗 toggle 按钮的回调都是 `!this.pick(n)`（n = 1 Any / 2 Element / 3 Aid / 4 Pline / 5 Ppoint / 6 Screen / 7 Graphics / 8 External，External 的 tooltip 是 `Point Cloud Data`），`.pick(REAL)`（172–177）先 `setPickGadgets`（193–201：`pickTable[1..8].val = (i eq n)`，**每次只亮一颗**；再把五颗拾取类型按钮 `active = not n inset(5,6)`）再 `!!edgPosCntrl.setPick(n)`（`edgposcntrl.pmlobj` 1390–1406：`pickIndex = n`、`newPick = picks[n]`、**`newPick.prompt = this.pick.prompt`**（token 词照旧带过去）、`pickType.pick = pick`、`!!edgCntrl.state.setPick(pick)`），`edgstate.setPick(EDGPICK)`（297–305）只换 `pick` 再 `pick.applyToViews(this.prompt())`——`prompt()`（318–365）三段里没有 `pick.description`，所以字串重算一遍还是原样。pad 布局两行四列：上排 Element / Ppoint / Pline / Graphics，下排 Aid / Screen / External / Any。点击用 `input.ps1`（物理坐标，与 §40.7 点 WP 按钮同一路子），每点一颗 `Shot` + `Capture`。trace `P4-*` 十二块（八颗 + 基线 + 接手核对 + 收尾两块），无 err 文件。

| tag | 操作 | `posCntrl.pickIndex` / `state.pick.description` | pad 亮灯（`padForm.toggles` 里唯一 TRUE 的过滤器） | `prompt()` / 视口气泡 | 截图 |
| --- | --- | --- | --- | --- | --- |
| `P4-00-r3-s1` | `measure('DISTANCE')`，缺省 | 1 / Any | any | `Measure distance start (Snap) Snap` / `… (Snap) Snap :` | `e3d-prompt-P4-00-r3-any.png` |
| `P4-02-r3-element` | 点 Element | 2 / Element | element | 同上，字字不变 | `e3d-prompt-P4-02-r3-element.png`、`…-zoom.png`、`…-pad.png` |
| `P4-03-r3-aid` | 点 Aid | 3 / Aid | aid | 同上 | `e3d-prompt-P4-03-r3-aid.png`、`…-zoom.png`、`…-pad.png` |
| `P4-04-r3-pline` | 点 Pline | 4 / Pline | pline | 同上 | `e3d-prompt-P4-04-r3-pline.png`、`…-zoom.png`、`…-pad.png` |
| `P4-05-r3-ppoint` | 点 Ppoint | 5 / Ppoint | ppoint（拾取类型五颗置灰） | 同上（`(Snap) Snap` 仍在） | `e3d-prompt-P4-05-r3-ppoint.png`、`…-zoom.png`、`…-pad.png` |
| `P4-06-r3-screen` | 点 Screen | 6 / Screen | screen（拾取类型五颗置灰） | 同上 | `e3d-prompt-P4-06-r3-screen.png`、`…-zoom.png`、`…-pad.png` |
| `P4-07-r3-graphics` | 点 Graphics | 7 / Graphics | graphics | 同上 | `e3d-prompt-P4-07-r3-graphics.png`、`…-zoom.png`、`…-pad.png` |
| `P4-08-r3-external` | 点 External（Point Cloud Data） | 8 / External | external | 同上 | `e3d-prompt-P4-08-r3-external.png`、`…-zoom.png`、`…-pad.png` |
| `P4-01-r3-any` | 点 Any（回缺省） | 1 / Any | any | 同上 | `e3d-prompt-P4-01-r3-any.png`、`…-zoom.png`、`…-pad.png` |
| `P4-r3-check` | 15:37 接手会话核对——E3D 在 Measure distance 第 1 步里停了近四小时没人碰 | 1 / Any | any | 同上 | — |
| `P4-r3-closed` / `P4-r3-final` | `gphMeasure.close()` + hide | 1 / Any（`active=FALSE`） | pad 隐藏 | `Navigate` / `Navigate :`，stack 0 | — |

每块里 `state.pickType.description=Snap`、`state.pickType.prompt=start`、`state.pick.prompt=Snap`、`posCntrl.pickTypeIndex=1`、`edgCntrl.stack.size=1` 都没动；`-zoom.png` 是 pad + 提示气泡同一条横带，`-pad.png` 是 pad 放大两倍（亮的那颗黄底）。

**结论**：(1) **过滤器不进提示**——八串 `prompt()` 与视口气泡逐字相同，矩阵 §4 的静态预期成立，§4 结；(2) pad 亮灯与 `pickIndex` / `state.pick.description` 一一对应，每次只亮一颗（`setPickGadgets` 195–197），与 Web 浮条过滤器组的单选一致；(3) Web `MEASUREMENT_PICK_FILTER_IDS` 同序同名（ADR 0060），Web 提示里唯一的过滤器痕迹仍只有 D3 那段 Web 加的目标段。

**顺手观察**：(a) Ppoint / Screen 过滤器下 pad 把五颗拾取类型按钮 `active=FALSE`（`edgnewpositioning.pmlfrm` 199–201：截图里 Midpoint / Intersect / Cursor 明显变灰，Snap 因 `val` 仍 TRUE 还带黄底），提示里的 `(Snap) Snap` 不变、`pickTypeIndex` 仍 1；Web 浮条原来没这条联动（`MeasurementOverlayBar.vue` 拾取类型按钮的 `disabled` 只看静态 `MEASUREMENT_PICK_TYPE_AVAILABILITY`）——不进提示，属 pad UI 差异；~~没立 D 项，要不要跟由用户定~~ **用户 15:5x 拍板立 D8、Web 跟上（`82411f9`，决策 `d-379`，矩阵 §7 D8 行）**：`pickLayerModel.measurementPickTypeSelectable(filter)`（ppoint / screen → false），浮条拾取类型按钮 `disabled` + `title` 原因 + `setPickType` 拦截，标题旁一句「<过滤器> 下不起作用（E3D 同）」，当前类型仍 `aria-checked`（E3D Snap 仍亮）；store / normalize / 提示 token / 落库不动。(b) pad 输入框一直显示 `3`——是 §40.3 D2 那轮留下的 `pickTypesValue[4]`，与过滤器无关。(c) 收尾时 E3D 回 `Navigate`、stack 0、pad 隐藏、缺省 Any / Snap / `intermediate` TRUE / `activePlane` FALSE / `offsetType` NONE 都在，无 Warning；主窗口 15:4x 由 cua-driver `bring_to_front` 拉回前台（`input.ps1` 的 `SetForegroundWindow` 仍被前台锁挡）。

**Web 实机走查（D8 改后 `82411f9`，16:0x；dev `:3111` + gen-model `:8023`，`?model_source=gen-model-v1&gm_backend_port=8023&show_refno=24381_145018`，Playwright headless Chrome 1600×900，真 UI 真点击、无 mock，临时脚本放仓外跑完即删）**：`__xeokitMeasurementTools.activate('xeokit_measure_distance')` → 开设置弹层 → 先点 Mid-Point（让「类型保持不变」看得见）→ 依次点过滤器 Ppoint / Screen / Any，每步读七颗拾取类型按钮的 `disabled`、摘要、那句提示与 `statusText`（`-records.json`，`pageerror` 0）：

| 步 | 过滤器 | 七颗拾取类型 | 摘要 | 提示 / 状态条 | 截图 |
| --- | --- | --- | --- | --- | --- |
| 00 / 00b | Any，点 Mid-Point | 全可用 | `Any · Snap` → `Any · Mid-Point` | `距离测量 · 第 1/2 步 选择起点 (Mid-Point) Snap : 等待捕捉（P-Point / Item 原点 / 管身轴线（TUBING） / 设计点（DPOINT））` | — |
| 01 | **Ppoint** | **七颗全 `disabled`**，Mid-Point 仍 `aria-checked`；标题旁 `Ppoint 下不起作用（E3D 同）` | `Ppoint · Mid-Point`（类型没动） | `… (Mid-Point) Snap : 等待捕捉（P-Point / 设计点（DPOINT））`——token 照旧，与 E3D `(Snap) Snap` 不变同口径 | `web-prompt-matrix-d8-pick-type-inert-live-01-ppoint.png`（弹层 + 提示条 + 视口同框）、`…-01-ppoint-pick-layer.png` |
| 01b | Ppoint，强点 Snap | 不生效 | 仍 `Ppoint · Mid-Point` | 不变 | — |
| 02 | **Screen** | 七颗全 `disabled`；`Screen 下不起作用（E3D 同）` | `Screen · Mid-Point` | 状态条是既有的 `测量模式：未启用任何测量点源捕捉`（E3D 捕捉模式下表面点源关着、Screen 只放行表面点——与 D8 无关，开「模型表面点」即回提示） | `…-02-screen.png`、`…-02-screen-pick-layer.png` |
| 03 / 03b | Any，再点 Snap | 整排复活，Snap 点得动 | `Any · Mid-Point` → `Any · Snap` | 回 00 那条 | `…-03-any-restored-pick-layer.png` |

与 E3D §40.8 的 `P4-05-r3-ppoint` / `P4-06-r3-screen`（`-pad.png`）并排看：两边都是「只亮一颗过滤器 + 整排类型置灰 + 当前类型仍标着 + 提示不变」。**D8 结**。
