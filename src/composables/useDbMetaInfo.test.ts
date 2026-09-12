import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// 这个文件测的是 legacy 链路（`/files/output/<project>/scene_tree/db_meta_info.json`）；
// 缺省数据源自 2026-09-09 起是 gen-model-v1（走 `/dbnums`），这里显式钉回 legacy。
beforeAll(() => window.history.replaceState({}, '', '?model_source=legacy'));
afterAll(() => window.history.replaceState({}, '', '/'));

const getJsonMock = vi.fn();
const setJsonMock = vi.fn();

vi.mock('@/utils/storage/indexedDbCache', () => ({
  getJson: getJsonMock,
  setJson: setJsonMock,
}));

function buildDbMetaResponse() {
  return new Response(
    JSON.stringify({
      db_files: {
        '1': {
          dbnum: 1,
          ref0s: [24381],
        },
      },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}

describe('useDbMetaInfo', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getJsonMock.mockResolvedValue(null);
    setJsonMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the active project path when loading db meta info', async () => {
    const fetchMock = vi.fn().mockResolvedValue(buildDbMetaResponse());
    vi.stubGlobal('fetch', fetchMock);

    const dbMeta = await import('./useDbMetaInfo');
    const filesOutput = await import('@/lib/filesOutput');

    filesOutput.setCurrentProjectPath('ams-model');

    await dbMeta.ensureDbMetaInfoLoaded();

    expect(fetchMock).toHaveBeenCalledWith('/files/output/ams-model/scene_tree/db_meta_info.json');
  });

  it('retries a failed load instead of reusing the rejected promise forever', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500, statusText: 'Internal Server Error' }))
      .mockResolvedValueOnce(buildDbMetaResponse());
    vi.stubGlobal('fetch', fetchMock);

    const filesOutput = await import('@/lib/filesOutput');
    filesOutput.setCurrentProjectPath('ams-model');

    const dbMeta = await import('./useDbMetaInfo');

    await expect(dbMeta.ensureDbMetaInfoLoaded()).rejects.toThrow(
      '/files/output/ams-model/scene_tree/db_meta_info.json'
    );
    await expect(dbMeta.ensureDbMetaInfoLoaded()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stores cache entries per project path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(buildDbMetaResponse());
    vi.stubGlobal('fetch', fetchMock);

    const filesOutput = await import('@/lib/filesOutput');
    filesOutput.setCurrentProjectPath('ams-model');

    const dbMeta = await import('./useDbMetaInfo');

    await dbMeta.ensureDbMetaInfoLoaded();

    expect(getJsonMock).toHaveBeenCalledWith('meta_info', 'db_meta_info:ams-model');
    expect(setJsonMock).toHaveBeenCalledWith(
      'meta_info',
      'db_meta_info:ams-model',
      expect.objectContaining({
        db_files: expect.any(Object),
      })
    );
  });

  it('continues when IndexedDB read/write fails after remote meta is available', async () => {
    const fetchMock = vi.fn().mockResolvedValue(buildDbMetaResponse());
    vi.stubGlobal('fetch', fetchMock);
    getJsonMock.mockRejectedValue(new Error('The transaction was aborted, so the request cannot be fulfilled.'));
    setJsonMock.mockRejectedValue(new Error('The transaction was aborted, so the request cannot be fulfilled.'));

    const filesOutput = await import('@/lib/filesOutput');
    filesOutput.setCurrentProjectPath('ams-model');

    const dbMeta = await import('./useDbMetaInfo');

    await expect(dbMeta.ensureDbMetaInfoLoaded()).resolves.toBeUndefined();
    expect(dbMeta.getDbnumByRefno('24381_1')).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('服务代次失效会清内存 ref0→dbnum 映射', async () => {
    const fetchMock = vi.fn().mockResolvedValue(buildDbMetaResponse());
    vi.stubGlobal('fetch', fetchMock);
    const filesOutput = await import('@/lib/filesOutput');
    filesOutput.setCurrentProjectPath('ams-model');
    const dbMeta = await import('./useDbMetaInfo');

    await dbMeta.ensureDbMetaInfoLoaded();
    expect(dbMeta.tryGetDbnumByRefno('24381_1')).toBe(1);
    dbMeta.invalidateGenModelV1DbMetaInfo();
    expect(dbMeta.tryGetDbnumByRefno('24381_1')).toBeNull();
  });
});
