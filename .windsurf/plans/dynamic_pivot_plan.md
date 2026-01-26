# 动态 Pivot（基于选中与鼠标投射点）方案

本方案在现有 `DTX + three.js OrbitControls` 的基础上，引入“Pivot 策略/状态”，使视图操作中心可随“选中对象”与“鼠标投射点（raycast hit）”动态更新，并兼顾性能与交互一致性。

## 现状梳理（当前鼠标链路）

- Viewer 初始化：`src/components/dock_panels/ViewerPanel.vue` 创建 `DtxViewer(OrbitControls)` + `DTXLayer` + `DTXSelectionController`。
- 相机交互：由 `OrbitControls` 直接监听 canvas（旋转/平移/缩放围绕 `controls.target`）。
- 选中：`ViewerPanel.vue` 在 `pointerup` 中调用 `selectionController.pick(pos)`（GPU picking）得到 `objectId`，再映射为 `refno`，并通过 `compat.scene.setObjectsSelected(...)` 高亮。
- 工具模式：`src/composables/useDtxTools.ts` 在特定 toolMode 下接管 pointer 事件；需要精确点位时用 `selectionController.pickPoint(pos)`（CPU 精确拾取，返回 `hit.point`）。
- 现有动态 pivot：`src/utils/three/dtx/DynamicPivotController.ts` 已实现“长按 300ms”触发 CPU 精确拾取，并将 `controls.target = hit.point`，同时显示图钉 Sprite。

## 目标

- **自动 pivot（选中驱动）**：用户选中模型后，视图旋转中心自动切到该对象（或多选集合）的 **AABB 中心**。
- **光标 pivot（投射点驱动）**：用户长按命中表面点后，将 pivot **锁定**到该点（`pinned`，显示图钉）；按 `Esc` 解除锁定并回到“随选中 pivot”。
- **不拖慢交互**：避免在 `pointermove` 上做 CPU 三角形级 raycast；CPU 精确拾取仅在明确手势触发时执行。

## 交互约定（已确认）

- **单击选中**：
  - 维持现有 GPU picking + 选中逻辑。
  - 默认 `mode=followSelection`：当选中集合变化时，将 pivot 更新为“选中对象/集合的 AABB 中心”（不显示图钉）。
- **长按（已存在）**：
  - 维持现有长按拾取表面点，进入 `pinned`：pivot = `hit.point`，显示图钉；`pinned` 期间忽略选中驱动 pivot 更新。
- **清除/回退**：
  - 按 `Esc` 清除 `pinned`，并切回 `followSelection`：
    - 若当前仍有选中：pivot 立即回到选中集合 AABB 中心。
    - 若无选中：pivot 回到 `DTXLayer.getBoundingBox()` 的中心。
  - 当 `followSelection` 且选中为空（如点空白清空选中）：pivot 回到 `DTXLayer.getBoundingBox()` 的中心。

> 可选增强（依赖 three 版本能力）：若 `OrbitControls.zoomToCursor` 可用，可开启“滚轮向光标缩放”，并在 wheel 时用一次拾取更新 target。

## 实现要点（文件与改动范围）

1. **扩展 `DynamicPivotController` 为“Pivot 状态机”**（核心）：
   - 状态：`mode = followSelection | pinned`。
   - 能力（最小集）：
     - `setPivot(point, { showPin })`（统一入口：更新 `controls.target` + `controls.update()`）
     - `setPivotFromAabb(aabb)`（AABB center -> pivot，`showPin=false`）
     - `pinPivotFromCursor(canvasPos)`（长按触发：`selectionController.pickPoint` -> `pinned` + `showPin=true`）
     - `clearPinnedPivot()`（`Esc`：隐藏图钉并切回 `followSelection`）

2. **在 `ViewerPanel.vue` 注入 pivot 更新点**：
   - 在单击选中成功后：
     - 计算选中集合 AABB（优先复用 `compat.scene.getAABB(refnos)`），取 AABB center。
     - 仅当 `mode=followSelection` 时更新 pivot（避免覆盖 `pinned`）。
   - 在长按命中后：
     - 进入 `pinned`；pivot = `hit.point`；显示图钉。
   - 在 `keydown(Escape)`：
     - 若 `mode=pinned`：`clearPinnedPivot()`；并立刻用“当前选中 AABB center / 无选中则 layer bbox center”重算 pivot。

3. **性能策略**：
   - 选中驱动 pivot：只用 AABB（轻量）。
   - 投射点 pivot：只在长按/快捷键触发，且尽量先 GPU pick 取得 `objectId` 后对单对象做 CPU raycast，避免 K-D tree 扫描过多候选。

4. **可观测性/调试**：
   - 在 dev 下打印 pivot 更新来源（selection/cursor/fallback）与最终 target。
   - 保留图钉 gizmo 作为可视化验证。

## 验收要点（行为）

- `followSelection` 下：选中变化后 `controls.target` 更新为选中 AABB center。
- `pinned` 下：长按设置 `controls.target = hit.point`，图钉可见；选中变化不更新 target。
- `Esc`：清除 `pinned`，回到 `followSelection`，并立即重算 target（有选中取 AABB center；无选中取 layer bbox center）。
- 选中为空且 `followSelection`：target = layer bbox center。

## 验证方式

- 使用 `?dtx_demo=primitives` 场景验证：
  - 单击选中后旋转中心是否落在选中体中心。
  - 长按后旋转中心是否稳定落在表面命中点。
- 使用真实 dbno 场景验证：
  - 多选/树选中触发 pivot 是否符合预期。
  - 大对象下长按 CPU pick 的耗时是否可接受。

## 已确认交互参数

- 默认：随选中 pivot（`followSelection`）
- 选中 pivot 取点：AABB center
- 清除锁定 pivot：`Esc`
