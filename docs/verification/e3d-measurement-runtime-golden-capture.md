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

- [ ] G5-01：点点、点线、点平面。
- [ ] G5-02：平行线、相交线、异面线。
- [ ] G5-03：线平面、平行平面、相交平面。
- [ ] G5-04：记录非唯一最近点对如何选择 witness。
- [ ] G5-05：确认产品 UI 中实际可达的命令入口。

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
- Shortest：G5 与有限/无限范围语义确认前 No-Go。
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
  `dtxDimensionSnapPort` 归 exact）；该徽标对所有 xeokit 记录都亮，属既有行为。
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
- **旋转 wrt 帧这一档实机没走到**：切 `DBREF 24381/177298` 时 `/api/pdms/transform/24381_177298` 回 HTTP 500（那个后端没在跑），
  帧回落 World。这一档由 golden 单测覆盖（下）。

**单测**：`compassDirection.test.ts` 15 条——G1 `W 11.7755 N 66.1215 D`、G3-02 两件 EQUI 的 `S 11.7755 W 66.1215 D` /
`S 20.416 W 12.6584 D`、G4-01 `N 78.6901 U`、G4-02 `S`、G4-03 `N 6.66615 W 78.3493 U`（trace 坐标只到 3 位小数，第一个角只锁 `6.666x`）、
G2-03 `E 45 N 35.2644 U`、G6-02 Decimal Places 2 → `W 11.78 N 66.83 D` / `W 12.90 S 32.39 D`、G8 六条方向串 round-trip、边界与 fallback；
`e3dRotatedWrt.golden.test.ts` 加三条**逐字**断言（World 与两件 EQUI 的罗盘串，去掉 E3D 的 WRT 尾巴后逐字相同）；
`xeokitMeasurementFormat.test.ts` / `MeasurementResultInspector.test.ts` 期望改写。测量相关 83 文件 / 957 用例全过；eslint 0；type-check 与 HEAD 同。

**已知偏离 / 残余**：
- E3D 标准距离表带 ` WRT <wrt>` 尾巴、Web 不带（用户拍板，`d-515`）；元素帧下 E3D 写名字（`/Copy-of-RCS151MM`）、Web 只有 refno，也是不照搬的原因之一。
- GENSEC 当 wrt 时 E3D 的 Direction 按 World，Web 的参考系模型不知道元素类型，没有特殊处理（与 §2 #2 的 GENSEC 非负投影同属未落地）。
- **证据等级**：串型 / 位数 / 尾巴规则全部来自已采 trace 与截图（G1 / G2-03 / G3-02 / G4-01～03 / G6-02 / G8），不是静态推导；
  角度窗体 Decimal Places ≠ 2 的样子仍是 `static_expectation`（G10 未采）。

