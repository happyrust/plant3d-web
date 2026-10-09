import { describe, expect, it, vi } from 'vitest';

import {
  buildModelUnitCompareView,
  loadModelUnitComparePairs,
  ModelUnitCompareCancelledError,
  pickModelUnitCompareGeometry,
  type LoadedModelUnitComparePair,
  type ModelUnitComparePair,
  type ModelUnitCompareProgress,
} from './modelUnitCompareLoader';

import type { ModelVersion, ModelVersionGeometry } from '@/model-source/ports';
import type { InstanceEntry } from '@/utils/instances/instanceManifest';

const last = <T>(list: T[]): T | undefined => list[list.length - 1];

const version = (unitRefno: string, sesno: number, extra: Partial<ModelVersion> = {}): ModelVersion => ({
  dbnum: 8000, unitRefno, unitNoun: 'BRAN', sesno, sessionTime: `t${sesno}`, impactKind: 'mesh', ...extra,
});

/** 每个 refno 一条实例，`hash` 不同即几何不同 */
const geometry = (items: Record<string, string>, owners: Record<string, string> = {}): ModelVersionGeometry => ({
  refnos: Object.keys(items),
  entries: new Map(Object.entries(items).map(([refno, hash]) => [refno, [{ geo_hash: hash, geo_index: 0, matrix: [1], uniforms: { noun: 'FTUB' } }]])) as never,
  ownerByRefno: new Map(Object.entries(owners)),
  release: vi.fn(async () => {}),
});

const pair = (unitRefno: string, a: number, b: number, extra: { before?: Partial<ModelVersion>; after?: Partial<ModelVersion> } = {}): ModelUnitComparePair => ({
  unitRefno, unitNoun: 'BRAN', before: version(unitRefno, a, extra.before), after: version(unitRefno, b, extra.after),
});

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('loadModelUnitComparePairs', () => {
  it('同 geometryKey 的一对只取一份两侧共用；tombstone 侧照取但不计份', async () => {
    const progress: ModelUnitCompareProgress[] = [];
    const loadVersion = vi.fn(async (item: ModelVersion) => geometry(item.impactKind === 'tombstone' ? {} : { [`${item.unitRefno}_e`]: `h${item.sesno}` }));
    const load = await loadModelUnitComparePairs([
      pair('1_1', 10, 20, { before: { geometryKey: 'k' }, after: { geometryKey: 'k' } }),
      pair('1_2', 10, 20, { before: { impactKind: 'tombstone' } }),
    ], { loadVersion, onProgress: (item) => progress.push(item) });
    expect(loadVersion.mock.calls.map(([item]) => `${item.unitRefno}@${item.sesno}`)).toEqual(['1_1@20', '1_2@10', '1_2@20']);
    expect(load.pairs[0]!.geometries.before).toBe(load.pairs[0]!.geometries.after);
    expect(load.geometries).toHaveLength(3);
    expect(progress[0]).toEqual({ done: 0, total: 2, current: [] });
    expect(last(progress)).toEqual({ done: 2, total: 2, current: [] });
  });

  it('两个工位顺序领活，同时在飞的不超过 2 份，进度逐份前进', async () => {
    const gates = new Map<string, Deferred<ModelVersionGeometry>>();
    let active = 0;
    let peak = 0;
    const loadVersion = vi.fn((item: ModelVersion) => {
      const gate = deferred<ModelVersionGeometry>();
      gates.set(`${item.unitRefno}@${item.sesno}`, gate);
      active += 1;
      peak = Math.max(peak, active);
      return gate.promise.finally(() => { active -= 1; });
    });
    const progress: ModelUnitCompareProgress[] = [];
    const pending = loadModelUnitComparePairs([pair('1_1', 10, 20), pair('1_2', 10, 20)], { loadVersion, onProgress: (item) => progress.push(item) });
    expect(loadVersion).toHaveBeenCalledTimes(2);
    expect(last(progress)).toEqual({ done: 0, total: 4, current: ['BRAN 1_1@10', 'BRAN 1_1@20'] });
    gates.get('1_1@10')!.resolve(geometry({ a: '1' }));
    await vi.waitFor(() => expect(loadVersion).toHaveBeenCalledTimes(3));
    expect(last(progress)).toEqual({ done: 1, total: 4, current: ['BRAN 1_1@20', 'BRAN 1_2@10'] });
    for (const key of ['1_1@20', '1_2@10']) gates.get(key)!.resolve(geometry({ a: key }));
    await vi.waitFor(() => expect(loadVersion).toHaveBeenCalledTimes(4));
    gates.get('1_2@20')!.resolve(geometry({ a: '4' }));
    const load = await pending;
    expect(peak).toBe(2);
    expect(last(progress)).toEqual({ done: 4, total: 4, current: [] });
    expect(load.pairs.map(({ pair: item }) => item.unitRefno)).toEqual(['1_1', '1_2']);
  });

  it('一份失败：不再开新份，等在飞的那份落地后把取到的全部还回去，再抛那份的错', async () => {
    const late = deferred<ModelVersionGeometry>();
    const lateGeometry = geometry({ a: 'late' });
    const loadVersion = vi.fn()
      .mockRejectedValueOnce(new Error('投影失败'))
      .mockImplementationOnce(() => late.promise);
    const pending = loadModelUnitComparePairs([pair('1_1', 10, 20), pair('1_2', 10, 20)], { loadVersion });
    const assertion = expect(pending).rejects.toThrow('投影失败');
    await vi.waitFor(() => expect(loadVersion).toHaveBeenCalledTimes(2));
    late.resolve(lateGeometry);
    await assertion;
    expect(loadVersion).toHaveBeenCalledTimes(2);
    expect(lateGeometry.release).toHaveBeenCalledTimes(1);
  });

  it('shouldApply 变假：不再开新份，已取到的还回去，抛 ModelUnitCompareCancelledError', async () => {
    let live = true;
    const taken: ModelVersionGeometry[] = [];
    const loadVersion = vi.fn(async (item: ModelVersion) => {
      const result = geometry({ [item.unitRefno]: String(item.sesno) });
      taken.push(result);
      if (item.sesno === 20) live = false;
      return result;
    });
    await expect(loadModelUnitComparePairs([pair('1_1', 10, 20), pair('1_2', 10, 20)], { loadVersion, shouldApply: () => live }))
      .rejects.toBeInstanceOf(ModelUnitCompareCancelledError);
    expect(loadVersion).toHaveBeenCalledTimes(2);
    for (const item of taken) expect(item.release).toHaveBeenCalledTimes(1);
  });

  it('成功后的 release 幂等，单份释放失败只记日志', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = geometry({ a: '1' });
    vi.mocked(broken.release).mockRejectedValueOnce(new Error('DELETE 500'));
    const load = await loadModelUnitComparePairs([pair('1_1', 10, 20)], {
      loadVersion: vi.fn().mockResolvedValueOnce(broken).mockResolvedValueOnce(geometry({ a: '2' })),
    });
    await load.release();
    await load.release();
    expect(broken.release).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('pickModelUnitCompareGeometry', () => {
  const loaded: LoadedModelUnitComparePair[] = [
    { pair: pair('1_1', 10, 20), geometries: { before: geometry({ e_11: 'x' }), after: geometry({ e_11: 'y' }, { e_99: '1_1' }) } },
    { pair: pair('1_2', 10, 20), geometries: { before: geometry({ e_21: 'x' }), after: geometry({ e_21: 'y' }) } },
  ];

  it('宽松：按那一侧的 refnos 找，找不到退到第一份', () => {
    expect(pickModelUnitCompareGeometry(loaded, 'after', 'e_21', 'lenient')).toBe(loaded[1]!.geometries.after);
    expect(pickModelUnitCompareGeometry(loaded, 'after', 'nowhere', 'lenient')).toBe(loaded[0]!.geometries.after);
  });

  it('严格：单元根 / refnos / 属主表恰好命中一份才给，否则报错', () => {
    expect(pickModelUnitCompareGeometry(loaded, 'before', '1_2', 'strict')).toBe(loaded[1]!.geometries.before);
    expect(pickModelUnitCompareGeometry(loaded, 'after', 'e_99', 'strict')).toBe(loaded[0]!.geometries.after);
    expect(() => pickModelUnitCompareGeometry(loaded, 'after', 'nowhere', 'strict')).toThrow('无法唯一确定');
  });
});

describe('buildModelUnitCompareView', () => {
  const attributesAt = vi.fn();
  const loadedPair = (unitRefno: string, before: Record<string, string>, after: Record<string, string>, extra: Parameters<typeof pair>[3] = {}): LoadedModelUnitComparePair => ({
    pair: pair(unitRefno, 10, 20, extra), geometries: { before: geometry(before), after: geometry(after) },
  });

  it('单单元：两侧就是那个单元的、不带 units；只给了的 viewMode 才带', () => {
    const view = buildModelUnitCompareView([loadedPair('1_1', { e_1: 'x', e_2: 'x' }, { e_1: 'y', e_3: 'z' })], {
      dbnum: 8000, container: { unitRefno: '1_1', unitNoun: 'BRAN' }, attributesAt,
    });
    expect(view.detail).not.toHaveProperty('units');
    expect(view.detail).not.toHaveProperty('viewMode');
    expect(view.detail.unitRefno).toBe('1_1');
    expect(view.detail.rows.map((row) => `${row.refno}:${row.status}`)).toEqual(['e_3:added', 'e_2:deleted', 'e_1:modified']);
    expect(view.detail.refnos).toEqual(['e_3', 'e_2', 'e_1']);
    expect(view.treeContext).toMatchObject({ dbnum: 8000, fromSesno: 10, toSesno: 20, mode: 'compare', refnos: ['e_3', 'e_2', 'e_1'] });
    expect(view.treeContext).not.toHaveProperty('project');
  });

  it('多单元：两侧并起来、unitRefno 是容器、units 各一份；B 侧 tombstone 的单元根进树；asUnits 让一个单元也按多单元出', () => {
    const rawEntries = vi.fn((entries: Map<string, InstanceEntry[]>) => entries);
    const view = buildModelUnitCompareView([
      loadedPair('1_1', { e_1: 'x' }, { e_1: 'x' }),
      loadedPair('1_2', { e_2: 'x' }, {}, { after: { impactKind: 'tombstone' } }),
    ], { dbnum: 8000, container: { unitRefno: '9_9', unitNoun: 'PIPE' }, attributesAt, viewMode: 'split', rawEntries, project: 'p' });
    expect(view.detail).toMatchObject({ unitRefno: '9_9', viewMode: 'split' });
    expect(view.detail.units?.map((unit) => unit.unitRefno)).toEqual(['1_1', '1_2']);
    expect(view.detail.before.refnos).toEqual(['e_1', 'e_2']);
    expect(view.detail.before.version).toMatchObject({ unitRefno: '9_9', unitNoun: 'PIPE', sesno: 10, sessionTime: 't10' });
    expect(view.treeContext.project).toBe('p');
    expect(view.treeContext.models.map((model) => `${model.refno}:${model.status}`)).toEqual(['e_2:deleted', '1_2:deleted']);
    expect(rawEntries).toHaveBeenCalledTimes(4);

    const forced = buildModelUnitCompareView([loadedPair('1_1', { e_1: 'x' }, { e_1: 'y' })], {
      dbnum: 8000, container: { unitRefno: '9_9', unitNoun: '' }, attributesAt, asUnits: true,
    });
    expect(forced.detail.unitRefno).toBe('9_9');
    expect(forced.detail.units).toHaveLength(1);
  });
});
