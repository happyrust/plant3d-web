# Ribbon 批注表格按钮角色可见性 · PR 10 详细设计 · 2026-04-23

> 承接 PR 9（`docs/plans/2026-04-23-ribbon-annotation-table-smart-dispatch-pr9-design.md`）：
> Ribbon 的 `panel.annotationTable` 按钮已按用户角色 / 面板状态智能分发。本 PR 让按钮按角色**可见/隐藏**：VIEWER 等无关角色直接不显示这个按钮。

## 0. 动机

- `panel.annotationTable` 按钮对普通只读查看者（VIEWER）毫无意义——他们既没有 DCH 面板也没有 Reviewer 工作台
- 隐藏按钮比禁用更干净，避免 UI 噪音；同时也避免了"按钮亮着但点击无响应"的体验 glitch
- 引入通用的 `roles` 可见性字段，为后续其他按钮（如"发起编校审"只对 sj、"待审核"只对 jh/sh）的角色化奠定基础
- 本 PR 严格限制 scope：**只**给 `panel.annotationTable` 设置 roles，不对其他既有按钮做角色化（避免连锁破坏现有用户预期）

## 1. 目标

- `RibbonButtonItem` 类型新增可选 `roles: UserRole[]` 字段——如果声明，仅对拥有列出角色之一的用户可见
- 新增纯函数 `filterRibbonItemsForUser(items, role)`——接受 items 数组与当前用户角色，返回过滤后的 items
- `RibbonBar.vue` 接入：读取 `useUserStore().currentUser.value?.role`，对每个 group 的 items 做过滤后渲染
- `panel.annotationTable` 在 `ribbonConfig.ts` 标记 `roles: [DESIGNER, PROOFREADER, REVIEWER, MANAGER, ADMIN]`（即非 VIEWER）

## 2. 非目标

- **不**对其他 review 按钮做角色化（`panel.initiateReview`、`panel.review`、`panel.reviewerTasks`、`panel.resubmissionTasks`、`panel.myTasks` 保持现状）
- **不**改 stack / separator 的可见性（只针对 `button` kind）
- **不**改 Ribbon tab 级别的可见性（如"校审" tab 对 VIEWER 仍然可见）
- **不**做命令层拦截（`onClickCommand` 行为不变；按钮隐藏后不会被点到）

## 3. 设计

### 3.1 Type 改动

```ts
// ribbonTypes.ts
import type { UserRole } from '@/types/auth';

export type RibbonButtonItem = {
  kind: 'button';
  id: string;
  label: string;
  icon?: string;
  commandId: string;
  disabled?: boolean;
  /** 若声明，仅当前用户角色命中此列表时可见；未声明则始终可见 */
  roles?: UserRole[];
};
```

### 3.2 纯函数 · `ribbonItemVisibility.ts`

```ts
import type { RibbonItem, RibbonButtonItem } from './ribbonTypes';
import type { UserRole } from '@/types/auth';

/** 判断单个按钮 item 是否对当前用户角色可见 */
export function isRibbonButtonVisibleForRole(
  item: RibbonButtonItem,
  userRole: UserRole | undefined,
): boolean {
  if (!item.roles || item.roles.length === 0) return true;
  if (!userRole) return false; // 有限制但没角色 → 隐藏（保守策略）
  return item.roles.includes(userRole);
}

/** 过滤 items 数组，仅保留当前用户可见的条目；stack / separator 原样保留 */
export function filterRibbonItemsForUser(
  items: RibbonItem[],
  userRole: UserRole | undefined,
): RibbonItem[] {
  return items.filter((item) => {
    if (item.kind !== 'button') return true;
    return isRibbonButtonVisibleForRole(item, userRole);
  });
}
```

关键：
- `RibbonStackItem.items` 内部的 buttons 如果需要角色化，本 PR 不动（作为 follow-up）；目前 `review.panel` group 里的按钮都是顶层 button，没用到 stack，够用
- `separator` 逻辑上可能会变成孤悬（如最后一项被过滤后留下尾随 separator），MVP 不做优化（暂不影响现有配置）

### 3.3 `RibbonBar.vue` 接入

```ts
import { useUserStore } from '@/composables/useUserStore';
import { filterRibbonItemsForUser } from '@/ribbon/ribbonItemVisibility';

const userStore = useUserStore();

const activeTabVisibleGroups = computed(() => {
  const tab = activeTab.value;
  if (!tab) return [];
  const userRole = userStore.currentUser.value?.role;
  return tab.groups.map((group) => ({
    ...group,
    items: filterRibbonItemsForUser(group.items, userRole),
  }));
});
```

Template：`v-for="group in activeTabVisibleGroups"`（取代原 `activeTab?.groups`）。

### 3.4 `ribbonConfig.ts` 改动

只改一行（`panel.annotationTable` 按钮）：

```ts
{
  kind: 'button',
  id: 'panel.annotationTable',
  label: '批注表格',
  icon: 'table',
  commandId: 'panel.annotationTable',
  roles: [
    UserRole.DESIGNER,
    UserRole.PROOFREADER,
    UserRole.REVIEWER,
    UserRole.MANAGER,
    UserRole.ADMIN,
  ],
},
```

## 4. 变更清单

| 文件 | 变更 | 新/改 |
|------|------|------|
| `src/ribbon/ribbonTypes.ts` | 加 `roles?: UserRole[]` | 改（~5 行） |
| `src/ribbon/ribbonItemVisibility.ts` | 纯函数 2 个 | 新（~30 行） |
| `src/ribbon/ribbonItemVisibility.test.ts` | 6 用例（默认可见 / roles 命中 / 不命中 / 无 role 有限制 / 空 role 列表 / stack+separator 原样） | 新（~120 行） |
| `src/ribbon/ribbonConfig.ts` | 给 `panel.annotationTable` 加 roles | 改（~8 行） |
| `src/components/ribbon/RibbonBar.vue` | import + computed + 模板切到 visibleGroups | 改（~10 行） |
| `CHANGELOG.md` | PR 10 段 | 改 |
| `docs/plans/2026-04-23-ribbon-annotation-table-role-visibility-pr10-design.md` | 本文件 | 新 |

## 5. 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 现有 E2E（`annotation-table-ribbon.spec.ts`）期望按钮可见 | 高 | E2E 入口 URL `/?output_project=AvevaMarineSample&show_dbnum=7997` 默认用什么角色登录？ 需要确认，若是 VIEWER 会挂；实际运行时 `useUserStore` 默认是 designer_001（由 persistedState 初始值决定），PR 10 对 DESIGNER 不做隐藏，故 E2E 仍然绿 |
| `RibbonBar.vue` 没现成单测，新增的 computed 逻辑难以 unit 覆盖 | 中 | 过滤逻辑抽到独立纯函数 `filterRibbonItemsForUser`，在 `ribbonItemVisibility.test.ts` 里 100% 覆盖；`RibbonBar.vue` 只做 wiring |
| `currentUser.value?.role` 在未登录场景下是 undefined | 中 | 纯函数中已处理："有 roles 限制 + 无 role" → 隐藏；无限制则始终可见（向后兼容，未登录用户仍看到多数按钮） |
| 未来 stack 内按钮需要角色化 | 低 | 本 PR 只管顶层 button，stack 留给 follow-up PR；类型扩展 stack 时再递归过滤 |

## 6. 验收

- [ ] `ribbonItemVisibility.test.ts` 6 用例全绿
- [ ] `vue-tsc --noEmit` 全绿
- [ ] `eslint` 新/改文件全绿
- [ ] 其他测试无回归（特别关注 `RibbonBar` 如果有测试，本地无现有测试文件；`DockLayout.test.ts` 5/5 仍绿）
- [ ] E2E `annotation-table-ribbon.spec.ts` 不自动跑，但该测试流程用的是默认 designer 用户，不受隐藏影响（VIEWER 才会被隐藏）
- [ ] CHANGELOG 加 PR 10 段

## 7. 手动验证（可选）

```
1. 切换到 VIEWER 角色（demo 用户），打开校审 tab → "批注表格" 按钮应不显示
2. 切回 DESIGNER（sj_001） → 按钮显示
3. 切 REVIEWER（jh_001） → 按钮显示
4. 未登录（currentUser = null） → 按钮不显示（因为声明了 roles 且无 role）
```

## 8. 后续建议（超出 PR 10 scope）

- **PR 11**：把"批注表格"按钮根据角色**标签化**——对 sj 显示"批注处理"、对 jh 显示"批注表格"（但这可能违反 UX 一致性，需讨论）
- **PR 12**：扩展 stack 内按钮角色过滤（需要递归）
- **PR 13**：给其他 review 按钮也设置 roles（`panel.initiateReview` 限制 sj + manager；`panel.reviewerTasks` 限制 jh/sh/pz/admin 等），需要用户角色矩阵评审后再做
