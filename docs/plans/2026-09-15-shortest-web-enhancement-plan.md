# 最短距离（Shortest）Web 增强方案——按 `gmfLine.shortest` 的代码口径做真线 / 面最短距离 + witness（一页）

> 2026-09-15 11:3x 起草，用户在测量对齐方案 §7 Q7 上追加「选 (b)：先出一页方案」。**状态：11:33 用户批准动手（§6 四问都按建议），内核 `fb0a24b` + 接线与结果卡 `a2e4971` 已落地，实机见 golden MD §34；决策 `d-619`。**
> 与 `d-616` 的关系：`d-616` 把 #10 按 E3D **实际行为**收口（两拾中点距离，Web 距离测量 × Graphics 两击已覆盖）——那条不变；本方案是 **Web 增强**，
> 批准动手时要另起一条决策 supersede `d-616` 第 2 点（「不建 shortestDistance.ts」），文案自始至终不得写成「E3D 有的」。

## 1. 它是什么、不是什么

- 是：用户拾两组几何（点 / 线 / 面），Web 给出两组之间的**真最短距离**与 **witness 点对**（画出来、进结果表）。语义照 E3D `gmfLine.shortest`（`gmfline.pmlobj` 800–908）里
  从产品入口进不去的那几段分支抄（golden MD §32 表），所以它是「E3D 代码里写了但产品里到不了的行为」的 Web 落地，不是 parity。
- 不是：不是 clearance（构件对构件的服务端 nearest-points，上一计划 D1），不是 E3D 的 Picking Control 填值助手（`d-616` 已收口），也不替代现有点点距离。

## 2. 口径（照 §32 抄，含 Web 取舍）

操作数只有三类：**点**（P-Point / DPOINT / 顶点 / 表面点 / Aid POSITION）、**线**（Graphics 边、PLINE、元素轴线、Aid LINE；一律按**无限直线**）、**面**（Graphics 面、Aid PLANE；一律按**无限平面**）。
没有圆弧（`shortest` 无 ARC 分支）。转操作数复用 Intersect / 两线夹角那条 `intersectOperandFromHit` 分型路。

| 组合 | 起点（witness 1） | 终点（witness 2） | 退化 |
| --- | --- | --- | --- |
| 点 × 点 | 点 1 | 点 2 | 重合 → 0 |
| 点 × 线 / 点 × 面 | 点 | 无限线 / 无限面上的垂足（`LINE.near` / `PLANE.near`，G4-04 运行时已证无限语义） | 点在线 / 面上 → 0 |
| 线 × 线 · 平行 | **第一条线上拾中处**（`line.intersection(pointVector)`；拾不到退线段起点） | 第二条线上的垂足 | — |
| 线 × 线 · 不平行 | 第一条线上离第二条最近的点 | 第二条线上离第一条最近的点（异面 = 公垂线两端） | 相交 → 两点重合 → 0 |
| 线 × 面 · 平行 | 线上拾中处 | 面上垂足 | — |
| 线 × 面 · 不平行 | — | — | 无限线必穿过面 → 0 |
| 面 × 面 · 平行 | **第一个面上拾中处**（Web 取舍：E3D 这一支 `posData[1].line` 未设、靠 `handle any` 退到 `plane.position` = 第一个顶点，是 bug；Web 用拾中点） | 第二个面上的垂足 | — |
| 面 × 面 · 不平行 | — | — | 0 |

- 平行判定沿用两线夹角的 `LINE_ANGLE_PARALLEL_TOLERANCE_DEG = 0.01°`（float32 网格边设计平行时相差 ~1e-5 rad；E3D `isParallel` 容差源码看不到，记 static_expectation）。
- **零长**：E3D 回 unset LINE、字段写 0。Web：**不落记录**，提示条「两项相交（或重合），最短距离为 0」并回第 1 步——与三点角 / 两线夹角的退化处理同一套（可拍板改成落一条 0 记录）。
- 结果落进**距离记录**：`origin` / `target` = 两个 witness（设计 World 米），复用现有距离结果表 `Distance / Offset X/Y/Z / Direction`（wrt 帧照旧），多一行
  `最短距离 线 × 面 · PANE 边 × SCTN 面 · 平行：起点取第一条线上拾中处`；列表摘要写「最短距离 第一项 × 第二项」；辅助图形画 witness 线（就是现有距离线）+ 两端小标记。
- 网格噪声：两端位置不吸（位置噪声 1e-9 m 无害）；Direction 走现有罗盘串。

## 3. 入口与交互

- 结果卡距离模式加一个下拉 `Distance`：`Point to Point / Shortest`（对应角度模式的 `Angle 3 Points / Angle 2 Lines`，样式仓 V10 持久化，缺省 Point to Point）。切换时丢掉进行中的草稿 / 第一项。
- `Shortest` 下两击：第一击、第二击都可以是点 / 线 / 面（按当前过滤器能拾到的）；提示条 `最短距离 · 第 1/2 步 选择第一项` / `第 2/2 步 选择第二项（第一项：PANE 边）`；Esc 第一层只放弃第一项。
- 两击都不进草稿（同两线夹角），§28「无草稿时尺寸悬停优先」照旧生效。

## 4. 改动面

- 新内核 `src/measurement/kernel/shortestDistance.ts`：`buildShortestDistance(first, second) → { ok, value: { kind, start, end, distanceM, parallel, note } | reason }`，纯函数、设计米；单测按上表 8 行 × 退化各一条（约 14 条）。
- 接线 `useXeokitMeasurementTools.ts`：`shortest` 变体的两击流程（照 `two-line` 那段的形状），落 `XeokitDistanceMeasurementRecord` + 新字段 `shortest?: { kind, firstLabel, secondLabel, parallel }`；`unifiedMeasurement` 往返。
- 结果卡 / 格式：`MeasurementResultInspector.vue` 下拉 + 一行摘要；`xeokitMeasurementFormat.ts` 摘要 / 复制值；样式仓 V10。
- 文档：golden MD 新一节（Web 实机：LOOP3 那对相距 8 mm 的平行边 → `Shortest 8.000 mm` 对照点点 593；边 × 面平行 8 mm；点 × 面；线 × 线异面），方案 §2 加一行「Web 增强」（不计入 parity 表），CONTEXT 新词条「最短距离」。
- 估工：内核 0.5 d、接线 1 d、UI + 格式 0.5 d、单测 + 实机 + 文档 0.5 d ≈ 2.5 d。

## 5. 验收

- 单测全过；`src/measurement` + 测量相关 6 文件 vitest 全过；eslint 0；type-check 新增 0。
- 实机（无 mock）：上面四组 + 一组零长拒收，独立期望从网格直接算（同 §30 / §33 的做法），页面错误 0。
- 没有 E3D golden 可对（产品里进不去）——文档标 `web_enhancement`，与 `static_expectation` 区分。

## 6. 拍板结果（2026-09-15 11:33，四问都按建议，决策 `d-619`）

1. 零长（相交 / 重合）：**不落记录 + 提示**，回第 1 步——实现同此，提示条见 golden MD §34 第四组。
2. 面 × 面平行的起点：**第一个面上的拾中点**（不照 E3D `posData[1].line` 未设那支的 bug）。
3. 入口：**距离结果卡的 `Distance` 下拉**（`Point to Point` / `Shortest（Web 增强）`，样式仓沿用 V9 键多一格 `distanceMeasureVariant`，缺省两点）。
4. 决策 `d-619` 已起，supersede `d-616` 第 2 点（「不建 `shortestDistance.ts`」）；`d-616` 的 parity 结论（#10 = 两拾中点距离）不变。

## 7. 落地记录

| 提交 | 内容 |
| --- | --- |
| `fb0a24b` | 内核 `src/measurement/kernel/shortestDistance.ts` + 单测：点 / 无限线 / 无限面两两最短距离 + witness，照 §2 表。 |
| `a2e4971` | 接线与 UI：样式仓 `distanceMeasureVariant`、`useXeokitMeasurementTools` 两击流程（不进两点草稿、Esc 第一层只放弃第一项、切变体清场）、结果卡下拉 + witness 行、列表摘要 / 复制值、`unifiedMeasurement` 往返；vitest 31 文件 458 用例、eslint 0、type-check 新增 0。 |
| 本次文档提交 | golden MD §34（实机四组：线 ∥ 线 192 mm / 线 × 线异面 8 mm / 线 ∥ 面 8 mm / 零长拒收），本方案状态与拍板结果。 |

**§5 验收对照**：单测 + eslint + type-check 全过；实机四组 + 零长拒收已走（无 mock、真指针、页面错误 0），期望值独立从设计侧 pline 与原始网格算。
**没走到的**：点 × 点 / 点 × 线 / 点 × 面（要开 P-Point 源）与 面 ∥ 面——只有内核单测，记在 golden MD §34 残余里。
