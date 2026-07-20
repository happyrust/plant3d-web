import { canEditUserDimension } from '../domain/permissions';
import { dimensionAnchorSlots } from '../interaction/editSession';

import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';
import type { UserDimensionRecord } from '../domain/types';
import type { DimensionAnchorSlot } from '../interaction/editSession';

export type DimensionRebindAction = `rebind:${DimensionAnchorSlot}`;

export type DimensionBoundAction =
  | 'select'
  | 'delete'
  | 'flip-angle'
  | 'toggle-radial-display'
  | 'hide-external'
  | DimensionRebindAction;

export function isDimensionRebindAction(
  action: DimensionBoundAction,
): action is DimensionRebindAction {
  return action.startsWith('rebind:');
}

export function rebindActionSlot(
  action: DimensionRebindAction,
): DimensionAnchorSlot {
  return action.slice('rebind:'.length) as DimensionAnchorSlot;
}

export function isExternalDimensionRecord(
  item: UserDimensionRecord | ExternalDimensionRecord,
): item is ExternalDimensionRecord {
  return 'sourceLabel' in item && 'layout' in item;
}

export function getDimensionBoundActions(
  item: UserDimensionRecord | ExternalDimensionRecord,
  user: { id: string; role: string } | null,
): readonly DimensionBoundAction[] {
  if (isExternalDimensionRecord(item)) {
    return ['select', 'hide-external'];
  }
  if (!canEditUserDimension(user, item)) return ['select'];

  const actions: DimensionBoundAction[] = [
    'select',
    ...dimensionAnchorSlots(item).map(
      slot => `rebind:${slot}` as DimensionRebindAction,
    ),
    'delete',
  ];
  if (item.kind === 'angular') actions.push('flip-angle');
  if (item.kind === 'radial') actions.push('toggle-radial-display');
  return actions;
}
