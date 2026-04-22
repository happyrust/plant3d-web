# AnnotationTableView 响应式退化 · PR 2.5 详细设计 · 2026-04-22

> 本文档是 `docs/plans/2026-04-22-annotation-dock-mvp-plan.md` 的增量计划。
> 对应 HTML 原型 `.tmp/review-annotation-dock/compact.html` 的响应式规则落地到 Vue 组件。

## 0. 背景与定位

**为什么有这份 PR 2.5？**

PR 3（接入 Dock 面板）需要改 `DesignerCommentHandlingPanel.vue`，而该文件在当前工作区已有约 1157 行 WIP 改动（来自用户其它开发工作），直接叠加会造成 PR 边界不清。**本 PR 2.5 是 PR 2 的增量打磨 · 完全不触碰任何 M 状态文件**。

**交付**：让 `AnnotationTableView.vue` 在容器宽度变化时自动退化（而非仅依赖视口宽度）。

## 1. 需求

- 给 `AnnotationTableView.vue` 增加**容器级**响应式（container query）
- 三档断点：Wide ≥ 960 / Medium 640–960 / Compact < 640
- Wide 档：保持当前 5 列表格
- Medium 档：隐藏次要字段（description 描述），"处理情况"列收窄
- Compact 档：**表格 → 卡片**（纵向堆叠，每条批注一张卡片）
- 新增通用 `useContainerQuery` hook，未来 PR 3 的 `useDockLayoutMode` 可复用

## 2. API · `useContainerQuery`

```ts
import type { Ref } from 'vue';

export type ContainerQueryBreakpoint = 'compact' | 'medium' | 'wide';

export type ContainerQueryOptions = {
  /** 默认 640，低于此为 compact */
  compactMax?: number;
  /** 默认 960，低于此（但 ≥ compactMax）为 medium */
  mediumMax?: number;
  /** SSR / 测试环境下的初始值 */
  initialMode?: ContainerQueryBreakpoint;
};

export function useContainerQuery(
  target: Ref<HTMLElement | null>,
  options?: ContainerQueryOptions,
): {
  mode: Ref<ContainerQueryBreakpoint>;
  width: Ref<number>;
};
```

- **响应机制**：`ResizeObserver.observe(target)`
- **首帧即刻可用**：`watchEffect` 里一旦 `target.value` 存在就立刻算一次 `clientWidth`，不等 RO 第一次触发
- **清理**：`onBeforeUnmount` 断开 observer

## 3. Compact 卡片模式设计

当 `mode === 'compact'` 时，表格 head + row 的结构换成：

```
<div role="list" class="divide-y ...">
  <article role="listitem" v-for="item in pagedItems"
    class="rounded-lg p-3 ..." :class="activeRowClass">
    <!-- 第一行：序号徽章 + 严重度 pill -->
    <header class="flex items-center gap-2">
      <span class="font-mono">#{{ displayIndex }}</span>
      <span :class="severityPillClass(item)">{{ severityLabel }}</span>
      <button class="ml-auto" @click="locate">🎯</button>
    </header>
    <!-- 第二行：标题（1 行截断） -->
    <h3 class="font-semibold line-clamp-1 mt-1">{{ item.title }}</h3>
    <!-- 第三行：描述（2 行截断） -->
    <p class="text-xs line-clamp-2 text-slate-600 mt-0.5">{{ item.description }}</p>
    <!-- 第四行：处理情况 -->
    <footer class="flex items-center gap-2 mt-2 text-xs">
      <span :class="statusTextClass">{{ statusPrefix }} {{ item.statusLabel }}</span>
      <span v-if="commentCount > 0" class="text-slate-400">{{ commentCount }} 条讨论</span>
    </footer>
  </article>
</div>
```

- 工具栏在 Compact 下收窄：搜索框 `flex-1`，筛选 select 收到单行，导出按钮变 icon only
- 分页样式保持，但不显示"当前 1-10 / 共 N"文字，只保留 ← 页码 → 三个按钮

## 4. Medium 档变化

- Description 字段（`item.description`）隐藏，只保留 `item.title`
- "处理情况"列从 `w-56` 收窄到 `w-40`
- 导出按钮保留
- 其他维持 Wide 样式

## 5. 实施步骤细化

```
Step 1 · useContainerQuery.ts
Step 2 · useContainerQuery.test.ts · 3 用例（初始化 / 切换 / 清理）
Step 3 · AnnotationTableView.vue
  - 引入 useContainerQuery 接 rootEl
  - 把 template 的 table head / body 用 v-if="mode !== 'compact'" 包裹
  - 新增 v-else 卡片模式
  - 工具栏筛选 select 加 v-if="mode === 'wide'"（Medium 下合并为单按钮）
  - Medium 隐藏 description 用 v-if="mode === 'wide'"
Step 4 · AnnotationTableView.test.ts
  - 用 vi.stubGlobal('ResizeObserver', MockResizeObserver) 注入 mock
  - 断言 Compact 模式下 role="listitem" 出现
  - 断言 Wide 模式下 role="row" 出现
Step 5 · type-check / lint / test
Step 6 · commit + push
```

## 6. 测试策略 · ResizeObserver mock

```ts
class MockResizeObserver {
  callback: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.callback = cb; }
  observe(el: Element) {
    // 立刻触发一次
    this.callback(
      [{ target: el, contentRect: { width: el.clientWidth, height: el.clientHeight } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  disconnect() {}
  unobserve() {}
}
```

测试时用 `host.style.width = '500px'` 控制宽度，验证 mode 值。

## 7. 验收

- [ ] `npm run type-check` 通过
- [ ] `npx eslint` 通过
- [ ] 3 + 12 + 2 = 17 个组件相关测试全绿（useContainerQuery 3 + AnnotationTableView 14）
- [ ] Compact 模式下有 `role="listitem"` 卡片
- [ ] Medium 模式下隐藏 description 文本
- [ ] Wide 模式下行为完全等同 PR 2

## 8. 不做

- 不改 `DesignerCommentHandlingPanel.vue` · PR 3 的事
- 不做 `@container` CSS · 用 JS（兼容性好）
- 不做 Compact 下的键盘导航（cards 不是 listbox，移动端一般触控）
