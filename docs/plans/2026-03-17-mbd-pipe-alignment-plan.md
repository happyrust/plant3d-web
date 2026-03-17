# MBD Pipe Purple Dimension Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 默认关闭黑色辅助切管尺寸，只保留紫色主尺寸，并让同平面紫色尺寸尽量共线、引线长度尽量一致。

**Architecture:** 保留现有 `useMbdPipeAnnotationThree` 主渲染链路，不新增新的状态层。黑色尺寸通过关闭 `construction` 视图下的 `cut_tubi` 默认显示来消除；紫色尺寸通过在 `renderDims()` 后增加一次“同平面、同轴向、同 offset_dir”分组对齐，统一组内 offset，实现共线化。交互层与后端合同保持不变。

**Tech Stack:** Vue 3, TypeScript, Three.js, Vitest

---

## Design Summary

- 黑色那套优先按“辅助切管尺寸”处理，不删接口，只关闭默认显示，保留后续手动恢复的可能。
- 紫色主尺寸只处理 `chain/overall` 两类，避免波及 `port` 的稀疏化逻辑和其他辅助标签。
- 对齐规则采用保守策略：
  - 同 plane、同 segment axis、同 offset_dir、同 offset_level 才进同组
  - 组内统一取最大 offset，避免短尺寸贴线、长尺寸外翻
  - 若用户已有 session override，则不覆盖该条的手动调整

### Task 1: Write failing tests for default visibility and planar alignment

**Files:**
- Modify: `src/composables/useMbdPipeAnnotationThree.flyTo.test.ts`

**Step 1: Write the failing test**

- 更新“默认显示施工视图相关标注”测试，期望 `showCutTubis.value === false`
- 新增“同平面 chain 尺寸应统一 offset”测试，构造两条共面、同方向、同 offset_dir 的 chain 尺寸，断言最终 `offset` 相等

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/composables/useMbdPipeAnnotationThree.flyTo.test.ts
```

Expected:

- `showCutTubis` 默认值断言失败
- 新增共面对齐断言失败

### Task 2: Implement minimal visibility change and planar alignment

**Files:**
- Modify: `src/composables/useMbdPipeAnnotationThree.ts`

**Step 1: Default-hide cut tubi annotations in construction mode**

- 将 `construction` 默认态的 `showCutTubis` 从 `true` 改为 `false`

**Step 2: Add grouped planar alignment helper**

- 新增仅作用于 `chain/overall` 的分组对齐 helper
- 使用以下分组因子：
  - canonicalized segment direction
  - canonicalized offset direction
  - plane normal + plane distance
  - layout_hint.offset_level
- 组内统一取最大 offset
- 若 dim 有 `dimOverrides.offset`，跳过自动覆盖

**Step 3: Apply helper after dims are created**

- 在 `renderDims()` 完成 annotation 创建后调用
- 保持 `port` 稀疏化逻辑不变

### Task 3: Verify tests pass and no obvious regression

**Files:**
- Verify: `src/composables/useMbdPipeAnnotationThree.flyTo.test.ts`

**Step 1: Run targeted test**

Run:

```bash
npm test -- src/composables/useMbdPipeAnnotationThree.flyTo.test.ts
```

Expected:

- 全部通过

**Step 2: Run one additional focused suite if needed**

Run:

```bash
npm test -- src/fixtures/bran-test-data.test.ts
```

Expected:

- fixture 渲染测试通过，未出现明显回归

## Notes

- 本次不改后端 `include_cut_tubis` 请求参数，避免影响后续面板手动恢复显示。
- 若后续用户要求“整体统一到单一线层”，可再把 `overall` 与 `chain` 的 offset_level 规则前移到后端 `layout_hint`。
