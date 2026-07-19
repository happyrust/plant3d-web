import { createEmptyDimensionDocument, type DimensionDocumentState } from './document';

import type {
  DimensionAccuracy,
  DimensionAnchor,
  SemanticAnchorRef,
  UserDimensionRecord,
  Vec3,
} from './types';
import type {
  LegacyDimensionArchive,
  LegacyDimensionBridgeArchive,
} from '../../migrations/legacyDimensionV5Archive';

export type V5MigrationDiagnostic = Readonly<{
  legacyId?: string;
  level: 'warning' | 'error';
  code:
    | 'world-only'
    | 'unsupported-kind'
    | 'malformed'
    | 'ignored-text-override'
    | 'ignored-reference';
  raw: unknown;
}>;

export type V5MigrationResult = Readonly<{
  state: DimensionDocumentState;
  diagnostics: readonly V5MigrationDiagnostic[];
}>;

export type LegacyDimensionMigrationContext = Readonly<{
  documentId: string;
  taskId?: string;
  formId?: string;
  actorId: string;
  actorRole: string;
}>;

type LegacyArchive = LegacyDimensionArchive | LegacyDimensionBridgeArchive;

type LegacyEntry = Readonly<{
  raw: unknown;
  archivedAt: number;
  sequence: number;
}>;

type MappedPoint = Readonly<{
  anchor: DimensionAnchor;
  unresolved: boolean;
  hasWorldCoordinates: boolean;
  malformed: boolean;
}>;

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function finiteVec3(value: unknown): Vec3 | null {
  if (
    !Array.isArray(value)
    || value.length !== 3
    || !value.every(
      coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate),
    )
  ) {
    return null;
  }
  return [value[0], value[1], value[2]];
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function semanticSource(
  value: unknown,
): SemanticAnchorRef['source'] | null {
  if (typeof value !== 'string') return null;
  switch (value.toLowerCase().replaceAll('_', '-')) {
    case 'ptset':
    case 'p-point':
      return 'p-point';
    case 'instance-origin':
    case 'position':
      return 'instance-origin';
    case 'primitive-key-point':
      return 'primitive-key-point';
    case 'model-surface':
    case 'mesh-pick-point':
    case 'surface':
      return 'model-surface';
    case 'circle':
      return 'circle';
    case 'arc':
      return 'arc';
    case 'direction':
      return 'direction';
    default:
      return null;
  }
}

function mapSemanticRef(
  point: Record<string, unknown>,
): SemanticAnchorRef | undefined {
  const sourceInfo = asObject(point.sourceInfo);
  if (!sourceInfo) return undefined;
  const source = semanticSource(sourceInfo.source);
  if (!source) return undefined;
  const refno = nonEmptyString(sourceInfo.refno)
    ?? nonEmptyString(point.entityId);
  const candidateId = nonEmptyString(sourceInfo.candidateId);
  return {
    source,
    ...(refno ? { refno } : {}),
    ...(candidateId ? { candidateId } : {}),
  };
}

function mapPoint(value: unknown): MappedPoint | null {
  const point = asObject(value);
  if (!point) return null;
  const snapshot = finiteVec3(point.designWorldPos);
  const worldCoordinates = finiteVec3(point.worldPos);
  const semanticRef = mapSemanticRef(point);
  const accuracy: DimensionAccuracy = semanticRef?.source === 'model-surface'
    ? 'approximate'
    : 'exact';
  return {
    anchor: {
      snapshot,
      accuracy,
      ...(semanticRef ? { semanticRef } : {}),
    },
    unresolved: snapshot === null,
    hasWorldCoordinates: worldCoordinates !== null,
    malformed: snapshot === null && worldCoordinates === null,
  };
}

function diagnostic(
  raw: unknown,
  code: V5MigrationDiagnostic['code'],
  level: V5MigrationDiagnostic['level'],
  legacyId?: string,
): V5MigrationDiagnostic {
  return {
    ...(legacyId ? { legacyId } : {}),
    level,
    code,
    raw,
  };
}

function appendIgnoredFieldDiagnostics(
  raw: Record<string, unknown>,
  legacyId: string,
  diagnostics: V5MigrationDiagnostic[],
): void {
  if (Object.hasOwn(raw, 'textOverride')) {
    diagnostics.push(
      diagnostic(raw, 'ignored-text-override', 'warning', legacyId),
    );
  }
  if (Object.hasOwn(raw, 'isReference')) {
    diagnostics.push(
      diagnostic(raw, 'ignored-reference', 'warning', legacyId),
    );
  }
}

function baseRecordFields(
  raw: Record<string, unknown>,
  archivedAt: number,
  context: LegacyDimensionMigrationContext,
): Readonly<{
  authorId: string;
  authorRole: string;
  createdAt: number;
  updatedAt: number;
}> {
  const createdAt = finiteNumber(raw.createdAt) ?? archivedAt;
  const updatedAt = finiteNumber(raw.updatedAt) ?? createdAt;
  return {
    authorId: context.actorId,
    authorRole: context.actorRole,
    createdAt,
    updatedAt,
  };
}

function mapLinearRecord(
  raw: Record<string, unknown>,
  legacyId: string,
  archivedAt: number,
  context: LegacyDimensionMigrationContext,
  diagnostics: V5MigrationDiagnostic[],
): UserDimensionRecord | null {
  const a = mapPoint(raw.origin);
  const b = mapPoint(raw.target);
  if (!a || !b) {
    diagnostics.push(diagnostic(raw, 'malformed', 'error', legacyId));
    return null;
  }
  if (a.hasWorldCoordinates && a.unresolved
    || b.hasWorldCoordinates && b.unresolved) {
    diagnostics.push(diagnostic(raw, 'world-only', 'error', legacyId));
  }
  if (a.malformed || b.malformed) {
    diagnostics.push(diagnostic(raw, 'malformed', 'error', legacyId));
  }
  appendIgnoredFieldDiagnostics(raw, legacyId, diagnostics);
  const offset = finiteNumber(raw.offset) ?? 0;
  return {
    id: legacyId,
    kind: 'linear',
    a: a.anchor,
    b: b.anchor,
    placement: {
      offsetM: Math.abs(offset),
      labelT: finiteNumber(raw.labelT) ?? 0.5,
      side: offset < 0 ? -1 : 1,
    },
    ...baseRecordFields(raw, archivedAt, context),
    validity: a.unresolved || b.unresolved ? 'invalid' : 'valid',
  };
}

function mapAngularRecord(
  raw: Record<string, unknown>,
  legacyId: string,
  archivedAt: number,
  context: LegacyDimensionMigrationContext,
  diagnostics: V5MigrationDiagnostic[],
): UserDimensionRecord | null {
  const rayA = mapPoint(raw.origin);
  const vertex = mapPoint(raw.corner);
  const rayB = mapPoint(raw.target);
  if (!rayA || !vertex || !rayB) {
    diagnostics.push(diagnostic(raw, 'malformed', 'error', legacyId));
    return null;
  }
  const points = [vertex, rayA, rayB];
  if (points.some(point => point.hasWorldCoordinates && point.unresolved)) {
    diagnostics.push(diagnostic(raw, 'world-only', 'error', legacyId));
  }
  if (points.some(point => point.malformed)) {
    diagnostics.push(diagnostic(raw, 'malformed', 'error', legacyId));
  }
  appendIgnoredFieldDiagnostics(raw, legacyId, diagnostics);
  const radiusM = finiteNumber(raw.offset);
  return {
    id: legacyId,
    kind: 'angular',
    vertex: vertex.anchor,
    rayA: rayA.anchor,
    rayB: rayB.anchor,
    placement: {
      ...(radiusM === null ? {} : { radiusM: Math.abs(radiusM) }),
      labelT: finiteNumber(raw.labelT) ?? 0.5,
      arcChoice: raw.supplementary === true ? 'major' : 'minor',
    },
    ...baseRecordFields(raw, archivedAt, context),
    validity: points.some(point => point.unresolved) ? 'invalid' : 'valid',
  };
}

function rawLegacyId(raw: unknown): string | null {
  const object = asObject(raw);
  return object ? nonEmptyString(object.id) ?? null : null;
}

function collectLatestEntries(archives: readonly LegacyArchive[]): LegacyEntry[] {
  const sorted = archives
    .map((archive, inputIndex) => ({ archive, inputIndex }))
    .sort((left, right) => (
      left.archive.archivedAt - right.archive.archivedAt
      || left.inputIndex - right.inputIndex
    ));
  const entries: LegacyEntry[] = [];
  sorted.forEach(({ archive }) => {
    archive.records.forEach((raw) => {
      entries.push({
        raw,
        archivedAt: archive.archivedAt,
        sequence: entries.length,
      });
    });
  });

  const latestSequenceById = new Map<string, number>();
  entries.forEach((entry) => {
    const id = rawLegacyId(entry.raw);
    if (id) latestSequenceById.set(id, entry.sequence);
  });
  return entries.filter((entry) => {
    const id = rawLegacyId(entry.raw);
    return id === null || latestSequenceById.get(id) === entry.sequence;
  });
}

export function migrateLegacyDimensionArchives(
  archives: readonly LegacyArchive[],
  context: LegacyDimensionMigrationContext,
): V5MigrationResult {
  const diagnostics: V5MigrationDiagnostic[] = [];
  const records: UserDimensionRecord[] = [];

  collectLatestEntries(archives).forEach((entry) => {
    const raw = asObject(entry.raw);
    if (!raw) {
      diagnostics.push(diagnostic(entry.raw, 'malformed', 'error'));
      return;
    }
    const legacyId = nonEmptyString(raw.id);
    if (!legacyId || typeof raw.kind !== 'string') {
      diagnostics.push(
        diagnostic(entry.raw, 'malformed', 'error', legacyId),
      );
      return;
    }

    let record: UserDimensionRecord | null;
    switch (raw.kind) {
      case 'linear_distance':
      case 'linear':
        record = mapLinearRecord(
          raw,
          legacyId,
          entry.archivedAt,
          context,
          diagnostics,
        );
        break;
      case 'angle':
      case 'angular':
        record = mapAngularRecord(
          raw,
          legacyId,
          entry.archivedAt,
          context,
          diagnostics,
        );
        break;
      default:
        diagnostics.push(
          diagnostic(entry.raw, 'unsupported-kind', 'warning', legacyId),
        );
        return;
    }
    if (record) records.push(record);
  });

  const state = createEmptyDimensionDocument({
    documentId: context.documentId,
    taskId: context.taskId,
    formId: context.formId,
  });
  return {
    state: {
      ...state,
      records,
    },
    diagnostics,
  };
}
