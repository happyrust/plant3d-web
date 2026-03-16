# Text Annotation Draggable Card Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 DTX 文字批注增加“展开态图钉 + 可拖动 card + 引线联动、折叠态 location pin、双击图钉折叠/展开、card 内联编辑”的完整交互闭环。

**Architecture:** 继续以 `useToolStore.annotations` 作为文字批注事实源，在 `AnnotationRecord` 中增加 `labelWorldPos` 与 `collapsed`。`useDtxTools` 负责 overlay card 的拖拽状态机、图钉到 card 的 leader 几何、折叠态/展开态 marker 切换，以及标题/描述的内联草稿提交；`AnnotationPanel` 不再承担文字批注弹窗编辑。整个实现沿用现有 localStorage 持久化与 Playwright 自动截图链路。

**Tech Stack:** Vue 3 + TypeScript + Three.js + Vitest + Playwright

---

### Task 1: 固化文字批注新数据语义

**Files:**
- Modify: `src/composables/useToolStore.ts`
- Test: `src/composables/useToolStore.persistence.test.ts`

**Step 1: 写失败测试**

在 `src/composables/useToolStore.persistence.test.ts` 增加文字批注持久化断言，要求：

- `labelWorldPos` 能写入并恢复
- `collapsed` 能写入并恢复
- 旧字段仍保持兼容

**Step 2: 运行测试确认失败**

Run: `npm test -- src/composables/useToolStore.persistence.test.ts`
Expected: FAIL，提示 `AnnotationRecord` 还没有对应字段或 payload 不匹配。

**Step 3: 写最小实现**

在 `src/composables/useToolStore.ts`：

- 给 `AnnotationRecord` 增加 `labelWorldPos?: Vec3`
- 给 `AnnotationRecord` 增加 `collapsed?: boolean`
- 确保 `normalizeV1/normalizeV2/normalizeV3/loadPersisted()` 对缺失字段采用兜底兼容

**Step 4: 运行测试确认通过**

Run: `npm test -- src/composables/useToolStore.persistence.test.ts`
Expected: PASS

---

### Task 2: 为文字批注补纯函数与拖拽状态测试

**Files:**
- Modify: `src/composables/useDtxTools.ts`
- Modify: `src/composables/useDtxTools.pickRefno.test.ts`

**Step 1: 写失败测试**

在 `src/composables/useDtxTools.pickRefno.test.ts` 增加纯函数断言：

- 默认文字 label 位置可从图钉位置推导
- 折叠态判定下不应显示 label/leader
- 图钉双击动作应解析为折叠切换
- card 拖拽回写的新世界坐标应稳定输出

**Step 2: 运行测试确认失败**

Run: `npm test -- src/composables/useDtxTools.pickRefno.test.ts`
Expected: FAIL，提示文字批注拖拽/折叠相关 helper 尚不存在。

**Step 3: 写最小实现**

在 `src/composables/useDtxTools.ts` 中增加：

- 文字批注默认 label 锚点计算 helper
- 文字批注显示状态 helper
- 图钉双击折叠切换 helper

只实现让纯函数测试通过所需的最小逻辑。

**Step 4: 运行测试确认通过**

Run: `npm test -- src/composables/useDtxTools.pickRefno.test.ts`
Expected: PASS

---

### Task 3: 接入 viewer 文字批注 leader 与折叠渲染

**Files:**
- Modify: `src/composables/useDtxTools.ts`

**Step 1: 写失败测试或最小回归断言**

复用 `src/composables/useDtxTools.pickRefno.test.ts`，增加：

- 展开态文字批注应生成 leader 终点
- 折叠态不应创建 label

**Step 2: 运行测试确认失败**

Run: `npm test -- src/composables/useDtxTools.pickRefno.test.ts`
Expected: FAIL

**Step 3: 写最小实现**

在 `useDtxTools.ts` 的文字批注渲染段：

- 若 `labelWorldPos` 缺失，则生成默认偏移点
- 创建从 `worldPos` 到 `labelWorldPos` 的 leader
- `collapsed === true` 时只渲染 marker
- 图钉双击切换 `collapsed`

**Step 4: 运行测试确认通过**

Run: `npm test -- src/composables/useDtxTools.pickRefno.test.ts`
Expected: PASS

---

### Task 4: 接入文字 card 拖拽回写

**Files:**
- Modify: `src/composables/useDtxTools.ts`

**Step 1: 写失败测试**

在 `src/composables/useDtxTools.pickRefno.test.ts` 中补充：

- 拖拽 card 时，根据 overlay 坐标和图钉 `ndcZ` 回写新的 `labelWorldPos`

**Step 2: 运行测试确认失败**

Run: `npm test -- src/composables/useDtxTools.pickRefno.test.ts`
Expected: FAIL

**Step 3: 写最小实现**

在 `useDtxTools.ts` 中：

- 为文字批注增加 label pointer down / move / up 状态机
- 拖拽中持续调用 `store.updateAnnotation(id, { labelWorldPos })`
- 结束后清理拖拽状态并触发重渲染

**Step 4: 运行测试确认通过**

Run: `npm test -- src/composables/useDtxTools.pickRefno.test.ts`
Expected: PASS

---

### Task 5: 补端到端截图与内联编辑回归

**Files:**
- Modify: `e2e/dtx-annotation-visual.spec.ts`
- Test: `e2e/screenshots/annotation-visual/*.png`

**Step 1: 写失败测试**

在 `e2e/dtx-annotation-visual.spec.ts` 中新增文字批注回归步骤：

- 创建文字批注
- 直接在批注框内输入标题/描述
- 截图展开态
- 拖动 card，截图拖动后效果
- 双击图钉折叠，截图折叠态
- 再次双击图钉展开
- 验证标题/描述已回写到 store，且不出现编辑弹窗

**Step 2: 运行测试确认失败**

Run: `PLAYWRIGHT_PORT=43173 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test e2e/dtx-annotation-visual.spec.ts`
Expected: FAIL，因为当前没有文字批注拖拽/折叠逻辑。

**Step 3: 写最小实现**

仅补足通过该用例所需的事件与渲染逻辑，不扩展到矩形/云线。

**Step 4: 运行测试确认通过**

Run: `PLAYWRIGHT_PORT=43173 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test e2e/dtx-annotation-visual.spec.ts`
Expected: PASS，并生成新的文字批注截图。

---

### Task 6: 最终回归

**Files:**
- Modify: (none)
- Test: `src/composables/useToolStore.persistence.test.ts`
- Test: `src/composables/useDtxTools.pickRefno.test.ts`
- Test: `src/components/tools/AnnotationPanel.test.ts`
- Test: `e2e/dtx-annotation-visual.spec.ts`

**Step 1: 跑类型检查**

Run: `npm run type-check`
Expected: PASS

**Step 2: 跑单测**

Run: `npm test -- src/composables/useToolStore.persistence.test.ts src/composables/useDtxTools.pickRefno.test.ts src/components/tools/AnnotationPanel.test.ts`
Expected: PASS

**Step 3: 跑 Playwright 视觉回归**

Run: `PLAYWRIGHT_PORT=43173 PLAYWRIGHT_REUSE_SERVER=1 npx playwright test e2e/dtx-annotation-visual.spec.ts`
Expected: PASS，并刷新 `e2e/screenshots/annotation-visual/` 下截图。
