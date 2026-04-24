# 下一阶段开发计划 · 2026-04-24

> 承接批注表格 MVP++ PR 1–10 闭环 + 评论真源 PROMOTE 完成，本计划覆盖 **CUTOVER 收尾 + E2E 补全 + 代码清理 + 下一功能准备** 四个方向。

---

## 0. 当前状态摘要

| 维度 | 状态 |
|------|------|
| 批注表格 MVP++ (PR 1–10) | ✅ 全部完成 |
| 评论真源迁移 PROMOTE | ✅ 完成（Step 1–4 全绿） |
| DUAL_READ flag | 默认 ON，待验证后进入 CUTOVER |
| Phase A（测试修复） | ✅ 完成 |
| Phase B（E2E 补全） | `e2e/annotation-table-ribbon.spec.ts` 已存在 |
| Phase C（PROMOTE） | ✅ 闭环 |
| CHANGELOG | 已更新到 2026-04-23 |

---

## 1. Phase D · CUTOVER 准备与执行（~4h）

依据 `docs/plans/2026-04-19-review-comment-thread-refactor-plan.md` §5。

### D1. CUTOVER 前验证（~1h）

**目标**：确认 PROMOTE 稳定，无 `dual_read_diff` 事件。

1. 搜索代码中所有 `REVIEW_C_COMMENT_THREAD_STORE_DUAL_READ` 引用点，确认每处的回退路径
2. 编写一个验证脚本或 console 命令，确认 eventLog 中零 `dual_read_diff`
3. 运行全量 vitest，确认无回归
4. 生成 CUTOVER 前审计报告

### D2. 移除 DUAL_READ 分支（~2h）

| 文件 | 改动 |
|------|------|
| `src/review/flags.ts` | 移除 `REVIEW_C_COMMENT_THREAD_STORE_DUAL_READ` 常量 |
| `src/review/flags.test.ts` | 移除对应测试 |
| `src/review/services/commentThreadDualRead.ts` | 删除整个文件 |
| `src/review/services/commentThreadDualRead.test.ts` | 删除整个文件 |
| `src/components/review/embedFormSnapshotRestore.ts` | 移除 `isReviewCommentThreadStoreActive()` 分支 |
| `src/components/review/ReviewCommentsTimeline.vue` | 移除 dual-read 分支 |
| `src/review/services/sharedStores.ts` | 简化，移除 dual-read 相关逻辑 |
| `src/composables/useToolStore.ts` | `annotations` 从 `ref` 变为 `computed` 只读投影（或直接移除，所有引用已切 store） |

### D3. `useToolStore.annotations` 降级/移除（~1h）

- 若所有读写已切到 `commentThreadStore` → 直接移除 `annotations` 字段
- 若仍有历史调用面 → 改为 `computed` 只读投影
- 搜索全项目确认无遗漏引用

### D4. 门槛

- 所有现有测试通过（移除的测试除外）
- 无 `REVIEW_C_COMMENT_THREAD_STORE_DUAL_READ` 引用残留
- `commentEventLog` 保留但 `dual_read_diff` 类型不再写入
- CHANGELOG 更新

---

## 2. Phase E · E2E 与集成测试加固（~2h）

### E1. 验证 annotation-table-ribbon.spec.ts

- 确认 `e2e/annotation-table-ribbon.spec.ts` 两个用例与当前代码对齐
- 确认 Ribbon 按钮 `panel.annotationTable` 角色可见性逻辑可测

### E2. 补充关键路径 E2E

| 场景 | 优先级 |
|------|--------|
| Designer 切表格 → 搜索 → 双击回卡片 | P1 |
| Reviewer 工作台表格切换 | P2 |
| 评论 CRUD 流程（store 路径） | P2 |

### E3. 门槛

- E2E 冒烟测试绑定到 CI 或手动运行全绿

---

## 3. Phase F · 代码质量清理（~2h）

### F1. 移除 @deprecated 标记的旧方法

`useToolStore` 中被标记 `@deprecated` 的评论方法（`4fc9e1f` 提交标记），确认无调用后删除。

### F2. 类型清理

- 移除 `AnnotationComment` 类型（如已被 `SnapshotComment` 完全替代）
- 清理 `reviewSnapshot.ts` 中遗留的兼容适配代码

### F3. Lint & Type-check 全绿

```bash
npm run lint && npm run type-check
```

---

## 4. Phase G · 下一功能探索（评估）

基于现有架构，以下功能可作为下一迭代方向：

| 功能方向 | 描述 | 预估 |
|----------|------|------|
| **Ribbon reviewer 独立按钮** | PR 11：reviewer 角色专属批注表格按钮 | ~2h |
| **批注表格 inline 编辑** | 表格行内直接修改严重度/状态 | ~6h |
| **评论 @提及通知** | 评论中 @用户触发通知 | ~8h |
| **批注统计仪表板** | 汇总统计视图（严重度分布/处理进度） | ~4h |
| **CUTOVER 后清理 eventLog** | 精简 eventLog kind，移除不再需要的类型 | ~1h |

---

## 5. 执行顺序

```
Phase D (CUTOVER)  → Phase E (E2E)     → Phase F (清理)    → Phase G (新功能)
      ↓                   ↓                   ↓                   ↓
    ~4h                ~2h                 ~2h               按需评估
```

**总预估：~8h（约 1 个工作日）** 完成 D+E+F。Phase G 另行排期。

**推荐立即执行 Phase D**（CUTOVER），因为 PROMOTE 已闭环且全绿，拖延增加维护双份代码的认知成本。

---

## 6. 风险

| 风险 | 可能性 | 缓解 |
|------|--------|------|
| CUTOVER 移除后发现遗漏引用 | 低 | 全量搜索 + type-check 兜底 |
| 删除 dualRead 后某个边缘路径回归 | 低 | 先跑全量测试再提交 |
| E2E 环境依赖缺失 | 中 | 降级为 Vitest 集成测试 |
