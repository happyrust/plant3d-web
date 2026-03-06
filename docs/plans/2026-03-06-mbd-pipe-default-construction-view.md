# MBD Pipe Default Construction View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 BRAN/HANG 的 MBD 标注默认视图调整为施工习惯优先，默认展示链式尺寸、总长、焊口和坡度，默认隐藏端口尺寸与校核型噪声信息。

**Architecture:** 第一期只改前端默认态，不动后端生成逻辑。请求层改默认 query，渲染层改默认可见项与默认尺寸风格，依赖现有接口能力完成行为切换。

**Tech Stack:** Vue 3, TypeScript, Three.js, 自定义 annotation 系统, Vitest

---

### Task 1: 固化一期默认请求语义

**Files:**
- Modify: `src/components/dock_panels/ViewerPanel.vue`
- Test: `src/components/dock_panels/ViewerPanel.vue` 相关现有 MBD e2e/集成测试（如 `e2e/mbd-pipe-race.spec.ts` 仅作回归参考）

**Step 1: 写一个失败用例或补充断言**

验证 `getMbdPipeAnnotations()` 默认调用参数已从 `port dims only` 切换为：

- `include_chain_dims: true`
- `include_overall_dim: true`
- `include_port_dims: false`
- `include_welds: true`
- `include_slopes: true`
- `include_bends: false`

**Step 2: 运行相关测试确认失败**

Run: `pnpm test -- --runInBand`

Expected: 与旧默认值相关的断言失败，或无覆盖时记录为“缺测试，需要补最小测试”。

**Step 3: 最小实现**

修改 `src/components/dock_panels/ViewerPanel.vue` 中 `getMbdPipeAnnotations(refnoKey, {...})` 的默认参数，使其符合施工视图目标。

**Step 4: 运行测试确认通过**

Run: `pnpm test -- --runInBand`

Expected: 新增/更新的断言通过，未引入已有测试回归。

**Step 5: 提交**

```bash
git add src/components/dock_panels/ViewerPanel.vue
git commit -m "feat: switch mbd pipe default query to construction view"
```

### Task 2: 调整前端默认可见项

**Files:**
- Modify: `src/composables/useMbdPipeAnnotationThree.ts`
- Test: `src/composables/useMbdPipeAnnotationThree.flyTo.test.ts`

**Step 1: 写失败测试**

增加或更新断言，验证默认状态为：

- `showDimChain === true`
- `showDimOverall === true`
- `showWelds === true`
- `showSlopes === true`
- `showDimPort === false`
- `showDimSegment === false`
- `showBends === false`
- `showSegments === false`

**Step 2: 运行测试确认失败**

Run: `pnpm vitest run src/composables/useMbdPipeAnnotationThree.flyTo.test.ts`

Expected: 旧默认值导致断言失败。

**Step 3: 最小实现**

修改 `src/composables/useMbdPipeAnnotationThree.ts` 中各显示开关的初始值，只改默认态，不改交互逻辑。

**Step 4: 运行测试确认通过**

Run: `pnpm vitest run src/composables/useMbdPipeAnnotationThree.flyTo.test.ts`

Expected: 默认可见性断言通过。

**Step 5: 提交**

```bash
git add src/composables/useMbdPipeAnnotationThree.ts src/composables/useMbdPipeAnnotationThree.flyTo.test.ts
git commit -m "feat: update mbd pipe default visibility for construction view"
```

### Task 3: 切换默认尺寸样式到 classic

**Files:**
- Modify: `src/composables/useMbdPipeAnnotationThree.ts`
- Test: `src/composables/useMbdPipeAnnotationThree.flyTo.test.ts`

**Step 1: 写失败测试**

补充断言验证默认 `dimMode` 为 `classic`，并确保 render 后 dims/welds/slopes/bends 的标签风格默认跟随 `classic/solvespace`。

**Step 2: 运行测试确认失败**

Run: `pnpm vitest run src/composables/useMbdPipeAnnotationThree.flyTo.test.ts`

Expected: 当前默认 `rebarviz` 触发失败。

**Step 3: 最小实现**

将 `dimMode` 初始值从 `rebarviz` 改为 `classic`，保留 URL 参数覆盖逻辑与面板切换能力。

**Step 4: 运行测试确认通过**

Run: `pnpm vitest run src/composables/useMbdPipeAnnotationThree.flyTo.test.ts`

Expected: 默认样式断言通过，显式切换 `rebarviz` 的现有能力不受影响。

**Step 5: 提交**

```bash
git add src/composables/useMbdPipeAnnotationThree.ts src/composables/useMbdPipeAnnotationThree.flyTo.test.ts
git commit -m "feat: default mbd pipe dimensions to classic style"
```

### Task 4: 做端到端回归验证

**Files:**
- Verify: `src/components/dock_panels/ViewerPanel.vue`
- Verify: `src/composables/useMbdPipeAnnotationThree.ts`
- Verify: `e2e/mbd-pipe-race.spec.ts`

**Step 1: 运行针对性测试**

Run: `pnpm vitest run src/composables/useMbdPipeAnnotationThree.flyTo.test.ts`

Expected: 通过。

**Step 2: 运行更大范围回归**

Run: `pnpm test -- --runInBand`

Expected: 与 MBD 相关的单测/集成测试通过；若 e2e 未纳入默认任务，记录未执行项。

**Step 3: 手动验证**

用真实 BRAN 触发右键“生成 MBD 管道标注”，确认：

- 首屏是 chain/overall/weld/slope 主导
- 不再默认出现 port dims
- 默认样式更接近工程图
- 面板中仍可切回其它显示项

**Step 4: 最终提交**

```bash
git add src/components/dock_panels/ViewerPanel.vue src/composables/useMbdPipeAnnotationThree.ts src/composables/useMbdPipeAnnotationThree.flyTo.test.ts docs/plans/2026-03-06-mbd-pipe-default-construction-view-design.md docs/plans/2026-03-06-mbd-pipe-default-construction-view.md
git commit -m "feat: align mbd pipe default view with construction annotations"
```
