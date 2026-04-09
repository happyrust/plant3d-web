import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

describe('genModelE3dParquetApi project switching', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    queryMock.mockResolvedValue({
      toArray: () => [
        {
          refno: '200/1',
          name: 'Pipe Node',
          noun: 'PIPE',
          owner: null,
          children_count: 0,
        },
      ],
    });
    registerFileURLMock.mockResolvedValue(undefined);

    vi.stubGlobal(
      'Worker',
      class {
        terminate() {
          return undefined;
        }
      } as unknown as typeof Worker
    );
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/files/output/project-a/scene_tree/db_meta_info.json')) {
        return Promise.resolve(
          jsonResponse({
            db_files: {
              '1': { dbnum: 1 },
            },
            ref0_to_dbnum: {
              '100': 1,
            },
          })
        );
      }
      if (url.endsWith('/files/output/project-b/scene_tree/db_meta_info.json')) {
        return Promise.resolve(
          jsonResponse({
            db_files: {
              '1': { dbnum: 1 },
            },
            ref0_to_dbnum: {
              '200': 1,
            },
          })
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:duckdb-worker');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reloads db meta and tree file bindings when the active project changes', async () => {
    const filesOutput = await import('@/lib/filesOutput');
    const api = await import('./genModelE3dParquetApi');

    filesOutput.setCurrentProjectPath('project-a');
    const first = await api.e3dParquetGetNode('100/1');

    filesOutput.setCurrentProjectPath('project-b');
    const second = await api.e3dParquetGetNode('200/1');

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith('/files/output/project-a/scene_tree/db_meta_info.json');
    expect(fetchMock).toHaveBeenCalledWith('/files/output/project-b/scene_tree/db_meta_info.json');

    const treeRegistrations = registerFileURLMock.mock.calls.filter(
      ([localName]) => localName === 'e3d_pdms_tree_1.parquet'
    );
    expect(treeRegistrations).toHaveLength(2);
    expect(String(treeRegistrations[0]?.[1])).toContain('/files/output/project-a/scene_tree_parquet/pdms_tree_1.parquet');
    expect(String(treeRegistrations[1]?.[1])).toContain('/files/output/project-b/scene_tree_parquet/pdms_tree_1.parquet');
  });
});

describe('e3dParquetGetVisibleInsts', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    registerFileURLMock.mockResolvedValue(undefined);

    const toId = (refno: string): string => {
      const [ref0, sesno] = refno.split('_').map((value) => BigInt(value));
      return ((ref0 << 32n) + (sesno & 0xffff_ffffn)).toString();
    };

    const pipeId = toId('24381_144975');
    const branAId = toId('24381_144976');
    const branBId = toId('24381_145018');

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('world_refno_str') && sql.includes('site_count')) {
        return {
          toArray: () => [{
            world_refno_str: '1/1',
            world_id: '4294967297',
            site_count: 1,
          }],
        };
      }

      if (sql.includes('SELECT noun') && sql.includes(`WHERE id = ${pipeId}`)) {
        return {
          toArray: () => [{ noun: 'PIPE' }],
        };
      }

      if (
        sql.includes('SELECT DISTINCT gi.refno_str AS refno_str')
        && sql.includes(`WHERE id = ${pipeId}`)
      ) {
        return {
          toArray: () => [{ refno: '24381_145200' }],
        };
      }

      if (sql.includes('upper(t.noun) IN (\'BRAN\', \'HANG\')') && sql.includes(`WHERE t.id != ${pipeId}`)) {
        return {
          toArray: () => [
            { refno: '24381_144976' },
            { refno: '24381_145018' },
          ],
        };
      }

      if (sql.includes(`WHERE parent = ${branAId}`)) {
        return {
          toArray: () => [
            { refno: '24381_144977' },
            { refno: '24381_144978' },
          ],
        };
      }

      if (sql.includes(`WHERE parent = ${branBId}`)) {
        return {
          toArray: () => [{ refno: '24381_145019' }],
        };
      }

      throw new Error(`unexpected sql: ${sql}`);
    });

    vi.stubGlobal(
      'Worker',
      class {
        terminate() {
          return undefined;
        }
      } as unknown as typeof Worker
    );
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method || 'GET').toUpperCase();

      if (url.endsWith('/files/output/project-a/scene_tree/db_meta_info.json')) {
        return Promise.resolve(
          jsonResponse({
            db_files: {
              '7997': { dbnum: 7997 },
            },
            ref0_to_dbnum: {
              '24381': 7997,
            },
          })
        );
      }

      if (url.endsWith('/files/output/project-a/instances/manifest_7997.json')) {
        return Promise.resolve(
          jsonResponse({
            dbnum: 7997,
            tables: {
              geo_instances: { file: 'geo_instances_7997.parquet' },
              tubings: { file: 'tubings_7997.parquet' },
            },
          })
        );
      }

      if (
        method === 'HEAD'
        && (
          url.endsWith('/files/output/project-a/instances/tubings_7997.parquet')
          || url.endsWith('/files/output/project-a/instances/geo_instances_7997.parquet')
        )
      ) {
        return Promise.resolve(new Response(null, { status: 200 }));
      }

      throw new Error(`unexpected fetch: ${method} ${url}`);
    }));

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:duckdb-worker');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('对 PIPE 根节点会合并 BRAN/HANG 根与其子项', async () => {
    const filesOutput = await import('@/lib/filesOutput');
    const api = await import('./genModelE3dParquetApi');

    filesOutput.setCurrentProjectPath('project-a');
    const resp = await api.e3dParquetGetVisibleInsts('24381_144975');

    expect(resp.success).toBe(true);
    expect(resp.refnos).toEqual([
      '24381_144976',
      '24381_144977',
      '24381_144978',
      '24381_145018',
      '24381_145019',
      '24381_145200',
    ]);
  });
});
