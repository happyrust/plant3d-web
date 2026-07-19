import {
  dimensionRecordHasResolvedGeometry,
  isFiniteVec3,
} from './invariants';

import type { DimensionDocumentState } from './document';
import type {
  DimensionAnchor,
  SemanticAnchorRef,
  UserDimensionRecord,
  Vec3,
} from './types';
import type { DimensionAnchorResolver } from '../ports/anchorResolver';

type AnchorSlot = 'a' | 'b' | 'vertex' | 'rayA' | 'rayB' | 'center' | 'rim';
type DirectionSlot = 'axis' | 'normal';

type ResolutionTarget =
  | Readonly<{
    type: 'anchor';
    recordIndex: number;
    slot: AnchorSlot;
    semanticRef: SemanticAnchorRef;
  }>
  | Readonly<{
    type: 'direction';
    recordIndex: number;
    slot: DirectionSlot;
    semanticRef: SemanticAnchorRef;
  }>;

function pushAnchorTarget(
  targets: ResolutionTarget[],
  recordIndex: number,
  slot: AnchorSlot,
  anchor: DimensionAnchor,
): void {
  if (!anchor.semanticRef) return;
  targets.push({
    type: 'anchor',
    recordIndex,
    slot,
    semanticRef: anchor.semanticRef,
  });
}

function collectResolutionTargets(
  records: readonly UserDimensionRecord[],
): ResolutionTarget[] {
  const targets: ResolutionTarget[] = [];
  records.forEach((record, recordIndex) => {
    switch (record.kind) {
      case 'linear':
        pushAnchorTarget(targets, recordIndex, 'a', record.a);
        pushAnchorTarget(targets, recordIndex, 'b', record.b);
        break;
      case 'projected':
        pushAnchorTarget(targets, recordIndex, 'a', record.a);
        pushAnchorTarget(targets, recordIndex, 'b', record.b);
        if (record.axis.kind === 'semantic-direction') {
          targets.push({
            type: 'direction',
            recordIndex,
            slot: 'axis',
            semanticRef: record.axis.semanticRef,
          });
        }
        break;
      case 'angular':
        pushAnchorTarget(targets, recordIndex, 'vertex', record.vertex);
        pushAnchorTarget(targets, recordIndex, 'rayA', record.rayA);
        pushAnchorTarget(targets, recordIndex, 'rayB', record.rayB);
        break;
      case 'radial':
        pushAnchorTarget(targets, recordIndex, 'center', record.center);
        pushAnchorTarget(targets, recordIndex, 'rim', record.rim);
        if (record.normal.kind === 'semantic-direction') {
          targets.push({
            type: 'direction',
            recordIndex,
            slot: 'normal',
            semanticRef: record.normal.semanticRef,
          });
        }
        break;
    }
  });
  return targets;
}

function replaceAnchor(
  record: UserDimensionRecord,
  slot: AnchorSlot,
  anchor: DimensionAnchor,
): UserDimensionRecord {
  switch (record.kind) {
    case 'linear':
    case 'projected':
      return slot === 'a' || slot === 'b'
        ? { ...record, [slot]: anchor }
        : record;
    case 'angular':
      return slot === 'vertex' || slot === 'rayA' || slot === 'rayB'
        ? { ...record, [slot]: anchor }
        : record;
    case 'radial':
      return slot === 'center' || slot === 'rim'
        ? { ...record, [slot]: anchor }
        : record;
  }
}

function replaceDirection(
  record: UserDimensionRecord,
  slot: DirectionSlot,
  snapshot: Vec3,
  semanticRef: SemanticAnchorRef,
): UserDimensionRecord {
  if (
    record.kind === 'projected'
    && slot === 'axis'
    && record.axis.kind === 'semantic-direction'
  ) {
    return {
      ...record,
      axis: {
        kind: 'semantic-direction',
        snapshot,
        semanticRef,
      },
    };
  }
  if (
    record.kind === 'radial'
    && slot === 'normal'
    && record.normal.kind === 'semantic-direction'
  ) {
    return {
      ...record,
      normal: {
        kind: 'semantic-direction',
        snapshot,
        semanticRef,
      },
    };
  }
  return record;
}

export async function refreshDocumentAnchors(
  state: DimensionDocumentState,
  resolver: DimensionAnchorResolver,
  now: number,
): Promise<DimensionDocumentState> {
  const targets = collectResolutionTargets(state.records);
  if (targets.length === 0) return state;

  const results = await resolver.resolveMany(
    targets.map(target => target.semanticRef),
  );
  const records = [...state.records];
  const failedRecords = new Set<number>();
  const touchedRecords = new Set<number>();

  targets.forEach((target, resultIndex) => {
    touchedRecords.add(target.recordIndex);
    const result = results[resultIndex];
    if (
      !result
      || !result.ok
      || !isFiniteVec3(result.anchor.snapshot)
      || (result.anchor.accuracy !== 'exact'
        && result.anchor.accuracy !== 'approximate')
    ) {
      failedRecords.add(target.recordIndex);
      return;
    }

    const record = records[target.recordIndex]!;
    if (target.type === 'anchor') {
      records[target.recordIndex] = replaceAnchor(
        record,
        target.slot,
        {
          snapshot: result.anchor.snapshot,
          accuracy: result.anchor.accuracy,
          semanticRef: target.semanticRef,
        },
      );
      return;
    }
    records[target.recordIndex] = replaceDirection(
      record,
      target.slot,
      result.anchor.snapshot,
      target.semanticRef,
    );
  });

  touchedRecords.forEach((recordIndex) => {
    const record = records[recordIndex]!;
    records[recordIndex] = {
      ...record,
      updatedAt: now,
      validity: failedRecords.has(recordIndex)
        || !dimensionRecordHasResolvedGeometry(record)
        ? 'invalid'
        : 'valid',
    };
  });

  return {
    ...state,
    records,
  };
}
