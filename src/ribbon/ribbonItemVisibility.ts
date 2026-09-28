/**
 * ribbonItemVisibility · Ribbon 按钮角色可见性过滤
 *
 * MVP++ PR 10 · 2026-04-23
 *
 * 目前只处理顶层 `button`；`stack` 内嵌按钮与 `separator` 本 PR 原样保留。
 * 参见 `docs/plans/2026-04-23-ribbon-annotation-table-role-visibility-pr10-design.md`。
 */

import type { RibbonButtonItem, RibbonItem } from './ribbonTypes';
import type { UserRole } from '@/types/auth';

/** 判断单个按钮 item 是否对当前用户角色可见 */
export function isRibbonButtonVisibleForRole(
  item: RibbonButtonItem,
  userRole: UserRole | undefined,
): boolean {
  if (!item.roles || item.roles.length === 0) return true;
  if (!userRole) return false;
  return item.roles.includes(userRole);
}

/** 过滤 items 数组，仅保留当前用户可见的按钮；stack / separator 原样保留 */
export function filterRibbonItemsForUser(
  items: RibbonItem[],
  userRole: UserRole | undefined,
): RibbonItem[] {
  return items.filter((item) => {
    if (item.kind !== 'button') return true;
    return isRibbonButtonVisibleForRole(item, userRole);
  });
}
