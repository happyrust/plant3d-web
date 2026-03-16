# Cloud Annotation Anchor-Driven Creation Development Doc

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把云线批注创建流程改成“先 pick mesh 锚点，再框选关联 refno 和屏幕云线尺寸”，确保云线始终围绕锚点在屏幕空间重建，并在 camera 变化后仍稳定跟随该锚点。

**Architecture:** 保留云线“屏幕空间轮廓 + 世界锚点 + 世界引线终点”的现有渲染模型，只替换创建阶段的锚点来源。创建时新增一个临时锚点预备态：第一次点击命中 mesh 后记录锚点与锚点 refno，第二次拖框再完成 cloud record；渲染阶段继续使用 `anchorWorldPos + screenOffset + cloudSize` 每帧投影重建云线。

**Tech Stack:** Vue 3、TypeScript、Three.js、DTXSelectionController、Vitest、Playwright

---

## 1. 背景与当前问题

当前 `annotation_cloud` 的创建流程位于 `src/composables/useDtxTools.ts`：

1. `onCanvasPointerDown()` 在云线模式下直接 `beginMarquee()`
2. `endMarquee()` 收集框选到的 `selectedRefnos`
3. 以框选中心 `marqueeCenter` 调用 `resolveCloudAnchorFromMarqueeCenter()`
4. 生成 `CloudAnnotationRecord`

这条链路存在两个语义问题：

- 锚点不是用户显式 pick 的，而是由框选中心“猜测”出来
- 云线虽然后续是围绕 `anchorWorldPos` 在屏幕空间重建，但这个 anchor 本身不稳定

因此，当用户希望“某个构件上的某个点就是这个云线批注的图钉/参考中心”时，当前实现无法表达。

## 2. 目标交互

新的云线创建交互拆成两阶段：

### 阶段 A：显式 pick 锚点

- 工具模式切到 `annotation_cloud`
- 用户先点击一个 mesh 表面
- 系统记录：
  - `anchorWorldPos`
  - `anchorRefno`
  - `entityId`
- 此时仅进入“云线锚点已就绪”状态，不创建批注记录

### 阶段 B：以锚点为参考中心框选

- 用户从屏幕上拖出 marquee
- marquee 用于：
  - 收集关联的 `refnos`
  - 确定屏幕上的云线中心偏移 `screenOffset`
  - 确定 `cloudSize`
- 创建 record 时：
  - 直接使用已 pick 的 `anchorWorldPos`
  - 不再从 `marqueeCenter` 反推锚点

## 3. 数据模型

### 3.1 持久化记录

`CloudAnnotationRecord` 保留当前主模型：

- `anchorWorldPos`
- `leaderEndWorldPos`
- `screenOffset`
- `cloudSize`
- `refnos`

新增一个可选字段：

- `anchorRefno?: string`

用途：

- 明确记录锚点属于哪个 refno
- 后续 flyTo / review / 调试时更容易对账
- 未来如需按锚点构件做高亮或修复数据，也更容易落地

### 3.2 临时交互态

创建期间需要新增一个非持久化的临时状态，例如：

- `pendingCloudAnchor`
  - `worldPos: Vec3`
  - `refno?: string`
  - `entityId?: string`

这个状态不进入 localStorage，只存在于当前工具会话中。

## 4. 代码落点

### 4.1 `src/composables/useToolStore.ts`

职责：

- 给 `CloudAnnotationRecord` 增加 `anchorRefno?: string`
- 若需要在 store 层管理临时锚点，则新增：
  - `pendingCloudAnchor`
  - `setPendingCloudAnchor()`
  - `clearPendingCloudAnchor()`

推荐做法：

- 临时锚点优先放在 `useDtxTools.ts` 内部 `ref`，避免污染全局 store
- 仅把 `anchorRefno` 放入持久化 record

### 4.2 `src/composables/useDtxTools.ts`

职责：

1. 新增纯函数 helper
   - 解析云线锚点 pick 结果
   - 根据已 pick 的锚点和 marquee rect 创建 `CloudAnnotationRecord`

2. 替换创建流程
   - `annotation_cloud` 模式首次点击：尝试 `pickSurfacePoint()` 或 `selection.pickPoint()`
   - 命中后进入 pending anchor 状态
   - 只有 pending anchor 存在时，才允许 `beginMarquee()`

3. 修改 `endMarquee()`
   - `mode === 'annotation_cloud'` 时直接使用 pending anchor
   - 删除或废弃 `resolveCloudAnchorFromMarqueeCenter()` 在创建链路中的职责

4. 创建完成后
   - 清理 pending anchor
   - 激活 annotation panel

5. 异常/回退
   - 如果未 pick 锚点就拖框，不创建批注
   - 如果框选未选中任何 refno，不创建批注，但保留锚点还是清理锚点需要显式决定

推荐：

- 框选失败时保留锚点，便于用户重新拖框
- Esc 或切换工具模式时清理 pending anchor

### 4.3 Viewer pointer hooks

主要还是走 `useDtxTools` 现有的：

- `onCanvasPointerDown`
- `onCanvasPointerMove`
- `onCanvasPointerUp`

无需大改 `ViewerPanel`，重点是 `annotation_cloud` 模式从“直接 beginMarquee”变成“先 pick，后 marquee”。

## 5. 设计决策

### 决策 1：云线仍保持屏幕空间绘制

不把云线轮廓改成固定世界几何。

原因：

- 你的需求明确是“绘制的是屏幕上的云线”
- 当前 `computeCloudLayout(anchorScreen, screenOffset, cloudSize)` 已经适合这个模型
- 只要锚点正确，camera 变化后云线就能围绕同一锚点稳定重建

### 决策 2：创建时不再使用 marquee center 猜锚点

`resolveCloudAnchorFromMarqueeCenter()` 可以保留为兼容辅助函数，但不再作为主创建路径。

### 决策 3：锚点和关联 refno 解耦

锚点构件可能是框选对象之一，也可能只是视觉参考点；因此：

- `anchorRefno` 单独存
- `refnos` 仍表示框选关联对象集合

## 6. TDD 实施任务

### Task 1: 纯函数测试锁定新语义

**Files:**
- Modify: `src/composables/useDtxTools.pickRefno.test.ts`
- Modify: `src/composables/useDtxTools.ts`

**Step 1: 写失败测试**

新增纯函数测试，覆盖：

- 已提供 pending anchor 时，创建 cloud record 必须使用该 anchor
- `anchorRefno` 取自 pick 命中的 refno
- `screenOffset` 基于锚点投影点和 marquee 中心计算
- `cloudSize` 仍按当前 clamp 规则生成

**Step 2: 运行测试确认失败**

Run: `npm test -- src/composables/useDtxTools.pickRefno.test.ts`

Expected: FAIL，因为 helper 尚不存在

**Step 3: 写最小实现**

在 `src/composables/useDtxTools.ts` 增加类似：

- `createCloudAnnotationRecordFromAnchorAndMarquee(...)`
- `resolveCloudAnchorRefno(...)`（如需要）

**Step 4: 运行测试确认通过**

Run: `npm test -- src/composables/useDtxTools.pickRefno.test.ts`

Expected: PASS

### Task 2: 接入云线两阶段创建流程

**Files:**
- Modify: `src/composables/useDtxTools.ts`
- Modify: `src/composables/useToolStore.ts`

**Step 1: 写失败测试或最小行为断言**

优先通过纯函数和已有测试锁住新 helper，然后在实现中接线，不额外引入重型单测。

**Step 2: 写最小实现**

- 新增 pending cloud anchor 状态
- `annotation_cloud` 模式点击 mesh 时先记录锚点
- 只有 pending anchor 已存在时才开始 marquee
- `endMarquee()` 使用 pending anchor 创建 record
- record 增加 `anchorRefno`

**Step 3: 回归清理**

- 创建成功后清理 pending anchor
- 切换工具模式/重置进度时清理 pending anchor

### Task 3: Playwright 验证锚点驱动创建

**Files:**
- Modify: `e2e/dtx-annotation-visual.spec.ts`

**Step 1: 新增或改造用例**

覆盖：

1. 进入 `annotation_cloud`
2. 先点击一个可 pick 的 mesh 点
3. 再拖框创建云线
4. 断言 store 中：
   - `cloudAnnotations[0].anchorWorldPos` 存在
   - `cloudAnnotations[0].anchorRefno` 存在
   - `cloudAnnotations[0].refnos.length > 0`
5. 截图创建效果
6. 改变 camera 后再次截图，确认云线仍围绕锚点稳定

**Step 2: 运行测试**

Run: `PLAYWRIGHT_PORT=43177 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test e2e/dtx-annotation-visual.spec.ts --workers=1`

Expected: PASS

## 7. 验证清单

最少需要跑：

- `npm test -- src/composables/useDtxTools.pickRefno.test.ts`
- `npm test -- src/composables/useToolStore.persistence.test.ts src/composables/useDtxTools.pickRefno.test.ts src/components/tools/AnnotationPanel.test.ts`
- `npm run type-check`

如果 e2e 环境可用，再跑：

- `PLAYWRIGHT_PORT=43177 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test e2e/dtx-annotation-visual.spec.ts --workers=1`

## 8. 风险与边界

### 风险 1：未 pick 锚点就拖框

必须统一行为。推荐：

- 不创建
- 提示状态文本“请先点击模型选择云线锚点”

### 风险 2：锚点命中的 refno 不在框选结果里

允许这种情况存在，不强制把锚点 refno 塞入 `refnos`，避免篡改用户框选结果。

### 风险 3：相机变化导致 label 位置漂移

这不是本轮创建链路的核心问题。当前模型已通过：

- `anchorWorldPos`
- `screenOffset`
- `cloudSize`

每帧重算屏幕云线，因此只要锚点正确，整体跟随语义就是稳定的。

## 9. 完成标准

满足以下条件才算完成：

- 云线创建必须先 pick 锚点，再允许框选
- 新建 cloud record 的锚点来自用户 pick，而不是 marquee center 推导
- camera 改变后，云线仍围绕该锚点在屏幕空间重建
- 单测和类型检查通过
- 若本地 e2e 环境可用，则截图回归通过并更新截图证据
