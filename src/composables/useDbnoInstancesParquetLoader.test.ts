import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/genModelTaskApi', () => ({
  getBaseUrl: () => 'http://127.0.0.1:3100',
}));

vi.mock('@/utils/duckdbBundles', () => ({
  configureLocalDuckDBExtensions: vi.fn(),
  selectLocalDuckDBBundle: async () => ({
    mainWorker: '/duckdb/duckdb-browser-eh.worker.js',
    mainModule: '/duckdb/duckdb-eh.wasm',
    pthreadWorker: '/duckdb/duckdb-browser-eh.pthread.worker.js',
  }),
}));

const { queryMock, registerFileURLMock, instantiateMock, connectMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  registerFileURLMock: vi.fn(),
  instantiateMock: vi.fn(),
  connectMock: vi.fn(),
}));

vi.mock('@duckdb/duckdb-wasm', () => {
  class ConsoleLogger {}

  class AsyncDuckDB {
    async instantiate() {
      return await instantiateMock();
    }

    async connect() {
      await connectMock();
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
    selectBundle: async (bundles: Record<string, unknown>) => bundles.eh ?? bundles.mvp,
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

function createPtsetManifest(dbno: number) {
  const manifest = createManifest(dbno);
  return {
    ...manifest,
    tables: {
      ...manifest.tables,
      ptsets: { file: `ptsets_${dbno}.parquet` },
    },
    ptset_unit: {
      source: 'mm',
      target: 'm',
      conversion_factor: 0.001,
    },
  };
}

function createPrimitiveKeypointManifest(dbno: number) {
  const manifest = createManifest(dbno);
  return {
    ...manifest,
    tables: {
      ...manifest.tables,
      primitive_keypoints: { file: `primitive_keypoints_${dbno}.parquet` },
    },
    primitive_keypoint_unit: {
      source: 'mm',
      target: 'm',
      conversion_factor: 0.001,
      coordinate_space: 'geo_local',
    },
  };
}

function createIdentityMatrix(tx = 0, ty = 0, tz = 0) {
  return {
    m00: 1, m10: 0, m20: 0, m30: 0,
    m01: 0, m11: 1, m21: 0, m31: 0,
    m02: 0, m12: 0, m22: 1, m32: 0,
    m03: tx, m13: ty, m23: tz, m33: 1,
  };
}

describe('useDbnoInstancesParquetLoader', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    registerFileURLMock.mockResolvedValue(undefined);
    instantiateMock.mockResolvedValue(undefined);
    connectMock.mockResolvedValue(undefined);
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

  it('同一 dbno 的 parquet 可用性探测会复用并发请求并缓存成功结果', async () => {
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

    const [first, second] = await Promise.all([
      loader.isParquetAvailable(7997),
      loader.isParquetAvailable(7997),
    ]);
    const third = await loader.isParquetAvailable(7997);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(third).toBe(true);

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.filter((url) => url.includes('/api/model/parquet-version/7997'))).toHaveLength(1);
    expect(urls.filter((url) => url.endsWith('/files/output/instances/manifest_7997.json'))).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([input, init]) => {
        const url = String(input);
        const method = String((init as RequestInit | undefined)?.method || 'GET').toUpperCase();
        return method === 'HEAD' && url.includes('/files/output/instances/');
      })
    ).toHaveLength(4);
  });

  it('支持预热 DuckDB 与 dbno 注册，且重复调用复用同一冷启动状态', async () => {
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

      if (url.endsWith('/files/output/instances/manifest_7997_buckets.json')) {
        return new Response('', { status: 404 });
      }

      throw new Error(`unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader');
    const loader = useDbnoInstancesParquetLoader();

    await loader.prewarmDuckDB();
    await loader.prewarmDuckDB();
    await loader.prewarmDbno(7997);
    await loader.prewarmDbno(7997);

    expect(instantiateMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(registerFileURLMock).toHaveBeenCalledTimes(5);
  });

  it('show_dbnum 先查询可绘制 refno 再分批加载时不会重复注册同名 DuckDB 文件', async () => {
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

      if (url.endsWith('/files/output/instances/manifest_7997_buckets.json')) {
        return new Response('', { status: 404 });
      }

      throw new Error(`unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    queryMock.mockResolvedValue({
      toArray: () => [],
    });

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader');
    const loader = useDbnoInstancesParquetLoader();

    await loader.queryAllRefnosByDbno(7997);
    await loader.queryInstanceEntriesByRefnos(7997, ['24381_145018']);

    expect(String(queryMock.mock.calls[0]?.[0] ?? '')).toContain('geo_instances');
    expect(registerFileURLMock).toHaveBeenCalledTimes(10);
    const allRefnoQueryNames = registerFileURLMock.mock.calls.slice(0, 5).map((call) => String(call[0]));
    const instanceQueryNames = registerFileURLMock.mock.calls.slice(5, 10).map((call) => String(call[0]));

    expect(allRefnoQueryNames[0]).toMatch(/^p_7997_instances_.+\.parquet$/);
    for (const name of instanceQueryNames) {
      expect(allRefnoQueryNames).not.toContain(name);
    }
  });

  it('按模型提交 manifest URL 注册该版本目录下的 Parquet 文件', async () => {
    const manifestUrl = '/files/output/AvevaMarineSample/model_units/7997/24381_145018/897/manifest.json';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === manifestUrl) {
        return new Response(JSON.stringify(createManifest(7997)), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    queryMock.mockResolvedValue({ toArray: () => [] });

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader');
    const loader = useDbnoInstancesParquetLoader();
    await loader.queryAllRefnosByDbno(7997, { manifestUrl });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const registeredUrls = registerFileURLMock.mock.calls.map((call) => String(call[1]));
    expect(registeredUrls).toHaveLength(5);
    expect(registeredUrls.every((url) => url.includes('/model_units/7997/24381_145018/897/'))).toBe(true);
  });

  it('DuckDB 报本地文件名已注册时改用唯一文件名继续查询', async () => {
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
    queryMock.mockResolvedValue({
      toArray: () => [],
    });
    registerFileURLMock.mockImplementation(async (localName: string) => {
      if (localName === 'p_7997_instances.parquet') {
        throw new Error('File already registered: p_7997_instances.parquet');
      }
      return undefined;
    });

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader');
    const loader = useDbnoInstancesParquetLoader();

    await loader.queryAllRefnosByDbno(7997);

    const registeredNames = registerFileURLMock.mock.calls.map((call) => String(call[0]));
    const retryName = registeredNames.find((name) =>
      /^p_7997_instances_[a-zA-Z0-9_]+\.parquet$/.test(name)
    );

    expect(retryName).toBeTruthy();
    expect(queryMock).toHaveBeenCalledTimes(1);
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toContain(`parquet_scan('${retryName}')`);
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

  it('tubi 同时支持 direct + owner 挂接，并在命中实例 refno 时组合 parentWorld * tubiLocal', async () => {
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

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('ORDER BY i.refno_str, gi.geo_index')) {
        return {
          toArray: () => [
            {
              refno_str: '24381_145714',
              noun: 'ELBO',
              owner_refno_str: '24381_145712',
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
              ...createIdentityMatrix(10, 20, 30),
              g_m00: null, g_m10: null, g_m20: null, g_m30: null,
              g_m01: null, g_m11: null, g_m21: null, g_m31: null,
              g_m02: null, g_m12: null, g_m22: null, g_m32: null,
              g_m03: null, g_m13: null, g_m23: null, g_m33: null,
            },
          ],
        };
      }
      if (sql.includes('FROM tubi_candidates c')) {
        return {
          toArray: () => [
            {
              refno_str: '24381_145712',
              tubi_refno_str: '24381_145712',
              noun: 'TUBI',
              owner_refno_str: '24381_145712',
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
              ...createIdentityMatrix(100, 200, 300),
              iw_m00: null, iw_m10: null, iw_m20: null, iw_m30: null,
              iw_m01: null, iw_m11: null, iw_m21: null, iw_m31: null,
              iw_m02: null, iw_m12: null, iw_m22: null, iw_m32: null,
              iw_m03: null, iw_m13: null, iw_m23: null, iw_m33: null,
              g_m00: null, g_m10: null, g_m20: null, g_m30: null,
              g_m01: null, g_m11: null, g_m21: null, g_m31: null,
              g_m02: null, g_m12: null, g_m22: null, g_m32: null,
              g_m03: null, g_m13: null, g_m23: null, g_m33: null,
            },
            {
              refno_str: '24381_145712',
              tubi_refno_str: '24381_145714',
              noun: 'TUBI',
              owner_refno_str: '24381_145712',
              owner_noun: '',
              spec_value: 1,
              has_neg: false,
              trans_hash: '334',
              aabb_hash: '445',
              geo_index: 1,
              geo_hash: '2',
              geo_trans_hash: '',
              min_x: 0,
              min_y: 0,
              min_z: 0,
              max_x: 1,
              max_y: 1,
              max_z: 1,
              ...createIdentityMatrix(1, 2, 3),
              iw_m00: 1, iw_m10: 0, iw_m20: 0, iw_m30: 0,
              iw_m01: 0, iw_m11: 1, iw_m21: 0, iw_m31: 0,
              iw_m02: 0, iw_m12: 0, iw_m22: 1, iw_m32: 0,
              iw_m03: 10, iw_m13: 20, iw_m23: 30, iw_m33: 1,
              g_m00: null, g_m10: null, g_m20: null, g_m30: null,
              g_m01: null, g_m11: null, g_m21: null, g_m31: null,
              g_m02: null, g_m12: null, g_m22: null, g_m32: null,
              g_m03: null, g_m13: null, g_m23: null, g_m33: null,
            },
            {
              refno_str: '24381_145714',
              tubi_refno_str: '24381_145714',
              noun: 'TUBI',
              owner_refno_str: '24381_145712',
              owner_noun: '',
              spec_value: 1,
              has_neg: false,
              trans_hash: '334',
              aabb_hash: '445',
              geo_index: 1,
              geo_hash: '2',
              geo_trans_hash: '',
              min_x: 0,
              min_y: 0,
              min_z: 0,
              max_x: 1,
              max_y: 1,
              max_z: 1,
              ...createIdentityMatrix(1, 2, 3),
              iw_m00: 1, iw_m10: 0, iw_m20: 0, iw_m30: 0,
              iw_m01: 0, iw_m11: 1, iw_m21: 0, iw_m31: 0,
              iw_m02: 0, iw_m12: 0, iw_m22: 1, iw_m32: 0,
              iw_m03: 10, iw_m13: 20, iw_m23: 30, iw_m33: 1,
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
    const out = await loader.queryInstanceEntriesByRefnos(7997, ['24381_145712', '24381_145714']);

    const elboList = out.get('24381_145714') ?? [];
    const branList = out.get('24381_145712') ?? [];

    expect(elboList).toHaveLength(2);
    expect(elboList[0]!.uniforms!.noun).toBe('ELBO');
    expect(elboList[0]!.uniforms!.owner_noun).toBe('BRAN');
    expect(elboList[0]!.uniforms!.owner_refno).toBe('24381_145712');
    expect(elboList[1]!.uniforms!.noun).toBe('TUBI');
    expect(elboList[1]!.uniforms!.refno).toBe('24381_145714');
    expect(elboList[1]!.matrix[12]).toBe(1);
    expect(elboList[1]!.matrix[13]).toBe(2);
    expect(elboList[1]!.matrix[14]).toBe(3);

    expect(branList).toHaveLength(2);
    expect(branList[0]!.uniforms!.noun).toBe('TUBI');
    expect(branList[0]!.uniforms!.owner_refno).toBe('24381_145712');
    expect(branList[0]!.matrix[12]).toBe(100);
    expect(branList[0]!.matrix[13]).toBe(200);
    expect(branList[0]!.matrix[14]).toBe(300);
    expect(branList[1]!.uniforms!.refno).toBe('24381_145714');
    expect(branList[1]!.matrix[12]).toBe(1);
    expect(branList[1]!.matrix[13]).toBe(2);
    expect(branList[1]!.matrix[14]).toBe(3);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('暴露 query 内部细分时序，便于区分冷启动、注册与 SQL 阶段', async () => {
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

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('ORDER BY i.refno_str, gi.geo_index')) {
        return {
          toArray: () => [
            {
              refno_str: '24381_145714',
              noun: 'ELBO',
              owner_refno_str: '24381_145712',
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
              ...createIdentityMatrix(10, 20, 30),
              g_m00: null, g_m10: null, g_m20: null, g_m30: null,
              g_m01: null, g_m11: null, g_m21: null, g_m31: null,
              g_m02: null, g_m12: null, g_m22: null, g_m32: null,
              g_m03: null, g_m13: null, g_m23: null, g_m33: null,
            },
          ],
        };
      }
      if (sql.includes('FROM tubi_candidates c')) {
        return {
          toArray: () => [
            {
              refno_str: '24381_145712',
              tubi_refno_str: '24381_145712',
              noun: 'TUBI',
              owner_refno_str: '24381_145712',
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
              ...createIdentityMatrix(100, 200, 300),
              iw_m00: null, iw_m10: null, iw_m20: null, iw_m30: null,
              iw_m01: null, iw_m11: null, iw_m21: null, iw_m31: null,
              iw_m02: null, iw_m12: null, iw_m22: null, iw_m32: null,
              iw_m03: null, iw_m13: null, iw_m23: null, iw_m33: null,
              g_m00: null, g_m10: null, g_m20: null, g_m30: null,
              g_m01: null, g_m11: null, g_m21: null, g_m31: null,
              g_m02: null, g_m12: null, g_m22: null, g_m32: null,
              g_m03: null, g_m13: null, g_m23: null, g_m33: null,
            },
            {
              refno_str: '24381_145714',
              tubi_refno_str: '24381_145714',
              noun: 'TUBI',
              owner_refno_str: '24381_145712',
              owner_noun: '',
              spec_value: 1,
              has_neg: false,
              trans_hash: '334',
              aabb_hash: '445',
              geo_index: 1,
              geo_hash: '2',
              geo_trans_hash: '',
              min_x: 0,
              min_y: 0,
              min_z: 0,
              max_x: 1,
              max_y: 1,
              max_z: 1,
              ...createIdentityMatrix(1, 2, 3),
              iw_m00: 1, iw_m10: 0, iw_m20: 0, iw_m30: 0,
              iw_m01: 0, iw_m11: 1, iw_m21: 0, iw_m31: 0,
              iw_m02: 0, iw_m12: 0, iw_m22: 1, iw_m32: 0,
              iw_m03: 10, iw_m13: 20, iw_m23: 30, iw_m33: 1,
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
    const out = await loader.queryInstanceEntriesByRefnos(7997, ['24381_145712', '24381_145714']);

    expect(out.get('24381_145712')).toHaveLength(1);
    expect(out.get('24381_145714')).toHaveLength(2);
    expect(loader.lastQueryTiming.value).toMatchObject({
      stats: {
        requestedRefnos: 2,
        chunkCount: 1,
        mainRows: 1,
        tubiRows: 2,
        resultBuckets: 2,
        resultEntries: 3,
      },
    });
    expect(loader.lastQueryTiming.value?.phaseMs.total).toBeGreaterThanOrEqual(0);
    expect(loader.lastQueryTiming.value?.phaseMs.duckdbInit).toBeGreaterThanOrEqual(0);
    expect(loader.lastQueryTiming.value?.phaseMs.registerDbno).toBeGreaterThanOrEqual(0);
    expect(loader.lastQueryTiming.value?.phaseMs.mainSql).toBeGreaterThanOrEqual(0);
    expect(loader.lastQueryTiming.value?.phaseMs.mainRows).toBeGreaterThanOrEqual(0);
    expect(loader.lastQueryTiming.value?.phaseMs.tubiSql).toBeGreaterThanOrEqual(0);
    expect(loader.lastQueryTiming.value?.phaseMs.tubiRows).toBeGreaterThanOrEqual(0);
  });

  it('从 parquet 快照查询直子元件 ptset 摘要', async () => {
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
        return new Response(JSON.stringify(createPtsetManifest(7997)), { status: 200 });
      }

      throw new Error(`unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    queryMock.mockImplementation(async (sql: string) => {
      expect(sql).toContain('WHERE i.owner_refno_str = \'24381_145712\'');
      expect(sql).toContain('p_7997_ptsets.parquet');
      return {
        toArray: () => [
          {
            refno_str: '24381_145714',
            noun: 'ELBO',
            name: '',
            cata_hash: 'cata-a',
            pt_count: 2,
          },
          {
            refno_str: '24381_145715',
            noun: 'GASK',
            name: '',
            cata_hash: 'cata-b',
            pt_count: 0,
          },
        ],
      };
    });

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader');
    const loader = useDbnoInstancesParquetLoader();
    const out = await loader.queryDirectChildrenPtsetSummary(7997, '24381_145712');

    expect(out).toEqual([
      {
        refno: '24381_145714',
        noun: 'ELBO',
        name: '',
        success: true,
        ptCount: 2,
        errorMessage: null,
      },
      {
        refno: '24381_145715',
        noun: 'GASK',
        name: '',
        success: false,
        ptCount: 0,
        errorMessage: 'cata_hash=cata-b 未找到 ptset 点',
      },
    ]);
  });

  it('模型包缺少 ptsets 表时仍能列出直子元件并标记不可用', async () => {
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
    queryMock.mockImplementation(async (sql: string) => {
      expect(sql).not.toContain('ptsets_7997');
      return {
        toArray: () => [
          {
            refno_str: '24381_145714',
            noun: 'ELBO',
            name: '',
            cata_hash: 'cata-a',
            pt_count: 0,
          },
        ],
      };
    });

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader');
    const loader = useDbnoInstancesParquetLoader();
    const out = await loader.queryDirectChildrenPtsetSummary(7997, '24381_145712');

    expect(out).toEqual([
      {
        refno: '24381_145714',
        noun: 'ELBO',
        name: '',
        success: false,
        ptCount: 0,
        errorMessage: '当前模型包未包含 ptsets.parquet，ptset 不可用',
      },
    ]);
  });

  it('queryPtsetByRefnoFromParquet 区分缺少 ptsets 表的诊断', async () => {
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

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader');
    const loader = useDbnoInstancesParquetLoader();
    const out = await loader.queryPtsetByRefnoFromParquet(7997, '24381_145714');

    expect(out).toMatchObject({
      success: false,
      refno: '24381_145714',
      error_code: 'PTSET_TABLE_MISSING',
      error_message: '当前模型包未包含 ptsets.parquet，ptset 测量不可用',
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('queryPtsetByRefnoFromParquet 区分缺少 instance row 的诊断', async () => {
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
        return new Response(JSON.stringify(createPtsetManifest(7997)), { status: 200 });
      }

      throw new Error(`unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    queryMock.mockResolvedValue({ toArray: () => [] });

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader');
    const loader = useDbnoInstancesParquetLoader();
    const out = await loader.queryPtsetByRefnoFromParquet(7997, '24381_145714');

    expect(out).toMatchObject({
      success: false,
      error_code: 'PTSET_INSTANCE_MISSING',
      error_message: 'instances.parquet 中未找到 refno=24381_145714',
    });
  });

  it('queryPtsetByRefnoFromParquet 区分缺少 cata_hash 的诊断', async () => {
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
        return new Response(JSON.stringify(createPtsetManifest(7997)), { status: 200 });
      }

      throw new Error(`unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    queryMock.mockResolvedValue({
      toArray: () => [
        {
          refno_str: '24381_145714',
          cata_hash: '',
          trans_hash: 'trans-a',
          ...createIdentityMatrix(1, 2, 3),
        },
      ],
    });

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader');
    const loader = useDbnoInstancesParquetLoader();
    const out = await loader.queryPtsetByRefnoFromParquet(7997, '24381_145714');

    expect(out).toMatchObject({
      success: false,
      error_code: 'PTSET_CATA_HASH_MISSING',
      error_message: 'refno=24381_145714 缺少 cata_hash，无法查询 ptset',
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('queryPtsetByRefnoFromParquet 区分缺少 transform row 的诊断', async () => {
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
        return new Response(JSON.stringify(createPtsetManifest(7997)), { status: 200 });
      }

      throw new Error(`unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    queryMock.mockResolvedValue({
      toArray: () => [
        {
          refno_str: '24381_145714',
          cata_hash: 'cata-a',
          trans_hash: 'missing-trans',
          m00: null,
          m10: null,
          m20: null,
          m30: null,
          m01: null,
          m11: null,
          m21: null,
          m31: null,
          m02: null,
          m12: null,
          m22: null,
          m32: null,
          m03: null,
          m13: null,
          m23: null,
          m33: null,
        },
      ],
    });

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader');
    const loader = useDbnoInstancesParquetLoader();
    const out = await loader.queryPtsetByRefnoFromParquet(7997, '24381_145714');

    expect(out).toMatchObject({
      success: false,
      error_code: 'PTSET_TRANSFORM_MISSING',
      error_message: 'refno=24381_145714 trans_hash=missing-trans 缺少 transform row，无法转换 ptset',
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('queryPtsetByRefnoFromParquet 区分 cata_hash 无 point rows 的诊断', async () => {
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
        return new Response(JSON.stringify(createPtsetManifest(7997)), { status: 200 });
      }

      throw new Error(`unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    queryMock
      .mockResolvedValueOnce({
        toArray: () => [
          {
            refno_str: '24381_145714',
            cata_hash: 'cata-a',
            trans_hash: 'trans-a',
            ...createIdentityMatrix(1, 2, 3),
          },
        ],
      })
      .mockResolvedValueOnce({ toArray: () => [] });

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader');
    const loader = useDbnoInstancesParquetLoader();
    const out = await loader.queryPtsetByRefnoFromParquet(7997, '24381_145714');

    expect(out).toMatchObject({
      success: false,
      error_code: 'PTSET_POINTS_MISSING',
      error_message: 'cata_hash=cata-a 未找到 ptset 点',
    });
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('从 primitive_keypoints.parquet 查询并转换构件局部关键点', async () => {
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
        return new Response(JSON.stringify(createPrimitiveKeypointManifest(7997)), { status: 200 });
      }

      throw new Error(`unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    queryMock.mockImplementation(async (sql: string) => {
      expect(sql).toContain('primitive_keypoints');
      expect(sql).toContain('p_7997_primitive_keypoints.parquet');
      return {
        toArray: () => [
          {
            refno_str: '24381_145714',
            geo_index: 0,
            geo_hash: 'geo-a',
            ...createIdentityMatrix(10, 20, 30),
            g_m00: null, g_m10: null, g_m20: null, g_m30: null,
            g_m01: null, g_m11: null, g_m21: null, g_m31: null,
            g_m02: null, g_m12: null, g_m22: null, g_m32: null,
            g_m03: null, g_m13: null, g_m23: null, g_m33: null,
            keypoint_index: 2,
            kind: 'center',
            local_x: 1000,
            local_y: 2000,
            local_z: 3000,
            has_dir: false,
            dir_x: 0,
            dir_y: 0,
            dir_z: 0,
            source: 'geo_relate.pts',
          },
        ],
      };
    });

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader');
    const loader = useDbnoInstancesParquetLoader();
    const out = await loader.queryPrimitiveKeypointsByRefnoFromParquet(7997, '24381_145714');

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'primitive:24381_145714:0:geo-a#2',
      refno: '24381_145714',
      geoHash: 'geo-a',
      geoIndex: 0,
      keypointIndex: 2,
      kind: 'center',
      source: 'geo_relate.pts',
      local: [1, 2, 3],
      world: [11, 22, 33],
    });
    expect(registerFileURLMock.mock.calls.map((call) => String(call[0]))).toContain(
      'p_7997_primitive_keypoints.parquet'
    );
  });

  it('primitive keypoint 数据或单位元数据缺失时报告不可用', async () => {
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

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader');
    const loader = useDbnoInstancesParquetLoader();

    await expect(loader.isPrimitiveKeypointParquetAvailable(7997)).resolves.toBe(false);
    await expect(
      loader.queryPrimitiveKeypointsByRefnoFromParquet(7997, '24381_145714')
    ).rejects.toThrow('未包含 primitive_keypoints.parquet');
  });

  it('primitive keypoint 表存在但缺少 unit 元数据时报告契约不完整', async () => {
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
        const manifest = createManifest(7997);
        return new Response(JSON.stringify({
          ...manifest,
          tables: {
            ...manifest.tables,
            primitive_keypoints: { file: 'primitive_keypoints_7997.parquet' },
          },
        }), { status: 200 });
      }

      throw new Error(`unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader');
    const loader = useDbnoInstancesParquetLoader();

    await expect(loader.isPrimitiveKeypointParquetAvailable(7997)).resolves.toBe(false);
    await expect(
      loader.queryPrimitiveKeypointsByRefnoFromParquet(7997, '24381_145714')
    ).rejects.toThrow('缺少 primitive_keypoint_unit.geo_local 元数据');
  });

  it('primitive keypoint unit 坐标空间不是 geo_local 时报告契约不完整', async () => {
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
        const manifest = createPrimitiveKeypointManifest(7997);
        return new Response(JSON.stringify({
          ...manifest,
          primitive_keypoint_unit: {
            ...manifest.primitive_keypoint_unit,
            coordinate_space: 'local',
          },
        }), { status: 200 });
      }

      throw new Error(`unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader');
    const loader = useDbnoInstancesParquetLoader();

    await expect(loader.isPrimitiveKeypointParquetAvailable(7997)).resolves.toBe(false);
    await expect(
      loader.queryPrimitiveKeypointsByRefnoFromParquet(7997, '24381_145714')
    ).rejects.toThrow('缺少 primitive_keypoint_unit.geo_local 元数据');
  });

  it('给 DuckDB 远程 parquet URL 添加缓存规避参数', async () => {
    const { buildParquetRemoteFileUrl } = await import('./useDbnoInstancesParquetLoader');

    const url = buildParquetRemoteFileUrl(
      '/files/output/AvevaMarineSample/parquet',
      '7997/instances.parquet',
      'page-load-1'
    );

    expect(url).toContain('/files/output/AvevaMarineSample/parquet/7997/instances.parquet');
    const parsed = new URL(url, 'http://127.0.0.1:3101');
    expect(parsed.searchParams.get('__duckdb')).toBe('page-load-1');
  });

  it('保留已有查询参数并继续追加缓存规避参数', async () => {
    const { buildParquetRemoteFileUrl } = await import('./useDbnoInstancesParquetLoader');

    const url = buildParquetRemoteFileUrl(
      'http://123.57.182.243/files/output/AvevaMarineSample/parquet?foo=1',
      '7997/instances.parquet',
      'page-load-2'
    );

    const parsed = new URL(url);
    expect(parsed.searchParams.get('foo')).toBe('1');
    expect(parsed.searchParams.get('__duckdb')).toBe('page-load-2');
  });

  it('每次查询前都重新注册远端 parquet，并启用 directIO 避免复用旧缓存路径', async () => {
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

    queryMock.mockResolvedValue({
      toArray: () => [],
    });

    const { useDbnoInstancesParquetLoader } = await import('./useDbnoInstancesParquetLoader');
    const loader = useDbnoInstancesParquetLoader();

    await loader.queryInstanceEntriesByRefnos(7997, ['24381_145018']);
    await loader.queryInstanceEntriesByRefnos(7997, ['24381_145018']);

    expect(registerFileURLMock).toHaveBeenCalledTimes(10);

    const firstQueryCalls = registerFileURLMock.mock.calls.slice(0, 5);
    const secondQueryCalls = registerFileURLMock.mock.calls.slice(5, 10);

    for (const call of registerFileURLMock.mock.calls) {
      expect(call[2]).toBe('http');
      expect(call[3]).toBe(true);
    }

    expect(String(firstQueryCalls[0]?.[0])).toMatch(/^p_7997_instances_.+\.parquet$/);
    expect(String(secondQueryCalls[0]?.[0])).toMatch(/^p_7997_instances_.+\.parquet$/);
    expect(String(firstQueryCalls[0]?.[0])).not.toBe(String(secondQueryCalls[0]?.[0]));
    expect(String(firstQueryCalls[0]?.[1])).toContain('/files/output/instances/instances_7997.parquet');
    expect(String(secondQueryCalls[0]?.[1])).toContain('/files/output/instances/instances_7997.parquet');
    expect(String(firstQueryCalls[0]?.[1])).not.toBe(String(secondQueryCalls[0]?.[1]));
  });
});
