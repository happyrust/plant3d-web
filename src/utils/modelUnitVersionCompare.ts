import type { ModelUnitCommitData } from '@/api/modelUnitVersionApi';

export type ModelUnitGeometryStatus = 'added' | 'deleted' | 'modified' | 'unchanged'

export type ModelUnitGeometrySnapshot = {
  refno: string
  noun: string
  signature: string
}

export type ModelUnitGeometryDiff = {
  refno: string
  noun: string
  status: ModelUnitGeometryStatus
}

export const MODEL_UNIT_VERSION_COMPARE_EVENT = 'plant3d:model-unit-version-compare';
export type ModelUnitCompareSide = 'before' | 'after'
export const DEFAULT_MODEL_UNIT_COMPARE_SIDE: ModelUnitCompareSide = 'after';

type VersionVisibilityLayer = {
  setAllVisible: (visible: boolean) => void
}

type ObjectVisibilityLayer = {
  setObjectVisible: (objectId: string, visible: boolean) => void
}

export function applyModelUnitVersionSide(
  beforeLayer: VersionVisibilityLayer | undefined,
  afterLayer: VersionVisibilityLayer | undefined,
  side: ModelUnitCompareSide,
): void {
  beforeLayer?.setAllVisible(side === 'before');
  afterLayer?.setAllVisible(side === 'after');
}

export function collectModelUnitTargetObjectIds(
  unitRefno: string,
  targetRefnos: string[],
  resolveByRefno: (refno: string) => string[],
  resolveByUnitRefno: (unitRefno: string) => string[],
): string[] {
  const objectIds = new Set(resolveByUnitRefno(unitRefno));
  for (const refno of targetRefnos) {
    for (const objectId of resolveByRefno(refno)) objectIds.add(objectId);
  }
  return [...objectIds];
}

export function applyModelUnitRefnoVisibility(
  layer: ObjectVisibilityLayer,
  visibilityByRefno: Map<string, boolean>,
  resolveByRefno: (refno: string) => string[],
): void {
  for (const [refno, visible] of visibilityByRefno) {
    for (const objectId of resolveByRefno(refno)) layer.setObjectVisible(objectId, visible);
  }
}

export type ModelUnitVersionSide = {
  sesno: number
  artifactSesno: number
  manifestUrl: string | null
  generatedAt: string
  refnos: string[]
}

export function formatModelUnitVersionTime(generatedAt: string): string {
  const date = new Date(generatedAt);
  return Number.isNaN(date.getTime())
    ? generatedAt
    : date.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
}

export type ModelUnitVersionCompareEventDetail =
  | {
      action: 'open'
      dbnum: number
      unitRefno: string
      before: ModelUnitVersionSide
      after: ModelUnitVersionSide
      refnos: string[]
      rows: ModelUnitGeometryDiff[]
    }
  | { action: 'focus'; refno: string }
  | { action: 'close' }

type GeometryEntryLike = {
  geo_hash?: unknown
  geo_index?: unknown
  matrix?: unknown
  uniforms?: { noun?: unknown }
}

export function geometrySnapshotsFromInstanceEntries(
  entriesByRefno: Map<string, GeometryEntryLike[]>,
): ModelUnitGeometrySnapshot[] {
  return [...entriesByRefno.entries()].map(([refno, entries]) => {
    const parts = entries.map((entry) => JSON.stringify([
      String(entry.geo_hash ?? ''),
      Number(entry.geo_index ?? 0),
      Array.isArray(entry.matrix) ? entry.matrix.map(Number) : [],
    ])).sort();
    return {
      refno,
      noun: String(entries[0]?.uniforms?.noun ?? ''),
      signature: parts.join('|'),
    };
  }).sort((a, b) => a.refno.localeCompare(b.refno));
}

export function orderModelUnitVersionPair<T extends Pick<ModelUnitCommitData, 'commit'>>(
  first: T,
  second: T,
): [T, T] {
  return first.commit.sesno <= second.commit.sesno ? [first, second] : [second, first];
}

export function compareModelUnitGeometry(
  before: ModelUnitGeometrySnapshot[],
  after: ModelUnitGeometrySnapshot[],
): ModelUnitGeometryDiff[] {
  const beforeByRefno = new Map(before.map((item) => [item.refno, item]));
  const afterByRefno = new Map(after.map((item) => [item.refno, item]));
  const refnos = new Set([...beforeByRefno.keys(), ...afterByRefno.keys()]);
  const rank: Record<ModelUnitGeometryStatus, number> = {
    added: 0,
    deleted: 1,
    modified: 2,
    unchanged: 3,
  };

  return [...refnos].map((refno): ModelUnitGeometryDiff => {
    const oldItem = beforeByRefno.get(refno);
    const newItem = afterByRefno.get(refno);
    const status: ModelUnitGeometryStatus = !oldItem
      ? 'added'
      : !newItem
        ? 'deleted'
        : oldItem.signature === newItem.signature
          ? 'unchanged'
          : 'modified';
    return { refno, noun: newItem?.noun || oldItem?.noun || '', status };
  }).sort((a, b) => rank[a.status] - rank[b.status] || a.refno.localeCompare(b.refno));
}
