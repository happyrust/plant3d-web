# 测量功能 vs AVEVA E3D 差距评审 r3 · 2026-07-28

来源：本地代码复核 + Oracle（GPT-5.5 Pro）第二模型评审（第 3 轮）。
Oracle 会话：`e3d-measure-gap-review-r3`，对话 https://chatgpt.com/c/6a6847c8-0868-83ec-851a-bd77cd4737fe ，完整转录见 `C:\Users\dpc\.oracle\sessions\e3d-measure-gap-review-r3\artifacts\transcript.md`。
上一轮：`2026-07-28-e3d-measurement-gap-review.md`（r2，相似度约 70%）。

## 0. 结论

r2 后落地的三项改动（连续距离测量、Repeat、`measurementPickMode` 契约）方向正确，Oracle 评估整体相似度升至约 **75-80%**。当前最大差距不在捕捉层，而是**完成测量后的工作流**：右键菜单 + 尺寸图形直接点选（「完成后操作」模块仅 30%）。新代码发现 1 个 P1 语义问题（Repeat 取点）与 2 个模式契约 UX 问题，其余为 P2。

模块相似度（Oracle r3 评分）：

| 模块 | E3D 相似度 |
| --- | ---: |
| P-Point 捕捉 | 85% |
| 连续距离 | 80% |
| Repeat | 65% |
| 结果管理 | 60% |
| 完成后操作 | 30% |
| 整体 | 约 75-80% |

## 1. 新代码审查（Oracle 发现 + 本地复核结论）

| # | 发现 | 位置 | Oracle 等级 | 本地复核 |
| - | --- | --- | --- | --- |
| 1 | Repeat 取「createdAt 最新」而非 active 优先：用户在列表选中旧测量后按空格，会从**最新**一条的终点续测，违背 E3D「重复上一命令」心智 | `useXeokitMeasurementTools.ts` `repeatLastDistanceMeasurement()`（约 825-836 行） | P1 | **确认**。`activeXeokitMeasurementId` 在 add/列表点击时均会设置，改为 active 优先 + createdAt 兜底成本极低 |
| 2 | 切回 e3d 模式强制 `ptset/position.snap=true`，覆盖用户手动配置且无法恢复 | `useXeokitMeasurementStyleStore.ts` `setMeasurementPickMode()`（214-224 行） | P1 | **确认**（属设计取舍）。建议记住用户上次 e3d 下的 snap 偏好，或仅首次进入时应用默认 |
| 3 | free_surface 下关掉表面点捕捉 → **静默**回落 e3d 模式，属隐式状态变更 | `useXeokitMeasurementStyleStore.ts` `updateStyle()`（202-208 行） | P1 | **确认**。注意回落只改模式字段、不重放 e3d snap 契约，但 pending 拦截随之激活、浮动条按钮自己跳变。建议允许 free_surface+mesh.snap=false 共存或给出提示 |
| 4 | e3d 模式下 ptset empty/error 且 mesh.snap=false 时点击「落不了点」死区 | `useXeokitMeasurementTools.ts` `pickSurfacePoint()`（1056-1094 行） | P1 | **部分成立**。并非静默：`buildMissReason()→ptsetMissReason()` 会把「当前构件没有可用 ptset」等原因写入 `pickPointMessage`；不落点本身符合 e3d 设计点心智。待实机确认提示可见性，必要时增强（如 toast） |
| 5 | 连续草稿 `approximate` 固定 true 污染语义 | `startDistanceDraftFrom()`（811-822 行） | P1 | **降级为 P2 / 可不改**。与既有首点草稿路径（1793-1801 行）行为一致；记录落库时 `hasApproximatePoint()` 会重算。`XeokitMeasurementPanel.vue` 把 approximate 显示为「草稿」徽标属既有语义复用，与本次改动无关 |
| 6 | 完成一条后 `clearMeasurementVisualAssists()` 再重锁，P-Point 十字/X-ray 短暂闪断 | `onCanvasPointerUp` 距离分支（1838-1844 行） | P2 | **确认**，纯视觉。可引入 `clearTransientMeasurementVisualAssists()` 保留链节点状态 |
| 7 | 「点空白取消」文案应为「取消当前点选」（语义=取消当前输入阶段，非退出命令） | `statusText`（886-905 行） | P2 | **确认**，r2 §4 已有同样结论 |

## 2. 剩余差距优先级（r3 重排）

1. **右键菜单 + 尺寸图形直接点选**（P0 体验补齐）——两者共享 measurement selection 基础设施，一批做；Repeat 语义修正（#1）合并进来（菜单项 Repeat 需要 active 优先）。
2. **结果语义批量项**：E/N/U 轴向分量默认显示、Item Origin 文案、measurement style store **V6 迁移**。注意：`useToolStore` 已是 V6，但 `useXeokitMeasurementStyleStore` 仍 V5；显示单位在 `useUnitSettingsStore` 有独立存储，需各自迁移。
3. **mm 默认单位**（需产品确认）。
4. 模式契约 UX（#2/#3）与 P2 项（#6/#7）随批。

## 3. 右键菜单规格（Oracle 建议，可直接实现)

菜单项（右键尺寸 label）：

```
✓ Display Axis          → updateStyle({ distanceShowAxisBreakdown })，全局开关（E3D 语义为显示控制，非单条属性；单条 override 以后再说）
Change Unit  > mm/cm/m  → useUnitSettingsStore.setDisplayUnit()，第一版就是全局，菜单文案明示「设置显示单位」，不伪装成单条
Copy Distance           → 新增 copyMeasurementDistance(id)，输出如「1520 mm」
Copy XYZ Components     → 新增 copy helper，输出当前显示单位/精度的 X/Y/Z 分量
Repeat Measure          → repeatLastDistanceMeasurement()（先修 active 优先）
Locate Measurement      → flyToMeasurement(id)
Delete                  → removeMeasurement(id)
```

接入点：**不绑 canvas contextmenu**（避免抢模型右键/相机操作）。测量 label 是 DOM overlay，直接在 label 上 `@contextmenu.prevent` → 设 `activeXeokitMeasurementId` → 打开菜单。新增 `src/components/tools/MeasurementContextMenu.vue`；annotation 渲染处补 `data-measurement-id`。线段右键（three raycast）作第二阶段。

## 4. 尺寸图形直接点选设计

- Path 1（第一阶段）：label DOM 点击选中，无 raycast、成本低。
- Path 2（第二阶段）：线段几何挂 `userData.measurementId`，raycast 命中 → 选中。
- 选中反馈三件套：label 高亮（border-primary）、场景线材质高亮、端点 marker 放大。
- 事件优先级：尺寸图形 > 测量落点 > 模型拾取；pointerdown 先 `pickMeasurementAnnotation()`，命中则 stopPropagation，不进入 `pickSurfacePoint()`。

## 5. 需要 E3D 实机验证的假设（r3 版）

1. 连续测量在 E3D 2.x / 3.x 是否都是「A-B 完成立即 B-C」。
2. Repeat Measure 语义：重复最后**命令**，还是复制最后尺寸方向。
3. Display Axis 是全局显示控制还是单尺寸属性。
4. 距离/位置结果显示 E/N/U 还是 X/Y/Z（随项目配置）。
5. 导出管线的 instance transform origin 是否恒等于 E3D element origin。

## 6. 建议落地顺序

1. Phase A：`MeasurementContextMenu.vue` + label 点选/右键（含 Repeat active 优先修正、copy helpers）。
2. Phase B：E/N/U 默认显示与标签、Item Origin 文案、style store V6 迁移（+ 单位默认决策）。
3. Phase C：模式契约 UX 打磨（snap 偏好记忆、free_surface 回落提示）、闪断与文案 P2 项。

## 7. 架构事实修正（grilling 期间查实，替代 Oracle §3/§4 的接入点设计）

Oracle 的右键/点选设计基于「测量 label 是 DOM overlay」的过时前提。实际（`0cd884de` 场景 painter 切换后）：

- xeokit 测量经 `syncFromStore()` 以 `replaceExternalSource('xeokit-measurement', …)` 进入 **dimension 系统**（canvas 场景绘制，ADR 0048），没有 DOM label。
- `DimensionViewport.hitTest()` 命中索引已存在；`DimensionPointerController.pointerDown` 已实现「点击尺寸 → `setSelection` + 捕获阶段吃掉事件」——「尺寸图形 > 测量落点 > 模型拾取」优先级链天然成立。
- `viewport.subscribeSelection()` 存在但无订阅者：P1-6 的核心工作量只是**反向订阅**（剥 `xeokit-measurement:` 前缀回写 `activeXeokitMeasurementId`）。
- 右键菜单接入点：canvas `contextmenu` + 现有 `hitTest`（仅命中测量尺寸时拦截），非 DOM label 事件。
- 遗留风险（需修）：捕获阶段的尺寸选中/悬停会在**测量草稿进行中**抢走落点点击与 hover，需加「草稿进行中拒绝尺寸左键交互」门控。

## 8. Grilling 决策记录（2026-07-28，pchat 卡片确认；⏱=超时按推荐自动采纳）

| # | 决策点 | 结论 |
| - | --- | --- |
| 1 | 范围 | 全部 r3 路线图（用户选） |
| 2 | 点选事件策略 | 草稿进行中落点优先；闲时左键可选尺寸；右键任何时候可命中尺寸（用户选） |
| 3 | 菜单组成 | 8 项、按类型自适应：Display Axis✓ / Change Unit▸ / Copy 值 / Copy 分量 / Repeat / 定位 / 隐藏当前 / 删除；不适用项不显示 ⏱ |
| 4 | Repeat 语义 | active 测量终点优先，无 active 取 createdAt 最新 ⏱ |
| 5 | 轴向分量 | 默认开启 + 标签 E/N/U（E=ΔX, N=ΔY, U=ΔZ，待实机验证映射）；style store V6 迁移对老用户一次性强开 ⏱ |
| 6 | Item Origin | UI 文案「Item 原点」，tooltip/教程注「Item Origin（元素原点）」；内部 id 不变 ⏱ |
| 7 | 默认单位 | mm + 0 位小数，一次性迁移，可手动改回 ⏱ |
| 8 | 模式 snap 契约 | 每模式记住用户上次 snap 配置，首次进入才用默认 ⏱ |
| 9 | free_surface 回落 | 取消静默回落，允许与 mesh.snap=false 共存，浮动条提示角标 ⏱ |
| 10 | 开工 | 确认，Phase A → B → C 逐提交，每阶段 vitest + type-check ⏱ |

## 9. 实施进度

- **Phase A 已完成（2026-07-28）**：
  - `DimensionPointerController.setInteractionGate()` 草稿门控（决策 2）；
  - `handleDimensionSelectionChange()` 反向选择绑定 + `updateSelectionBinding` 不覆盖非 xeokit 选中（P1-6，附带修复既有干扰 bug）；
  - `repeatLastDistanceMeasurement()` 选中优先（决策 4，§1 表 #1）；
  - `MeasurementContextMenu.vue` + ViewerPanel canvas `contextmenu` + hitTest 接入（P1-1，决策 3）；
  - 复制工具 `buildMeasurementValueText` / `buildMeasurementComponentsText`；
  - 教程、CHANGELOG 已更新；vitest 42 例 + type-check + eslint 通过。
- Phase B / C 未开始。
