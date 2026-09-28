# Annotation Style Presets Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把批注样式面板中的快捷预设升级为带说明和缩略预览的可视化卡片，同时保留现有持久化与实时预览联动。

**Architecture:** 继续复用 `useAnnotationStyleStore` 作为样式事实源，UI 层只负责展示预设卡片和触发 `applyPreset()`。测试保持 TDD 路径，先让组件测试覆盖预设卡片文案与点击行为，再做最小模板改造。

**Tech Stack:** Vue 3、TypeScript、Vitest、happy-dom、Tailwind utility classes

---

### Task 1: 预设卡片测试

**Files:**
- Modify: `src/components/tools/AnnotationStylePanel.test.ts`

**Step 1: Write the failing test**

- 增加一个测试，断言面板存在 `柔和 / 清晰 / 强强调` 三张可点击卡片
- 断言卡片内含短描述文案，例如 `更轻更淡`、`平衡清楚与克制`、`适合重点标注`

**Step 2: Run test to verify it fails**

Run: `npm test -- src/components/tools/AnnotationStylePanel.test.ts`

Expected: FAIL，因为当前实现仍是普通按钮或缺少说明文案

### Task 2: 实现预设卡片

**Files:**
- Modify: `src/components/tools/AnnotationStylePanel.vue`

**Step 3: Write minimal implementation**

- 把快捷按钮数据源扩展为 `label + description`
- 把顶部按钮区替换成卡片布局
- 保留点击卡片调用 `applyPreset(preset.id)`
- 在卡片中加入简化引线预览，帮助用户快速理解视觉差异

**Step 4: Run test to verify it passes**

Run: `npm test -- src/components/tools/AnnotationStylePanel.test.ts`

Expected: PASS

### Task 3: 回归验证

**Files:**
- Modify: `src/composables/useAnnotationStyleStore.test.ts`（仅当需要补 store 级覆盖时）

**Step 5: Run broader verification**

Run: `npm test -- src/components/tools/AnnotationStylePanel.test.ts src/components/tools/AnnotationPanel.test.ts src/composables/useAnnotationStyleStore.test.ts`

Expected: PASS

**Step 6: Run type check**

Run: `npm run type-check`

Expected: PASS
