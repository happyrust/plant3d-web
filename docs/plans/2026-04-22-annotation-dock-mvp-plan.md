# 批注处理 Dock · MVP 开发计划 · 2026-04-22

## 0. TL;DR

在现有 `designerCommentHandling` dock 面板基础上，加入一个与现有三维查看器并列的**批注表格视图**，并在 Ribbon 里提供入口；
行级交互遵循 `单击=Drawer / 双击=飞行` 约定；搜索/排序/筛选为 session 级状态。
预计 4 个 PR，从**零风险的纯函数**到**响应式集成**，分步合并。

---

## 1. 背景与动机

### 1.1 现状

`src/components/review/DesignerCommentHandlingPanel.vue` 是现有批注处理面板，当前为**两段式**布局：

- `task_entry` 段 —— 显示退回单据列表，用户选择一个任务
- `workspace` 段 —— 通过复用 `AnnotationWorkspace.vue` 展示批注列表或详情

在 dock 宽度允许时，这种两段式会**浪费横向空间**；且"所有批注"的扁平视图（卡片纵向堆叠）在批注数量 > 10 时开始显得低效。

### 1.2 目标

- 提供**批注表格视图**作为中央区的第二种形态，与三维查看器**互斥切换**
- 表格视图支持搜索 / 排序 / 筛选 / CSV 导出 / 键盘导航
- 保持现有 `task_entry` / `workspace` 主工作流不变（向后兼容）
- 响应 dock 宽度自适应退化（Wide / Medium / Compact 三档）
- 严格复用现有数据源 `AnnotationWorkspaceItem[]`，不引入新的 store 或 API

### 1.3 非目标（MVP 明确不做）

- 不做批注创建（sj 角色只处理，不新增）
- 不做实时单条保存（依旧攒批次通过「确认当前数据」提交）
- 不做离线编辑
- 不做深色模式
- 不做 Compact 档下的完整手机优化（本期仅做响应式降级，全移动端优化延后）

---

## 2. 设计产出（本计划前置依赖，已完成）

### 2.1 Pencil 画布（`ui/三维校审/review-designer.pen`）

8 张核心稿：

| 节点 ID | 名称 | 作用 |
|---------|------|------|
| `UjaKP` | DockAnnotationWorkspace v2 · 三维态 | 完整参考稿 |
| `JaP7C` | DockAnnotationWorkspace v2 · table state | 完整表格态参考 |
| `IbPsx` | InteractionTimeline | 双击飞行 3 帧 |
| `S0B6X` | CompactAndLinkage | 窄屏 + 联动高亮 |
| `JUta4` | KeyboardAccessibility | 键盘导航 + ARIA |
| `tPVi8` | MVPSimplificationNotes | 简化决策文档 |
| `WSaGR` | WorkflowStateMachine | 工作流状态迁移 |
| `9xPyi` | UxEdgeCases | 右键菜单 / 三态 / 联动触发 |

### 2.2 HTML 原型（`.tmp/review-annotation-dock/`）

| 文件 | 作用 |
|------|------|
| `index.html` | 设计评审入口页（Hero + 6 状态 + 决策 + 工作流 + 交付） |
| `journey.html` | sj 视角叙事长文（7 幕 · editorial） |
| `compact.html` | 响应式三档设计规范（Wide / Medium / Compact mockup + 规则表） |
| `workspace.html` | 可交互 HTML 原型（Tailwind CDN · 双击打开） |
| `capture-*.mjs` | Playwright 自动截图脚本 |
| `state-*.png` | 6 张状态截图 |

### 2.3 关键 UX 决策

| 决策 | 内容 |
|------|------|
| 入口 | Ribbon 按钮 + 中央 dock 顶部 tab 切换（互斥，不并存）|
| 行单击 | 打开右侧 Drawer（保持当前 tab 不变）|
| 行双击 | 飞到 3D 对应构件（切回三维 tab）|
| 持久化 | session 级（Vue `ref`，不入 localStorage）|
| 断点 | Compact < 640 · Medium 640–1080 · Wide ≥ 1080 |

---

## 3. 技术方案

### 3.1 数据流

```
toolStore.annotations / cloudAnnotations / rectAnnotations / obbAnnotations
        │
        ▼ buildAnnotationWorkspaceItems (现有)
        │
AnnotationWorkspaceItem[]  ←───── 唯一数据源
        │
        ├─→ scopeByFormId (现有)
        ├─→ filterAnnotationWorkspaceItems (现有)
        │
        ├─→ searchAnnotationTableRows  (本计划新增)
        ├─→ sortAnnotationTableRows    (本计划新增)
        │
        └─→ [左栏卡片列表 / 中央表格 / 3D 图钉 / 右 Drawer]  ← 四端同源
```

**关键点**：不引入新的数据源或 store。表格视图就是对 `AnnotationWorkspaceItem[]` 的**第二种呈现**。

### 3.2 组件拆分

```
DesignerCommentHandlingPanel.vue  (容器，不改结构)
 ├─ 现有 task_entry 段 (不改)
 └─ workspace 段
     ├─ AnnotationWorkspace (现有，不改)
     └─ AnnotationTableView (新增)       ← PR 2 产物
         │
         ├─ useAnnotationTableFilter     (新增 · session 级状态)
         ├─ AnnotationTableToolbar       (新增 · 搜索 / 筛选 / 导出)
         ├─ AnnotationTableHeader        (新增 · 排序)
         ├─ AnnotationTableRow           (新增 · 单双击 / 快捷键)
         └─ AnnotationTableFooter        (新增 · 分页)
```

### 3.3 响应式策略

新增 `useDockLayoutMode.ts` hook，基于 `ResizeObserver`：

```ts
export type DockLayoutMode = 'compact' | 'medium' | 'wide';

const COMPACT_MAX = 640;
const MEDIUM_MAX = 1080;
```

容器组件根据 `mode` 决定：
- Drawer 变体：`push` → `overlay` → `fullscreen`
- 左栏是否常驻
- Tab bar 位置（顶部或底部）

---

## 4. 实施路径 · 4 个 PR

### PR 1 · 基础设施（**零风险 · 纯函数 · 今日合并**）

**目标**：落下排序/搜索/导出的纯函数和单元测试，**不触碰任何 UI 组件**。

| 新增文件 | 作用 | 行数 |
|---------|------|-----|
| `src/components/review/annotationTableSorting.ts` | `sortRows` / `filterByStatus` / `searchRows` 纯函数 | ~120 |
| `src/components/review/annotationTableSorting.test.ts` | Vitest 单测（覆盖排序/筛选/搜索边界）| ~180 |
| `src/components/review/annotationTableExport.ts` | `toCsv` · `downloadCsv` | ~60 |
| `src/components/review/annotationTableExport.test.ts` | CSV 转义 / 换行 / 特殊字符 | ~80 |

**合并门槛**：`npm run lint && npm run type-check && npm test` 全绿。

### PR 2 · 表格视图组件（**独立可跑**）

**目标**：`AnnotationTableView.vue` 组件开发 + 独立单测，**还不接入 dock**。

| 新增/改 | 内容 |
|---------|------|
| `src/components/review/AnnotationTableView.vue` | 表格主组件 · ~350 行 |
| `src/composables/useAnnotationTableFilter.ts` | session 级状态 (sort / filter / search) |
| `src/components/review/AnnotationTableView.test.ts` | 行渲染 / 排序点击 / 搜索输入 / 双击事件 |

### PR 3 · 接入 Dock 面板（**可见改动**）

**目标**：在 `DesignerCommentHandlingPanel.vue` 的中央区加入 tab 切换逻辑，集成 `AnnotationTableView`。

| 改动文件 | 内容 |
|---------|------|
| `DesignerCommentHandlingPanel.vue` | 加 `viewMode` ref · tab bar · 单双击路由 |
| `useDockLayoutMode.ts` | 新增 ResizeObserver hook |
| `DesignerCommentHandlingPanel.test.ts` | 补 3 个 test：tab 切换 / 单击 / 双击 |

### PR 4 · Ribbon 按钮（**加一个入口**）

**目标**：Ribbon 校审组加 `批注表格` 按钮，command 路由到 dock 面板的 `viewMode` 切换。

| 改动文件 | 内容 |
|---------|------|
| `src/ribbon/ribbonConfig.ts` | 新增 `panel.annotationTable` 命令 |
| `src/ribbon/ribbonIcons.ts` | 导出 `Table` 图标 |
| `DockLayout.vue` | `handleRibbonCommand` 路由 |

### PR 5（可选）· 响应式退化

**目标**：实现 Compact / Medium 档的 Drawer 浮层 / 全屏、左栏合并等。

---

## 5. 里程碑 · 建议节奏

| 阶段 | 内容 | 投入 |
|------|------|------|
| PR 1 | 纯函数 + 单测 | 3h（**今日即可合**）|
| PR 2 | 表格组件 | 5h |
| PR 3 | Dock 集成 | 3.5h |
| PR 4 | Ribbon 按钮 | 1.5h |
| PR 5 | 响应式（可选） | 4h |
| **总计** | — | **~17h**（≈ 2 个工作日）|

每个 PR 均可独立合并，前后不阻塞。

---

## 6. 测试策略

- **纯函数**：Vitest + happy-dom，覆盖所有边界（空列表 / 长文本搜索 / 未定义严重度）
- **组件**：Vue Test Utils + 事件断言
- **E2E**（延后）：Playwright 端到端走完"点击表格 tab → 搜索 → 排序 → 点击行 → drawer 打开"
- **视觉回归**：可用 Pencil 稿截图作为基准，新增 `e2e/annotation-table.spec.ts`（后续）

---

## 7. 验收标准

MVP 的"最小可验收"：

- [ ] 从三维查看器能点击中央 tab 切到表格态
- [ ] 表格展示当前任务下的所有批注，columns = `序号 | 错误标记 | 校核发现问题 | 处理情况 | 操作`
- [ ] 点击"错误标记"/"处理情况"列表头能触发排序
- [ ] 搜索框输入文字后 300ms 实时过滤
- [ ] 单击行打开 drawer · 双击行触发 3D 飞行
- [ ] 导出 CSV 按钮可用
- [ ] Ribbon 校审组有"批注表格"按钮
- [ ] `npm run lint && npm run type-check && npm test` 全绿
- [ ] 不破坏现有"task_entry → workspace"主流程

---

## 8. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解 |
|------|--------|------|------|
| 接入 dock 面板时破坏现有 embed 模式 | 中 | 高 | PR 3 先本地跑 `npm run test:e2e:pms`，确认 embed 不受影响 |
| 响应式退化与 `dockview-vue` 冲突 | 低 | 中 | PR 3 只做 tab 切换，响应式留到 PR 5 |
| 排序性能在大批注数下变差 | 低 | 低 | 表格暂时不虚拟滚动；批注 > 200 条的场景延后再优化 |

---

## 9. 非工程交付

- Pencil 画布（已在 `ui/三维校审/review-designer.pen`）作为永久设计参考
- HTML 原型包（`.tmp/review-annotation-dock/`）作为团队评审材料
- 本计划（`docs/plans/2026-04-22-annotation-dock-mvp-plan.md`）作为开发周期内的约束基准

---

## 10. 执行顺序

1. **立即执行 PR 1**（零风险，今日可合）
2. PR 1 合并后开 PR 2 分支
3. PR 2 合并后开 PR 3 分支
4. PR 4 可与 PR 3 并行（改动区互不相交）
5. PR 5 根据反馈决定是否做

附：当前会话将立即从 PR 1 开始执行。
