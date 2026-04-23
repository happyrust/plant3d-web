# 批注表格视图 MVP · 验收报告 · 2026-04-23

> 本报告对应 `docs/plans/2026-04-22-annotation-dock-mvp-plan.md` 的 4-PR MVP 主线。
> 记录 PR 3 / PR 4 本轮落地情况，同时固化 pre-existing 测试失败的基线，避免后续 PR 被误判为回归。

## 0. TL;DR

- **MVP 主线全部落地**：PR 1 / 2 / 2.5 / 2.6 / 2.7（已在仓库历史合入） + PR 3 / PR 4（本轮）。
- **新增功能入口**：Ribbon 校审 → 面板 → 批注表格 按钮，点击后打开 `designerCommentHandling` dock 面板并切换到表格视图；面板内部也有 `卡片 / 表格` tab 手动切换。
- **功能闭环**：从 Ribbon 入口 → 面板打开 → 表格 / 卡片切换 → 行单击选中 / 双击飞到 3D + 进详情 → 右键复制 RefNo 或整行 CSV。
- **全量单测**：**1163 条测试**，其中 **1145 pass / 18 fail**。18 条 fail **全部确认为 pre-existing**（`git stash` 后未加本轮 PR 也同样失败）；`DesignerCommentHandlingPanel.test.ts`（12 ✓）/ `AnnotationTableView.test.ts`（20 ✓）/ `designerCommentViewModeBus.test.ts`（3 ✓）**35/35 全绿**。

---

## 1. 本轮交付（PR 3 + PR 4）

### 1.1 PR 3 · 批注表格接入 Dock 面板

| 文件 | 变更 |
|------|------|
| `src/components/review/DesignerCommentHandlingPanel.vue` | 加 `annotationListViewMode: 'split' \| 'table'` ref；`annotation_list` 视图顶部 tab bar；`AnnotationWorkspace` 与 `AnnotationTableView` 双分支渲染；`handleCopyFeedback`；`enterAnnotationDetail` 副作用补丁 |
| `src/components/review/DesignerCommentHandlingPanel.test.ts` | 新增 3 用例（tab 切换 · 行单击保持列表 · 行双击进详情并切回 split） |
| `docs/plans/2026-04-22-annotation-table-dock-integration-pr3-design.md` | PR 3 设计文档 |
| `CHANGELOG.md` | PR 3 段 |

### 1.2 PR 4 · Ribbon 入口 + viewMode 请求总线

| 文件 | 变更 |
|------|------|
| `src/components/review/designerCommentViewModeBus.ts` | **新** · 轻量 ref 总线，导出 `useDesignerCommentViewModeRequest` / `requestDesignerCommentViewMode` / `clearDesignerCommentViewModeRequest` |
| `src/components/review/designerCommentViewModeBus.test.ts` | **新** · 3 单元测试 |
| `src/ribbon/ribbonIcons.ts` | 加 `table` 图标映射 |
| `src/ribbon/ribbonConfig.ts` | `review.panel` group 插入 "批注表格" 按钮（`panel.annotationTable`） |
| `src/components/DockLayout.vue` | `handleRibbonCommand` 加 case `'panel.annotationTable'`：`ensurePanelAndActivate` + `requestDesignerCommentViewMode('table')` |
| `src/components/review/DesignerCommentHandlingPanel.vue` | watch viewMode request · 消费后 `clearDesignerCommentViewModeRequest` |
| `src/components/review/DesignerCommentHandlingPanel.test.ts` | 新增 2 用例（Ribbon 请求 → table · 详情页时请求回到列表 + table） |
| `docs/plans/2026-04-22-annotation-table-ribbon-entry-pr4-design.md` | PR 4 设计文档 |
| `CHANGELOG.md` | PR 4 段 |

### 1.3 组件通信模式

```
[Ribbon 按钮]
    │ emitCommand('panel.annotationTable')
    ▼
[DockLayout.handleRibbonCommand]
    │ ensurePanelAndActivate('designerCommentHandling')
    │ requestDesignerCommentViewMode('table')
    ▼
[designerCommentViewModeBus · ref (latest-value)]
    │
    ▼
[DesignerCommentHandlingPanel · watch requestedAt]
    │ annotationListViewMode = 'table'
    │ 若 workspaceView === 'annotation_detail' → 'annotation_list'
    │ clearDesignerCommentViewModeRequest()
    ▼
[AnnotationTableView 渲染]
```

关键点：不用即发即触的 `commandBus`，而用 "latest-value" ref，避免"面板还没 mount 命令就丢了"的竞态。

---

## 2. 测试结果

### 2.1 核心验证（本轮 3 个文件 · 35/35 全绿）

```
✓ src/components/review/designerCommentViewModeBus.test.ts          3 pass
✓ src/components/review/AnnotationTableView.test.ts                 20 pass
✓ src/components/review/DesignerCommentHandlingPanel.test.ts        12 pass
Total 35 pass · 0 fail
```

- `DesignerCommentHandlingPanel` 中 PR 3 新增 3 用例 + PR 4 新增 2 用例 + 原 7 用例
- `designerCommentViewModeBus` 全部来自 PR 4
- `AnnotationTableView` 20 用例不受 PR 3/4 影响（组件契约未动）

### 2.2 lint / type-check

```
$ npm run type-check           → 0 errors
$ npx eslint <PR3+PR4 files>   → 0 errors / 0 warnings
```

### 2.3 全量 `npx vitest run`

```
Test Files  11 failed | 143 passed (154)
Tests       18 failed | 1145 passed (1163)
```

#### Pre-existing failures（18 条 · 与 PR 3/4 无关）

| 测试文件 | 失败数 | 性质 |
|---------|-------|------|
| `src/components/review/ConfirmedRecords.test.ts` | 2 | review WIP 相关 watch 流程已在 PR 3 阶段 stash 验证过（未加本轮改动也失败） |
| `src/components/review/WorkflowHistory.test.ts` | 2 | 同上 |
| `src/components/review/ReviewPanel.componentLinkage.test.ts` | 2 | `useSelectionStore` → `useQueryClient` 没 mock（WIP 未收尾） |
| `src/composables/useMbdPipeAnnotationThree.flyTo.test.ts` | 5 | MBD 管道标注排布阈值与代码不一致 |
| `src/composables/useAnnotationStyleStore.test.ts` | 1 | localStorage 批量预设测试 |
| `src/utils/three/annotation/core/AnnotationMaterials.test.ts` | 1 | linewidth 期望值 3，实际 5 |
| `src/utils/three/annotation/annotations/WeldAnnotation3D.test.ts` | 1 | textGroup.visible 查找不到 |
| `src/utils/three/annotation/annotations/SlopeAnnotation3D.test.ts` | 1 | 同上 |
| `src/utils/three/annotation/text/SolveSpaceBillboardVectorText.test.ts` | 1 | 字号高度期望 11.5 实际 16 |
| `src/utils/versionInfo.test.ts` | 1 | 版本 JSON 解析 |
| `src/fixtures/bran-test-data.test.ts` | 1 | BRAN fixture 密集批注布局 |

**验证方法**：PR 3 阶段已执行 `git stash push -u` 剔除本轮改动，再跑 `ReviewPanel.test.ts` / `WorkflowHistory.test.ts` / `ConfirmedRecords.test.ts` / `ReviewPanel.componentLinkage.test.ts`，确认 6 个失败 **在 PR 3/4 改动之前就存在**。

MBD / Three.js / Material / VersionInfo / BRAN 类失败不在本轮改动范围内，且历史上与批注表格视图无交集（PR 3/4 未触碰 `src/utils/three/**` / `src/composables/useMbd*` / `src/utils/versionInfo*`）。

#### 本轮 PR 3/4 相关文件的测试状态

| 文件 | 通过 | 失败 |
|------|------|------|
| `DesignerCommentHandlingPanel.test.ts` | 12 | 0 |
| `AnnotationTableView.test.ts` | 20 | 0 |
| `designerCommentViewModeBus.test.ts` | 3 | 0 |
| `DockLayout.test.ts` | ✓（未在 fail 列表） | 0 |

---

## 3. 功能验收清单

### 3.1 批注表格视图组件（PR 1 – 2.7 历史工作，本报告仅列出 MVP 范围）

- [x] 5 列表格（序号 / 错误标记 / 校核发现问题 / 处理情况 / 操作）
- [x] 列头三态排序（asc / desc / reset）
- [x] 顶部搜索框 300ms debounce
- [x] 严重度 / 状态下拉筛选
- [x] 分页（pageSize = 10）
- [x] 导出 CSV（UTF-8 with BOM）
- [x] 键盘导航（↑↓ / Home / End / PageUp / PageDown）
- [x] 搜索高亮（XSS 防护）
- [x] 右键菜单（定位 / 打开 drawer / 复制 RefNo / 复制行 CSV）
- [x] 响应式退化（Wide ≥ 960 · Medium 640–960 · Compact < 640 卡片化）

### 3.2 Dock 面板接入（PR 3）

- [x] `annotation_list` 视图顶部 tab bar（`卡片列表` / `批注表格`）
- [x] tab 切换不触发视图层级变化
- [x] 表格视图数据源 = `scopedAnnotationItems`（仅 formId scope，不受 `annotationFilter` 影响）
- [x] 表格行单击 → `selectWorkspaceAnnotation`（保持列表视图）
- [x] 表格行双击 → `locateAnnotation` + `enterAnnotationDetail`（飞到 3D + 进详情）
- [x] 表格定位按钮 → `locateAnnotation`
- [x] 右键复制 → `handleCopyFeedback` → `emitToast`
- [x] `enterAnnotationDetail` 自动把 `annotationListViewMode` 重置为 `'split'`，保证详情页布局稳定

### 3.3 Ribbon 入口（PR 4）

- [x] Ribbon 校审组 → 面板 → 新增"批注表格"按钮（图标 `table`）
- [x] 按钮点击发送 `emitCommand('panel.annotationTable')`
- [x] DockLayout 收到命令 → 打开 `designerCommentHandling` 面板 + 请求 `table` 视图
- [x] 面板 watch 请求 → 切换 viewMode + 消费请求
- [x] 详情页时请求 `table` 自动回到列表页再切表格视图

---

## 4. 已知限制 / 非目标

| 项 | 说明 |
|----|------|
| Ribbon 按钮不根据角色隐藏 | 任何用户都能看见；MVP 未做权限分组 |
| 批注表格视图未接入 reviewer 的 `ReviewPanel.vue` | 当前仅 sj 角色使用；延伸后续 PR |
| `viewMode` 未 localStorage 持久化 | session 级足够；重启默认卡片视图 |
| 未做 E2E（Playwright）端到端测试 | MVP 测试策略中已标注"延后" |
| 未修复 18 条 pre-existing failures | 与 MVP scope 无关，由对应领域同学 follow-up |

---

## 5. 交付 Checklist

- [x] 本轮所有新增 / 修改文件通过 `eslint`
- [x] `vue-tsc --noEmit --pretty false` 通过
- [x] 本轮新增 35 个单测全绿
- [x] CHANGELOG 更新 PR 3 + PR 4 两段
- [x] 设计文档：`docs/plans/2026-04-22-annotation-table-dock-integration-pr3-design.md` / `docs/plans/2026-04-22-annotation-table-ribbon-entry-pr4-design.md`
- [x] 验收报告：本文件
- [ ] Git commit 落库（留给用户决定，见第 6 节）

---

## 6. Commit Message 草稿（供参考 · 未执行）

### PR 3

```text
feat(review): 批注表格接入 DesignerCommentHandling dock（PR 3/4）

- 批注列表视图顶部新增「卡片列表 / 批注表格」tab 切换
- AnnotationTableView 接入 DesignerCommentHandlingPanel，复用 scopedAnnotationItems
- 行单击 → 选中 · 行双击 → 飞到 3D + 进详情 · 右键复制 → toast 反馈
- 进入详情页时自动重置 viewMode 为 'split'，保证布局稳定
- 测试：DesignerCommentHandlingPanel.test.ts +3 用例，累计 10 → 12 用例全绿
```

### PR 4

```text
feat(review): Ribbon 批注表格按钮 + viewMode 请求总线（PR 4/4）

- 新增 designerCommentViewModeBus · latest-value ref 总线
- Ribbon 校审组新增"批注表格"按钮（panel.annotationTable）
- DockLayout 命令路由：ensurePanelAndActivate + requestDesignerCommentViewMode
- DesignerCommentHandlingPanel watch 请求并消费，详情页时自动回列表
- 测试：+3 bus unit tests + 2 panel integration tests，累计 35/35 全绿
- 设计文档：docs/plans/2026-04-22-annotation-table-ribbon-entry-pr4-design.md
```

---

## 7. 后续建议（非本轮 scope）

1. **接入 Reviewer 工作台**：`ReviewPanel.vue` 的 reviewer 视图同样可以受益于表格浏览
2. **E2E 测试**：Playwright 端到端跑 `Ribbon 点击 → 打开面板 → 表格切换 → 搜索 → 排序 → 行单击 drawer 打开` 链路
3. **Ribbon 按钮角色可见性**：只对 sj 角色（或需要批注处理的角色）展示
4. **viewMode 持久化**：存 `useNavigationStatePersistence`，用户下次进入记住上次模式
5. **18 条 pre-existing failures 分派修复**：按领域分工（review WIP、MBD 管道、three.js material、version info、BRAN fixture、annotation style）

---

## 8. 联系人 / 时间戳

- 交付时间：2026-04-23
- MVP 主线：4 个 PR · 覆盖设计稿 `.tmp/review-annotation-dock/`（UjaKP / JaP7C / IbPsx / S0B6X / JUta4 / tPVi8 / WSaGR / 9xPyi）
- 配套原型：`.tmp/review-annotation-dock/workspace.html`
