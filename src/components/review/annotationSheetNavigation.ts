import type { AnnotationWorkspaceItem } from './annotationWorkspaceModel';

import { UserRole } from '@/types/auth';

export function annotationWorkspaceItemKey(
  item: Pick<AnnotationWorkspaceItem, 'id' | 'type'>,
): string {
  return `${item.type}:${item.id}`;
}

export function isAnnotationActionableForRole(
  item: Pick<AnnotationWorkspaceItem, 'statusKey'>,
  role: UserRole | null | undefined,
): boolean {
  if (role === UserRole.ADMIN) {
    return item.statusKey !== 'approved';
  }

  if (role === UserRole.DESIGNER) {
    return item.statusKey === 'pending' || item.statusKey === 'rejected';
  }

  if (
    role === UserRole.PROOFREADER
    || role === UserRole.REVIEWER
    || role === UserRole.MANAGER
  ) {
    return item.statusKey === 'fixed' || item.statusKey === 'wont_fix';
  }

  return false;
}

export function findNextActionableAnnotation(
  items: AnnotationWorkspaceItem[],
  currentKey: string | null,
  isActionable: (item: AnnotationWorkspaceItem) => boolean,
): AnnotationWorkspaceItem | null {
  if (items.length === 0) return null;

  const currentIndex = currentKey
    ? items.findIndex((item) => annotationWorkspaceItemKey(item) === currentKey)
    : -1;
  const scanCount = currentIndex >= 0 ? items.length - 1 : items.length;

  for (let offset = 1; offset <= scanCount; offset += 1) {
    const index = currentIndex >= 0
      ? (currentIndex + offset) % items.length
      : offset - 1;
    const candidate = items[index];
    if (
      candidate
      && annotationWorkspaceItemKey(candidate) !== currentKey
      && isActionable(candidate)
    ) {
      return candidate;
    }
  }

  return null;
}
