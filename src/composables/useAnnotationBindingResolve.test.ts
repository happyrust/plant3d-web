import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import { useAnnotationBindingResolve } from './useAnnotationBindingResolve';
import { dtxLoaderRevision } from './useDbnoInstancesDtxLoader';
import {
  useToolStore,
  type AnnotationRecord,
  type CloudAnnotationRecord,
  type ObbAnnotationRecord,
  type RectAnnotationRecord,
} from './useToolStore';
import { useViewerContext } from './useViewerContext';

import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';

import { BINDING_RESOLVE_REASONS } from '@/review/domain/bindingResolve';

/** 运行时索引探针换成可控集合；修订号是真 ref，供 watch 用。 */
const loaderMock = vi.hoisted(() => ({
  loaded: new Set<string>(),
  known: new Set<string>(),
  isLoaded: vi.fn((refno: string) => loaderMock.loaded.has(refno)),
  isKnown: vi.fn((refno: string) => loaderMock.known.has(refno)),
}));

vi.mock('./useDbnoInstancesDtxLoader', async () => {
  const { ref } = await import('vue');
  return {
    dtxLoaderRevision: ref(0),
    isDtxRefnoLoadedAcrossAllDbnos: (refno: string) => loaderMock.isLoaded(refno),
    isDtxRefnoKnownAcrossAllDbnos: (refno: string) => loaderMock.isKnown(refno),
    findNounByRefnoAcrossAllDbnos: () => null,
  };
});

const CREATED_AT = 1_700_000_000_000;

function makeText(id: string, overrides: Partial<AnnotationRecord> = {}): AnnotationRecord {
  return {
    id,
    entityId: 'entity-1',
    worldPos: [0, 0, 0],
    visible: true,
    glyph: 'A1',
    title: `text-${id}`,
    description: '',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function makeCloud(id: string, overrides: Partial<CloudAnnotationRecord> = {}): CloudAnnotationRecord {
  return {
    id,
    objectIds: [],
    anchorWorldPos: [0, 0, 0],
    visible: true,
    title: `cloud-${id}`,
    description: '',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

const OBB = {
  center: [0, 0, 0] as [number, number, number],
  axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]],
  halfSize: [1, 1, 1] as [number, number, number],
  corners: [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ] as RectAnnotationRecord['obb']['corners'],
};

function makeRect(id: string, overrides: Partial<RectAnnotationRecord> = {}): RectAnnotationRecord {
  return {
    id,
    objectIds: [],
    obb: OBB,
    anchorWorldPos: [0, 0, 0],
    visible: true,
    title: `rect-${id}`,
    description: '',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function makeObb(id: string, overrides: Partial<ObbAnnotationRecord> = {}): ObbAnnotationRecord {
  return {
    id,
    objectIds: [],
    obb: OBB,
    labelWorldPos: [0, 0, 1],
    anchor: { kind: 'top_center' },
    visible: true,
    title: `obb-${id}`,
    description: '',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function setViewerScene(scene: { getAABB?: (ids: string[]) => ArrayLike<number> | null } | null): void {
  useViewerContext().viewerRef.value = (scene ? { scene } : null) as unknown as DtxCompatViewer | null;
}

describe('useAnnotationBindingResolve（ADR-0050 运行时：批量解析 + 定位回执 + 模型加载触发）', () => {
  const api = useAnnotationBindingResolve();

  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
    if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
    useToolStore().clearAll();
    api.resetForTests();
    loaderMock.loaded.clear();
    loaderMock.known.clear();
    loaderMock.isLoaded.mockClear();
    loaderMock.isKnown.mockClear();
    setViewerScene(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    setViewerScene(null);
    useToolStore().clearAll();
    api.resetForTests();
  });

  it('resolveAll 覆盖四类批注的全部绑定；键 = 类型:记录:角色:refno，同一 refno 双角色是两条', () => {
    const store = useToolStore();
    store.addAnnotation(makeText('t', { refno: '=1/1' }));
    store.addCloudAnnotation(makeCloud('c', { objectIds: ['=1/2'], anchorRefno: '=1/1' }));
    store.addRectAnnotation(makeRect('r', { refnos: ['=1/3'] }));
    store.addObbAnnotation(makeObb('o', { objectIds: ['=1/4'], refnos: ['=1/4'] }));
    loaderMock.loaded.add('=1/1');
    loaderMock.known.add('=1/2');

    api.resolveAll();

    expect(api.entries.value.size).toBe(6);
    expect(api.getBindingResolve('text', 't', 'anchor', '=1/1')?.state).toBe('resolved');
    expect(api.getBindingResolve('text', 't', 'member', '=1/1')?.state).toBe('resolved');
    expect(api.getBindingResolve('cloud', 'c', 'anchor', '=1/1')?.state).toBe('resolved');
    expect(api.getBindingResolve('cloud', 'c', 'member', '=1/2')).toMatchObject({
      state: 'unloaded',
      reason: BINDING_RESOLVE_REASONS.unloadedKnown,
    });
    expect(api.getBindingResolve('rect', 'r', 'member', '=1/3')).toMatchObject({
      state: 'unloaded',
      reason: BINDING_RESOLVE_REASONS.unloadedUnknown,
    });
    expect(api.getBindingResolve('obb', 'o', 'member', '=1/4')?.state).toBe('unloaded');
    expect(api.getRecordSummary('cloud', 'c')).toEqual({ total: 2, resolved: 1, unloaded: 1, missing: 0, stale: 0, usable: 2 });
    expect(api.getRecordSummary('text', 'nope')).toEqual({ total: 0, resolved: 0, unloaded: 0, missing: 0, stale: 0, usable: 0 });
    expect(api.getLastResolvedAt()).toBeGreaterThan(0);
  });

  it('resolveRecord 只重算那一条记录，其它记录的结果原样保留；记录不存在时清掉它的旧条目', () => {
    const store = useToolStore();
    store.addRectAnnotation(makeRect('r1', { refnos: ['=1/1'] }));
    store.addRectAnnotation(makeRect('r2', { refnos: ['=1/1'] }));
    api.resolveAll();
    expect(api.getBindingResolve('rect', 'r1', 'member', '=1/1')?.state).toBe('unloaded');
    expect(api.getBindingResolve('rect', 'r2', 'member', '=1/1')?.state).toBe('unloaded');

    loaderMock.loaded.add('=1/1');
    api.resolveRecord('rect', 'r1');
    expect(api.getBindingResolve('rect', 'r1', 'member', '=1/1')?.state).toBe('resolved');
    expect(api.getBindingResolve('rect', 'r2', 'member', '=1/1')?.state).toBe('unloaded');

    store.removeRectAnnotation('r1');
    api.resolveRecord('rect', 'r1');
    expect(api.getBindingResolve('rect', 'r1', 'member', '=1/1')).toBeUndefined();
    expect(api.getRecordSummary('rect', 'r2').total).toBe(1);
  });

  it('markLoadResult：fail 记成权威 missing（带回执错误文本、refno 裁边），ok 撤销并重算', () => {
    const store = useToolStore();
    store.addCloudAnnotation(makeCloud('c', { objectIds: ['=1/2'] }));
    loaderMock.loaded.add('=1/2');
    api.resolveAll();
    expect(api.getBindingResolve('cloud', 'c', 'member', '=1/2')?.state).toBe('resolved');

    api.markLoadResult({ ok: [], fail: [{ refno: ' =1/2 ', error: ' HTTP 404 model unit not found ' }] });
    expect(api.getBindingResolve('cloud', 'c', 'member', '=1/2')).toMatchObject({
      state: 'missing',
      reason: `${BINDING_RESOLVE_REASONS.missing}：HTTP 404 model unit not found`,
    });

    // 只给 refno 字符串、没有错误文本 → 默认句
    api.markLoadResult({ fail: ['=1/2'] });
    expect(api.getBindingResolve('cloud', 'c', 'member', '=1/2')?.reason).toBe(BINDING_RESOLVE_REASONS.missing);

    // 定位成功 → 撤销 missing；ok 本身就要重算（几何刚装进来）
    loaderMock.loaded.delete('=1/2');
    loaderMock.known.add('=1/2');
    api.markLoadResult({ ok: ['=1/2'], fail: [] });
    expect(api.getBindingResolve('cloud', 'c', 'member', '=1/2')).toMatchObject({
      state: 'unloaded',
      reason: BINDING_RESOLVE_REASONS.unloadedKnown,
    });

    // 空回执什么都不做
    const before = api.entries.value;
    api.markLoadResult({ ok: [], fail: [] });
    expect(api.entries.value).toBe(before);
  });

  it('模型加载 / 版本切换：运行时索引修订号连续变化只合并成一次全量重算', async () => {
    vi.useFakeTimers();
    const store = useToolStore();
    store.addRectAnnotation(makeRect('r', { refnos: ['=1/1'] }));
    api.resolveAll();
    expect(api.getBindingResolve('rect', 'r', 'member', '=1/1')?.state).toBe('unloaded');
    loaderMock.isLoaded.mockClear();

    loaderMock.loaded.add('=1/1');
    dtxLoaderRevision.value += 1;
    await nextTick();
    dtxLoaderRevision.value += 1;
    await nextTick();
    // 合并窗口内还没重算
    expect(api.getBindingResolve('rect', 'r', 'member', '=1/1')?.state).toBe('unloaded');
    expect(loaderMock.isLoaded).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(api.getBindingResolve('rect', 'r', 'member', '=1/1')?.state).toBe('resolved');
    // 两次 bump、一条绑定 → 探针只被问了一次
    expect(loaderMock.isLoaded).toHaveBeenCalledTimes(1);
  });

  it('默认探针：anchor 已加载但锚点漂离构件包围盒 → stale；无 scene / getAABB 抛错 / 盒缺失 → 不判', () => {
    const store = useToolStore();
    store.addCloudAnnotation(makeCloud('c', { anchorRefno: '=1/1', anchorWorldPos: [5000, 0, 0] }));
    store.addAnnotation(makeText('t', { refno: '=1/1', worldPos: [50, 50, 50] }));
    loaderMock.loaded.add('=1/1');

    setViewerScene({ getAABB: () => [0, 0, 0, 100, 100, 100] });
    api.resolveAll();
    expect(api.getBindingResolve('cloud', 'c', 'anchor', '=1/1')).toMatchObject({
      state: 'stale',
      reason: BINDING_RESOLVE_REASONS.stale,
    });
    // 文字批注的锚点仍在盒内 → resolved；member 角色不判漂移
    expect(api.getBindingResolve('text', 't', 'anchor', '=1/1')?.state).toBe('resolved');
    expect(api.getBindingResolve('text', 't', 'member', '=1/1')?.state).toBe('resolved');
    expect(api.getRecordSummary('cloud', 'c')).toEqual({ total: 1, resolved: 0, unloaded: 0, missing: 0, stale: 1, usable: 0 });

    setViewerScene({ getAABB: () => { throw new Error('scene not ready'); } });
    api.resolveAll();
    expect(api.getBindingResolve('cloud', 'c', 'anchor', '=1/1')?.state).toBe('resolved');

    setViewerScene({ getAABB: () => null });
    api.resolveAll();
    expect(api.getBindingResolve('cloud', 'c', 'anchor', '=1/1')?.state).toBe('resolved');

    setViewerScene(null);
    api.resolveAll();
    expect(api.getBindingResolve('cloud', 'c', 'anchor', '=1/1')?.state).toBe('resolved');
  });

  it('注入探针时完全绕开运行时索引与 viewer', () => {
    const store = useToolStore();
    store.addCloudAnnotation(makeCloud('c', { objectIds: ['=1/2'], anchorRefno: '=1/1' }));
    loaderMock.isLoaded.mockClear();

    api.resolveAll({
      isLoaded: () => true,
      isKnown: () => true,
      isVerifiedMissing: (refno) => refno === '=1/2',
      missingReason: () => 'custom evidence',
      anchorDrift: () => true,
    });

    expect(loaderMock.isLoaded).not.toHaveBeenCalled();
    expect(api.getBindingResolve('cloud', 'c', 'anchor', '=1/1')?.state).toBe('stale');
    expect(api.getBindingResolve('cloud', 'c', 'member', '=1/2')).toMatchObject({
      state: 'missing',
      reason: `${BINDING_RESOLVE_REASONS.missing}：custom evidence`,
    });
  });
});
