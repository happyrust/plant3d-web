# 测量功能 vs AVEVA E3D 差距评审 · 2026-07-28

来源：本地代码审读 + Oracle（GPT-5.5 Pro）第二模型评审。
Oracle 会话：`e3d-measure-gap-review-r2`，对话 https://chatgpt.com/c/6a68290b-9478-83ec-b02e-6664d6462d27 ，完整转录见 `C:\Users\dpc\.oracle\sessions\e3d-measure-gap-review-r2\artifacts\transcript.md`。
下一轮：r3 评审（连续测量/模式契约落地后的复审）见 `2026-07-28-e3d-measurement-gap-review-r3.md`。

## 0. 结论

当前实现已解决最难的底层问题（P-Point 数据接入、pending 防误捕捉、距离优先候选解析、语义化提示、Snap Filter 基础模型），Oracle 评估操作相似度约 70%。剩余差距集中在**工作流层**而非渲染层：连续测量、模式契约、右键菜单、结果展示语义。完成下述 P0/P1 后预计可达约 90%。

对照 2026-07-10 开发计划的完成度：

| 阶段 | 状态 |
| --- | --- |
| Phase 1 E3D 捕捉模式契约 | 部分完成：默认值已对齐，`measurementPickMode` 字段未做 |
| Phase 2 P-Point pending 防误捕捉 | 已完成 |
| Phase 3 捕捉提示语义化 | 已完成 |
| Phase 4 候选点范围扩展（邻近缓存 P-Point） | 已完成 |
| Phase 5 测量右键菜单 | 未做 |
| Phase 6 连续距离测量 | 未做 |
| Phase 7 教程更新 | 已完成 |

## 1. P0 —— 严重破坏 E3D 心智

### P0-1 完成一条距离后不能连续测量

- E3D：Measure Distance 是持续命令，A-B 完成后立即可测下一条（含 B 作为新起点连续链测）。
- 当前：`useXeokitMeasurementTools.ts` 的 `onCanvasPointerUp`（约 1808 行）完成距离后 `clearCurrentXeokitDraft()` + `clearMeasurementVisualAssists()`，必须重新点起点；这是 E3D 老用户的第一感知差异。
- 改法（对应计划 Phase 6）：新增 `continuousDistanceMeasureEnabled`；完成 A-B 后自动创建新 draft（origin=B）；空格/右键 Repeat 复用同一逻辑。涉及 `useXeokitMeasurementTools.ts`、`useToolStore.ts`、`MeasurementOverlayBar.vue`。

### P0-2 缺少 `measurementPickMode: 'e3d' | 'free_surface'` 模式契约

- E3D：设计点捕捉 vs 自由几何测量是两种明确模式。
- 当前：仅靠 ptset/position/mesh 三个 snap 开关的默认值近似，用户无法一眼知道当前处于哪种模式；P-Point pending 保护（P0-3）也只挂在运行时开关上，未来加自由测量能力时容易回归。
- 改法（计划 Phase 1 收尾）：在 `useXeokitMeasurementStyleStore.ts` 增加模式字段并驱动三个 snap 默认值；浮动条显示当前模式；pending 拦截绑定 `mode==='e3d'`。

## 2. P1 —— 明显不一致

### P1-1 测量右键菜单缺失（计划 Phase 5）

E3D 完成测量后右键尺寸图形：Display Axis / Change Unit / Copy Distance / Copy XYZ / Delete / Repeat。当前完全没有。建议新增最小 `MeasurementContextMenu.vue`，actions 调现有 `updateStyle()` / `unitSettings` / `removeMeasurement()` 等能力。

### P1-2 Repeat 操作缺失

E3D 高频操作。与 P0-1 同一批实现（右键 Repeat Measure 或空格）。

### P1-3 距离结果默认不显示轴向分量

- E3D：距离结果常显 Distance + E/N/U 分量（+方向）。
- 当前：`distanceShowAxisBreakdown` 默认 false；标签语义是 ΔX/ΔY/ΔZ 而非 E3D 用户读的 E/N/U。
- 改法：默认改 true（注意存储迁移，见 §5）；标签按工程坐标语义显示 E/N/U（映射关系需按项目坐标系确认）。改动集中在 `useXeokitMeasurementStyleStore.ts` 与格式化工具。

### P1-4 「实例原点」命名不符合 E3D 语言

- E3D 用户心智是 Element/Item Origin。UI 文案建议改为「Item Origin（元素原点）」，代码内部保持 `position`。
- 注意：该点取自实例变换原点，与 E3D Element origin 是否始终一致取决于导出管线，需实机对比验证（见 §6）。
- 涉及 `useMeasurementPickSources.ts` 的 `MEASUREMENT_PICK_SOURCE_LABELS`、教程、面板描述文案。

### P1-5 浮动条与面板双重控制易混淆

浮动条（只控 snap）与面板（show/snap/threshold 全量）并存，用户容易分不清「显示」和「捕捉」。建议浮动条明确标题为「捕捉过滤 Snap」，面板把 threshold/priority 收进「高级」折叠；不向普通用户暴露 priority（E3D 用户不调优先级）。涉及 `MeasurementOverlayBar.vue`、`MeasurementPanel.vue`。

### P1-6 不能直接点选场景中的尺寸图形

E3D 主要直接操作图形（点选、右键）；当前选中测量主要靠右侧列表。建议尺寸线/标签可点击选中（设置 `activeXeokitMeasurementId`），与右键菜单一起做。

### P1-7 默认显示单位为 m，E3D 工程默认通常是 mm

当前全局默认 `displayUnit: 'm'`（2 位小数），E3D 用户预期 1520mm 而非 1.52m。建议默认值按项目单位（或 mm）评估，并保留右键 Change Unit（P1-1 菜单项）作单条切换入口。

## 3. P2 —— 锦上添花

- Quick Measure：快捷键（如 Q）直接进入距离测量，少配置少点击（E3D 3.1 心智）。
- `模型表面点` 提示文案可再贴近 E3D 用语（Graphics（近似））；`基本体关键点` 可考虑 Geometry Feature Point。
- Pline（线特征）捕捉与 Feature 修饰点（Midpoint/Intersect/Fraction）：E3D 点定义体系的一部分，当前完全没有；受导出数据可用性限制，建议列入远期评估，不阻塞本期。

## 4. 反模式检查（Oracle 结论 + 代码确认）

1. 「实例原点」命名应改（见 P1-4）。
2. priority/thresholdPx 不应直接暴露给普通用户（收进高级折叠）。
3. mesh_pick_point 当前「默认显示、默认不可 snap」的处理是**正确**的，保持；不要把它升级成普通点源。
4. 「点空白取消」保留行为但改提示文案为「取消当前点选」，语义是取消当前输入阶段、不是退出命令（当前 Esc 两段式已符合该心智）。

## 5. 实施注意

- **localStorage 迁移**：改默认值（如 `distanceShowAxisBreakdown`、单位、点源默认）对已有 V5 存储的老用户不生效，必须 bump `STORAGE_KEY_V6` 并写迁移逻辑（`useXeokitMeasurementStyleStore.ts`），这与 2026-07-10 计划 §7 的风险一致。
- 右键菜单需与 viewer 现有 annotation 选择逻辑配合，避免吞掉 contextmenu 后没有选中测量。
- 连续测量先只做 distance，不牵连 angle/elevation 草稿逻辑。

## 6. 需要 E3D 实机验证的假设（Oracle 风险清单）

1. E3D 2.1 vs 3.1：Measure Distance 完成后是否自动进入下一条（连续行为的确切形态）。
2. Quick Measure（3.1）默认启用哪些点源（nearest point / P-point / graphics）。
3. Position 结果显示 E/N/U 还是 X/Y/Z（随项目配置可能不同）。
4. 捕捉优先顺序 E3D 是否为 P-point > element > graphics（当前实现为 ptset > position > mesh，距离优先 + 4px 内按 priority）。
5. 实例变换原点与 E3D Element origin 是否始终一致（导出管线语义）。

## 7. 建议落地顺序

1. ~~连续距离测量 + Repeat（P0-1/P1-2，低成本最高收益）~~ **已完成（2026-07-28）**：
   - `useToolStore.ts` 新增 `continuousDistanceMeasureEnabled`；
   - `useXeokitMeasurementTools.ts` 完成距离后按开关自动以终点为起点创建下一段草稿，新增 `repeatLastDistanceMeasurement()`；
   - `MeasurementOverlayBar.vue` 距离模式显示「连续测量」开关；
   - `ViewerPanel.vue` 空格键触发 Repeat（距离模式、无草稿时）；
   - 教程已更新；vitest（41 用例）与 type-check 通过。
2. `measurementPickMode` 契约 + pending 绑定（P0-2/P0-3，低成本）
3. 测量右键菜单 + 尺寸图形直接点选（P1-1/P1-6，中成本；右键菜单中的 Repeat 菜单项复用 `repeatLastDistanceMeasurement()`）
4. 低成本批量改：Item Origin 文案、E/N/U 默认显示与标签语义、pending/空白点击文案、浮动条标题（P1-3/P1-4/P1-5 文案部分 + §4）
5. 单位默认值决策（P1-7，需产品确认）+ 存储 V6 迁移
6. P2 项按需排期
