# 测量交互 vs AVEVA E3D Measure Distance 对齐评审 r4 · 2026-08-03

来源：本地代码复核 + Oracle（GPT-5.5 Pro，browser）第二模型评审（第 4 轮）+ 用户提供的 E3D Measure Distance 实机截图。
Oracle 会话：`e3d-measure-distance-dialog-align`（gpt-5.5-pro / extended，附 5 个文件：E3D 截图 + r3 review + `xeokitMeasurementFormat.ts` + `MeasurementOverlayBar.vue` + `MeasurementContextMenu.vue`）。
上一轮：`2026-07-28-e3d-measurement-gap-review-r3.md`（r3，整体相似度约 75-80%，Phase A 右键菜单/反向选择已落地）。

## 0. 结论

r4 引入 E3D 实机截图后，把「整体一个相似度」拆成三层看更准确：

| 层 | E3D 相似度 | 说明 |
| --- | ---: | --- |
| 取点 / Snap / 连续测量骨架 | 80-85% | 第一击/hover/第二击、连续测量、Repeat、模式契约、反向选择均已具备 |
| 结果语义模型 | 50-60% | 当前只有 `距离 + E/N/U(=ΔX/ΔY/ΔZ)`，缺 Offset / Direction / 坐标系 |
| 测量完成后的工程表达 | 40-50% | 「测量即永久标注」、无临时结果检查器、单位/坐标系不在测量上下文内 |

一句话定性：

> E3D 的 Measure Distance 本质是一个「测量结果解释器」；plant3d-web 当前仍是「两个三维点之间的距离计算器」。

因此 r4 的重心从「怎么点两点」转移到「点完之后怎么表达这条距离」。架构无需推倒——r3 已确认连续测量、Repeat、dimension canvas（ADR-0048）、`hitTest` 选择链都在，本轮只在**结果模型层**和**交互表达层**补齐。

## 1. E3D 截图暴露的新维度（本轮新输入）

用户截图为 E3D 的 Measure Distance 命令实机，暴露此前 r2/r3 未深入的部分：

- **顶部浮动命令条**：`Measure distance start [Distance][0] Snap :VALVE...`
  - 分阶段命令提示（start → 下一点）+ **显式显示当前捕捉目标的元素类型/名称**（`Snap :VALVE`）。
- **独立 Measure Distance 对话框**：
  - `Units: Default`（单位在测量命令上下文内选择）；
  - Options：`Show linear dimension`（是否落地线性标注）、`Perpendicular To`（垂直测量）；
  - 结果表 Prop/Value：`Dist.`、`Offs.`、`Offs.`（两个 Offset）、`Dire.`（Direction）；
  - 底部 `WT / World` 坐标系选择。

## 2. 结果模型语义（Dist / Offs / Offs / Dire）

### 2.1 Dist —— 已对齐

- **E3D 语义**：两测量点真实三维距离 `sqrt(ΔX²+ΔY²+ΔZ²)`。
- **当前差距**：无。`buildMeasurementValueText()` 用 `Math.hypot(dx,dy,dz)`，正确。
- **对齐建议**：保留，作为结果第一行主值（`Distance 1520 mm`）。
- **优先级/改动/风险**：P0 / 小 / 低。

### 2.2 Offset × 2 —— 语义心智不同（本轮最需实机确认）

- **E3D 语义**：不是简单 `ΔX / ΔY`。工程惯例是「在当前测量参考坐标体系里，把距离拆成两个正交方向上的偏移量」——`Dist` 是总长度，`Offset1` 为主方向偏移、`Offset2` 为正交方向偏移，配合 `Direction` 定义方向基准。基准可能相对：工作坐标系 / 第一测量点 / 测量方向本身，**必须 E3D 实机确认**（见 §8）。
- **当前差距**：当前输出 `E ±ΔX · N ±ΔY · U ±ΔZ` 回答的是「世界坐标变化多少」；E3D 的 Offset 回答的是「工程空间里如何定位这段距离」。两者心智模型不同，不能直接用 E/N/U 冒充 Offset。
- **对齐建议**：不替换 E/N/U，**新增** Offset 字段（见 §3 结果模型）。
- **优先级/改动/风险**：P1 / 中 / **高**（基准未定前不落计算）。

### 2.3 Direction —— 需先定表示法

- **E3D 语义**：三种可能，需实机确认——(A) 方位角（如 `45°`）；(B) 象限方向（如 `N45E`/`S30W`）；(C) 三维单位向量 `(dx,dy,dz)/Dist`。
- **当前差距**：只有 E/N/U 分量，无方向表达。
- **对齐建议**：**内部统一先存方向单位向量 `directionVector:[x,y,z]`**（无歧义、可后处理），显示层再转方位角/象限/向量；不要一开始把模型绑死到「角度」。
- **优先级/改动/风险**：P1 / 中 / 高（表示法须验证）。

## 3. E/N/U 是否保留 —— 保留，并存

**结论：不替换，必须与 Offset/Direction 并存。** E/N/U 面向「世界坐标变化」，Offset/Direction 面向「工程空间定位」，两者服务不同问题。

推荐内部结果模型（扩展，不破坏现有 `XeokitMeasurementRecord`）：

```ts
interface DistanceMeasurementResult {
  distance: number;                       // 已有：hypot
  axisDelta: { E: number; N: number; U: number };   // 已有：ΔX/ΔY/ΔZ，保留
  offsets?: { primary: number; secondary: number }; // 新增：待基准确认后计算
  direction?: { vector: [number, number, number]; azimuth?: number }; // 新增
  coordinateSystem: 'world' /* | 'wt' 后续 */;       // 新增：结果解释基准
}
```

推荐显示顺序（**不要首行就是 XYZ**）：

```
1520 mm                 ← Distance 主值
Direction  N45E         ← 方向（表示法待定）
Offset     1200 / 300   ← 两个正交偏移（基准待定）
--- 展开 ---
World Components  E +1200 · N -300 · U +50   ← 现有 E/N/U，降为展开项
Start → End 点信息
```

- **优先级/改动/风险**：P0（模型扩展 + 显示顺序调整，可先只挂 distance/axisDelta/direction，offset 留空）/ 中 / 低。

## 4. Show linear dimension —— 测量与标注解耦

- **E3D 语义**：`Measure`（临时分析「我想知道距离」）与 `Linear Dimension`（工程标注「我要留下这个尺寸」）是两个概念；截图的 `Show linear dimension` 勾选项正说明二者解耦。
- **当前差距**：当前第二击立即「创建 measurement + canvas dimension 渲染」，等于 `Measure + Annotation` 强绑定。
- **对齐建议**：引入 `MeasurementSession` 的临时结果态——第二击先出**临时结果**（Result Inspector 显示 `Distance 1520`），仅当 `Show linear dimension = true`（或用户显式「保存/落地」）才走 `replaceExternalSource → dimension canvas` 生成持久标注。**不改 ADR-0048**，只在 measurement store 增加 `persistDimension: boolean`（默认可先 true 以兼容现状，产品确认后改默认）。
- **优先级/改动/风险**：P0 / 中 / 低。

## 5. Units + WT / World 坐标系

- **E3D 语义**：`Units` 与 `WT/World` 都在 Measure 命令上下文内——单位属于当前测量，坐标系决定 Offset/Direction 的解释基准。
- **当前差距**：单位仅在右键菜单切换全局 `useUnitSettingsStore`（r3 已确认独立存储）；坐标系固定 `design-world`，无 WT/World 选择，因此当前无法按选定坐标系给 Offset/Direction。
- **对齐建议**：
  - 单位：保留全局默认（Project Unit），在测量结果上下文新增 `Measurement Unit Override`，优先级「测量覆盖 > 全局」；把单位选择从右键菜单上移到结果检查器内。
  - 坐标系：第一阶段 UI 出 `Coordinate: World ▼` 但**只提供 World**（不要伪造 WT）；第二阶段再接 owner transform 实现 WT。
- **优先级/改动/风险**：Units 迁移 P1 / 中 / 中；World/WT 框架 P1 / 中 / 高。

## 6. 命令条 Snap 目标显示（Snap :VALVE）—— 最快见效

- **E3D 语义**：命令条显示「我吸附到了什么」——`Snap :VALVE`（元素类型/名称），而非内部 id。
- **当前差距**：`formatXeokitHoverHint()` 显示 `当前命中：<entityId>`，`entityId` 形如 `o:<refno>:<index>`；浮动条 `compactStatusText` 只正则抽「捕捉XXX / 等待取点」。`MeasurementPointSourceInfo` 有 `source/candidateId/refno/label`，**但没有元素类型字段**。
- **对齐建议**：
  - hover / 命令条文案改为 `距离点1 · Snap: <label>`，数据优先级 `sourceInfo.label` →（元素名）→ `formatPdmsRef(refno)`。
  - 要显示 E3D 那样的**元素类型名（VALVE/PIPE/...）**，需接入 DTX / model-tree 的 objectType 按 refno 查询（当前 sourceInfo/entityId 里没有类型），作为该项的一个明确子任务。
- **优先级/改动/风险**：P0 / 小（label 部分）· 小-中（元素类型接入）/ 低。

## 7. 是否新增「Measure Distance 对话框」—— 新增结果检查器，不复制 E3D 窗口

- **结论**：需要一个实时结果视图，但**不做传统浮动 Dialog**（Web 三维里会遮挡视图、与现有 UX 和 dimension canvas 冲突）。
- **形态**：`右侧实时结果面板（Result Inspector）+ 顶部命令条增强`。
  - 顶部：`Measure Distance · Step 2 · Snap: VALVE-100-A`；
  - 右侧新增 `MeasurementResultInspector.vue`，订阅 measurement store，实时显示 Distance / Direction / Offset / Components(E/N/U) / Units / Coordinate / ☑ Show linear dimension。
- **与现有架构结合**：`dimension canvas + measurement store + MeasurementOverlayBar + MeasurementContextMenu` 全部保留；Inspector 只是 store 的一个新订阅视图。
- **优先级/改动/风险**：P0 / 中 / 低。

## 8. 必须 E3D 实机验证（不能猜，先验证再落计算）

1. **Offset 基准**：相对工作坐标系？相对第一测量点？相对测量方向？——这是整个结果模型的核心。
2. **Direction 表达**：方位角 / 象限（N45E）/ 三维向量？
3. **WT / World 含义**：Working Tree 坐标 / World Transform / Work Plane？——不能按 UI 名字猜。

在 1/2/3 确认前，§2.2/§2.3/§5 的计算不落地，只先扩展内部模型占位（存 directionVector、留 offset 空位）。

## 9. P0 / P1 / P2 路线

| 优先级 | 项目 | 改动 | 风险 |
| --- | --- | --- | --- |
| P0 | 命令条 Snap 显示 `Snap: <label/类型>` | 小 | 低 |
| P0 | 临时测量 vs 持久 dimension 解耦（`persistDimension`） | 中 | 低 |
| P0 | 实时结果检查器 `MeasurementResultInspector.vue` | 中 | 低 |
| P0 | `DistanceMeasurementResult` 模型扩展 + 显示顺序 | 中 | 低 |
| P1 | Offset 计算（须先定基准） | 中 | 高 |
| P1 | Direction（先存向量，后转显示） | 中 | 高 |
| P1 | 单位迁移到测量上下文（override > global） | 中 | 中 |
| P1 | World/WT 坐标系框架（先只 World） | 中 | 高 |
| P2 | Perpendicular To（垂直测量，依赖 element axis/中心线数据） | 大 | 高 |

## 10. 最终架构判断

plant3d-web 当前方向不用改，演进路径：

```
现在：Pick Points → Distance → Dimension Canvas
目标：Pick Points → Measure Session → Result Interpreter
                                         ├ Distance
                                         ├ Offset
                                         ├ Direction
                                         ├ Coordinate System
                                         └ optional Dimension Canvas
```

即：**不要把 plant3d-web 做成 E3D 的界面复制品，而是补齐 E3D 的「工程测量语义层」。**

本轮收益排序：
1. Snap :VALVE（最快见效）；
2. 临时 Measure / 持久 Dimension 解耦（架构价值最高）；
3. Result Inspector（用户感知提升最大）；
4. Offset / Direction（达到 E3D 专业深度关键，须先实机验证）；
5. Perpendicular To（最后做）。

## 11. 建议落地顺序（不牵动 angle/elevation 与 ADR-0048）

1. `feat(measurement): show snap target label in overlay/command bar`（§6，P0-小）。
2. `feat(measurement): add MeasurementResultInspector with distance/direction/components`（§7 + §3 模型扩展，P0-中）。
3. `feat(measurement): decouple measure result from persistent dimension (Show linear dimension)`（§4，P0-中）。
4. `feat(measurement): move unit selection into measurement context`（§5 单位，P1）。
5. E3D 实机验证 §8 → 落地 Offset / Direction 计算与 World/WT（§2.2/§2.3/§5）。
6. Perpendicular To 远期评估（§3 表末，P2）。
