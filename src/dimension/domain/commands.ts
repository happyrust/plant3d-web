import type { DimensionDocumentState } from './document';
import type {
  AngularPlacementIntent,
  DimensionAnchor,
  DimensionArcChoice,
  LinearPlacementIntent,
  RadialDisplay,
  RadialPlacementIntent,
  UserDimensionRecord,
} from './types';

export type DimensionActor = Readonly<{
  actorId: string;
  actorRole: string;
}>;

export type DimensionCommandIntent =
  | Readonly<{ type: 'create'; record: UserDimensionRecord }>
  | Readonly<{ type: 'restore'; record: UserDimensionRecord }>
  | Readonly<{ type: 'delete'; dimensionId: string }>
  | Readonly<{
    type: 'replace-placement';
    dimensionId: string;
    placement:
      | LinearPlacementIntent
      | AngularPlacementIntent
      | RadialPlacementIntent;
    labelPinned?: boolean;
  }>
  | Readonly<{
    type: 'set-label-pinned';
    dimensionId: string;
    labelPinned: boolean;
  }>
  | Readonly<{
    type: 'set-angle-arc';
    dimensionId: string;
    arcChoice: DimensionArcChoice;
  }>
  | Readonly<{
    type: 'set-radial-display';
    dimensionId: string;
    display: RadialDisplay;
  }>
  | Readonly<{
    type: 'rebind-anchor';
    dimensionId: string;
    anchorSlot: string;
    anchor: DimensionAnchor;
  }>;

export type DimensionCommand = Readonly<{
  commandId: string;
  actorId: string;
  actorRole: string;
  at: number;
}> & DimensionCommandIntent;

export type DimensionEvent =
  | Readonly<{
    type: 'created';
    commandId: string;
    record: UserDimensionRecord;
  }>
  | Readonly<{
    type: 'deleted';
    commandId: string;
    dimensionId: string;
    previous: UserDimensionRecord;
  }>
  | Readonly<{
    type: 'placement-replaced';
    commandId: string;
    dimensionId: string;
    previous: UserDimensionRecord['placement'];
    next: UserDimensionRecord['placement'];
    previousLabelPinned: boolean;
    nextLabelPinned: boolean;
  }>
  | Readonly<{
    type: 'label-pinned-set';
    commandId: string;
    dimensionId: string;
    previous: boolean;
    next: boolean;
  }>
  | Readonly<{
    type: 'angle-arc-set';
    commandId: string;
    dimensionId: string;
    previous: DimensionArcChoice;
    next: DimensionArcChoice;
  }>
  | Readonly<{
    type: 'radial-display-set';
    commandId: string;
    dimensionId: string;
    previous: RadialDisplay;
    next: RadialDisplay;
  }>
  | Readonly<{
    type: 'anchor-rebound';
    commandId: string;
    dimensionId: string;
    anchorSlot: string;
    previous: DimensionAnchor;
    next: DimensionAnchor;
  }>;

export type ReduceDimensionResult =
  | Readonly<{
    ok: true;
    state: DimensionDocumentState;
    event: DimensionEvent;
    inverse: DimensionCommandIntent;
  }>
  | Readonly<{
    ok: false;
    reason:
      | 'duplicate-id'
      | 'not-found'
      | 'forbidden'
      | 'kind-mismatch'
      | 'invalid-command';
  }>;
