# MBD Pipe Mode System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 MBD 管道标注建立 construction / inspection 模式系统，统一后端语义默认值与前端模式化显示行为，同时保持显式 `include_*` 覆盖能力。

**Architecture:** 后端在 `/api/mbd/pipe/{refno}` 上新增 `mode` 概念，并以 `construction` 作为默认模式；前端在 MBD composable 和面板层引入对应模式状态与“重置为当前模式默认”行为。模式只提供默认基线，显式 `include_*` 参数和前端局部开关仍保留优先级。

**Tech Stack:** Rust, Axum, Serde, Vue 3, TypeScript, Three.js, Vitest, Playwright

---

### Task 1: 后端增加 mode 枚举与解析

**Files:**
- Modify: `gen-model-fork/src/web_api/mbd_pipe_api.rs`
- Test: `gen-model-fork` 中与 `mbd_pipe_api.rs` 相关的现有测试文件或新增最小测试文件

**Step 1: 写失败测试**

新增最小测试，验证：

- 不传 `mode` 时按 `construction` 处理
- `mode=inspection` 能被成功解析

**Step 2: 运行测试确认失败**

Run: `cargo test mbd_pipe -- --nocapture`

Expected: 缺少 `mode` 字段或模式解析逻辑导致失败。

**Step 3: 写最小实现**

在 `mbd_pipe_api.rs` 中：

- 新增 `MbdPipeMode`
- 在 `MbdPipeQuery` 中加入 `mode`
- 提供默认值为 `construction`

**Step 4: 运行测试确认通过**

Run: `cargo test mbd_pipe -- --nocapture`

Expected: 模式解析相关测试通过。

**Step 5: Commit**

```bash
git add gen-model-fork/src/web_api/mbd_pipe_api.rs
git commit -m "feat: add mbd pipe mode parsing"
```

### Task 2: 后端实现模式默认值与显式覆盖规则

**Files:**
- Modify: `gen-model-fork/src/web_api/mbd_pipe_api.rs`
- Test: `gen-model-fork` 中与 MBD pipe query 归一化相关测试

**Step 1: 写失败测试**

至少覆盖：

- `construction` 默认 `chain/overall/weld/slope=true`, `port/bends=false`
- `inspection` 默认 `port=true`, `chain/overall/weld/slope/bends=false`
- 显式 `include_port_dims=true` 覆盖 `construction`
- 显式 `include_chain_dims=true` 覆盖 `inspection`

**Step 2: 运行测试确认失败**

Run: `cargo test mbd_pipe -- --nocapture`

Expected: 运行时默认组合与断言不一致。

**Step 3: 写最小实现**

新增一个集中式 query 归一化函数，例如：

- 先应用 mode 基线
- 再应用显式 `include_*` 覆盖

不要把判断散落到 handler 多处。

**Step 4: 运行测试确认通过**

Run: `cargo test mbd_pipe -- --nocapture`

Expected: construction / inspection / 显式覆盖规则全部通过。

**Step 5: Commit**

```bash
git add gen-model-fork/src/web_api/mbd_pipe_api.rs
git commit -m "feat: add mbd pipe mode defaults and overrides"
```

### Task 3: 前端请求层显式传 mode

**Files:**
- Modify: `src/api/mbdPipeApi.ts`
- Modify: `src/components/dock_panels/ViewerPanel.vue`
- Test: `e2e/mbd-pipe-race.spec.ts`

**Step 1: 写失败测试**

在 `e2e/mbd-pipe-race.spec.ts` 中补断言：

- 请求中显式携带 `mode=construction`
- 现有 `include_*` 组合仍符合 construction 目标

**Step 2: 运行测试确认失败**

Run: `pnpm playwright test e2e/mbd-pipe-race.spec.ts`

Expected: URL 中缺少 `mode` 或组合不匹配。

**Step 3: 写最小实现**

- 在 `src/api/mbdPipeApi.ts` 中补充 `mode` 类型
- 在 `ViewerPanel.vue` 的 `getMbdPipeAnnotations()` 调用中显式传 `mode`

**Step 4: 运行测试确认通过**

Run: `pnpm playwright test e2e/mbd-pipe-race.spec.ts`

Expected: query 参数断言通过。

**Step 5: Commit**

```bash
git add src/api/mbdPipeApi.ts src/components/dock_panels/ViewerPanel.vue e2e/mbd-pipe-race.spec.ts
git commit -m "feat: pass mbd pipe mode from frontend requests"
```

### Task 4: 前端 composable 增加模式状态

**Files:**
- Modify: `src/composables/useMbdPipeAnnotationThree.ts`
- Test: `src/composables/useMbdPipeAnnotationThree.flyTo.test.ts`

**Step 1: 写失败测试**

补最小测试，验证：

- 默认 `mbdViewMode` 为 `construction`
- 调用模式默认映射函数后，construction 与 inspection 的默认可见项和 `dimMode` 不同

**Step 2: 运行测试确认失败**

Run: `pnpm vitest run src/composables/useMbdPipeAnnotationThree.flyTo.test.ts`

Expected: 缺少 `mbdViewMode` 或模式映射逻辑。

**Step 3: 写最小实现**

在 composable 中新增：

- `mbdViewMode`
- `applyModeDefaults(mode)`
- `resetToCurrentModeDefaults()`

construction 默认映射到：

- `chain/overall/weld/slope + classic`

inspection 默认映射到：

- `port + rebarviz`

**Step 4: 运行测试确认通过**

Run: `pnpm vitest run src/composables/useMbdPipeAnnotationThree.flyTo.test.ts`

Expected: 模式状态与映射断言通过。

**Step 5: Commit**

```bash
git add src/composables/useMbdPipeAnnotationThree.ts src/composables/useMbdPipeAnnotationThree.flyTo.test.ts
git commit -m "feat: add mbd pipe view mode state"
```

### Task 5: 前端面板增加模式切换与重置动作

**Files:**
- Modify: `src/components/tools/MbdPipePanel.vue`
- Test: `src/components/tools/MbdPipePanel.vue` 对应测试文件；若没有，新增最小单测

**Step 1: 写失败测试**

验证面板能：

- 展示当前模式
- 切换 `construction / inspection`
- 点击“重置为当前模式默认”时调用对应方法

**Step 2: 运行测试确认失败**

Run: `pnpm vitest run src/components/tools/MbdPipePanel*.test.ts`

Expected: 面板缺少模式入口或调用链。

**Step 3: 写最小实现**

在 `MbdPipePanel.vue` 增加：

- 模式切换控件
- `重置为当前模式默认` 按钮

注意：

- 切模式时不要静默覆盖所有局部显隐
- 重置按钮才负责整套回到当前模式默认

**Step 4: 运行测试确认通过**

Run: `pnpm vitest run src/components/tools/MbdPipePanel*.test.ts`

Expected: 模式切换与重置动作通过。

**Step 5: Commit**

```bash
git add src/components/tools/MbdPipePanel.vue
git commit -m "feat: add mbd pipe mode controls to panel"
```

### Task 6: 集成验证与手工回归

**Files:**
- Verify: `gen-model-fork/src/web_api/mbd_pipe_api.rs`
- Verify: `src/components/dock_panels/ViewerPanel.vue`
- Verify: `src/composables/useMbdPipeAnnotationThree.ts`
- Verify: `src/components/tools/MbdPipePanel.vue`

**Step 1: 运行后端测试**

Run: `cargo test mbd_pipe -- --nocapture`

Expected: mode 默认值与显式覆盖规则通过。

**Step 2: 运行前端单测**

Run: `pnpm vitest run src/composables/useMbdPipeAnnotationThree.flyTo.test.ts`

Expected: 通过。

**Step 3: 运行前端 e2e**

Run: `pnpm playwright test e2e/mbd-pipe-race.spec.ts`

Expected: 请求 query 中带 `mode`，最新请求渲染逻辑不回归。

**Step 4: 手工验证**

用真实 BRAN：

- 初次打开默认走 construction
- 切到 inspection 后请求与默认显示变化正确
- 手动改显隐后，不因模式值变化被静默全量覆盖
- 点击“重置为当前模式默认”后恢复对应模式默认态

**Step 5: 最终提交**

```bash
git add gen-model-fork/src/web_api/mbd_pipe_api.rs src/api/mbdPipeApi.ts src/components/dock_panels/ViewerPanel.vue src/composables/useMbdPipeAnnotationThree.ts src/components/tools/MbdPipePanel.vue src/composables/useMbdPipeAnnotationThree.flyTo.test.ts e2e/mbd-pipe-race.spec.ts docs/plans/2026-03-07-mbd-pipe-mode-system-design.md docs/plans/2026-03-07-mbd-pipe-mode-system.md
git commit -m "feat: add mbd pipe construction and inspection modes"
```
