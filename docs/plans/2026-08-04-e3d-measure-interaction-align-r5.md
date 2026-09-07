# 测量交互 vs AVEVA E3D Measure Distance 对齐评审 r5 · 2026-08-04

来源：本地代码复核（2026-08-04，git HEAD `8c2ccaec`）+ Oracle（GPT-5.5 Pro，browser）第二模型评审（第 5 轮）。
Oracle 会话：`e3d-measure-interactio-align-r5`（附 6 个文件：r4 review + `MeasurementOverlayBar.vue` + `MeasurementContextMenu.vue` + `xeokitMeasurementFormat.ts` + `xeokitMeasurementUi.ts` + `useXeokitMeasurementStyleStore.ts`），转录见 `C:\Users\dpc\.oracle\sessions\e3d-measure-interactio-align-r5\artifacts\transcript.md`。
上一轮：`2026-08-03-e3d-measure-distance-dialog-align-r4.md`（r4，结果语义路线已定，P0 均未实施）。

本轮主题：**交互方式逐事件对齐**——用户诉求「操作起来和 E3D 里的效果保持一致」。与前几轮最大的不同：本轮用 AVEVA 官方帮助文档做了行为考证，r4 遗留三疑点解决两个。

## 0. 结论

1. **取点骨架已达标，会话语义未达标**。「第一击 → hover 预览 → 第二击 → 空白取消 → ESC 两段退出 → 空格 Repeat」与 E3D 逐事件对照基本一致；缺的是 E3D 的「Measure Session」外壳：分步命令提示、Snap 目标语义显示、临时结果态、常驻结果窗体。
2. **r4 的一个关键假设被官方文档修正**：E3D 对话框里的 Offset **不是**另一套神秘正交分解——官方帮助（DCFUG14.16.11 Measure Distance）明确 Offset/Direction 按 wrt 参考系表达，wrt=World 时 Offset 就是 **ENU 分量**（非 World 时为 UVW）。也就是说当前的 `E ±ΔX · N ±ΔY · U ±ΔZ` 在 wrt=World 前提下**语义上就是 E3D 的 Offset**，缺的是「wrt 上下文」而不是计算本身。r4 §2.2「不能用 E/N/U 冒充 Offset」的说法需要修正为「E/N/U = wrt World 下的 Offset，需要补 wrt 框架而非重算」。
3. **WT/World 控件语义考证清楚**：它是 **wrt（With Respect To）参考元素选择器**，默认 World，可输入 CE / Owner / 具名元素 / db reference，使 Offset/Direction 按该元素局部坐标系表达。不是 Working Tree、不是 World Transform。（置信度 85%，来源 TM-1801 Foundations + DCFUG）
4. **E3D 测量窗体天然常驻**：官方培训教材原文 "Once a measure distance task is performed, the form will remain active, enabling other distances to be measured"。plant3d-web 默认行为（完成 A-B 后停留在测量模式、下一击开新一对）**已经与 E3D 原生一致**；「连续测量」开关（B 自动成为下一段起点）是超出 E3D 的扩展，保留即可，不必统一改造。
5. 本轮维持 r4 的架构判断：不复制 E3D 窗口 UI，不动 ADR-0048 / measurement store / 浮动条骨架，补「工程测量语义层」。

## 1. r4 遗留三疑点考证结果（本轮最大增量）

| # | 疑点 | 结论 | 来源与置信度 |
| - | --- | --- | --- |
| 1 | 两行 `Offs.` 的基准 | Offset = 两点偏移在 **wrt 参考系**下的分量表达；wrt World → ENU 分量，非 World → UVW 分量。当前 E/N/U 分量即 wrt=World 的 Offset | [事实-有来源] AVEVA help DCFUG14.16.11（Measure Distance）；置信 90%。截图只有两行 Offs. 的确切构成（E/N 还是 平面+垂直）仍留一个实机确认点 |
| 2 | `Dire.` 表示法 | Direction = 两点连线方向，按 wrt 参考系解释；**显示格式**（方位角 / N45E / 向量）官方资料未写明 | [事实-有来源]（语义）+ [推断-需实机验证]（格式）。实现按 r4 决策：内部存 `directionVector`，显示层后定 |
| 3 | `WT/World` 控件 | wrt（With Respect To）参考元素选择器，默认 World，可输 CE/Owner/具名元素/db ref | [事实-有来源] TM-1801 AVEVA E3D Design 2.1 Foundations；置信 85% |

对 r4 结果模型的修正（`DistanceMeasurementResult`）：

```ts
interface DistanceMeasurementResult {
  distance: number;                                  // 不变
  // r4 的 axisDelta 与 offsets 合并：wrt=World 时 offsets 就是 ENU 分量
  offsets: { frame: 'world' /* | refno */; components: [number, number, number] };
  direction?: { vector: [number, number, number]; display?: string };  // display 格式待实机
  wrt: 'world';                                      // 第一阶段只有 world，UI 显示「wrt World ▼」但不可选
}
```

即：**P1 的「Offset 计算」风险从高降为低**（wrt=World 下就是现有 ΔX/ΔY/ΔZ）；真正的 P1 难点只剩「非 World wrt 的 UVW 投影」（需要 owner transform，明确后置）。

## 2. E3D 交互回路逐事件对照（A 节）

E3D 官方命令行提示原文（TM-1801）：第一阶段 `Measure distance start (Distance[0]) Snap:`，取到起点后 `Measure distance end (Snap):`，hover 显示被吸附元素的类型/名称（如 `Snap :VALVE`）。

| 事件环节 | E3D 行为 | plant3d-web 现状 | 判定 |
| --- | --- | --- | --- |
| 命令激活 | Home → Measure → Distance，出窗体 + 命令行提示 | 工具栏进入测量模式，出浮动条 | 一致 |
| 分步提示 | 命令行显示阶段（start/end）+ 当前 Snap 目标 | 浮动条只有「距离 · 捕捉终点」，无步骤序号 | **缺失** |
| Snap 悬停反馈 | `Snap :VALVE`（元素类型/名称） | lens 有 `P-Point #n` 等点源名；面板提示是 `当前命中：o:<refno>:<idx>`（内部 id） | **不一致** |
| 第一击 | 锁定起点，提示切到 end 阶段 | 锁定起点（十字/X-ray），hover 预览 | 一致 |
| 第二击 | 计算并**刷新常驻窗体**（Dist/Offs/Dire），不自动落标注 | 立即生成持久记录 + canvas dimension，无临时态 | **不一致（本轮核心）** |
| 结果窗体 | 常驻、每次测量刷新、含 Units/wrt/Options | 无（只有右侧列表面板 + 右键菜单） | **缺失** |
| 测完一对后 | 窗体保持 active，直接测下一对（fresh pair） | 默认停留模式、下一击开新对 | **一致**（已对齐） |
| 链式续测 | 无原生「B 变起点」；重复靠再点两点 | 空格 Repeat（active 终点续测）+ 连续测量开关 | 扩展（保留） |
| 结束命令 | 关窗体结束；ESC/右键层级公开资料无 | ESC 两段（草稿→退出）、点空白取消当前点选 | [推断-需实机验证]，现状合理保留 |

## 3. 交互状态机对齐规格（C 节，可直接开发）

状态机（只动 distance 主路径；angle/elevation 仅顺带统一文案）：

```
S0 Idle（非测量模式）
S1 PickStart   命令条：「测量距离 · 第 1/2 步 选择起点 · Snap: <目标>」
S2 PickEnd     命令条：「测量距离 · 第 2/2 步 选择终点 · Snap: <目标>」（hover 时 Inspector 实时预览距离）
S3 Result      第二击 → 生成 MeasurementDraftResult（临时结果，不落标注）→ Inspector 显示明细
S4 Committed   persistDimension=true（或用户点「落地标注」）→ 走现有 replaceExternalSource → canvas dimension
S3 → S1        窗体常驻，直接开始下一对（E3D 原生）；空格 Repeat / 连续测量为扩展链路
```

Snap 目标名数据路径（优先级从高到低）：

```
sourceInfo.label（P-Point #n / Item 原点 …）
→ 元素类型 noun：按 refno 查 model-tree/DTX objectType（新增小工具函数，带缓存）
→ formatPdmsRef(refno) 兜底（不再裸显 o:<refno>:<idx>）
```

ESC / 空白 / 右键语义分层表（维持现状 + 补充）：

| 输入 | 草稿进行中 | 有临时结果（S3） | 空闲（S1） |
| --- | --- | --- | --- |
| ESC | 取消草稿回 S1 | 丢弃临时结果回 S1 | 退出测量模式 |
| 点空白 | 取消当前点选阶段 | 保留结果，不动 | 不动 |
| 右键尺寸图形 | 门控拒绝 | 上下文菜单 | 上下文菜单 |
| 空格 | 忽略 | Repeat（以结果终点为起点） | Repeat（active 优先） |

文件改动映射（含改动量级/风险）：

| 改动 | 文件 | 量级 | 风险 |
| --- | --- | --- | --- |
| statusText 分步文案 + Snap 目标名 | `useXeokitMeasurementTools.ts`（statusText、hover 链）、`xeokitMeasurementUi.ts` | 小 | 低 |
| 浮动条显示 Step/Snap（放宽 360px 限宽或双行） | `MeasurementOverlayBar.vue` | 小 | 低 |
| refno → noun 查询工具（带缓存） | 新增 `measurementSnapLabel.ts`（或并入 format） | 小-中 | 低 |
| 临时结果态 `MeasurementDraftResult` + `persistDimension` | `useToolStore.ts`、`useXeokitMeasurementTools.ts` onCanvasPointerUp | 中 | 中（连续测量/Repeat 起点取值需跟随临时结果） |
| Result Inspector（常驻结果面板，订阅 store） | 新增 `MeasurementResultInspector.vue`（+ dock 注册） | 中 | 低 |
| 结果模型扩展（§1 修正版） | `xeokitMeasurementFormat.ts`、`useToolStore.ts` | 中 | 低 |
| Show linear dimension 开关持久化 | `useXeokitMeasurementStyleStore.ts`（V6→V7 迁移，默认 **true** 兼容现状） | 小 | 低 |

Inspector 内容分区（第一版）：

```
距离        1520 mm            ← 主值
Offset(wrt World)  E +1200 · N -300 · U +50   ← 现有分量，换上 wrt 语境标签
Direction   —（待实机定格式，内部已存向量）
起点 → 终点  含 Snap 源标签
Units: mm ▼（测量覆盖 > 全局）   wrt: World ▼（灰，只 World）
☑ 生成线性标注（Show linear dimension）
```

## 4. 对 r4 的修正与维持

- **修正**：r4 §2.2/§3「Offset 与 E/N/U 心智不同、需并存两套」→ 官方文档证实 wrt=World 时两者同一，结果模型合并（§1），P1 Offset 计算风险高→低。
- **修正**：r4 §9 表中「Offset 计算 P1/高风险」拆为「wrt=World 标签化（并入 P0 模型扩展，零计算）」+「非 World wrt 投影（P2，依赖 owner transform）」。
- **维持**：不复制 E3D 窗口、Result Inspector 形态、persistDimension 解耦、Units 覆盖策略、Perpendicular To P2。
- **新增维持项**：默认「测完一对开新对」已与 E3D 原生一致，连续测量开关与空格 Repeat 作为扩展保留，不做 Oracle 建议的 `continueMode` 统一重构（收益不足以换动稳定逻辑）。

## 5. 更新后的路线与 P0 验收

| 优先级 | 项目 | 量级 | 风险 |
| --- | --- | --- | --- |
| P0-1 | 命令条分步提示 + Snap 目标名（§3 前三行） | 小 | 低 |
| P0-2 | 结果模型扩展（wrt 语境 + directionVector 占位） | 中 | 低 |
| P0-3 | 临时结果态 + Show linear dimension 解耦 | 中 | 中 |
| P0-4 | MeasurementResultInspector 常驻面板 | 中 | 低 |
| P1 | Units 测量覆盖（Inspector 内） | 中 | 中 |
| P1 | Direction 显示格式（先实机验证） | 小 | 低 |
| P2 | 非 World wrt（UVW 投影，owner transform） | 大 | 高 |
| P2 | Perpendicular To | 大 | 高 |

P0 vitest 验收点：

1. snap label formatter：`{label:'100-A', noun:'VALVE'}` → `Snap: VALVE 100-A`；无 noun 时回落 `formatPdmsRef`。
2. statusText：S1/S2 分别含「第 1/2 步」「第 2/2 步」。
3. 第二击后：draftResult 存在且 dimension 记录数不变（persistDimension=false 时）；=true 时生成 dimension。
4. Repeat/连续测量：临时结果态下空格以 draftResult.target 为起点。
5. style store V7 迁移：老配置升级后 persistDimension 默认 true。

人工验收（AvevaMarineSample，BRAN `24381_145018`）：激活距离测量 → hover 阀件见「第 1/2 步 · Snap: VALVE …」→ 第一击后见「第 2/2 步」→ 第二击 Inspector 出 距离/Offset(wrt World)/起终点 → 关 Show linear dimension 重测：只有结果无尺寸线 → 开回：canvas dimension 正常 → ESC 两段行为不回归。

## 6. 仍需 E3D 实机验证（下轮输入）

1. 对话框两行 `Offs.` 的确切构成（E/N 两行？还是平面投影+垂直？）——用 P1=(0,0,0)、P2=(1000,500,200) 实测记录。
2. `Dire.` 显示格式（方位角 / N45E / 向量）。
3. ESC / 右键 / Cancel 在「测量中 / 已完成一组 / 窗体关闭」三种时点的精确层级。
4. 非 World wrt 下 Offset UVW 的符号约定（选转过角度的 VALVE 做 wrt 对照）。

引用：

- AVEVA help：Measure Distance（DCFUG14.16.11）、Positioning Control（DCFUG07.08.03），help.aveva.com AVEVA_E3D_Design 2.1。
- TM-1801 AVEVA E3D Design 2.1 Foundations Rev 4.0（命令行提示原文、窗体常驻行为、wrt 输入形式）。
