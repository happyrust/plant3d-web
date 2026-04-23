# 批注体系下一阶段开发计划 · 2026-04-23

> 承接批注表格 MVP++ PR 1–10 闭环，本计划覆盖 **测试修复 + 缺失 E2E 补全 + 评论真源迁移 PROMOTE** 三个方向。

---

## 0. 当前状态摘要

| 维度 | 状态 |
|------|------|
| 批注表格 MVP++ (PR 1–10) | 全部完成，已推送 |
| 单测 | 1152 passed / 27 failed (16 files) |
| Review 相关失败测试 | 7 个 (ConfirmedRecords ×2, WorkflowHistory ×2, DesignerCommentHandlingPanel ×1, ReviewPanel.componentLinkage ×2) |
| DockLayout 失败测试 | 1 个 (embed bootstrap token-only) |
| E2E annotation-table-ribbon.spec.ts | CHANGELOG 提及但文件缺失 |
| 评论真源迁移 | 停在 DUAL_READ (flag 默认关) |

---

## 1. Phase A · 测试修复（~2h）

### A1. Review 组件测试修复

修复 7 个与批注/校审流程直接相关的失败测试：

| 文件 | 失败数 | 预估原因 |
|------|--------|----------|
| `ConfirmedRecords.test.ts` | 2 | 组件 API / template 变更后测试未同步 |
| `WorkflowHistory.test.ts` | 2 | 同上 |
| `DesignerCommentHandlingPanel.test.ts` | 1 | 驳回任务恢复逻辑变更 |
| `ReviewPanel.componentLinkage.test.ts` | 2 | 构件联动 API 变更 |

### A2. DockLayout 测试修复

| 文件 | 失败数 | 预估原因 |
|------|--------|----------|
| `DockLayout.test.ts` | 1 | embed bootstrap token-only 路径变更 |

### A3. 门槛

- 上述 8 个测试全部通过
- 不引入新的测试失败

---

## 2. Phase B · E2E 补全（~1.5h）

### B1. 创建 `e2e/annotation-table-ribbon.spec.ts`

CHANGELOG PR 6 设计文档声明了此文件但当前树中缺失。

测试用例：
1. Designer 角色点击 Ribbon `panel.annotationTable` → DCH 面板切到表格视图
2. Viewer 角色看不到 `panel.annotationTable` 按钮

### B2. 门槛

- Playwright 运行 2 条用例全绿
- 或如无 Playwright 环境，降级为 Vitest 集成测试

---

## 3. Phase C · 评论真源迁移 PROMOTE（~6h）

依据 `docs/plans/2026-04-19-review-comment-thread-refactor-plan.md` §4。

### C1. 前置验收（DUAL_READ 退出判据）

1. 开启 `REVIEW_C_COMMENT_THREAD_STORE_DUAL_READ` flag
2. 运行 `commentThreadDualRead.test.ts` 全套 → 确认 9 用例全绿
3. 确认 `dual_read_diff` eventLog 为空

### C2. PROMOTE 读侧迁移

从 `useToolStore.annotations` 读取改为从 `commentThreadStore` 读取：

| 文件 | 改动 |
|------|------|
| `AnnotationPanel.vue` | 读取源替换 |
| `AnnotationOverlayBar.vue` | 读取源替换 |
| `useDtxTools.ts` | 读取源替换 |
| `ReviewCommentsTimeline.vue` | 已接入，确认 |
| `ReviewPanel.vue` | 读取源替换 |

### C3. PROMOTE 写侧迁移

所有写 `useToolStore.annotations` 的地方改写 `commentThreadStore`：

| 文件 | 改动 |
|------|------|
| `useDtxTools.ts` | 写入源替换 |
| `embedFormSnapshotRestore.ts` | 写入源替换 |
| `AnnotationPanel.vue` | 写入源替换 |

### C4. `useToolStore.annotations` 降级

- 将 `annotations` 从 `ref` 改为 `computed`（只读投影自 commentThreadStore）
- 保留 DUAL_READ flag 一个迭代（可紧急回滚）

### C5. 门槛

- 所有现有批注相关测试通过
- DUAL_READ flag 关闭后 UI 行为一致
- eventLog 无 `dual_read_diff`

---

## 4. 执行顺序

```
Phase A (测试修复) → Phase B (E2E) → Phase C (PROMOTE)
         ↓                ↓                ↓
      ~2h              ~1.5h             ~6h
```

**总预估：~9.5h（约 1.5 个工作日）**

Phase A 立即开始。

---

## 5. 风险

| 风险 | 可能性 | 缓解 |
|------|--------|------|
| 测试修复引入新回归 | 低 | 每修一个跑全量 |
| PROMOTE 后 UI 行为不一致 | 中 | 保留 flag 回滚路径 |
| E2E 环境不可用 | 低 | 降级为 Vitest 集成测试 |
