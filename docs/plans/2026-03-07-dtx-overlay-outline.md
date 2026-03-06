# DTX Overlay Outline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 DTX 选中态改为“半透明填充 + 外轮廓 outline”，仅修正选中/高亮 overlay 这一路径，避免显示内部 mesh edge。

**Architecture:** 保持 `DTXOverlayHighlighter` 负责半透明填充，保持 `DTXOutlineHelper` 负责屏幕空间外轮廓；`ViewerPanel` 只调整 `DTXSelectionController` 的初始化配置，让选中态改为 `highlightMode: "both"`，同时通过 `overlayStyle.showEdges = false` 禁掉 `EdgesGeometry`。这样不改动全局工程边线与普通渲染路径，只调整选中高亮的渲染策略。

**Tech Stack:** Vue 3、TypeScript、Three.js、Vitest

---

### Task 1: 为 SelectionController 补回归测试

**Files:**
- Create: `src/utils/three/dtx/selection/DTXSelectionController.test.ts`
- Modify: `src/utils/three/dtx/selection/DTXSelectionController.ts`（如测试暴露出必要的最小修正）

**Step 1: Write the failing test**

写一个测试，验证选中控制器在 `highlightMode: "both"` 且 `overlayStyle.showEdges = false` 时：
- overlay 只创建 `sel_fill_*`
- 不创建 `sel_edge_*`
- outline helper 仍被初始化并接收到选中对象

**Step 2: Run test to verify it fails**

Run: `npm test -- src/utils/three/dtx/selection/DTXSelectionController.test.ts`

Expected: FAIL，因为当前调用方或控制器配置尚未保证该组合行为。

**Step 3: Write minimal implementation**

若测试暴露问题，则只做最小实现修正，优先修改选中高亮配置，不扩散到全局边线。

**Step 4: Run test to verify it passes**

Run: `npm test -- src/utils/three/dtx/selection/DTXSelectionController.test.ts`

Expected: PASS

### Task 2: 调整 ViewerPanel 的选中高亮策略

**Files:**
- Modify: `src/components/dock_panels/ViewerPanel.vue`

**Step 1: Write the failing test**

以 Task 1 的控制器回归测试作为红灯，必要时补充对 `ViewerPanel` 配置的定向验证。

**Step 2: Write minimal implementation**

- 选中控制器改为 `enableOutline: true` + `highlightMode: "both"`
- `overlayStyle` 增加 `showEdges: false`

**Step 3: Run focused verification**

Run: `npm test -- src/utils/three/dtx/selection/DTXOverlayHighlighter.test.ts`
Run: `npm test -- src/utils/three/dtx/selection/DTXSelectionController.test.ts`
Run: `npm run type-check`

Expected: 测试通过，类型检查通过。

### Task 3: 最终确认

**Files:**
- No file changes expected

**Step 1: Review changed defaults**

确认默认状态符合要求：
- 选中时有 fill 与 outline
- 无内部 edge

**Step 2: Final verification**

Run: `npm test -- src/utils/three/dtx/selection/DTXOverlayHighlighter.test.ts`
Run: `npm test -- src/utils/three/dtx/selection/DTXSelectionController.test.ts`
Run: `npm run type-check`

Expected: 全部通过
