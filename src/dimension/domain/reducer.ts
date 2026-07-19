import {
  dimensionRecordHasResolvedGeometry,
  isFiniteVec3,
  isNonZeroVec3,
} from './invariants';

import type {
  DimensionCommand,
  ReduceDimensionResult,
} from './commands';
import type { DimensionDocumentState } from './document';
import type {
  AngularPlacementIntent,
  DimensionAnchor,
  LinearPlacementIntent,
  ProjectionAxisRef,
  RadialPlacementIntent,
  SemanticAnchorRef,
  UserDimensionRecord,
} from './types';

type ReduceFailureReason = Extract<
  ReduceDimensionResult,
  { ok: false }
>['reason'];

function failure(reason: ReduceFailureReason): ReduceDimensionResult {
  return { ok: false, reason };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSemanticAnchorRef(value: unknown): value is SemanticAnchorRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const sources = [
    'p-point',
    'instance-origin',
    'primitive-key-point',
    'model-surface',
    'circle',
    'arc',
    'direction',
  ];
  return typeof candidate.source === 'string'
    && sources.includes(candidate.source)
    && (candidate.refno === undefined || typeof candidate.refno === 'string')
    && (candidate.candidateId === undefined
      || typeof candidate.candidateId === 'string');
}

function isDimensionAnchor(value: unknown): value is DimensionAnchor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.snapshot === null || isFiniteVec3(candidate.snapshot))
    && (candidate.accuracy === 'exact' || candidate.accuracy === 'approximate')
    && (candidate.semanticRef === undefined
      || isSemanticAnchorRef(candidate.semanticRef));
}

function isProjectionAxisRef(value: unknown): value is ProjectionAxisRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'design-axis') {
    return candidate.axis === 'x'
      || candidate.axis === 'y'
      || candidate.axis === 'z';
  }
  return candidate.kind === 'semantic-direction'
    && isNonZeroVec3(candidate.snapshot)
    && isSemanticAnchorRef(candidate.semanticRef);
}

function isLinearPlacement(value: unknown): value is LinearPlacementIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isFiniteNumber(candidate.offsetM)
    && candidate.offsetM >= 0
    && isFiniteNumber(candidate.labelT)
    && (candidate.side === 1 || candidate.side === -1);
}

function isAngularPlacement(value: unknown): value is AngularPlacementIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.radiusM === undefined
      || (isFiniteNumber(candidate.radiusM) && candidate.radiusM >= 0))
    && isFiniteNumber(candidate.labelT)
    && (candidate.arcChoice === 'minor' || candidate.arcChoice === 'major');
}

function isRadialPlacement(value: unknown): value is RadialPlacementIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isNonZeroVec3(candidate.leaderDirection)
    && isFiniteNumber(candidate.labelDistanceM)
    && candidate.labelDistanceM >= 0;
}

function placementKind(
  placement: unknown,
): UserDimensionRecord['kind'] | 'invalid' {
  if (isLinearPlacement(placement)) return 'linear';
  if (isAngularPlacement(placement)) return 'angular';
  if (isRadialPlacement(placement)) return 'radial';
  return 'invalid';
}

function hasValidCommonFields(record: Record<string, unknown>): boolean {
  return isNonEmptyString(record.id)
    && isNonEmptyString(record.authorId)
    && isNonEmptyString(record.authorRole)
    && isFiniteNumber(record.createdAt)
    && isFiniteNumber(record.updatedAt)
    && (record.validity === 'valid' || record.validity === 'invalid');
}

function isUserDimensionRecord(value: unknown): value is UserDimensionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!hasValidCommonFields(record)) return false;

  let structurallyValid: boolean;
  switch (record.kind) {
    case 'linear':
      structurallyValid = isDimensionAnchor(record.a)
        && isDimensionAnchor(record.b)
        && isLinearPlacement(record.placement);
      break;
    case 'projected':
      structurallyValid = isDimensionAnchor(record.a)
        && isDimensionAnchor(record.b)
        && isProjectionAxisRef(record.axis)
        && isLinearPlacement(record.placement);
      break;
    case 'angular':
      structurallyValid = isDimensionAnchor(record.vertex)
        && isDimensionAnchor(record.rayA)
        && isDimensionAnchor(record.rayB)
        && isAngularPlacement(record.placement);
      break;
    case 'radial':
      structurallyValid = isDimensionAnchor(record.center)
        && isDimensionAnchor(record.rim)
        && isProjectionAxisRef(record.normal)
        && (record.display === 'radius' || record.display === 'diameter')
        && isRadialPlacement(record.placement);
      break;
    default:
      return false;
  }
  if (!structurallyValid) return false;
  return record.validity !== 'valid'
    || dimensionRecordHasResolvedGeometry(record as UserDimensionRecord);
}

function canMutate(
  command: DimensionCommand,
  record: UserDimensionRecord,
): boolean {
  return command.actorId === record.authorId
    || command.actorRole.toLowerCase() === 'admin';
}

function replaceRecord(
  state: DimensionDocumentState,
  index: number,
  next: UserDimensionRecord,
): DimensionDocumentState {
  return {
    ...state,
    records: state.records.map((record, recordIndex) => (
      recordIndex === index ? next : record
    )),
  };
}

function findMutableRecord(
  state: DimensionDocumentState,
  command: DimensionCommand & { dimensionId: string },
): Readonly<
  | { ok: true; index: number; record: UserDimensionRecord }
  | { ok: false; result: ReduceDimensionResult }
> {
  const index = state.records.findIndex(
    record => record.id === command.dimensionId,
  );
  if (index < 0) {
    return { ok: false, result: failure('not-found') };
  }
  const record = state.records[index]!;
  if (!canMutate(command, record)) {
    return { ok: false, result: failure('forbidden') };
  }
  return { ok: true, index, record };
}

function commandMetadataIsValid(command: DimensionCommand): boolean {
  return isNonEmptyString(command.commandId)
    && isNonEmptyString(command.actorId)
    && isNonEmptyString(command.actorRole)
    && isFiniteNumber(command.at);
}

function withResolvedValidity(
  record: UserDimensionRecord,
): UserDimensionRecord {
  return {
    ...record,
    validity: dimensionRecordHasResolvedGeometry(record) ? 'valid' : 'invalid',
  };
}

function rebindRecord(
  record: UserDimensionRecord,
  anchorSlot: string,
  anchor: DimensionAnchor,
  updatedAt: number,
): UserDimensionRecord | null {
  switch (record.kind) {
    case 'linear':
    case 'projected':
      if (anchorSlot !== 'a' && anchorSlot !== 'b') return null;
      return withResolvedValidity({
        ...record,
        [anchorSlot]: anchor,
        updatedAt,
      } as UserDimensionRecord);
    case 'angular':
      if (
        anchorSlot !== 'vertex'
        && anchorSlot !== 'rayA'
        && anchorSlot !== 'rayB'
      ) return null;
      return withResolvedValidity({
        ...record,
        [anchorSlot]: anchor,
        updatedAt,
      } as UserDimensionRecord);
    case 'radial':
      if (anchorSlot !== 'center' && anchorSlot !== 'rim') return null;
      return withResolvedValidity({
        ...record,
        [anchorSlot]: anchor,
        updatedAt,
      } as UserDimensionRecord);
  }
}

function anchorAt(
  record: UserDimensionRecord,
  anchorSlot: string,
): DimensionAnchor | null {
  switch (record.kind) {
    case 'linear':
    case 'projected':
      return anchorSlot === 'a' || anchorSlot === 'b'
        ? record[anchorSlot]
        : null;
    case 'angular':
      return anchorSlot === 'vertex'
        || anchorSlot === 'rayA'
        || anchorSlot === 'rayB'
        ? record[anchorSlot]
        : null;
    case 'radial':
      return anchorSlot === 'center' || anchorSlot === 'rim'
        ? record[anchorSlot]
        : null;
  }
}

export function reduceDimensionDocument(
  state: DimensionDocumentState,
  command: DimensionCommand,
): ReduceDimensionResult {
  if (!commandMetadataIsValid(command)) return failure('invalid-command');

  switch (command.type) {
    case 'create':
    case 'restore': {
      if (!isUserDimensionRecord(command.record)) {
        return failure('invalid-command');
      }
      const isRestore = command.type === 'restore';
      const mayCreate = command.actorId === command.record.authorId
        || (isRestore && command.actorRole.toLowerCase() === 'admin');
      if (!mayCreate) {
        return failure('forbidden');
      }
      if (state.records.some(record => record.id === command.record.id)) {
        return failure('duplicate-id');
      }
      return {
        ok: true,
        state: {
          ...state,
          records: [...state.records, command.record],
        },
        event: {
          type: 'created',
          commandId: command.commandId,
          record: command.record,
        },
        inverse: {
          type: 'delete',
          dimensionId: command.record.id,
        },
      };
    }
    case 'delete': {
      const found = findMutableRecord(state, command);
      if (!found.ok) return found.result;
      return {
        ok: true,
        state: {
          ...state,
          records: state.records.filter(
            record => record.id !== command.dimensionId,
          ),
        },
        event: {
          type: 'deleted',
          commandId: command.commandId,
          dimensionId: command.dimensionId,
          previous: found.record,
        },
        inverse: {
          type: 'restore',
          record: found.record,
        },
      };
    }
    case 'replace-placement': {
      const found = findMutableRecord(state, command);
      if (!found.ok) return found.result;
      const suppliedKind = placementKind(command.placement);
      if (suppliedKind === 'invalid') return failure('invalid-command');
      const expectedKind = found.record.kind === 'projected'
        ? 'linear'
        : found.record.kind;
      if (suppliedKind !== expectedKind) return failure('kind-mismatch');
      const next = {
        ...found.record,
        placement: command.placement,
        updatedAt: command.at,
      } as UserDimensionRecord;
      return {
        ok: true,
        state: replaceRecord(state, found.index, next),
        event: {
          type: 'placement-replaced',
          commandId: command.commandId,
          dimensionId: command.dimensionId,
          previous: found.record.placement,
          next: next.placement,
        },
        inverse: {
          type: 'replace-placement',
          dimensionId: command.dimensionId,
          placement: found.record.placement,
        },
      };
    }
    case 'set-angle-arc': {
      if (command.arcChoice !== 'minor' && command.arcChoice !== 'major') {
        return failure('invalid-command');
      }
      const found = findMutableRecord(state, command);
      if (!found.ok) return found.result;
      if (found.record.kind !== 'angular') {
        return failure('kind-mismatch');
      }
      const previous = found.record.placement.arcChoice;
      const next: UserDimensionRecord = {
        ...found.record,
        placement: {
          ...found.record.placement,
          arcChoice: command.arcChoice,
        },
        updatedAt: command.at,
      };
      return {
        ok: true,
        state: replaceRecord(state, found.index, next),
        event: {
          type: 'angle-arc-set',
          commandId: command.commandId,
          dimensionId: command.dimensionId,
          previous,
          next: command.arcChoice,
        },
        inverse: {
          type: 'set-angle-arc',
          dimensionId: command.dimensionId,
          arcChoice: previous,
        },
      };
    }
    case 'set-radial-display': {
      if (command.display !== 'radius' && command.display !== 'diameter') {
        return failure('invalid-command');
      }
      const found = findMutableRecord(state, command);
      if (!found.ok) return found.result;
      if (found.record.kind !== 'radial') {
        return failure('kind-mismatch');
      }
      const previous = found.record.display;
      const next: UserDimensionRecord = {
        ...found.record,
        display: command.display,
        updatedAt: command.at,
      };
      return {
        ok: true,
        state: replaceRecord(state, found.index, next),
        event: {
          type: 'radial-display-set',
          commandId: command.commandId,
          dimensionId: command.dimensionId,
          previous,
          next: command.display,
        },
        inverse: {
          type: 'set-radial-display',
          dimensionId: command.dimensionId,
          display: previous,
        },
      };
    }
    case 'rebind-anchor': {
      if (!isDimensionAnchor(command.anchor) || command.anchor.snapshot === null) {
        return failure('invalid-command');
      }
      const found = findMutableRecord(state, command);
      if (!found.ok) return found.result;
      const previous = anchorAt(found.record, command.anchorSlot);
      if (!previous) return failure('kind-mismatch');
      const next = rebindRecord(
        found.record,
        command.anchorSlot,
        command.anchor,
        command.at,
      );
      if (!next) return failure('kind-mismatch');
      return {
        ok: true,
        state: replaceRecord(state, found.index, next),
        event: {
          type: 'anchor-rebound',
          commandId: command.commandId,
          dimensionId: command.dimensionId,
          anchorSlot: command.anchorSlot,
          previous,
          next: command.anchor,
        },
        inverse: {
          type: 'rebind-anchor',
          dimensionId: command.dimensionId,
          anchorSlot: command.anchorSlot,
          anchor: previous,
        },
      };
    }
    default:
      return failure('invalid-command');
  }
}
