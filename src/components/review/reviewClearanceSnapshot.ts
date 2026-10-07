import { isReviewModelContext, reviewModelVersionKey, type ReviewModelContext } from './reviewModelContext';

import { cloneResultSnapshot } from '@/clearance/services/resultSnapshot';

export type ReviewClearanceSnapshot = Readonly<{
  schemaVersion: 1;
  modelContext: ReviewModelContext;
  coordinateSpaces: Readonly<{ component: 'design-world-m'; pipe: 'e3d-world-mm'; bran: 'e3d-world-mm' }>;
  component: unknown;
  pipe: unknown;
  bran: unknown;
}>;

type SnapshotStore = { captureSnapshot: () => unknown; prepareSnapshotRestore: (value: unknown) => () => void };
export type ReviewClearanceStores = { component: SnapshotStore; pipe: SnapshotStore; bran: SnapshotStore };

export function reviewClearanceSnapshotKey(value: ReviewClearanceSnapshot | undefined): string {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.filter(item => typeof item !== 'string' || !item.startsWith('已恢复本机结果，')).map(normalize);
    if (!entry || typeof entry !== 'object') return entry;
    return Object.fromEntries(Object.entries(entry).filter(([key, item]) => key !== 'status' || item === 'failed')
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
  };
  return JSON.stringify(normalize(value ?? null));
}

export function hasReviewClearanceResults(value: ReviewClearanceSnapshot): boolean {
  const component = value.component as { records?: unknown[] };
  const pipe = value.pipe as { results?: unknown[] };
  const bran = value.bran as { branGroups?: { candidates?: unknown[] }[] };
  return !!(component.records?.length || pipe.results?.length || bran.branGroups?.some(group => group.candidates?.length));
}

export function normalizeReviewClearanceSnapshot(value: unknown): ReviewClearanceSnapshot | undefined {
  if (value === undefined || value === null) return undefined;
  const data = value as Partial<ReviewClearanceSnapshot>;
  if (!data || data.schemaVersion !== 1 || !isReviewModelContext(data.modelContext)
    || data.coordinateSpaces?.component !== 'design-world-m' || data.coordinateSpaces.pipe !== 'e3d-world-mm'
    || data.coordinateSpaces.bran !== 'e3d-world-mm' || !data.component || !data.pipe || !data.bran
    || JSON.stringify(data).length > 1024 * 1024) throw new Error('云端净距快照格式、单位或模型版本无效');
  return cloneResultSnapshot(data as ReviewClearanceSnapshot);
}

export function captureReviewClearanceSnapshot(modelContext: ReviewModelContext, stores: ReviewClearanceStores): ReviewClearanceSnapshot {
  if (!isReviewModelContext(modelContext)) throw new Error('净距保存的模型版本上下文无效');
  const snapshot: ReviewClearanceSnapshot = cloneResultSnapshot({ schemaVersion: 1, modelContext,
    coordinateSpaces: { component: 'design-world-m', pipe: 'e3d-world-mm', bran: 'e3d-world-mm' },
    component: stores.component.captureSnapshot(), pipe: stores.pipe.captureSnapshot(), bran: stores.bran.captureSnapshot() });
  // 保存与恢复采用相同域校验；不以能序列化代替完整性证明。
  prepareReviewClearanceRestore(snapshot, modelContext, stores);
  return snapshot;
}

export function prepareReviewClearanceRestore(value: unknown, context: ReviewModelContext, stores: ReviewClearanceStores): () => void {
  const snapshot = normalizeReviewClearanceSnapshot(value);
  if (!snapshot || reviewModelVersionKey(snapshot.modelContext) !== reviewModelVersionKey(context))
    throw new Error('云端净距与当前模型版本不匹配');
  const component = stores.component.prepareSnapshotRestore(snapshot.component);
  const pipe = stores.pipe.prepareSnapshotRestore(snapshot.pipe);
  const bran = stores.bran.prepareSnapshotRestore(snapshot.bran);
  return () => { component(); pipe(); bran(); };
}
