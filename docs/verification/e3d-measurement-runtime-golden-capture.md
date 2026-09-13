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
| G6-01/02/03 三点角度（0°/180°/重合拒绝、minor 角、法向随拾取顺序翻转、0.1°/179.9°） | 新增纯内核 `buildThreePointAngle`（`src/measurement/kernel/threePointAngle.ts`，尚未接入 UI） | `src/measurement/kernel/threePointAngle.test.ts` |

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
