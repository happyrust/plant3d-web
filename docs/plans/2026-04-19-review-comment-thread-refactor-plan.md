# 三维校审批注体系重构（M3 DUAL_READ）补档计划

> 起稿：2026-04-19  
> 依据：`docs/verification/2026-04-19-三维校审实现审核报告.md` 第 2.2 节 —— 识别出
> `src/review/services/*` 已落代码但无 plan 文档。本文件是补档。
>
> **目标**：把正在灰度的 M3 批注真源迁移（inline → commentThreadStore）用一份
> plan 固定下来，让下游维护者知道：
>
> 1. **现在在哪一步**（DUAL_READ / PROMOTE / CUTOVER）
> 2. **怎么观测差异**（commentEventLog）
> 3. **什么时候算合格**（退出 DUAL_READ 的判据）
> 4. **CUTOVER 后删什么**

没有这份文档，`commentEventLog.ts` 顶部注释引用的"批注体系重构补遗 §8"是死链，
7 个新 service 模块对读者是黑盒。

---

## 1. 背景与动机

### 1.1 真源漂移问题

历史实现中，批注（comment / thread）的真源在多个地方：

- `useToolStore`：`annotations: ref<Annotation[]>`（inline 真源）
- `useReviewStore`：`reviewRecords` / `confirmedSnapshots`
- `embedFormSnapshotRestore`：从 `workflow/sync?action=query` 恢复 snapshot
- `ReviewCommentsTimeline`：展示 thread-local 评论

> 四处各自持有部分批注状态，合并时靠 ad-hoc 规则 + localStorage 兜底。

典型 bug：同一条批注的 `severity` / `review_action` 在某个面板更新，其它面板
不刷新；或 snapshot 恢复后三处状态不一致，需要强制刷新。

### 1.2 M3 目标（一句话）

**把 comment / thread 的真源收口到 `commentThreadStore`，其它地方只投影不存储。**

---

## 2. 当前架构（以代码为准）

### 2.1 已落地的新模块

```
src/review/
├── domain/
│   └── commentThread.ts         ← 纯数据类型（CommentThread / Comment）
├── services/
│   ├── commentThreadStore.ts    ← 单一真源（in-memory store）
│   ├── commentThreadDualRead.ts ← 双读比对：inline vs store
│   ├── commentEventLog.ts       ← 环形 buffer 诊断信道
│   ├── sharedStores.ts          ← Getter aggregator (单例接入点)
│   └── *.test.ts                ← 4 套测试
├── adapters/
│   └── workflowSyncAdapter.ts   ← workflow/sync 回放 → snapshot
├── flags.ts                     ← 灰度开关常量
└── …
```

### 2.2 灰度开关

定义在 `src/review/flags.ts`（已存在）：

- `REVIEW_C_COMMENT_THREAD_STORE_DUAL_READ`：DUAL_READ 启停
- 约定：flag 命中时 store 作为**观察侧**同步维护一份 snapshot，
  inline 真源仍然驱动 UI。
- 完成 DUAL_READ 验收后，切换到 PROMOTE → CUTOVER：
  - PROMOTE：store 成为真源，inline 降级为投影
  - CUTOVER：移除 inline 真源，关闭 flag

### 2.3 已接入点

代码搜索 `REVIEW_C_COMMENT_THREAD_STORE_DUAL_READ` 命中 5 处调用面：

1. `src/components/review/embedFormSnapshotRestore.ts` —— `restoreEmbedFormSnapshot`
   里在 `options.importTools` 分支同时调 legacy payload + `buildSnapshotFromWorkflowSync`，
   命中 `isReviewCommentThreadStoreActive()` 时 merge 并 push `snapshot_merged`
   到 eventLog
2. `src/components/review/ReviewCommentsTimeline.vue` —— dual-read 展示评论
3. `src/review/services/sharedStores.ts` —— 单例 getter 收口
4. `src/review/services/commentThreadDualRead.*` —— 比对逻辑本体
5. `src/components/review/ReviewCommentsTimeline.test.ts` —— 对应测试

### 2.4 eventLog 的 6 种 kind

来自 `commentEventLog.ts:19`：

| kind | 语义 |
|---|---|
| `snapshot_merged` | workflow/sync snapshot 被 merge 进 store |
| `thread_upsert` | inline 新增/更新同步到 store |
| `thread_delete` | inline 删除同步到 store |
| `thread_clear` | 全量清空（切任务 / 切 formId） |
| `dual_read_diff` | inline vs store 比对出差异 |
| `restore_skipped` | snapshot 恢复被主动跳过（如重复触发） |

## 3. 验收判据（退出 DUAL_READ 的条件）

### 3.1 定量

- **零差异**：真实用户会话中连续 **N=1000** 次生命周期事件（upsert/delete/snapshot_merged）
  对应的 `dual_read_diff` 事件数为 0
- **eventLog 快照**：任意时刻抓 `commentEventLog.snapshot(500)`，不出现 `dual_read_diff`
  kind（DUAL_READ 期间也可能短暂出现，只要最后收敛到 0）
- **测试覆盖**：`commentThreadDualRead.test.ts` 覆盖下列场景全绿：
  - snapshot_merged 后 inline 与 store 等价
  - thread_upsert / delete 后等价
  - 多 formId 切换 clear 后等价
  - OBB / severity / review_action 三类新字段等价

### 3.2 定性

- Review panel 在以下 3 个事实源之间不再漂移：
  - `workflow/sync?action=query.data.annotationComments`
  - `commentThreadStore` 聚合视图
  - 用户当前可见的 `ReviewCommentsTimeline`

### 3.3 观测方法

在 dev server 内：

```js
// DevTools Console
const ev = window.__reviewCommentEventLog?.snapshot(100)
console.table(ev.filter(e => e.kind === 'dual_read_diff'))
```

> 若 `__reviewCommentEventLog` 未暴露到 window，可从 `sharedStores.getReviewCommentEventLog()` 取。

## 4. PROMOTE 阶段变更面

当 §3 判据全部满足后进入 PROMOTE：

1. 读侧：所有从 `useToolStore.annotations` 读的地方改读 `commentThreadStore`
2. 写侧：所有写 `useToolStore.annotations` 的地方改写 `commentThreadStore`
3. `useToolStore.annotations` 变为 computed 投影（只读）
4. 保留 DUAL_READ flag 一个迭代（可紧急回滚）
5. eventLog 继续运行作为审计

涉及文件（代码扫描预估）：

- `src/components/tools/AnnotationPanel.vue`
- `src/components/tools/AnnotationOverlayBar.vue`
- `src/composables/useDtxTools.ts`
- `src/components/review/ReviewCommentsTimeline.vue`
- `src/components/review/ReviewPanel.vue`

## 5. CUTOVER 阶段清理面

PROMOTE 稳定一个迭代后执行 CUTOVER：

1. 删除 `useToolStore.annotations` 字段
2. 删除 `commentThreadDualRead.ts`（其 diff 逻辑不再需要）
3. `commentEventLog` kind 里的 `dual_read_diff` 枚举保留（历史分析用），但不再写入
4. 移除 `REVIEW_C_COMMENT_THREAD_STORE_DUAL_READ` flag 与相关 if 分支
5. 更新 CHANGELOG：补一段 `Refactored` 说明"批注真源迁移完成"

## 6. 风险与回滚预案

### 6.1 DUAL_READ 阶段发现 diff

- 若 diff 源于 inline 真源的某个 code path 未走 adapter → 补 adapter，继续
  DUAL_READ
- 若 diff 源于 `workflowSyncAdapter` 字段映射错 → 修 adapter，继续 DUAL_READ
- 不中断 DUAL_READ、不拉回 PROMOTE 判据

### 6.2 PROMOTE 阶段线上 bug

- 立即把 `REVIEW_C_COMMENT_THREAD_STORE_DUAL_READ` 关掉（经 query/session/local 其中任一）
- inline 真源仍在，UI 自动回到旧行为
- 不需要 rollback commit

### 6.3 CUTOVER 后 bug

- 代价最高：需要 revert commit
- 因此 PROMOTE 稳定一个完整迭代（含 UAT + 生产真实数据）才走 CUTOVER

## 7. 本次补档不改代码

本 plan 只补文档与 `commentEventLog.ts:7` 引用的 "§8" 指向。
**不碰 `src/review/services/*` 代码**（它们已在工作树里但未提交，本轮只补文档）。

下一步建议顺序：

1. Commit 本 plan + 审核报告 + `src/review/services/*` 新模块，一次 commit，
   message 形如 `docs+feat(review/M3): add comment thread store refactor plan + initial DUAL_READ services`
2. 后续按 CHANGELOG `[Unreleased]` 段分批 commit 剩余改动

## 8. 相关文件速查

- `docs/verification/2026-04-19-三维校审实现审核报告.md` —— 本 plan 的由来
- `docs/verification/三维校审当前流程追踪.md` —— 2026-04-16 快照
- `docs/plans/2026-03-26-passive-workflow-readonly-review-ui.md` —— 被动模式约束
- `docs/plans/2026-04-02-pms-review-simulator-full-ui-verification.md` —— external/passive 主链验收
- `src/review/services/commentEventLog.ts` —— eventLog 实现
- `src/review/services/commentThreadStore.ts` —— 单一真源
- `src/review/services/commentThreadDualRead.ts` —— 差异比对器
- `src/review/services/sharedStores.ts` —— 单例 aggregator
- `src/review/adapters/workflowSyncAdapter.ts` —— snapshot 转换
- `src/review/flags.ts` —— DUAL_READ 开关
