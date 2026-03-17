import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/genModelTaskApi', () => ({
  getBaseUrl: () => 'http://127.0.0.1:3100',
}));

const { queryMock, registerFileURLMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  registerFileURLMock: vi.fn(),
}));

vi.mock('@duckdb/duckdb-wasm', () => {
  class ConsoleLogger {}

  class AsyncDuckDB {
    async instantiate() {
      return undefined;
    }

    async connect() {
      return {
        query: queryMock,
      };
    }

    async registerFileURL(...args: unknown[]) {
      return await registerFileURLMock(...args);
    }
  }

  return {
    DuckDBDataProtocol: {
      HTTP: 'http',
    },
    getJsDelivrBundles: () => ({
      mock: {
        mainWorker: 'worker.js',
        mainModule: 'duckdb.wasm',
        pthreadWorker: 'pthread.js',
      },
    }),
    selectBundle: async (bundles: Record<string, unknown>) => bundles.mock,
    ConsoleLogger,
    AsyncDuckDB,
  };
});

function createManifest(dbno: number) {
  return {
    version: 1,
    format: 'parquet' as const,
    generated_at: '2026-03-08T00:00:00.000Z',
    dbnum: dbno,
    root_refno: null,
    tables: {
      instances: { file: `instances_${dbno}.parquet` },
      geo_instances: { file: `geo_instances_${dbno}.parquet` },
      tubings: { file: `tubings_${dbno}.parquet` },
      transforms: { file: `transforms_${dbno}.parquet` },
      aabb: { file: `aabb_${dbno}.parquet` },
    },
    mesh_validation: {
      lod_tag: 'L1',
      report_file: 'missing-report.json',
      checked_geo_hashes: 10,
      missing_geo_hashes: 1,
      missing_owner_refnos: 2,
    },
  };
}

describe('useDbnoInstancesParquetLoader', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    registerFileURLMock.mockResolvedValue(undefined);
    queryMock.mockReset();

    vi.stubGlobal(
      'Worker',
      class {
        terminate() {
          return undefined;
        }
      } as unknown as typeof Worker
    );
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:duckdb-worker');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('后端提示 instances manifest 时不再请求 parquet manifest', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method || 'GET').toUpperCase();

      if (url.includes('/api/model/parquet-version/7997')) {
        return new Response(JSON.stringify({
          success: true,
          dbnum: 7997,
          revision: 1,
          updated_at: '2026-03-08T00:00:00.000Z',
          running: false,
          pending_count: 0,
          last_error: null,
          manifest_base_dir: 'instances',
          files_base_dir: 'instances',
        }), { status: 200 });
      }

      if (url.endsWith('/files/output/instances/manifest_7997.json')) {
        return new Response(JSON.stringify(createManifest(7997)), { status: 200 });
      }

      if (method === 'HEAD' && url.includes('/files/output/instances/')) {
        return new Response(null, { status: 200 });
      }

      throw new Error(`unexpected fetch: ${method} ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader');
    const loader = useDbnoInstancesParquetLoader();
    await expect(loader.isParquetAvailable(7997)).resolves.toBe(true);

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls).toContain('/files/output/instances/manifest_7997.json');
    expect(urls).not.toContain('/files/output/parquet/manifest_7997.json');
  });

  it('mesh validation 报告沿 manifest 所在目录读取', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/api/model/parquet-version/7997')) {
        return new Response(JSON.stringify({
          success: true,
          dbnum: 7997,
          revision: 1,
          updated_at: '2026-03-08T00:00:00.000Z',
          running: false,
          pending_count: 0,
          last_error: null,
          manifest_base_dir: 'instances',
          files_base_dir: 'instances',
        }), { status: 200 });
      }

      if (url.endsWith('/files/output/instances/manifest_7997.json')) {
        return new Response(JSON.stringify(createManifest(7997)), { status: 200 });
      }

      if (url.endsWith('/files/output/instances/missing-report.json')) {
        return new Response(JSON.stringify({
          generated_at: '2026-03-08T00:00:00.000Z',
          missing_geo_hash_list: [
            { geo_hash: 'abc', row_count: 3, owner_refno_count: 1 },
          ],
        }), { status: 200 });
      }

      throw new Error(`unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader');
    const loader = useDbnoInstancesParquetLoader();
    const info = await loader.queryMeshValidationInfoByDbno(7997);

    expect(info?.reportFile).toBe('missing-report.json');
    expect(info?.topMissingGeoHashes).toEqual([
      { geoHash: 'abc', rowCount: 3, ownerRefnoCount: 1 },
    ]);

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls).toContain('/files/output/instances/missing-report.json');
    expect(urls).not.toContain('/files/output/parquet/missing-report.json');
  });

  it('ELBO(24381_145567) 所在 BRAN 加载时不叠加 tubings，且仅补缺失 refno', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/api/model/parquet-version/7997')) {
        return new Response(JSON.stringify({
          success: true,
          dbnum: 7997,
          revision: 1,
          updated_at: '2026-03-08T00:00:00.000Z',
          running: false,
          pending_count: 0,
          last_error: null,
          manifest_base_dir: 'instances',
          files_base_dir: 'instances',
        }), { status: 200 });
      }

      if (url.endsWith('/files/output/instances/manifest_7997.json')) {
        return new Response(JSON.stringify(createManifest(7997)), { status: 200 });
      }

      throw new Error(`unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const identity = {
      m00: 1, m10: 0, m20: 0, m30: 0,
      m01: 0, m11: 1, m21: 0, m31: 0,
      m02: 0, m12: 0, m22: 1, m32: 0,
      m03: 0, m13: 0, m23: 0, m33: 1,
    };

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('ORDER BY i.refno_str, gi.geo_index')) {
        return {
          toArray: () => [
            {
              refno_str: '24381_145567',
              noun: 'ELBO',
              owner_refno_str: '/Copy-of-1RCS0063-1R56001',
              owner_noun: 'BRAN',
              spec_value: 2,
              has_neg: false,
              trans_hash: '111',
              aabb_hash: '222',
              geo_index: 0,
              geo_hash: '3',
              geo_trans_hash: null,
              min_x: 0,
              min_y: 0,
              min_z: 0,
              max_x: 1,
              max_y: 1,
              max_z: 1,
              ...identity,
              g_m00: null, g_m10: null, g_m20: null, g_m30: null,
              g_m01: null, g_m11: null, g_m21: null, g_m31: null,
              g_m02: null, g_m12: null, g_m22: null, g_m32: null,
              g_m03: null, g_m13: null, g_m23: null, g_m33: null,
            },
          ],
        };
      }
      if (sql.includes('ORDER BY t.tubi_refno_str, t.order')) {
        expect(sql).toContain('present_in_instances');
        expect(sql).toContain('LEFT JOIN present_in_instances');
        expect(sql).toContain('FROM missing_in_instances x');
        return {
          toArray: () => [
            {
              refno_str: '24381_999999',
              noun: 'TUBI',
              owner_refno_str: '24381_2',
              owner_noun: '',
              spec_value: 1,
              has_neg: false,
              trans_hash: '333',
              aabb_hash: '444',
              geo_index: 0,
              geo_hash: '2',
              geo_trans_hash: '',
              min_x: 0,
              min_y: 0,
              min_z: 0,
              max_x: 1,
              max_y: 1,
              max_z: 1,
              ...identity,
              g_m00: null, g_m10: null, g_m20: null, g_m30: null,
              g_m01: null, g_m11: null, g_m21: null, g_m31: null,
              g_m02: null, g_m12: null, g_m22: null, g_m32: null,
              g_m03: null, g_m13: null, g_m23: null, g_m33: null,
            },
          ],
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader');
    const loader = useDbnoInstancesParquetLoader();
    const out = await loader.queryInstanceEntriesByRefnos(7997, ['24381_145567', '24381_999999']);

    const elboList = out.get('24381_145567') ?? [];
    const tubiList = out.get('24381_999999') ?? [];

    expect(elboList).toHaveLength(1);
    expect(elboList[0]?.uniforms.noun).toBe('ELBO');
    expect(elboList[0]?.uniforms.owner_noun).toBe('BRAN');
    expect(elboList[0]?.uniforms.owner_refno).toBe('/Copy-of-1RCS0063-1R56001');
    expect(tubiList).toHaveLength(1);
    expect(tubiList[0]?.uniforms.noun).toBe('TUBI');
    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});
