import { describe, expect, it, vi } from 'vitest';

import { createGenModelV1ModelRecordSource } from './modelRecordSource';

import type { ModelRecordsApi } from './modelRecords';

import { GenModelV1ApiError, toV1Refno, type GeomInstQuery } from '@/api/genModelV1Api';

const IDENTITY = { translation: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], scale: [1, 1, 1] as [number, number, number] };

function item(refno: string, owner: string, geoHash = 'g'): GeomInstQuery {
  return {
    refno, old_refno: null, owner, world_aabb: null, world_trans: IDENTITY,
    insts: [{ geo_hash: geoHash, transform: IDENTITY, is_tubi: false, is_invalid_tubi: false }],
    has_neg: false, generic: 'ELBO', pts: null, date: null,
  };
}

/** 一根 BRAN 24381/145018，下面三个构件；ensure 任何一个构件都解到这根 */
function branApi(): ModelRecordsApi & { ensure: ReturnType<typeof vi.fn>; records: ReturnType<typeof vi.fn> } {
  const ensure = vi.fn(async ({ refno }: { refno: string; force?: boolean }) => {
    if (toV1Refno(refno) === '24381/1') throw new GenModelV1ApiError({ code: 'not_found', status: 404, path: '', message: 'gone' });
    return { status: 'AlreadyAvailable', generation_root: '24381/145018', generation_roots: ['24381/145018'] };
  });
  const records = vi.fn(async () => ({
    source: 'model-memory',
    items: [item('24381_145019', '24381_145018'), item('24381_145021', '24381_145018'), item('24381_145021', '24381_145018', 'h'), item('24381_145023', '24381_145018')],
    total: 4, truncated: false, next_cursor: null,
  }));
  return { ensure: ensure as never, records: records as never, children: vi.fn() as never, ...({} as object) } as never;
}

describe('createGenModelV1ModelRecordSource', () => {
  it('同根的多个构件只 ensure 一次：第一个构件把整根记录写进缓存，其余命中', async () => {
    const api = branApi();
    const source = createGenModelV1ModelRecordSource({ api });
    const out = await source.instanceEntriesByRefnos(7997, ['24381_145019', '24381/145021', '24381_145023']);

    expect(api.ensure).toHaveBeenCalledTimes(1);
    expect(api.records).toHaveBeenCalledTimes(1);
    expect([...out.keys()]).toEqual(['24381_145019', '24381_145021', '24381_145023']);
    expect(out.get('24381_145021')).toHaveLength(2);
    expect(out.get('24381_145019')![0]!.uniforms).toMatchObject({ refno: '24381_145019', owner_refno: '24381_145018', noun: 'ELBO' });
    expect(source.peek('24381_145023')).toHaveLength(1);

    // 第二次全部命中缓存，一次请求都不发
    await source.instanceEntriesByRefnos(7997, ['24381_145019', '24381_145023']);
    expect(api.ensure).toHaveBeenCalledTimes(1);
  });

  it('请求到但记录里没有的构件记空数组；not_found 的根也记空，之后不再 ensure', async () => {
    const api = branApi();
    const source = createGenModelV1ModelRecordSource({ api });
    const out = await source.instanceEntriesByRefnos(7997, ['24381_145019', '24381_145099', '24381_1']);
    expect(out.get('24381_145099')).toEqual([]);
    expect(out.get('24381_1')).toEqual([]);
    // 145019 的 ensure 拉回整根；145099 不在这根的记录里、也不知道属于哪根，只能再问一次（同根 → 仍没有 → 记空）；
    // 24381_1 单独 ensure 一次（404 → 记空）
    expect(api.ensure).toHaveBeenCalledTimes(3);
    await source.instanceEntriesByRefnos(7997, ['24381_145099', '24381_1', '24381_145019']);
    expect(api.ensure).toHaveBeenCalledTimes(3);
  });

  it('forceRefresh 清掉请求的构件再问；forceRegenerate 只让第一次 ensure 带 force=true', async () => {
    const api = branApi();
    const source = createGenModelV1ModelRecordSource({ api });
    await source.instanceEntriesByRefnos(7997, ['24381_145019']);
    await source.instanceEntriesByRefnos(7997, ['24381_145019', '24381_145021'], { forceRefresh: true, forceRegenerate: true });
    expect(api.ensure).toHaveBeenCalledTimes(2);
    expect(api.ensure.mock.calls[0]![0]).toEqual({ refno: '24381_145019' });
    expect(api.ensure.mock.calls[1]![0]).toEqual({ refno: '24381_145019', force: true });
  });

  it('collectedRoots / leavesOfRoot / invalidateRoot：按根归档，清一根连带清它的构件（P5 用）', async () => {
    const api = branApi();
    const source = createGenModelV1ModelRecordSource({ api });
    await source.instanceEntriesByRefnos(7997, ['24381_145019']);
    expect(source.collectedRoots()).toEqual(['24381_145018']);
    expect(source.leavesOfRoot('24381/145018').sort()).toEqual(['24381_145018', '24381_145019', '24381_145021', '24381_145023']);

    const cleared = source.invalidateRoot('24381_145018');
    expect(cleared.sort()).toEqual(['24381_145018', '24381_145019', '24381_145021', '24381_145023']);
    expect(source.collectedRoots()).toEqual([]);
    expect(source.peek('24381_145021')).toBeUndefined();
    await source.instanceEntriesByRefnos(7997, ['24381_145021']);
    expect(api.ensure).toHaveBeenCalledTimes(2);
  });

  it('invalidate() 不带参数清全部', async () => {
    const api = branApi();
    const source = createGenModelV1ModelRecordSource({ api });
    await source.instanceEntriesByRefnos(7997, ['24381_145019']);
    source.invalidate();
    expect(source.peek('24381_145019')).toBeUndefined();
    await source.instanceEntriesByRefnos(7997, ['24381_145019']);
    expect(api.ensure).toHaveBeenCalledTimes(2);
  });
});
