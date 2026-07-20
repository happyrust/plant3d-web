import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';

export type ExternalDimensionSource = 'bran-clearance' | 'mbd';

export type ExternalDimensionRegistrySnapshot = Readonly<{
  records: readonly ExternalDimensionRecord[];
  visibleRecords: readonly ExternalDimensionRecord[];
  hiddenIds: ReadonlySet<string>;
}>;

export type ExternalDimensionRegistryListener = (
  snapshot: ExternalDimensionRegistrySnapshot,
) => void;

export class ExternalDimensionRegistry {
  private readonly recordsBySource = new Map<
    ExternalDimensionSource,
    readonly ExternalDimensionRecord[]
  >();
  private readonly hiddenIds = new Set<string>();
  private readonly listeners = new Set<ExternalDimensionRegistryListener>();

  get snapshot(): ExternalDimensionRegistrySnapshot {
    const records = [...this.recordsBySource.values()].flat();
    const activeIds = new Set(records.map(record => record.id));
    [...this.hiddenIds].forEach((id) => {
      if (!activeIds.has(id)) this.hiddenIds.delete(id);
    });
    return {
      records,
      visibleRecords: records.filter(record => !this.hiddenIds.has(record.id)),
      hiddenIds: new Set(this.hiddenIds),
    };
  }

  replaceSource(
    source: ExternalDimensionSource,
    records: readonly ExternalDimensionRecord[],
  ): void {
    const mismatched = records.find(record => record.source !== source);
    if (mismatched) {
      throw new Error(
        `External dimension "${mismatched.id}" belongs to "${mismatched.source}", `
        + `not "${source}"`,
      );
    }
    const otherIds = new Set(
      [...this.recordsBySource.entries()]
        .filter(([registeredSource]) => registeredSource !== source)
        .flatMap(([, sourceRecords]) => sourceRecords.map(record => record.id)),
    );
    const ids = new Set<string>();
    for (const record of records) {
      if (ids.has(record.id) || otherIds.has(record.id)) {
        throw new Error(
          `Duplicate external dimension id "${record.id}"`,
        );
      }
      ids.add(record.id);
    }
    this.recordsBySource.set(source, [...records]);
    this.publish();
  }

  setHidden(dimensionId: string, hidden: boolean): void {
    if (hidden) this.hiddenIds.add(dimensionId);
    else this.hiddenIds.delete(dimensionId);
    this.publish();
  }

  isHidden(dimensionId: string): boolean {
    return this.hiddenIds.has(dimensionId);
  }

  subscribe(listener: ExternalDimensionRegistryListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.recordsBySource.clear();
    this.hiddenIds.clear();
    this.publish();
  }

  private publish(): void {
    const snapshot = this.snapshot;
    this.listeners.forEach(listener => listener(snapshot));
  }
}
