import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ref0 → dbnum 映射只有一条来源：gen-model `/api/v1/dbnums` 的 `ref0s`（经 useGenModelV1Dbnums 取，与徽标共用同一次请求）。
// legacy 的 `/files/output/<project>/scene_tree/db_meta_info.json` + IndexedDB 预热 2026-09-20 随其退役。
const getGenModelV1DbnumsMock = vi.fn();

vi.mock('@/composables/useGenModelV1Dbnums', () => ({
  getGenModelV1Dbnums: (options?: unknown) => getGenModelV1DbnumsMock(options),
}));

function dbnumsResponse(rows: { dbnum: number; ref0s?: number[] }[]) {
  return { dbnums: rows.map((row) => ({ dbnum: row.dbnum, db_type: 'DESI', ...(row.ref0s ? { ref0s: row.ref0s } : {}) })) };
}

describe('useDbMetaInfo', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('从 /api/v1/dbnums 的 ref0s 建 ref0→dbnum；没写 ref0s 的行跳过、不当空库', async () => {
    getGenModelV1DbnumsMock.mockResolvedValue(dbnumsResponse([
      { dbnum: 1112, ref0s: [17496] },
      { dbnum: 7997, ref0s: [24381, 24384] },
      { dbnum: 8000 },
    ]));
    const dbMeta = await import('./useDbMetaInfo');

    await expect(dbMeta.ensureDbMetaInfoLoaded()).resolves.toBeUndefined();
    expect(getGenModelV1DbnumsMock).toHaveBeenCalledTimes(1);
    expect(dbMeta.getDbnumByRefno('17496_1')).toBe(1112);
    expect(dbMeta.getDbnumByRefno('=24384/9')).toBe(7997);
    expect(dbMeta.tryGetDbnumByRefno('99999_1')).toBeNull();
    expect(() => dbMeta.getDbnumByRefno('99999_1')).toThrow('未命中 ref0=99999');
  });

  it('dbnumsToDbMetaInfoJson：同一 ref0 映到两个 dbnum 时报错，不带着歧义映射继续', async () => {
    getGenModelV1DbnumsMock.mockResolvedValue(dbnumsResponse([
      { dbnum: 7997, ref0s: [24381] },
      { dbnum: 7998, ref0s: [24381] },
    ]));
    const dbMeta = await import('./useDbMetaInfo');

    await expect(dbMeta.ensureDbMetaInfoLoaded()).rejects.toThrow('同时映射到多个 dbnum');
    expect(dbMeta.tryGetDbnumByRefno('24381_1')).toBeNull();
  });

  it('一个 ref0 都没有时报错，不当成已加载', async () => {
    getGenModelV1DbnumsMock.mockResolvedValue(dbnumsResponse([{ dbnum: 8000 }]));
    const dbMeta = await import('./useDbMetaInfo');

    await expect(dbMeta.ensureDbMetaInfoLoaded()).rejects.toThrow('未发现任何 ref0 映射');
    expect(() => dbMeta.getDbnumByRefno('24381_1')).toThrow('未加载');
  });

  it('retries a failed load instead of reusing the rejected promise forever', async () => {
    getGenModelV1DbnumsMock
      .mockRejectedValueOnce(new Error('HTTP 500 Internal Server Error: boom'))
      .mockResolvedValueOnce(dbnumsResponse([{ dbnum: 1, ref0s: [24381] }]));
    const dbMeta = await import('./useDbMetaInfo');

    await expect(dbMeta.ensureDbMetaInfoLoaded()).rejects.toThrow('boom');
    await expect(dbMeta.ensureDbMetaInfoLoaded()).resolves.toBeUndefined();
    expect(getGenModelV1DbnumsMock).toHaveBeenCalledTimes(2);
    expect(dbMeta.getDbnumByRefno('24381_1')).toBe(1);
  });

  it('并发 ensure 共用同一次 /dbnums', async () => {
    let resolveRows!: (value: unknown) => void;
    getGenModelV1DbnumsMock.mockImplementation(() => new Promise((resolve) => { resolveRows = resolve; }));
    const dbMeta = await import('./useDbMetaInfo');

    const a = dbMeta.ensureDbMetaInfoLoaded();
    const b = dbMeta.ensureDbMetaInfoLoaded();
    expect(getGenModelV1DbnumsMock).toHaveBeenCalledTimes(1);
    resolveRows(dbnumsResponse([{ dbnum: 1, ref0s: [24381] }]));
    await Promise.all([a, b]);
    expect(dbMeta.tryGetDbnumByRefno('24381_1')).toBe(1);
  });

  it('服务代次失效会清内存 ref0→dbnum 映射，下一次 ensure 重新拉', async () => {
    getGenModelV1DbnumsMock.mockResolvedValue(dbnumsResponse([{ dbnum: 1, ref0s: [24381] }]));
    const dbMeta = await import('./useDbMetaInfo');

    await dbMeta.ensureDbMetaInfoLoaded();
    expect(dbMeta.tryGetDbnumByRefno('24381_1')).toBe(1);
    dbMeta.invalidateGenModelV1DbMetaInfo();
    expect(dbMeta.tryGetDbnumByRefno('24381_1')).toBeNull();
    await dbMeta.ensureDbMetaInfoLoaded();
    expect(getGenModelV1DbnumsMock).toHaveBeenCalledTimes(2);
    expect(dbMeta.tryGetDbnumByRefno('24381_1')).toBe(1);
  });
});
